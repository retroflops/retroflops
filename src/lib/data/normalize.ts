// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Unit normalization.
 *
 * Every stated figure also gets a normalized twin expressed in its quantity's
 * base unit, so that sorting, charting and comparability checks never have to
 * reason about prefixes. The stated value is what a source said; the normalized
 * value is derived from it and the versioned unit registry, and is recomputed
 * and re-checked on every validation run.
 *
 * Normalization multiplies by an exact decimal factor and never rounds. Rounding
 * here would corrupt exact capacities. 64 KiB is exactly 65536 bytes, not
 * "66000 to two significant digits". The source's precision is carried in the
 * explicit `significantDigits` field instead of being inferred from the digits,
 * which is precisely why that field exists.
 */

import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  stripTrailingZeros,
  type RoundingRule,
} from './decimal.ts';
import { baseUnitOf, getUnit, UNIT_REGISTRY_VERSION, type UnitId } from './units.ts';

export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
  }
}

export interface StatedQuantity {
  readonly value: string;
  readonly unit: UnitId;
  readonly significantDigits: number;
}

export interface NormalizedQuantity {
  readonly value: string;
  readonly unit: UnitId;
  /** Carried unchanged from the source; normalization never changes precision. */
  readonly significantDigits: number;
  /** Registry the factor came from, so a factor change invalidates the result. */
  readonly unitRegistry: string;
}

/** Expresses a stated quantity in the base unit of its quantity. */
export function normalizeQuantity(stated: StatedQuantity): NormalizedQuantity {
  const unit = getUnit(stated.unit);
  if (unit === undefined) {
    throw new NormalizationError(`unknown unit: ${stated.unit}`);
  }
  const base = baseUnitOf(unit.quantity);
  if (base === undefined) {
    throw new NormalizationError(`quantity ${unit.quantity} has no base unit`);
  }

  const exact = multiplyDecimal(parseDecimal(stated.value), parseDecimal(unit.toBase));
  return {
    value: formatDecimal(stripTrailingZeros(exact)),
    unit: base.id,
    significantDigits: stated.significantDigits,
    unitRegistry: UNIT_REGISTRY_VERSION,
  };
}

/**
 * Converts between two units of the same quantity, for display.
 *
 * Unlike normalization this can divide, so it takes an explicit precision and
 * rounding rule. Crossing quantities is refused rather than approximated.
 */
export function convertQuantity(
  value: string,
  from: UnitId,
  to: UnitId,
  significantDigitsToKeep: number,
  rule: RoundingRule,
): string {
  const fromUnit = getUnit(from);
  const toUnit = getUnit(to);
  if (fromUnit === undefined) {
    throw new NormalizationError(`unknown unit: ${from}`);
  }
  if (toUnit === undefined) {
    throw new NormalizationError(`unknown unit: ${to}`);
  }
  if (fromUnit.quantity !== toUnit.quantity) {
    throw new NormalizationError(
      `cannot convert ${from} (${fromUnit.quantity}) to ${to} (${toUnit.quantity})`,
    );
  }
  if (from === to) {
    return value;
  }

  const inBase = multiplyDecimal(parseDecimal(value), parseDecimal(fromUnit.toBase));
  return formatDecimal(
    divideDecimal(inBase, parseDecimal(toUnit.toBase), significantDigitsToKeep, rule),
  );
}

/** True when the normalized twin still matches what the registry produces. */
export function isNormalizationCurrent(
  stated: StatedQuantity,
  normalized: NormalizedQuantity,
): boolean {
  const expected = normalizeQuantity(stated);
  return (
    expected.value === normalized.value &&
    expected.unit === normalized.unit &&
    expected.significantDigits === normalized.significantDigits &&
    expected.unitRegistry === normalized.unitRegistry
  );
}
