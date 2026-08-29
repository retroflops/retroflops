// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Exact decimal arithmetic.
 *
 * Every figure in the catalog is a decimal string carrying the precision its
 * source had. Parsing those into JavaScript numbers would silently
 * corrupt them, including `0.1 + 0.2` and any 17-significant-digit transistor count. So
 * the pipeline never does. Values are held as a `bigint` coefficient with a
 * base-10 exponent, and every operation that can lose precision demands an
 * explicit significant-digit count and rounding rule.
 *
 * A value is `sign * coefficient * 10^exponent`, with `coefficient >= 0`.
 */

/** Rounding rules, mirroring `ROUNDING_RULES` in the catalog schema. */
export type RoundingRule = 'half-up' | 'half-even' | 'truncate' | 'none';

export interface Decimal {
  readonly sign: 1 | -1;
  readonly coefficient: bigint;
  readonly exponent: number;
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalError';
  }
}

/**
 * Parses an exact decimal literal. Trailing zeros are preserved because they
 * carry precision: `1.50` is not the same claim as `1.5`.
 */
export function parseDecimal(input: string): Decimal {
  const match = DECIMAL_PATTERN.exec(input.trim());
  if (match === null) {
    throw new DecimalError(`not an exact decimal literal: ${JSON.stringify(input)}`);
  }
  const [, signPart = '', integerPart = '', fractionPart = '', exponentPart = ''] = match;
  const digits = `${integerPart}${fractionPart}`;
  const coefficient = BigInt(digits);
  const exponent = (exponentPart === '' ? 0 : Number(exponentPart)) - fractionPart.length;
  // Zero has no sign in this model, so that -0 and 0 compare and format alike.
  const sign = signPart === '-' && coefficient !== 0n ? -1 : 1;
  return { sign, coefficient, exponent };
}

/** Renders a decimal in plain positional notation, never in exponent form. */
export function formatDecimal(value: Decimal): string {
  const digits = value.coefficient.toString();
  const prefix = value.sign === -1 ? '-' : '';

  if (value.exponent >= 0) {
    return `${prefix}${digits}${'0'.repeat(value.exponent)}`;
  }

  const fractionLength = -value.exponent;
  if (digits.length > fractionLength) {
    const cut = digits.length - fractionLength;
    return `${prefix}${digits.slice(0, cut)}.${digits.slice(cut)}`;
  }
  return `${prefix}0.${digits.padStart(fractionLength, '0')}`;
}

export function isZero(value: Decimal): boolean {
  return value.coefficient === 0n;
}

export function isPositive(value: Decimal): boolean {
  return value.coefficient > 0n && value.sign === 1;
}

/** Significant digits present, ignoring leading zeros. Zero has none. */
export function significantDigits(value: Decimal): number {
  return value.coefficient === 0n ? 0 : value.coefficient.toString().length;
}

/** Orders two decimals: -1, 0 or 1. Trailing-zero differences compare equal. */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const signedA = a.sign === -1 ? -a.coefficient : a.coefficient;
  const signedB = b.sign === -1 ? -b.coefficient : b.coefficient;
  const exponent = Math.min(a.exponent, b.exponent);
  const scaledA = signedA * 10n ** BigInt(a.exponent - exponent);
  const scaledB = signedB * 10n ** BigInt(b.exponent - exponent);
  if (scaledA < scaledB) {
    return -1;
  }
  return scaledA > scaledB ? 1 : 0;
}

/** True when both values denote the same number, regardless of trailing zeros. */
export function equalsDecimal(a: Decimal, b: Decimal): boolean {
  return compareDecimal(a, b) === 0;
}

/**
 * Exact addition. Like multiplication it cannot lose precision, so it needs no
 * rounding rule: the result is carried at the finer of the two scales, which is
 * exactly what adding 512 KiB to 0.5 MiB in base units has to do.
 */
export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const exponent = Math.min(a.exponent, b.exponent);
  const signedA =
    (a.sign === -1 ? -a.coefficient : a.coefficient) * 10n ** BigInt(a.exponent - exponent);
  const signedB =
    (b.sign === -1 ? -b.coefficient : b.coefficient) * 10n ** BigInt(b.exponent - exponent);
  const total = signedA + signedB;
  const sign: 1 | -1 = total < 0n ? -1 : 1;
  return { sign, coefficient: total < 0n ? -total : total, exponent };
}

/** Exact multiplication. Never loses precision, so it needs no rounding rule. */
export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  const coefficient = a.coefficient * b.coefficient;
  const sign = coefficient === 0n ? 1 : ((a.sign * b.sign) as 1 | -1);
  return { sign, coefficient, exponent: a.exponent + b.exponent };
}

/**
 * Rounds to `digits` significant digits.
 *
 * Values that already have fewer significant digits are returned untouched
 * rather than zero-padded: padding would invent precision the source never had.
 * `none` refuses to discard a non-zero remainder, which is how the pipeline
 * asserts that a conversion was exact.
 */
export function roundToSignificantDigits(
  value: Decimal,
  digits: number,
  rule: RoundingRule,
): Decimal {
  if (!Number.isInteger(digits) || digits < 1) {
    throw new DecimalError(`significant digits must be a positive integer, got ${digits}`);
  }
  if (value.coefficient === 0n) {
    return value;
  }

  const present = significantDigits(value);
  if (present <= digits) {
    return value;
  }

  const drop = present - digits;
  const divisor = 10n ** BigInt(drop);
  const quotient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;

  if (remainder === 0n) {
    return normalizeAfterRounding({ ...value, coefficient: quotient }, drop, digits);
  }
  if (rule === 'none') {
    throw new DecimalError(
      `rounding to ${digits} significant digits would discard a non-zero remainder`,
    );
  }

  const rounded = applyRounding(quotient, remainder, divisor, rule);
  return normalizeAfterRounding({ ...value, coefficient: rounded }, drop, digits);
}

/**
 * Division to a fixed number of significant digits.
 *
 * Two guard digits plus a sticky bit make the rounding decision identical to
 * rounding the exact quotient, including at ties.
 */
export function divideDecimal(a: Decimal, b: Decimal, digits: number, rule: RoundingRule): Decimal {
  if (b.coefficient === 0n) {
    throw new DecimalError('division by zero');
  }
  if (!Number.isInteger(digits) || digits < 1) {
    throw new DecimalError(`significant digits must be a positive integer, got ${digits}`);
  }
  if (a.coefficient === 0n) {
    return { sign: 1, coefficient: 0n, exponent: 0 };
  }

  const guard = 2;
  const shift = Math.max(0, digits + guard - (significantDigits(a) - significantDigits(b)));
  const numerator = a.coefficient * 10n ** BigInt(shift);
  let quotient = numerator / b.coefficient;
  const remainder = numerator % b.coefficient;

  // Sticky: a non-zero remainder must never be mistaken for an exact tie.
  if (remainder !== 0n && quotient % 10n === 0n) {
    quotient += 1n;
  }

  const sign = (a.sign * b.sign) as 1 | -1;
  const exact = remainder === 0n;
  const raw: Decimal = { sign, coefficient: quotient, exponent: a.exponent - b.exponent - shift };

  if (rule === 'none' && !exact) {
    throw new DecimalError('exact division requested but the quotient does not terminate');
  }
  // An exact quotient is reported at its own width. The shift above only supports
  // the rounding decision. It does not claim that the result carries that many digits.
  return roundToSignificantDigits(exact ? stripTrailingZeros(raw) : raw, digits, rule);
}

/**
 * Applies a unit-conversion factor, keeping the source's significant digits.
 *
 * Converting 1.5 MHz to hertz yields 1500000, still two significant digits. The
 * conversion must not manufacture precision the datasheet never stated.
 */
export function scaleByFactor(
  value: Decimal,
  factor: Decimal,
  significantDigitsToKeep: number,
  rule: RoundingRule,
): Decimal {
  return roundToSignificantDigits(multiplyDecimal(value, factor), significantDigitsToKeep, rule);
}

/**
 * Drops trailing zeros.
 *
 * Only for values a computation produced. Applying it to a source-stated figure
 * would erase the precision its trailing zeros record. That is why `1.50` is
 * kept distinct from `1.5` on the way in.
 */
export function stripTrailingZeros(value: Decimal): Decimal {
  if (value.coefficient === 0n) {
    return { sign: 1, coefficient: 0n, exponent: 0 };
  }
  let coefficient = value.coefficient;
  let exponent = value.exponent;
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    exponent += 1;
  }
  return { sign: value.sign, coefficient, exponent };
}

function applyRounding(
  quotient: bigint,
  remainder: bigint,
  divisor: bigint,
  rule: Exclude<RoundingRule, 'none'>,
): bigint {
  if (rule === 'truncate') {
    return quotient;
  }
  const twiceRemainder = 2n * remainder;
  if (twiceRemainder > divisor) {
    return quotient + 1n;
  }
  if (twiceRemainder < divisor) {
    return quotient;
  }
  // Exact tie.
  return rule === 'half-up' ? quotient + 1n : quotient + (quotient % 2n === 0n ? 0n : 1n);
}

/** Rounding can carry into an extra digit (999 → 100 at two digits); renormalize. */
function normalizeAfterRounding(value: Decimal, drop: number, digits: number): Decimal {
  let coefficient = value.coefficient;
  let exponent = value.exponent + drop;
  if (coefficient.toString().length > digits) {
    coefficient /= 10n;
    exponent += 1;
  }
  const sign = coefficient === 0n ? 1 : value.sign;
  return { sign, coefficient, exponent };
}
