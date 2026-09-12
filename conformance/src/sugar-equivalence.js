/**
 * The declarative sugar equivalence matrix (specification section 9.4).
 *
 * Section 2.7 freezes the sugar at three markers and requires that each be a
 * pure syntax layer over the four entry points: "any behaviour a marker can
 * reach can be written by hand with the four entry points, and the conformance
 * test judges by that". This module is that judgment.
 *
 * For each marker it builds a pair of cards — one written with the marker, one
 * written by hand — runs both against the same scripted host, and compares what
 * the host and the DOM can observe.
 *
 * Two things are compared, not one:
 *
 *   - **equivalence**: the two observations must match;
 *   - **liveness**: each side must actually have done something.
 *
 * Liveness is not decoration. A layer that implements neither the marker nor the
 * entry points produces two identical empty observations, and a matrix that only
 * checked equivalence would call that a pass.
 *
 * Parameterised on the injection layer, because a third-party host brings its
 * own — the reference layer is only the in-repo subject.
 */

import { DEFAULT_CAPABILITY_NAMES, buildCardDocument, openCardWindow } from './card-window.js';

/** Section 2.7, frozen at three by section 0.5. */
export const SUGAR_MARKERS = Object.freeze(['data-invoke', 'data-persist', 'data-result']);

/**
 * How a result becomes text for a `data-result` container.
 *
 * Section 2.7 says the container shows the result "as text" and stops there, so
 * sugar and hand-written code cannot be compared until somebody names the rule.
 * This is the suite's default; a host with its own convention passes it in.
 */
export function defaultTextify(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return '';
  }
}

function ok(result) {
  return { ok: true, result: result || {} };
}

function fail(code, error) {
  return { ok: false, code, error: error || code, result: {} };
}

/**
 * A host that answers by script rather than by policy: it keeps a state object,
 * echoes a fixed binding result, and records what it was asked to do.
 */
function createScriptedHost({ names, state = {}, invokeResult }) {
  let current = { ...state };
  const events = [];

  return {
    events,
    get state() {
      return { ...current };
    },
    respond(message) {
      const { capability, payload } = message;

      if (capability === names.capabilities) {
        return ok({ environment: 'host', capabilities: { state: 'available', invoke: 'available' } });
      }
      if (capability === names.stateGet) {
        const key = payload && typeof payload.key === 'string' ? payload.key : null;
        events.push({ kind: 'state-get', key });
        return key === null ? ok({ state: { ...current } }) : ok({ key, value: current[key] });
      }
      if (capability === names.stateSet) {
        if (payload && payload.state && typeof payload.state === 'object') {
          current = { ...payload.state };
        } else if (payload && typeof payload.key === 'string' && payload.key !== '') {
          current = { ...current, [payload.key]: payload.value };
        } else {
          return fail('CARD_HOST_INVALID_INPUT', 'state.set needs a key and a value, or a whole state object');
        }
        events.push({ kind: 'state-set', state: { ...current } });
        return ok({ state: { ...current } });
      }
      if (capability === names.invoke) {
        const bindingId = payload && typeof payload.bindingId === 'string' ? payload.bindingId : '';
        const input = payload && payload.input !== undefined ? payload.input : null;
        events.push({ kind: 'invoke', bindingId, input });
        return ok(invokeResult({ bindingId, input }));
      }
      return fail('CARD_HOST_CAPABILITY_NOT_SUPPORTED', `no capability named ${JSON.stringify(capability)}`);
    },
  };
}

const invocationsOf = (host) =>
  host.events.filter((event) => event.kind === 'invoke').map(({ bindingId, input }) => ({ bindingId, input }));

/* ---- the three pairs ----------------------------------------------------- */

const INVOKE_FORM = '<form id="entry"><input name="note" value="seed"><button type="submit" ID>Save</button></form>';

function buildCases(textify) {
  return [
    {
      name: 'data-invoke',
      host: { state: {}, invokeResult: () => ({ saved: true }) },
      sugar: INVOKE_FORM.replace('ID', 'data-invoke="save"'),
      manual: [
        INVOKE_FORM.replace('ID', 'id="go"'),
        '<script>',
        'document.getElementById("go").addEventListener("click", function (event) {',
        '  event.preventDefault();',
        '  var data = {};',
        '  new FormData(document.getElementById("entry")).forEach(function (value, key) { data[key] = value; });',
        '  window.card.invoke("save", data);',
        '});',
        '</script>',
      ].join('\n'),
      async run(card, host) {
        card.document.querySelector('button').dispatchEvent(
          new card.window.MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        await card.tick(5);
        return { invocations: invocationsOf(host) };
      },
      liveness: (observation) =>
        observation.invocations.length > 0 ? '' : 'no binding was invoked at all',
    },

    {
      name: 'data-persist',
      host: { state: { note: 'from the host' }, invokeResult: () => ({}) },
      sugar: '<input id="note" data-persist="note">',
      manual: [
        '<input id="note">',
        '<script>',
        '(function () {',
        '  var field = document.getElementById("note");',
        '  function hydrate() {',
        '    window.card.state.get().then(function (envelope) {',
        '      if (!envelope.ok) { return; }',
        '      var state = envelope.result && envelope.result.state;',
        '      if (state && Object.prototype.hasOwnProperty.call(state, "note")) { field.value = state.note; }',
        '    });',
        '  }',
        '  field.addEventListener("change", function () { window.card.state.set("note", field.value); });',
        '  if (document.readyState === "loading") {',
        '    document.addEventListener("DOMContentLoaded", hydrate, { once: true });',
        '  } else { hydrate(); }',
        '})();',
        '</script>',
      ].join('\n'),
      async run(card, host) {
        await card.tick(5);
        const field = card.document.getElementById('note');
        const hydrated = field.value;
        field.value = 'typed by the user';
        field.dispatchEvent(new card.window.Event('change', { bubbles: true }));
        await card.tick(5);
        return { hydrated, state: host.state };
      },
      liveness: (observation) =>
        observation.state.note === 'from the host' ? 'nothing was written back to the host' : '',
    },

    {
      name: 'data-result',
      host: { state: {}, invokeResult: () => ({ temperature: 21, condition: 'clear' }) },
      sugar: '<button data-invoke="calc">Run</button><div id="out" data-result="calc"></div>',
      manual: [
        '<button id="go">Run</button><div id="out"></div>',
        '<script>',
        `var textify = ${textify.toString()};`,
        'document.getElementById("go").addEventListener("click", function () {',
        '  window.card.invoke("calc").then(function (envelope) {',
        '    document.getElementById("out").textContent = textify(envelope.result);',
        '  });',
        '});',
        '</script>',
      ].join('\n'),
      async run(card, host) {
        card.document.querySelector('button').dispatchEvent(
          new card.window.MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        await card.tick(5);
        return { text: card.document.getElementById('out').textContent, invocations: invocationsOf(host) };
      },
      liveness: (observation) => (observation.text === '' ? 'the result container stayed empty' : ''),
    },
  ];
}

/* ---- comparison ---------------------------------------------------------- */

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

const describeValue = (value) => JSON.stringify(stable(value));

/* ---- entry point --------------------------------------------------------- */

/**
 * Run the sugar equivalence matrix against an injection layer.
 *
 * @param {string} runtimeSource the injection layer as source text
 * @param {object} [options]
 * @param {object} [options.capabilityNames] host capability strings, merged over
 *        the suite defaults (the specification does not fix them)
 * @param {Function} [options.textify] how a result becomes text for data-result
 * @returns {Promise<{ pass: boolean, cases: Array }>}
 */
export async function runSugarEquivalence(runtimeSource, options = {}) {
  if (typeof runtimeSource !== 'string' || runtimeSource.trim() === '') {
    throw new TypeError('runSugarEquivalence needs the injection layer as source text');
  }

  const names = { ...DEFAULT_CAPABILITY_NAMES, ...(options.capabilityNames || {}) };
  const textify = options.textify || defaultTextify;
  const cases = [];

  for (const definition of buildCases(textify)) {
    const outcome = { name: definition.name, pass: false, detail: '', sugar: null, manual: null };

    for (const side of ['sugar', 'manual']) {
      const host = createScriptedHost({ names, ...definition.host });
      const card = await openCardWindow({
        documentText: buildCardDocument({
          runtimeSource,
          title: `Sugar equivalence: ${definition.name} (${side})`,
          body: definition[side],
        }),
        respond: (message) => host.respond(message),
      });
      try {
        outcome[side] = await definition.run(card, host);
        const dead = definition.liveness(outcome[side]);
        if (dead) {
          outcome.detail = `${outcome.detail}the ${side} side did nothing observable: ${dead}. `;
        }
        if (card.errors.length > 0) {
          outcome.detail = `${outcome.detail}the ${side} side threw: ${card.errors[0].message.split('\n')[0]}. `;
        }
      } catch (error) {
        outcome.detail = `${outcome.detail}the ${side} side could not be run: ${String(error.message || error)}. `;
      } finally {
        card.close();
      }
    }

    if (describeValue(outcome.sugar) !== describeValue(outcome.manual)) {
      outcome.detail = `${outcome.detail}sugar observed ${describeValue(outcome.sugar)} but hand-written code observed ${describeValue(outcome.manual)}. `;
    }

    outcome.detail = outcome.detail.trim();
    outcome.pass = outcome.detail === '';
    cases.push(outcome);
  }

  return { pass: cases.every((outcome) => outcome.pass), cases };
}
