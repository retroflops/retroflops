// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Trivia entries, resolved against the catalog at build time.
 *
 * A trivia entry is cultural context: what a machine was used for and what it
 * is remembered for. No figure anywhere in the catalog rests on one, so the
 * source tiers do not apply to it. The tiers are a rule about numeric evidence,
 * and a photograph is exempt for the same reason. Citation still applies. An
 * entry names the documents it rests on, and this module refuses one that names
 * a document the catalog does not hold.
 *
 * Resolution is strict for the reason the presets are strict. A profile that
 * silently loses its citations, and a trivia file attached to a machine renamed
 * two commits ago that renders on no page at all, are both worse than a failed
 * build. Only something that sees every file at once can make the unknown-slug
 * check. A per-page lookup never notices an orphan, because an orphan is the
 * file no page asks for.
 */

import { getCatalog } from './catalog.ts';
import { containsMarker } from './data/editorial-text.ts';
import type { Catalog, Source } from './data/schema.ts';

export interface TriviaData {
  readonly title: string;
  readonly sourceIds: readonly string[];
}

/** The shape both `astro:content` and the test's own front-matter reader produce. */
export interface TriviaEntry {
  /** The file name without its extension, which is the system slug. */
  readonly id: string;
  readonly data: TriviaData;
  /** The Markdown body, when the caller has it. */
  readonly body?: string;
}

export interface ResolvedTrivia {
  readonly slug: string;
  readonly title: string;
  readonly sources: readonly Source[];
}

const where = (id: string): string => `src/content/trivia/${id}.md`;

/**
 * Resolves one entry, naming the file in every failure.
 *
 * The file name is the system slug, so a mismatch is a misnamed file rather
 * than a missing field.
 */
export function resolveTrivia(entry: TriviaEntry, catalog: Catalog = getCatalog()): ResolvedTrivia {
  const system = catalog.systems.find((candidate) => candidate.slug === entry.id);
  if (system === undefined) {
    throw new Error(
      `Trivia file "${where(entry.id)}" names no system in the catalog. ` +
        'The file name is the system slug, so rename the file to a slug under ' +
        'data/canonical/systems, or remove it if the machine is gone.',
    );
  }

  /*
   * This does not use `getSourcesByIds`, because that helper drops an id it
   * cannot find. Dropping is right for the profile's already-validated source
   * list and wrong here, where finding the missing id is the entire job.
   */
  const sources = entry.data.sourceIds.map((id) => {
    const source = catalog.sources.find((candidate) => candidate.id === id);
    if (source === undefined) {
      throw new Error(
        `Trivia file "${where(entry.id)}" cites source "${id}", which the catalog does not hold. ` +
          'Add the record in data/sources and run "pnpm data:build", or fix the id.',
      );
    }
    return source;
  });

  /*
   * `data:build` resolves `{{measurement:…}}` and `{{context:…}}` over the
   * canonical dataset. A content collection never passes through it, so a marker
   * written here is not a broken reference. It is a pair of braces published to
   * a reader, so this refuses it instead.
   */
  if (entry.body !== undefined && containsMarker(entry.body)) {
    throw new Error(
      `Trivia file "${where(entry.id)}" contains a "{{…}}" marker. ` +
        'Markers are resolved only for canonical catalog prose; write the figure out, ' +
        'or state the fact in a sentence that does not need one.',
    );
  }

  return { slug: system.slug, title: entry.data.title, sources };
}

/**
 * Every entry, keyed by system slug, resolved once per build.
 *
 * Called from `getStaticPaths` rather than per page, so that a file naming a
 * machine the catalog does not have fails the build instead of being skipped in
 * silence.
 */
export function triviaBySystemSlug(
  entries: readonly TriviaEntry[],
  catalog: Catalog = getCatalog(),
): ReadonlyMap<string, ResolvedTrivia> {
  const resolved = new Map<string, ResolvedTrivia>();
  for (const entry of entries) {
    const trivia = resolveTrivia(entry, catalog);
    if (resolved.has(trivia.slug)) {
      throw new Error(`Two trivia files resolve to system "${trivia.slug}".`);
    }
    resolved.set(trivia.slug, trivia);
  }
  return resolved;
}
