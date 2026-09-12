import { describe, expect, it } from 'vitest';

import { checkCardDocument, checkCardPackage, readManifest, readStateSnapshot } from '../src/static-checks.js';
import { PREFERRED_WIDTH_MAX_PX, PREFERRED_WIDTH_MIN_PX, SECRET_PATTERNS } from '../src/rules.js';

/** A document that satisfies every rule, so a violation fixture changes one thing. */
function validDocument({ head = '', body = '', manifest = '{ "spec": "1.0" }' } = {}) {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Reading log</title>',
    manifest === null
      ? ''
      : `<script type="application/json" data-card-manifest>\n${manifest}\n</script>`,
    head,
    '</head>',
    '<body>',
    '<p>Three books this month.</p>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const rulesOf = (result) => result.findings.map((finding) => finding.rule);
const errorsOf = (result) => result.findings.filter((f) => f.level === 'error').map((f) => f.rule);

describe('checkCardDocument: a compliant card', () => {
  it('reports nothing at all for a valid document', () => {
    expect(checkCardDocument(validDocument())).toEqual({ findings: [] });
  });

  it('every finding names the file it belongs to', () => {
    const result = checkCardDocument(validDocument().replace('<title>Reading log</title>\n', ''));
    expect(result.findings).toEqual([expect.objectContaining({ rule: 'title-missing', file: 'index.html' })]);
  });

  it('rejects a fragment: section 1.1 has no fragment input any more', () => {
    const fragment = [
      '<script type="application/json" data-card-manifest>{ "spec": "1.0" }</script>',
      '<p>Three books this month.</p>',
    ].join('\n');
    expect(rulesOf(checkCardDocument(fragment))).toEqual(['entry-not-a-document']);
  });
});

describe('manifest rules (section 1.4)', () => {
  it('flags a second manifest block and nothing else', () => {
    const doc = validDocument({
      body: '<script type="application/json" data-card-manifest>{ "spec": "1.0" }</script>',
    });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-duplicate']);
  });

  it('flags a manifest that is not valid JSON', () => {
    const doc = validDocument({ manifest: '{ "spec": "1.0", }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-invalid-json']);
  });

  it('flags a manifest that parses but is not a JSON object', () => {
    const doc = validDocument({ manifest: '["not", "an", "object"]' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-invalid-json']);
  });

  it('accepts a manifest with no spec field: the default reads as 1.0', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": {} }' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('flags a non-string spec field', () => {
    const doc = validDocument({ manifest: '{ "spec": 1.0 }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-spec-not-string']);
  });

  it('says nothing about unknown manifest fields (tolerant parsing)', () => {
    const doc = validDocument({
      manifest: '{ "spec": "1.0", "somethingFromTheFuture": { "deep": [1, 2] } }',
    });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('accepts a card with no manifest at all', () => {
    expect(checkCardDocument(validDocument({ manifest: null })).findings).toEqual([]);
  });
});

describe('display preference rules (section 1.4 / 9.3)', () => {
  const withDisplay = (display) => validDocument({ manifest: `{ "spec": "1.0", "display": ${display} }` });

  it('says nothing about a width inside the band', () => {
    expect(checkCardDocument(withDisplay('{ "preferredWidthPx": 384 }')).findings).toEqual([]);
  });

  it('accepts the band edges themselves', () => {
    for (const width of [PREFERRED_WIDTH_MIN_PX, PREFERRED_WIDTH_MAX_PX]) {
      expect(checkCardDocument(withDisplay(`{ "preferredWidthPx": ${width} }`)).findings, String(width)).toEqual([]);
    }
  });

  it('accepts a fractional width: a width is rounded, not refused', () => {
    expect(checkCardDocument(withDisplay('{ "preferredWidthPx": 384.4 }')).findings).toEqual([]);
  });

  it('says nothing about a display block that declares no width', () => {
    expect(checkCardDocument(withDisplay('{}')).findings).toEqual([]);
  });

  /**
   * Warning, never error: section 1.4 has the rendering side treat an
   * unacceptable width as no width at all, so the card still works. Failing a
   * card over a preference the host is required to shrug at would be reporting
   * a misunderstanding as a danger.
   */
  it.each([
    ['a width below the band', `{ "preferredWidthPx": ${PREFERRED_WIDTH_MIN_PX - 1} }`],
    ['a width above the band', `{ "preferredWidthPx": ${PREFERRED_WIDTH_MAX_PX + 1} }`],
    ['a width written as text', '{ "preferredWidthPx": "384" }'],
    ['a width written as nothing', '{ "preferredWidthPx": null }'],
  ])('warns about %s', (_label, display) => {
    const result = checkCardDocument(withDisplay(display));
    expect(rulesOf(result)).toEqual(['manifest-display-width']);
    expect(result.findings[0].level).toBe('warning');
  });

  it('warns about a display block that is not a block', () => {
    const result = checkCardDocument(withDisplay('384'));
    expect(rulesOf(result)).toEqual(['manifest-display-not-object']);
    expect(result.findings[0].level).toBe('warning');
  });

  it('warns about a display block written as a list', () => {
    expect(rulesOf(checkCardDocument(withDisplay('[]')))).toEqual(['manifest-display-not-object']);
  });
});

describe('stateSchema declaration (section 1.4)', () => {
  const withStateSchema = (stateSchema) => validDocument({ manifest: `{ "spec": "1.0", "stateSchema": ${stateSchema} }` });

  it('says nothing about a JSON object schema', () => {
    expect(checkCardDocument(withStateSchema('{ "type": "object", "properties": { "n": { "type": "number" } } }')).findings).toEqual([]);
  });

  it('errors when stateSchema is not an object', () => {
    const result = checkCardDocument(withStateSchema('[]'));
    expect(rulesOf(result)).toEqual(['manifest-stateschema-not-object']);
    expect(result.findings[0].level).toBe('error');
  });

  it('errors when stateSchema is written as text', () => {
    expect(rulesOf(checkCardDocument(withStateSchema('"object"')))).toEqual(['manifest-stateschema-not-object']);
  });
});

describe('toolBindings shape (section 4.2 / 9.3)', () => {
  it('accepts the minimal two-field binding', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": { "tool": "time.now" } } }' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('accepts a binding with input and description', () => {
    const doc = validDocument({
      manifest:
        '{ "toolBindings": { "scores": { "tool": "fetch.request", "input": { "hosts": ["api.example.com"] }, "description": "pull scores" } } }',
    });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('flags toolBindings that is not an object', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": [] }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbindings-not-object']);
  });

  it('flags a binding that is not an object', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": "time.now" } }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape']);
  });

  it('flags a binding with no tool field', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": {} } }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape']);
  });

  it('flags a binding whose tool is empty', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": { "tool": "  " } } }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape']);
  });

  it('flags an input that is not an object', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": { "tool": "time.now", "input": "now" } } }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape']);
  });

  it('flags a description that is not a string', () => {
    const doc = validDocument({ manifest: '{ "toolBindings": { "now": { "tool": "time.now", "description": 1 } } }' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape']);
  });

  it('reports every malformed binding, not just the first', () => {
    const doc = validDocument({
      manifest: '{ "toolBindings": { "a": {}, "b": { "tool": "" } } }',
    });
    expect(errorsOf(checkCardDocument(doc))).toEqual(['manifest-toolbinding-shape', 'manifest-toolbinding-shape']);
  });
});

describe('state snapshot block (section 1.5)', () => {
  it('accepts a document with no state block: it means an empty initial state', () => {
    expect(checkCardDocument(validDocument()).findings).toEqual([]);
  });

  it('accepts a valid state block', () => {
    const doc = validDocument({ head: '<script type="application/json" data-card-state>{ "temp": "23°C" }</script>' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('flags a state block that is not valid JSON', () => {
    const doc = validDocument({ head: '<script type="application/json" data-card-state>{ not json </script>' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['state-invalid-json']);
  });

  it('flags a second state block', () => {
    const doc = validDocument({
      head:
        '<script type="application/json" data-card-state>{}</script><script type="application/json" data-card-state>{}</script>',
    });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['state-duplicate']);
  });
});

describe('relative references stay inside the package (section 1.1 / 7.2 / 9.3)', () => {
  it('no longer flags a network-shaped script reference: section 7.2 retired the ban', () => {
    const doc = validDocument({ head: '<script src="https://cdn.example.com/chart.js"></script>' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('no longer flags a network-shaped stylesheet reference', () => {
    const doc = validDocument({ head: '<link rel="stylesheet" href="https://cdn.example.com/a.css">' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('no longer flags a network-shaped passive image reference', () => {
    const doc = validDocument({ body: '<img src="https://cdn.example.com/photo.png" alt="a photo">' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('no longer flags a CSS @import of a network host', () => {
    const doc = validDocument({ head: '<style>@import url("https://fonts.example.com/x.css");</style>' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('accepts a same-package relative reference (an asset the package carries)', () => {
    const doc = validDocument({ head: '<link rel="stylesheet" href="assets/style.css">' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('flags a relative reference that climbs above the package root', () => {
    const doc = validDocument({ head: '<link rel="stylesheet" href="../outside.css">' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['relative-reference-escapes-package']);
  });

  it('flags a reference climbing above the root even from a nested entry', () => {
    const files = { 'pkg/index.html': validDocument({ head: '<img src="../../outside.png" alt="x">' }) };
    expect(rulesOf(checkCardPackage(files, { entry: 'pkg/index.html' }))).toEqual([
      'relative-reference-escapes-package',
    ]);
  });

  it('flags a site-absolute reference: a package has no root to be absolute against', () => {
    const doc = validDocument({ body: '<img src="/etc/passwd" alt="x">' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['relative-reference-escapes-package']);
  });

  it('flags every candidate in a srcset that escapes, not just the first', () => {
    const doc = validDocument({ body: '<img srcset="../a.png 1x, ../b.png 2x" alt="a">' });
    expect(rulesOf(checkCardDocument(doc))).toEqual([
      'relative-reference-escapes-package',
      'relative-reference-escapes-package',
    ]);
  });

  it('accepts a same-document url(#id): an SVG filter reference is not a package reference', () => {
    const doc = validDocument({ body: '<div style="filter: url(#soften)">x</div>' });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('accepts a data: URL and a protocol-relative reference alike (never local, never judged)', () => {
    const doc = validDocument({
      body: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="a dot"><img src="//cdn.example.com/x.png" alt="b">',
    });
    expect(checkCardDocument(doc).findings).toEqual([]);
  });

  it('flags an escaping CSS url() inside an inline style attribute', () => {
    const doc = validDocument({ body: '<div style="background: url(../bg.jpg)">x</div>' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['relative-reference-escapes-package']);
  });

  it('flags an escaping @import distinctly from a url() that follows it in the same block', () => {
    const doc = validDocument({
      head: '<style>@import url("../reset.css"); .hero { background: url(assets/bg.jpg); }</style>',
    });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['relative-reference-escapes-package']);
  });
});

describe('secret scan (section 7.3)', () => {
  it('flags an AWS access key id', () => {
    const doc = validDocument({ body: '<p>AKIAIOSFODNN7EXAMPLE</p>' });
    const result = checkCardDocument(doc);
    expect(rulesOf(result)).toEqual(['secret-pattern']);
    expect(result.findings[0].message).toContain('aws-access-key-id');
  });

  it('never echoes the matched secret back into the finding', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const result = checkCardDocument(validDocument({ body: `<p>${secret}</p>` }));
    expect(result.findings[0].message).not.toContain(secret);
  });

  it('covers every pattern in the published set', () => {
    const samples = {
      'aws-access-key-id': 'AKIAIOSFODNN7EXAMPLE',
      'openai-style-api-key': 'sk-abcdefghijklmnopqrstuvwxyz0123',
      'github-personal-access-token': `ghp_${'a'.repeat(36)}`,
      'pem-private-key': '-----BEGIN RSA PRIVATE KEY-----',
      'bearer-token': 'Bearer abcdefghijklmnopqrstuvwxyz',
    };
    for (const { name } of SECRET_PATTERNS) {
      expect(Object.keys(samples), 'every published pattern needs a sample').toContain(name);
      const result = checkCardDocument(validDocument({ body: `<p>${samples[name]}</p>` }));
      expect(rulesOf(result), name).toEqual(['secret-pattern']);
      expect(result.findings[0].message, name).toContain(name);
    }
  });

  it('scans comments as well: a commented-out secret is still in the file', () => {
    const doc = validDocument({ body: '<!-- AKIAIOSFODNN7EXAMPLE -->' });
    expect(rulesOf(checkCardDocument(doc))).toEqual(['secret-pattern']);
  });

  it('scans every file in a package, not only the entry', () => {
    const files = {
      'index.html': validDocument({ head: '<script src="assets/config.js"></script>' }),
      'assets/config.js': 'const key = "AKIAIOSFODNN7EXAMPLE";\n',
    };
    const result = checkCardPackage(files);
    expect(rulesOf(result)).toEqual(['secret-pattern']);
    expect(result.findings[0].file).toBe('assets/config.js');
  });
});

describe('title rules (section 1.3)', () => {
  it('flags a missing title', () => {
    const doc = validDocument().replace('<title>Reading log</title>\n', '');
    expect(rulesOf(checkCardDocument(doc))).toEqual(['title-missing']);
  });

  it('flags an empty title', () => {
    const doc = validDocument().replace('<title>Reading log</title>', '<title>   </title>');
    expect(rulesOf(checkCardDocument(doc))).toEqual(['title-missing']);
  });

  it('warns about a snake_case title without calling it an error', () => {
    const doc = validDocument().replace('<title>Reading log</title>', '<title>reading_log</title>');
    const result = checkCardDocument(doc);
    expect(rulesOf(result)).toEqual(['title-not-natural-language']);
    expect(result.findings[0].level).toBe('warning');
  });

  it('warns about a camelCase title', () => {
    const doc = validDocument().replace('<title>Reading log</title>', '<title>readingLog</title>');
    expect(rulesOf(checkCardDocument(doc))).toEqual(['title-not-natural-language']);
  });

  it('accepts a one-word natural title', () => {
    const doc = validDocument().replace('<title>Reading log</title>', '<title>Weather</title>');
    expect(checkCardDocument(doc).findings).toEqual([]);
  });
});

describe('package structure (section 6 / 9.3)', () => {
  it('checks a directory-shaped package by its files map', () => {
    const files = {
      'index.html': validDocument({ head: '<link rel="stylesheet" href="assets/style.css">' }),
      'assets/style.css': 'p { color: #222; }\n',
    };
    expect(checkCardPackage(files).findings).toEqual([]);
  });

  it('flags a package with no index.html', () => {
    const files = { 'assets/style.css': 'p {}\n' };
    expect(rulesOf(checkCardPackage(files))).toEqual(['entry-missing']);
  });

  it('accepts an explicit entry name for a package whose entry sits in a subdirectory', () => {
    const files = { 'pkg/index.html': validDocument() };
    expect(checkCardPackage(files, { entry: 'pkg/index.html' }).findings).toEqual([]);
  });

  it('treats a bare string the same as a one-file package (checkCardDocument is checkCardPackage of one string)', () => {
    expect(checkCardPackage(validDocument())).toEqual(checkCardDocument(validDocument()));
  });
});

describe('readManifest / readStateSnapshot', () => {
  it('reads the manifest object', () => {
    const doc = validDocument({ manifest: '{ "spec": "1.0", "toolBindings": { "now": { "tool": "time.now" } } }' });
    expect(readManifest(doc).manifest).toEqual({ spec: '1.0', toolBindings: { now: { tool: 'time.now' } } });
  });

  it('reads the state snapshot object', () => {
    const doc = validDocument({ head: '<script type="application/json" data-card-state>{ "temp": "23°C" }</script>' });
    expect(readStateSnapshot(doc).state).toEqual({ temp: '23°C' });
  });

  it('reads null when neither block is present', () => {
    expect(readManifest('<p>hello</p>').manifest).toBeNull();
    expect(readStateSnapshot('<p>hello</p>').state).toBeNull();
  });
});
