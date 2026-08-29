// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getAdapter, type AdapterDefinition, type AdapterOutcome } from './adapters.ts';

function textOf(outcome: AdapterOutcome): string {
  if (!outcome.ok) {
    throw new Error(`expected an extracted value, got refusal: ${outcome.reason}`);
  }
  return outcome.value.text;
}

function reasonOf(outcome: AdapterOutcome): string {
  if (outcome.ok) {
    throw new Error(`expected a refusal, got "${outcome.value.text}"`);
  }
  return outcome.reason;
}

function requireAdapter(id: string): AdapterDefinition {
  const adapter = getAdapter(id);
  if (adapter === undefined) {
    throw new Error(`adapter ${id} is not registered`);
  }
  return adapter;
}

describe('json-path adapter', () => {
  const adapter = requireAdapter('json-path');
  const document = JSON.stringify({
    results: [{ benchmark: 'spec-cpu2006', base: '42.3', peak: '45.1' }],
    meta: { revision: 2 },
  });

  it('reads a value through objects and array indices', () => {
    expect(textOf(adapter.extract(document, '/results/0/base'))).toBe('42.3');
    expect(textOf(adapter.extract(document, '/meta/revision'))).toBe('2');
  });

  it('returns the literal text without coercing it to a number', () => {
    // "42.3" must survive as written; parsing here would lose source precision.
    expect(textOf(adapter.extract(document, '/results/0/base'))).toBe('42.3');
  });

  it('refuses a missing key, a bad index and a container', () => {
    expect(reasonOf(adapter.extract(document, '/results/0/median'))).toContain('no key');
    expect(reasonOf(adapter.extract(document, '/results/7/base'))).toContain('no array index');
    expect(reasonOf(adapter.extract(document, '/results'))).toContain('container');
  });

  it('refuses content that is not JSON', () => {
    expect(reasonOf(adapter.extract('<html></html>', '/a'))).toContain('not valid JSON');
  });
});

describe('delimited-cell adapter', () => {
  const adapter = requireAdapter('delimited-cell');
  const csv = ['model,clock,note', 'MOS 6510,0.985248,"PAL, as printed"', 'Z80,3.5,'].join('\n');

  it('reads a cell by 1-based row and column, counting the header', () => {
    expect(textOf(adapter.extract(csv, 'row:2,col:2'))).toBe('0.985248');
    expect(textOf(adapter.extract(csv, 'row:1,col:1'))).toBe('model');
  });

  it('respects quoting, so a comma inside a cell does not shift the columns', () => {
    expect(textOf(adapter.extract(csv, 'row:2,col:3'))).toBe('PAL, as printed');
  });

  it('reads tab-delimited content too', () => {
    const tsv = 'model\tclock\nMOS 6510\t0.985248';
    expect(textOf(adapter.extract(tsv, 'row:2,col:2'))).toBe('0.985248');
  });

  it('refuses a malformed locator or an out-of-range cell', () => {
    expect(reasonOf(adapter.extract(csv, 'B2'))).toContain('row:4,col:2');
    expect(reasonOf(adapter.extract(csv, 'row:9,col:1'))).toContain('beyond');
    expect(reasonOf(adapter.extract(csv, 'row:2,col:9'))).toContain('beyond');
  });
});
