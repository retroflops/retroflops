// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The facet vocabulary, kept apart from the code that computes facets.
 *
 * Explore's filter island needs the group identifiers, and nothing else from the
 * facet machinery. When they lived in `facets.ts` the island's bundle also pulled
 * in `catalog.ts` and therefore Zod, around 55 kB of schema validation shipped
 * to a browser that never validates anything. Splitting the vocabulary out is the
 * whole fix: a module a browser imports must not reach the catalog.
 */

export const FACET_GROUP_IDS = ['kind', 'era', 'maker', 'isa', 'status'] as const;

export type FacetGroupId = (typeof FACET_GROUP_IDS)[number];

export interface FacetOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export interface FacetGroup {
  readonly id: FacetGroupId;
  readonly label: string;
  /** Shown under the group heading when the facet needs explaining. */
  readonly note?: string;
  readonly options: readonly FacetOption[];
}

/** The facet values of one catalog entry, keyed by group. */
export type EntryFacets = Readonly<Record<FacetGroupId, readonly string[]>>;
