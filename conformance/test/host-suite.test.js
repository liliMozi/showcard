import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMemoryStateStore } from '../../reference/src/host.js';
import { PROBE_CARDS, probeLabel, runHostSuite } from '../src/host-suite.js';
import { createReferenceHostAdapter } from '../src/reference-adapter.js';
import { checkCardDocument, checkCardPackage } from '../src/static-checks.js';

const PROBE_DIRECTORY = resolve(process.cwd(), 'conformance/probes');

const verdictMap = (result) => {
  const flat = {};
  for (const card of result.cards) {
    for (const verdict of card.verdicts) {
      flat[verdict.probe] = verdict;
    }
  }
  return flat;
};

async function readPackageFiles(root) {
  const files = new Map();
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relPath);
      } else {
        files.set(relPath, await readFile(full, 'utf8'));
      }
    }
  }
  await walk(root, '');
  return files;
}

describe('the probe cards are themselves legal cards (section 9.3)', () => {
  it('every probe card passes the static checks with no errors', async () => {
    for (const probe of PROBE_CARDS) {
      const label = probeLabel(probe);
      const { findings } = probe.file
        ? checkCardDocument(await readFile(join(PROBE_DIRECTORY, probe.file), 'utf8'))
        : checkCardPackage(await readPackageFiles(join(PROBE_DIRECTORY, probe.dir)));
      expect(findings.filter((finding) => finding.level === 'error'), label).toEqual([]);
    }
  });

  it('lists at least the eight judgments the suite owes (section 9.6 / 9.1)', () => {
    expect(PROBE_CARDS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('runHostSuite against the in-repo reference adapter', () => {
  it('passes every probe', async () => {
    const result = await runHostSuite(createReferenceHostAdapter());
    const failed = result.cards
      .flatMap((card) => card.verdicts.map((verdict) => ({ card: card.file, ...verdict })))
      .filter((verdict) => verdict.verdict !== 'pass');
    expect(failed).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('reaches the specific judgments the specification names', async () => {
    const verdicts = verdictMap(await runHostSuite(createReferenceHostAdapter()));
    for (const name of [
      'envelope-shape-resolves',
      'envelope-shape-failure',
      'capabilities-environment',
      'capabilities-state-word',
      'capabilities-invoke-word',
      'emit-is-function',
      'emit-legal-envelope',
      'emit-to-echoed',
      'emit-illegal-name',
      'emit-capability-word',
      'state-set-key',
      'state-get-all',
      'state-persistence',
      'state-budget-refused',
      'state-budget-no-truncation',
      'undeclared-binding',
      'contract-unsupported-state',
      'sugar-invoke',
      'sugar-persist',
      'sugar-result',
      'passive-reference-not-loaded',
      'blocked-resource-placeholder',
      'package-stylesheet-resolved',
      'package-image-reference-resolved',
    ]) {
      expect(verdicts[name], name).toBeDefined();
      expect(verdicts[name].verdict, name).toBe('pass');
    }
  });

  it('checks from outside that a card of an unsupported contract version still rendered', async () => {
    const result = await runHostSuite(createReferenceHostAdapter());
    const card = result.cards.find((entry) => entry.file === 'contract-unsupported.card.html');
    const renders = card.verdicts.find((verdict) => verdict.probe === 'document-renders');
    expect(renders.verdict).toBe('pass');
    expect(renders.source).toBe('driver');
  });

  it('rejects an adapter that does not implement the interface', async () => {
    await expect(runHostSuite({})).rejects.toThrow(TypeError);
    await expect(runHostSuite(null)).rejects.toThrow(TypeError);
  });
});

describe('the driver proves itself against a host that gets it wrong', () => {
  /** A host that keeps state within one mount and loses it across a remount. */
  function createForgetfulHostAdapter() {
    const store = createMemoryStateStore();
    const base = createReferenceHostAdapter({ stateStore: store });
    return {
      async mount(cardSource, cardId) {
        const handle = await base.mount(cardSource, cardId);
        return {
          getDocument: () => handle.getDocument(),
          async remount() {
            await store.set(cardId, {});
            return handle.remount();
          },
          unmount: () => handle.unmount(),
        };
      },
    };
  }

  /** A host whose answers are not envelopes: no `ok`, no `code`. */
  function createShapelessHostAdapter() {
    return createReferenceHostAdapter({
      dispatch: async () => ({ data: 'here you go' }),
    });
  }

  it('fails the persistence probe when state does not survive a remount', async () => {
    const result = await runHostSuite(createForgetfulHostAdapter());
    const verdicts = verdictMap(result);
    expect(verdicts['state-persistence'].verdict).toBe('fail');
    expect(result.pass).toBe(false);
    // The rest of the suite still reports honestly rather than collapsing.
    expect(verdicts['undeclared-binding'].verdict).toBe('pass');
    expect(verdicts['capabilities-environment'].verdict).toBe('pass');
  });

  it('fails the probes that need a working host when the answers are not envelopes', async () => {
    const result = await runHostSuite(createShapelessHostAdapter());
    const verdicts = verdictMap(result);
    expect(result.pass).toBe(false);
    for (const name of ['capabilities-envelope', 'state-set-key', 'state-get-all', 'undeclared-binding']) {
      expect(verdicts[name].verdict, name).toBe('fail');
    }
  });

  it('still answers the card with an envelope even then, which is the point of section 2.4', async () => {
    // A host that talks nonsense does not get to make a card throw: the
    // injection layer turns an unreadable answer into CARD_HOST_INVALID_RESPONSE
    // (section 2.6). So the envelope-shape probes pass against a broken host,
    // and the probes that wanted the host to actually work are the ones that
    // fail. Both halves of that are the specified behaviour.
    const verdicts = verdictMap(await runHostSuite(createShapelessHostAdapter()));
    expect(verdicts['envelope-shape-resolves'].verdict).toBe('pass');
    expect(verdicts['envelope-shape-failure'].verdict).toBe('pass');
    expect(verdicts['envelope-shape-failure'].detail).toContain('CARD_HOST_INVALID_RESPONSE');
  });

  it('fails a card that never finishes rather than reporting an empty pass', async () => {
    const stalling = {
      async mount() {
        return {
          getDocument: () => null,
          remount: async () => {},
          unmount: async () => {},
        };
      },
    };
    const result = await runHostSuite(stalling, { probeTimeoutMs: 60 });
    expect(result.pass).toBe(false);
    for (const card of result.cards) {
      expect(card.verdicts.some((verdict) => verdict.verdict === 'fail'), card.file).toBe(true);
    }
  });
});
