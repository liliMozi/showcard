/**
 * Smoke tests for the packaged `showcard` CLI (packages/showcard).
 *
 * These run the CLI the way an installed user would: as a child process,
 * against the vendored copy of the suite in packages/showcard/vendor/ rather
 * than against conformance/src or reference/src directly. beforeAll runs the
 * same assemble script `npm pack`'s `prepack` hook runs, so these tests
 * exercise the exact vendoring path the tarball ships with.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildZip } from '../../../conformance/test/helpers/build-zip.js';

const run = promisify(execFile);

const PACKAGE_ROOT = resolve(process.cwd(), 'packages/showcard');
const CLI = join(PACKAGE_ROOT, 'bin/showcard.js');
const ASSEMBLE = join(PACKAGE_ROOT, 'scripts/assemble.mjs');
const PROBE_DIR = resolve(process.cwd(), 'conformance/probes');

let workspace;

async function cli(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { timeout: 15000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

async function write(name, contents) {
  const path = join(workspace, name);
  await writeFile(path, contents, 'utf8');
  return path;
}

const VALID_CARD = [
  '<!DOCTYPE html>',
  '<html><head>',
  '<meta charset="utf-8">',
  '<meta name="card-id" content="smoke-test-card">',
  '<title>Smoke test card</title>',
  '</head><body><p>Nothing to see here.</p></body></html>',
  '',
].join('\n');

// Section 7.2 retired the ban on a network-shaped reference; what still fails
// validation is a missing title (section 1.3).
const BROKEN_CARD = VALID_CARD.replace('<title>Smoke test card</title>\n', '');

const THROWING_CARD = [
  '<!DOCTYPE html>',
  '<html><head>',
  '<meta charset="utf-8">',
  '<meta name="card-id" content="throwing-card">',
  '<title>Throwing card</title>',
  '</head><body><p>boom incoming</p><script>throw new Error("boom");</script></body></html>',
  '',
].join('\n');

beforeAll(async () => {
  // Same script npm pack's prepack hook runs; populates PACKAGE_ROOT/vendor/.
  await run(process.execPath, [ASSEMBLE]);
  workspace = await mkdtemp(join(tmpdir(), 'showcard-cli-smoke-'));
}, 30000);

afterAll(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe('top-level', () => {
  it('--help lists all three subcommands and exits 0', async () => {
    const { code, stdout } = await cli('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('validate');
    expect(stdout).toContain('conformance');
    expect(stdout).toContain('shim');
  });

  it('--version prints the package version and exits 0', async () => {
    const { code, stdout } = await cli('--version');
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('0.9.2');
  });

  it('exits 2 with usage on an unknown command', async () => {
    const { code, stderr } = await cli('frobnicate');
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('exits 2 with usage when given no command', async () => {
    const { code, stdout } = await cli();
    expect(code).toBe(2);
    expect(stdout).toContain('usage: showcard');
  });
});

describe('showcard validate', () => {
  it('checks a directory package and catches secrets in its assets', async () => {
    const root = join(workspace, 'package');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), VALID_CARD);
    expect((await cli('validate', root)).code).toBe(0);
    await writeFile(join(root, 'assets', 'accidental.txt'), 'sk-' + 'x'.repeat(32));
    const result = await cli('validate', root);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('secret-pattern');
    expect(result.stdout).toContain('assets/accidental.txt');
    expect(result.stdout).not.toContain('sk-' + 'x'.repeat(32));
  });

  it('checks a ZIP package including non-entry assets', async () => {
    const file = join(workspace, 'package.card.zip');
    await writeFile(file, buildZip({ 'index.html': VALID_CARD, 'assets/style.css': 'body { color: black; }' }));
    expect((await cli('validate', file)).code).toBe(0);
    await writeFile(file, buildZip({ 'index.html': VALID_CARD, 'assets/secret.txt': 'sk-' + 'x'.repeat(32) }));
    expect((await cli('validate', file)).code).toBe(1);
  });

  it('--help exits 0', async () => {
    const { code, stdout } = await cli('validate', '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('usage: showcard validate');
  });

  it('exits 0 with no findings on a compliant probe card', async () => {
    const { code, stdout } = await cli('validate', join(PROBE_DIR, 'envelope-shape.card.html'));
    expect(code).toBe(0);
    expect(stdout).toContain('no findings');
  });

  it('exits 1 and names the rule on a card with no title', async () => {
    const path = await write('broken.card.html', BROKEN_CARD);
    const { code, stdout } = await cli('validate', path);
    expect(code).toBe(1);
    expect(stdout).toContain('title-missing');
    expect(stdout).toContain('error');
  });

  it('recurses into a directory and checks every *.card.html file under it', async () => {
    const { code, stdout } = await cli('validate', PROBE_DIR);
    expect(code).toBe(0);
    expect(stdout).toContain('envelope-shape.card.html');
    expect(stdout).toContain('sugar-result.card.html');
  });

  it('exits 2 when the path does not exist', async () => {
    const { code, stderr } = await cli('validate', join(workspace, 'does-not-exist.card.html'));
    expect(code).toBe(2);
    expect(stderr).toContain('cannot read');
  });
});

describe('showcard conformance', () => {
  it('--help exits 0', async () => {
    const { code, stdout } = await cli('conformance', '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('usage: showcard conformance');
  });

  it('runs the full probe suite against the bundled reference adapter and passes', async () => {
    const { code, stdout } = await cli('conformance');
    expect(code).toBe(0);
    expect(stdout).toContain('envelope-shape.card.html');
    expect(stdout).toContain('sugar-result.card.html');
    expect(stdout).toContain('host.l1: pass');
    expect(stdout).toContain('host.l2: not-automated');
    expect(stdout).toContain('host.l3: not-automated');
  }, 60000);

  it('exits 2 when --adapter points at a module with no default export', async () => {
    const path = await write('bad-adapter.mjs', 'export const notDefault = () => ({});\n');
    const { code, stderr } = await cli('conformance', '--adapter', path);
    expect(code).toBe(2);
    expect(stderr).toContain('default export');
  });

  it('exits 2 when --adapter points at a module that does not exist', async () => {
    const { code, stderr } = await cli('conformance', '--adapter', join(workspace, 'nope.mjs'));
    expect(code).toBe(2);
    expect(stderr).toContain('could not import');
  });

  it('exits 2 when --adapter is given with no value', async () => {
    const { code, stderr } = await cli('conformance', '--adapter');
    expect(code).toBe(2);
    expect(stderr).toContain('needs a value');
  });
});

describe('showcard shim', () => {
  it('--help exits 0', async () => {
    const { code, stdout } = await cli('shim', '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('usage: showcard shim');
  });

  it('mounts a compliant card and prints a capabilities envelope', async () => {
    const path = await write('shim-good.card.html', VALID_CARD);
    const { code, stdout } = await cli('shim', path);
    expect(code).toBe(0);
    expect(stdout).toContain('card id:');
    expect(stdout).toContain('capabilities envelope:');
    expect(stdout).toContain('"ok": true');
    expect(stdout).toContain('uncaught errors:     0');
  });

  it('exits 1 and reports the error when the card throws', async () => {
    const path = await write('shim-throws.card.html', THROWING_CARD);
    const { code, stdout } = await cli('shim', path);
    expect(code).toBe(1);
    expect(stdout).toContain('uncaught errors:     1');
    expect(stdout).toContain('boom');
  });

  it('exits 2 when the file does not exist', async () => {
    const { code, stderr } = await cli('shim', join(workspace, 'nope.card.html'));
    expect(code).toBe(2);
    expect(stderr).toContain('cannot read');
  });

  it('exits 2 when given no file', async () => {
    const { code, stderr } = await cli('shim');
    expect(code).toBe(2);
    expect(stderr).toContain('needs exactly one card file');
  });
});

describe('documented custom adapter', () => {
  it('completes the suite and closes its package server', async () => {
    const result = await cli('conformance', '--adapter', resolve('examples/host/adapter.mjs'));
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('host.l1: pass');
    expect(result.stdout).toContain('host.l2: not-automated');
  }, 20000);
});
