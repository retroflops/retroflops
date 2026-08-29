// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The light catalog index, and the one question it answers well.
 *
 * `catalog-summary-v1.json` carries names, facets and, for every record, the
 * numeric comparability groups it has values in. It carries no values, so it is a
 * seventh of the full export, which is what makes it the right thing to fetch
 * before a reader has finished choosing records.
 *
 * The question is "will these records have anything to compare?". The Compare
 * builder could only answer it after fetching the whole catalog and assembling
 * the comparison, which meant a reader learned that two machines share nothing
 * only after asking for the comparison. Counting shared groups here says so
 * while the selection is still being made.
 *
 * It informs and never disables. Whether a comparison is worth making is the
 * reader's judgment, a selection with no shared group still shows what each
 * record states instead, and that is frequently the interesting part.
 */

export interface CatalogSummaryRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly manufacturer: string;
  /** Whether this record contributes numeric data to the main catalog. */
  readonly availability: 'catalog' | 'research';
  readonly valueCount: number;
  readonly approvedValueCount: number;
  readonly provisionalValueCount: number;
  readonly unknownCount: number;
  readonly notApplicableCount: number;
  /** Figures whose cited source nobody here has read yet. */
  readonly unverifiedCount: number;
  /** Comparability groups this record has numeric values in, its parts' included. */
  readonly comparabilityGroups: readonly string[];
}

export interface CatalogSummarySystemRecord extends CatalogSummaryRecord {
  readonly type: string;
}

export interface CatalogSummaryComponentRecord extends CatalogSummaryRecord {
  readonly kind: 'cpu' | 'gpu' | 'memory';
}

export interface CatalogSummary {
  readonly schemaVersion: string;
  readonly systems: readonly CatalogSummarySystemRecord[];
  readonly components: readonly CatalogSummaryComponentRecord[];
}

export class CatalogSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogSummaryError';
  }
}

let cached: CatalogSummary | undefined;

export async function fetchCatalogSummary(url: string): Promise<CatalogSummary> {
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new CatalogSummaryError(
      `The catalog summary could not be loaded from ${url} (HTTP ${response.status}).`,
    );
  }
  const summary = (await response.json()) as CatalogSummary;
  if (!Array.isArray(summary.systems) || !Array.isArray(summary.components)) {
    throw new CatalogSummaryError(`${url} does not look like a RetroFlops catalog summary.`);
  }
  cached = summary;
  return summary;
}

/**
 * Groups every selected record has a figure in.
 *
 * Variants are ignored: the summary is per record, and a machine's variants
 * differ in the values of their figures rather than in which questions they
 * answer. The count is therefore an upper bound on the rows a comparison can
 * pair, which is the right direction for a hint, it never promises a
 * comparison the engine will then refuse to make on a stricter ground.
 */
export function sharedComparabilityGroups(
  summary: CatalogSummary,
  selection: readonly { readonly kind: 'system' | 'component'; readonly slug: string }[],
): readonly string[] {
  if (selection.length < 2) {
    return [];
  }

  const lists = selection.map((entry) => {
    const records = entry.kind === 'system' ? summary.systems : summary.components;
    return records.find((record) => record.slug === entry.slug)?.comparabilityGroups;
  });
  if (lists.some((groups) => groups === undefined)) {
    return [];
  }

  const [first = [], ...rest] = lists as readonly (readonly string[])[];
  return first.filter((group) => rest.every((groups) => groups.includes(group))).toSorted();
}
