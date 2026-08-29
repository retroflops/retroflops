// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Build-time access to the published catalog.
 *
 * Pages read `public/data/catalog-v1.json`, the artifact `data:build` writes,
 * rather than the canonical records under `data/`. That is deliberate: it makes
 * it impossible for the site to show a figure the public export does not
 * contain, and it means the export is exercised by every page render instead of
 * only by its own tests.
 *
 * `pnpm build` runs `data:build` first, so the file is always present. It is
 * imported rather than read from disk because the import is resolved against
 * this source file, which survives bundling, `import.meta.url` does not, and
 * neither does an assumption about the working directory.
 *
 * Nothing here reaches the browser. Pages consume it in frontmatter, which runs
 * only at build time in a static output.
 */

import catalogJson from '../../public/data/catalog-v1.json';
import {
  catalogAvailability,
  componentAvailability,
  systemAvailability,
  type CatalogAvailability,
  type ComponentAvailability,
  type SystemAvailability,
} from './catalog-availability.ts';
import {
  catalogSchema,
  CATALOG_SCHEMA_VERSION,
  type Catalog,
  type Component,
  type Conflict,
  type ContextClaim,
  type DerivedClaim,
  type Measurement,
  type Source,
  type System,
} from './data/schema.ts';
import { sortMeasurements } from './presentation-order.ts';

function readCatalog(): Catalog {
  const parsed = catalogSchema.safeParse(catalogJson);
  if (!parsed.success) {
    throw new Error(
      `public/data/catalog-v1.json does not match the ${CATALOG_SCHEMA_VERSION} schema. ` +
        `Re-run "pnpm data:build". ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

let cached: Catalog | undefined;
let cachedAvailability: CatalogAvailability | undefined;

/** The published catalog, parsed once per build. */
export function getCatalog(): Catalog {
  cached ??= readCatalog();
  return cached;
}

/** Reader-facing availability, derived from the same measurements profiles render. */
export function getCatalogAvailability(): CatalogAvailability {
  cachedAvailability ??= catalogAvailability(getCatalog());
  return cachedAvailability;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function getSystems(): readonly System[] {
  return getCatalog().systems;
}

export function getSystemAvailability(system: System): SystemAvailability {
  return systemAvailability(getCatalogAvailability(), system);
}

export function getComponents(): readonly Component[] {
  return getCatalog().components;
}

export function getComponentAvailability(component: Component): ComponentAvailability {
  return componentAvailability(getCatalogAvailability(), component);
}

export function getComponentById(id: string): Component | undefined {
  return getComponents().find((component) => component.id === id);
}

export function getSourcesByIds(ids: readonly string[]): readonly Source[] {
  const sources = getCatalog().sources;
  return ids
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is Source => source !== undefined);
}

/* -------------------------------------------------------------------------- */
/* Derived views                                                               */
/* -------------------------------------------------------------------------- */

/** Every measurement whose subject is this record, in reader-oriented display order. */
export function getMeasurementsFor(
  kind: 'system' | 'component',
  id: string,
): readonly Measurement[] {
  return sortMeasurements(
    getCatalog().measurements.filter(
      (measurement) => measurement.subject.kind === kind && measurement.subject.id === id,
    ),
  );
}

/** Component ids referenced by any configuration of a system, in first-seen order. */
export function getComponentIdsUsedBy(system: System): readonly string[] {
  const seen: string[] = [];
  for (const configuration of system.configurations) {
    for (const entry of configuration.entries) {
      if (!seen.includes(entry.componentId)) {
        seen.push(entry.componentId);
      }
    }
  }
  return seen;
}

/** Systems whose configurations fit a given component. */
export function getSystemsUsing(componentId: string): readonly System[] {
  return getSystems().filter((system) => getComponentIdsUsedBy(system).includes(componentId));
}

/**
 * Derived claims computed from any of the given measurements.
 *
 * A claim is shown on a record when that record supplied an input, whether the
 * record is the numerator or the denominator: both sides need to be able to
 * lead a reader to the comparison.
 */
export function getDerivedClaimsUsing(measurementIds: readonly string[]): readonly DerivedClaim[] {
  return getCatalog().derivedClaims.filter((claim) =>
    claim.inputMeasurementIds.some((id) => measurementIds.includes(id)),
  );
}

export function getConflictsFor(kind: 'system' | 'component', id: string): readonly Conflict[] {
  return getCatalog().conflicts.filter(
    (conflict) => conflict.subject.kind === kind && conflict.subject.id === id,
  );
}

export function getMeasurementById(id: string): Measurement | undefined {
  return getCatalog().measurements.find((measurement) => measurement.id === id);
}

export function getContextClaimsFor(
  kind: 'system' | 'component',
  id: string,
): readonly ContextClaim[] {
  return getCatalog().contextClaims.filter(
    (claim) => claim.subject.kind === kind && claim.subject.id === id,
  );
}
