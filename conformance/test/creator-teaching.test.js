import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readReference = (name) => readFile(resolve(process.cwd(), 'creator/references', name), 'utf8');

describe('creator teaching: emit signature and stateSchema', () => {
  it('teaches the three-argument emit and the default route', async () => {
    const binding = await readReference('binding-criteria.md');
    const shape = await readReference('package-shape.md');

    expect(binding).toContain('card.emit(name, payload?, to?)');
    expect(binding).toContain('CARD_HOST_EMIT_NO_ROUTE');
    expect(binding.replace(/\s+/g, ' ')).toContain(
      'only when the user has said they want the event sent somewhere else',
    );

    expect(shape).toContain('card.emit(name, payload?, to?)');
    expect(shape).toContain('CARD_HOST_EMIT_NO_ROUTE');
    expect(shape.replace(/\s+/g, ' ')).toContain(
      'only when the user has said they want the event sent somewhere else',
    );
  });

  it('teaches stateSchema as an optional manifest declaration', async () => {
    const shape = await readReference('package-shape.md');

    expect(shape).toContain('stateSchema');
    expect(shape).toMatch(/optional manifest key/);
    expect(shape).toMatch(/may check a write/);
    expect(shape).toMatch(/refuse/);
  });

  it('teaches host data and activity as negotiated extensions', async () => {
    const skill = await readFile(resolve(process.cwd(), 'creator/SKILL.md'), 'utf8');
    const shape = await readReference('package-shape.md');
    const walkthrough = await readReference('three-hosts.md');
    const binding = await readReference('binding-criteria.md');

    expect(skill).toContain('uiLanguage');
    expect(shape).toContain('dataSchema');
    expect(shape).toContain('card.data.get()');
    expect(shape).toContain('card.data.onChange(callback)');
    expect(shape).toContain('feature descriptor,\nnot a callable operation');
    expect(shape).toContain('does\nnot invoke the callback immediately');
    expect(shape).toContain('card.track(name, payload?)');
    expect(walkthrough).toContain('{ status: "available" }');
    expect(binding).toContain('card.data.onChange(callback)');
    expect(binding).toContain('does not receive a document when registered');
    expect(binding).toContain('card.track(name, payload?)');
    expect(binding).toMatch(/optional host extensions/);
  });
});
