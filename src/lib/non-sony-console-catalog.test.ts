// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCatalog } from './catalog.ts';

const catalog = getCatalog();

function system(slug: string) {
  const found = catalog.systems.find((candidate) => candidate.slug === slug);
  if (found === undefined) {
    throw new Error(`missing system ${slug}`);
  }
  return found;
}

describe('non-Sony 3D and HD console catalog', () => {
  it('adds the ten requested non-Sony 3D and HD systems', () => {
    // The first pass relied on technical manuals that had been listed but not
    // retrieved. A system leaves provisional once its record rests on a source
    // we have read, so this list may continue to move toward approved.
    expect(
      Object.fromEntries(
        [
          'sega-saturn',
          'nintendo-gamecube',
          'microsoft-xbox',
          'microsoft-xbox-360',
          'nintendo-wii',
          'nintendo-wii-u',
          'microsoft-xbox-one',
          'nintendo-switch',
          'microsoft-xbox-series-x',
          'valve-steam-deck',
        ].map((slug) => [slug, system(slug).editorialStatus]),
      ),
    ).toEqual({
      'sega-saturn': 'approved',
      'nintendo-gamecube': 'approved',
      'microsoft-xbox': 'provisional',
      'microsoft-xbox-360': 'provisional',
      'nintendo-wii': 'provisional',
      // Wii U keeps its provisional status although it too left the dead
      // citation this round. Nothing about this machine reaches two agreeing
      // sources: Nintendo's own table states no frequency and no capacity, and
      // one publication carries each of the figures that remain.
      'nintendo-wii-u': 'provisional',
      'microsoft-xbox-one': 'approved',
      'nintendo-switch': 'approved',
      'microsoft-xbox-series-x': 'approved',
      'valve-steam-deck': 'approved',
    });
  });

  it('models Saturn’s paired SH-2 CPUs as a count, not a summed clock', () => {
    const entry = system('sega-saturn').configurations[0]?.entries.find(
      (candidate) => candidate.componentId === 'sega-saturn-sh2',
    );
    expect(entry?.role).toBe('main-cpu');
    expect(entry?.count).toBe(2);
    // The rate is Sega's own, from the service manual for the PAL console; the
    // pair still share one clock rather than being summed.
    const clock = catalog.measurements.find((measurement) =>
      entry?.measurementIds.includes(measurement.id),
    );
    expect(clock?.quantity).toMatchObject({ state: 'value', value: '28.4', unit: 'MHz' });
  });

  it('carries Xbox 360 FP32 as a rumored community figure, never as a vendor one', () => {
    const figure = catalog.measurements.find(
      (measurement) => measurement.id === 'microsoft-xbox-360:peak-fp32-rate',
    );
    // Microsoft's own engineers describe this GPU at register level and quantify
    // it in shader instructions per second, never in FLOP/s. The rate that
    // circulates is the marketing total, and a community article is the only
    // thing that states it, so it is recorded on those terms: rumored,
    // provisional, and out of every automatic comparison.
    expect(figure?.quantity).toMatchObject({ state: 'value', value: '240', unit: 'GFLOP/s' });
    expect(figure?.evidenceLevel).toBe('rumored');
    expect(figure?.editorialStatus).toBe('provisional');
    expect(figure?.provenance).toBe('community');
    // The precision the source leaves unsaid has to be visible to the reader.
    expect(figure?.caveat).toContain('names no precision');
  });

  it('keeps Switch docked and handheld GPU clocks as separate configurations', () => {
    const switchSystem = system('nintendo-switch');
    expect(switchSystem.configurations.map((configuration) => configuration.id)).toEqual([
      'docked',
      'handheld',
    ]);
    const graphicsClocks = catalog.measurements.filter(
      (measurement) =>
        measurement.subject.kind === 'system' &&
        measurement.subject.id === 'nintendo-switch' &&
        measurement.metric === 'clock-frequency' &&
        measurement.scope === 'gpu',
    );

    // The independent values remain separate by configuration. A vendor-silence
    // record cannot coexist with a value in the same slot.
    expect(
      graphicsClocks.map(
        (measurement) =>
          `${measurement.subject.configurationId}:${measurement.provenance}:${
            measurement.quantity.state === 'value' ? measurement.quantity.value : 'unknown'
          }`,
      ),
    ).toEqual(['docked:independent:768', 'handheld:independent:307.2']);
  });
});
