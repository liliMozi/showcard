/**
 * The card-side injection layer, as source text.
 *
 * A host injects this string as an inline `<script>` at the top of the card
 * document; an exported file carries the same text as its embedded shim. It is a
 * string rather than a module because it has to run inside the card document,
 * which has no module loader and no build step.
 *
 * Implements: section 2.2 (global entry point), 2.3 (five entry points),
 * 2.4 (envelope), 2.5 (state semantics), 2.6 (error codes), 2.7 (declarative
 * sugar), 2.8 (transport), 3.1 (capabilities shape), 3.4 (standalone fallback),
 * 6.2 (shim yields to an already installed runtime).
 */

import {
  CARD_ERROR_CODES,
  CARD_HOST_EXTENSION_CODES,
  CAPABILITIES,
  CARD_REQUEST_TYPE,
  CARD_RESPONSE_TYPE,
  HOST_REQUEST_TIMEOUT_MS,
  STATE_BUDGET_BYTES,
  STATE_KEY_PREFIX,
} from './codes.js';

const RUNTIME_CONSTANTS = JSON.stringify(
  {
    CODES: { ...CARD_ERROR_CODES, ...CARD_HOST_EXTENSION_CODES },
    CAP: CAPABILITIES,
    REQUEST_TYPE: CARD_REQUEST_TYPE,
    RESPONSE_TYPE: CARD_RESPONSE_TYPE,
    TIMEOUT_MS: HOST_REQUEST_TIMEOUT_MS,
    STATE_BUDGET_BYTES,
    STATE_KEY_PREFIX,
  },
  null,
  2,
);

export const CARD_RUNTIME_SOURCE = `/* showcard reference injection layer */
(function () {
  'use strict';

  // Section 6.2 / 2.2: first definition wins. A host injects before the file's
  // own shim, so the shim finds window.card already there and steps aside.
  if (window.card) { return; }

  var K = ${RUNTIME_CONSTANTS};
  var CODES = K.CODES;
  var CAP = K.CAP;
  var doc = window.document;
  var requestCounter = 0;

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function describe(error) {
    if (!error) { return 'unknown error'; }
    if (typeof error === 'string') { return error; }
    return String(error.message || error);
  }

  function ok(result) {
    return { ok: true, result: isPlainObject(result) ? result : {} };
  }

  function fail(code, error) {
    return { ok: false, code: code, error: error || code, result: {} };
  }

  // Section 2.4: an answer is only an envelope if it says whether it succeeded,
  // and a failure has to name its code. Anything else is an invalid response.
  function normalizeEnvelope(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    if (raw.ok === true) {
      return { ok: true, result: isPlainObject(raw.result) ? raw.result : {} };
    }
    if (raw.ok === false) {
      if (typeof raw.code !== 'string' || raw.code === '') { return null; }
      return {
        ok: false,
        code: raw.code,
        error: typeof raw.error === 'string' ? raw.error : raw.code,
        result: isPlainObject(raw.result) ? raw.result : {}
      };
    }
    return null;
  }

  function byteLength(text) {
    var Encoder = window.TextEncoder || (typeof TextEncoder === 'function' ? TextEncoder : null);
    if (Encoder) { return new Encoder().encode(text).length; }
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) { bytes += 1; }
      else if (code < 0x800) { bytes += 2; }
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
      else { bytes += 3; }
    }
    return bytes;
  }

  // Section 1.3: identity is never burned into the package; a document carries
  // no id of its own to key a fallback store by. Section 2.5 derives the key
  // from the document's own address instead — location.pathname or an
  // equivalent stable identifier — which is exactly how a plain web page's
  // storage is already partitioned: two different paths get two different
  // buckets with no id field required to make that true.
  function readLocationKey() {
    try {
      var path = window.location && window.location.pathname;
      return path ? String(path) : '';
    } catch (error) {
      return '';
    }
  }

  function getStorage() {
    try {
      return window.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function storageKey() {
    var path = readLocationKey();
    return path ? K.STATE_KEY_PREFIX + path : '';
  }

  function readLocalState() {
    var storage = getStorage();
    if (!storage) {
      return { error: fail(CODES.STORAGE_UNAVAILABLE, 'local storage is not available') };
    }
    var key = storageKey();
    if (!key) {
      return {
        error: fail(
          CODES.STORAGE_UNAVAILABLE,
          'no location path is available to derive a fallback storage key from'
        )
      };
    }
    var raw;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return { error: fail(CODES.STORAGE_UNAVAILABLE, 'local storage read failed: ' + describe(error)) };
    }
    if (raw === null || raw === undefined || raw === '') { return { state: {} }; }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // An unreadable fallback payload reads as empty state; there is no code in
      // section 2.6 for corrupt local storage, and refusing to open would break
      // the section 9.2 harmlessness guarantee.
      return { state: {} };
    }
    return { state: isPlainObject(parsed) ? parsed : {} };
  }

  function writeLocalState(nextState) {
    var storage = getStorage();
    if (!storage) {
      return fail(CODES.STORAGE_UNAVAILABLE, 'local storage is not available');
    }
    var key = storageKey();
    if (!key) {
      return fail(
        CODES.STORAGE_UNAVAILABLE,
        'no location path is available to derive a fallback storage key from'
      );
    }
    var serialized;
    try {
      serialized = JSON.stringify(nextState);
    } catch (error) {
      return fail(CODES.STORAGE_FAILED, 'the state could not be serialized: ' + describe(error));
    }
    // Section 2.5: refuse, never truncate.
    if (byteLength(serialized) > K.STATE_BUDGET_BYTES) {
      return fail(
        CODES.STATE_TOO_LARGE,
        'the serialized state exceeds the ' + K.STATE_BUDGET_BYTES + ' byte budget'
      );
    }
    try {
      storage.setItem(key, serialized);
    } catch (error) {
      return fail(CODES.STORAGE_FAILED, 'local storage write failed: ' + describe(error));
    }
    return ok({ state: nextState });
  }

  function standaloneStateGet(payload) {
    var read = readLocalState();
    if (read.error) { return read.error; }
    var key = payload && typeof payload.key === 'string' ? payload.key : null;
    if (key === null) { return ok({ state: read.state }); }
    return ok({ key: key, value: read.state[key] });
  }

  function standaloneStateSet(payload) {
    if (!payload || typeof payload !== 'object') {
      return fail(CODES.INVALID_INPUT, 'state.set needs a key and a value, or a whole state object');
    }
    if (isPlainObject(payload.state)) {
      return writeLocalState(payload.state);
    }
    if (typeof payload.key === 'string' && payload.key !== '') {
      var read = readLocalState();
      if (read.error) { return read.error; }
      var next = {};
      for (var name in read.state) {
        if (Object.prototype.hasOwnProperty.call(read.state, name)) { next[name] = read.state[name]; }
      }
      next[payload.key] = payload.value;
      return writeLocalState(next);
    }
    return fail(CODES.INVALID_INPUT, 'state.set needs a key and a value, or a whole state object');
  }

  // Section 3.1 / 3.4: tell the card the truth about where it is.
  function standaloneCapabilities() {
    return ok({
      environment: 'standalone',
      capabilities: { state: 'local_fallback', invoke: 'requires_host', emit: 'requires_host' }
    });
  }

  function requestStandalone(capability, payload) {
    if (capability === CAP.CAPABILITIES) { return standaloneCapabilities(); }
    if (capability === CAP.STATE_GET) { return standaloneStateGet(payload); }
    if (capability === CAP.STATE_SET) { return standaloneStateSet(payload); }
    // Section 2.3 / 3.4: emit is a named convenience, not a tool. Standalone
    // it is unsupported; the default below would otherwise call it a missing
    // tool channel.
    if (capability === CAP.EMIT) {
      return fail(CODES.CAPABILITY_NOT_SUPPORTED, 'this card is open without a host, so emit is not available');
    }
    // Section 3.4: outside a host there is no tool channel at all.
    return fail(CODES.TOOL_UNAVAILABLE, 'this card is open without a host, so there is no tool channel');
  }

  // Section 2.8: postMessage, card: prefix, paired by requestId.
  function requestFromHost(capability, payload) {
    return new Promise(function (resolve) {
      requestCounter += 1;
      var requestId = 'card-' + requestCounter + '-' + Math.random().toString(36).slice(2, 10);
      var settled = false;
      var timer = null;

      function settle(envelope) {
        if (settled) { return; }
        settled = true;
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
        window.removeEventListener('message', onMessage);
        resolve(envelope);
      }

      function onMessage(event) {
        var data = event ? event.data : null;
        if (!data || typeof data !== 'object') { return; }
        if (data.type !== K.RESPONSE_TYPE) { return; }
        if (data.requestId !== requestId) { return; }
        var envelope = normalizeEnvelope(data);
        settle(envelope || fail(CODES.INVALID_RESPONSE, 'the host answer is not a valid envelope'));
      }

      window.addEventListener('message', onMessage);

      try {
        window.parent.postMessage({
          type: K.REQUEST_TYPE,
          requestId: requestId,
          capability: capability,
          payload: payload === undefined ? null : payload
        }, '*');
      } catch (error) {
        settle(fail(CODES.POST_FAILED, 'the request could not be delivered: ' + describe(error)));
        return;
      }

      timer = window.setTimeout(function () {
        settle(fail(CODES.TIMEOUT, 'the host did not answer within ' + K.TIMEOUT_MS + ' ms'));
      }, K.TIMEOUT_MS);
    });
  }

  // Section 2.3: one dispatch point, five named conveniences on top of it.
  function request(capability, payload) {
    if (typeof capability !== 'string' || capability === '') {
      return Promise.resolve(fail(CODES.CAPABILITY_REQUIRED, 'a capability name is required'));
    }
    if (window.parent !== window) {
      return requestFromHost(capability, payload);
    }
    return Promise.resolve(requestStandalone(capability, payload));
  }

  // Section 2.3: userGesture is collected here. Authors cannot fill it;
  // a host that routes emit must ignore a value the author wrote.
  function readUserGesture() {
    try {
      if (window.navigator && window.navigator.userActivation && typeof window.navigator.userActivation.isActive === 'boolean') {
        return window.navigator.userActivation.isActive === true;
      }
    } catch (err) {}
    try {
      return !!(window.event && window.event.isTrusted);
    } catch (err) {}
    return false;
  }

  var card = {
    state: {
      get: function (key) {
        if (key === undefined || key === null) { return request(CAP.STATE_GET, { key: null }); }
        if (typeof key !== 'string' || key === '') {
          return Promise.resolve(fail(CODES.INVALID_INPUT, 'state.get takes a string key, or nothing at all'));
        }
        return request(CAP.STATE_GET, { key: key });
      },
      set: function (keyOrState, value) {
        if (typeof keyOrState === 'string' && keyOrState !== '') {
          return request(CAP.STATE_SET, { key: keyOrState, value: value });
        }
        if (isPlainObject(keyOrState)) {
          return request(CAP.STATE_SET, { state: keyOrState });
        }
        return Promise.resolve(
          fail(CODES.INVALID_INPUT, 'state.set takes (key, value) or a whole state object')
        );
      }
    },
    invoke: function (bindingId, input) {
      if (typeof bindingId !== 'string' || bindingId === '') {
        return Promise.resolve(fail(CODES.INVALID_INPUT, 'invoke takes a binding id declared in the manifest'));
      }
      return request(CAP.INVOKE, { bindingId: bindingId, input: input === undefined ? null : input });
    },
    emit: function (name, payload, to) {
      if (typeof name !== 'string' || name === '') {
        return Promise.resolve(fail(CODES.INVALID_INPUT, 'emit takes an event name'));
      }
      var wire = {
        name: name,
        payload: payload === undefined ? null : payload,
        userGesture: readUserGesture()
      };
      if (typeof to === 'string' && to !== '') wire.to = to;
      return request(CAP.EMIT, wire);
    },
    request: request,
    capabilities: function () {
      return request(CAP.CAPABILITIES, null);
    }
  };

  window.card = card;

  /* ---- Section 2.7: the three declarative markers ------------------------
     Every marker below goes through the public window.card surface, so any
     sugar behaviour has a hand-written equivalent (section 9.4).           */

  var NATIVELY_ACTIVATED = { BUTTON: true, A: true, INPUT: true, SELECT: true, TEXTAREA: true };
  var FORM_CONTROLS = { INPUT: true, TEXTAREA: true, SELECT: true };

  function attributeSelector(name, value) {
    return '[' + name + '="' + String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"]';
  }

  function textify(value) {
    if (value === null || value === undefined) { return ''; }
    if (typeof value === 'string') { return value; }
    if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
    if (isPlainObject(value) && Object.keys(value).length === 0) { return ''; }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return '';
    }
  }

  function closestMatch(node, selector) {
    var element = node && node.nodeType === 3 ? node.parentNode : node;
    if (!element || typeof element.closest !== 'function') { return null; }
    return element.closest(selector);
  }

  function serializeForm(form) {
    var data = {};
    var FormDataCtor = window.FormData || (typeof FormData === 'function' ? FormData : null);
    if (!form || !FormDataCtor) { return data; }
    var entries = new FormDataCtor(form).entries();
    var step = entries.next();
    while (!step.done) {
      var name = step.value[0];
      var value = step.value[1];
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        if (Array.isArray(data[name])) { data[name].push(value); }
        else { data[name] = [data[name], value]; }
      } else {
        data[name] = value;
      }
      step = entries.next();
    }
    return data;
  }

  // Section 2.7: a container shows the latest result of its binding, as text.
  // textContent only: the injection layer never writes markup into the card.
  function renderResult(bindingId, envelope) {
    if (!doc || typeof doc.querySelectorAll !== 'function') { return; }
    var targets = doc.querySelectorAll(attributeSelector('data-result', bindingId));
    var text = textify(envelope && envelope.result);
    for (var i = 0; i < targets.length; i++) {
      targets[i].textContent = text;
    }
  }

  function activateInvoker(element) {
    var bindingId = element.getAttribute('data-invoke');
    if (!bindingId) { return; }
    var form = typeof element.closest === 'function' ? element.closest('form') : null;
    var input = form ? serializeForm(form) : undefined;
    window.card.invoke(bindingId, input).then(function (envelope) {
      renderResult(bindingId, envelope);
    });
  }

  function readControl(element) {
    if (element.type === 'checkbox') { return !!element.checked; }
    if (element.type === 'radio') { return element.checked ? element.value : undefined; }
    return element.value;
  }

  function writeControl(element, value) {
    if (element.type === 'checkbox') { element.checked = !!value; return; }
    if (element.type === 'radio') { element.checked = element.value === value; return; }
    element.value = value === null || value === undefined ? '' : String(value);
  }

  function hydratePersistedControls() {
    if (!doc || typeof doc.querySelectorAll !== 'function') { return; }
    var controls = doc.querySelectorAll('[data-persist]');
    if (!controls.length) { return; }
    window.card.state.get().then(function (envelope) {
      if (!envelope.ok) { return; }
      var state = isPlainObject(envelope.result.state) ? envelope.result.state : {};
      for (var i = 0; i < controls.length; i++) {
        var control = controls[i];
        if (!FORM_CONTROLS[control.tagName]) { continue; }
        var key = control.getAttribute('data-persist');
        if (key && Object.prototype.hasOwnProperty.call(state, key)) {
          writeControl(control, state[key]);
        }
      }
    });
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('click', function (event) {
      var element = closestMatch(event.target, '[data-invoke]');
      if (!element) { return; }
      // Section 7.1: a card never submits a form outbound; the binding is the
      // only channel, so the native submission is cancelled here.
      if (typeof element.closest === 'function' && element.closest('form')) {
        event.preventDefault();
      }
      activateInvoker(element);
    }, true);

    doc.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') { return; }
      var element = closestMatch(event.target, '[data-invoke]');
      if (!element) { return; }
      // Buttons and links already turn Enter into a click; handling it again
      // here would fire the binding twice.
      if (NATIVELY_ACTIVATED[element.tagName]) { return; }
      event.preventDefault();
      activateInvoker(element);
    }, true);

    doc.addEventListener('change', function (event) {
      var element = event.target;
      if (!element || typeof element.getAttribute !== 'function') { return; }
      if (!FORM_CONTROLS[element.tagName]) { return; }
      var key = element.getAttribute('data-persist');
      if (!key) { return; }
      var value = readControl(element);
      if (value === undefined) { return; }
      window.card.state.set(key, value);
    }, true);

    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', hydratePersistedControls, { once: true });
    } else {
      hydratePersistedControls();
    }
  }
})();
`;
