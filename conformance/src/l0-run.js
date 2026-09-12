/**
 * The L0 harmlessness runner (specification section 9.2).
 *
 * Opens a card the way a double-click opens it — no host, nothing listening —
 * and answers one question: does this file behave itself when the socket is
 * pulled out? Section 7.4 is what makes that question decidable at all. Because
 * every outbound channel goes through the socket, "unplug the socket" cuts
 * everything, so there is no half-degraded card to reason about.
 *
 * What the run asserts:
 *   1. the card loads standalone (`window.parent === window`), scripts and all;
 *   2. zero network requests, before and after the interaction sweep;
 *   3. zero uncaught exceptions and zero unhandled rejections;
 *   4. something renders;
 *   5. every control can be clicked and every field changed without breaking 2 or 3;
 *   6. if the card writes state, the fallback key is derived from the
 *      document's own location (section 2.5) rather than from its title —
 *      no id is burned into a package any more (section 1.3), so there is
 *      nothing else a fallback key could come from.
 *
 * Section 9.2 also asks that the card look the way it looked at export time, by
 * screenshot. This runner does not compare pixels — that needs a real browser,
 * and the suite stays on jsdom so it can run anywhere. The renderability check
 * is the structural stand-in; the deviation is declared in the README.
 */

import { JSDOM, VirtualConsole } from 'jsdom';

/** Channels the runner instruments. Any use is a violation, not a failed request. */
const NETWORK_CHANNELS = Object.freeze([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'Image.src',
]);

const DEFAULT_ORIGIN = 'https://card.localhost/';

/**
 * Only one run at a time: a run takes over the process-level unhandled rejection
 * listeners for its duration (see `captureRejections`), and two runs doing that
 * at once would each hide the other's rejections.
 */
let runInProgress = false;

function isFullDocument(source) {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(String(source));
}

/**
 * Take over unhandled rejection reporting for the duration of a run.
 *
 * Node surfaces a rejection from inside a jsdom context at the process level;
 * there is no window event to listen for. So the run parks the existing
 * listeners, installs its own, and puts them back afterwards. Anything that is
 * not the card's own rejection is forwarded to the parked listeners rather than
 * swallowed — a test harness that eats other people's errors is worse than no
 * harness.
 */
function captureRejections(belongsToCard) {
  const parked = process.listeners('unhandledRejection');
  const captured = [];

  const onRejection = (reason, promise) => {
    if (belongsToCard(reason)) {
      captured.push(reason);
      return;
    }
    for (const listener of parked) {
      listener(reason, promise);
    }
  };

  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', onRejection);

  return {
    captured,
    restore() {
      process.removeListener('unhandledRejection', onRejection);
      for (const listener of parked) {
        process.on('unhandledRejection', listener);
      }
    },
  };
}

/**
 * Replace every outbound channel with a recorder, before any card script runs.
 *
 * jsdom does not load subresources anyway, so this is not about stopping traffic
 * — it is about seeing the attempt. A card that calls `fetch` in an environment
 * without one would otherwise show up as a ReferenceError, which reads as an
 * exception rather than as the reach for the network that it is.
 */
function instrumentNetwork(window, record) {
  const note = (channel, target) => record(channel, target === undefined ? '' : String(target));

  window.fetch = (input) => {
    note('fetch', input && input.url ? input.url : input);
    return Promise.resolve(undefined);
  };

  window.XMLHttpRequest = class InstrumentedXMLHttpRequest {
    open(method, url) {
      this.__url = url;
      note('XMLHttpRequest', url);
    }
    send() {
      note('XMLHttpRequest', this.__url);
    }
    setRequestHeader() {}
    abort() {}
    addEventListener() {}
    removeEventListener() {}
  };

  window.WebSocket = class InstrumentedWebSocket {
    constructor(url) {
      note('WebSocket', url);
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };

  window.EventSource = class InstrumentedEventSource {
    constructor(url) {
      note('EventSource', url);
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };

  if (window.navigator) {
    window.navigator.sendBeacon = (url) => {
      note('sendBeacon', url);
      return true;
    };
  }

  // Covers `new Image()` and `document.createElement('img')` alike, and only
  // from script: the parser sets attributes through internals that never reach
  // this accessor, so markup already in the file is not mistaken for a request.
  const prototype = window.HTMLImageElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
  Object.defineProperty(prototype, 'src', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      note('Image.src', value);
      descriptor.set.call(this, value);
    },
  });
}

function tick(window, times = 3) {
  return new Promise((resolve) => {
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
}

const INVISIBLE_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'TITLE']);

/**
 * Body content a reader would actually see.
 *
 * `textContent` is no help on its own: it counts script and style bodies as
 * text, so a card that is nothing but a stylesheet would read as rendered.
 */
function rendersSomething(document) {
  const body = document.body;
  if (!body) {
    return false;
  }
  for (const element of body.querySelectorAll('*')) {
    if (!INVISIBLE_ELEMENTS.has(element.tagName)) {
      return true;
    }
  }
  for (const node of body.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim() !== '') {
      return true;
    }
  }
  return false;
}

/**
 * Click everything and change every field (section 9.2: "click through all the
 * interactive controls"). Values are changed before the change event so a
 * persisting control actually has something new to write.
 */
function sweepInteractions(window) {
  const document = window.document;
  let count = 0;

  for (const element of document.querySelectorAll('button, a, [data-invoke]')) {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    count += 1;
  }

  for (const control of document.querySelectorAll('input, select, textarea')) {
    if (control.type === 'checkbox' || control.type === 'radio') {
      control.checked = !control.checked;
    } else if (control.tagName === 'SELECT') {
      const other = Array.from(control.options).find((option) => !option.selected);
      if (other) {
        other.selected = true;
      }
    } else {
      control.value = `${control.value || ''}conformance`;
    }
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
    count += 1;
  }

  return count;
}

/**
 * Run the L0 harmlessness test over a complete card document.
 *
 * @param {string} documentText a whole `*.card.html`
 * @param {{ origin?: string }} [options] origin the file is loaded under; it
 *        only has to be a real origin, because local storage does not exist for
 *        an opaque one.
 * @returns {Promise<{ pass, violations, interactions, environment, storage }>}
 */
export async function runL0Harmlessness(documentText, options = {}) {
  const source = String(documentText ?? '');
  if (!isFullDocument(source)) {
    // A fragment has no shim, no id and no title; running one and reporting it
    // harmless would be answering a question nobody asked.
    throw new TypeError('runL0Harmlessness needs a complete card document, not a fragment');
  }
  if (runInProgress) {
    throw new Error('runL0Harmlessness is already running; runs take over rejection reporting and cannot overlap');
  }
  runInProgress = true;

  const violations = [];
  const addViolation = (kind, detail) => violations.push({ kind, detail });
  const networkCalls = [];

  const virtualConsole = new VirtualConsole();
  const uncaught = [];
  virtualConsole.on('jsdomError', (error) => {
    if (error.type === 'unhandled-exception') {
      uncaught.push(error);
    }
  });

  let dom = null;
  let rejections = null;

  try {
    dom = new JSDOM(source, {
      url: options.origin || DEFAULT_ORIGIN,
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(window) {
        instrumentNetwork(window, (channel, target) => networkCalls.push({ channel, target }));
      },
    });

    const window = dom.window;
    rejections = captureRejections((reason) => reason instanceof window.Object);

    if (window.document.readyState !== 'complete') {
      await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    }
    await tick(window);

    // Section 2.8 / 3.4: a file opened on its own is its own top-level frame, so
    // the runtime must have taken the standalone path.
    const environment = window.parent === window ? 'standalone' : 'hosted';
    if (environment !== 'standalone') {
      addViolation('not-standalone', 'the document was not loaded as a top-level frame');
    }

    if (!rendersSomething(window.document)) {
      addViolation('not-renderable', 'the card body has neither text nor a visible element');
    }

    // Watch for state writes through the public surface, so a hand-written
    // `card.state.set` counts the same as the data-persist marker.
    let stateWrites = 0;
    if (window.card && window.card.state && typeof window.card.state.set === 'function') {
      const original = window.card.state.set.bind(window.card.state);
      window.card.state.set = (...args) => {
        stateWrites += 1;
        return original(...args);
      };
    }

    const interactions = sweepInteractions(window);
    await tick(window, 5);

    for (const call of networkCalls) {
      addViolation('network', `the card reached the network through ${call.channel}: ${JSON.stringify(call.target)}`);
    }
    for (const error of uncaught) {
      addViolation('exception', `uncaught exception: ${error.message.split('\n')[0]}`);
    }
    for (const reason of rejections.captured) {
      addViolation('exception', `unhandled rejection: ${reason && reason.message ? reason.message : String(reason)}`);
    }

    // Section 2.5: the fallback key is derived from the document's own
    // location. Only asked when the card actually persists something — a
    // card that never writes has no key to name, and inventing a verdict
    // for it would be inventing a requirement.
    const persistingControls = window.document.querySelectorAll(
      'input[data-persist], select[data-persist], textarea[data-persist]',
    ).length;
    const storage = { assessed: persistingControls > 0 || stateWrites > 0, keys: [], writes: stateWrites };

    if (storage.assessed) {
      const pathname = window.location && window.location.pathname ? window.location.pathname : '';
      storage.pathname = pathname;
      storage.keys = Object.keys(window.localStorage || {});
      if (pathname === '') {
        addViolation('state-key', "the card persists state but the document's location has no path to derive a key from");
      } else if (!storage.keys.some((key) => key.includes(pathname))) {
        addViolation(
          'state-key',
          `the card persisted state but no storage key derives from the document's location path ${JSON.stringify(pathname)}; found ${JSON.stringify(storage.keys)}`,
        );
      }
    }

    return { pass: violations.length === 0, violations, interactions, environment, storage };
  } finally {
    if (rejections) {
      rejections.restore();
    }
    if (dom) {
      dom.window.close();
    }
    runInProgress = false;
  }
}

export { NETWORK_CHANNELS };
