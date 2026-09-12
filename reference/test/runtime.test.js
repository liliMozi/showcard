import { describe, it, expect, vi, afterEach } from 'vitest';

import { createCardEnvironment, createStorageStub, flush } from './helpers/card-environment.js';
import {
  CARD_ERROR_CODES,
  CARD_HOST_EXTENSION_CODES,
  CARD_REQUEST_TYPE,
  CARD_RESPONSE_TYPE,
  STATE_KEY_PREFIX,
} from '../src/codes.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('injection layer: installation', () => {
  it('yields to a runtime that is already installed (spec 6.2)', () => {
    const occupied = createCardEnvironment();
    const incumbent = { mine: true };
    occupied.win.card = incumbent;
    occupied.install();

    const vacant = createCardEnvironment();
    vacant.install();

    // The guard has to be a guard, not an absence of code: an empty window gets
    // a real runtime, an occupied one keeps what it had.
    expect(typeof vacant.win.card.invoke).toBe('function');
    expect(occupied.win.card).toBe(incumbent);
  });

  it('installs the five entry points on window.card (spec 2.2 / 2.3)', () => {
    const card = createCardEnvironment().install();

    expect(typeof card.state.get).toBe('function');
    expect(typeof card.state.set).toBe('function');
    expect(typeof card.invoke).toBe('function');
    expect(typeof card.emit).toBe('function');
    expect(typeof card.request).toBe('function');
    expect(typeof card.capabilities).toBe('function');
  });
});

describe('injection layer: envelopes never reject (spec 2.4 / 9.6)', () => {
  it('answers a missing capability name with CARD_HOST_CAPABILITY_REQUIRED', async () => {
    const card = createCardEnvironment().install();

    await expect(card.request()).resolves.toEqual({
      ok: false,
      code: CARD_ERROR_CODES.CAPABILITY_REQUIRED,
      error: expect.any(String),
      result: {},
    });
  });

  it('relays a host failure envelope untouched', async () => {
    const env = createCardEnvironment();
    env.answerWith(() => ({
      ok: false,
      code: CARD_ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      error: 'this host has no such capability',
    }));
    const card = env.install();

    const envelope = await card.request('teleport');

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.CAPABILITY_NOT_SUPPORTED);
    expect(envelope.result).toEqual({});
  });

  it('resolves CARD_HOST_TIMEOUT when the host stays silent for 5 s', async () => {
    vi.useFakeTimers();
    const env = createCardEnvironment();
    const card = env.install();

    const pending = card.request('state.get', { key: null });
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const envelope = await pending;
    expect(envelope).toEqual({
      ok: false,
      code: CARD_ERROR_CODES.TIMEOUT,
      error: expect.any(String),
      result: {},
    });
  });

  it('resolves CARD_HOST_POST_FAILED when the message cannot be delivered', async () => {
    const env = createCardEnvironment();
    env.postFailure = new Error('frame is gone');
    const card = env.install();

    const envelope = await card.capabilities();

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.POST_FAILED);
  });
});

describe('injection layer: transport (spec 2.8)', () => {
  it('sends a card:request carrying a requestId and the capability', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    card.invoke('refresh', { city: 'Tokyo' });
    await flush();

    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]).toMatchObject({
      type: CARD_REQUEST_TYPE,
      capability: 'invoke',
      payload: { bindingId: 'refresh', input: { city: 'Tokyo' } },
    });
    expect(typeof env.sent[0].requestId).toBe('string');
    expect(env.sent[0].requestId).not.toBe('');
  });

  it('ignores an answer carrying a different requestId and settles on the matching one', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    const pending = card.request('state.get', { key: null });
    await flush();
    const { requestId } = env.sent[0];

    let settled = false;
    pending.then(() => {
      settled = true;
    });

    env.respond({ type: CARD_RESPONSE_TYPE, requestId: 'someone-elses-request', ok: true, result: { state: { wrong: true } } });
    await flush();
    expect(settled).toBe(false);

    env.respond({ type: CARD_RESPONSE_TYPE, requestId, ok: true, result: { state: { right: true } } });
    const envelope = await pending;

    expect(envelope).toEqual({ ok: true, result: { state: { right: true } } });
  });

  it('ignores messages that are not card:response', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    const pending = card.request('state.get', { key: null });
    await flush();
    const { requestId } = env.sent[0];

    let settled = false;
    pending.then(() => {
      settled = true;
    });

    env.respond({ type: 'something:else', requestId, ok: true, result: {} });
    await flush();
    expect(settled).toBe(false);

    env.respond({ type: CARD_RESPONSE_TYPE, requestId, ok: true, result: {} });
    await expect(pending).resolves.toEqual({ ok: true, result: {} });
  });

  it('answers CARD_HOST_INVALID_RESPONSE when the answer has no ok field', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    const pending = card.request('state.get', { key: null });
    await flush();
    env.respond({ type: CARD_RESPONSE_TYPE, requestId: env.sent[0].requestId, result: { state: {} } });

    const envelope = await pending;
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.INVALID_RESPONSE);
  });

  it('answers CARD_HOST_INVALID_RESPONSE when a failure answer has no code', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    const pending = card.request('state.get', { key: null });
    await flush();
    env.respond({ type: CARD_RESPONSE_TYPE, requestId: env.sent[0].requestId, ok: false, error: 'nope' });

    const envelope = await pending;
    expect(envelope.code).toBe(CARD_ERROR_CODES.INVALID_RESPONSE);
  });
});

describe('injection layer: standalone fallback (spec 3.4)', () => {
  const standalone = (options = {}) => createCardEnvironment({ hosted: false, ...options });

  it('reports environment standalone with the section 3.1 shape', async () => {
    const card = standalone().install();

    await expect(card.capabilities()).resolves.toEqual({
      ok: true,
      result: {
        environment: 'standalone',
        capabilities: { state: 'local_fallback', invoke: 'requires_host', emit: 'requires_host' },
      },
    });
  });

  it('has no tool channel at all', async () => {
    const card = standalone().install();

    const envelope = await card.invoke('refresh');

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.TOOL_UNAVAILABLE);
  });

  it('answers emit with CARD_HOST_CAPABILITY_NOT_SUPPORTED', async () => {
    const card = standalone().install();

    const envelope = await card.emit('probe.clicked', { n: 1 });

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.CAPABILITY_NOT_SUPPORTED);
  });

  it("stores state in local storage under a key derived from the document's own address (spec 2.5)", async () => {
    const env = standalone({ pathname: '/cards/weather-9/index.html' });
    const card = env.install();

    await card.state.set('temp', '23C');

    expect(env.storage.getItem(`${STATE_KEY_PREFIX}/cards/weather-9/index.html`)).toBe(
      JSON.stringify({ temp: '23C' }),
    );
  });

  it('ignores a legacy burned-in card-id meta tag entirely (spec 1.8): the key still comes from the location', async () => {
    const env = standalone({ pathname: '/cards/weather-9/index.html', legacyCardId: 'some-other-id' });
    const card = env.install();

    await card.state.set('temp', '23C');

    expect(env.storage.getItem(`${STATE_KEY_PREFIX}/cards/weather-9/index.html`)).toBe(
      JSON.stringify({ temp: '23C' }),
    );
    expect(env.storage.getItem(`${STATE_KEY_PREFIX}some-other-id`)).toBeNull();
  });

  it('round-trips get / set(key, value) / set(state object)', async () => {
    const card = standalone().install();

    await card.state.set('a', 1);
    await expect(card.state.get('a')).resolves.toEqual({ ok: true, result: { key: 'a', value: 1 } });

    await card.state.set('b', 2);
    await expect(card.state.get()).resolves.toEqual({ ok: true, result: { state: { a: 1, b: 2 } } });

    await card.state.set({ only: 'this' });
    await expect(card.state.get()).resolves.toEqual({ ok: true, result: { state: { only: 'this' } } });
  });

  it('keeps two cards at different paths out of each other keys', async () => {
    const storage = createStorageStub();
    const first = standalone({ pathname: '/cards/card-a/index.html', storage }).install();
    const second = standalone({ pathname: '/cards/card-b/index.html', storage }).install();

    await first.state.set('who', 'a');
    await second.state.set('who', 'b');

    await expect(first.state.get('who')).resolves.toEqual({ ok: true, result: { key: 'who', value: 'a' } });
    await expect(second.state.get('who')).resolves.toEqual({ ok: true, result: { key: 'who', value: 'b' } });
    expect([...storage.entries.keys()].sort()).toEqual([
      `${STATE_KEY_PREFIX}/cards/card-a/index.html`,
      `${STATE_KEY_PREFIX}/cards/card-b/index.html`,
    ]);
  });

  it('survives a reload: a fresh runtime over the same storage sees the old state', async () => {
    const storage = createStorageStub();
    const before = standalone({ pathname: '/cards/card-x/index.html', storage }).install();
    await before.state.set('count', 3);

    const after = standalone({ pathname: '/cards/card-x/index.html', storage }).install();

    await expect(after.state.get('count')).resolves.toEqual({ ok: true, result: { key: 'count', value: 3 } });
  });

  it('refuses an over-budget write and leaves the stored state untouched (spec 2.5)', async () => {
    const env = standalone({ pathname: '/cards/card-x/index.html' });
    const card = env.install();
    await card.state.set('keep', 'me');
    const before = env.storage.getItem(`${STATE_KEY_PREFIX}/cards/card-x/index.html`);

    const envelope = await card.state.set('huge', 'x'.repeat(70000));

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.STATE_TOO_LARGE);
    expect(env.storage.getItem(`${STATE_KEY_PREFIX}/cards/card-x/index.html`)).toBe(before);
  });

  it('reports CARD_HOST_STORAGE_UNAVAILABLE when there is no local storage', async () => {
    const env = standalone({ storage: null });
    const card = env.install();

    const envelope = await card.state.get();

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.STORAGE_UNAVAILABLE);
  });

  it('reports CARD_HOST_STORAGE_UNAVAILABLE when the location has no usable path', async () => {
    const env = standalone({ pathname: null });
    const card = env.install();

    const envelope = await card.state.set('a', 1);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.STORAGE_UNAVAILABLE);
  });

  it('reports CARD_HOST_STORAGE_FAILED when the write is rejected', async () => {
    const env = standalone({ storage: createStorageStub({}, { failWrites: true }) });
    const card = env.install();

    const envelope = await card.state.set('a', 1);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(CARD_ERROR_CODES.STORAGE_FAILED);
  });

  it('answers unusable arguments with an envelope instead of throwing', async () => {
    const card = createCardEnvironment({ hosted: false }).install();

    await expect(card.state.set(42)).resolves.toMatchObject({
      ok: false,
      code: CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
    });
    await expect(card.invoke('')).resolves.toMatchObject({
      ok: false,
      code: CARD_HOST_EXTENSION_CODES.INVALID_INPUT,
    });
  });
});

describe('injection layer: emit wire (spec 2.3)', () => {
  it('attaches userGesture collected by the injection layer', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    card.emit('probe.clicked', { n: 1 });
    await flush();

    expect(env.sent).toHaveLength(1);
    expect(env.sent[0].capability).toBe('emit');
    expect(env.sent[0].payload).toEqual({
      name: 'probe.clicked',
      payload: { n: 1 },
      userGesture: false,
    });
  });

  it('reads navigator.userActivation.isActive when that API is present', async () => {
    const env = createCardEnvironment();
    env.win.navigator = { userActivation: { isActive: true } };
    const card = env.install();

    card.emit('probe.clicked', { n: 1 });
    await flush();

    expect(env.sent[0].payload.userGesture).toBe(true);
    expect(env.sent[0].payload).not.toHaveProperty('to');
  });

  it('falls back to a trusted event on the synchronous call stack', async () => {
    const env = createCardEnvironment();
    env.win.event = { isTrusted: true };
    const card = env.install();

    card.emit('probe.clicked', { n: 1 });
    await flush();

    expect(env.sent[0].payload.userGesture).toBe(true);
  });

  it('keeps to on the wire beside the user payload', async () => {
    const env = createCardEnvironment();
    const card = env.install();

    card.emit('probe.clicked', { n: 1 }, 'sess_elsewhere');
    await flush();

    expect(env.sent[0].payload).toEqual({
      name: 'probe.clicked',
      payload: { n: 1 },
      to: 'sess_elsewhere',
      userGesture: false,
    });
  });
});

describe('injection layer: declarative sugar (spec 2.7)', () => {
  it('data-invoke fires the binding on click', async () => {
    const env = createCardEnvironment({ html: '<button data-invoke="refresh">refresh</button>' });
    env.answerWith(() => ({ ok: true, result: { temp: '24C' } }));
    env.install();

    env.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(env.sent).toHaveLength(1);
    expect(env.sent[0].capability).toBe('invoke');
    expect(env.sent[0].payload.bindingId).toBe('refresh');
  });

  it('data-invoke fires the binding on Enter for elements the browser does not activate', async () => {
    const env = createCardEnvironment({ html: '<div tabindex="0" data-invoke="refresh">refresh</div>' });
    env.answerWith(() => ({ ok: true, result: {} }));
    env.install();

    env.$('[data-invoke]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(env.sent).toHaveLength(1);
    expect(env.sent[0].payload.bindingId).toBe('refresh');
  });

  it('data-invoke inside a form serializes the fields into input', async () => {
    const env = createCardEnvironment({
      html: `
        <form>
          <input name="city" value="Tokyo">
          <input name="unit" value="C">
          <button data-invoke="lookup">go</button>
        </form>`,
    });
    env.answerWith(() => ({ ok: true, result: {} }));
    env.install();

    env.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(env.sent[0].payload.input).toEqual({ city: 'Tokyo', unit: 'C' });
  });

  it('data-result shows the latest result of its binding as text', async () => {
    const env = createCardEnvironment({
      html: '<button data-invoke="refresh">go</button><output data-result="refresh"></output>',
    });
    env.answerWith(() => ({ ok: true, result: { temp: '24C' } }));
    env.install();

    env.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    await flush();

    const target = env.$('[data-result]');
    expect(target.textContent).toBe(JSON.stringify({ temp: '24C' }, null, 2));
    expect(target.children).toHaveLength(0);
  });

  it('data-result writes text, never markup', async () => {
    const env = createCardEnvironment({
      html: '<button data-invoke="refresh">go</button><div data-result="refresh"></div>',
    });
    env.answerWith(() => ({ ok: true, result: { note: '<img src=x onerror="boom()">' } }));
    env.install();

    env.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    await flush();

    const target = env.$('[data-result]');
    expect(target.querySelector('img')).toBe(null);
    expect(target.textContent).toContain('<img');
  });

  it('data-persist fills a control from state on load', async () => {
    const storage = createStorageStub({ [`${STATE_KEY_PREFIX}/cards/card-1/index.html`]: JSON.stringify({ count: 7 }) });
    const env = createCardEnvironment({
      hosted: false,
      storage,
      html: '<input type="number" data-persist="count">',
    });
    env.install();

    await flush();
    await flush();

    expect(env.$('input').value).toBe('7');
  });

  it('data-persist fills a control when the document is already parsed', async () => {
    const storage = createStorageStub({ [`${STATE_KEY_PREFIX}/cards/card-1/index.html`]: JSON.stringify({ note: 'kept' }) });
    const env = createCardEnvironment({
      hosted: false,
      storage,
      alreadyParsed: true,
      html: '<input data-persist="note">',
    });
    env.install();

    await flush();
    await flush();

    expect(env.$('input').value).toBe('kept');
  });

  it('data-persist writes the control value back on change', async () => {
    const env = createCardEnvironment({
      hosted: false,
      html: '<input data-persist="note">',
    });
    env.install();

    const input = env.$('input');
    input.value = 'hello';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();

    expect(JSON.parse(env.storage.getItem(`${STATE_KEY_PREFIX}/cards/card-1/index.html`))).toEqual({ note: 'hello' });
  });

  it('data-persist handles checkboxes as booleans', async () => {
    const env = createCardEnvironment({
      hosted: false,
      html: '<input type="checkbox" data-persist="done">',
    });
    env.install();

    const box = env.$('input');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();

    expect(JSON.parse(env.storage.getItem(`${STATE_KEY_PREFIX}/cards/card-1/index.html`))).toEqual({ done: true });
  });
});

describe('injection layer: sugar equals hand-written calls (spec 9.4)', () => {
  it('data-invoke and a hand-written card.invoke produce the same request and result', async () => {
    const html = `
      <form>
        <input name="city" value="Kyoto">
        <button data-invoke="lookup">go</button>
      </form>
      <output data-result="lookup"></output>`;

    const sugar = createCardEnvironment({ html });
    sugar.answerWith((message) => ({ ok: true, result: { echoed: message.payload.input } }));
    sugar.install();
    sugar.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    await flush();

    const manual = createCardEnvironment({ html });
    manual.answerWith((message) => ({ ok: true, result: { echoed: message.payload.input } }));
    const card = manual.install();
    const input = Object.fromEntries(new FormData(manual.$('form')).entries());
    const envelope = await card.invoke('lookup', input);
    manual.$('[data-result]').textContent = JSON.stringify(envelope.result, null, 2);

    expect(sugar.sent[0].payload).toEqual(manual.sent[0].payload);
    expect(sugar.$('[data-result]').textContent).toBe(manual.$('[data-result]').textContent);
  });

  it('the sugar goes through the public window.card surface, not a private shortcut', async () => {
    const env = createCardEnvironment({ html: '<button data-invoke="refresh">go</button>' });
    env.answerWith(() => ({ ok: true, result: {} }));
    const card = env.install();

    const spy = vi.spyOn(card, 'invoke');
    env.$('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(spy).toHaveBeenCalledWith('refresh', undefined);
  });
});
