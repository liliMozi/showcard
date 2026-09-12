import { describe, expect, it } from 'vitest';

import { injectRuntimeIntoDocument } from '../../reference/src/wrap.js';
import { NOT_AUTOMATED, determineLevels } from '../src/levels.js';
import { runHostSuite } from '../src/host-suite.js';
import { createReferenceHostAdapter } from '../src/reference-adapter.js';
import { runL0Harmlessness } from '../src/l0-run.js';
import { checkCardDocument } from '../src/static-checks.js';

const clean = { findings: [] };
const harmless = { pass: true, violations: [] };
const goodHost = { pass: true, cards: [] };

describe('determineLevels', () => {
  it('passes a card at L0 and a host at L1 when everything is clean', () => {
    expect(determineLevels({ staticResult: clean, l0Result: harmless, hostResult: goodHost })).toEqual({
      card: { l0: 'pass' },
      host: { l1: 'pass', l2: NOT_AUTOMATED, l3: NOT_AUTOMATED },
    });
  });

  it('fails the card at L0 when the static checks found an error', () => {
    const result = determineLevels({
      staticResult: { findings: [{ rule: 'entry-not-a-document', level: 'error', message: '' }] },
      l0Result: harmless,
      hostResult: goodHost,
    });
    expect(result.card.l0).toBe('fail');
  });

  it('does not fail the card at L0 over a warning', () => {
    const result = determineLevels({
      staticResult: { findings: [{ rule: 'manifest-display-width', level: 'warning', message: '' }] },
      l0Result: harmless,
      hostResult: goodHost,
    });
    expect(result.card.l0).toBe('pass');
  });

  it('fails the card at L0 when the harmlessness run found a violation', () => {
    const result = determineLevels({
      staticResult: clean,
      l0Result: { pass: false, violations: [{ kind: 'network', detail: '' }] },
      hostResult: goodHost,
    });
    expect(result.card.l0).toBe('fail');
  });

  it('fails the host at L1 when a probe failed', () => {
    const result = determineLevels({
      staticResult: clean,
      l0Result: harmless,
      hostResult: { pass: false, cards: [] },
    });
    expect(result.host.l1).toBe('fail');
  });

  it('reports L2 and L3 as not automated rather than guessing at them', () => {
    const result = determineLevels({ staticResult: clean, l0Result: harmless, hostResult: goodHost });
    expect(result.host.l2).toBe('not-automated');
    expect(result.host.l3).toBe('not-automated');
  });

  it('refuses to judge on missing input instead of defaulting it to a pass', () => {
    expect(() => determineLevels({ l0Result: harmless, hostResult: goodHost })).toThrow(TypeError);
    expect(() => determineLevels({ staticResult: clean, hostResult: goodHost })).toThrow(TypeError);
    expect(() => determineLevels({ staticResult: clean, l0Result: harmless })).toThrow(TypeError);
    expect(() => determineLevels()).toThrow(TypeError);
  });

  it('refuses input of the wrong shape', () => {
    expect(() =>
      determineLevels({ staticResult: { findings: 'none' }, l0Result: harmless, hostResult: goodHost }),
    ).toThrow(TypeError);
    expect(() =>
      determineLevels({ staticResult: clean, l0Result: { pass: 'yes' }, hostResult: goodHost }),
    ).toThrow(TypeError);
  });
});

describe('the whole suite, end to end, over the reference shim', () => {
  it('grades a real card and the in-repo host together', async () => {
    const document = injectRuntimeIntoDocument(
      [
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        '<title>Reading log</title>',
        '<script type="application/json" data-card-manifest>{ "spec": "1.0" }</script>',
        '</head>',
        '<body>',
        '<h1>Reading log</h1>',
        '<p>Three books this month.</p>',
        '<input data-persist="note">',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );

    const levels = determineLevels({
      staticResult: checkCardDocument(document),
      l0Result: await runL0Harmlessness(document),
      hostResult: await runHostSuite(createReferenceHostAdapter()),
    });

    expect(levels).toEqual({
      card: { l0: 'pass' },
      host: { l1: 'pass', l2: NOT_AUTOMATED, l3: NOT_AUTOMATED },
    });
  });
});
