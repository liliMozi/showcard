/**
 * The in-repo host adapter: the probe suite pointed at the reference shim.
 *
 * This is the one module in `conformance/src` that knows the reference shim
 * exists. Everything else takes the host as a parameter, which is the point — a
 * third-party host writes its own file like this one and the rest of the suite
 * is unchanged.
 *
 * `adapter.mount(cardSource, cardId)` receives one of two shapes now
 * (`host-suite.js`'s doc comment has the full contract): a string, for a
 * `file`-shaped (degenerate-package) probe, or `{ entry, files }`, for a
 * `dir`-shaped (real multi-file package) probe. This adapter bridges each
 * shape differently, because jsdom cannot execute scripts inside an iframe
 * either way, and the two shapes need different bridges:
 *
 * - **String.** The document text is mounted for real through `mountCard`
 *   (real manifest reading, real dispatcher), then the *prepared* document
 *   string `mountCard` produced is opened in jsdom's own top-level window,
 *   with that window's `parent.postMessage` wired straight to the dispatcher
 *   `mountCard` built. Document assembly, capability dispatch and the state
 *   store are all the real code path; only the postMessage hop is bridged.
 *
 * - **Package.** There is no document string to hand jsdom directly — a
 *   package's relative references (`assets/style.css`, and so on) only
 *   resolve against a real served URL, which is exactly what section 1.1
 *   asks a host to provide. So the package is actually served: `serve.js`'s
 *   package host, wrapped in a real `node:http` listener
 *   (`node-serve.js`), mounted for real through `mountPackage` for the same
 *   dispatcher construction as the string path, and opened with
 *   `JSDOM.fromURL` against the real served URL with `resources: 'usable'`
 *   — jsdom then fetches the entry and its assets over real loopback HTTP,
 *   the same way a browser would. The postMessage hop is bridged the same
 *   way as the string path; nothing else is.
 *
 * A browser-based adapter needs no bridge in either case — a real iframe
 * runs its own scripts and does its own relative-reference resolution.
 */

import { JSDOM, VirtualConsole } from 'jsdom';

import { createMemoryStateStore, mountCard, mountPackage } from '../../reference/src/host.js';
import { injectRuntimeIntoDocument } from '../../reference/src/wrap.js';
import { startPackageServer } from '../../reference/src/node-serve.js';
import { CARD_REQUEST_TYPE, openCardWindow } from './card-window.js';

/** The binding every probe card that needs a tool channel declares. */
export const ECHO_BINDING_ID = 'echo';

/** What that binding does: hands the input straight back (see the README). */
export async function echoBinding({ input }) {
  return { echo: input === undefined ? null : input };
}

function isPackageSource(cardSource) {
  return Boolean(cardSource) && typeof cardSource === 'object' && cardSource.files instanceof Map;
}

/**
 * Build an adapter the probe driver can drive.
 *
 * @param {object} [options]
 * @param {object} [options.stateStore] shared across mounts, so state is keyed
 *        by card id and survives a remount (section 2.5)
 * @param {Function} [options.executeBinding] the gateway hook
 * @param {Function} [options.dispatch] replaces the shim's dispatcher outright;
 *        this is how a test stages a host that answers badly
 * @param {Document} [options.document] where the host's own DOM goes
 */
export function createReferenceHostAdapter(options = {}) {
  const hostDocument = options.document || globalThis.document;
  if (!hostDocument || typeof hostDocument.createElement !== 'function') {
    throw new TypeError('createReferenceHostAdapter needs a document to mount the host side into');
  }

  const stateStore = options.stateStore || createMemoryStateStore();
  const executeBinding = options.executeBinding || echoBinding;

  // Started lazily, and only once per adapter: most probes are single-file
  // and never need a real server at all, so nothing pays for one unless a
  // package-shaped probe actually mounts.
  let serverPromise = null;
  function packageServer() {
    if (!serverPromise) {
      serverPromise = startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    }
    return serverPromise;
  }

  /** Bridge a scripted window's `parent.postMessage` to a real dispatcher. */
  function wireDispatch(window, dispatch) {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: {
        postMessage(message) {
          if (!message || message.type !== CARD_REQUEST_TYPE) {
            return;
          }
          Promise.resolve(dispatch(message.capability, message.payload)).then((envelope) => {
            window.dispatchEvent(
              new window.MessageEvent('message', {
                data: { type: 'card:response', requestId: message.requestId, ...envelope },
              }),
            );
          });
        },
      },
    });
  }

  async function waitForLoad(window) {
    if (window.document.readyState !== 'complete') {
      await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    }
  }

  async function mountSingleDocument(cardSource, cardId) {
    const container = hostDocument.createElement('div');
    hostDocument.body.appendChild(container);

    let mounted = null;
    let card = null;

    async function open() {
      mounted = mountCard({ container, cardSource, cardId, stateStore, executeBinding });
      const dispatch = options.dispatch || mounted.dispatch;
      card = await openCardWindow({
        documentText: mounted.iframe.getAttribute('srcdoc'),
        respond: (message) =>
          message.type === CARD_REQUEST_TYPE ? dispatch(message.capability, message.payload) : undefined,
      });
    }

    async function close() {
      if (card) {
        card.close();
        card = null;
      }
      if (mounted) {
        mounted.unmount();
        mounted = null;
      }
    }

    await open();

    return {
      getDocument() {
        return card ? card.document : null;
      },
      async remount() {
        await close();
        await open();
      },
      async unmount() {
        await close();
        container.remove();
      },
    };
  }

  async function mountPackageSource(pkg, cardId) {
    const server = await packageServer();
    const entry = pkg.entry || 'index.html';
    const entrySource = pkg.files.get(entry);
    // A random suffix, not just cardId: a probe's remount tears an instance
    // down and stands a fresh one up under a new ticket, which is exactly
    // section 1.1's model — a scope ticket names one instance, not one card.
    const ticket = `${cardId}-${Math.random().toString(36).slice(2, 8)}`;

    let mounted = null;
    let cardWindow = null;
    let container = null;
    const virtualConsole = new VirtualConsole();

    async function open() {
      server.packageHost.mount(ticket, { files: pkg.files, entry });

      container = hostDocument.createElement('div');
      hostDocument.body.appendChild(container);
      mounted = mountPackage({
        container,
        entrySource,
        src: server.url(ticket, entry),
        cardId,
        stateStore,
        executeBinding,
      });
      const dispatch = options.dispatch || mounted.dispatch;

      const dom = await JSDOM.fromURL(server.url(ticket, entry), {
        resources: 'usable',
        runScripts: 'dangerously',
        virtualConsole,
        beforeParse(window) {
          wireDispatch(window, dispatch);
        },
      });
      await waitForLoad(dom.window);
      cardWindow = dom.window;
    }

    async function close() {
      if (cardWindow) {
        cardWindow.close();
        cardWindow = null;
      }
      if (mounted) {
        mounted.unmount();
        mounted = null;
      }
      if (container) {
        container.remove();
        container = null;
      }
      server.packageHost.unmount(ticket);
    }

    await open();

    return {
      getDocument() {
        return cardWindow ? cardWindow.document : null;
      },
      async remount() {
        await close();
        await open();
      },
      async unmount() {
        await close();
      },
    };
  }

  return {
    async mount(cardSource, cardId) {
      return isPackageSource(cardSource) ? mountPackageSource(cardSource, cardId) : mountSingleDocument(cardSource, cardId);
    },
    /**
     * Close the package server, if a package-shaped probe ever started one.
     * Not part of the `runHostSuite` adapter contract — that only needs
     * `mount` — but a caller running this adapter as a real process (rather
     * than inside a test runner that force-exits) needs a way to let a
     * listening `node:http` server go, or the process never ends on its own.
     */
    async close() {
      if (serverPromise) {
        const server = await serverPromise;
        await server.close();
        serverPromise = null;
      }
    },
  };
}
