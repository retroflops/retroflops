// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { MetricId, MeasurementScope } from './data/metrics.ts';
import type { ComponentRole } from './data/schema.ts';
import { sortConfigurationEntries, sortMeasurements } from './presentation-order.ts';

describe('presentation order', () => {
  it('orders every measurement scope, then registry metric order, then id', () => {
    const entries = [
      { id: 'whole', metric: 'rated-power-consumption', scope: 'whole-system' },
      { id: 'memory', metric: 'memory-capacity', scope: 'memory' },
      { id: 'gpu', metric: 'clock-frequency', scope: 'gpu' },
      { id: 'cpu-clock-z', metric: 'clock-frequency', scope: 'cpu' },
      { id: 'storage', metric: 'storage-capacity', scope: 'storage' },
      { id: 'cpu-rate', metric: 'native-instruction-rate', scope: 'cpu' },
      { id: 'cpu-clock-a', metric: 'clock-frequency', scope: 'cpu' },
    ] satisfies readonly { id: string; metric: MetricId; scope: MeasurementScope }[];

    expect(sortMeasurements(entries).map((entry) => entry.id)).toEqual([
      'cpu-clock-a',
      'cpu-clock-z',
      'cpu-rate',
      'gpu',
      'memory',
      'storage',
      'whole',
    ]);
  });

  it('orders every configuration role from processors to storage', () => {
    const entries = [
      { componentId: 'storage', role: 'storage' },
      { componentId: 'video-memory', role: 'video-memory' },
      { componentId: 'gpu', role: 'gpu' },
      { componentId: 'system-memory', role: 'system-memory' },
      { componentId: 'sound', role: 'sound-cpu' },
      { componentId: 'cpu-z', role: 'main-cpu' },
      { componentId: 'coprocessor', role: 'co-processor' },
      { componentId: 'unified-memory', role: 'unified-memory' },
      { componentId: 'cache', role: 'cache' },
      { componentId: 'cpu-a', role: 'main-cpu' },
    ] satisfies readonly { componentId: string; role: ComponentRole }[];

    expect(sortConfigurationEntries(entries).map((entry) => entry.componentId)).toEqual([
      'cpu-a',
      'cpu-z',
      'coprocessor',
      'sound',
      'gpu',
      'unified-memory',
      'system-memory',
      'video-memory',
      'cache',
      'storage',
    ]);
  });
});
