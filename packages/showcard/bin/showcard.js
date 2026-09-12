#!/usr/bin/env node
/**
 * showcard — three tools over the showcard specification's conformance suite:
 *
 *   showcard validate <file-or-dir...>   section 9.3 static checks
 *   showcard conformance [--adapter m]   section 9.6 / 9.1 host probe suite
 *   showcard shim <card.html>            headless mount + capabilities smoke test
 *
 * Everything the three subcommands run on is vendored into ../vendor at pack
 * time (see ../scripts/assemble.mjs) from this monorepo's reference host and
 * conformance suite. This file only adds argument parsing, file discovery, and
 * printing around that vendored code — the suite logic itself lives there.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(BIN_DIR);
const VENDOR = join(PACKAGE_ROOT, 'vendor');

// reference/src/host.js reads a card's manifest with a bare `new DOMParser()`
// (readCardManifest), which is a browser global. The suite's own tests run
// under vitest's jsdom *environment*, where that global already exists; this
// CLI is a plain Node process, so it has no DOMParser until one is installed.
// A single jsdom-backed DOMParser is enough for every subcommand below — it
// parses standalone strings and is not tied to the window that created it.
globalThis.DOMParser = new JSDOM('').window.DOMParser;

const { checkCardPackage } = await import(pathToFileURL(join(VENDOR, 'conformance/src/static-checks.js')));
const { readZipPackage } = await import(pathToFileURL(join(VENDOR, 'conformance/src/zip-read.js')));
const { runHostSuite } = await import(pathToFileURL(join(VENDOR, 'conformance/src/host-suite.js')));
const { createReferenceHostAdapter } = await import(
  pathToFileURL(join(VENDOR, 'conformance/src/reference-adapter.js'))
);
const { NOT_AUTOMATED } = await import(pathToFileURL(join(VENDOR, 'conformance/src/levels.js')));
const { mountCard, createMemoryStateStore } = await import(pathToFileURL(join(VENDOR, 'reference/src/host.js')));
const { CARD_REQUEST_TYPE, openCardWindow } = await import(
  pathToFileURL(join(VENDOR, 'conformance/src/card-window.js'))
);

async function packageVersion() {
  const raw = await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

const TOP_USAGE = `usage: showcard <command> [options]

commands:
  validate <file-or-dir...>   check card files, package directories, collections, or .card.zip archives
  conformance [--adapter m]   run the host probe suite (section 9.6 / 9.1)
  shim <card.html>            mount a card in the headless reference host and report

  --help, -h    show this help (or a command's help: showcard <command> --help)
  --version, -v show the installed showcard version`;

/* ---------------------------------------------------------------------- */
/* validate                                                                */
/* ---------------------------------------------------------------------- */

const VALIDATE_USAGE = `usage: showcard validate <file-or-dir...>

Runs the section 9.3 static checks. A directory containing index.html is one
package, including its assets. A directory without index.html is a collection:
package subdirectories, *.card.html and *.card.zip are discovered recursively.
A ZIP is checked as a package; any other file is a single-document card.

Exit codes: 0 clean or warnings only, 1 at least one file has an error,
2 the command itself could not run (bad arguments, unreadable path).`;

async function findCardTargets(root) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && entry.name === 'index.html')) { found.push(dir); return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.card\.(html|zip)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  }
  await walk(root);
  found.sort();
  return found;
}

function reportFindings(file, findings) {
  const lines = [file];
  if (findings.length === 0) {
    lines.push('  no findings');
    return lines.join('\n');
  }
  const width = Math.max(...findings.map((finding) => finding.rule.length));
  for (const finding of findings) {
    lines.push(
      `  ${finding.level.padEnd(7)}  ${finding.rule.padEnd(width)}  ${finding.file || 'index.html'}:${String(finding.line).padEnd(5)}  ${finding.message}`,
    );
  }
  const errors = findings.filter((finding) => finding.level === 'error').length;
  lines.push(`  ${errors} error(s), ${findings.length - errors} warning(s)`);
  return lines.join('\n');
}

async function runValidate(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${VALIDATE_USAGE}\n`);
    return 0;
  }
  if (args.length === 0) {
    process.stderr.write(`showcard validate: no file or directory given\n\n${VALIDATE_USAGE}\n`);
    return 2;
  }

  const files = [];
  for (const target of args) {
    let info;
    try {
      info = await stat(target);
    } catch (error) {
      process.stderr.write(`showcard validate: cannot read ${target}: ${error.message}\n`);
      return 2;
    }
    if (info.isDirectory()) {
      const found = await findCardTargets(target);
      if (found.length === 0) {
        process.stderr.write(`showcard validate: no card files or packages found under ${target}\n`);
        return 2;
      }
      files.push(...found);
    } else {
      files.push(target);
    }
  }

  let sawError = false;
  const blocks = [];
  for (const file of files) {
    let loaded;
    try {
      const info = await stat(file);
      if (info.isDirectory()) {
        loaded = new Map();
        async function walk(directory) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const full = join(directory, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) loaded.set(relative(file, full).split(sep).join('/'), await readFile(full));
          }
        }
        await walk(file);
      } else if (/\.zip$/i.test(file)) {
        loaded = readZipPackage(await readFile(file));
      } else {
        loaded = new Map([['index.html', await readFile(file, 'utf8')]]);
      }
    } catch (error) {
      process.stderr.write(`showcard validate: cannot read ${file}: ${error.message}\n`);
      return 2;
    }
    const { findings } = checkCardPackage(loaded);
    if (findings.some((finding) => finding.level === 'error')) sawError = true;
    blocks.push(reportFindings(file, findings));
  }

  process.stdout.write(`${blocks.join('\n\n')}\n`);
  return sawError ? 1 : 0;
}

/* ---------------------------------------------------------------------- */
/* conformance                                                             */
/* ---------------------------------------------------------------------- */

const CONFORMANCE_USAGE = `usage: showcard conformance [--adapter <module.mjs>]

Runs the section 9.6 / 9.1 host probe suite. Without --adapter, the probes run
against the reference host shim vendored into this package, headless via
jsdom.

--adapter <module.mjs>   run against a third-party host instead. The module's
                         default export must be a factory function:

                           export default function createMyHostAdapter(options) {
                             return {
                               async mount(cardSource, cardId) {
                                 // cardSource: a string (one document), or
                                 // { entry, files } (a real package).
                                 return { getDocument(), remount(), unmount() };
                               },
                             };
                           }

                         See README.md for the full adapter contract.

Prints a pass/fail line per probe judgment, then a level summary in the
specification's card.l0 / host.l1 style. L2 and L3 are host obligations this
suite cannot automate (no card-reachable hook exists for either), so they
always print as not-automated, never as a pass.

Exit codes: 0 every probe passed, 1 at least one probe failed,
2 the command itself could not run (bad --adapter path or shape).`;

async function loadDefaultAdapter() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://showcard-cli.localhost/' });
  const adapter = createReferenceHostAdapter({ document: dom.window.document });
  return {
    adapter,
    async cleanup() {
      // A package-shaped probe starts a real node:http server on first use
      // (see reference-adapter.js); left open, this process would never
      // exit on its own once the probe suite is done with it.
      if (typeof adapter.close === 'function') {
        await adapter.close();
      }
      dom.window.close();
    },
  };
}

async function loadCustomAdapter(modulePath) {
  const resolved = resolve(process.cwd(), modulePath);
  let mod;
  try {
    mod = await import(pathToFileURL(resolved));
  } catch (error) {
    throw new Error(`could not import ${resolved}: ${error.message}`);
  }
  const factory = mod.default;
  if (typeof factory !== 'function') {
    throw new Error(`${resolved} must have a default export that is a factory function, got ${typeof factory}`);
  }
  const adapter = await factory();
  if (!adapter || typeof adapter.mount !== 'function') {
    throw new Error(`${resolved}'s default export must return an object with a mount(cardSource, cardId) function`);
  }
  return { adapter, cleanup: async () => { if (typeof adapter.close === 'function') await adapter.close(); } };
}

function printProbeResults(result) {
  const lines = [];
  for (const card of result.cards) {
    lines.push(`${card.file}  (${card.cardId})  ${card.pass ? 'pass' : 'fail'}`);
    for (const verdict of card.verdicts) {
      if (verdict.verdict === 'pass' && card.pass) {
        continue; // a fully-passing card's individual judgments are noise; show them only when something failed
      }
      lines.push(`  ${verdict.verdict.padEnd(4)}  ${verdict.probe}  ${verdict.detail}`);
    }
  }
  lines.push('');
  lines.push(`host.l1: ${result.pass ? 'pass' : 'fail'}`);
  lines.push(`host.l2: ${NOT_AUTOMATED}`);
  lines.push(`host.l3: ${NOT_AUTOMATED}`);
  return lines.join('\n');
}

async function runConformance(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${CONFORMANCE_USAGE}\n`);
    return 0;
  }

  let adapterModule = null;
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '--adapter') {
      adapterModule = args[at + 1];
      at += 1;
      continue;
    }
    if (args[at].startsWith('--adapter=')) {
      adapterModule = args[at].slice('--adapter='.length);
      continue;
    }
    process.stderr.write(`showcard conformance: unknown argument ${JSON.stringify(args[at])}\n\n${CONFORMANCE_USAGE}\n`);
    return 2;
  }
  if (adapterModule === undefined) {
    process.stderr.write(`showcard conformance: --adapter needs a value\n\n${CONFORMANCE_USAGE}\n`);
    return 2;
  }

  let loaded;
  try {
    loaded = adapterModule === null ? await loadDefaultAdapter() : await loadCustomAdapter(adapterModule);
  } catch (error) {
    process.stderr.write(`showcard conformance: ${error.message}\n`);
    return 2;
  }

  try {
    const result = await runHostSuite(loaded.adapter);
    process.stdout.write(`${printProbeResults(result)}\n`);
    return result.pass ? 0 : 1;
  } finally {
    await loaded.cleanup();
  }
}

/* ---------------------------------------------------------------------- */
/* shim                                                                    */
/* ---------------------------------------------------------------------- */

const SHIM_USAGE = `usage: showcard shim <card.html>

Headless smoke tool, not a browser: mounts one card in the vendored reference
host (jsdom, no visible page) and prints what the mount produced — the
manifest's declared contract version, the sandbox iframe, whether the card
rendered content, and the capabilities envelope card.capabilities() returns
inside the card. It does not simulate user interaction and it is not a
substitute for opening the card in a real browser.

Exit codes: 0 the card mounted and ran without an uncaught script error,
1 an uncaught script error occurred while the card ran,
2 the command itself could not run (missing file, mount failure).`;

function rendersSomething(document) {
  const invisible = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'TITLE']);
  const body = document.body;
  if (!body) {
    return false;
  }
  for (const element of body.querySelectorAll('*')) {
    if (!invisible.has(element.tagName)) {
      return true;
    }
  }
  for (const node of body.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim() !== '') {
      return true;
    }
  }
  return false;
}

async function runShim(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${SHIM_USAGE}\n`);
    return 0;
  }
  if (args.length !== 1) {
    process.stderr.write(`showcard shim: needs exactly one card file\n\n${SHIM_USAGE}\n`);
    return 2;
  }

  const file = args[0];
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    process.stderr.write(`showcard shim: cannot read ${file}: ${error.message}\n`);
    return 2;
  }

  const cardId = basename(file).replace(/\.card\.html$/i, '').replace(/\.html$/i, '') || 'shim-card';
  const hostDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://showcard-cli.localhost/' });
  const container = hostDom.window.document.createElement('div');
  hostDom.window.document.body.appendChild(container);
  const stateStore = createMemoryStateStore();

  let mounted;
  try {
    mounted = mountCard({ container, cardSource: source, cardId, stateStore, executeBinding: null });
  } catch (error) {
    hostDom.window.close();
    process.stderr.write(`showcard shim: mount failed: ${error.message}\n`);
    return 2;
  }

  let cardWindowHandle;
  try {
    cardWindowHandle = await openCardWindow({
      documentText: mounted.iframe.getAttribute('srcdoc'),
      respond: (message) =>
        message.type === CARD_REQUEST_TYPE ? mounted.dispatch(message.capability, message.payload) : undefined,
    });
  } catch (error) {
    mounted.unmount();
    hostDom.window.close();
    process.stderr.write(`showcard shim: could not open the card window: ${error.message}\n`);
    return 2;
  }

  const lines = [];
  lines.push(`file:                ${file}`);
  lines.push(`card id:             ${cardId}`);
  lines.push(`spec version:        ${mounted.specVersion}${mounted.specSupported ? '' : ' (unsupported by this host)'}`);
  lines.push(`manifest parse error: ${mounted.manifestParseError || 'none'}`);
  lines.push(`iframe sandbox:      ${mounted.iframe.getAttribute('sandbox')}`);
  lines.push(`renders content:     ${rendersSomething(cardWindowHandle.document)}`);
  lines.push(`uncaught errors:     ${cardWindowHandle.errors.length}`);
  for (const error of cardWindowHandle.errors) {
    lines.push(`  - ${error.message.split('\n')[0]}`);
  }

  let capabilities = null;
  const cardApi = cardWindowHandle.window.card;
  if (cardApi && typeof cardApi.capabilities === 'function') {
    try {
      capabilities = await cardApi.capabilities();
    } catch (error) {
      capabilities = { ok: false, error: `card.capabilities() threw: ${error.message}` };
    }
  } else {
    capabilities = { ok: false, error: 'window.card.capabilities is not a function; the runtime did not install' };
  }
  lines.push('capabilities envelope:');
  lines.push(
    JSON.stringify(capabilities, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );

  process.stdout.write(`${lines.join('\n')}\n`);

  const uncaughtErrors = cardWindowHandle.errors.length;
  cardWindowHandle.close();
  mounted.unmount();
  hostDom.window.close();

  return uncaughtErrors > 0 ? 1 : 0;
}

/* ---------------------------------------------------------------------- */
/* dispatch                                                                */
/* ---------------------------------------------------------------------- */

async function main(argv) {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${TOP_USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${await packageVersion()}\n`);
    return 0;
  }

  if (command === 'validate') {
    return runValidate(rest);
  }
  if (command === 'conformance') {
    return runConformance(rest);
  }
  if (command === 'shim') {
    return runShim(rest);
  }

  process.stderr.write(`showcard: unknown command ${JSON.stringify(command)}\n\n${TOP_USAGE}\n`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
