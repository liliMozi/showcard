/**
 * The host side of the reference shim: a minimal L1 host (spec section 9.1).
 *
 * It renders a card in a sandboxed iframe, answers the card's socket requests
 * with envelopes, and keeps each card's state under that card's id.
 *
 * Implements: section 2.3-2.8 (dispatch, envelopes, state budget, transport),
 * 3.1 (capability shape), 6.7 (contract version), 7.1 (sandbox), 7.4 (the socket
 * is the only channel), 9.6 (every failure path answers an envelope).
 *
 * Out of scope by design: L2 gateway policy (which hosts a binding may reach,
 * transport security, validation, and per-(kind, subject) authorization query
 * and memory) and L3 persistence gradient (pin/Fork semantics, resident
 * entity identity, authorization-lifecycle management). The `executeBinding`
 * hook is where an embedder attaches its own gateway.
 */

import {
  CARD_ERROR_CODES,
  CARD_HOST_EXTENSION_CODES,
  CAPABILITIES,
  CARD_REQUEST_TYPE,
  CARD_RESPONSE_TYPE,
  DEFAULT_SPEC_VERSION,
  STATE_BUDGET_BYTES,
  STATE_KEY_PREFIX,
  SUPPORTED_SPEC_VERSIONS,
} from './codes.js';
import { injectRuntimeIntoDocument, isFullDocument } from './wrap.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(error) {
  if (!error) {
    return 'unknown error';
  }
  return typeof error === 'string' ? error : String(error.message || error);
}

function ok(result) {
  return { ok: true, result: isPlainObject(result) ? result : {} };
}

function fail(code, error) {
  return { ok: false, code, error: error || code, result: {} };
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function cloneState(state) {
  return isPlainObject(state) ? { ...state } : {};
}

/* ---- state stores ------------------------------------------------------- */

/**
 * State store interface: `{ get(cardId), set(cardId, state) }`, whole object at
 * a time, keyed by card id (section 2.5). Either method may return a promise.
 */
export function createMemoryStateStore() {
  const byCard = new Map();
  return {
    get(cardId) {
      return cloneState(byCard.get(cardId));
    },
    set(cardId, state) {
      byCard.set(cardId, cloneState(state));
    },
  };
}

/** The same interface backed by a Storage object, so state survives a restart. */
export function createLocalStorageStateStore(storage = globalThis.localStorage) {
  if (!storage) {
    throw new TypeError('createLocalStorageStateStore needs a storage object');
  }
  const keyFor = (cardId) => STATE_KEY_PREFIX + cardId;
  return {
    get(cardId) {
      const raw = storage.getItem(keyFor(cardId));
      if (!raw) {
        return {};
      }
      try {
        return cloneState(JSON.parse(raw));
      } catch (error) {
        return {};
      }
    },
    set(cardId, state) {
      storage.setItem(keyFor(cardId), JSON.stringify(cloneState(state)));
    },
  };
}

/* ---- manifest ----------------------------------------------------------- */

/**
 * Read the static declaration block out of a card document (section 1.4).
 *
 * Nothing here is a reason to refuse the card: a missing manifest means no
 * bindings, and a malformed one is reported but still renders. Static validity
 * belongs to the conformance suite, not to the runtime.
 */
export function readCardManifest(documentSource) {
  const empty = {
    manifest: null,
    bindings: {},
    specVersion: DEFAULT_SPEC_VERSION,
    specSupported: true,
    parseError: null,
  };

  const parsed = new DOMParser().parseFromString(String(documentSource ?? ''), 'text/html');
  const block = parsed.querySelector('script[type="application/json"][data-card-manifest]');
  if (!block) {
    return empty;
  }

  let manifest;
  try {
    manifest = JSON.parse(block.textContent || '');
  } catch (error) {
    return { ...empty, parseError: describe(error) };
  }
  if (!isPlainObject(manifest)) {
    return { ...empty, parseError: 'the manifest is not a JSON object' };
  }

  // Section 1.4: a missing `spec` reads as 1.0, and unknown fields are ignored.
  const specVersion =
    typeof manifest.spec === 'string' && manifest.spec !== '' ? manifest.spec : DEFAULT_SPEC_VERSION;

  return {
    manifest,
    bindings: isPlainObject(manifest.toolBindings) ? manifest.toolBindings : {},
    specVersion,
    specSupported: SUPPORTED_SPEC_VERSIONS.includes(specVersion),
    parseError: null,
  };
}

/* ---- capability dispatch ------------------------------------------------ */

/**
 * Build the single dispatch point behind every card request (section 2.3).
 * It always resolves an envelope: no throw, no rejection, no silence.
 */
export function createCapabilityDispatcher({
  cardId,
  stateStore,
  executeBinding = null,
  bindings = {},
  specSupported = true,
}) {
  const store = stateStore || createMemoryStateStore();

  async function readState() {
    return cloneState(await store.get(cardId));
  }

  async function writeState(nextState) {
    let serialized;
    try {
      serialized = JSON.stringify(nextState);
    } catch (error) {
      return fail(CARD_HOST_EXTENSION_CODES.INVALID_INPUT, `the state cannot be serialized: ${describe(error)}`);
    }
    // Section 2.5: over budget is a refusal, never a quiet truncation.
    if (byteLength(serialized) > STATE_BUDGET_BYTES) {
      return fail(
        CARD_ERROR_CODES.STATE_TOO_LARGE,
        `the serialized state exceeds the ${STATE_BUDGET_BYTES} byte budget`,
      );
    }
    try {
      await store.set(cardId, nextState);
    } catch (error) {
      return fail(CARD_ERROR_CODES.STORAGE_FAILED, `the state could not be stored: ${describe(error)}`);
    }
    return ok({ state: nextState });
  }

  async function stateGet(payload) {
    const state = await readState();
    const key = payload && typeof payload.key === 'string' ? payload.key : null;
    if (key === null) {
      return ok({ state });
    }
    return ok({ key, value: state[key] });
  }

  async function stateSet(payload) {
    if (isPlainObject(payload) && isPlainObject(payload.state)) {
      return writeState(cloneState(payload.state));
    }
    if (isPlainObject(payload) && typeof payload.key === 'string' && payload.key !== '') {
      const state = await readState();
      state[payload.key] = payload.value;
      return writeState(state);
    }
    return fail(
      CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
      'state.set needs a key and a value, or a whole state object',
    );
  }

  async function invoke(payload) {
    const bindingId = payload && typeof payload.bindingId === 'string' ? payload.bindingId : '';
    const binding = Object.prototype.hasOwnProperty.call(bindings, bindingId) ? bindings[bindingId] : null;
    // Section 1.4 / 7.4: nothing outside the declaration has a channel.
    if (!binding) {
      return fail(
        CARD_ERROR_CODES.TOOL_UNAVAILABLE,
        `this card declares no binding named ${JSON.stringify(bindingId)}`,
      );
    }
    if (typeof executeBinding !== 'function') {
      return fail(
        CARD_ERROR_CODES.TOOL_UNAVAILABLE,
        'this host has no tool channel wired; bindings cannot be executed here',
      );
    }
    let result;
    try {
      result = await executeBinding({
        cardId,
        bindingId,
        binding,
        input: payload && payload.input !== undefined ? payload.input : null,
      });
    } catch (error) {
      // Section 2.6 has no code for "the binding ran and failed", so this is a
      // host extension code. Cards treat unknown codes as a plain failure.
      return fail(CARD_HOST_EXTENSION_CODES.TOOL_FAILED, `the binding failed: ${describe(error)}`);
    }
    if (result === undefined || result === null) {
      return ok({});
    }
    return ok(isPlainObject(result) ? result : { value: result });
  }

  const EMIT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  const EMIT_PAYLOAD_BUDGET_BYTES = 8192;

  function emit(payload) {
    const name = payload && typeof payload.name === 'string' ? payload.name : '';
    if (!EMIT_NAME_PATTERN.test(name)) {
      return fail(
        CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
        'emit takes a name matching ^[a-z0-9][a-z0-9._-]{0,63}$',
      );
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'payload')) {
      let serialized;
      try {
        serialized = JSON.stringify(payload.payload);
      } catch (error) {
        return fail(
          CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
          `the emit payload cannot be serialized: ${describe(error)}`,
        );
      }
      if (serialized === undefined) {
        return fail(CARD_HOST_EXTENSION_CODES.INVALID_INPUT, 'the emit payload must be JSON-serializable');
      }
      if (byteLength(serialized) > EMIT_PAYLOAD_BUDGET_BYTES) {
        return fail(
          CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
          `the serialized emit payload exceeds the ${EMIT_PAYLOAD_BUDGET_BYTES} byte budget`,
        );
      }
    }
    const to = payload && typeof payload.to === 'string' ? payload.to : undefined;
    return ok(to === undefined ? { delivered: true } : { delivered: true, to });
  }

  function capabilities() {
    return ok({
      environment: 'host',
      capabilities: {
        state: 'available',
        invoke: typeof executeBinding === 'function' ? 'available' : 'requires_host',
        emit: 'available',
      },
    });
  }

  return async function dispatch(capability, payload) {
    if (typeof capability !== 'string' || capability === '') {
      return fail(CARD_ERROR_CODES.CAPABILITY_REQUIRED, 'a capability name is required');
    }
    // Section 6.7: a card from a newer contract still renders; only the socket
    // says it cannot speak that version.
    if (!specSupported) {
      return fail(
        CARD_ERROR_CODES.CONTRACT_UNSUPPORTED,
        'this card declares a socket contract this host does not implement',
      );
    }
    try {
      if (capability === CAPABILITIES.CAPABILITIES) {
        return capabilities();
      }
      if (capability === CAPABILITIES.STATE_GET) {
        return await stateGet(payload);
      }
      if (capability === CAPABILITIES.STATE_SET) {
        return await stateSet(payload);
      }
      if (capability === CAPABILITIES.INVOKE) {
        return await invoke(payload);
      }
      if (capability === CAPABILITIES.EMIT) {
        return emit(payload);
      }
    } catch (error) {
      // A bug in a store or a hook must still reach the card as an envelope.
      return fail(CARD_HOST_EXTENSION_CODES.TOOL_FAILED, `the host failed to answer: ${describe(error)}`);
    }
    return fail(
      CARD_ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      `this host does not support the capability ${JSON.stringify(capability)}`,
    );
  };
}

/* ---- mounting ----------------------------------------------------------- */

/**
 * The shared machinery behind `mountCard` and `mountPackage`: read the
 * manifest out of the raw entry document, wire the socket dispatcher, build
 * the sandboxed iframe, and answer its requests. The two mount functions
 * differ only in what they put in the iframe — `srcdoc` for a single
 * document (section 6.2's degenerate package), `src` for a package a host is
 * genuinely serving (section 1.1) — so that is the one parameter this
 * function takes that they do not share.
 */
function mountInternal({
  container,
  entrySource,
  iframeAttribute,
  cardId,
  stateStore,
  executeBinding = null,
}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('mountCard needs a container element');
  }
  if (typeof cardId !== 'string' || cardId.trim() === '') {
    throw new TypeError('mountCard needs a cardId: state and permissions are keyed by card id');
  }
  if (!isFullDocument(entrySource)) {
    throw new TypeError(
      "mountCard needs a complete card document — <!DOCTYPE html>, <html>, <head> and <body> — never a fragment; a card's entry is always a whole document (section 1.1)",
    );
  }

  const { bindings, specSupported, specVersion, parseError } = readCardManifest(entrySource);

  const dispatch = createCapabilityDispatcher({
    cardId,
    stateStore,
    executeBinding,
    bindings,
    specSupported,
  });

  const ownerDocument = container.ownerDocument;
  const view = ownerDocument.defaultView;

  const iframe = ownerDocument.createElement('iframe');
  // Section 7.1: an isolated origin. allow-scripts without allow-same-origin,
  // so the card can run its own code and reach nothing of the host's.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute(iframeAttribute.name, iframeAttribute.value);
  container.appendChild(iframe);

  function onMessage(event) {
    if (event.source !== iframe.contentWindow) {
      return;
    }
    const data = event.data;
    if (!isPlainObject(data) || data.type !== CARD_REQUEST_TYPE) {
      return;
    }
    const { requestId, capability, payload } = data;
    dispatch(capability, payload).then((envelope) => {
      const target = iframe.contentWindow;
      if (!target) {
        return;
      }
      // Section 2.8: the answer echoes the requestId it belongs to.
      target.postMessage({ type: CARD_RESPONSE_TYPE, requestId, ...envelope }, '*');
    });
  }

  view.addEventListener('message', onMessage);

  return {
    iframe,
    specVersion,
    specSupported,
    manifestParseError: parseError,
    dispatch,
    unmount() {
      view.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}

/**
 * Render a degenerate package — a single complete document, section 6.2 —
 * and open its socket. The document is put in the iframe's `srcdoc`
 * (injected first, section 2.2), so there is no serving to do: this is the
 * mount a host reaches for when the card has no `assets/` of its own.
 *
 * @param {object} options
 * @param {Element} options.container   where the card iframe goes
 * @param {string}  options.cardSource  a whole entry document (section 1.1)
 * @param {string}  options.cardId      the card's identity in this host
 *        (section 1.3: assigned and held by the host, never written into the
 *        document)
 * @param {object} [options.stateStore] `{ get(cardId), set(cardId, state) }`
 * @param {Function} [options.executeBinding] runs a declared binding; this is
 *        where an embedder attaches its own gateway policy
 * @returns {{ iframe: HTMLIFrameElement, unmount: Function, dispatch: Function }}
 */
export function mountCard({ container, cardSource, cardId, stateStore, executeBinding = null } = {}) {
  const entrySource = String(cardSource ?? '');
  return mountInternal({
    container,
    entrySource,
    iframeAttribute: { name: 'srcdoc', value: injectRuntimeIntoDocument(entrySource) },
    cardId,
    stateStore,
    executeBinding,
  });
}

/**
 * Render a card *package* a host is genuinely serving — section 1.1's
 * ticketed-path model — and open its socket. Unlike `mountCard`, the iframe
 * is pointed at a real URL (`src`) rather than given the document inline, so
 * the package's own relative references (`assets/style.css`, and so on)
 * resolve the ordinary way a browser resolves them: against the document's
 * own address.
 *
 * This function does not serve anything itself — that is `serve.js`'s job,
 * on whatever backend a real host runs. `src` is assumed to already be the
 * package's served, already-injected entry URL; `entrySource` is the raw,
 * *uninjected* entry text, supplied separately because the manifest has to be
 * read before the iframe is even created (section 2.3's dispatcher needs its
 * bindings up front), and reading it back over the network would be a second,
 * needless round trip for a caller who has the bytes already.
 *
 * @param {object} options
 * @param {Element} options.container    where the card iframe goes
 * @param {string}  options.entrySource  the package's raw `index.html` text,
 *        for reading the manifest — not injected; injection already happened
 *        server-side in whatever served `src`
 * @param {string}  options.src          the served, already-injected entry
 *        URL the iframe loads
 * @param {string}  options.cardId       the card's identity in this host
 * @param {object} [options.stateStore]
 * @param {Function} [options.executeBinding]
 * @returns {{ iframe: HTMLIFrameElement, unmount: Function, dispatch: Function }}
 */
export function mountPackage({ container, entrySource, src, cardId, stateStore, executeBinding = null } = {}) {
  if (typeof src !== 'string' || src.trim() === '') {
    throw new TypeError('mountPackage needs src: the served URL of the package entry');
  }
  return mountInternal({
    container,
    entrySource: String(entrySource ?? ''),
    iframeAttribute: { name: 'src', value: src },
    cardId,
    stateStore,
    executeBinding,
  });
}
