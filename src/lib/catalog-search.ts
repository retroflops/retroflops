// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Fast, local name matching for the compact catalog export.
 *
 * Pagefind provides the richer full-text search in a production build. This
 * matcher keeps systems and components findable while developing, before that
 * generated index exists, and recognizes one-character spelling mistakes in a
 * name such as "vodoo" for "Voodoo".
 */

import type { CatalogSummary, CatalogSummaryRecord } from './catalog-summary.ts';

export interface CatalogNameMatch {
  readonly kind: 'system' | 'component';
  readonly slug: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly componentKind?: 'cpu' | 'gpu' | 'memory';
}

function terms(value: string): readonly string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Whether two words differ by at most a single insertion, deletion or replacement. */
function differsByOneCharacter(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) {
      return false;
    }
    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return true;
}

function recordMatches(record: CatalogSummaryRecord, queryTerms: readonly string[]): boolean {
  const recordTerms = terms(`${record.name} ${record.manufacturer} ${record.slug}`);
  return queryTerms.every((queryTerm) =>
    recordTerms.some(
      (recordTerm) =>
        recordTerm.includes(queryTerm) ||
        (queryTerm.length >= 4 &&
          recordTerm.length >= 4 &&
          differsByOneCharacter(queryTerm, recordTerm)),
    ),
  );
}

/**
 * Finds system and component names in the lightweight export. All query words
 * must match, keeping a query such as "nvidia 4090" useful without scoring or
 * inventing a performance rank.
 */
export function findCatalogNameMatches(
  summary: CatalogSummary,
  query: string,
): readonly CatalogNameMatch[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) {
    return [];
  }

  const systems = summary.systems
    .filter((record) => recordMatches(record, queryTerms))
    .map(({ slug, name, manufacturer }) => ({ kind: 'system' as const, slug, name, manufacturer }));
  const components = summary.components
    .filter((record) => recordMatches(record, queryTerms))
    .map(({ slug, name, manufacturer, kind }) => ({
      kind: 'component' as const,
      slug,
      name,
      manufacturer,
      componentKind: kind,
    }));

  return [...systems, ...components];
}
