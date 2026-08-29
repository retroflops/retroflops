// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { normalizeQuantity } from './normalize.ts';
import {
  configurationEntrySchema,
  contextClaimSchema,
  imageAssetSchema,
  measurementSchema,
  quantitySchema,
  sourceSchema,
  systemSchema,
} from './schema.ts';

const statedQuantity = {
  state: 'value',
  value: '0.985248',
  unit: 'MHz',
  significantDigits: 6,
} as const;

const baseMeasurement = {
  id: 'commodore-64:cpu:clock',
  subject: { kind: 'system', id: 'commodore-64' },
  metric: 'clock-frequency',
  quantity: statedQuantity,
  normalized: normalizeQuantity(statedQuantity),
  scope: 'cpu',
  method: 'nominal-clock',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'clock-frequency|cpu|nominal-clock',
  status: 'vendor-rated',
  evidenceLevel: 'confirmed',
  editorialStatus: 'approved',
  sourceIds: ['mos-6510-datasheet'],
};

describe('quantitySchema', () => {
  it('accepts a stated value and both absence states', () => {
    expect(quantitySchema.safeParse(statedQuantity).success).toBe(true);
    expect(quantitySchema.safeParse({ state: 'unknown' }).success).toBe(true);
    expect(
      quantitySchema.safeParse({ state: 'not-applicable', note: 'no floating-point hardware' })
        .success,
    ).toBe(true);
  });

  it('rejects a value that is not an exact decimal literal', () => {
    for (const value of [1.5, '1,5', 'unknown', '']) {
      expect(quantitySchema.safeParse({ ...statedQuantity, value }).success).toBe(false);
    }
  });

  it('rejects a unit outside the registry', () => {
    expect(quantitySchema.safeParse({ ...statedQuantity, unit: 'furlong' }).success).toBe(false);
  });
});

describe('measurementSchema', () => {
  it('accepts a well-formed measurement', () => {
    expect(measurementSchema.safeParse(baseMeasurement).success).toBe(true);
  });

  it('rejects a comparability group that drifted from its facets', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      comparabilityGroup: 'clock-frequency|gpu|nominal-clock',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['comparabilityGroup']);
  });

  it('rejects a stale or hand-edited normalized value', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      normalized: { ...baseMeasurement.normalized, value: '985000' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['normalized']);
  });

  it('rejects a normalized value left behind after a unit-registry change', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      normalized: { ...baseMeasurement.normalized, unitRegistry: 'units-v0' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a measurement with no normalized twin yet', () => {
    const { normalized: _normalized, ...withoutNormalized } = baseMeasurement;
    expect(measurementSchema.safeParse(withoutNormalized).success).toBe(true);
  });

  it('refuses a method outside the registry', () => {
    expect(
      measurementSchema.safeParse({ ...baseMeasurement, method: 'design-specification' }).success,
    ).toBe(false);
  });

  it('refuses an approved figure that was only ever announced', () => {
    // The protection that used to come from a comparability group of its own:
    // a pre-launch figure stays provisional, and provisional blocks every
    // automatic multiplier.
    const announced = {
      ...baseMeasurement,
      evidenceStage: 'pre-launch',
      editorialStatus: 'approved',
    };
    const result = measurementSchema.safeParse(announced);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['editorialStatus']);
    expect(
      measurementSchema.safeParse({ ...announced, editorialStatus: 'provisional' }).success,
    ).toBe(true);
  });

  it('requires at least one source', () => {
    expect(measurementSchema.safeParse({ ...baseMeasurement, sourceIds: [] }).success).toBe(false);
  });

  it('accepts an absent figure, which carries no normalized twin', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      quantity: { state: 'not-applicable', note: 'no floating-point hardware' },
      normalized: undefined,
      evidenceLevel: undefined,
    });
    expect(result.success).toBe(true);
  });

  it('requires an audit route beyond vendor documentation for an unknown', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      quantity: { state: 'unknown' },
      normalized: undefined,
      unknownAudit: {
        reviewedOn: '2026-08-25',
        routesChecked: ['vendor-documentation'],
        outcome: 'no-published-candidate',
        summary: 'The vendor manual does not state a clock.',
      },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['unknownAudit', 'routesChecked']);
  });

  // The group is derived from metric, scope, method and benchmark, none of which
  // depend on there being a value, so an absent figure is still checked.
  it('rejects a drifted comparability group even when the figure is absent', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      quantity: { state: 'unknown' },
      normalized: undefined,
      comparabilityGroup: 'clock-frequency|gpu|nominal-clock',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['comparabilityGroup']);
  });

  it('accepts a measurement naming the research records it was read from', () => {
    const result = measurementSchema.safeParse({
      ...baseMeasurement,
      extractIds: ['mos-6510-datasheet:page-3'],
    });
    expect(result.success).toBe(true);
  });
});

describe('catalog-v1 numerical ownership', () => {
  const configurationEntry = {
    componentId: 'mos-6510',
    role: 'main-cpu',
    count: 1,
    measurementIds: ['commodore-64:cpu:clock'],
    shared: false,
  } as const;

  it('rejects the removed configuration value fields', () => {
    for (const field of ['clock', 'capacity', 'busWidth'] as const) {
      expect(
        configurationEntrySchema.safeParse({
          ...configurationEntry,
          [field]: statedQuantity,
        }).success,
      ).toBe(false);
    }
  });

  it('requires a stated value, status and sources on a context claim', () => {
    const claim = {
      id: 'mos-6510:core-count',
      subject: { kind: 'component', id: 'mos-6510' },
      label: 'Core count',
      quantity: { state: 'value', value: '1', unit: 'unit', significantDigits: 1 },
      provenance: 'vendor',
      evidenceStage: 'shipped',
      status: 'vendor-rated',
      evidenceLevel: 'confirmed',
      editorialStatus: 'approved',
      sourceIds: ['mos-6510-datasheet'],
    } as const;
    expect(contextClaimSchema.safeParse(claim).success).toBe(true);
    expect(contextClaimSchema.safeParse({ ...claim, quantity: { state: 'unknown' } }).success).toBe(
      false,
    );
    expect(contextClaimSchema.safeParse({ ...claim, sourceIds: [] }).success).toBe(false);
    const { status: _status, ...withoutStatus } = claim;
    expect(contextClaimSchema.safeParse(withoutStatus).success).toBe(false);
  });
});

describe('sourceSchema', () => {
  const source = {
    id: 'mos-6510-datasheet',
    title: 'MOS 6510 microprocessor data sheet',
    publisher: 'MOS Technology',
    accessedDate: '2026-07-28',
    locator: 'page 3, table 1',
    tier: 'A',
    sourceType: 'vendor-documentation',
  };

  it('accepts a tier A manufacturer document with a locator', () => {
    expect(sourceSchema.safeParse(source).success).toBe(true);
  });

  it('requires a non-empty locator, so a figure can always be found again', () => {
    expect(sourceSchema.safeParse({ ...source, locator: '' }).success).toBe(false);
    const { locator: _locator, ...withoutLocator } = source;
    expect(sourceSchema.safeParse(withoutLocator).success).toBe(false);
  });

  it('rejects a malformed access date or extract hash', () => {
    expect(sourceSchema.safeParse({ ...source, accessedDate: '28-07-2026' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...source, extractHash: 'not-a-digest' }).success).toBe(false);
  });

  it('requires an archive copy when an original URL is known unavailable', () => {
    expect(
      sourceSchema.safeParse({
        ...source,
        url: 'https://publisher.example/article',
        urlStatus: 'known-unavailable',
      }).success,
    ).toBe(false);
    expect(
      sourceSchema.safeParse({
        ...source,
        url: 'https://publisher.example/article',
        urlStatus: 'known-unavailable',
        archiveUrl: 'https://archive.example/article',
      }).success,
    ).toBe(true);
  });
});

describe('systemSchema image references', () => {
  const system = {
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
        entries: [{ componentId: 'mos-6510', role: 'main-cpu', count: 1 }],
      },
    ],
    sourceIds: ['c64-programmers-reference-guide'],
    editorialStatus: 'approved',
  };

  it('accepts a system with no photographs at all', () => {
    const result = systemSchema.safeParse(system);
    expect(result.success).toBe(true);
    expect(result.data?.imageIds).toBeUndefined();
  });

  it('keeps several references in the order they were written', () => {
    const imageIds = ['c64-front', 'c64-ports', 'c64-board'];
    const result = systemSchema.safeParse({ ...system, imageIds });
    expect(result.success).toBe(true);
    // The order is editorial: the first is the lead image every profile renders,
    // and the rest are the gallery a later increment will show in this sequence.
    expect(result.data?.imageIds).toEqual(imageIds);
    expect(result.data?.imageIds?.[0]).toBe('c64-front');
  });

  it('rejects an empty list, which says nothing a missing field does not', () => {
    expect(systemSchema.safeParse({ ...system, imageIds: [] }).success).toBe(false);
  });
});

describe('imageAssetSchema', () => {
  const image = {
    id: 'c64-front',
    alt: 'A Commodore 64 photographed from the front.',
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

  it('accepts a fully provenanced record', () => {
    expect(imageAssetSchema.safeParse(image).success).toBe(true);
  });

  it('rejects terms outside the registry, NC and ND among them', () => {
    for (const id of ['cc-by-nc-4.0', 'cc-by-nd-4.0', 'all-rights-reserved']) {
      expect(
        imageAssetSchema.safeParse({ ...image, rights: { ...image.rights, id } }).success,
      ).toBe(false);
    }
  });

  it('accepts a public domain release as readily as a license', () => {
    for (const id of ['pd-self', 'pd-us-government', 'cc0-1.0', 'public-domain-mark-1.0']) {
      expect(
        imageAssetSchema.safeParse({ ...image, rights: { ...image.rights, id } }).success,
      ).toBe(true);
    }
  });

  it('rejects a stored file in any format or size but the preset', () => {
    expect(
      imageAssetSchema.safeParse({ ...image, canonical: { ...image.canonical, format: 'webp' } })
        .success,
    ).toBe(false);
    expect(
      imageAssetSchema.safeParse({ ...image, canonical: { ...image.canonical, width: 1600 } })
        .success,
    ).toBe(false);
  });

  it('requires the recipe to say why, not only what', () => {
    const { note: _note, ...withoutNote } = image.transform;
    expect(imageAssetSchema.safeParse({ ...image, transform: withoutNote }).success).toBe(false);
  });
});
