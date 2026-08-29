// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { checkGroupFacets, deriveComparabilityGroup } from './comparability.ts';
import { METHOD_IDS, METHODS, getMethod, isMethodId, methodAllowsMetric } from './methods.ts';
import { isMetricId } from './metrics.ts';

describe('method registry', () => {
  it('names only metrics that exist', () => {
    for (const method of METHODS.values()) {
      expect(method.allowedMetrics.length).toBeGreaterThan(0);
      for (const metric of method.allowedMetrics) {
        expect(isMetricId(metric)).toBe(true);
      }
    }
  });

  it('has a label and a description for every method', () => {
    for (const id of METHOD_IDS) {
      const method = getMethod(id);
      expect(method?.label).toBeTruthy();
      expect(method?.description.length).toBeGreaterThan(40);
    }
  });

  it('is closed, so a typo cannot invent a comparability group', () => {
    expect(isMethodId('nominal-clock')).toBe(true);
    expect(isMethodId('nominal-clocks')).toBe(false);
    expect(getMethod('design-specification')).toBeUndefined();
  });

  it('refuses a method the metric has nothing to do with', () => {
    expect(methodAllowsMetric('nominal-clock', 'clock-frequency')).toBe(true);
    expect(methodAllowsMetric('nominal-clock', 'memory-capacity')).toBe(false);
    expect(
      checkGroupFacets({ metric: 'memory-capacity', scope: 'memory', method: 'nominal-clock' }),
    ).toContain('method-metric-mismatch');
  });

  it('keeps separate execution paths in separate groups', () => {
    // The same chip states a double-precision peak for its vector units and for
    // its tensor cores. Same metric, same scope, different question.
    const vector = deriveComparabilityGroup({
      metric: 'peak-fp64-rate',
      scope: 'gpu',
      method: 'theoretical-peak',
    });
    const tensor = deriveComparabilityGroup({
      metric: 'peak-fp64-rate',
      scope: 'gpu',
      method: 'tensor-core-peak',
    });
    expect(vector).not.toBe(tensor);
  });
});
