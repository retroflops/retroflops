// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Comparability rules.
 *
 * Two figures may sit in the same chart, table column or multiplier only when
 * they belong to the same comparability group: identical metric, identical
 * method, identical benchmark identity and version, and identical device scope.
 * Everything else is incompatible. That includes a MIPS figure against a FLOPS
 * figure, a theoretical peak against a measured result, or a component TDP against whole-system power.
 * rejected rather than silently coerced.
 */

import { getMethod, methodAllowsMetric, type MethodId } from './methods.ts';
import {
  getMetric,
  type ConfidenceStatus,
  type EditorialStatus,
  type MeasurementScope,
  type MetricId,
} from './metrics.ts';
import { getUnit, quantityOf, type UnitId } from './units.ts';

export const COMPARABILITY_RULES_VERSION = 'comparability-v1';

export interface BenchmarkIdentity {
  /** Stable benchmark identifier, e.g. `spec-cpu2006`. */
  readonly id: string;
  /** Exact version or revision as published, e.g. `1.2`. */
  readonly version: string;
  /** Optional variant such as `base` or `peak` for SPEC-style results. */
  readonly variant?: string | undefined;
}

/**
 * The facets that decide which group a figure belongs to.
 *
 * Deliberately excludes the unit: MHz and GHz are the same group, and a figure
 * whose value is absent altogether still has a well-defined group.
 */
export interface GroupFacets {
  readonly metric: MetricId;
  readonly scope: MeasurementScope;
  /**
   * How the figure was produced, from the closed `methods-v1` registry. Distinct
   * from the confidence status, and distinct from who published it: provenance
   * and evidence stage are recorded on the measurement and stay out of the group.
   */
  readonly method: MethodId;
  readonly benchmark?: BenchmarkIdentity | undefined;
}

/** The comparability-relevant facets of a measurement that has a stated value. */
export interface ComparabilityFacets extends GroupFacets {
  readonly unit: UnitId;
  readonly status: ConfidenceStatus;
  readonly editorialStatus: EditorialStatus;
}

/**
 * Canonical comparability-group identifier. Stored on every measurement and
 * re-derived during validation, so a hand-edited group cannot drift from the
 * facets it claims to describe.
 */
export function deriveComparabilityGroup(facets: GroupFacets): string {
  const parts: string[] = [facets.metric, facets.scope, facets.method];
  if (facets.benchmark !== undefined) {
    const { id, version, variant } = facets.benchmark;
    parts.push(variant === undefined ? `${id}@${version}` : `${id}@${version}:${variant}`);
  }
  return parts.join('|');
}

export type IncomparabilityReason =
  | 'unknown-metric'
  | 'unknown-unit'
  | 'unknown-method'
  | 'method-metric-mismatch'
  | 'metric-mismatch'
  | 'unit-quantity-mismatch'
  | 'scope-mismatch'
  | 'method-mismatch'
  | 'benchmark-mismatch'
  | 'benchmark-required'
  | 'scope-not-allowed'
  | 'unit-quantity-not-allowed'
  | 'currency-mismatch';

export interface ComparabilityResult {
  readonly comparable: boolean;
  readonly group?: string;
  readonly reasons: readonly IncomparabilityReason[];
}

/**
 * Validates the facets that make up a comparability group.
 *
 * Separate from {@link checkFacets} because a figure recorded as absent still
 * has a group. That is how "this machine states no clock" ends up in the same
 * row as the machines that do, so validation must still check it.
 */
export function checkGroupFacets(facets: GroupFacets): readonly IncomparabilityReason[] {
  const reasons: IncomparabilityReason[] = [];
  const metric = getMetric(facets.metric);
  if (metric === undefined) {
    return ['unknown-metric'];
  }
  if (getMethod(facets.method) === undefined) {
    reasons.push('unknown-method');
  } else if (!methodAllowsMetric(facets.method, facets.metric)) {
    reasons.push('method-metric-mismatch');
  }
  if (!metric.allowedScopes.includes(facets.scope)) {
    reasons.push('scope-not-allowed');
  }
  if (metric.requiresBenchmark && facets.benchmark === undefined) {
    reasons.push('benchmark-required');
  }
  return reasons;
}

/** Validates a single stated measurement's facets against the registries. */
export function checkFacets(facets: ComparabilityFacets): readonly IncomparabilityReason[] {
  const metric = getMetric(facets.metric);
  if (metric === undefined) {
    return ['unknown-metric'];
  }
  if (getUnit(facets.unit) === undefined) {
    return ['unknown-unit'];
  }
  const reasons: IncomparabilityReason[] = [...checkGroupFacets(facets)];
  if (quantityOf(facets.unit) !== metric.quantity) {
    reasons.push('unit-quantity-not-allowed');
  }
  return reasons;
}

/** Whether two figures may appear side by side as the same quantity. */
export function checkComparable(
  a: ComparabilityFacets,
  b: ComparabilityFacets,
): ComparabilityResult {
  const reasons = [...checkFacets(a), ...checkFacets(b)];
  if (reasons.length > 0) {
    return { comparable: false, reasons: dedupe(reasons) };
  }

  if (a.metric !== b.metric) {
    reasons.push('metric-mismatch');
  }
  if (quantityOf(a.unit) !== quantityOf(b.unit)) {
    reasons.push('unit-quantity-mismatch');
  }
  if (!sameCurrency(a.unit, b.unit)) {
    reasons.push('currency-mismatch');
  }
  if (a.scope !== b.scope) {
    reasons.push('scope-mismatch');
  }
  if (a.method !== b.method) {
    reasons.push('method-mismatch');
  }
  if (!sameBenchmark(a.benchmark, b.benchmark)) {
    reasons.push('benchmark-mismatch');
  }

  if (reasons.length > 0) {
    return { comparable: false, reasons: dedupe(reasons) };
  }
  return { comparable: true, group: deriveComparabilityGroup(a), reasons: [] };
}

export type RatioRefusal =
  | IncomparabilityReason
  | 'metric-forbids-ratio'
  | 'provisional-record'
  | 'non-positive-value';

export interface RatioEligibility {
  readonly allowed: boolean;
  readonly reasons: readonly RatioRefusal[];
}

/**
 * Whether an "N× faster" claim may be generated for a pair of figures.
 *
 * Stricter than plain comparability: the metric must be on a ratio scale, both
 * records must be editorially approved, and both values must be strictly
 * positive. Values arrive as decimal strings to keep the check independent of
 * binary floating point.
 */
export function checkRatioEligibility(
  a: ComparabilityFacets & { readonly value: string },
  b: ComparabilityFacets & { readonly value: string },
): RatioEligibility {
  const comparability = checkComparable(a, b);
  const reasons: RatioRefusal[] = [...comparability.reasons];

  const metric = getMetric(a.metric);
  if (metric !== undefined && !metric.allowsRatio) {
    reasons.push('metric-forbids-ratio');
  }
  if (a.editorialStatus === 'provisional' || b.editorialStatus === 'provisional') {
    reasons.push('provisional-record');
  }
  if (!isPositiveDecimal(a.value) || !isPositiveDecimal(b.value)) {
    reasons.push('non-positive-value');
  }

  return { allowed: reasons.length === 0, reasons: dedupe(reasons) };
}

/** Whether a logarithmic axis is valid for a metric. */
export function allowsLogScale(metric: MetricId): boolean {
  return getMetric(metric)?.allowsLogScale ?? false;
}

/**
 * Money is the one quantity whose units do not convert.
 *
 * Every other unit in the registry has a fixed factor into its base. A
 * megahertz is a million hertz today and was a million hertz in 1969. A dollar
 * is not a fixed number of yen, the rate that would convert them is a property
 * of a date rather than of the hardware, and the price a maker asked in one
 * market is in any case a different commercial decision from the price it asked
 * in another rather than the same figure restated.
 *
 * So two prices are comparable only when they are in the same currency. The
 * check is pairwise rather than part of the comparability-group identifier,
 * because a figure recorded as `unknown` has no unit at all. "No price is
 * published for this machine" has to keep its group, and a group string that
 * could not be derived for an absence would break the row that absences live
 * in. Adding a second currency to the catalog therefore needs a recorded
 * decision about how the two sit in one row, not just a new unit.
 */
function sameCurrency(a: UnitId, b: UnitId): boolean {
  return quantityOf(a) !== 'currency' || quantityOf(b) !== 'currency' || a === b;
}

function sameBenchmark(
  a: BenchmarkIdentity | undefined,
  b: BenchmarkIdentity | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.id === b.id && a.version === b.version && a.variant === b.variant;
}

const POSITIVE_DECIMAL = /^\+?(?!0+(?:\.0+)?(?:[eE]|$))\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isPositiveDecimal(value: string): boolean {
  return POSITIVE_DECIMAL.test(value);
}

function dedupe<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
