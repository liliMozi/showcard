/**
 * The host probe suite (specification sections 9.6 and 9.1, the L1 obligations).
 *
 * Everything a host has to get right is asked by a card, from inside the card,
 * through nothing but the public `window.card` surface. Each probe card writes
 * its findings into its own DOM as
 * `<li data-probe="name" data-verdict="pass|fail">detail</li>`, and this driver
 * mounts the cards, waits for them to finish, and reads the list back out.
 *
 * The shape is deliberate. A suite that called host functions directly would be
 * testing one host's API; a suite that reads verdicts out of a card's DOM tests
 * what a card can actually observe, which is the only thing the specification
 * promises anybody.
 *
 * The driver adds two judgments of its own per card, because a card cannot
 * report on its own absence:
 *
 *   - `document-renders`: the static content is in the DOM. This is what makes
 *     the section 6.7 refusal ban testable — a host that declined to open the
 *     card would leave nothing to read.
 *   - `probe-completed`: the card's script ran to the end. Without it, a host
 *     that hangs the socket would produce an empty verdict list and look clean.
 *
 * Adapter interface, all of it optionally async:
 *
 *   adapter.mount(cardSource, cardId) -> {
 *     getDocument(),   // the card's live document
 *     remount(),       // tear down and mount the same card again, same identity
 *     unmount(),
 *   }
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Built with `dirname` rather than a URL: bundlers rewrite the
// `new URL(literal, import.meta.url)` pattern into an asset reference.
const DEFAULT_PROBE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'probes');

const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/**
 * The probe cards, and how to drive them.
 *
 * A probe is one of two shapes: `file` names a single degenerate-package
 * `*.card.html` under `probes/`, read as source text — this is the shape
 * every probe had before the package redefinition, and it is still exactly
 * right for a probe with no assets of its own. `dir` names a package
 * directory under `probes/` (an `index.html` plus its own `assets/`), read
 * into a files map — for a probe that needs to prove something only a real
 * multi-file package can prove, like a relative reference actually
 * resolving against the served package root (section 1.1). Every probe
 * still gets exactly one of the two.
 *
 * `remount: true` marks a card that runs in two phases: the first mount leaves
 * something behind and the second one looks for it. The driver reads the second
 * mount's verdicts.
 */
export const PROBE_CARDS = Object.freeze([
  { file: 'envelope-shape.card.html', cardId: 'probe-envelope-shape' },
  { file: 'capabilities-shape.card.html', cardId: 'probe-capabilities-shape' },
  { file: 'emit-shape.card.html', cardId: 'probe-emit-shape' },
  { file: 'state-roundtrip.card.html', cardId: 'probe-state-roundtrip' },
  { file: 'state-persistence.card.html', cardId: 'probe-state-persistence', remount: true },
  { file: 'state-budget.card.html', cardId: 'probe-state-budget' },
  { file: 'undeclared-binding.card.html', cardId: 'probe-undeclared-binding' },
  { file: 'contract-unsupported.card.html', cardId: 'probe-contract-unsupported' },
  { file: 'sugar-invoke.card.html', cardId: 'probe-sugar-invoke' },
  { file: 'sugar-persist.card.html', cardId: 'probe-sugar-persist' },
  { file: 'sugar-result.card.html', cardId: 'probe-sugar-result' },
  { file: 'passive-placeholder.card.html', cardId: 'probe-passive-placeholder' },
  { dir: 'package-relative-assets', cardId: 'probe-package-relative-assets' },
]);

/** The label a probe is reported under, whichever of the two shapes it is. */
export function probeLabel(probe) {
  return probe.file || probe.dir;
}

/** Read every file under a package directory into `Map<packageRelativePath, string>`. */
async function readPackageFiles(root) {
  const files = new Map();
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relPath);
      } else if (entry.isFile()) {
        files.set(relPath.split(sep).join('/'), await readFile(full, 'utf8'));
      }
    }
  }
  await walk(root, '');
  return files;
}

/** Load a probe's card source: a string for `file`, a `{ entry, files }` package for `dir`. */
async function readProbeSource(probeDirectory, probe) {
  if (probe.file) {
    return readFile(join(probeDirectory, probe.file), 'utf8');
  }
  return { entry: 'index.html', files: await readPackageFiles(join(probeDirectory, probe.dir)) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the card's script says it is finished, or give up and say so. */
async function waitForCompletion(handle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const document = await handle.getDocument();
    const list = document && document.querySelector('[data-probe-status]');
    if (list && list.getAttribute('data-probe-status') === 'done') {
      return { completed: true, document };
    }
    await sleep(10);
  }
  return { completed: false, document: await handle.getDocument() };
}

function readVerdicts(document) {
  if (!document) {
    return [];
  }
  return Array.from(document.querySelectorAll('[data-probe]')).map((element) => ({
    probe: element.getAttribute('data-probe'),
    verdict: element.getAttribute('data-verdict') === 'pass' ? 'pass' : 'fail',
    detail: element.textContent || '',
    source: 'card',
  }));
}

/**
 * Section 6.7 / 9.6: a host must render the document whatever it thinks of the
 * card's contract version. Checked from outside, because a card that was never
 * opened cannot report that it was never opened.
 */
function checkRendering(document) {
  const marker = document && document.querySelector('[data-probe-static]');
  const text = marker ? (marker.textContent || '').trim() : '';
  return {
    probe: 'document-renders',
    verdict: text === '' ? 'fail' : 'pass',
    detail: text === '' ? 'the card document has no rendered static content' : 'the card rendered its static content',
    source: 'driver',
  };
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter.mount !== 'function') {
    throw new TypeError('runHostSuite needs an adapter with a mount(cardSource, cardId) function');
  }
}

/**
 * Run the probe suite against a host.
 *
 * `adapter.mount(cardSource, cardId)` receives one of two shapes now: a
 * string, for a `file`-shaped probe (unchanged from before the package
 * redefinition — a degenerate package is still just its one file); or a
 * `{ entry, files: Map<packageRelativePath, string> }` package descriptor,
 * for a `dir`-shaped probe. A third-party adapter has to handle both; see
 * `reference-adapter.js` for the in-repo one.
 *
 * @param {{ mount: Function }} adapter
 * @param {object} [options]
 * @param {string} [options.probeDirectory] where the probe cards live
 * @param {number} [options.probeTimeoutMs] how long a card gets to finish
 * @returns {Promise<{ pass: boolean, cards: Array }>}
 */
export async function runHostSuite(adapter, options = {}) {
  assertAdapter(adapter);

  const directory = options.probeDirectory || DEFAULT_PROBE_DIRECTORY;
  const timeoutMs = options.probeTimeoutMs || DEFAULT_PROBE_TIMEOUT_MS;
  const cards = [];

  for (const probe of PROBE_CARDS) {
    const label = probeLabel(probe);
    const entry = { file: label, cardId: probe.cardId, verdicts: [], pass: false, error: null };
    let handle = null;

    try {
      const source = await readProbeSource(directory, probe);
      handle = await adapter.mount(source, probe.cardId);
      if (!handle || typeof handle.getDocument !== 'function') {
        throw new TypeError('adapter.mount must return a handle with getDocument()');
      }

      let outcome = await waitForCompletion(handle, timeoutMs);

      if (probe.remount) {
        if (typeof handle.remount !== 'function') {
          throw new TypeError(`the ${label} probe needs an adapter that can remount a card`);
        }
        await handle.remount();
        outcome = await waitForCompletion(handle, timeoutMs);
      }

      entry.verdicts = readVerdicts(outcome.document);
      const reported = entry.verdicts.length;
      entry.verdicts.push(checkRendering(outcome.document));
      entry.verdicts.push({
        probe: `probe-completed:${label}`,
        verdict: outcome.completed && reported > 0 ? 'pass' : 'fail',
        detail: outcome.completed
          ? `the probe script ran to the end and reported ${reported} judgment(s)`
          : `the probe script did not finish within ${timeoutMs} ms`,
        source: 'driver',
      });
    } catch (error) {
      entry.error = String(error.message || error);
      entry.verdicts.push({
        probe: `probe-completed:${label}`,
        verdict: 'fail',
        detail: `the probe could not be run: ${entry.error}`,
        source: 'driver',
      });
    } finally {
      if (handle && typeof handle.unmount === 'function') {
        try {
          await handle.unmount();
        } catch (error) {
          // A host that cannot tear a card down is a finding about that host,
          // not a reason to abandon the rest of the suite.
          entry.verdicts.push({
            probe: `probe-unmount:${label}`,
            verdict: 'fail',
            detail: `unmount failed: ${String(error.message || error)}`,
            source: 'driver',
          });
        }
      }
    }

    entry.pass = entry.verdicts.length > 0 && entry.verdicts.every((verdict) => verdict.verdict === 'pass');
    cards.push(entry);
  }

  return { pass: cards.every((card) => card.pass), cards };
}
