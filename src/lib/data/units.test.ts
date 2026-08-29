// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getMetric, METRIC_IDS } from './metrics.ts';
import { baseUnitOf, isConvertible, QUANTITIES, quantityOf, UNIT_IDS, UNITS } from './units.ts';

/**
 * These are invariants of the registry as data, not of any function over it. A
 * broken one is silent: normalization still produces a number, just labeled
 * with the wrong unit. That is how SPEC scores came to be normalized into
 * Dhrystone MIPS per megahertz, which is the case the base-unit test pins down.
 *
 * Each test collects the offenders and asserts the list is empty, so a failure
 * names what is wrong rather than only that something is.
 */
describe('unit registry invariants', () => {
  it('gives every quantity exactly one base unit', () => {
    // Two base units means baseUnitOf silently returns whichever was declared
    // first, and a figure normalizes into a unit from an unrelated scale.
    const offenders = QUANTITIES.map((quantity) => ({
      quantity,
      bases: UNIT_IDS.filter(
        (id) => UNITS.get(id)?.quantity === quantity && UNITS.get(id)?.toBase === '1',
      ),
    })).filter((entry) => entry.bases.length !== 1);

    expect(offenders).toEqual([]);
  });

  it('resolves a base unit for every quantity', () => {
    expect(QUANTITIES.filter((quantity) => baseUnitOf(quantity) === undefined)).toEqual([]);
  });

  it('gives every unit a positive decimal conversion factor', () => {
    const offenders = UNIT_IDS.filter((id) => {
      const factor = UNITS.get(id)?.toBase ?? '';
      return !/^\d+(?:\.\d+)?$/.test(factor) || Number(factor) <= 0;
    });
    expect(offenders).toEqual([]);
  });

  it('declares each unit id exactly once', () => {
    expect(new Set(UNIT_IDS).size).toBe(UNIT_IDS.length);
  });

  it('assigns every unit a quantity the registry knows', () => {
    const known = new Set<string>(QUANTITIES);
    expect(UNIT_IDS.filter((id) => !known.has(UNITS.get(id)?.quantity ?? ''))).toEqual([]);
  });
});

describe('convertibility', () => {
  it('keeps the dimensionless scales apart', () => {
    // Both are unitless, and that is not something they have in common: a SPEC
    // result and a clock-normalized Dhrystone figure share no scale at all.
    expect(isConvertible('score', 'DMIPS/MHz')).toBe(false);
    expect(quantityOf('score')).not.toBe(quantityOf('DMIPS/MHz'));
  });

  it('keeps instruction rates apart from floating-point rates', () => {
    expect(isConvertible('MIPS', 'MFLOP/s')).toBe(false);
  });

  it('keeps machine words apart from bytes', () => {
    expect(isConvertible('word', 'B')).toBe(false);
  });

  it('keeps binary and decimal capacity prefixes on one scale', () => {
    // Distinct prefixes, but an exact factor does relate them.
    expect(isConvertible('KiB', 'kB')).toBe(true);
  });

  it('refuses an unknown unit on either side', () => {
    expect(isConvertible('furlong', 'B')).toBe(false);
    expect(isConvertible('B', 'furlong')).toBe(false);
  });
});

describe('metric registry', () => {
  const known = new Set<string>(QUANTITIES);

  it('gives every metric a quantity the unit registry defines', () => {
    expect(METRIC_IDS.filter((id) => !known.has(getMetric(id)?.quantity ?? ''))).toEqual([]);
  });

  it('has at least one unit available for every metric quantity', () => {
    const offenders = METRIC_IDS.filter((id) => {
      const quantity = getMetric(id)?.quantity;
      return !UNIT_IDS.some((unit) => UNITS.get(unit)?.quantity === quantity);
    });
    expect(offenders).toEqual([]);
  });

  it('never marks a ratio-forbidden metric as log-scalable', () => {
    // A log axis is a ratio claim in disguise; permitting one while forbidding
    // the other would let a chart assert what the metric says is meaningless.
    const offenders = METRIC_IDS.filter((id) => {
      const metric = getMetric(id);
      return metric?.allowsRatio === false && metric.allowsLogScale;
    });
    expect(offenders).toEqual([]);
  });
});
