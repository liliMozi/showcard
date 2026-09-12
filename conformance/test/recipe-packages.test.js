import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCardPackage } from '../src/static-checks.js';

const root = resolve('docs/examples');
const names = ['weather', 'piano', 'note', 'todo'];
const languages = ['en', 'zh', 'ja', 'ko'];
function packageFiles(directory) {
  const files = new Map();
  function visit(relative = '') {
    for (const item of readdirSync(join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) visit(name);
      else files.set(name, readFileSync(join(directory, name)));
    }
  }
  visit();
  return files;
}

describe('current recipe example packages', () => {
  for (const name of names) {
    const files = packageFiles(join(root, name));
    for (const language of languages) {
      const entry = language === 'en' ? 'index.html' : `index.${language}.html`;
      const source = files.get(entry).toString();
      it(`${name} in ${language} is a valid package with all local artwork`, () => {
        const packageWithEntry = new Map(files);
        packageWithEntry.set('index.html', source);
        const errors = checkCardPackage(packageWithEntry).findings.filter(item => item.level === 'error');
        expect(errors, JSON.stringify(errors)).toEqual([]);
        for (const asset of new Set(source.match(/assets\/[a-zA-Z0-9._-]+/g))) {
          expect(files.has(asset), `${name}/${entry} references missing ${asset}`).toBe(true);
        }
        const state = JSON.parse(source.match(/<script[^>]*data-card-state[^>]*>([\s\S]*?)<\/script>/)[1]);
        expect(state.uiLanguage).toBe(language);
        // Compile every author and runtime script; JSON snapshots are data.
        for (const script of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
          if (script[1].includes('application/json')) continue;
          expect(() => new Function(script[2])).not.toThrow();
        }
        expect(Buffer.byteLength(source)).toBeLessThan(100 * 1024);
      });
    }
  }

  it('the homepage points at the current packages in isolated frames', () => {
    const page = readFileSync(resolve('docs/index.html'), 'utf8');
    const frames = [...page.matchAll(/<iframe\b[^>]*>/g)].map(match => match[0]);
    expect(frames).toHaveLength(3);
    for (const name of ['weather', 'piano', 'note']) {
      const frame = frames.find(frame => frame.includes(`data-showcard="${name}"`));
      expect(frame).toContain(`src="examples/${name}/index.html"`);
      expect(frame).toContain('sandbox="allow-scripts"');
      expect(frame).not.toContain('allow-same-origin');
    }
    expect(page).not.toContain('name="card-id"');
    expect(page).not.toContain('&lt;meta name="card-id"');
  });

  it('uses unmodified copies of the tested reference runtime', () => {
    for (const name of readdirSync(join(root, 'runtime'))) {
      expect(readFileSync(join(root, 'runtime', name), 'utf8')).toBe(readFileSync(resolve('reference/src', name), 'utf8'));
    }
  });
});
