import { JSDOM } from 'jsdom';

import { createReferenceHostAdapter } from '../../conformance/src/reference-adapter.js';

/**
 * A runnable adapter example for `npm run cli -- conformance --adapter ...`.
 *
 * It deliberately exercises the tested reference host, not the loopback demo
 * server in this directory. Replace its `mount` implementation when adapting
 * the suite to a real host. Passing this adapter establishes only the
 * automatable L1 checks; it does not establish L2 or L3 conformance.
 */
export default function createDeveloperReferenceAdapter() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://showcard-adapter.localhost/',
  });
  const previousDOMParser = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  const reference = createReferenceHostAdapter({ document: dom.window.document });

  return {
    mount(cardSource, cardId) {
      return reference.mount(cardSource, cardId);
    },
    async close() {
      await reference.close();
      dom.window.close();
      if (previousDOMParser === undefined) delete globalThis.DOMParser;
      else globalThis.DOMParser = previousDOMParser;
    },
  };
}
