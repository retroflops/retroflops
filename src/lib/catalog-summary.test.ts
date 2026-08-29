// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sharedComparabilityGroups, type CatalogSummary } from './catalog-summary.ts';

/**
 * Read from the published artifact rather than a fixture, because the point of
 * these assertions is that the summary carries enough to answer the question at
 * all, a fixture would pass while the export shipped without the groups.
 */
const summary = JSON.parse(
  readFileSync('public/data/catalog-summary-v1.json', 'utf8'),
) as CatalogSummary;

describe('shared comparability groups', () => {
  it('lists a machine’s groups including those of its parts', () => {
    const c64 = summary.systems.find((system) => system.slug === 'commodore-64');
    // The capacity is recorded against the memory chip, the clock against the
    // machine; a reader choosing the Commodore 64 gets both.
    expect(c64?.comparabilityGroups).toContain('memory-capacity|memory|design-capacity');
    expect(c64?.comparabilityGroups).toContain('clock-frequency|cpu|nominal-clock');
  });

  it('finds what the selected systems have in common', () => {
    const shared = sharedComparabilityGroups(summary, [
      { kind: 'system', slug: 'commodore-64' },
      { kind: 'system', slug: 'apple-mac-mini-m1' },
      { kind: 'system', slug: 'sony-playstation-4' },
    ]);
    expect(shared).toContain('memory-capacity|whole-system|design-capacity');
  });

  it('says nothing is shared for an unresolved selection rather than guessing', () => {
    const shared = sharedComparabilityGroups(summary, [
      { kind: 'system', slug: 'commodore-64' },
      { kind: 'system', slug: 'not-a-system' },
    ]);
    expect(shared).toEqual([]);
  });

  it('needs two records before the question means anything', () => {
    expect(sharedComparabilityGroups(summary, [{ kind: 'system', slug: 'commodore-64' }])).toEqual(
      [],
    );
  });
});
