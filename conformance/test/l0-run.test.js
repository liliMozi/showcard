import { describe, expect, it } from 'vitest';

import { injectRuntimeIntoDocument } from '../../reference/src/wrap.js';
import { NETWORK_CHANNELS, runL0Harmlessness } from '../src/l0-run.js';

/**
 * Fixtures are built with the reference injection, so what runs is a real
 * card document with a real embedded shim rather than a hand-made stand-in.
 * Section 1.1: a card's entry is always a complete document, so the fixture
 * wraps its body content in one — there is no fragment form to build any
 * more.
 */
function card(bodyContent, { title = 'Fixture card', head = '' } = {}) {
  const document = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    head,
    '</head>',
    '<body>',
    bodyContent,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return injectRuntimeIntoDocument(document);
}

const kinds = (result) => result.violations.map((violation) => violation.kind);

describe('runL0Harmlessness: a harmless card', () => {
  it('passes a plain readable card', async () => {
    const result = await runL0Harmlessness(card('<h1>Reading log</h1><p>Three books this month.</p>'));
    expect(result.violations).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('passes a card whose buttons fail politely without a host', async () => {
    const result = await runL0Harmlessness(
      card(
        [
          '<script type="application/json" data-card-manifest>{ "toolBindings": { "refresh": { "tool": "t" } } }</script>',
          '<p>Tokyo</p>',
          '<button data-invoke="refresh">Refresh</button>',
          '<output data-result="refresh"></output>',
        ].join('\n'),
      ),
    );
    expect(result.violations).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('reports how many interactions it swept', async () => {
    const result = await runL0Harmlessness(
      card('<button>one</button><a href="#x">two</a><button data-invoke="b">three</button>'),
    );
    expect(result.interactions).toBe(3);
  });

  it('loads the card standalone, so the runtime takes the L0 path', async () => {
    const result = await runL0Harmlessness(card('<p>hello</p>'));
    expect(result.environment).toBe('standalone');
  });
});

describe('runL0Harmlessness: network (section 9.2, zero requests)', () => {
  it('records a violation for a fetch hidden in card script', async () => {
    const result = await runL0Harmlessness(card('<p>x</p><script>fetch("https://example.com/x");</script>'));
    expect(kinds(result)).toContain('network');
    expect(result.pass).toBe(false);
    expect(result.violations[0].detail).toContain('fetch');
  });

  it('records a violation for a request fired from a click, not just from load', async () => {
    const result = await runL0Harmlessness(
      card(
        [
          '<button id="go">go</button>',
          '<script>document.getElementById("go").addEventListener("click", function () {',
          '  var x = new XMLHttpRequest(); x.open("GET", "https://example.com/y"); x.send();',
          '});</script>',
        ].join('\n'),
      ),
    );
    expect(kinds(result)).toContain('network');
  });

  it('records each of the published channels', async () => {
    const scripts = {
      fetch: 'fetch("https://example.com/a");',
      XMLHttpRequest: 'var x = new XMLHttpRequest(); x.open("GET", "/b"); x.send();',
      WebSocket: 'new WebSocket("wss://example.com/c");',
      EventSource: 'new EventSource("https://example.com/d");',
      sendBeacon: 'navigator.sendBeacon("https://example.com/e");',
      'Image.src': 'var i = new Image(); i.src = "https://example.com/f.png";',
    };
    // Driven off the published list, so adding a channel without instrumenting
    // it, or instrumenting one without publishing it, fails here.
    expect(Object.keys(scripts).sort()).toEqual([...NETWORK_CHANNELS].sort());
    for (const [name, script] of Object.entries(scripts)) {
      const result = await runL0Harmlessness(card(`<p>x</p><script>${script}</script>`));
      expect(kinds(result), name).toContain('network');
      expect(result.violations.find((v) => v.kind === 'network').detail, name).toContain(name);
    }
  });

  it('says nothing about a static img in the markup: the runner judges behaviour, and section 1.2 makes writing that reference legal', async () => {
    const result = await runL0Harmlessness(card('<p>x</p><img alt="a" src="https://example.com/pixel.png">'));
    expect(kinds(result)).not.toContain('network');
  });
});

describe('runL0Harmlessness: exceptions (section 9.2, zero uncaught)', () => {
  it('records a violation for a click that throws', async () => {
    const result = await runL0Harmlessness(
      card(
        [
          '<button id="go">go</button>',
          '<script>document.getElementById("go").addEventListener("click", function () {',
          '  throw new Error("boom");',
          '});</script>',
        ].join('\n'),
      ),
    );
    expect(kinds(result)).toContain('exception');
    expect(result.violations.find((v) => v.kind === 'exception').detail).toContain('boom');
  });

  it('records a violation for a throw during load', async () => {
    const result = await runL0Harmlessness(card('<p>x</p><script>null.oops;</script>'));
    expect(kinds(result)).toContain('exception');
  });

  it('records a violation for an unhandled rejection', async () => {
    const result = await runL0Harmlessness(
      card('<p>x</p><script>Promise.reject(new Error("nobody caught me"));</script>'),
    );
    expect(kinds(result)).toContain('exception');
    expect(result.violations.find((v) => v.kind === 'exception').detail).toContain('nobody caught me');
  });

  it('leaves the outer process rejection handlers in place afterwards', async () => {
    const before = process.listeners('unhandledRejection');
    await runL0Harmlessness(card('<p>x</p><script>Promise.reject(new Error("x"));</script>'));
    expect(process.listeners('unhandledRejection')).toEqual(before);
  });
});

describe('runL0Harmlessness: renderability (section 9.2)', () => {
  it('records a violation for a card that renders nothing', async () => {
    const result = await runL0Harmlessness(card('   '));
    expect(kinds(result)).toContain('not-renderable');
  });

  it('accepts a card whose only content is an element, with no prose', async () => {
    const result = await runL0Harmlessness(card('<hr>'));
    expect(kinds(result)).not.toContain('not-renderable');
  });

  it('does not count script and style as rendered content', async () => {
    const result = await runL0Harmlessness(card('<style>p{color:red}</style><script>void 0;</script>'));
    expect(kinds(result)).toContain('not-renderable');
  });
});

describe('runL0Harmlessness: fallback storage (section 2.5 / 9.2)', () => {
  it("finds a storage key derived from the document's own location after a persist interaction", async () => {
    const result = await runL0Harmlessness(card('<p>Note</p><input data-persist="note">'), {
      origin: 'https://card.localhost/cards/reading-log-7/index.html',
    });
    expect(result.violations).toEqual([]);
    expect(result.storage.assessed).toBe(true);
    expect(result.storage.keys.some((key) => key.includes('/cards/reading-log-7/index.html'))).toBe(true);
  });

  it('accepts a hand-written state write just the same', async () => {
    const result = await runL0Harmlessness(
      card(
        [
          '<button id="go">save</button>',
          '<script>document.getElementById("go").addEventListener("click", function () {',
          '  card.state.set("note", "written by hand");',
          '});</script>',
        ].join('\n'),
      ),
      { origin: 'https://card.localhost/cards/hand-written-3/index.html' },
    );
    expect(result.violations).toEqual([]);
    expect(result.storage.keys.some((key) => key.includes('/cards/hand-written-3/index.html'))).toBe(true);
  });

  it('keeps two cards at different locations out of each other keys', async () => {
    const a = await runL0Harmlessness(card('<input data-persist="note">'), {
      origin: 'https://card.localhost/cards/card-a/index.html',
    });
    const b = await runL0Harmlessness(card('<input data-persist="note">'), {
      origin: 'https://card.localhost/cards/card-b/index.html',
    });
    expect(a.storage.keys.some((key) => key.includes('/cards/card-a/index.html'))).toBe(true);
    expect(b.storage.keys.some((key) => key.includes('/cards/card-b/index.html'))).toBe(true);
  });

  it('leaves the storage check unassessed for a card that never touches state', async () => {
    const result = await runL0Harmlessness(card('<p>just words</p>'));
    expect(result.storage.assessed).toBe(false);
    expect(result.pass).toBe(true);
  });
});

describe('runL0Harmlessness: input handling', () => {
  it('refuses a fragment: L0 harmlessness is a property of a whole file, and a card entry is always a complete document (section 1.1)', async () => {
    await expect(runL0Harmlessness('<p>a fragment</p>')).rejects.toThrow(TypeError);
  });
});
