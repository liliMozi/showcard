import { describe, expect, it } from 'vitest';

import { CARD_RUNTIME_SOURCE } from '../../reference/src/runtime-source.js';
import { SUGAR_MARKERS, runSugarEquivalence } from '../src/sugar-equivalence.js';

describe('runSugarEquivalence against the reference injection layer', () => {
  it('covers exactly the three frozen markers (section 2.7 / 0.5)', () => {
    expect(SUGAR_MARKERS).toEqual(['data-invoke', 'data-persist', 'data-result']);
  });

  it('finds sugar and hand-written code equivalent for every marker', async () => {
    const result = await runSugarEquivalence(CARD_RUNTIME_SOURCE);
    for (const outcome of result.cases) {
      expect(outcome.detail, outcome.name).toBe('');
      expect(outcome.pass, outcome.name).toBe(true);
    }
    expect(result.pass).toBe(true);
    expect(result.cases.map((outcome) => outcome.name)).toEqual(SUGAR_MARKERS);
  });

  it('actually exercised each path: both sides produced an observation', async () => {
    const result = await runSugarEquivalence(CARD_RUNTIME_SOURCE);
    const byName = Object.fromEntries(result.cases.map((outcome) => [outcome.name, outcome]));

    expect(byName['data-invoke'].sugar.invocations).toEqual([{ bindingId: 'save', input: { note: 'seed' } }]);
    expect(byName['data-persist'].sugar.hydrated).toBe('from the host');
    expect(byName['data-persist'].sugar.state).toEqual({ note: 'typed by the user' });
    expect(byName['data-result'].sugar.text).not.toBe('');
  });
});

describe('the matrix proves itself: a runtime whose sugar disagrees is caught', () => {
  /** The reference layer with one sugar path bent away from its hand-written twin. */
  function bendSugar(from, to) {
    const bent = CARD_RUNTIME_SOURCE.replace(from, to);
    expect(bent, `the patch target ${JSON.stringify(from)} must still exist`).not.toBe(CARD_RUNTIME_SOURCE);
    return bent;
  }

  it('catches a data-persist marker that writes under the wrong key', async () => {
    const result = await runSugarEquivalence(
      bendSugar('window.card.state.set(key, value);', "window.card.state.set(key + '-oops', value);"),
    );
    const persist = result.cases.find((outcome) => outcome.name === 'data-persist');
    expect(persist.pass).toBe(false);
    expect(persist.detail).not.toBe('');
    expect(result.pass).toBe(false);
  });

  it('catches a data-invoke marker that drops the form payload', async () => {
    const result = await runSugarEquivalence(
      bendSugar('var input = form ? serializeForm(form) : undefined;', 'var input = undefined;'),
    );
    const invoke = result.cases.find((outcome) => outcome.name === 'data-invoke');
    expect(invoke.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('catches a data-result marker that renders nothing', async () => {
    const result = await runSugarEquivalence(
      bendSugar('targets[i].textContent = text;', "targets[i].textContent = '';"),
    );
    const rendered = result.cases.find((outcome) => outcome.name === 'data-result');
    expect(rendered.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('reports a layer with no sugar at all as non-equivalent rather than throwing', async () => {
    const bare = 'window.card = { state: { get: function(){ return Promise.resolve({ok:true,result:{state:{}}}); }, set: function(){ return Promise.resolve({ok:true,result:{}}); } }, invoke: function(){ return Promise.resolve({ok:true,result:{}}); }, request: function(){ return Promise.resolve({ok:true,result:{}}); }, capabilities: function(){ return Promise.resolve({ok:true,result:{}}); } };';
    const result = await runSugarEquivalence(bare);
    expect(result.pass).toBe(false);
    expect(result.cases.every((outcome) => outcome.pass === false)).toBe(true);
  });
});

describe('runSugarEquivalence is parameterised for a third-party host', () => {
  it('accepts the host capability names it should speak', async () => {
    // The specification never names the capability strings, so a host may use
    // its own. Renaming them on both sides must not change the verdict.
    const renamed = CARD_RUNTIME_SOURCE.replace(
      /"STATE_GET": "state\.get"/,
      '"STATE_GET": "host/read-state"',
    );
    expect(renamed).not.toBe(CARD_RUNTIME_SOURCE);
    const result = await runSugarEquivalence(renamed, {
      capabilityNames: { stateGet: 'host/read-state' },
    });
    expect(result.pass).toBe(true);
  });

  it('rejects an unusable runtime source instead of reporting a pass', async () => {
    await expect(runSugarEquivalence(null)).rejects.toThrow(TypeError);
    await expect(runSugarEquivalence('')).rejects.toThrow(TypeError);
  });
});
