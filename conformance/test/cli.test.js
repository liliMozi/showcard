import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildZip } from './helpers/build-zip.js';

const run = promisify(execFile);
// Resolved from the project root rather than from import.meta.url: under the
// jsdom test environment the global URL resolves a relative specifier against
// the fake page origin, not against this file.
const CLI = resolve(process.cwd(), 'conformance/bin/check-card.mjs');

let workspace;

async function write(name, contents) {
  const path = join(workspace, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
  return path;
}

/** Run the CLI and normalise the two ways Node reports a non-zero exit. */
async function cli(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

const VALID = [
  '<!DOCTYPE html>',
  '<html><head>',
  '<meta charset="utf-8">',
  '<title>Reading log</title>',
  '</head><body><p>Three books this month.</p></body></html>',
  '',
].join('\n');

beforeAll(async () => {
  await access(CLI);
  workspace = await mkdtemp(join(tmpdir(), 'showcard-cli-'));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('check-card CLI: a single file (degenerate package)', () => {
  it('exits 0 on a compliant card and says so', async () => {
    const path = await write('good.card.html', VALID);
    const { code, stdout } = await cli(path);
    expect(code).toBe(0);
    expect(stdout).toContain('good.card.html');
    expect(stdout.toLowerCase()).toContain('no findings');
  });

  it('exits 1 on a card with an error and names the rule', async () => {
    const path = await write('bad.card.html', VALID.replace('<title>Reading log</title>', ''));
    const { code, stdout } = await cli(path);
    expect(code).toBe(1);
    expect(stdout).toContain('title-missing');
    expect(stdout).toContain('error');
  });

  it('exits 0 when the only findings are warnings, and still prints them', async () => {
    const path = await write('warn.card.html', VALID.replace('<title>Reading log</title>', '<title>reading_log</title>'));
    const { code, stdout } = await cli(path);
    expect(code).toBe(0);
    expect(stdout).toContain('title-not-natural-language');
    expect(stdout).toContain('warning');
  });

  it('no longer treats a network-shaped script or stylesheet reference as an error (section 7.2)', async () => {
    const path = await write(
      'network.card.html',
      VALID.replace('</head>', '<script src="https://cdn.example.com/a.js"></script></head>'),
    );
    const { code, stdout } = await cli(path);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain('no findings');
  });

  it('flags a relative reference that climbs above the package root', async () => {
    const path = await write(
      'escape.card.html',
      VALID.replace('</head>', '<link rel="stylesheet" href="../../etc/style.css"></head>'),
    );
    const { code, stdout } = await cli(path);
    expect(code).toBe(1);
    expect(stdout).toContain('relative-reference-escapes-package');
  });

  it('exits 2 with usage when given no target', async () => {
    const { code, stderr } = await cli();
    expect(code).toBe(2);
    expect(stderr).toContain('usage');
  });

  it('exits 2 when the target does not exist', async () => {
    const { code, stderr } = await cli(join(workspace, 'nope.card.html'));
    expect(code).toBe(2);
    expect(stderr).toContain('nope.card.html');
  });

  it('checks several targets and fails if any one of them fails', async () => {
    const good = await write('multi-good.card.html', VALID);
    const bad = await write('multi-bad.card.html', VALID.replace('<p>', '<p>AKIAIOSFODNN7EXAMPLE'));
    const { code, stdout } = await cli(good, bad);
    expect(code).toBe(1);
    expect(stdout).toContain('multi-good.card.html');
    expect(stdout).toContain('secret-pattern');
  });
});

describe('check-card CLI: a package directory', () => {
  it('checks a directory package and resolves its relative asset references', async () => {
    const dir = join(workspace, 'weather-card');
    await write(
      'weather-card/index.html',
      VALID.replace('</head>', '<link rel="stylesheet" href="assets/style.css"></head>'),
    );
    await write('weather-card/assets/style.css', 'p { color: #222; }\n');

    const { code, stdout } = await cli(dir);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain('no findings');
  });

  it('flags a missing entry', async () => {
    const dir = join(workspace, 'no-entry-card');
    await write('no-entry-card/assets/style.css', 'p { color: #222; }\n');

    const { code, stdout } = await cli(dir);
    expect(code).toBe(1);
    expect(stdout).toContain('entry-missing');
  });

  it('scans every file in the package for a leaked secret, not only the entry', async () => {
    const dir = join(workspace, 'leaky-card');
    await write('leaky-card/index.html', VALID);
    await write('leaky-card/assets/config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

    const { code, stdout } = await cli(dir);
    expect(code).toBe(1);
    expect(stdout).toContain('secret-pattern');
  });
});

describe('check-card CLI: a .card.zip', () => {
  it('checks a zip whose root is the package root (section 6.3)', async () => {
    const zip = buildZip({
      'index.html': VALID.replace('</head>', '<link rel="stylesheet" href="assets/style.css"></head>'),
      'assets/style.css': 'p { color: #222; }\n',
    });
    const path = join(workspace, 'weather.card.zip');
    await writeFile(path, zip);

    const { code, stdout } = await cli(path);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain('no findings');
  });

  it('flags an escaping reference read out of a zip the same as out of a directory', async () => {
    const zip = buildZip({
      'index.html': VALID.replace('</head>', '<link rel="stylesheet" href="../outside.css"></head>'),
    });
    const path = join(workspace, 'escaping.card.zip');
    await writeFile(path, zip);

    const { code, stdout } = await cli(path);
    expect(code).toBe(1);
    expect(stdout).toContain('relative-reference-escapes-package');
  });
});

describe('check-card CLI: nothing it reaches imports an npm package', () => {
  it('runs on a bare Node install', async () => {
    // Walked statically rather than probed at runtime: the point is that the
    // whole reachable graph is dependency-free, and a runtime probe only ever
    // proves it for the paths that one run happened to take.
    const seen = new Set();
    const visit = async (path) => {
      if (seen.has(path)) {
        return;
      }
      seen.add(path);
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
        const specifier = match[1];
        expect(
          specifier.startsWith('node:') || specifier.startsWith('.'),
          `${path} imports ${specifier}`,
        ).toBe(true);
        if (specifier.startsWith('.')) {
          await visit(resolve(dirname(path), specifier));
        }
      }
    };
    await visit(CLI);
    expect(seen.size).toBeGreaterThan(1);
  });
});
