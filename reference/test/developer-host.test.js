import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryStateStore, createCapabilityDispatcher } from '../src/host.js';
import createDeveloperReferenceAdapter from '../../examples/host/adapter.mjs';
import { DEMO_TIME_BINDING_ID, DEMO_TIME_TOOL, executeDemoBinding } from '../../examples/host/gateway.js';
import { parseInitialState, startDemoServer } from '../../examples/host/server.mjs';

let demo;

afterEach(async () => {
  if (demo) {
    await demo.close();
    demo = undefined;
  }
});

describe('minimal development host example', () => {
  it('serves its bootstrap page and one scoped card package with a local stylesheet', async () => {
    demo = await startDemoServer({ port: 0 });
    const root = await fetch(demo.url('/'));
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('data-card-host');

    const browserHost = await fetch(demo.url('/browser-host.mjs'));
    expect(browserHost.status).toBe(200);
    expect(browserHost.headers.get('content-type')).toContain('text/javascript');

    const bootstrap = await (await fetch(demo.url('/bootstrap.json'))).json();
    expect(bootstrap.cardUrl).toBe('/t/development-note/index.html');
    const entry = await fetch(demo.url(bootstrap.cardUrl));
    expect(entry.status).toBe(200);
    expect(await entry.text()).toContain('assets/style.css');

    const stylesheet = await fetch(demo.url('/t/development-note/assets/style.css'));
    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get('content-type')).toContain('text/css');
    expect(await stylesheet.text()).toContain('.card');
  });

  it('rejects paths outside its fixed package and every non-read method', async () => {
    demo = await startDemoServer({ port: 0 });
    expect((await fetch(demo.url('/not-a-file'))).status).toBe(404);
    expect((await fetch(demo.url('/t/development-note/assets/missing.css'))).status).toBe(404);
    expect((await fetch(demo.url('/t/development-note/%2e%2e/server.mjs'))).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(demo.url('/bootstrap.json'), { method: 'POST' })).status).toBe(405);
  });

  it('accepts an absent snapshot but fails clearly for invalid fixture state', () => {
    expect(parseInitialState('<!doctype html><html><head></head><body></body></html>')).toEqual({});
    expect(parseInitialState('<script data-card-state type="application/json">{ "note": "ready" }</script>')).toEqual({ note: 'ready' });
    expect(() => parseInitialState('<script type="application/json" data-card-state>{</script>')).toThrow('not valid JSON');
    expect(() => parseInitialState('<script type="application/json" data-card-state>[]</script>')).toThrow('must be a JSON object');
  });

  it('persists card state and only permits the fixed no-input time binding', async () => {
    const store = createMemoryStateStore();
    const dispatch = createCapabilityDispatcher({
      cardId: 'development-note-card',
      stateStore: store,
      bindings: { [DEMO_TIME_BINDING_ID]: { tool: DEMO_TIME_TOOL } },
      executeBinding: executeDemoBinding,
    });
    await expect(dispatch('state.set', { key: 'note', value: 'saved locally' })).resolves.toMatchObject({ ok: true });
    await expect(dispatch('state.get', {})).resolves.toMatchObject({ ok: true, result: { state: { note: 'saved locally' } } });
    await expect(dispatch('invoke', { bindingId: DEMO_TIME_BINDING_ID })).resolves.toMatchObject({ ok: true, result: { iso: expect.any(String) } });
    await expect(dispatch('invoke', { bindingId: 'anything-else' })).resolves.toMatchObject({ ok: false });
    expect(() => executeDemoBinding({ bindingId: DEMO_TIME_BINDING_ID, binding: { tool: DEMO_TIME_TOOL }, input: { injected: true } })).toThrow(/does not accept runtime input/);
  });

  it('provides a closeable reference-host adapter for the packaged CLI contract', async () => {
    const adapter = createDeveloperReferenceAdapter();
    try {
      const handle = await adapter.mount({
        entry: 'index.html',
        files: new Map([
          ['index.html', '<!doctype html><html><head><title>Adapter package</title></head><body><p>mounted</p></body></html>'],
          ['assets/style.css', 'p { color: teal; }'],
        ]),
      }, 'adapter-development-note');
      expect(handle.getDocument().querySelector('p')?.textContent).toBe('mounted');
      await handle.unmount();
    } finally {
      await adapter.close();
    }
  });
});
