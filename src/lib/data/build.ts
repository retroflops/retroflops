// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Public export generation.
 *
 * Pure: takes a validated dataset and returns the exact bytes of every public
 * artifact. The calling script does the writing, and the determinism test calls
 * this twice to compare hashes.
 *
 * Artifacts carry no timestamp and no build id. A "generated at" field would
 * make every build differ from the last, which would destroy the guarantee that
 * identical inputs produce identical outputs. That lets a data
 * change be reviewed as a diff.
 */

import {
  catalogAvailability,
  componentAvailability,
  systemAvailability,
} from '../catalog-availability.ts';
import { COMPARABILITY_RULES_VERSION } from './comparability.ts';
import { containsMarker, resolveExportProse } from './editorial-text.ts';
import { FORMULA_REGISTRY_VERSION } from './formulas.ts';
import { IMAGE_RIGHTS_REGISTRY_VERSION } from './image-rights.ts';
import { METHOD_REGISTRY_VERSION } from './methods.ts';
import { METRIC_REGISTRY_VERSION } from './metrics.ts';
import { CATALOG_SCHEMA_VERSION } from './schema.ts';
import type { System } from './schema.ts';
import { UNIT_REGISTRY_VERSION } from './units.ts';
import type { ParsedDataset } from './validate.ts';

export interface Artifact {
  /** Path relative to the site's public directory. */
  readonly path: string;
  readonly content: string;
}

const REGISTRIES = {
  units: UNIT_REGISTRY_VERSION,
  metrics: METRIC_REGISTRY_VERSION,
  methods: METHOD_REGISTRY_VERSION,
  comparability: COMPARABILITY_RULES_VERSION,
  formulas: FORMULA_REGISTRY_VERSION,
  imageRights: IMAGE_RIGHTS_REGISTRY_VERSION,
} as const;

export function buildArtifacts(dataset: ParsedDataset): readonly Artifact[] {
  return [
    { path: 'data/catalog-v1.json', content: buildCatalog(dataset) },
    { path: 'data/catalog-summary-v1.json', content: buildSummary(dataset) },
    { path: 'data/measurements-v1.csv', content: buildMeasurementsCsv(dataset) },
  ];
}

/* -------------------------------------------------------------------------- */
/* JSON exports                                                                */
/* -------------------------------------------------------------------------- */

function buildCatalog(dataset: ParsedDataset): string {
  const catalog = resolveExportProse(
    {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      registries: REGISTRIES,
      systems: sortById(dataset.systems),
      components: sortById(dataset.components),
      images: sortById(dataset.images),
      measurements: sortById(dataset.measurements),
      contextClaims: sortById(dataset.contextClaims),
      sources: sortById(dataset.sources),
      derivedClaims: sortById(dataset.derivedClaims),
      conflicts: sortById(dataset.conflicts),
    },
    dataset,
  );
  const content = canonicalJson(catalog);
  if (containsMarker(content)) {
    throw new Error('catalog-v1 export contains an unresolved editorial marker');
  }
  return content;
}

/**
 * A light index for client-side selectors and filters. Deliberately excludes
 * every figure: the filter UI needs names and facets, not values, and shipping
 * values here would duplicate the full catalog on every page.
 */
function buildSummary(dataset: ParsedDataset): string {
  const metricsBySubject = new Map<string, Set<string>>();
  const groupsBySubject = new Map<string, Set<string>>();
  for (const measurement of dataset.measurements) {
    const key = `${measurement.subject.kind}:${measurement.subject.id}`;
    const metrics = metricsBySubject.get(key) ?? new Set<string>();
    metrics.add(measurement.metric);
    metricsBySubject.set(key, metrics);
    if (measurement.quantity.state === 'value') {
      const groups = groupsBySubject.get(key) ?? new Set<string>();
      groups.add(measurement.comparabilityGroup);
      groupsBySubject.set(key, groups);
    }
  }

  const availability = catalogAvailability(dataset);

  /**
   * A machine answers with its parts' figures as well as its own, which is what
   * a comparison of machines shows, so the groups listed for a system
   * include those of every component fitted to any of its variants. Without
   * that, a summary would say the Commodore 64 states nothing about memory,
   * because the capacity is recorded against its RAM.
   */
  const systemGroups = (system: System): readonly string[] => {
    const groups = new Set(groupsBySubject.get(`system:${system.id}`) ?? []);
    for (const configuration of system.configurations) {
      for (const entry of configuration.entries) {
        for (const group of groupsBySubject.get(`component:${entry.componentId}`) ?? []) {
          groups.add(group);
        }
      }
    }
    return [...groups].toSorted();
  };

  const systems = sortById(dataset.systems).map((system) => {
    const state = systemAvailability(availability, system);
    return {
      id: system.id,
      slug: system.slug,
      name: system.name,
      manufacturer: system.manufacturer,
      type: system.type,
      releaseDate: system.releaseDate,
      editorialStatus: system.editorialStatus,
      availability: state.availability,
      valueCount: state.counts.valueCount,
      approvedValueCount: state.counts.approvedValueCount,
      provisionalValueCount: state.counts.provisionalValueCount,
      unknownCount: state.counts.unknownCount,
      notApplicableCount: state.counts.notApplicableCount,
      unverifiedCount: state.counts.unverifiedCount,
      metrics: [...(metricsBySubject.get(`system:${system.id}`) ?? [])].toSorted(),
      comparabilityGroups: systemGroups(system),
    };
  });

  const components = sortById(dataset.components).map((component) => {
    const state = componentAvailability(availability, component);
    return {
      id: component.id,
      slug: component.slug,
      kind: component.kind,
      name: component.name,
      manufacturer: component.manufacturer,
      architecture: component.architecture,
      editorialStatus: component.editorialStatus,
      availability: state.availability,
      valueCount: state.counts.valueCount,
      approvedValueCount: state.counts.approvedValueCount,
      provisionalValueCount: state.counts.provisionalValueCount,
      unknownCount: state.counts.unknownCount,
      notApplicableCount: state.counts.notApplicableCount,
      unverifiedCount: state.counts.unverifiedCount,
      metrics: [...(metricsBySubject.get(`component:${component.id}`) ?? [])].toSorted(),
      comparabilityGroups: [...(groupsBySubject.get(`component:${component.id}`) ?? [])].toSorted(),
    };
  });

  return canonicalJson({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    registries: REGISTRIES,
    systems,
    components,
    facets: {
      manufacturers: uniqueSorted([
        ...dataset.systems.map((system) => system.manufacturer),
        ...dataset.components.map((component) => component.manufacturer),
      ]),
      systemTypes: uniqueSorted(dataset.systems.map((system) => system.type)),
      componentKinds: uniqueSorted(dataset.components.map((component) => component.kind)),
      metrics: uniqueSorted(dataset.measurements.map((measurement) => measurement.metric)),
      comparabilityGroups: uniqueSorted(
        dataset.measurements
          .filter((measurement) => measurement.quantity.state === 'value')
          .map((measurement) => measurement.comparabilityGroup),
      ),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                  */
/* -------------------------------------------------------------------------- */

const CSV_COLUMNS = [
  'measurement_id',
  'subject_kind',
  'subject_id',
  'configuration_id',
  'metric',
  'scope',
  'method',
  'provenance',
  'evidence_stage',
  'benchmark_id',
  'benchmark_version',
  'benchmark_variant',
  'comparability_group',
  'value_state',
  'value',
  'unit',
  'significant_digits',
  'normalized_value',
  'normalized_unit',
  'rounding',
  'status',
  'editorial_status',
  'conditions',
  'caveat',
  'source_ids',
  'extract_ids',
] as const;

function buildMeasurementsCsv(dataset: ParsedDataset): string {
  const resolve = (text: string | undefined): string =>
    text === undefined ? '' : resolveExportProse(text, dataset);
  const rows = sortById(dataset.measurements).map((measurement) => {
    const stated = measurement.quantity.state === 'value' ? measurement.quantity : undefined;
    return [
      measurement.id,
      measurement.subject.kind,
      measurement.subject.id,
      measurement.subject.configurationId ?? '',
      measurement.metric,
      measurement.scope,
      measurement.method,
      measurement.provenance,
      measurement.evidenceStage,
      measurement.benchmark?.id ?? '',
      measurement.benchmark?.version ?? '',
      measurement.benchmark?.variant ?? '',
      measurement.comparabilityGroup,
      measurement.quantity.state,
      stated?.value ?? '',
      stated?.unit ?? '',
      stated === undefined ? '' : String(stated.significantDigits),
      measurement.normalized?.value ?? '',
      measurement.normalized?.unit ?? '',
      measurement.rounding,
      measurement.status,
      measurement.editorialStatus,
      resolve(measurement.conditions),
      resolve(measurement.caveat),
      // Sorted so a reordered source list is not a spurious diff.
      measurement.sourceIds.toSorted().join(' '),
      (measurement.extractIds ?? []).toSorted().join(' '),
    ];
  });

  // CRLF is what RFC 4180 specifies, and it survives spreadsheet round-trips.
  const content =
    [CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
  if (containsMarker(content)) {
    throw new Error('measurements-v1 export contains an unresolved editorial marker');
  }
  return content;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/* -------------------------------------------------------------------------- */

function sortById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return records.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].toSorted();
}

/** Sorted keys and a trailing newline, so output never depends on insertion order. */
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, sortKeysDeep(entry)]),
  );
}
