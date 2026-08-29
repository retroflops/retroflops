// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The comparability rules themselves.
 *
 * Other suites exercise these rules through something else: the formula registry
 * refuses inputs from two groups, validation rejects a hand-edited group, the
 * catalog tests assert the published records obey them. This one tests the
 * rules as rules, every refusal reason has a case, and every facet that is
 * deliberately *not* part of a group has a case proving it is not.
 *
 * That second half is the fragile one. A group that gains a facet still passes
 * every test that only checks refusals, because a stricter rule refuses more; it
 * fails here, where "a vendor's clock and an independent measurement of the same
 * clock belong in one row" is written down as an assertion.
 */

import { describe, expect, it } from 'vitest';

import {
  allowsLogScale,
  checkComparable,
  checkFacets,
  checkGroupFacets,
  checkRatioEligibility,
  deriveComparabilityGroup,
  type ComparabilityFacets,
} from './comparability.ts';
import type { MethodId } from './methods.ts';
import type { MetricId } from './metrics.ts';
import type { UnitId } from './units.ts';

/** A stated nominal clock, the plainest figure in the catalog. */
const CLOCK: ComparabilityFacets = {
  metric: 'clock-frequency',
  scope: 'cpu',
  method: 'nominal-clock',
  unit: 'MHz',
  status: 'vendor-rated',
  editorialStatus: 'approved',
};

const facets = (overrides: Partial<ComparabilityFacets>): ComparabilityFacets => ({
  ...CLOCK,
  ...overrides,
});

describe('comparability group identifiers', () => {
  it('is built from metric, scope and method', () => {
    expect(deriveComparabilityGroup(CLOCK)).toBe('clock-frequency|cpu|nominal-clock');
  });

  it('carries the benchmark identity, version and variant when there is one', () => {
    const base = {
      metric: 'geekbench-score',
      scope: 'whole-system',
      method: 'benchmark-run',
    } as const;
    expect(
      deriveComparabilityGroup({ ...base, benchmark: { id: 'geekbench', version: '6' } }),
    ).toBe('geekbench-score|whole-system|benchmark-run|geekbench@6');
    expect(
      deriveComparabilityGroup({
        ...base,
        benchmark: { id: 'geekbench', version: '6', variant: 'multi-core' },
      }),
    ).toBe('geekbench-score|whole-system|benchmark-run|geekbench@6:multi-core');
  });

  it('does not depend on the unit, so a figure recorded as absent still has a group', () => {
    // The reason absences share a row with the figures around them: "this
    // machine states no price" has no unit and still belongs somewhere.
    expect(deriveComparabilityGroup(facets({ unit: 'GHz' }))).toBe(deriveComparabilityGroup(CLOCK));
  });
});

describe('facets of a single figure', () => {
  it('accepts a well-formed figure', () => {
    expect(checkFacets(CLOCK)).toEqual([]);
  });

  it('refuses a metric the registry does not define', () => {
    expect(checkFacets(facets({ metric: 'flops-per-dollar' as MetricId }))).toEqual([
      'unknown-metric',
    ]);
  });

  it('refuses a unit the registry does not define', () => {
    expect(checkFacets(facets({ unit: 'furlong' as UnitId }))).toEqual(['unknown-unit']);
  });

  it('refuses a method the registry does not define', () => {
    expect(checkGroupFacets(facets({ method: 'vendor-stated-peak' as MethodId }))).toEqual([
      'unknown-method',
    ]);
  });

  it('refuses a method that has nothing to do with the metric', () => {
    expect(checkGroupFacets(facets({ metric: 'memory-capacity', scope: 'memory' }))).toEqual([
      'method-metric-mismatch',
    ]);
  });

  it('refuses a scope the metric does not allow', () => {
    // Whole-system power is a wall measurement of a complete machine; a clock
    // belongs to a part of one and never to the machine as a whole.
    expect(checkGroupFacets(facets({ scope: 'whole-system' }))).toContain('scope-not-allowed');
  });

  it('refuses a benchmark-dependent figure with no benchmark named', () => {
    expect(
      checkGroupFacets({
        metric: 'spec-cpu-result',
        scope: 'cpu',
        method: 'spec-published-result',
      }),
    ).toEqual(['benchmark-required']);
  });

  it('refuses a unit from a different quantity than the metric measures', () => {
    // Both are dimensionless, which is not something they have in common.
    expect(
      checkFacets(
        facets({
          metric: 'spec-cpu-result',
          scope: 'cpu',
          method: 'spec-published-result',
          unit: 'DMIPS/MHz',
        }),
      ),
    ).toContain('unit-quantity-not-allowed');
  });
});

describe('two figures side by side', () => {
  it('accepts the same quantity obtained the same way', () => {
    const result = checkComparable(CLOCK, CLOCK);
    expect(result.comparable).toBe(true);
    expect(result.group).toBe('clock-frequency|cpu|nominal-clock');
  });

  it('accepts two units of one quantity, because megahertz convert into gigahertz', () => {
    expect(checkComparable(CLOCK, facets({ unit: 'GHz' })).comparable).toBe(true);
  });

  it('refuses two different metrics', () => {
    const instructions = facets({
      metric: 'native-instruction-rate',
      method: 'theoretical-peak',
      unit: 'MIPS',
    });
    expect(checkComparable(CLOCK, instructions).reasons).toContain('metric-mismatch');
  });

  it('refuses a component rating against a whole-system measurement', () => {
    // Three power metrics exist precisely so that a cooling-design target, a
    // supply rating and a measured wall draw cannot be put in one column.
    const tdp = facets({
      metric: 'thermal-design-power',
      scope: 'gpu',
      method: 'rated-power',
      unit: 'W',
    });
    const wall = facets({
      metric: 'system-power-draw',
      scope: 'whole-system',
      method: 'wall-measurement',
      unit: 'W',
      benchmark: { id: 'digital-foundry-load', version: '2016' },
    });
    const reasons = checkComparable(tdp, wall).reasons;
    expect(reasons).toContain('metric-mismatch');
    expect(reasons).toContain('scope-mismatch');
    expect(reasons).toContain('method-mismatch');
  });

  it('refuses a theoretical peak against a benchmarked result', () => {
    const peak = facets({
      metric: 'peak-fp64-rate',
      scope: 'gpu',
      method: 'theoretical-peak',
      unit: 'GFLOP/s',
    });
    const sustained = facets({
      metric: 'peak-fp64-rate',
      scope: 'gpu',
      method: 'estimate-from-formula',
      unit: 'GFLOP/s',
    });
    expect(checkComparable(peak, sustained).reasons).toEqual(['method-mismatch']);
  });

  it('refuses two versions of one benchmark', () => {
    const five = facets({
      metric: 'geekbench-score',
      scope: 'whole-system',
      method: 'benchmark-run',
      unit: 'score',
      benchmark: { id: 'geekbench', version: '5', variant: 'multi-core' },
    });
    const six = facets({
      ...five,
      benchmark: { id: 'geekbench', version: '6', variant: 'multi-core' },
    });
    expect(checkComparable(five, six).reasons).toEqual(['benchmark-mismatch']);
  });

  it('refuses a single-core score against a multi-core one', () => {
    const single = facets({
      metric: 'geekbench-score',
      scope: 'whole-system',
      method: 'benchmark-run',
      unit: 'score',
      benchmark: { id: 'geekbench', version: '6', variant: 'single-core' },
    });
    const multi = facets({
      ...single,
      benchmark: { id: 'geekbench', version: '6', variant: 'multi-core' },
    });
    expect(checkComparable(single, multi).reasons).toEqual(['benchmark-mismatch']);
  });

  it('refuses a Metal compute score against an OpenCL one', () => {
    // The graphics API is part of the benchmark identity: two runs of one suite
    // against two drivers are not two measurements of one thing.
    const metal = facets({
      metric: 'geekbench-compute-score',
      scope: 'gpu',
      method: 'benchmark-chart-average',
      unit: 'score',
      benchmark: { id: 'geekbench-compute', version: '6', variant: 'metal' },
    });
    const opencl = facets({
      ...metal,
      benchmark: { id: 'geekbench-compute', version: '7', variant: 'opencl' },
    });
    expect(checkComparable(metal, opencl).reasons).toEqual(['benchmark-mismatch']);
  });

  it('refuses a compute score against a processor score of the same suite', () => {
    // Different metrics, so the pair never reaches the benchmark check: version
    // 7 calibrates the two against baselines forty times apart.
    const compute = facets({
      metric: 'geekbench-compute-score',
      scope: 'gpu',
      method: 'benchmark-chart-average',
      unit: 'score',
      benchmark: { id: 'geekbench-compute', version: '7', variant: 'opencl' },
    });
    const processor = facets({
      metric: 'geekbench-score',
      scope: 'whole-system',
      method: 'benchmark-chart-average',
      unit: 'score',
      benchmark: { id: 'geekbench', version: '7', variant: 'multi-core' },
    });
    expect(checkComparable(compute, processor).reasons).toContain('metric-mismatch');
  });

  it('refuses a benchmarked figure against one from the same metric with no benchmark named', () => {
    const named = facets({
      metric: 'geekbench-score',
      scope: 'whole-system',
      method: 'benchmark-run',
      unit: 'score',
      benchmark: { id: 'geekbench', version: '6' },
    });
    const anonymous = facets({ ...named, benchmark: undefined });
    const reasons = checkComparable(named, anonymous).reasons;
    // The unnamed one is refused on its own account before the pair is judged.
    expect(reasons).toEqual(['benchmark-required']);
  });

  it('reports each reason once however many figures raise it', () => {
    const broken = facets({ metric: 'flops-per-dollar' as MetricId });
    expect(checkComparable(broken, broken).reasons).toEqual(['unknown-metric']);
  });

  it('keeps who published a figure out of the comparison', () => {
    // The rule the model was repaired for: a vendor's silence must not cut its
    // hardware off from every figure somebody else published. Provenance and
    // evidence stage live on the measurement and never reach these facets.
    const measured = facets({ status: 'measured' });
    const rated = facets({ status: 'vendor-rated' });
    expect(checkComparable(measured, rated).comparable).toBe(true);
  });

  it('compares an approved figure with a provisional one', () => {
    // Comparable, and still barred from a multiplier, two different rules.
    expect(checkComparable(CLOCK, facets({ editorialStatus: 'provisional' })).comparable).toBe(
      true,
    );
  });
});

describe('eligibility for an "N× faster" claim', () => {
  const priced = {
    metric: 'launch-price',
    scope: 'whole-system',
    method: 'list-price',
    unit: 'USD',
    status: 'vendor-rated',
    editorialStatus: 'approved',
  } as const;

  it('allows two approved, positive figures from one group', () => {
    expect(checkRatioEligibility({ ...CLOCK, value: '3200' }, { ...CLOCK, value: '1000' })).toEqual(
      { allowed: true, reasons: [] },
    );
  });

  it('refuses a metric whose ratios mean nothing', () => {
    const result = checkRatioEligibility({ ...priced, value: '599' }, { ...priced, value: '299' });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('metric-forbids-ratio');
  });

  it('refuses a provisional record on either side', () => {
    const provisional = { ...facets({ editorialStatus: 'provisional' }), value: '1000' };
    expect(checkRatioEligibility({ ...CLOCK, value: '3200' }, provisional).reasons).toContain(
      'provisional-record',
    );
    expect(checkRatioEligibility(provisional, { ...CLOCK, value: '3200' }).reasons).toContain(
      'provisional-record',
    );
  });

  it('refuses a zero or negative denominator rather than dividing by it', () => {
    for (const value of ['0', '0.0', '0e5', '-1', '-0.5']) {
      expect(
        checkRatioEligibility({ ...CLOCK, value: '3200' }, { ...CLOCK, value }).reasons,
      ).toContain('non-positive-value');
    }
  });

  it('accepts exact decimals in the forms a source writes them', () => {
    for (const value of ['0.5', '1e3', '+2.5', '1.0E+2']) {
      expect(checkRatioEligibility({ ...CLOCK, value: '3200' }, { ...CLOCK, value }).allowed).toBe(
        true,
      );
    }
  });

  it('carries the incomparability reasons through rather than judging the pair twice', () => {
    const instructions = {
      ...facets({
        metric: 'dhrystone-mips',
        method: 'benchmark-run',
        unit: 'MIPS',
        benchmark: { id: 'dhrystone', version: '2.1' },
      }),
      value: '100',
    };
    const reasons = checkRatioEligibility({ ...CLOCK, value: '3200' }, instructions).reasons;
    expect(reasons).toContain('metric-mismatch');
  });
});

describe('logarithmic axes', () => {
  it('follows the metric rather than the chart', () => {
    expect(allowsLogScale('clock-frequency')).toBe(true);
    expect(allowsLogScale('process-node')).toBe(false);
    expect(allowsLogScale('launch-price')).toBe(false);
  });

  it('refuses an axis for a metric that does not exist', () => {
    expect(allowsLogScale('flops-per-dollar' as MetricId)).toBe(false);
  });
});
