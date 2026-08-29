// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { normalizeQuantity } from './normalize.ts';
import { diffDatasets, isEmptyDiff, renderReport } from './report.ts';
import type { Conflict, DerivedClaim, Measurement, Source } from './schema.ts';
import type { ParsedDataset } from './validate.ts';

const quantity = { state: 'value', value: '1.5', unit: 'MHz', significantDigits: 2 } as const;

const measurement: Measurement = {
  id: 'machine:cpu:clock',
  subject: { kind: 'system', id: 'machine' },
  metric: 'clock-frequency',
  quantity,
  normalized: normalizeQuantity(quantity),
  scope: 'cpu',
  method: 'nominal-clock',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'clock-frequency|cpu|nominal-clock',
  rounding: 'none',
  status: 'vendor-rated',
  editorialStatus: 'approved',
  sourceIds: ['datasheet'],
};

const source: Source = {
  id: 'datasheet',
  title: 'Data sheet',
  publisher: 'Vendor',
  accessedDate: '2026-07-28',
  locator: 'page 3',
  tier: 'A',
  sourceType: 'vendor-documentation',
  editorialStatus: 'approved',
};

const claim: DerivedClaim = {
  id: 'ratio:a-over-b',
  formula: { id: 'ratio', version: '1', expression: 'a ÷ b' },
  inputMeasurementIds: ['machine:cpu:clock', 'other:cpu:clock'],
  result: { state: 'value', value: '2', unit: 'unit', significantDigits: 1 },
  rounding: 'half-up',
  caveat: 'Same group.',
  editorialStatus: 'approved',
};

const conflict: Conflict = {
  id: 'conflict:machine:clock',
  subject: { kind: 'system', id: 'machine' },
  metric: 'clock-frequency',
  candidates: [
    { quantity, sourceIds: ['datasheet'], evidence: 'Data sheet, page 3' },
    {
      quantity: { state: 'value', value: '1.6', unit: 'MHz', significantDigits: 2 },
      sourceIds: ['datasheet'],
      evidence: 'Service manual, page 9',
    },
  ],
  decision: {
    outcome: 'accepted',
    candidateIndex: 0,
    rationale: 'The data sheet is the manufacturer document.',
    decidedOn: '2026-07-28',
  },
};

function dataset(overrides: Partial<ParsedDataset> = {}): ParsedDataset {
  return {
    systems: [],
    components: [],
    images: [],
    measurements: [measurement],
    contextClaims: [],
    derivedClaims: [claim],
    conflicts: [conflict],
    sources: [source],
    extracts: [],
    ...overrides,
  };
}

describe('diffDatasets', () => {
  it('reports nothing when nothing changed', () => {
    const diff = diffDatasets(dataset(), dataset());
    expect(isEmptyDiff(diff)).toBe(true);
    expect(renderReport(diff)).toContain('No changes');
  });

  it('reports an added and a removed measurement', () => {
    const other: Measurement = { ...measurement, id: 'machine:memory:capacity' };
    const diff = diffDatasets(dataset(), dataset({ measurements: [other] }));
    expect(diff.measurements.added).toEqual(['machine:memory:capacity']);
    expect(diff.measurements.removed).toEqual(['machine:cpu:clock']);
  });

  it('reports a changed figure with its normalized twin', () => {
    const next = { state: 'value', value: '2.0', unit: 'MHz', significantDigits: 2 } as const;
    const diff = diffDatasets(
      dataset(),
      dataset({
        measurements: [{ ...measurement, quantity: next, normalized: normalizeQuantity(next) }],
      }),
    );
    const fields = diff.measurements.changed[0]?.changes.map((change) => change.field);
    expect(fields).toContain('value');
    expect(fields).toContain('normalized');
  });

  it('reports a confidence downgrade separately from the value', () => {
    const diff = diffDatasets(
      dataset(),
      dataset({ measurements: [{ ...measurement, status: 'estimated' }] }),
    );
    expect(diff.measurements.changed[0]?.changes).toEqual([
      { field: 'confidence', before: 'vendor-rated', after: 'estimated' },
    ]);
  });

  it('reports a source losing tier or gaining an archive URL', () => {
    const diff = diffDatasets(
      dataset(),
      dataset({
        sources: [{ ...source, tier: 'B', archiveUrl: 'https://web.archive.org/web/1/x' }],
      }),
    );
    const fields = diff.sources.changed[0]?.changes.map((change) => change.field);
    expect(fields).toEqual(['archiveUrl', 'tier']);
  });

  it('reports a derived result that moved', () => {
    const diff = diffDatasets(
      dataset(),
      dataset({
        derivedClaims: [
          { ...claim, result: { state: 'value', value: '3', unit: 'unit', significantDigits: 1 } },
        ],
      }),
    );
    expect(diff.derivedClaims.changed[0]?.changes).toEqual([
      { field: 'result', before: '2 unit', after: '3 unit' },
    ]);
  });

  it('reports a conflict decision being reversed', () => {
    const diff = diffDatasets(
      dataset(),
      dataset({
        conflicts: [
          {
            ...conflict,
            decision: { ...conflict.decision, candidateIndex: 1 } as Conflict['decision'],
          },
        ],
      }),
    );
    expect(diff.conflicts.changed[0]?.changes).toEqual([
      { field: 'chosen', before: '0', after: '1' },
    ]);
  });
});

describe('renderReport', () => {
  it('renders each affected section as Markdown tables', () => {
    const markdown = renderReport(
      diffDatasets(dataset(), dataset({ measurements: [{ ...measurement, status: 'estimated' }] })),
    );
    expect(markdown).toContain('# Data change report');
    expect(markdown).toContain('## Measurements');
    expect(markdown).toContain('| confidence | vendor-rated | estimated |');
    // Untouched sections are left out rather than rendered empty.
    expect(markdown).not.toContain('## Sources');
  });

  it('escapes a pipe so a value cannot break the table', () => {
    const markdown = renderReport(
      diffDatasets(
        dataset(),
        dataset({
          measurements: [{ ...measurement, comparabilityGroup: 'a|b|c' }],
        }),
      ),
    );
    expect(markdown).toContain('a\\|b\\|c');
  });
});

describe('image changes', () => {
  const photo: ParsedDataset['images'][number] = {
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

  it('reports an added photograph in its own section', () => {
    const diff = diffDatasets(dataset(), dataset({ images: [photo] }));
    expect(diff.images.added).toEqual(['commodore-64-photo']);
    expect(renderReport(diff)).toContain('## Images');
  });

  it('shows a re-encoded file as a changed hash rather than as nothing', () => {
    const reencoded = {
      ...photo,
      canonical: { ...photo.canonical, sha256: 'c'.repeat(64), byteLength: 41_000 },
    };
    const diff = diffDatasets(dataset({ images: [photo] }), dataset({ images: [reencoded] }));
    expect(diff.images.changed[0]?.changes.map((change) => change.field)).toEqual([
      'canonicalHash',
    ]);
  });

  it('shows terms a reviewer must look at twice', () => {
    const relicensed = {
      ...photo,
      rights: {
        ...photo.rights,
        id: 'cc-by-4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
      },
    };
    const diff = diffDatasets(dataset({ images: [photo] }), dataset({ images: [relicensed] }));
    expect(diff.images.changed[0]?.changes.map((change) => change.field)).toEqual(['rights']);
  });
});
