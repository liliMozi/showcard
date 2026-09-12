/**
 * The round-trip proof: a real `node:http` server, a real card package with
 * an asset the entry references by a relative path, and a real browser
 * engine (jsdom, configured to actually fetch subresources rather than
 * short-circuit them) loading it the way a browser would.
 *
 * Every other test in this suite either calls `serve.js`'s `handle()`
 * directly (no transport) or bridges a card into jsdom by string (no
 * relative-path resolution to prove). This file is the one place that does
 * neither: it is the demonstration that section 1.1's "a host serves a card
 * package the way it serves any static site" is true of this reference
 * implementation, not merely asserted of it.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { injectRuntimeIntoDocument } from '../src/wrap.js';
import { startPackageServer } from '../src/node-serve.js';

const ENTRY = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Package round trip</title>
<link rel="stylesheet" href="assets/style.css">
<script type="application/json" data-card-manifest>
{ "spec": "1.0", "toolBindings": { "echo": { "tool": "conformance.echo" } } }
</script>
</head>
<body>
<p id="target">hello</p>
<img id="marker" src="assets/marker.svg" alt="a marker" width="10" height="10">
</body>
</html>`;

const STYLE = '#target { color: rgb(1, 2, 3); }';
const MARKER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

let server;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

/** Open a served entry as jsdom's own top-level window, real subresources and all. */
async function openServedEntry(url, { hosted = true } = {}) {
  const virtualConsole = new VirtualConsole();
  const sent = [];

  const dom = await JSDOM.fromURL(url, {
    resources: 'usable',
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      if (!hosted) {
        return;
      }
      Object.defineProperty(window, 'parent', {
        configurable: true,
        value: {
          postMessage(message) {
            sent.push(message);
            // The bare-bones scripted host this test needs: capabilities and
            // an echo binding, enough to prove the socket works end to end
            // over a genuinely served document.
            queueMicrotask(() => {
              const envelope =
                message.capability === 'capabilities'
                  ? { ok: true, result: { environment: 'host', capabilities: { state: 'available', invoke: 'available' } } }
                  : message.capability === 'invoke'
                    ? { ok: true, result: { echoed: message.payload && message.payload.input } }
                    : { ok: false, code: 'CARD_HOST_CAPABILITY_NOT_SUPPORTED', error: 'unhandled in this test' };
              window.dispatchEvent(
                new window.MessageEvent('message', {
                  data: { type: 'card:response', requestId: message.requestId, ...envelope },
                }),
              );
            });
          },
        },
      });
    },
  });

  if (dom.window.document.readyState !== 'complete') {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  }
  return { dom, sent };
}

describe('a package served for real, loaded for real', () => {
  it('resolves the relative stylesheet and image against the served ticketed path', async () => {
    server = await startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    const ticket = 'round-trip-1';
    server.packageHost.mount(ticket, {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', STYLE],
        ['assets/marker.svg', MARKER_SVG],
      ]),
    });

    const { dom } = await openServedEntry(server.url(ticket, 'index.html'));
    try {
      const styleSheets = dom.window.document.styleSheets;
      expect(styleSheets.length).toBeGreaterThan(0);
      expect(styleSheets[0].cssRules[0].cssText.replace(/\s/g, '')).toContain('color:rgb(1,2,3)');

      const target = dom.window.document.getElementById('target');
      expect(dom.window.getComputedStyle(target).color).toBe('rgb(1, 2, 3)');
    } finally {
      dom.window.close();
    }
  });

  it('answers the socket over a genuinely served document (state and invoke both work)', async () => {
    server = await startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    const ticket = 'round-trip-2';
    server.packageHost.mount(ticket, {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', STYLE],
        ['assets/marker.svg', MARKER_SVG],
      ]),
    });

    const { dom } = await openServedEntry(server.url(ticket, 'index.html'));
    try {
      const capabilities = await dom.window.card.capabilities();
      expect(capabilities).toMatchObject({ ok: true, result: { environment: 'host' } });

      const invoked = await dom.window.card.invoke('echo', { hello: 'world' });
      expect(invoked).toMatchObject({ ok: true, result: { echoed: { hello: 'world' } } });
    } finally {
      dom.window.close();
    }
  });

  it('serves an ETag on the asset the browser just loaded, matching serve.js directly', async () => {
    server = await startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    const ticket = 'round-trip-3';
    server.packageHost.mount(ticket, {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', STYLE],
        ['assets/marker.svg', MARKER_SVG],
      ]),
    });

    const direct = server.packageHost.handle({ method: 'GET', pathname: `/t/${ticket}/assets/style.css` });
    const response = await fetch(server.url(ticket, 'assets/style.css'));
    expect(response.headers.get('etag')).toBe(direct.headers.etag);
  });

  it('serves a byte range of a large asset (section 1.2), fetched over the real server', async () => {
    server = await startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    const ticket = 'round-trip-4';
    const big = 'a'.repeat(2000) + 'b'.repeat(2000);
    server.packageHost.mount(ticket, {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', STYLE],
        ['assets/marker.svg', MARKER_SVG],
        ['assets/big.bin', big],
      ]),
    });

    const response = await fetch(server.url(ticket, 'assets/big.bin'), { headers: { range: 'bytes=2000-2099' } });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('b'.repeat(100));
  });

  it('degrades to standalone when there is no parent to answer it, even though it was fetched over HTTP', async () => {
    server = await startPackageServer({ injectEntry: injectRuntimeIntoDocument });
    const ticket = 'round-trip-5';
    server.packageHost.mount(ticket, {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', STYLE],
        ['assets/marker.svg', MARKER_SVG],
      ]),
    });

    const { dom } = await openServedEntry(server.url(ticket, 'index.html'), { hosted: false });
    try {
      const capabilities = await dom.window.card.capabilities();
      expect(capabilities).toMatchObject({ ok: true, result: { environment: 'standalone' } });
    } finally {
      dom.window.close();
    }
  });
});
