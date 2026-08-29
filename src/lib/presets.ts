// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Comparison presets.
 *
 * A preset is an editorial claim that a handful of records are worth reading next
 * to each other, plus the prose that says what the comparison shows. The figures
 * and every multiplier still come from the catalog through `compare.ts`, so a
 * preset can promote a comparison but never soften a rule.
 *
 * Records are named by the same slugs the URLs use, so a preset's front matter
 * and a shared Compare link mean the same thing. Resolution is deliberately
 * strict: a preset that names a record the catalog does not have stops the
 * build, because a promoted comparison silently losing a column is worse than a
 * failed deploy.
 */

import { catalogAvailability, type RecordAvailability } from './catalog-availability.ts';
import { getCatalog } from './catalog.ts';
import { buildComparison, formatCompareQuery, type CompareSelectionEntry } from './compare.ts';
import type { Comparison } from './compare.ts';
import type { Catalog } from './data/schema.ts';

export interface PresetData {
  readonly title: string;
  readonly summary: string;
  readonly kind: 'system' | 'component';
  readonly records: readonly string[];
  readonly promoted: boolean;
}

/**
 * A preset follows the availability of the records it selects. This is derived
 * from the export rather than authored beside the editorial argument, so a new
 * numeric measurement moves the preset back into ordinary catalog discovery.
 */
export interface PresetAvailability {
  readonly availability: RecordAvailability;
  readonly catalogRecordCount: number;
  readonly researchRecordCount: number;
  readonly researchSlugs: readonly string[];
}

/** Turns a preset's record list into a selection the engine understands. */
export function presetSelection(preset: PresetData): readonly CompareSelectionEntry[] {
  return preset.records.map((token): CompareSelectionEntry => {
    const [slug = '', configurationId] = token.split('@');
    return { kind: preset.kind, slug, configurationId };
  });
}

/** The Compare URL a preset corresponds to, so both routes stay in step. */
export function presetQuery(preset: PresetData): string {
  return formatCompareQuery(presetSelection(preset));
}

/** Reader-facing availability for a prepared comparison. */
export function presetAvailability(
  preset: PresetData,
  catalog: Catalog = getCatalog(),
): PresetAvailability {
  const availability = catalogAvailability(catalog);
  const researchSlugs: string[] = [];
  let catalogRecordCount = 0;

  for (const entry of presetSelection(preset)) {
    const record =
      entry.kind === 'system'
        ? catalog.systems.find((system) => system.slug === entry.slug)
        : catalog.components.find((component) => component.slug === entry.slug);
    if (record === undefined) {
      throw new Error(`Comparison preset names missing ${entry.kind} "${entry.slug}".`);
    }

    const recordAvailability =
      entry.kind === 'system'
        ? availability.systems.get(record.id)?.availability
        : availability.components.get(record.id)?.availability;
    if (recordAvailability === undefined) {
      throw new Error(
        `Comparison preset names ${entry.kind} "${entry.slug}" without availability.`,
      );
    }
    if (recordAvailability === 'research') {
      researchSlugs.push(entry.slug);
    } else {
      catalogRecordCount += 1;
    }
  }

  return {
    availability: researchSlugs.length === 0 ? 'catalog' : 'research',
    catalogRecordCount,
    researchRecordCount: researchSlugs.length,
    researchSlugs,
  };
}

/**
 * Builds a preset's comparison, refusing to render one that does not resolve.
 *
 * `id` is only used to name the offending file in the error, which is the one
 * piece of information a build failure here actually needs to convey.
 */
export function presetComparison(
  preset: PresetData,
  id: string,
  catalog: Catalog = getCatalog(),
): Comparison {
  const comparison = buildComparison(catalog, presetSelection(preset));
  if (comparison.problems.length > 0) {
    const problems = comparison.problems.map((problem) => JSON.stringify(problem)).join(', ');
    throw new Error(
      `Comparison preset "${id}" does not resolve against the catalog: ${problems}. ` +
        'Fix the record list in src/content/presets, or the preset that promotes a renamed record.',
    );
  }
  return comparison;
}

/**
 * Promoted presets are catalog discovery. A research example can remain public
 * on Compare, but it must not become a homepage recommendation.
 */
export function assertPromotedPreset(
  preset: PresetData,
  id: string,
  catalog: Catalog = getCatalog(),
): Comparison {
  const comparison = presetComparison(preset, id, catalog);
  if (!preset.promoted) {
    return comparison;
  }

  if (presetAvailability(preset, catalog).availability === 'research') {
    throw new Error(`Promoted comparison preset "${id}" includes a research record.`);
  }
  if (comparison.ratioCount === 0) {
    throw new Error(`Promoted comparison preset "${id}" has no valid multiplier.`);
  }
  const reducedEvidence = comparison.sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.figures.filter((figure) => {
            const level = figure.measurement.evidenceLevel;
            return level === 'reported' || level === 'rumored';
          }),
        ),
      ),
    ),
  );
  if (reducedEvidence.length > 0) {
    throw new Error(`Promoted comparison preset "${id}" includes reported or rumored figures.`);
  }
  return comparison;
}
