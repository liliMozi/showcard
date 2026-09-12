import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const demoPath = resolve(here, '../demo.html');
const demo = readFileSync(demoPath, 'utf8');

describe('demo page', () => {
  it('loads the shim from a path that exists', () => {
    const imports = [...demo.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]);

    expect(imports).toContain('./src/host.js');
    for (const specifier of imports) {
      expect(existsSync(resolve(here, '..', specifier))).toBe(true);
    }
  });

  it('shows all three declarative markers', () => {
    expect(demo).toContain('data-persist="pages"');
    expect(demo).toContain('data-invoke="summarize"');
    expect(demo).toContain('data-result="summarize"');
  });

  it('carries a valid manifest declaring the binding the card invokes', () => {
    const block = /data-card-manifest>([\s\S]*?)<\\\/script>/.exec(demo);
    expect(block).not.toBe(null);

    const manifest = JSON.parse(block[1]);
    expect(manifest.spec).toBe('1.0');
    expect(Object.keys(manifest.toolBindings)).toContain('summarize');
  });

  it('mounts a complete document, not a fragment (section 1.1)', () => {
    // Two doctypes: the demo page's own, and the card's own — a card entry
    // is a complete document an author writes in full, not something the
    // host assembles around a fragment.
    expect(demo.match(/<!DOCTYPE/gi)).toHaveLength(2);
    expect(demo).toContain('createMemoryStateStore');
    expect(demo).toContain('executeBinding');
  });

  it('pulls in nothing from the network (spec 1.2)', () => {
    expect(demo).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
    expect(demo).not.toMatch(/\/\/(cdn|unpkg|jsdelivr)/i);
  });

  it('says what to do when the browser refuses to load modules off the disk', () => {
    expect(demo).toContain('id="module-note"');
    expect(demo).toContain("document.getElementById('module-note').remove()");
  });
});
