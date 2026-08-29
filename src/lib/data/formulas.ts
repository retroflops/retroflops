// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Versioned formula registry for derived claims.
 *
 * A derived claim is never trusted as written: validation looks the formula up
 * here, recomputes it from the named input measurements, and rejects the record
 * if the stored result differs. Changing a formula therefore requires a new
 * version, because the old results would stop reproducing.
 *
 * Formulas operate on normalized inputs, base units and exact decimals, so a
 * formula never has to know about prefixes.
 */

import { checkRatioEligibility, type ComparabilityFacets } from './comparability.ts';
import {
  addDecimal,
  divideDecimal,
  formatDecimal,
  isPositive,
  multiplyDecimal,
  parseDecimal,
  roundToSignificantDigits,
  significantDigits as digitsPresent,
  type Decimal,
  type RoundingRule,
} from './decimal.ts';
import { getMetric } from './metrics.ts';
import { baseUnitOf, getUnit, type UnitId } from './units.ts';

export const FORMULA_REGISTRY_VERSION = 'formulas-v1';

export interface FormulaInput {
  readonly facets: ComparabilityFacets;
  /** Value in the quantity's base unit. */
  readonly value: string;
  readonly significantDigits: number;
}

/**
 * A figure deliberately left out of a computation.
 *
 * Carried as data rather than as prose in the caveat, so that "the read-only
 * memory is not part of this total" is a checkable statement about a named
 * record instead of a sentence somebody has to remember to update.
 */
export interface FormulaExclusion {
  readonly measurementId: string;
  /** Short label for the excluded figure, used in the generated caveat. */
  readonly label: string;
  readonly reason: string;
}

/**
 * A number a formula needs that is not a measurement of anything: how many lanes
 * a graphics processor issues from, how many operations one of them retires per
 * clock. Facts about an architecture rather than figures published about a
 * machine and the place a derivation goes wrong quietly. Each carries its
 * own sources and reason on the claim, and the generated caveat names it.
 */
export interface FormulaConstant {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly reason: string;
  readonly sourceIds: readonly string[];
}

export interface FormulaContext {
  readonly significantDigits: number;
  readonly rounding: RoundingRule;
  readonly exclusions?: readonly FormulaExclusion[] | undefined;
  readonly constants?: readonly FormulaConstant[] | undefined;
}

export interface FormulaResult {
  readonly value: string;
  readonly unit: UnitId;
  readonly significantDigits: number;
  /** Wording shown with the result, generated rather than hand-written. */
  readonly caveat: string;
}

export type FormulaOutcome =
  | { readonly ok: true; readonly result: FormulaResult }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface FormulaDefinition {
  readonly id: string;
  readonly version: string;
  /** Expression shown to readers next to the result. */
  readonly expression: string;
  /** How many inputs the formula takes; `max: null` means any number of them. */
  readonly arity: { readonly min: number; readonly max: number | null };
  compute(inputs: readonly FormulaInput[], context: FormulaContext): FormulaOutcome;
}

export function acceptsInputCount(formula: FormulaDefinition, count: number): boolean {
  return count >= formula.arity.min && (formula.arity.max === null || count <= formula.arity.max);
}

/**
 * `a / b` within one comparability group.
 *
 * This is the only route to an "N× faster" claim, and it refuses everything the
 * comparability rules refuse: different metrics, different methods, different
 * benchmark versions, ratio-forbidden metrics, provisional records and
 * non-positive values.
 */
const ratio: FormulaDefinition = {
  id: 'ratio',
  version: '1',
  expression: 'a ÷ b',
  arity: { min: 2, max: 2 },
  compute(inputs, { significantDigits, rounding }) {
    const [a, b] = inputs;
    if (a === undefined || b === undefined) {
      return { ok: false, reasons: ['ratio needs exactly two inputs'] };
    }

    const eligibility = checkRatioEligibility(
      { ...a.facets, value: a.value },
      { ...b.facets, value: b.value },
    );
    if (!eligibility.allowed) {
      return { ok: false, reasons: eligibility.reasons };
    }

    // A ratio is no more precise than its least precise input.
    const digits = Math.min(significantDigits, a.significantDigits, b.significantDigits);
    const value = divideDecimal(parseDecimal(a.value), parseDecimal(b.value), digits, rounding);

    return {
      ok: true,
      result: {
        value: formatDecimal(value),
        unit: 'unit',
        significantDigits: digits,
        caveat: buildRatioCaveat(a, b, digits),
      },
    };
  },
};

/**
 * `a + b + …` over figures of one metric, obtained the same way.
 *
 * It exists for one job: a machine's whole-system memory capacity when the
 * memory is split across several pools. That number is otherwise a curator
 * adding figures by hand, which cannot be re-checked and quietly hides what was
 * left out, the read-only memory, the pool that belongs to the drawing chip,
 * the sound chip's own store. Here the inputs are named records and the
 * exclusions are named records too, so both halves of the judgment are visible
 * and the total is recomputed on every build.
 *
 * The device scope is deliberately not constrained: summing pools recorded at
 * `memory` scope into a figure recorded at `whole-system` scope is the whole
 * point. Mixed metrics, mixed methods and non-positive values are refused as the
 * ratio refuses them.
 *
 * A provisional input is *not* refused, which is where this parts company with
 * the ratio. The rule provisional records exist to enforce is that an announced
 * figure never becomes an automatic "N× faster" claim, and that rule lives in
 * the ratio. Adding up two announced pools claims nothing beyond what was
 * announced, so validation instead requires the total to stay provisional,
 * where it goes on blocking every multiplier, exactly as its inputs do. Refusing
 * outright would have meant the PlayStation 3 and 4, whose bandwidths Sony only
 * ever announced, could state no machine-level memory bandwidth at all, and a
 * reader comparing consoles would see the row they came for left empty.
 */
const sum: FormulaDefinition = {
  id: 'sum',
  version: '1',
  expression: 'a + b + …',
  arity: { min: 1, max: null },
  compute(inputs, { significantDigits, rounding, exclusions }) {
    const first = inputs[0];
    if (first === undefined) {
      return { ok: false, reasons: ['sum needs at least one input'] };
    }

    const reasons: string[] = [];
    const metric = getMetric(first.facets.metric);
    if (metric === undefined) {
      return { ok: false, reasons: ['unknown-metric'] };
    }
    for (const input of inputs) {
      if (input.facets.metric !== first.facets.metric) {
        reasons.push('metric-mismatch');
      }
      if (input.facets.method !== first.facets.method) {
        reasons.push('method-mismatch');
      }
      if (getUnit(input.facets.unit)?.quantity !== metric.quantity) {
        reasons.push('unit-quantity-mismatch');
      }
      if (!isPositive(parseDecimal(input.value))) {
        reasons.push('non-positive-value');
      }
    }
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    const total = inputs
      .map((input) => parseDecimal(input.value))
      .reduce((left: Decimal, right: Decimal) => addDecimal(left, right));

    // Unlike a ratio, a sum of counts is exact: 32 MiB of main memory plus 4 MiB
    // of embedded memory is 37 748 736 bytes, not "about 38 million". So the
    // precision is not lowered to the least precise term. That would turn an
    // exact total into a rounded one. The claim states the width it reports at,
    // capped by the digits the exact total has, so a claim can never
    // report more precision than the arithmetic produced.
    const digits = Math.min(significantDigits, digitsPresent(total));
    const value = roundToSignificantDigits(total, digits, rounding);

    // Inputs arrive normalized, so the total is in the quantity's base unit
    // whatever prefixes the sources used. Stating it in the first input's unit
    // would silently relabel bytes as kibibytes.
    const unit = baseUnitOf(metric.quantity)?.id;
    if (unit === undefined) {
      return { ok: false, reasons: ['unknown-unit'] };
    }

    return {
      ok: true,
      result: {
        value: formatDecimal(value),
        unit,
        significantDigits: digits,
        caveat: buildSumCaveat(inputs, exclusions ?? []),
      },
    };
  },
};

/** Constants `clock-from-peak-fp32@1` needs, in the order the expression multiplies them. */
const CLOCK_FROM_PEAK_CONSTANTS = ['lanes', 'flops-per-lane-per-clock'] as const;

/**
 * The clock a vendor's floating-point peak implies: `peak ÷ (lanes × FLOP per
 * lane per clock)`.
 *
 * It exists because a maker sometimes publishes the rate and withholds the
 * frequency, Sony gave the PlayStation 4 eighteen compute units and 1.84
 * teraflops and never a megahertz, and the frequency is then sitting inside the
 * rate waiting to be divided out. Doing that division by hand and filing the
 * answer as a measurement would be the worst of both: a number with a citation
 * that does not contain it.
 *
 * So the result is a derived claim and stays one. It is deliberately *not*
 * published as a measurement of the machine's clock: this catalog records what
 * sources state, and what this states is what the vendor's own arithmetic
 * implies. Where somebody has since measured the clock, that figure is the
 * measurement and this is the corroboration standing beside it.
 *
 * The lane count and the operations each lane retires per clock are constants
 * rather than inputs because no source publishes them *about a machine*, they
 * are properties of the architecture, and they carry their own citations on the
 * claim. Getting either wrong scales the answer, which is why both are named in
 * the caveat rather than buried in the expression.
 */
const clockFromPeakFp32: FormulaDefinition = {
  id: 'clock-from-peak-fp32',
  version: '1',
  expression: 'peak FP32 ÷ (lanes × FLOP per lane per clock)',
  arity: { min: 1, max: 1 },
  compute(inputs, { significantDigits, rounding, constants }) {
    const peak = inputs[0];
    if (peak === undefined) {
      return { ok: false, reasons: ['clock-from-peak-fp32 needs exactly one input'] };
    }
    if (peak.facets.metric !== 'peak-fp32-rate') {
      return { ok: false, reasons: ['metric-mismatch'] };
    }
    if (getUnit(peak.facets.unit)?.quantity !== 'floating-point-rate') {
      return { ok: false, reasons: ['unit-quantity-mismatch'] };
    }

    const named = new Map((constants ?? []).map((constant) => [constant.id, constant]));
    const missing = CLOCK_FROM_PEAK_CONSTANTS.filter((id) => !named.has(id));
    if (missing.length > 0) {
      return { ok: false, reasons: missing.map((id) => `missing-constant:${id}`) };
    }

    let divisor = parseDecimal('1');
    for (const id of CLOCK_FROM_PEAK_CONSTANTS) {
      const constant = named.get(id);
      const value = parseDecimal(constant?.value ?? '0');
      if (!isPositive(value)) {
        return { ok: false, reasons: [`non-positive-constant:${id}`] };
      }
      divisor = multiplyDecimal(divisor, value);
    }

    // A count of lanes is exact, so it costs the result no precision: the answer
    // is as precise as the rate that was published, and no more.
    const digits = Math.min(significantDigits, peak.significantDigits);
    const value = divideDecimal(parseDecimal(peak.value), divisor, digits, rounding);

    return {
      ok: true,
      result: {
        value: formatDecimal(value),
        unit: 'Hz',
        significantDigits: digits,
        caveat: buildClockFromPeakCaveat(named, digits),
      },
    };
  },
};

const PEAK_FROM_CLOCK_CONSTANTS = ['issue-slots', 'flops-per-slot-per-clock'] as const;

/**
 * The floating-point peak a clock implies: `clock × issue slots × FLOP per slot
 * per clock`.
 *
 * The mirror image of the formula above, and it exists for the mirror-image
 * reason. A processor of the mid-1990s was documented by what its units could
 * retire per cycle and never by a rate: the R10000's manual says the adder and
 * the multiplier each accept one operation per cycle and stops there, because a
 * rate was not how anyone described a processor before it became a selling
 * point. The clock is published, the units per cycle are published, and the
 * multiplication between them is arithmetic nobody wrote down.
 *
 * As with the inverse, the result is a derived claim and stays one. The
 * difference from an estimate is the whole point: every term is cited, so a
 * reader can disagree with the constant rather than with a number that appeared
 * from nowhere.
 *
 * A peak computed this way is an upper bound twice over, the units must both be
 * fed every cycle, and nothing must stall, which the generated caveat says
 * outright, because a bound presented as a rate is the error this project exists
 * to avoid.
 */
const peakFp32FromClock: FormulaDefinition = {
  id: 'peak-fp32-from-clock',
  version: '1',
  expression: 'clock × issue slots × FLOP per slot per clock',
  arity: { min: 1, max: 1 },
  compute(inputs, { significantDigits, rounding, constants }) {
    const clock = inputs[0];
    if (clock === undefined) {
      return { ok: false, reasons: ['peak-fp32-from-clock needs exactly one input'] };
    }
    if (clock.facets.metric !== 'clock-frequency') {
      return { ok: false, reasons: ['metric-mismatch'] };
    }
    if (getUnit(clock.facets.unit)?.quantity !== 'frequency') {
      return { ok: false, reasons: ['unit-quantity-mismatch'] };
    }

    const named = new Map((constants ?? []).map((constant) => [constant.id, constant]));
    const missing = PEAK_FROM_CLOCK_CONSTANTS.filter((id) => !named.has(id));
    if (missing.length > 0) {
      return { ok: false, reasons: missing.map((id) => `missing-constant:${id}`) };
    }

    let product = parseDecimal(clock.value);
    for (const id of PEAK_FROM_CLOCK_CONSTANTS) {
      const constant = named.get(id);
      const value = parseDecimal(constant?.value ?? '0');
      if (!isPositive(value)) {
        return { ok: false, reasons: [`non-positive-constant:${id}`] };
      }
      product = multiplyDecimal(product, value);
    }

    // Counts are exact, so the answer is as precise as the clock and no more.
    const digits = Math.min(significantDigits, clock.significantDigits);
    return {
      ok: true,
      result: {
        value: formatDecimal(roundToSignificantDigits(product, digits, rounding)),
        unit: 'FLOP/s',
        significantDigits: digits,
        caveat: buildPeakFromClockCaveat(named, digits),
      },
    };
  },
};

/**
 * Watts from a nameplate: `voltage × current`.
 *
 * The registry had no product of two quantities at all, and three figures were
 * waiting on one. A console maker of the retro era frequently published the
 * supply's rating and never a wattage, Nintendo's GameCube page says
 * "DC12V x 3.25A", its ecodesign disclosure gives the Switch adapter 15.0 V and
 * 2.6 A, so the power figure exists in the document, split across two rows.
 *
 * For direct current the multiplication is exact: no power factor, no phase, no
 * assumption of any kind. That is what separates this from an estimate, and why
 * it is worth deriving rather than leaving unknown. What it is *not* is the
 * machine's draw, a supply is specified for the worst case and usually for some
 * headroom above it, so the caveat says so, and the metric it produces is the
 * one that already refuses to form multipliers.
 *
 * Both inputs are measurements rather than constants: a nameplate voltage is a
 * figure the maker published about this machine, not a fact about an
 * architecture, and it is citable on its own.
 */
const powerFromVoltageCurrent: FormulaDefinition = {
  id: 'power-from-voltage-current',
  version: '1',
  expression: 'voltage × current',
  arity: { min: 2, max: 2 },
  compute(inputs, { significantDigits, rounding }) {
    const [voltage, current] = inputs;
    if (voltage === undefined || current === undefined) {
      return { ok: false, reasons: ['power-from-voltage-current needs exactly two inputs'] };
    }

    const reasons: string[] = [];
    // Order is part of the formula: the expression names the voltage first, and
    // an input pair filed the other way round would recompute to the same watts
    // while describing something else.
    if (voltage.facets.metric !== 'supply-voltage') {
      reasons.push('metric-mismatch:supply-voltage');
    }
    if (current.facets.metric !== 'supply-current') {
      reasons.push('metric-mismatch:supply-current');
    }
    if (getUnit(voltage.facets.unit)?.quantity !== 'voltage') {
      reasons.push('unit-quantity-mismatch:voltage');
    }
    if (getUnit(current.facets.unit)?.quantity !== 'current') {
      reasons.push('unit-quantity-mismatch:current');
    }
    for (const input of [voltage, current]) {
      if (!isPositive(parseDecimal(input.value))) {
        reasons.push('non-positive-value');
      }
    }
    // A supply's two rows describe one supply; pairing a console's voltage with
    // another machine's current would produce arithmetic about nothing.
    if (voltage.facets.scope !== current.facets.scope) {
      reasons.push('scope-mismatch');
    }
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    const product = multiplyDecimal(parseDecimal(voltage.value), parseDecimal(current.value));
    const digits = Math.min(
      significantDigits,
      voltage.significantDigits,
      current.significantDigits,
    );

    return {
      ok: true,
      result: {
        value: formatDecimal(roundToSignificantDigits(product, digits, rounding)),
        unit: 'W',
        significantDigits: digits,
        caveat: buildPowerFromNameplateCaveat(digits),
      },
    };
  },
};

/** Bits in a byte. A unit conversion, not an architectural assumption. */
const BITS_PER_BYTE = '8';

/**
 * Bytes per second from a memory specification: `transfer rate × bus width ÷ 8`.
 *
 * The second product the registry was missing, and the same shape of gap: Valve
 * states the Steam Deck's memory as "5500 MT/s quad 32-bit channels" and never
 * publishes a bandwidth, which is how memory has been specified for decades,
 * the rate and the width are the specification, and the bandwidth is what a
 * reader is expected to work out.
 *
 * Both terms are inputs rather than constants, because both are published about
 * the machine. The division by eight is neither: it is the definition of a byte,
 * and putting it in the expression rather than in a cited constant keeps it out
 * of the list of things a reader might reasonably disagree with.
 *
 * The result is a bus peak. Refresh, turnaround and contention all take some of
 * it back, which the caveat states, and the comparability group keeps it away
 * from any benchmarked bandwidth.
 */
const memoryBandwidthFromTransferRate: FormulaDefinition = {
  id: 'memory-bandwidth-from-transfer-rate',
  version: '1',
  expression: 'transfer rate × bus width ÷ 8 bits per byte',
  arity: { min: 2, max: 2 },
  compute(inputs, { significantDigits, rounding }) {
    const [rate, width] = inputs;
    if (rate === undefined || width === undefined) {
      return {
        ok: false,
        reasons: ['memory-bandwidth-from-transfer-rate needs exactly two inputs'],
      };
    }

    const reasons: string[] = [];
    if (rate.facets.metric !== 'memory-transfer-rate') {
      reasons.push('metric-mismatch:memory-transfer-rate');
    }
    if (width.facets.metric !== 'memory-bus-width') {
      reasons.push('metric-mismatch:memory-bus-width');
    }
    if (getUnit(rate.facets.unit)?.quantity !== 'transfer-rate') {
      reasons.push('unit-quantity-mismatch:transfer-rate');
    }
    if (getUnit(width.facets.unit)?.quantity !== 'bus-width') {
      reasons.push('unit-quantity-mismatch:bus-width');
    }
    for (const input of [rate, width]) {
      if (!isPositive(parseDecimal(input.value))) {
        reasons.push('non-positive-value');
      }
    }
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    // A bus width is a count of lines, so it is exact and costs the answer no
    // precision: the bandwidth is as precise as the published transfer rate.
    const digits = Math.min(significantDigits, rate.significantDigits);
    const bits = multiplyDecimal(parseDecimal(rate.value), parseDecimal(width.value));
    const value = divideDecimal(bits, parseDecimal(BITS_PER_BYTE), digits, rounding);

    return {
      ok: true,
      result: {
        value: formatDecimal(value),
        unit: 'B/s',
        significantDigits: digits,
        caveat: buildBandwidthFromTransferRateCaveat(width, digits),
      },
    };
  },
};

const MEMORY_BANDWIDTH_FROM_CYCLE_TIME_CONSTANTS = ['bytes-per-memory-cycle'] as const;

/**
 * Bytes per second from a byte-addressed memory cycle: `bytes per cycle ÷ cycle time`.
 *
 * Some older manuals specify a memory interface in nanoseconds per byte rather
 * than in a transfer rate. This is the same interface ceiling in the reciprocal
 * form. The byte count is a cited constant because an eight-bit data path and a
 * wider path with the same cycle time produce different bandwidths.
 */
const memoryBandwidthFromCycleTime: FormulaDefinition = {
  id: 'memory-bandwidth-from-cycle-time',
  version: '1',
  expression: 'bytes per memory cycle ÷ memory cycle time',
  arity: { min: 1, max: 1 },
  compute(inputs, { significantDigits, rounding, constants }) {
    const cycle = inputs[0];
    if (cycle === undefined) {
      return {
        ok: false,
        reasons: ['memory-bandwidth-from-cycle-time needs exactly one input'],
      };
    }

    const reasons: string[] = [];
    if (cycle.facets.metric !== 'memory-cycle-time') {
      reasons.push('metric-mismatch:memory-cycle-time');
    }
    if (getUnit(cycle.facets.unit)?.quantity !== 'time') {
      reasons.push('unit-quantity-mismatch:time');
    }
    if (!isPositive(parseDecimal(cycle.value))) {
      reasons.push('non-positive-value');
    }

    const named = new Map((constants ?? []).map((constant) => [constant.id, constant]));
    const constantId = MEMORY_BANDWIDTH_FROM_CYCLE_TIME_CONSTANTS[0];
    const bytesPerCycle = named.get(constantId);
    if (bytesPerCycle === undefined) {
      reasons.push(`missing-constant:${constantId}`);
    } else if (!isPositive(parseDecimal(bytesPerCycle.value))) {
      reasons.push(`non-positive-constant:${constantId}`);
    }
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    const bytes = parseDecimal(bytesPerCycle?.value ?? '0');
    const digits = Math.min(significantDigits, cycle.significantDigits);
    const value = divideDecimal(bytes, parseDecimal(cycle.value), digits, rounding);

    return {
      ok: true,
      result: {
        value: formatDecimal(value),
        unit: 'B/s',
        significantDigits: digits,
        caveat: buildBandwidthFromCycleTimeCaveat(bytesPerCycle?.label ?? constantId, digits),
      },
    };
  },
};

/** CPI observations required by `price-adjusted-by-cpi@1`, in expression order. */
const PRICE_CPI_CONSTANTS = ['target-cpi-u', 'launch-cpi-u'] as const;

/**
 * A nominal U.S. launch price restated in dollars at a frozen CPI-U observation.
 *
 * A dollar does not have a fixed conversion factor across time. The price is
 * therefore kept as the sourced launch figure, and this formula publishes the
 * adjustment beside it as an explicitly derived value. The CPI observations are
 * constants because they describe the U.S. consumer price index, not the
 * hardware being priced. Each claim names the two monthly observations and the
 * frozen BLS response that supplied them.
 *
 * This is deliberately not a ratio claim. CPI can restate two U.S. dollar list
 * prices in a common month's dollars, but it does not make them a performance
 * multiple and it says nothing about prices in another market or currency.
 */
const priceAdjustedByCpi: FormulaDefinition = {
  id: 'price-adjusted-by-cpi',
  version: '1',
  expression: 'nominal price × target CPI-U ÷ launch CPI-U',
  arity: { min: 1, max: 1 },
  compute(inputs, { significantDigits, rounding, constants }) {
    const price = inputs[0];
    if (price === undefined) {
      return { ok: false, reasons: ['price-adjusted-by-cpi needs exactly one input'] };
    }

    const reasons: string[] = [];
    if (price.facets.metric !== 'launch-price') {
      reasons.push('metric-mismatch:launch-price');
    }
    if (price.facets.unit !== 'USD') {
      reasons.push('unit-mismatch:USD');
    }
    if (!isPositive(parseDecimal(price.value))) {
      reasons.push('non-positive-value');
    }

    const named = new Map((constants ?? []).map((constant) => [constant.id, constant]));
    const missing = PRICE_CPI_CONSTANTS.filter((id) => !named.has(id));
    if (missing.length > 0) {
      reasons.push(...missing.map((id) => `missing-constant:${id}`));
    }
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    const target = named.get('target-cpi-u');
    const launch = named.get('launch-cpi-u');
    const targetValue = parseDecimal(target?.value ?? '0');
    const launchValue = parseDecimal(launch?.value ?? '0');
    if (!isPositive(targetValue)) reasons.push('non-positive-constant:target-cpi-u');
    if (!isPositive(launchValue)) reasons.push('non-positive-constant:launch-cpi-u');
    if (reasons.length > 0) {
      return { ok: false, reasons: [...new Set(reasons)] };
    }

    const digits = Math.min(significantDigits, price.significantDigits);
    const adjusted = divideDecimal(
      multiplyDecimal(parseDecimal(price.value), targetValue),
      launchValue,
      digits,
      rounding,
    );

    return {
      ok: true,
      result: {
        value: formatDecimal(adjusted),
        unit: 'USD',
        significantDigits: digits,
        caveat: buildPriceAdjustedByCpiCaveat(
          target?.label ?? 'target CPI-U',
          launch?.label ?? 'launch CPI-U',
          digits,
        ),
      },
    };
  },
};

const FORMULA_LIST: readonly FormulaDefinition[] = [
  ratio,
  sum,
  clockFromPeakFp32,
  peakFp32FromClock,
  powerFromVoltageCurrent,
  memoryBandwidthFromTransferRate,
  memoryBandwidthFromCycleTime,
  priceAdjustedByCpi,
];

export const FORMULAS: ReadonlyMap<string, FormulaDefinition> = new Map(
  FORMULA_LIST.map((formula) => [`${formula.id}@${formula.version}`, formula]),
);

export function getFormula(id: string, version: string): FormulaDefinition | undefined {
  return FORMULAS.get(`${id}@${version}`);
}

function buildSumCaveat(
  inputs: readonly FormulaInput[],
  exclusions: readonly FormulaExclusion[],
): string {
  const first = inputs[0];
  const term = inputs.length === 1 ? 'figure' : 'figures';
  const left =
    exclusions.length === 0
      ? 'Nothing in the catalog is left out of it.'
      : `Left out: ${exclusions
          .map((exclusion) => `{{measurement:${exclusion.measurementId}}} (${exclusion.reason})`)
          .join('; ')}.`;
  return (
    `Adds ${inputs.length} ${first?.facets.metric ?? ''} ${term} obtained by ` +
    `${first?.facets.method ?? ''}. ${left} A total is only as trustworthy as the ` +
    'decision about what belongs in it, so both the terms and the exclusions are named records.'
  );
}

function buildPeakFromClockCaveat(
  constants: ReadonlyMap<string, FormulaConstant>,
  digits: number,
): string {
  const named = PEAK_FROM_CLOCK_CONSTANTS.map((id) => constants.get(id)?.label ?? id).join(' × ');
  return (
    `Multiplies a published clock by ${named}, so it is what the documented hardware implies ` +
    'rather than a rate anybody published. Reported to ' +
    `${digits} significant digit${digits === 1 ? '' : 's'} — the precision of the clock, since ` +
    'the counts are exact. It is a peak in the strictest sense: it assumes every unit is fed on ' +
    'every cycle and nothing ever stalls, which no real program achieves. Both constants are ' +
    'assumptions about the architecture, cited on this claim.'
  );
}

function buildClockFromPeakCaveat(
  constants: ReadonlyMap<string, FormulaConstant>,
  digits: number,
): string {
  const named = CLOCK_FROM_PEAK_CONSTANTS.map((id) => constants.get(id)?.label ?? id).join(' × ');
  return (
    `Divides a published single-precision peak by ${named}, so it is what the vendor’s own ` +
    'figure implies rather than a frequency anybody stated. Reported to ' +
    `${digits} significant digit${digits === 1 ? '' : 's'} — the precision of the published ` +
    'rate. Both constants are assumptions about the architecture, cited on this claim: get ' +
    'either wrong and the answer scales with it.'
  );
}

function buildPowerFromNameplateCaveat(digits: number): string {
  return (
    'Multiplies the two halves of a supply rating the maker published instead of a wattage. ' +
    'The arithmetic is exact for direct current — no power factor, nothing assumed — so this is ' +
    'not an estimate. It is still a rating and not a draw: a supply is specified for the worst ' +
    'case with headroom above it, and a machine at rest or at play may use a small fraction of ' +
    `it. Reported to ${digits} significant digit${digits === 1 ? '' : 's'}, the precision of the ` +
    'less precise of the two published figures.'
  );
}

function buildBandwidthFromTransferRateCaveat(_width: FormulaInput, digits: number): string {
  return (
    'Multiplies a published transfer rate by the recorded interface width and divides by the ' +
    'recorded bits-per-byte constant. That is how a memory specification is read when the maker ' +
    'states the rate and the width but no bandwidth. It is the bus at its peak: refresh, bus ' +
    'turnaround and contention between the parts sharing the memory all take some of it back, ' +
    `and no workload sees the whole figure. Reported to ${digits} significant digit` +
    `${digits === 1 ? '' : 's'} — the precision of the transfer rate, since the width is exact.`
  );
}

function buildBandwidthFromCycleTimeCaveat(bytesPerCycle: string, digits: number): string {
  return (
    `Divides ${bytesPerCycle} by the published memory cycle time. The result is an interface ` +
    'ceiling when a manual specifies nanoseconds per byte instead of a transfer rate. It is not ' +
    'measured application throughput: refresh, contention and wait states can consume cycles. ' +
    `Reported to ${digits} significant digit${digits === 1 ? '' : 's'}. That is the precision of ` +
    'the cycle time, because the bytes-per-cycle constant is exact.'
  );
}

function buildPriceAdjustedByCpiCaveat(target: string, launch: string, digits: number): string {
  return (
    `Multiplies the nominal U.S. list price by ${target} and divides by ${launch}. ` +
    'The original price remains the cited launch figure. CPI-U adjusts for U.S. consumer prices; ' +
    'it does not convert currencies or markets. Reported to ' +
    `${digits} significant digit${digits === 1 ? '' : 's'}, the precision of the nominal price.`
  );
}

function buildRatioCaveat(a: FormulaInput, b: FormulaInput, digits: number): string {
  const benchmark =
    a.facets.benchmark === undefined
      ? ''
      : ` under ${a.facets.benchmark.id} ${a.facets.benchmark.version}`;
  // Both inputs share a comparability group by this point, so the shared facets
  // are read off `a`; only the confidence statuses can still differ.
  const theoretical = [a, b].some((figure) => figure.facets.status === 'theoretical')
    ? ' At least one input is a theoretical peak, which is an upper bound rather than an achieved result.'
    : '';
  // An estimate stays comparable. The group and editorial status decide that,
  // not confidence. A multiplier built on one must say so, or the
  // result reads as firmer than its inputs.
  const estimated = [a, b].some((figure) => figure.facets.status === 'estimated')
    ? ' At least one input is an estimate computed by a third party from stated inputs, so the result carries that estimate’s assumptions.'
    : '';
  return (
    `Compares ${a.facets.metric} at ${a.facets.scope} scope, obtained by ${a.facets.method}` +
    `${benchmark}. Valid only within this comparability group, and reported to ` +
    `${digits} significant digit${digits === 1 ? '' : 's'} — the precision of the least precise ` +
    `input.${theoretical}${estimated}`
  );
}
