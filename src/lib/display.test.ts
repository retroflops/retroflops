// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { UnitId } from './data/units.ts';
import {
  absenceMarker,
  attributionNote,
  formatClaimResult,
  formatQuantity,
  measurementLabel,
  metricLabel,
  methodLabel,
} from './display.ts';

describe('attribution', () => {
  it('says who stated a figure', () => {
    expect(attributionNote('vendor', 'shipped')).toBe('Stated by the vendor');
    expect(attributionNote('independent', 'shipped')).toBe('Published independently');
  });

  it('says when the hardware had not shipped yet', () => {
    expect(attributionNote('vendor', 'pre-launch')).toContain('before the hardware shipped');
  });

  it('does not credit the vendor with a figure this project computed', () => {
    const note = attributionNote('vendor', 'shipped', 'derived');
    expect(note).toContain('Computed here');
    expect(note).toContain('the vendor stated');
  });
});

describe('an absence recorded beside a value', () => {
  it('names what is missing and where the figure on show came from', () => {
    // A vendor may publish no clock while an independent source supplies one
    // for the same comparability group.
    const marker = absenceMarker({
      absentProvenance: 'vendor',
      absentText: 'unknown',
      shownProvenance: 'independent',
    });
    expect(marker).toBe(
      'The manufacturer publishes none (recorded as unknown); the figure shown was published independently.',
    );
  });

  it('keeps the record’s own explanation of the absence', () => {
    const marker = absenceMarker({
      absentProvenance: 'vendor',
      absentText: 'unknown',
      shownProvenance: 'vendor',
      note: 'Sony describes the machine by core count, not by frequency.',
    });
    expect(marker).toContain('Sony describes the machine by core count');
  });

  it('reads on its own when no value shares the cell', () => {
    expect(absenceMarker({ absentProvenance: 'vendor', absentText: 'not applicable' })).toBe(
      'The manufacturer publishes none (recorded as not applicable).',
    );
  });
});

const stated = (value: string, unit: UnitId) =>
  ({ state: 'value', value, unit, significantDigits: 3 }) as const;

describe('a figure and its unit', () => {
  it('holds a number to its symbol', () => {
    expect(formatQuantity(stated('2.01', 'GHz')).text).toBe('2.01\u00a0GHz');
  });

  it('lets a unit written as a word wrap off the number', () => {
    // A comparison column is about fourteen digits wide. Glued to
    // "transistors", a count of that size is one run wider than the column,
    // and what it did there was draw over the column beside it.
    expect(formatQuantity(stated('92200000000', 'transistor')).text).toBe(
      '92\u202f200\u202f000\u202f000 transistors',
    );
  });

  it('keeps the digit groups together whichever unit follows them', () => {
    expect(formatQuantity(stated('1792', 'GB/s')).text).toBe('1792\u00a0GB/s');
    expect(formatQuantity(stated('335760', 'unit')).text).toBe('335\u202f760');
  });
});

describe('method labels', () => {
  it('uses the registry label, and falls back to the identifier', () => {
    expect(methodLabel('nominal-clock')).toBe('Nominal clock');
    expect(methodLabel('something-unregistered')).toBe('Something unregistered');
  });
});

describe('derived claim results', () => {
  it('writes a ratio as a multiple and anything else in its own unit', () => {
    expect(
      formatClaimResult({ state: 'value', value: '11.81', unit: 'unit', significantDigits: 4 }),
    ).toBe('11.81×');
    // A clock recovered from a published floating-point rate is in hertz, and
    // "799 000 000×" would be a multiple of nothing.
    expect(
      formatClaimResult({
        state: 'value',
        value: '799000000',
        unit: 'Hz',
        significantDigits: 3,
      }).replace(/\s/g, ' '),
    ).toBe('799 000 000 Hz');
  });
});

describe('measurement labels', () => {
  it('names the benchmark variant, so two Geekbench figures are not one heading twice', () => {
    expect(
      measurementLabel('geekbench-score', {
        id: 'geekbench',
        version: '6',
        variant: 'single-core',
      }),
    ).toBe('Geekbench score, single-core');
    expect(
      measurementLabel('geekbench-score', { id: 'geekbench', version: '6', variant: 'multi-core' }),
    ).toBe('Geekbench score, multi-core');
  });

  it('names the graphics API the same way it names a run variant', () => {
    expect(
      measurementLabel('geekbench-compute-score', {
        id: 'geekbench-compute',
        version: '6',
        variant: 'metal',
      }),
    ).toBe('Geekbench Compute score, metal');
    expect(
      measurementLabel('geekbench-compute-score', {
        id: 'geekbench-compute',
        version: '7',
        variant: 'opencl',
      }),
    ).toBe('Geekbench Compute score, opencl');
  });

  it('leaves a figure with no variant to its metric alone', () => {
    expect(measurementLabel('clock-frequency', undefined)).toBe(metricLabel('clock-frequency'));
  });
});
