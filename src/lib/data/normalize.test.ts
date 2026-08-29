// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  convertQuantity,
  isNormalizationCurrent,
  NormalizationError,
  normalizeQuantity,
} from './normalize.ts';
import { UNIT_REGISTRY_VERSION } from './units.ts';

describe('normalizeQuantity', () => {
  it('expresses a figure in the base unit of its quantity', () => {
    expect(normalizeQuantity({ value: '1.5', unit: 'MHz', significantDigits: 2 })).toEqual({
      value: '1500000',
      unit: 'Hz',
      significantDigits: 2,
      unitRegistry: UNIT_REGISTRY_VERSION,
    });
  });

  it('keeps an exact binary capacity exact instead of rounding to source precision', () => {
    // 64 KiB is exactly 65536 bytes. Rounding to the stated two significant
    // digits would publish 66000, which is simply wrong.
    const normalized = normalizeQuantity({ value: '64', unit: 'KiB', significantDigits: 2 });
    expect(normalized.value).toBe('65536');
    expect(normalized.significantDigits).toBe(2);
  });

  it('carries the stated precision unchanged rather than inferring it from digits', () => {
    const normalized = normalizeQuantity({ value: '1.50', unit: 'GHz', significantDigits: 3 });
    expect(normalized.value).toBe('1500000000');
    expect(normalized.significantDigits).toBe(3);
  });

  it('leaves a figure already in its base unit alone', () => {
    expect(normalizeQuantity({ value: '85500', unit: 'IPS', significantDigits: 3 }).value).toBe(
      '85500',
    );
  });

  it('normalizes across every quantity without loss', () => {
    expect(normalizeQuantity({ value: '10.28', unit: 'TFLOP/s', significantDigits: 4 }).value).toBe(
      '10280000000000',
    );
    expect(normalizeQuantity({ value: '448', unit: 'GB/s', significantDigits: 3 }).value).toBe(
      '448000000000',
    );
    expect(normalizeQuantity({ value: '7', unit: 'nm', significantDigits: 1 }).value).toBe(
      '0.000000007',
    );
  });

  it('rejects an unknown unit', () => {
    expect(() =>
      // @ts-expect-error deliberately outside the registry
      normalizeQuantity({ value: '1', unit: 'furlong', significantDigits: 1 }),
    ).toThrow(NormalizationError);
  });
});

describe('isNormalizationCurrent', () => {
  const stated = { value: '1.5', unit: 'MHz', significantDigits: 2 } as const;

  it('accepts a normalized twin that still matches the registry', () => {
    expect(isNormalizationCurrent(stated, normalizeQuantity(stated))).toBe(true);
  });

  it('rejects a hand-edited value, unit, precision or registry version', () => {
    const current = normalizeQuantity(stated);
    expect(isNormalizationCurrent(stated, { ...current, value: '1500001' })).toBe(false);
    expect(isNormalizationCurrent(stated, { ...current, unit: 'kHz' })).toBe(false);
    expect(isNormalizationCurrent(stated, { ...current, significantDigits: 7 })).toBe(false);
    expect(isNormalizationCurrent(stated, { ...current, unitRegistry: 'units-v0' })).toBe(false);
  });
});

describe('convertQuantity', () => {
  it('converts within a quantity', () => {
    expect(convertQuantity('1500000', 'Hz', 'MHz', 6, 'half-up')).toBe('1.5');
    expect(convertQuantity('65536', 'B', 'KiB', 6, 'half-up')).toBe('64');
    expect(convertQuantity('10280', 'GFLOP/s', 'TFLOP/s', 6, 'half-up')).toBe('10.28');
  });

  it('rounds a conversion that does not fit the requested width', () => {
    // 1000 / 1024 is exactly 0.9765625, seven digits, so four means rounding.
    expect(convertQuantity('1000', 'B', 'KiB', 4, 'half-up')).toBe('0.9766');
    expect(convertQuantity('1000', 'B', 'KiB', 7, 'none')).toBe('0.9765625');
    expect(() => convertQuantity('1000', 'B', 'KiB', 4, 'none')).toThrow(/remainder|terminate/);
  });

  it('refuses to cross quantities', () => {
    expect(() => convertQuantity('1', 'MIPS', 'MFLOP/s', 6, 'half-up')).toThrow(NormalizationError);
    expect(() => convertQuantity('36864', 'word', 'B', 6, 'half-up')).toThrow(NormalizationError);
  });
});
