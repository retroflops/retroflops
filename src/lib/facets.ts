// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Facets for the Explore filters.
 *
 * Computed on the server so the cards and the filter options come from one
 * pass over the catalog and cannot disagree about what exists. The island
 * receives the option lists as props and matches them against data attributes
 * already in the markup, so the filter never fetches anything: the list it
 * filters is the list the reader can already see without JavaScript.
 */

import { getCatalog, getCatalogAvailability } from './catalog.ts';
import { humaniseIdentifier, instructionSetLabel } from './display.ts';
import {
  FACET_GROUP_IDS,
  type EntryFacets,
  type FacetGroup,
  type FacetGroupId,
  type FacetOption,
} from './facet-groups.ts';

export type { EntryFacets, FacetGroup, FacetGroupId, FacetOption };
export { FACET_GROUP_IDS };

/**
 * The `kind` facet holds system types and component kinds together, and most of
 * them read correctly through `humaniseIdentifier`. These are the ones that do
 * not: three component kinds whose identifier is an abbreviation, and the phone,
 * where "Smartphone" is the word a reader filters by rather than the type name.
 */
const KIND_LABELS: Record<string, string> = {
  cpu: 'Processor',
  gpu: 'Graphics',
  memory: 'Memory',
  smartphone: 'Smartphone',
};

/**
 * `manufacturer` is a display string, and using it directly as an identity key
 * does not work: the catalog contains `Rambus (interface)`,
 * `Sony Computer Entertainment (system)` and `Silicon Graphics, Inc.`, none of
 * which is a different firm from the name it qualifies.
 *
 * So the facet normalizes. A joint credit splits on the slash, a parenthetical
 * role is dropped, it says what the firm contributed, not who it is, and a
 * trailing legal suffix goes with it. The record itself keeps the full string,
 * because the qualifier is worth reading on the profile page; it just is not
 * what a reader means when they filter by manufacturer.
 *
 * Names that differ before the suffix stay distinct: Commodore Business
 * Machines and Commodore-Amiga were different companies and the filter should
 * not merge them.
 */
function splitMakers(manufacturer: string): readonly string[] {
  return manufacturer
    .split('/')
    .map((part) =>
      part
        .replaceAll(/\([^)]*\)/g, '')
        .replace(/,?\s+(?:Inc|Ltd|LLC|GmbH|Corporation|Corp)\.?$/i, '')
        .trim(),
    )
    .filter((part) => part !== '');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function decade(date: string | undefined): readonly string[] {
  if (date === undefined) {
    return [];
  }
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? [`${Math.floor(year / 10) * 10}s`] : [];
}

const byLabel = (a: FacetOption, b: FacetOption): number => a.label.localeCompare(b.label);
const byValue = (a: FacetOption, b: FacetOption): number => a.value.localeCompare(b.value);

export interface FacetedCatalog {
  /** Facets per record, keyed by `${kind}:${id}`. */
  readonly byRecord: ReadonlyMap<string, EntryFacets>;
  readonly groups: readonly FacetGroup[];
}

export function buildFacets(scope: 'catalog' | 'all' = 'catalog'): FacetedCatalog {
  const catalog = getCatalog();
  const availability = getCatalogAvailability();
  const byRecord = new Map<string, EntryFacets>();

  /**
   * A record counts as needing review when it is provisional itself or when any
   * figure attached to it is. A reader filtering for "fully sourced" wants the
   * record's weakest figure to decide, not its front matter.
   */
  const provisionalSubjects = new Set(
    catalog.measurements
      .filter((measurement) => measurement.editorialStatus === 'provisional')
      .map((measurement) => `${measurement.subject.kind}:${measurement.subject.id}`),
  );

  const makerLabels = new Map<string, string>();
  const addMakers = (manufacturer: string): readonly string[] =>
    splitMakers(manufacturer).map((name) => {
      const value = slug(name);
      makerLabels.set(value, name);
      return value;
    });

  for (const system of catalog.systems) {
    if (scope === 'catalog' && availability.systems.get(system.id)?.availability !== 'catalog') {
      continue;
    }
    const provisional =
      system.editorialStatus === 'provisional' || provisionalSubjects.has(`system:${system.id}`);
    byRecord.set(`system:${system.id}`, {
      kind: [system.type],
      era: decade(system.releaseDate),
      maker: addMakers(system.manufacturer),
      isa: [],
      status: [provisional ? 'provisional' : 'approved'],
    });
  }

  for (const component of catalog.components) {
    if (
      scope === 'catalog' &&
      availability.components.get(component.id)?.availability !== 'catalog'
    ) {
      continue;
    }
    const provisional =
      component.editorialStatus === 'provisional' ||
      provisionalSubjects.has(`component:${component.id}`);
    byRecord.set(`component:${component.id}`, {
      kind: [component.kind],
      era: decade(component.introducedDate),
      maker: addMakers(component.manufacturer),
      isa:
        component.kind === 'cpu' && component.instructionSetFamily !== undefined
          ? [component.instructionSetFamily]
          : [],
      status: [provisional ? 'provisional' : 'approved'],
    });
  }

  const counts = new Map<string, number>();
  for (const facets of byRecord.values()) {
    for (const group of FACET_GROUP_IDS) {
      for (const value of facets[group]) {
        const key = `${group}:${value}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const optionsFor = (
    group: FacetGroupId,
    label: (value: string) => string,
    order: (a: FacetOption, b: FacetOption) => number,
  ): readonly FacetOption[] =>
    [...counts.entries()]
      .filter(([key]) => key.startsWith(`${group}:`))
      .map(([key, count]) => {
        const value = key.slice(group.length + 1);
        return { value, label: label(value), count };
      })
      .toSorted(order);

  const groups: readonly FacetGroup[] = [
    {
      id: 'kind',
      label: 'Kind',
      options: optionsFor(
        'kind',
        (value) => KIND_LABELS[value] ?? humaniseIdentifier(value),
        byLabel,
      ),
    },
    {
      id: 'era',
      label: 'Decade',
      note: 'By release for systems, by introduction for components.',
      options: optionsFor('era', (value) => value, byValue),
    },
    {
      id: 'maker',
      label: 'Manufacturer',
      note: 'A record made by two firms matches both.',
      options: optionsFor('maker', (value) => makerLabels.get(value) ?? value, byLabel),
    },
    {
      id: 'isa',
      label: 'Instruction set',
      note: 'Processors only, and only those belonging to a lineage. The Apollo and Saturn machines belong to none.',
      options: optionsFor('isa', instructionSetLabel, byLabel),
    },
    {
      id: 'status',
      label: 'Verification',
      note: 'A record counts as provisional when it, or any figure on it, is.',
      options: optionsFor('status', (value) => humaniseIdentifier(value), byValue),
    },
  ];

  return { byRecord, groups };
}

/** Serializes a record's facets into the `data-facet-*` attributes the island reads. */
export function facetAttributes(facets: EntryFacets | undefined): Record<string, string> {
  if (facets === undefined) {
    return {};
  }
  const attributes: Record<string, string> = {};
  for (const group of FACET_GROUP_IDS) {
    attributes[`data-facet-${group}`] = facets[group].join(' ');
  }
  return attributes;
}
