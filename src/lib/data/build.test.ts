// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildArtifacts, type Artifact } from './build.ts';
import { COMPARABILITY_RULES_VERSION } from './comparability.ts';
import { FORMULA_REGISTRY_VERSION } from './formulas.ts';
import { IMAGE_RIGHTS_REGISTRY_VERSION } from './image-rights.ts';
import { METHOD_REGISTRY_VERSION } from './methods.ts';
import { METRIC_REGISTRY_VERSION } from './metrics.ts';
import { normalizeQuantity } from './normalize.ts';
import type { Component, ImageAsset, Measurement, Source, System } from './schema.ts';
import { UNIT_REGISTRY_VERSION } from './units.ts';
import type { ParsedDataset } from './validate.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const source: Source = {
  id: 'vendor-datasheet',
  title: 'Vendor data sheet, "revised" edition',
  publisher: 'Vendor',
  accessedDate: '2026-07-28',
  locator: 'page 3, table 1',
  tier: 'A',
  sourceType: 'vendor-documentation',
  editorialStatus: 'approved',
};

const cpu: Component = {
  id: 'mos-6510',
  slug: 'mos-6510',
  kind: 'cpu',
  name: 'MOS 6510',
  manufacturer: 'MOS Technology',
  summary: 'The 6502 derivative used in the Commodore 64.',
  sourceIds: ['vendor-datasheet'],
  editorialStatus: 'approved',
};

const system: System = {
  id: 'commodore-64',
  slug: 'commodore-64',
  name: 'Commodore 64',
  manufacturer: 'Commodore',
  type: 'home-computer',
  releaseDate: '1982-08',
  summary: 'Best-selling home computer.',
  configurations: [
    {
      id: 'pal',
      label: 'PAL',
      entries: [
        {
          componentId: 'mos-6510',
          role: 'main-cpu',
          count: 1,
          measurementIds: ['commodore-64:cpu:clock'],
          shared: false,
        },
      ],
    },
  ],
  sourceIds: ['vendor-datasheet'],
  editorialStatus: 'approved',
};

const clockQuantity = {
  state: 'value',
  value: '0.985248',
  unit: 'MHz',
  significantDigits: 6,
} as const;

const ramQuantity = { state: 'value', value: '64', unit: 'KiB', significantDigits: 2 } as const;

const clock: Measurement = {
  id: 'commodore-64:cpu:clock',
  subject: { kind: 'system', id: 'commodore-64' },
  metric: 'clock-frequency',
  quantity: clockQuantity,
  normalized: normalizeQuantity(clockQuantity),
  scope: 'cpu',
  method: 'nominal-clock',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'clock-frequency|cpu|nominal-clock',
  rounding: 'none',
  status: 'vendor-rated',
  editorialStatus: 'approved',
  sourceIds: ['vendor-datasheet'],
  conditions: 'PAL machines, "985248 Hz" as printed',
};

const ram: Measurement = {
  id: 'commodore-64:memory:capacity',
  subject: { kind: 'system', id: 'commodore-64' },
  metric: 'memory-capacity',
  quantity: ramQuantity,
  normalized: normalizeQuantity(ramQuantity),
  scope: 'memory',
  method: 'design-capacity',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'memory-capacity|memory|design-capacity',
  rounding: 'none',
  status: 'vendor-rated',
  editorialStatus: 'approved',
  sourceIds: ['vendor-datasheet'],
};

const absent: Measurement = {
  id: 'commodore-64:gpu:peak-fp32',
  subject: { kind: 'system', id: 'commodore-64' },
  metric: 'peak-fp32-rate',
  quantity: { state: 'not-applicable', note: 'no floating-point hardware' },
  scope: 'gpu',
  method: 'theoretical-peak',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'peak-fp32-rate|gpu|theoretical-peak',
  rounding: 'none',
  status: 'theoretical',
  editorialStatus: 'approved',
  sourceIds: ['vendor-datasheet'],
};

const photo: ImageAsset = {
  id: 'commodore-64-photo',
  alt: 'A Commodore 64 on a white background.',
  caption: 'A Commodore 64.',
  creator: 'A Photographer',
  creatorType: 'person',
  title: 'Commodore 64',
  publisher: 'Wikimedia Commons',
  sourcePageUrl: 'https://example.invalid/wiki/File:C64.jpg',
  originalUrl: 'https://example.invalid/files/C64.jpg',
  accessedDate: '2026-08-16',
  attribution: 'Photograph by A Photographer, CC BY-SA 4.0.',
  rights: {
    id: 'cc-by-sa-4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    statement: 'This file is licensed under the Creative Commons Attribution-Share Alike 4.0.',
    statedAt: 'https://example.invalid/wiki/File:C64.jpg',
  },
  original: {
    sha256: 'b'.repeat(64),
    byteLength: 3_000_000,
    width: 4608,
    height: 3456,
    mediaType: 'image/jpeg',
  },
  canonical: {
    format: 'avif',
    width: 1280,
    height: 960,
    byteLength: 40_000,
    sha256: 'a'.repeat(64),
  },
  transform: {
    preset: 'image-v1',
    sourceWidth: 4608,
    sourceHeight: 3456,
    fit: 'exact',
    note: 'Already 4:3.',
  },
  editorialStatus: 'approved',
};

const dataset: ParsedDataset = {
  systems: [{ ...system, imageIds: [photo.id] }],
  components: [cpu],
  images: [photo],
  measurements: [clock, ram, absent],
  contextClaims: [],
  derivedClaims: [],
  conflicts: [],
  sources: [source],
  extracts: [],
};

function hashes(artifacts: readonly Artifact[]): Record<string, string> {
  return Object.fromEntries(
    artifacts.map((artifact) => [
      artifact.path,
      createHash('sha256').update(artifact.content).digest('hex'),
    ]),
  );
}

function contentAt(artifacts: readonly Artifact[], path: string): string {
  const found = artifacts.find((candidate) => candidate.path === path);
  if (found === undefined) {
    throw new Error(`no artifact at ${path}`);
  }
  return found.content;
}

/** Rebuilds a record with every object's keys in the opposite order. */
function reverseKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeysDeep);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toReversed()
      .map(([key, entry]) => [key, reverseKeysDeep(entry)]),
  );
}

/* -------------------------------------------------------------------------- */

describe('determinism', () => {
  it('produces byte-identical artifacts from identical inputs', () => {
    expect(hashes(buildArtifacts(dataset))).toEqual(hashes(buildArtifacts(dataset)));
  });

  it('does not depend on the order records were read from disk', () => {
    const shuffled: ParsedDataset = {
      ...dataset,
      measurements: [absent, ram, clock],
    };
    expect(hashes(buildArtifacts(shuffled))).toEqual(hashes(buildArtifacts(dataset)));
  });

  it('does not depend on the key order of a record', () => {
    // A hand-edited file can list keys in any order; the export must not notice.
    const other: ParsedDataset = {
      ...dataset,
      measurements: [reverseKeysDeep(clock) as Measurement, ram, absent],
    };
    expect(hashes(buildArtifacts(other))).toEqual(hashes(buildArtifacts(dataset)));
  });

  it('embeds no timestamp or build id', () => {
    const catalog = contentAt(buildArtifacts(dataset), 'data/catalog-v1.json');
    expect(catalog).not.toMatch(/generatedAt|buildId|\d{4}-\d{2}-\d{2}T/);
  });
});

describe('catalog export', () => {
  it('records the schema and every registry version', () => {
    const catalog = JSON.parse(contentAt(buildArtifacts(dataset), 'data/catalog-v1.json')) as {
      schemaVersion: string;
      registries: Record<string, string>;
    };
    expect(catalog.schemaVersion).toBe('catalog-v1');
    // Read from the registries rather than restated, so a deliberate version
    // bump does not fail a test that is about the export carrying them at all.
    expect(catalog.registries).toEqual({
      units: UNIT_REGISTRY_VERSION,
      metrics: METRIC_REGISTRY_VERSION,
      methods: METHOD_REGISTRY_VERSION,
      comparability: COMPARABILITY_RULES_VERSION,
      formulas: FORMULA_REGISTRY_VERSION,
      imageRights: IMAGE_RIGHTS_REGISTRY_VERSION,
    });
    expect(Object.values(catalog.registries).every((version) => version !== '')).toBe(true);
  });

  it('resolves prose markers and exports no removed configuration value fields', () => {
    const withReference: ParsedDataset = {
      ...dataset,
      systems: [
        { ...dataset.systems[0]!, summary: 'Runs at {{measurement:commodore-64:cpu:clock}}.' },
      ],
    };
    const content = contentAt(buildArtifacts(withReference), 'data/catalog-v1.json');
    expect(content).toContain('Runs at 0.985248 MHz.');
    expect(content).not.toContain('{{measurement:');
    expect(content).not.toMatch(/"(?:clock|capacity|busWidth)":/);
    expect(content).toContain('"measurementIds"');
  });
});

describe('image export', () => {
  it('carries the whole image record, provenance and license included', () => {
    const catalog = JSON.parse(contentAt(buildArtifacts(dataset), 'data/catalog-v1.json')) as {
      images: ImageAsset[];
      systems: { imageIds?: string[] }[];
    };
    expect(catalog.images).toHaveLength(1);
    expect(catalog.images[0]?.rights.url).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(catalog.images[0]?.attribution).toContain('A Photographer');
    expect(catalog.images[0]?.canonical.sha256).toBe('a'.repeat(64));
    // The reference travels with the system, so a consumer of the export can
    // reach the photograph without knowing how this repository stores files.
    expect(catalog.systems[0]?.imageIds).toEqual(['commodore-64-photo']);
  });

  it('is ordered by identifier like every other section', () => {
    const second: ImageAsset = { ...photo, id: 'atari-2600-photo' };
    const catalog = JSON.parse(
      contentAt(buildArtifacts({ ...dataset, images: [photo, second] }), 'data/catalog-v1.json'),
    ) as { images: ImageAsset[] };
    expect(catalog.images.map((image) => image.id)).toEqual([
      'atari-2600-photo',
      'commodore-64-photo',
    ]);
  });
});

describe('summary export', () => {
  it('carries names and facets but no figures', () => {
    const summary = contentAt(buildArtifacts(dataset), 'data/catalog-summary-v1.json');
    expect(summary).toContain('Commodore 64');
    expect(summary).toContain('home-computer');
    // The stated and normalized values belong to the full catalog only.
    expect(summary).not.toContain('0.985248');
    expect(summary).not.toContain('985248');
  });

  it('lists which metrics each subject has, for filtering', () => {
    const summary = JSON.parse(
      contentAt(buildArtifacts(dataset), 'data/catalog-summary-v1.json'),
    ) as { systems: { id: string; metrics: string[] }[] };
    expect(summary.systems[0]?.metrics).toEqual([
      'clock-frequency',
      'memory-capacity',
      'peak-fp32-rate',
    ]);
  });

  it('carries availability and counts while omitting unknown-only comparison groups', () => {
    const summary = JSON.parse(
      contentAt(buildArtifacts(dataset), 'data/catalog-summary-v1.json'),
    ) as {
      systems: {
        availability: string;
        valueCount: number;
        unknownCount: number;
        comparabilityGroups: string[];
      }[];
    };

    expect(summary.systems[0]).toMatchObject({
      availability: 'catalog',
      valueCount: 2,
      unknownCount: 0,
    });
    expect(summary.systems[0]?.comparabilityGroups).toEqual([
      'clock-frequency|cpu|nominal-clock',
      'memory-capacity|memory|design-capacity',
    ]);
  });
});

describe('measurements CSV', () => {
  const csv = contentAt(buildArtifacts(dataset), 'data/measurements-v1.csv');
  const lines = csv.split('\r\n').filter((line) => line !== '');

  it('has a header and one row per measurement', () => {
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('measurement_id,subject_kind,subject_id');
  });

  it('quotes fields containing commas and doubles embedded quotes', () => {
    const clockRow = lines.find((line) => line.startsWith('commodore-64:cpu:clock'));
    expect(clockRow).toContain('"PAL machines, ""985248 Hz"" as printed"');
  });

  it('carries the stated and normalized values side by side', () => {
    const ramRow = lines.find((line) => line.startsWith('commodore-64:memory:capacity'));
    expect(ramRow).toContain('64,KiB,2,65536,B');
  });

  it('represents an absent figure as a state, never as zero', () => {
    const absentRow = lines.find((line) => line.startsWith('commodore-64:gpu:peak-fp32'));
    expect(absentRow).toContain('not-applicable');
    expect(absentRow).not.toMatch(/,0,/);
  });
});
