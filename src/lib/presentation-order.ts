// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Stable, reader-oriented ordering for hardware shown on profile pages.
 *
 * Catalog records stay ordered by id in the public export. This module only
 * orders already-loaded records at the presentation boundary.
 */

import { METRIC_IDS } from './data/metrics.ts';
import type { ComponentRole, ConfigurationEntry, Measurement } from './data/schema.ts';

const SCOPE_ORDER: Readonly<Record<Measurement['scope'], number>> = {
  cpu: 0,
  gpu: 1,
  memory: 2,
  storage: 3,
  'whole-system': 4,
};

const METRIC_ORDER = new Map(METRIC_IDS.map((id, index) => [id, index]));

const ROLE_ORDER: Readonly<Record<ComponentRole, number>> = {
  'main-cpu': 0,
  'co-processor': 1,
  'sound-cpu': 2,
  gpu: 3,
  'unified-memory': 4,
  'system-memory': 5,
  'video-memory': 6,
  cache: 7,
  storage: 8,
};

function byNumberThenText(
  firstOrder: number,
  secondOrder: number,
  firstText: string,
  secondText: string,
): number {
  return firstOrder - secondOrder || firstText.localeCompare(secondText);
}

/** Sorts figures by hardware scope, metric registry order, then record id. */
export function sortMeasurements<T extends Pick<Measurement, 'id' | 'metric' | 'scope'>>(
  measurements: readonly T[],
): readonly T[] {
  return measurements.toSorted((left, right) => {
    const scope = SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope];
    if (scope !== 0) return scope;

    return byNumberThenText(
      METRIC_ORDER.get(left.metric) ?? Number.MAX_SAFE_INTEGER,
      METRIC_ORDER.get(right.metric) ?? Number.MAX_SAFE_INTEGER,
      left.id,
      right.id,
    );
  });
}

/** Sorts a configuration as CPU, graphics, memory, then storage. */
export function sortConfigurationEntries<
  T extends Pick<ConfigurationEntry, 'componentId' | 'role'>,
>(entries: readonly T[]): readonly T[] {
  return entries.toSorted((left, right) =>
    byNumberThenText(
      ROLE_ORDER[left.role],
      ROLE_ORDER[right.role],
      left.componentId,
      right.componentId,
    ),
  );
}
