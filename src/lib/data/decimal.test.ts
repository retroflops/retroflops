// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  compareDecimal,
  DecimalError,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  roundToSignificantDigits,
  scaleByFactor,
  significantDigits,
} from './decimal.ts';

const d = parseDecimal;
const show = (value: string): string => formatDecimal(d(value));

describe('parseDecimal', () => {
  it('round-trips plain decimals including trailing zeros', () => {
    expect(show('0')).toBe('0');
    expect(show('1.5')).toBe('1.5');
    expect(show('1.50')).toBe('1.50');
    expect(show('-0.001')).toBe('-0.001');
    expect(show('1000')).toBe('1000');
  });

  it('expands exponent notation into positional form', () => {
    expect(show('1e6')).toBe('1000000');
    expect(show('1.2345e3')).toBe('1234.5');
    expect(show('5e-4')).toBe('0.0005');
  });

  it('treats negative zero as zero', () => {
    expect(show('-0')).toBe('0');
    expect(show('-0.00')).toBe('0.00');
  });

  it.each(['', '1,5', 'Infinity', 'NaN', '1.2.3', '0x10', '1_000', '1.'])(
    'rejects %j, which is not an exact decimal literal',
    (bad) => {
      expect(() => d(bad)).toThrow(DecimalError);
    },
  );

  it('holds counts far beyond double precision exactly', () => {
    // 2^53 + 1, which Number() cannot represent.
    expect(show('9007199254740993')).toBe('9007199254740993');
  });
});

describe('significantDigits', () => {
  it('counts digits present, ignoring leading zeros', () => {
    expect(significantDigits(d('0.0015'))).toBe(2);
    expect(significantDigits(d('1500'))).toBe(4);
    expect(significantDigits(d('0'))).toBe(0);
  });
});

describe('compareDecimal', () => {
  it('ignores trailing-zero differences', () => {
    expect(compareDecimal(d('1.5'), d('1.50'))).toBe(0);
    expect(compareDecimal(d('1e3'), d('1000'))).toBe(0);
  });

  it('orders across scales and signs', () => {
    expect(compareDecimal(d('0.9'), d('1'))).toBe(-1);
    expect(compareDecimal(d('-5'), d('-6'))).toBe(1);
    expect(compareDecimal(d('-0.001'), d('0'))).toBe(-1);
  });
});

describe('multiplyDecimal', () => {
  it('is exact where binary floating point is not', () => {
    expect(formatDecimal(multiplyDecimal(d('0.1'), d('0.2')))).toBe('0.02');
    expect(0.1 * 0.2).not.toBe(0.02);
  });

  it('keeps the full product without rounding', () => {
    expect(formatDecimal(multiplyDecimal(d('1.5'), d('1000000')))).toBe('1500000.0');
  });
});

describe('roundToSignificantDigits', () => {
  it('never invents precision by padding', () => {
    expect(formatDecimal(roundToSignificantDigits(d('1.5'), 6, 'half-up'))).toBe('1.5');
  });

  it('rounds half-up away from zero at a tie', () => {
    expect(formatDecimal(roundToSignificantDigits(d('1.25'), 2, 'half-up'))).toBe('1.3');
    expect(formatDecimal(roundToSignificantDigits(d('1.35'), 2, 'half-up'))).toBe('1.4');
  });

  it('rounds half-even to the nearest even digit at a tie', () => {
    expect(formatDecimal(roundToSignificantDigits(d('1.25'), 2, 'half-even'))).toBe('1.2');
    expect(formatDecimal(roundToSignificantDigits(d('1.35'), 2, 'half-even'))).toBe('1.4');
  });

  it('truncates toward zero', () => {
    expect(formatDecimal(roundToSignificantDigits(d('1.99'), 2, 'truncate'))).toBe('1.9');
  });

  it('carries into an extra digit without gaining significant digits', () => {
    expect(formatDecimal(roundToSignificantDigits(d('999'), 2, 'half-up'))).toBe('1000');
    expect(significantDigits(roundToSignificantDigits(d('999'), 2, 'half-up'))).toBe(2);
  });

  it('refuses to discard a non-zero remainder under the "none" rule', () => {
    expect(() => roundToSignificantDigits(d('1.25'), 2, 'none')).toThrow(DecimalError);
    expect(formatDecimal(roundToSignificantDigits(d('1.20'), 2, 'none'))).toBe('1.2');
  });
});

describe('divideDecimal', () => {
  it('produces the requested number of significant digits', () => {
    expect(formatDecimal(divideDecimal(d('1'), d('3'), 5, 'half-up'))).toBe('0.33333');
    expect(formatDecimal(divideDecimal(d('2'), d('3'), 5, 'half-up'))).toBe('0.66667');
  });

  it('computes a ratio between figures many orders of magnitude apart', () => {
    // A modern GPU peak against the Apollo Guidance Computer's instruction rate:
    // the shapes differ wildly, so the arithmetic must not overflow into a double.
    const ratio = divideDecimal(d('10280000000000'), d('85500'), 6, 'half-up');
    expect(formatDecimal(ratio)).toBe('120234000');
  });

  it('rounds at a true tie rather than on guard digits', () => {
    expect(formatDecimal(divideDecimal(d('1'), d('8'), 2, 'half-up'))).toBe('0.13');
    expect(formatDecimal(divideDecimal(d('1'), d('8'), 2, 'half-even'))).toBe('0.12');
  });

  it('does not mistake a repeating quotient for an exact tie', () => {
    // 0.1666… must round down at two digits, not up as an exact 0.165 tie would.
    expect(formatDecimal(divideDecimal(d('1'), d('6'), 2, 'half-up'))).toBe('0.17');
    expect(formatDecimal(divideDecimal(d('5'), d('3'), 3, 'half-up'))).toBe('1.67');
  });

  it('rejects division by zero and non-terminating exact division', () => {
    expect(() => divideDecimal(d('1'), d('0'), 5, 'half-up')).toThrow(DecimalError);
    expect(() => divideDecimal(d('1'), d('3'), 5, 'none')).toThrow(DecimalError);
    expect(formatDecimal(divideDecimal(d('1'), d('4'), 5, 'none'))).toBe('0.25');
  });

  it('reports an exact quotient at its own width rather than padding', () => {
    expect(formatDecimal(divideDecimal(d('1'), d('4'), 5, 'half-up'))).toBe('0.25');
    expect(formatDecimal(divideDecimal(d('10'), d('2'), 6, 'half-up'))).toBe('5');
    // Exact, but too wide for the requested width, so it still rounds.
    expect(formatDecimal(divideDecimal(d('1'), d('8'), 2, 'half-up'))).toBe('0.13');
    expect(() => divideDecimal(d('1'), d('8'), 2, 'none')).toThrow(DecimalError);
  });

  it('returns zero for a zero numerator', () => {
    expect(formatDecimal(divideDecimal(d('0'), d('3'), 5, 'half-up'))).toBe('0');
  });
});

describe('scaleByFactor', () => {
  it('keeps the source precision when converting units', () => {
    // 1.5 MHz is two significant digits; in hertz it is still two.
    const hertz = scaleByFactor(d('1.5'), d('1000000'), 2, 'half-up');
    expect(formatDecimal(hertz)).toBe('1500000');
    expect(significantDigits(hertz)).toBe(2);
  });

  it('does not round when the source carried more digits than the factor', () => {
    const bytes = scaleByFactor(d('64'), d('1024'), 2, 'half-up');
    expect(formatDecimal(bytes)).toBe('66000');
  });

  it('converts a binary prefix exactly when full precision is requested', () => {
    expect(formatDecimal(scaleByFactor(d('64'), d('1024'), 6, 'half-up'))).toBe('65536');
  });
});
