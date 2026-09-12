#!/usr/bin/env node
/**
 * check-card — the section 9.3 static checks as a command.
 *
 * Zero npm dependencies on purpose (the zip reader in `../src/zip-read.js`
 * uses only `node:zlib`). This is the piece a host runs in its mint and
 * import paths (section 5.4), and in CI over a folder of cards; anything it
 * had to install would be a reason not to run it.
 *
 *   node conformance/bin/check-card.mjs <target...>
 *
 * A target is any of the three package shapes section 6 defines:
 *   - a directory holding `index.html` (and optionally `assets/`) — a card
 *     package (section 6.1);
 *   - a `.card.zip` — the same package, zipped for sharing (section 6.3);
 *   - a single file (typically `*.card.html`) — the degenerate package,
 *     checked as if it were that package's whole `index.html` (section 6.2).
 *
 * Exit codes: 0 clean or warnings only, 1 at least one error, 2 the command
 * itself could not run. Warnings do not fail the command: the natural-language
 * title rule and the display-width band are SHOULD-level in the specification,
 * and a checker that fails a build over a SHOULD is a checker people learn to
 * skip.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import process from 'node:process';

import { checkCardPackage } from '../src/static-checks.js';
import { PACKAGE_ENTRY_NAME } from '../src/rules.js';
import { readZipPackage } from '../src/zip-read.js';

const USAGE = `usage: check-card <target...>

  A target is a card package directory, a *.card.zip, or a single file
  (typically *.card.html) checked as a degenerate package's entry.`;

/** Recursively list every file under a directory, as package-relative POSIX paths. */
async function readDirectoryPackage(root) {
  const files = new Map();
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const relPath = relative(root, full).split(sep).join('/');
        files.set(relPath, await readFile(full));
      }
    }
  }
  await walk(root);
  return files;
}

/**
 * Load a target into `{ label, files }`, where `files` is what
 * `checkCardPackage` wants: `Map<packageRelativePath, string|Uint8Array>`.
 */
async function loadTarget(target) {
  const info = await stat(target);

  if (info.isDirectory()) {
    return { label: target, files: await readDirectoryPackage(target) };
  }
  if (/\.zip$/i.test(target)) {
    const bytes = await readFile(target);
    return { label: target, files: readZipPackage(bytes) };
  }
  const text = await readFile(target, 'utf8');
  return { label: target, files: new Map([[PACKAGE_ENTRY_NAME, text]]) };
}

function report(label, findings) {
  const lines = [basename(label)];
  if (findings.length === 0) {
    lines.push('  no findings');
    return lines.join('\n');
  }
  const width = Math.max(...findings.map((finding) => finding.rule.length));
  for (const finding of findings) {
    lines.push(
      `  ${finding.level.padEnd(7)}  ${finding.rule.padEnd(width)}  ${finding.file}:${finding.line}  ${finding.message}`,
    );
  }
  const errors = findings.filter((finding) => finding.level === 'error').length;
  lines.push(`  ${errors} error(s), ${findings.length - errors} warning(s)`);
  return lines.join('\n');
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (argv.length === 0) {
    process.stderr.write(`check-card: no target to check\n\n${USAGE}\n`);
    return 2;
  }

  let sawError = false;
  const blocks = [];

  for (const target of argv) {
    let loaded;
    try {
      loaded = await loadTarget(target);
    } catch (error) {
      // A target that could not be read is not a card finding: "this card is
      // bad" and "I could not look at this card" are different answers and
      // must not share an exit code.
      process.stderr.write(`check-card: cannot read ${target}: ${error.message}\n`);
      return 2;
    }

    const { findings } = checkCardPackage(loaded.files, { entry: PACKAGE_ENTRY_NAME });
    if (findings.some((finding) => finding.level === 'error')) {
      sawError = true;
    }
    blocks.push(report(loaded.label, findings));
  }

  process.stdout.write(`${blocks.join('\n\n')}\n`);
  return sawError ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
