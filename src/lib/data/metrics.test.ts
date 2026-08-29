// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The metric registry as data.
 *
 * `units.test.ts` checks that every metric names a quantity the unit registry
 * can express. These are the invariants of the metric list itself, and most of
 * them are pinned sets rather than derived rules: which metrics forbid a ratio,
 * which are meaningless without a named benchmark. A pinned set fails when
 * somebody adds a metric without deciding those questions, which is the moment
 * the decision is cheap, the alternative is finding out from a chart that draws
 * a bar for "1.4× the process node".
 */

import { describe, expect, it } from 'vitest';

import { METHOD_IDS, methodAllowsMetric } from './methods.ts';
import {
  getMetric,
  isMetricId,
  MEASUREMENT_SCOPES,
  METRIC_IDS,
  METRICS,
  type MetricId,
} from './metrics.ts';

describe('metric registry invariants', () => {
  it('declares each metric id exactly once, in kebab case', () => {
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length);
    expect(METRIC_IDS.filter((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toEqual([]);
  });

  it('gives every metric at least one scope, all of them known', () => {
    const known = new Set<string>(MEASUREMENT_SCOPES);
    const offenders = METRIC_IDS.filter((id) => {
      const scopes = getMetric(id)?.allowedScopes ?? [];
      return scopes.length === 0 || scopes.some((scope) => !known.has(scope));
    });
    expect(offenders).toEqual([]);
  });

  it('describes every metric in enough words to say what it is not', () => {
    for (const id of METRIC_IDS) {
      const metric = getMetric(id);
      expect(metric?.label).toBeTruthy();
      expect(metric?.description.length).toBeGreaterThan(30);
    }
  });

  it('is closed, so a typo becomes an unknown metric rather than a new one', () => {
    expect(isMetricId('peak-fp32-rate')).toBe(true);
    expect(isMetricId('peak-fp32')).toBe(false);
    expect(getMetric('flops-per-dollar')).toBeUndefined();
    expect(METRICS.size).toBe(METRIC_IDS.length);
  });

  it('leaves no metric that no method may describe', () => {
    // `estimate-from-formula` allows every metric, so it would make this test
    // pass for a metric nothing else can produce, which is a metric no source
    // could ever state directly.
    const specific = METHOD_IDS.filter((method) => method !== 'estimate-from-formula');
    const unreachable = METRIC_IDS.filter(
      (metric) => !specific.some((method) => methodAllowsMetric(method, metric)),
    );
    expect(unreachable).toEqual([]);
  });
});

describe('metrics that refuse to be divided', () => {
  it('names exactly the figures whose ratio would assert nothing', () => {
    const forbidden = METRIC_IDS.filter((id) => getMetric(id)?.allowsRatio === false);
    expect(forbidden.toSorted()).toEqual(
      [
        // A cooling-design target defined differently by each vendor and era.
        'thermal-design-power',
        // A supply rating stated without any reproducible workload.
        'rated-power-consumption',
        // A marketing name that stopped being a physical dimension long ago.
        'process-node',
        // Two nominal prices from two years are not a multiple of each other
        // until a versioned CPI snapshot says what they are worth.
        'launch-price',
        // Half a nameplate each. They exist to be multiplied into watts, and a
        // machine whose supply runs at twice the voltage of another's is not
        // twice anything.
        'supply-voltage',
        'supply-current',
      ].toSorted(),
    );
  });

  it('never offers a log axis where it forbids a ratio', () => {
    const offenders = METRIC_IDS.filter((id) => {
      const metric = getMetric(id);
      return metric?.allowsRatio === false && metric.allowsLogScale;
    });
    expect(offenders).toEqual([]);
  });
});

describe('metrics that are meaningless without a named benchmark', () => {
  it('names exactly the benchmark-derived figures', () => {
    const required = METRIC_IDS.filter((id) => getMetric(id)?.requiresBenchmark === true);
    expect(required.toSorted()).toEqual(
      [
        'dhrystone-mips',
        'dhrystone-mips-per-mhz',
        'sustained-fp64-rate',
        'sustained-fp40-rate',
        'spec-cpu-result',
        'geekbench-score',
        'geekbench-compute-score',
        // A wall measurement without a stated workload is a number about a
        // moment rather than about the machine.
        'system-power-draw',
      ].toSorted(),
    );
  });

  it('never demands a benchmark for a figure read off a specification', () => {
    for (const id of ['clock-frequency', 'memory-capacity', 'peak-fp32-rate', 'launch-price']) {
      expect(getMetric(id)?.requiresBenchmark).toBe(false);
    }
  });
});

describe('quantities that share a scale and answer different questions', () => {
  it('keeps three power figures apart rather than calling them all power', () => {
    const power = METRIC_IDS.filter((id) => getMetric(id)?.quantity === 'power');
    expect(power.toSorted()).toEqual(
      ['thermal-design-power', 'system-power-draw', 'rated-power-consumption'].toSorted(),
    );
    // Only the measured one may be divided: the other two are vendor
    // definitions rather than observations of a running machine.
    expect(getMetric('system-power-draw')?.allowsRatio).toBe(true);
  });

  it('keeps memory apart from storage, which is where a program is kept', () => {
    for (const id of ['memory-capacity', 'storage-capacity'] as const) {
      expect(getMetric(id)?.quantity).toBe('data-capacity');
    }
    expect(getMetric('memory-capacity')?.allowedScopes).not.toContain('storage');
    expect(getMetric('storage-capacity')?.allowedScopes).toEqual(['storage']);
  });

  it('keeps a native instruction rate apart from a Dhrystone figure', () => {
    for (const id of ['native-instruction-rate', 'dhrystone-mips'] as const) {
      expect(getMetric(id)?.quantity).toBe('instruction-rate');
    }
    // Same quantity, and one requires a benchmark identity the other has no
    // business carrying: that is what keeps them in separate groups.
    expect(getMetric('native-instruction-rate')?.requiresBenchmark).toBe(false);
    expect(getMetric('dhrystone-mips')?.requiresBenchmark).toBe(true);
  });

  it('keeps each floating-point precision as its own metric', () => {
    const peaks: readonly MetricId[] = ['peak-fp16-rate', 'peak-fp32-rate', 'peak-fp64-rate'];
    for (const id of peaks) {
      expect(getMetric(id)?.quantity).toBe('floating-point-rate');
    }
    expect(new Set(peaks).size).toBe(peaks.length);
    expect(getMetric('sustained-fp40-rate')?.quantity).toBe('floating-point-rate');
  });
});
