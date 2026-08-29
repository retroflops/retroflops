// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { assertPromotedPreset, presetAvailability, type PresetData } from './presets.ts';

function isPresetData(value: unknown): value is PresetData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['title'] === 'string' &&
    typeof candidate['summary'] === 'string' &&
    (candidate['kind'] === 'system' || candidate['kind'] === 'component') &&
    Array.isArray(candidate['records']) &&
    candidate['records'].every((record) => typeof record === 'string') &&
    typeof candidate['promoted'] === 'boolean'
  );
}

function readPreset(file: string): { readonly id: string; readonly data: PresetData } {
  const source = readFileSync(`src/content/presets/${file}`, 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/m.exec(source)?.[1];
  const data = frontmatter === undefined ? undefined : parse(frontmatter);
  if (!isPresetData(data)) {
    throw new Error(`Could not read comparison preset ${file}.`);
  }

  return {
    id: file.replace(/\.md$/, ''),
    data,
  };
}

const presets = readdirSync('src/content/presets')
  .filter((file) => file.endsWith('.md'))
  .toSorted()
  .map(readPreset);

describe('prepared comparison availability', () => {
  it('has no research examples when every selected record is catalog-ready', () => {
    const researchExamples = presets.filter(
      (preset) => presetAvailability(preset.data).availability === 'research',
    );

    expect(researchExamples.map((preset) => preset.id)).toEqual([]);
  });

  it('keeps the GeForce 256 preset in catalog discovery after its configuration gains values', () => {
    const geforce = presets.find((preset) => preset.id === '06-from-geforce-256-to-rtx-5090');
    if (geforce === undefined) {
      throw new Error('Expected the GeForce 256 preset.');
    }

    expect(presetAvailability(geforce.data)).toMatchObject({
      availability: 'catalog',
      catalogRecordCount: 4,
      researchRecordCount: 0,
      researchSlugs: [],
    });
  });

  it("refuses to promote a comparison with GeForce 256's rumored figures", () => {
    const geforce = presets.find((preset) => preset.id === '06-from-geforce-256-to-rtx-5090');
    if (geforce === undefined) {
      throw new Error('Expected the GeForce 256 preset.');
    }

    expect(() => assertPromotedPreset({ ...geforce.data, promoted: true }, geforce.id)).toThrow(
      'has no valid multiplier',
    );
  });
});
