// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Reader-facing availability is derived from the published data, never entered
 * in canonical YAML. A catalog record contributes at least one numeric value;
 * a research record keeps its source trail but has none yet.
 */
import type { Component, Measurement, System } from './data/schema.ts';

interface CatalogRecords {
  readonly systems: readonly System[];
  readonly components: readonly Component[];
  readonly measurements: readonly Measurement[];
}

export type RecordAvailability = 'catalog' | 'research';

export interface RecordCounts {
  readonly valueCount: number;
  readonly approvedValueCount: number;
  readonly provisionalValueCount: number;
  readonly unknownCount: number;
  readonly notApplicableCount: number;
  /** Figures whose cited source nobody here has read yet. */
  readonly unverifiedCount: number;
}

export interface SystemAvailability {
  readonly availability: RecordAvailability;
  readonly counts: RecordCounts;
  /** All fitted parts across every configuration, deduplicated by record id. */
  readonly componentIds: readonly string[];
}

export interface ComponentAvailability {
  readonly availability: RecordAvailability;
  readonly counts: RecordCounts;
  /** Catalog systems that make this otherwise figureless part useful to browse. */
  readonly catalogSystemIds: readonly string[];
}

export interface CatalogAvailability {
  readonly systems: ReadonlyMap<string, SystemAvailability>;
  readonly components: ReadonlyMap<string, ComponentAvailability>;
}

function countsFor(measurements: readonly Measurement[]): RecordCounts {
  let valueCount = 0;
  let approvedValueCount = 0;
  let provisionalValueCount = 0;
  let unknownCount = 0;
  let notApplicableCount = 0;
  let unverifiedCount = 0;

  for (const measurement of measurements) {
    if (measurement.quantity.state === 'value') {
      valueCount += 1;
      if (measurement.editorialStatus === 'approved') {
        approvedValueCount += 1;
      } else {
        provisionalValueCount += 1;
      }
    } else if (measurement.quantity.state === 'unknown') {
      unknownCount += 1;
    } else if (measurement.quantity.state === 'unverified') {
      unverifiedCount += 1;
    } else {
      notApplicableCount += 1;
    }
  }

  return {
    valueCount,
    approvedValueCount,
    provisionalValueCount,
    unknownCount,
    notApplicableCount,
    unverifiedCount,
  };
}

function componentIdsFor(system: System): readonly string[] {
  return [
    ...new Set(
      system.configurations.flatMap((configuration) =>
        configuration.entries.map((entry) => entry.componentId),
      ),
    ),
  ];
}

function measurementsForSystem(
  catalog: CatalogRecords,
  system: System,
  componentIds: readonly string[],
): readonly Measurement[] {
  const components = new Set(componentIds);
  return catalog.measurements.filter(
    (measurement) =>
      (measurement.subject.kind === 'system' && measurement.subject.id === system.id) ||
      (measurement.subject.kind === 'component' && components.has(measurement.subject.id)),
  );
}

/**
 * Computes the complete public/research split. Systems are classified first,
 * then components inherit catalog availability when a catalog system uses them.
 */
export function catalogAvailability(catalog: CatalogRecords): CatalogAvailability {
  const systems = new Map<string, SystemAvailability>();

  for (const system of catalog.systems) {
    const componentIds = componentIdsFor(system);
    const counts = countsFor(measurementsForSystem(catalog, system, componentIds));
    systems.set(system.id, {
      availability: counts.valueCount > 0 ? 'catalog' : 'research',
      counts,
      componentIds,
    });
  }

  const components = new Map<string, ComponentAvailability>();
  for (const component of catalog.components) {
    const measurements = catalog.measurements.filter(
      (measurement) =>
        measurement.subject.kind === 'component' && measurement.subject.id === component.id,
    );
    const counts = countsFor(measurements);
    const catalogSystemIds = catalog.systems
      .filter(
        (system) =>
          systems.get(system.id)?.availability === 'catalog' &&
          componentIdsFor(system).includes(component.id),
      )
      .map((system) => system.id);
    components.set(component.id, {
      availability: counts.valueCount > 0 || catalogSystemIds.length > 0 ? 'catalog' : 'research',
      counts,
      catalogSystemIds,
    });
  }

  return { systems, components };
}

export function systemAvailability(
  availability: CatalogAvailability,
  system: System,
): SystemAvailability {
  const found = availability.systems.get(system.id);
  if (found === undefined) {
    throw new Error(`Missing availability for system ${system.id}.`);
  }
  return found;
}

export function componentAvailability(
  availability: CatalogAvailability,
  component: Component,
): ComponentAvailability {
  const found = availability.components.get(component.id);
  if (found === undefined) {
    throw new Error(`Missing availability for component ${component.id}.`);
  }
  return found;
}
