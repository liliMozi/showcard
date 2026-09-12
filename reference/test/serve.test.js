import { describe, expect, it } from 'vitest';

import { buildInstancePolicy, createPackageHost, guessContentType, parseRange, weakETag } from '../src/serve.js';

const injectEntry = (entrySource, { csp }) =>
  entrySource.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>window.card = {};</script></head>`);

function host() {
  return createPackageHost({ injectEntry });
}

const ENTRY = '<!DOCTYPE html><html><head><title>x</title></head><body><p>x</p></body></html>';

describe('createPackageHost: routing', () => {
  it('serves the entry at the ticketed path, injected', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY]]) });

    const response = h.handle({ method: 'GET', pathname: '/t/abc/index.html' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('window.card = {}');
    expect(response.body).toContain('Content-Security-Policy');
    expect(response.body).toContain('<p>x</p>');
  });

  it('serves an asset at its package-relative path under the same ticket', () => {
    const h = host();
    h.mount('abc', {
      files: new Map([
        ['index.html', ENTRY],
        ['assets/style.css', 'p{color:red}'],
      ]),
    });

    const response = h.handle({ method: 'GET', pathname: '/t/abc/assets/style.css' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/css');
    expect(response.body).toEqual(new TextEncoder().encode('p{color:red}'));
  });

  it('404s an unknown ticket', () => {
    const response = host().handle({ method: 'GET', pathname: '/t/nope/index.html' });
    expect(response.status).toBe(404);
  });

  it('404s a path not in the package', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY]]) });
    expect(h.handle({ method: 'GET', pathname: '/t/abc/assets/missing.css' }).status).toBe(404);
  });

  it('404s anything outside the /t/{ticket}/ scheme', () => {
    expect(host().handle({ method: 'GET', pathname: '/favicon.ico' }).status).toBe(404);
  });

  it('refuses a path that climbs above the package root', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY]]) });
    const response = h.handle({ method: 'GET', pathname: '/t/abc/../../etc/passwd' });
    expect(response.status).toBe(400);
  });

  it('stops serving an unmounted instance', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY]]) });
    h.unmount('abc');
    expect(h.handle({ method: 'GET', pathname: '/t/abc/index.html' }).status).toBe(404);
  });

  it('rejects a method other than GET/HEAD', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY]]) });
    expect(h.handle({ method: 'POST', pathname: '/t/abc/index.html' }).status).toBe(405);
  });

  it('keeps two instances of the same package apart', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/a.txt', 'first']]) });
    h.mount('xyz', { files: new Map([['index.html', ENTRY], ['assets/a.txt', 'second']]) });

    expect(h.handle({ method: 'GET', pathname: '/t/abc/assets/a.txt' }).body).toEqual(new TextEncoder().encode('first'));
    expect(h.handle({ method: 'GET', pathname: '/t/xyz/assets/a.txt' }).body).toEqual(new TextEncoder().encode('second'));
  });
});

describe('createPackageHost: asset caching (section 1.2 ETag)', () => {
  it('answers 304 when If-None-Match matches the current ETag', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/a.txt', 'hello']]) });

    const first = h.handle({ method: 'GET', pathname: '/t/abc/assets/a.txt' });
    const conditional = h.handle({
      method: 'GET',
      pathname: '/t/abc/assets/a.txt',
      headers: { 'if-none-match': first.headers.etag },
    });

    expect(conditional.status).toBe(304);
  });

  it('gives the same asset the same ETag on every request', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/a.txt', 'hello']]) });

    const a = h.handle({ method: 'GET', pathname: '/t/abc/assets/a.txt' });
    const b = h.handle({ method: 'GET', pathname: '/t/abc/assets/a.txt' });
    expect(a.headers.etag).toBe(b.headers.etag);
  });
});

describe('createPackageHost: Range requests (section 1.2)', () => {
  const BIG = 'x'.repeat(1000) + 'y'.repeat(1000);

  it('answers 206 for a satisfiable byte range', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });

    const response = h.handle({
      method: 'GET',
      pathname: '/t/abc/assets/big.bin',
      headers: { range: 'bytes=1000-1099' },
    });

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 1000-1099/${BIG.length}`);
    expect(new TextDecoder().decode(response.body)).toBe('y'.repeat(100));
  });

  it('answers a suffix range (the last N bytes)', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });

    const response = h.handle({ method: 'GET', pathname: '/t/abc/assets/big.bin', headers: { range: 'bytes=-10' } });

    expect(response.status).toBe(206);
    expect(new TextDecoder().decode(response.body)).toBe('y'.repeat(10));
  });

  it('answers an open-ended range (from N to the end)', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });

    const response = h.handle({
      method: 'GET',
      pathname: '/t/abc/assets/big.bin',
      headers: { range: `bytes=${BIG.length - 5}-` },
    });

    expect(response.status).toBe(206);
    expect(new TextDecoder().decode(response.body)).toBe('y'.repeat(5));
  });

  it('answers 416 for a range past the end of the file', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });

    const response = h.handle({
      method: 'GET',
      pathname: '/t/abc/assets/big.bin',
      headers: { range: `bytes=${BIG.length + 10}-${BIG.length + 20}` },
    });

    expect(response.status).toBe(416);
    expect(response.headers['content-range']).toBe(`bytes */${BIG.length}`);
  });

  it('answers a plain 200 when there is no Range header', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });

    const response = h.handle({ method: 'GET', pathname: '/t/abc/assets/big.bin' });
    expect(response.status).toBe(200);
    expect(response.body.length).toBe(BIG.length);
  });

  it('advertises Range support on every asset response', () => {
    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/big.bin', BIG]]) });
    expect(h.handle({ method: 'GET', pathname: '/t/abc/assets/big.bin' }).headers['accept-ranges']).toBe('bytes');
  });
});

describe('buildInstancePolicy (section 7.1)', () => {
  it('scopes subresource directives to this instance prefix rather than the whole origin', () => {
    const policy = buildInstancePolicy('http://127.0.0.1:4000/t/abc/');
    expect(policy).toContain('http://127.0.0.1:4000/t/abc/');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
  });

  it('does not leak one instance prefix into another instance policy', () => {
    const a = buildInstancePolicy('http://127.0.0.1:4000/t/abc/');
    const b = buildInstancePolicy('http://127.0.0.1:4000/t/xyz/');
    expect(a).not.toContain('/t/xyz/');
    expect(b).not.toContain('/t/abc/');
  });
});

describe('createPackageHost: binary assets (a real Buffer, not just a Uint8Array literal)', () => {
  it('serves a Node Buffer byte-for-byte, unencoded, even under a jsdom test realm', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    // Resolved from the project root rather than from import.meta.url: under
    // the jsdom test environment the global URL resolves a relative
    // specifier against the fake page origin, not against this file.
    const bytes = await readFile(resolve(process.cwd(), 'docs/examples/assets/weather-hero.webp'));

    const h = host();
    h.mount('abc', { files: new Map([['index.html', ENTRY], ['assets/hero.webp', bytes]]) });

    const response = h.handle({ method: 'GET', pathname: '/t/abc/assets/hero.webp' });
    expect(response.status).toBe(200);
    // Byte-length equality, not just "truthy": a Buffer misread as text and
    // re-encoded would still produce *some* bytes, just the wrong count —
    // exactly the bug this test exists to catch (see reference/src/serve.js's
    // toBytes, which used to fail this across a jsdom test realm).
    expect(response.body.length).toBe(bytes.length);
    expect(Buffer.compare(Buffer.from(response.body), bytes)).toBe(0);
  });
});

describe('helpers', () => {
  it('guesses content types from the extension', () => {
    expect(guessContentType('assets/a.css')).toContain('text/css');
    expect(guessContentType('assets/a.png')).toBe('image/png');
    expect(guessContentType('assets/a.unknown-ext')).toBe('application/octet-stream');
  });

  it('parseRange returns undefined for no header, null for an unsatisfiable one', () => {
    expect(parseRange(undefined, 100)).toBeUndefined();
    expect(parseRange('bytes=200-300', 100)).toBeNull();
  });

  it('weakETag is stable for the same bytes and differs for different ones', () => {
    const a = weakETag(new TextEncoder().encode('hello'));
    const b = weakETag(new TextEncoder().encode('hello'));
    const c = weakETag(new TextEncoder().encode('world'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
