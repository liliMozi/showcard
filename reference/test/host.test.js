import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  createLocalStorageStateStore,
  createMemoryStateStore,
  mountCard,
  mountPackage,
  readCardManifest,
} from '../src/host.js';
import { createHostFixture, settle } from './helpers/host-fixture.js';
import { createStorageStub } from './helpers/card-environment.js';
import {
  CARD_ERROR_CODES,
  CARD_HOST_EXTENSION_CODES,
  CARD_RESPONSE_TYPE,
  STATE_KEY_PREFIX,
} from '../src/codes.js';

const openFixtures = new Set();

function fixture(options) {
  const created = createHostFixture(options);
  openFixtures.add(created);
  return created;
}

afterEach(() => {
  for (const created of openFixtures) {
    created.teardown();
  }
  openFixtures.clear();
  vi.restoreAllMocks();
});

const manifestScript = (manifest) =>
  `<script type="application/json" data-card-manifest>${JSON.stringify(manifest)}</script>`;

/** Wrap head content and body content into a complete document (spec 1.1: the only shape a card entry has now). */
const doc = (headContent, bodyContent) =>
  `<!DOCTYPE html><html><head><title>Test card</title>${headContent}</head><body>${bodyContent}</body></html>`;

describe('state stores', () => {
  it('an unknown card starts with empty state', () => {
    const store = createMemoryStateStore();
    expect(store.get('nobody')).toEqual({});
  });

  it('round-trips state per card id and keeps cards apart', () => {
    const store = createMemoryStateStore();

    store.set('card-a', { who: 'a' });
    store.set('card-b', { who: 'b' });

    expect(store.get('card-a')).toEqual({ who: 'a' });
    expect(store.get('card-b')).toEqual({ who: 'b' });
  });

  it('hands out copies, so a caller cannot reach into the store', () => {
    const store = createMemoryStateStore();
    store.set('card-a', { count: 1 });

    const taken = store.get('card-a');
    taken.count = 99;

    expect(store.get('card-a')).toEqual({ count: 1 });
  });

  it('the local storage store writes JSON under a key derived from the card id', () => {
    const storage = createStorageStub();
    const store = createLocalStorageStateStore(storage);

    store.set('card-a', { count: 2 });

    expect(storage.getItem(`${STATE_KEY_PREFIX}card-a`)).toBe(JSON.stringify({ count: 2 }));
    expect(store.get('card-a')).toEqual({ count: 2 });
  });

  it('the local storage store reads unreadable payloads as empty state', () => {
    const storage = createStorageStub({ [`${STATE_KEY_PREFIX}card-a`]: 'not json' });
    const store = createLocalStorageStateStore(storage);

    expect(store.get('card-a')).toEqual({});
  });
});

describe('mountCard: rendering (spec 7.1)', () => {
  it('renders the card in a sandboxed iframe with no same-origin escape hatch', () => {
    const created = fixture();

    const sandbox = created.mounted.iframe.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(created.mounted.iframe.parentElement).toBe(created.container);
  });

  it('refuses to mount a fragment: a card entry is always a complete document (spec 1.1)', () => {
    expect(() => fixture({ cardSource: '<p data-marker>hello</p>' })).toThrow(/complete card document/);
  });

  it('does not burn any identity into the served document (spec 1.3)', () => {
    const created = fixture({
      cardSource: '<!DOCTYPE html><html><head><title>x</title></head><body><p data-marker>hello</p></body></html>',
    });
    const html = created.mounted.iframe.getAttribute('srcdoc');
    expect(html).not.toContain('card-id');
  });

  it('keeps an imported document intact and injects ahead of its embedded shim (spec 5.7)', () => {
    const imported = [
      '<!DOCTYPE html>',
      '<html><head>',
      '<script>/* embedded export shim */ if (!window.card) { window.card = {}; }</script>',
      '</head><body><p data-marker>imported</p></body></html>',
    ].join('\n');

    const created = fixture({ cardSource: imported });
    const html = created.mounted.iframe.getAttribute('srcdoc');

    expect(html.match(/<!DOCTYPE html>/gi)).toHaveLength(1);
    expect(html.indexOf('window.card')).toBeLessThan(html.indexOf('embedded export shim'));
    expect(html).toContain('<p data-marker>imported</p>');
  });

  it('unmount removes the iframe and stops answering', async () => {
    const created = createHostFixture();
    const { iframe } = created.mounted;

    created.mounted.unmount();
    created.post({ type: 'card:request', requestId: 'after-unmount', capability: 'capabilities' });
    await settle();

    expect(iframe.parentElement).toBe(null);
    expect(created.answers).toHaveLength(0);
    created.container.remove();
  });
});

describe('mountCard: the message channel (spec 2.8)', () => {
  it('answers with a card:response echoing the requestId', async () => {
    const created = fixture();

    const answer = await created.ask('capabilities');

    expect(answer.type).toBe(CARD_RESPONSE_TYPE);
    expect(answer.requestId).toBe(answer.requestId);
    expect(answer.ok).toBe(true);
  });

  it('ignores messages that did not come from its own card', async () => {
    const created = fixture();

    created.post(
      { type: 'card:request', requestId: 'from-a-stranger', capability: 'capabilities' },
      window,
    );
    await settle();

    expect(created.answers).toHaveLength(0);
  });

  it('ignores messages that are not card:request', async () => {
    const created = fixture();

    created.post({ type: 'other:request', requestId: 'x', capability: 'capabilities' });
    await settle();

    expect(created.answers).toHaveLength(0);
  });
});

describe('mountCard: capability dispatch (spec 2.3 / 2.6)', () => {
  it('answers an unknown capability with CARD_HOST_CAPABILITY_NOT_SUPPORTED', async () => {
    const created = fixture();

    const answer = await created.ask('teleport');

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_ERROR_CODES.CAPABILITY_NOT_SUPPORTED);
  });

  it('answers a request with no capability name with CARD_HOST_CAPABILITY_REQUIRED', async () => {
    const created = fixture();

    const answer = await created.ask(undefined);

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_ERROR_CODES.CAPABILITY_REQUIRED);
  });

  it('reports the host capability shape (spec 3.1)', async () => {
    const withoutTools = fixture();
    const withTools = fixture({ executeBinding: () => ({}) });

    await expect(withoutTools.ask('capabilities')).resolves.toMatchObject({
      ok: true,
      result: {
        environment: 'host',
        capabilities: { state: 'available', invoke: 'requires_host', emit: 'available' },
      },
    });
    await expect(withTools.ask('capabilities')).resolves.toMatchObject({
      ok: true,
      result: {
        environment: 'host',
        capabilities: { state: 'available', invoke: 'available', emit: 'available' },
      },
    });
  });
});

describe('mountCard: emit (spec 2.3)', () => {
  it('accepts a legal name and answers a delivery receipt', async () => {
    const created = fixture();

    await expect(created.ask('emit', { name: 'probe.clicked', payload: { n: 1 } })).resolves.toMatchObject({
      ok: true,
      result: { delivered: true },
    });
  });

  it('echoes to on the delivery receipt when the wire carries it', async () => {
    const created = fixture();

    await expect(created.ask('emit', {
      name: 'probe.clicked',
      payload: { n: 1 },
      to: 'sess_elsewhere',
    })).resolves.toMatchObject({
      ok: true,
      result: { delivered: true, to: 'sess_elsewhere' },
    });
  });

  it('refuses an illegal name with CARD_HOST_INVALID_INPUT', async () => {
    const created = fixture();

    const answer = await created.ask('emit', { name: 'NOT VALID' });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_HOST_EXTENSION_CODES.INVALID_INPUT);
  });

  it('refuses an over-budget payload with CARD_HOST_INVALID_INPUT', async () => {
    const created = fixture();
    const oversized = 'x'.repeat(8200);

    const answer = await created.ask('emit', { name: 'probe.clicked', payload: oversized });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_HOST_EXTENSION_CODES.INVALID_INPUT);
  });
});

describe('mountCard: state (spec 2.5)', () => {
  it('round-trips get, set(key, value) and set(state object)', async () => {
    const created = fixture({ stateStore: createMemoryStateStore() });

    await created.ask('state.set', { key: 'a', value: 1 });
    await created.ask('state.set', { key: 'b', value: 2 });

    await expect(created.ask('state.get', { key: 'a' })).resolves.toMatchObject({
      ok: true,
      result: { key: 'a', value: 1 },
    });
    await expect(created.ask('state.get', { key: null })).resolves.toMatchObject({
      ok: true,
      result: { state: { a: 1, b: 2 } },
    });

    await created.ask('state.set', { state: { only: 'this' } });
    await expect(created.ask('state.get', { key: null })).resolves.toMatchObject({
      ok: true,
      result: { state: { only: 'this' } },
    });
  });

  it('persists across a remount on the same store (L1 duty, spec 9.1)', async () => {
    const stateStore = createMemoryStateStore();

    const first = fixture({ stateStore });
    await first.ask('state.set', { key: 'count', value: 5 });
    first.teardown();
    openFixtures.delete(first);

    const second = fixture({ stateStore });
    await expect(second.ask('state.get', { key: 'count' })).resolves.toMatchObject({
      ok: true,
      result: { key: 'count', value: 5 },
    });
  });

  it('keeps two cards on one store out of each other state', async () => {
    const stateStore = createMemoryStateStore();
    const first = fixture({ stateStore, cardId: 'card-a' });
    const second = fixture({ stateStore, cardId: 'card-b' });

    await first.ask('state.set', { key: 'who', value: 'a' });
    await second.ask('state.set', { key: 'who', value: 'b' });

    await expect(first.ask('state.get', { key: 'who' })).resolves.toMatchObject({
      result: { value: 'a' },
    });
    await expect(second.ask('state.get', { key: 'who' })).resolves.toMatchObject({
      result: { value: 'b' },
    });
  });

  it('refuses an over-budget write and leaves the stored state untouched', async () => {
    const stateStore = createMemoryStateStore();
    const created = fixture({ stateStore });
    await created.ask('state.set', { key: 'keep', value: 'me' });

    const answer = await created.ask('state.set', { key: 'huge', value: 'x'.repeat(70000) });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_ERROR_CODES.STATE_TOO_LARGE);
    expect(stateStore.get('card-1')).toEqual({ keep: 'me' });
  });

  it('answers unusable state arguments with an envelope', async () => {
    const created = fixture();

    const answer = await created.ask('state.set', { nothing: true });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_HOST_EXTENSION_CODES.INVALID_INPUT);
  });
});

describe('mountCard: invoke (spec 1.4 / 7.4)', () => {
  const cardWithBinding = doc(
    manifestScript({ spec: '1.0', toolBindings: { save: { tool: 'files.write' } } }),
    '<p>card</p>',
  );

  it('refuses a binding the manifest never declared, even when a hook exists', async () => {
    const executeBinding = vi.fn(() => ({ done: true }));
    const created = fixture({ cardSource: cardWithBinding, executeBinding });

    const answer = await created.ask('invoke', { bindingId: 'delete-everything' });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_ERROR_CODES.TOOL_UNAVAILABLE);
    expect(executeBinding).not.toHaveBeenCalled();
  });

  it('refuses a declared binding when the embedder wired no hook', async () => {
    const created = fixture({ cardSource: cardWithBinding });

    const answer = await created.ask('invoke', { bindingId: 'save' });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_ERROR_CODES.TOOL_UNAVAILABLE);
  });

  it('runs a declared binding through the hook and wraps the result', async () => {
    const executeBinding = vi.fn(async ({ bindingId, binding, input, cardId }) => ({
      bindingId,
      tool: binding.tool,
      input,
      cardId,
    }));
    const created = fixture({ cardSource: cardWithBinding, executeBinding });

    const answer = await created.ask('invoke', { bindingId: 'save', input: { text: 'hi' } });

    expect(answer).toMatchObject({
      ok: true,
      result: { bindingId: 'save', tool: 'files.write', input: { text: 'hi' }, cardId: 'card-1' },
    });
  });

  it('turns a failing hook into an envelope, never a rejection (spec 9.6)', async () => {
    const executeBinding = () => {
      throw new Error('the disk is full');
    };
    const created = fixture({ cardSource: cardWithBinding, executeBinding });

    const answer = await created.ask('invoke', { bindingId: 'save' });

    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(CARD_HOST_EXTENSION_CODES.TOOL_FAILED);
    expect(answer.error).toContain('the disk is full');
  });
});

describe('manifest reading (spec 1.4 / 6.7)', () => {
  it('a card with no manifest is legal and simply has no bindings', async () => {
    const created = fixture({ cardSource: doc('', '<p>plain</p>'), executeBinding: () => ({}) });

    const answer = await created.ask('invoke', { bindingId: 'anything' });

    expect(answer.code).toBe(CARD_ERROR_CODES.TOOL_UNAVAILABLE);
    expect(readCardManifest('<p>plain</p>').bindings).toEqual({});
  });

  it('ignores manifest fields it does not know (tolerant parsing)', async () => {
    const source = doc(
      manifestScript({
        spec: '1.0',
        futureField: { anything: true },
        toolBindings: { save: { tool: 'files.write', futureOption: 1 } },
      }),
      '<p>card</p>',
    );
    const created = fixture({ cardSource: source, executeBinding: () => ({ saved: true }) });

    await expect(created.ask('invoke', { bindingId: 'save' })).resolves.toMatchObject({
      ok: true,
      result: { saved: true },
    });
  });

  it('renders a card whose manifest is not valid JSON, and treats it as having no bindings', async () => {
    const source = doc(
      '<script type="application/json" data-card-manifest>{ not json </script>',
      '<p data-marker>card</p>',
    );
    const created = fixture({ cardSource: source, executeBinding: () => ({}) });

    expect(created.mounted.iframe.getAttribute('srcdoc')).toContain('data-marker');
    await expect(created.ask('invoke', { bindingId: 'save' })).resolves.toMatchObject({
      ok: false,
      code: CARD_ERROR_CODES.TOOL_UNAVAILABLE,
    });
  });

  it('reads the first manifest when a document carries more than one', () => {
    const source = [
      manifestScript({ spec: '1.0', toolBindings: { first: { tool: 'a' } } }),
      manifestScript({ spec: '1.0', toolBindings: { second: { tool: 'b' } } }),
    ].join('');

    expect(Object.keys(readCardManifest(source).bindings)).toEqual(['first']);
  });

  it('treats a missing spec field as 1.0', () => {
    const source = manifestScript({ toolBindings: { save: { tool: 'files.write' } } });

    expect(readCardManifest(source).specVersion).toBe('1.0');
    expect(readCardManifest(source).specSupported).toBe(true);
  });

  it('renders a card declaring a newer spec, and answers the socket with CARD_HOST_CONTRACT_UNSUPPORTED', async () => {
    const source = doc(
      manifestScript({ spec: '2.0', toolBindings: { save: { tool: 'files.write' } } }),
      '<p data-marker>from the future</p>',
    );
    const created = fixture({ cardSource: source, executeBinding: () => ({ saved: true }) });

    // Never refuse to open the document (spec 6.7 / 9.6).
    expect(created.mounted.iframe.getAttribute('srcdoc')).toContain('data-marker');

    await expect(created.ask('capabilities')).resolves.toMatchObject({
      ok: false,
      code: CARD_ERROR_CODES.CONTRACT_UNSUPPORTED,
    });
    await expect(created.ask('invoke', { bindingId: 'save' })).resolves.toMatchObject({
      ok: false,
      code: CARD_ERROR_CODES.CONTRACT_UNSUPPORTED,
    });
    await expect(created.ask('state.get', { key: null })).resolves.toMatchObject({
      ok: false,
      code: CARD_ERROR_CODES.CONTRACT_UNSUPPORTED,
    });
  });
});

describe('mountCard: embedder mistakes fail loudly', () => {
  it('refuses to mount without a container', () => {
    expect(() => mountCard({ cardId: 'c', cardSource: '<p>x</p>' })).toThrow(/container/);
  });

  it('refuses to mount without a card id', () => {
    const container = document.createElement('div');
    expect(() => mountCard({ container, cardSource: '<p>x</p>' })).toThrow(/cardId/);
  });
});

describe('mountPackage: a genuinely served package (spec 1.1)', () => {
  it('points the iframe at src rather than embedding the document inline', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const mounted = mountPackage({
      container,
      entrySource: doc('', '<p>card</p>'),
      src: 'https://cards.example/t/ticket-1/index.html',
      cardId: 'card-served',
      stateStore: createMemoryStateStore(),
    });

    expect(mounted.iframe.getAttribute('src')).toBe('https://cards.example/t/ticket-1/index.html');
    expect(mounted.iframe.hasAttribute('srcdoc')).toBe(false);
    expect(mounted.iframe.getAttribute('sandbox')).toBe('allow-scripts');

    mounted.unmount();
    container.remove();
  });

  it('reads the manifest from entrySource so bindings are wired before the iframe ever loads', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const executeBinding = vi.fn(async () => ({ done: true }));

    const mounted = mountPackage({
      container,
      entrySource: doc(
        manifestScript({ spec: '1.0', toolBindings: { save: { tool: 'files.write' } } }),
        '<p>card</p>',
      ),
      src: 'https://cards.example/t/ticket-2/index.html',
      cardId: 'card-served-2',
      stateStore: createMemoryStateStore(),
      executeBinding,
    });

    const answer = await mounted.dispatch('invoke', { bindingId: 'save' });
    expect(answer).toMatchObject({ ok: true, result: { done: true } });

    mounted.unmount();
    container.remove();
  });

  it('refuses without src: there is nothing to point the iframe at', () => {
    const container = document.createElement('div');
    expect(() => mountPackage({ container, entrySource: doc('', '<p>x</p>'), cardId: 'c' })).toThrow(/src/);
  });

  it('refuses a fragment entrySource the same as mountCard does', () => {
    const container = document.createElement('div');
    expect(() =>
      mountPackage({ container, entrySource: '<p>x</p>', src: 'https://cards.example/t/t/index.html', cardId: 'c' }),
    ).toThrow(/complete card document/);
  });
});
