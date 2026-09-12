/**
 * Test harness for the injection layer.
 *
 * The runtime is a source string meant to run inside a card document. jsdom does
 * not execute scripts inside an iframe, so the tests build a stand-in card window
 * and evaluate the source against it. The source only ever touches globals
 * through `window.`, so a stand-in window is a faithful stage: the same text runs
 * unchanged in a real browser.
 */

import { CARD_RUNTIME_SOURCE } from '../../src/runtime-source.js';
import { CARD_RESPONSE_TYPE } from '../../src/codes.js';

export function createStorageStub(initial = {}, { failWrites = false } = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) {
        throw new Error('quota exceeded');
      }
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

/**
 * Build a card window. `hosted: true` puts it inside a parent frame (the host
 * path); `hosted: false` makes `window.parent === window`, which is how the
 * runtime detects a standalone open (section 2.8 / 3.4).
 *
 * `pathname` stands in for the document's own address, which section 2.5
 * derives the standalone fallback storage key from — the same partitioning a
 * plain web page already gets from its URL, no id field required. Pass
 * `pathname: null` to model a location with nothing usable in it (an opaque
 * origin, say), the way section 2.5's storage-key tests need to.
 *
 * `legacyCardId`, when given, burns a `<meta name="card-id">` into the
 * document the way a pre-redefinition export did (section 1.8). The runtime
 * must not read it for anything any more — it exists here only so a test can
 * assert that it is ignored.
 */
export function createCardEnvironment({
  hosted = true,
  storage = createStorageStub(),
  html = '',
  pathname = '/cards/card-1/index.html',
  legacyCardId = null,
  alreadyParsed = false,
} = {}) {
  const doc = document.implementation.createHTMLDocument('card under test');
  if (alreadyParsed) {
    // A document handed to the runtime after parsing finished, e.g. a runtime
    // injected into a live document rather than through the document head.
    Object.defineProperty(doc, 'readyState', { value: 'complete', configurable: true });
  }
  if (legacyCardId) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'card-id');
    meta.setAttribute('content', legacyCardId);
    doc.head.appendChild(meta);
  }
  doc.body.innerHTML = html;

  const bus = new EventTarget();
  const sent = [];

  const env = {
    doc,
    sent,
    storage,
    postFailure: null,
    responder: null,
  };

  const parentFrame = {
    postMessage(message) {
      if (env.postFailure) {
        throw env.postFailure;
      }
      sent.push(message);
      if (env.responder) {
        const answer = env.responder(message);
        if (answer !== undefined) {
          queueMicrotask(() => env.respond({ ...answer, requestId: message.requestId }));
        }
      }
    },
  };

  const win = {
    document: doc,
    localStorage: storage,
    location: pathname === null ? {} : { pathname },
    TextEncoder: globalThis.TextEncoder,
    FormData: globalThis.FormData,
    addEventListener: (...args) => bus.addEventListener(...args),
    removeEventListener: (...args) => bus.removeEventListener(...args),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  win.parent = hosted ? parentFrame : win;

  env.win = win;

  /**
   * Evaluate the injection layer against this window and return `window.card`.
   *
   * In a browser the runtime runs from the document head while parsing is still
   * under way, and the parser fires DOMContentLoaded once the card content
   * exists. A document built by createHTMLDocument has no parser and stays in
   * `loading` forever, so the harness fires that event itself to keep the
   * sequence faithful.
   */
  env.install = () => {
    // eslint-disable-next-line no-new-func -- the runtime is source text by design
    new Function('window', CARD_RUNTIME_SOURCE)(win);
    if (doc.readyState === 'loading') {
      doc.dispatchEvent(new Event('DOMContentLoaded'));
    }
    return win.card;
  };

  /** Deliver a message to the card, the way a parent frame would. */
  env.respond = (data) => {
    bus.dispatchEvent(new MessageEvent('message', { data }));
  };

  /** Answer every request with the envelope the handler returns. */
  env.answerWith = (handler) => {
    env.responder = (message) => ({ type: CARD_RESPONSE_TYPE, ...handler(message) });
  };

  /** Query the card document. */
  env.$ = (selector) => doc.querySelector(selector);

  return env;
}

/** Let queued microtasks (and therefore settled promises) run. */
export function flush() {
  return new Promise((resolve) => queueMicrotask(resolve));
}
