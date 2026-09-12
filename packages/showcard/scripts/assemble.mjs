#!/usr/bin/env node
/**
 * Assemble packages/showcard/vendor/ from the monorepo's suite sources.
 *
 * Runs as the package's `prepack` hook (so `npm pack` always regenerates it),
 * and can also be run by hand or by the CLI smoke tests to populate `vendor/`
 * before the bin script is exercised in place.
 *
 * The file list is an explicit allowlist, not a directory copy: the tarball
 * must never carry `spec/`, `docs/`, or either repo README — this script is
 * the one place that decides what leaves the repo, so it names every file.
 *
 * Deterministic: same inputs produce the same `vendor/` tree every time (plain
 * file copies, no timestamps or environment baked in), and it always starts
 * from a clean `vendor/` so a stale file from a previous run can never linger.
 */

import { cp, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(PACKAGE_ROOT));
const VENDOR_ROOT = join(PACKAGE_ROOT, 'vendor');

/**
 * Every file that ends up in the tarball's `vendor/` tree, as
 * `[repo-relative source, vendor-relative destination]` pairs. Destinations
 * mirror the source layout (`reference/src/...`, `conformance/src/...`) so the
 * relative imports inside these files resolve unchanged.
 */
const REFERENCE_SRC_FILES = [
  'host.js',
  'wrap.js',
  'codes.js',
  'runtime-source.js',
  'placeholder-source.js',
  'serve.js',
  'node-serve.js',
];

const CONFORMANCE_SRC_FILES = [
  'static-checks.js',
  'zip-read.js',
  'rules.js',
  'host-suite.js',
  'reference-adapter.js',
  'card-window.js',
  'levels.js',
];

/**
 * Probe entries as they read the source tree: a flat `*.card.html` file, or a
 * package directory (an `index.html` plus its own `assets/`). Mirrors
 * `conformance/src/host-suite.js`'s `PROBE_CARDS` — a probe's shape here has
 * to match its shape there, or the vendored bundle would ship a probe the
 * vendored `host-suite.js` cannot find.
 */
async function listProbeEntries() {
  const entries = await readdir(join(REPO_ROOT, 'conformance', 'probes'), { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.card.html')).map((entry) => entry.name);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  files.sort();
  dirs.sort();
  return { files, dirs };
}

async function copyInto(sourceDir, destDir, fileNames) {
  await mkdir(destDir, { recursive: true });
  for (const name of fileNames) {
    await copyFile(join(sourceDir, name), join(destDir, name));
  }
}

async function main() {
  await rm(VENDOR_ROOT, { recursive: true, force: true });

  await copyInto(
    join(REPO_ROOT, 'reference', 'src'),
    join(VENDOR_ROOT, 'reference', 'src'),
    REFERENCE_SRC_FILES,
  );

  await copyInto(
    join(REPO_ROOT, 'conformance', 'src'),
    join(VENDOR_ROOT, 'conformance', 'src'),
    CONFORMANCE_SRC_FILES,
  );

  const { files: probeFiles, dirs: probeDirs } = await listProbeEntries();
  await copyInto(join(REPO_ROOT, 'conformance', 'probes'), join(VENDOR_ROOT, 'conformance', 'probes'), probeFiles);
  for (const dir of probeDirs) {
    await cp(
      join(REPO_ROOT, 'conformance', 'probes', dir),
      join(VENDOR_ROOT, 'conformance', 'probes', dir),
      { recursive: true },
    );
  }

  const total = REFERENCE_SRC_FILES.length + CONFORMANCE_SRC_FILES.length + probeFiles.length + probeDirs.length;
  process.stdout.write(`assemble: vendored ${total} file/directory entries into ${VENDOR_ROOT}\n`);
}

await main();
