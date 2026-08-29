// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { catalogAvailability } from './catalog-availability.ts';
import { getCatalog } from './catalog.ts';
import type { Measurement } from './data/schema.ts';

const catalog = getCatalog();
const availability = catalogAvailability(catalog);

describe('catalog availability', () => {
  it('keeps the current public and research split intentional', () => {
    const systems = [...availability.systems.values()];
    const components = [...availability.components.values()];

    expect(systems.filter((record) => record.availability === 'catalog')).toHaveLength(81);
    expect(systems.filter((record) => record.availability === 'research')).toHaveLength(0);
    expect(components.filter((record) => record.availability === 'catalog')).toHaveLength(250);
    expect(components.filter((record) => record.availability === 'research')).toHaveLength(0);
  });

  it('counts a system and its fitted components once across configurations', () => {
    const c64 = availability.systems.get('commodore-64');

    expect(c64?.availability).toBe('catalog');
    expect(c64?.counts.valueCount).toBe(7);
    expect(c64?.componentIds).toContain('c64-system-ram');
  });

  it('keeps a component in the catalog when a catalog system uses it', () => {
    const cpu = availability.components.get('ps2-iop');

    expect(cpu?.counts.valueCount).toBe(0);
    expect(cpu?.availability).toBe('catalog');
    expect(cpu?.catalogSystemIds).toContain('sony-playstation-2');
  });

  it('moves a research system into the catalog when it gains a provisional value', () => {
    const original = catalog.measurements.find(
      (measurement) => measurement.id === '3dfx-voodoo-graphics:clock-frequency-base',
    );
    if (original === undefined) {
      throw new Error('Expected the Voodoo clock record.');
    }
    const value: Measurement = {
      ...original,
      quantity: { state: 'value', value: '50', unit: 'MHz', significantDigits: 2 },
      normalized: {
        value: '50000000',
        unit: 'Hz',
        significantDigits: 2,
        unitRegistry: 'units-v1',
      },
    };
    const repaired = catalogAvailability({
      ...catalog,
      measurements: catalog.measurements.map((measurement) =>
        measurement.id === value.id ? value : measurement,
      ),
    });

    expect(repaired.systems.get('3dfx-voodoo-graphics')?.availability).toBe('catalog');
    expect(repaired.components.get('3dfx-voodoo-graphics')?.availability).toBe('catalog');
  });
});
