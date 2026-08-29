// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatAxisTick } from './axis-ticks.ts';

describe('formatAxisTick', () => {
  it('abbreviates large ticks with an SI multiplier', () => {
    expect(formatAxisTick(3_200_000_000)).toBe('3.2G');
    expect(formatAxisTick(500_000_000)).toBe('500M');
    expect(formatAxisTick(1_000)).toBe('1k');
    expect(formatAxisTick(85_899_345_920)).toBe('85.9G');
    expect(formatAxisTick(2e12)).toBe('2T');
  });

  it('keeps a label short enough to fit the axis margin', () => {
    for (const value of [0, 1.5, 999, 1024, 6.4e7, 3.2e9, 8e10, 1.25e12, 9.99e14]) {
      expect(formatAxisTick(value).length).toBeLessThanOrEqual(8);
    }
  });

  it('writes small ticks plainly, keeping their significant digits', () => {
    expect(formatAxisTick(0)).toBe('0');
    expect(formatAxisTick(2.5)).toBe('2.5');
    expect(formatAxisTick(0.004)).toBe('0.004');
    expect(formatAxisTick(0.125)).toBe('0.13');
  });

  it('has nothing to draw for a value that is not a number', () => {
    expect(formatAxisTick(Number.NaN)).toBe('');
    expect(formatAxisTick(Number.POSITIVE_INFINITY)).toBe('');
  });
});
