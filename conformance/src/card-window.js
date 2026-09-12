/**
 * A card window the suite can drive.
 *
 * Two jobs: assemble a card document around a given injection layer, and open it
 * with a scripted host on the other end of the socket. Nothing here imports the
 * reference shim — the point of the suite is that it runs against somebody
 * else's injection layer, so the layer arrives as a parameter.
 *
 * The transport constants are the specification's (section 2.8: postMessage,
 * `card:` prefix, paired by requestId). The capability *names* are not: section
 * 2.3 fixes `request(capability, payload)` as the single dispatch point but
 * never says what goes in the first argument, so the names live in
 * DEFAULT_CAPABILITY_NAMES as a suite convention a host can override.
 */

import { JSDOM, VirtualConsole } from 'jsdom';

/** Section 2.8. */
export const CARD_REQUEST_TYPE = 'card:request';
export const CARD_RESPONSE_TYPE = 'card:response';

/** Suite convention; see the note above and the README. */
export const DEFAULT_CAPABILITY_NAMES = Object.freeze({
  stateGet: 'state.get',
  stateSet: 'state.set',
  invoke: 'invoke',
  capabilities: 'capabilities',
});

const DEFAULT_ORIGIN = 'https://card.localhost/';

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Assemble a complete card document around an injection layer (section 1.1:
 * a card entry is always a whole document the injection layer is added to,
 * never a fragment a host assembles; section 2.2: the runtime is defined
 * before any card content). No identity goes into the document — section
 * 1.3 keeps that entirely on the host side, so a suite building a throwaway
 * document for a test has nothing to burn in either.
 */
export function buildCardDocument({ runtimeSource, body = '', title = 'Conformance card', head = '' }) {
  // An inline script ends at the first `</script`, wherever it turns up.
  const runtime = String(runtimeSource ?? '').replace(/<\/script/gi, '<\\/script');
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeText(title)}</title>`,
    `<script>${runtime}</script>`,
    head,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Open a card document with a host on the other end.
 *
 * `respond(message)` receives each `card:request` and returns an envelope, or a
 * promise of one, or `undefined` to leave the request unanswered (which is how
 * a timeout is staged).
 *
 * @returns {Promise<{ window, document, requests, close }>}
 */
export async function openCardWindow({
  documentText,
  respond = null,
  hosted = true,
  origin = DEFAULT_ORIGIN,
} = {}) {
  const requests = [];
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => {
    if (error.type === 'unhandled-exception') {
      errors.push(error);
    }
  });

  let cardWindow = null;

  const deliver = (message, envelope) => {
    if (!cardWindow || envelope === undefined) {
      return;
    }
    cardWindow.dispatchEvent(
      new cardWindow.MessageEvent('message', {
        data: { type: CARD_RESPONSE_TYPE, requestId: message.requestId, ...envelope },
      }),
    );
  };

  const parentFrame = {
    postMessage(message) {
      if (!message || message.type !== CARD_REQUEST_TYPE) {
        return;
      }
      requests.push(message);
      if (!respond) {
        return;
      }
      Promise.resolve(respond(message)).then((envelope) => deliver(message, envelope));
    },
  };

  const dom = new JSDOM(String(documentText), {
    url: origin,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      cardWindow = window;
      if (hosted) {
        // Section 2.8: the runtime tells a host apart from a standalone open by
        // comparing window.parent with window. jsdom will not run scripts inside
        // an iframe, so the frame relationship is staged here instead.
        Object.defineProperty(window, 'parent', { value: parentFrame, configurable: true, writable: true });
      }
    },
  });

  const window = dom.window;
  if (window.document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }

  const tick = (times = 3) =>
    new Promise((resolve) => {
      let left = times;
      const step = () => {
        left -= 1;
        if (left <= 0) {
          resolve();
          return;
        }
        window.setTimeout(step, 0);
      };
      window.setTimeout(step, 0);
    });

  await tick();

  return {
    window,
    document: window.document,
    requests,
    errors,
    tick,
    close() {
      window.close();
    },
  };
}
