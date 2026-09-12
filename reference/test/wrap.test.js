import { describe, it, expect } from 'vitest';

import { CARD_CONTENT_SECURITY_POLICY, injectRuntimeIntoDocument, isFullDocument } from '../src/wrap.js';
import { CARD_RUNTIME_SOURCE } from '../src/runtime-source.js';
import { CARD_PLACEHOLDER_SOURCE } from '../src/placeholder-source.js';

const RUNTIME_MARKER = 'window.card';

describe('isFullDocument', () => {
  it('recognises a document by its doctype', () => {
    expect(isFullDocument('<!DOCTYPE html><html></html>')).toBe(true);
  });

  it('recognises a document that opens straight with <html>', () => {
    expect(isFullDocument('<html><body>x</body></html>')).toBe(true);
  });

  it('rejects a fragment: section 1.1 has no fragment input any more', () => {
    expect(isFullDocument('<p>hello</p>')).toBe(false);
  });
});

describe('injectRuntimeIntoDocument', () => {
  const IMPORTED_CARD = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<script>/* embedded export shim */ if (!window.card) { window.card = { embedded: true }; }</script>',
    '</head>',
    '<body><p data-marker>imported</p></body>',
    '</html>',
  ].join('\n');

  it('injects the host runtime ahead of the file-embedded shim (host injection wins, spec 2.2)', () => {
    const html = injectRuntimeIntoDocument(IMPORTED_CARD);

    const runtimeAt = html.indexOf(RUNTIME_MARKER);
    const embeddedShimAt = html.indexOf('embedded export shim');

    expect(runtimeAt).toBeGreaterThan(-1);
    expect(embeddedShimAt).toBeGreaterThan(-1);
    expect(runtimeAt).toBeLessThan(embeddedShimAt);
  });

  it('embeds the runtime source verbatim', () => {
    expect(injectRuntimeIntoDocument(IMPORTED_CARD)).toContain(CARD_RUNTIME_SOURCE);
  });

  it('keeps the embedded shim and the card content in the document', () => {
    const html = injectRuntimeIntoDocument(IMPORTED_CARD);

    expect(html).toContain('embedded export shim');
    expect(html).toContain('<p data-marker>imported</p>');
  });

  it('keeps the doctype first so the imported card keeps rendering in standards mode', () => {
    const html = injectRuntimeIntoDocument(IMPORTED_CARD);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('still injects when the document has no head element', () => {
    const html = injectRuntimeIntoDocument('<html><body><p data-marker>x</p></body></html>');

    const runtimeAt = html.indexOf(RUNTIME_MARKER);
    const contentAt = html.indexOf('data-marker');

    expect(runtimeAt).toBeGreaterThan(-1);
    expect(runtimeAt).toBeLessThan(contentAt);
  });

  it('uses the default single-document policy when none is given', () => {
    const html = injectRuntimeIntoDocument(IMPORTED_CARD);
    expect(html).toContain(escapeForContains(CARD_CONTENT_SECURITY_POLICY));
  });

  it('accepts an instance-scoped policy override, for a host serving a package', () => {
    const scoped = "default-src 'none'; img-src 'self' data: blob:; connect-src 'none'";
    const html = injectRuntimeIntoDocument(IMPORTED_CARD, { csp: scoped });
    expect(html).toContain(escapeForContains(scoped));
    expect(html).not.toContain(escapeForContains(CARD_CONTENT_SECURITY_POLICY));
  });

  it('removes an author-carried CSP meta before injecting the host policy, so the two do not AND', () => {
    const doc = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; connect-src \'none\'"></head><body><p>x</p></body></html>';
    const scoped = "default-src 'none'; img-src data: blob: https://cdn.example.com; connect-src 'none'";
    const html = injectRuntimeIntoDocument(doc, { csp: scoped });
    expect(html).toContain(escapeForContains(scoped));
    expect(html).not.toContain('img-src data: blob:; connect-src');
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  function escapeForContains(csp) {
    return csp.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});

describe('the injected layer (sections 7.1 / 7.8)', () => {
  it('denies every network subresource in the default policy', () => {
    expect(CARD_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CARD_CONTENT_SECURITY_POLICY).toContain('img-src data: blob:');
    expect(CARD_CONTENT_SECURITY_POLICY).toContain('media-src data: blob:');
    expect(CARD_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(CARD_CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
  });

  it("allows the card's own inline code, which is all a card has", () => {
    expect(CARD_CONTENT_SECURITY_POLICY).toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(CARD_CONTENT_SECURITY_POLICY).toMatch(/style-src [^;]*'unsafe-inline'/);
  });

  it('puts the policy and the placeholder shim into an entry document, ahead of the card content', () => {
    const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Imported</title></head><body><p>x</p></body></html>';
    const html = injectRuntimeIntoDocument(doc);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(CARD_PLACEHOLDER_SOURCE);
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('<p>x</p>'));
  });

  it('still injects into a document that lost its head', () => {
    const html = injectRuntimeIntoDocument('<!DOCTYPE html><p>bare</p>');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(CARD_PLACEHOLDER_SOURCE);
  });
});
