// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { ImageFileFacts, ImageFileReading } from './image-file.ts';
import { normalizeQuantity } from './normalize.ts';
import { componentSchema } from './schema.ts';
import type {
  Component,
  Conflict,
  ContextClaim,
  DerivedClaim,
  ImageAsset,
  Measurement,
  ResearchRecord,
  Source,
  System,
} from './schema.ts';
import type { UnknownRepairLedger } from './unknown-repair.ts';
import {
  sha256Hex,
  validateDataset,
  type ParsedDataset,
  type ValidationIssue,
} from './validate.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const tierA: Source = {
  id: 'vendor-datasheet',
  title: 'Vendor data sheet',
  publisher: 'Vendor',
  accessedDate: '2026-07-28',
  locator: 'page 3, table 1',
  tier: 'A',
  sourceType: 'vendor-documentation',
  url: 'https://example.invalid/datasheet',
  editorialStatus: 'approved',
};

const tierB = (id: string): Source => ({
  ...tierA,
  id,
  publisher: `${id} publisher`,
  tier: 'B',
  sourceType: 'independent-analysis',
});

const tierC: Source = { ...tierA, id: 'wiki', tier: 'C', sourceType: 'wiki' };

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
          measurementIds: [],
          shared: false,
        },
      ],
    },
  ],
  sourceIds: ['vendor-datasheet'],
  editorialStatus: 'approved',
};

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  const quantity = overrides.quantity ?? {
    state: 'value',
    value: '0.985248',
    unit: 'MHz',
    significantDigits: 6,
  };
  const base: Measurement = {
    id: 'commodore-64:cpu:clock',
    subject: { kind: 'system', id: 'commodore-64' },
    metric: 'clock-frequency',
    quantity,
    normalized: quantity.state === 'value' ? normalizeQuantity(quantity) : undefined,
    scope: 'cpu',
    method: 'nominal-clock',
    provenance: 'vendor',
    evidenceStage: 'shipped',
    comparabilityGroup: 'clock-frequency|cpu|nominal-clock',
    rounding: 'none',
    status: 'vendor-rated',
    evidenceLevel: quantity.state === 'value' ? 'confirmed' : undefined,
    editorialStatus: 'approved',
    sourceIds: ['vendor-datasheet'],
  };
  return { ...base, ...overrides };
}

function contextClaim(overrides: Partial<ContextClaim> = {}): ContextClaim {
  return {
    id: 'mos-6510:core-count',
    subject: { kind: 'component', id: 'mos-6510' },
    label: 'Core count',
    quantity: { state: 'value', value: '1', unit: 'unit', significantDigits: 1 },
    provenance: 'vendor',
    evidenceStage: 'shipped',
    status: 'vendor-rated',
    evidenceLevel: 'confirmed',
    editorialStatus: 'approved',
    sourceIds: ['vendor-datasheet'],
    ...overrides,
  };
}

function dataset(overrides: Partial<ParsedDataset> = {}): ParsedDataset {
  return {
    systems: [system],
    components: [cpu],
    images: [],
    measurements: [measurement()],
    contextClaims: [],
    derivedClaims: [],
    conflicts: [],
    sources: [tierA],
    extracts: [],
    ...overrides,
  };
}

const codes = (issues: readonly ValidationIssue[]): string[] => issues.map((issue) => issue.code);

/** The caveat the ratio formula generates for the two peak-FP32 fixtures below. */
const GENERATED_CAVEAT =
  'Compares peak-fp32-rate at gpu scope, obtained by theoretical-peak. Valid only within this ' +
  'comparability group, and reported to 3 significant digits — the precision of the least ' +
  'precise input. At least one input is a theoretical peak, which is an upper bound rather than ' +
  'an achieved result.';

function claim(value: string, caveat: string = GENERATED_CAVEAT): DerivedClaim {
  return {
    id: 'ratio:modern-over-playstation',
    formula: { id: 'ratio', version: '1', expression: 'a ÷ b' },
    inputMeasurementIds: ['modern:gpu:peak-fp32', 'playstation:gpu:peak-fp32'],
    result: { state: 'value', value, unit: 'unit', significantDigits: 3 },
    rounding: 'half-up',
    caveat,
    editorialStatus: 'approved',
  };
}

/* -------------------------------------------------------------------------- */

describe('validateDataset', () => {
  it('accepts a well-formed dataset', () => {
    expect(validateDataset(dataset())).toEqual([]);
  });
});

describe('references', () => {
  it('rejects a measurement whose subject does not exist', () => {
    const issues = validateDataset(
      dataset({
        measurements: [measurement({ subject: { kind: 'system', id: 'atari-800' } })],
      }),
    );
    expect(codes(issues)).toContain('unknown-subject');
  });

  it('rejects a measurement citing a source that does not exist', () => {
    const issues = validateDataset(
      dataset({ measurements: [measurement({ sourceIds: ['nonexistent'] })] }),
    );
    expect(codes(issues)).toContain('unknown-source');
  });

  it('rejects a configuration referencing a component that does not exist', () => {
    const issues = validateDataset(dataset({ components: [] }));
    expect(codes(issues)).toContain('unknown-component');
  });

  it('rejects a measurement pinned to a configuration the system does not have', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({ subject: { kind: 'system', id: 'commodore-64', configurationId: 'ntsc' } }),
        ],
      }),
    );
    expect(codes(issues)).toContain('unknown-configuration');
  });
});

describe('identifiers', () => {
  it('rejects two records sharing an id', () => {
    const issues = validateDataset(dataset({ systems: [system, { ...system, slug: 'other' }] }));
    expect(codes(issues)).toContain('duplicate-id');
  });

  it('rejects two systems sharing a slug, because slugs are URLs', () => {
    const issues = validateDataset(
      dataset({ systems: [system, { ...system, id: 'commodore-64-ntsc' }] }),
    );
    expect(codes(issues)).toContain('duplicate-slug');
  });

  it('allows a cpu and a gpu to share a slug, since their namespaces differ', () => {
    const gpu: Component = { ...cpu, id: 'vic-ii-gpu', kind: 'gpu', slug: 'mos-6510' };
    const issues = validateDataset(dataset({ components: [cpu, gpu] }));
    expect(codes(issues)).not.toContain('duplicate-slug');
  });
});

describe('product families', () => {
  const amiga500: System = {
    ...system,
    id: 'amiga-500',
    slug: 'amiga-500',
    name: 'Commodore Amiga 500',
    family: 'commodore-amiga',
  };
  const amiga1200: System = {
    ...amiga500,
    id: 'amiga-1200',
    slug: 'amiga-1200',
    name: 'Commodore Amiga 1200',
  };

  it('accepts a lineage of two', () => {
    const issues = validateDataset(dataset({ systems: [amiga500, amiga1200] }));
    expect(codes(issues)).not.toContain('family-of-one');
  });

  it('rejects a lineage of one, whose navbox would list only itself', () => {
    const issues = validateDataset(dataset({ systems: [amiga500] }));
    expect(codes(issues)).toContain('family-of-one');
  });

  it('rejects a lineage spanning two types, which would contradict the breadcrumb', () => {
    const issues = validateDataset(
      dataset({ systems: [amiga500, { ...amiga1200, type: 'personal-computer' }] }),
    );
    expect(codes(issues)).toContain('family-spans-types');
  });

  it('says nothing about a machine that belongs to no lineage', () => {
    const issues = validateDataset(dataset({ systems: [system] }));
    expect(codes(issues)).not.toContain('family-of-one');
    expect(codes(issues)).not.toContain('family-spans-types');
  });
});

describe('units and metrics', () => {
  it('rejects a unit from the wrong quantity for the metric', () => {
    const quantity = {
      state: 'value',
      value: '1',
      unit: 'MIPS',
      significantDigits: 1,
    } as const;
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            metric: 'clock-frequency',
            quantity,
            normalized: normalizeQuantity(quantity),
            comparabilityGroup: 'clock-frequency|cpu|vendor-datasheet',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('unit-quantity-not-allowed');
  });

  it('rejects a scope the metric does not allow', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            scope: 'storage',
            comparabilityGroup: 'clock-frequency|storage|vendor-datasheet',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('scope-not-allowed');
  });

  it('rejects a benchmark-dependent metric with no benchmark named', () => {
    const quantity = {
      state: 'value',
      value: '1200',
      unit: 'score',
      significantDigits: 4,
    } as const;
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            metric: 'spec-cpu-result',
            quantity,
            normalized: normalizeQuantity(quantity),
            method: 'spec-published-result',
            comparabilityGroup: 'spec-cpu-result|cpu|spec-published-result',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('benchmark-required');
  });

  it('rejects a stated figure whose normalized twin was never generated', () => {
    const issues = validateDataset(
      dataset({ measurements: [measurement({ normalized: undefined })] }),
    );
    expect(codes(issues)).toContain('missing-normalized');
  });

  it('rejects a normalized twin on a figure that has no value', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            quantity: { state: 'unknown' },
            normalized: { value: '1', unit: 'Hz', significantDigits: 1, unitRegistry: 'units-v1' },
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('normalized-without-value');
  });
});

describe('source sufficiency', () => {
  it('accepts a single tier A source', () => {
    expect(codes(validateDataset(dataset()))).not.toContain('insufficient-sourcing');
  });

  it('accepts two agreeing tier B sources', () => {
    const issues = validateDataset(
      dataset({
        sources: [tierB('analysis-one'), tierB('analysis-two')],
        measurements: [measurement({ sourceIds: ['analysis-one', 'analysis-two'] })],
      }),
    );
    expect(codes(issues)).not.toContain('insufficient-sourcing');
  });

  it('requires confirmed numbers to have two independent tier B sources', () => {
    const issues = validateDataset(
      dataset({
        sources: [tierB('analysis-one')],
        measurements: [measurement({ sourceIds: ['analysis-one'] })],
      }),
    );
    expect(codes(issues)).toContain('insufficient-sourcing');
  });

  it('accepts a tier C figure only when it is labelled rumored', () => {
    const issues = validateDataset(
      dataset({
        sources: [tierC],
        measurements: [
          measurement({
            sourceIds: ['wiki'],
            evidenceLevel: 'rumored',
            editorialStatus: 'provisional',
          }),
        ],
      }),
    );
    expect(codes(issues)).not.toContain('rumor-without-tier-c');
    expect(codes(issues)).not.toContain('tier-c-on-non-rumor');
  });

  it('accepts a reported number with one tier B source and an exact locator', () => {
    const issues = validateDataset(
      dataset({
        sources: [tierB('analysis-one')],
        measurements: [
          measurement({
            sourceIds: ['analysis-one'],
            evidenceLevel: 'reported',
            editorialStatus: 'provisional',
          }),
        ],
      }),
    );
    expect(codes(issues)).not.toContain('insufficient-sourcing');
  });

  it('rejects a reported number that is not provisional', () => {
    const issues = validateDataset(
      dataset({
        sources: [tierB('analysis-one')],
        measurements: [measurement({ sourceIds: ['analysis-one'], evidenceLevel: 'reported' })],
      }),
    );
    expect(codes(issues)).toContain('reduced-evidence-approved');
  });

  it('rejects a reported number with no tier B source and a rumor with no tier C source', () => {
    const reported = validateDataset(
      dataset({
        measurements: [measurement({ evidenceLevel: 'reported', editorialStatus: 'provisional' })],
      }),
    );
    const rumored = validateDataset(
      dataset({
        measurements: [measurement({ evidenceLevel: 'rumored', editorialStatus: 'provisional' })],
      }),
    );
    expect(codes(reported)).toContain('reported-without-tier-b');
    expect(codes(rumored)).toContain('rumor-without-tier-c');
  });

  it('warns about a source that cannot be re-checked', () => {
    const { url: _url, ...offline } = tierA;
    const issues = validateDataset(dataset({ sources: [offline] }));
    expect(codes(issues)).toContain('unverifiable-source');
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });
});

describe('derived claims', () => {
  const gpuQuantity = {
    state: 'value',
    value: '10.28',
    unit: 'TFLOP/s',
    significantDigits: 4,
  } as const;
  const psxQuantity = {
    state: 'value',
    value: '0.0665',
    unit: 'GFLOP/s',
    significantDigits: 3,
  } as const;

  // Two different machines: a ratio needs distinct subjects, and two figures
  // sharing one subject and comparability group would be a duplicate anyway.
  const playstation: System = {
    ...system,
    id: 'sony-playstation',
    slug: 'sony-playstation',
    name: 'Sony PlayStation',
    type: 'console',
    releaseDate: '1994-12',
  };

  const gpuFigure = measurement({
    id: 'modern:gpu:peak-fp32',
    metric: 'peak-fp32-rate',
    quantity: gpuQuantity,
    normalized: normalizeQuantity(gpuQuantity),
    scope: 'gpu',
    method: 'theoretical-peak',
    comparabilityGroup: 'peak-fp32-rate|gpu|theoretical-peak',
    status: 'theoretical',
  });

  const psxFigure = measurement({
    id: 'playstation:gpu:peak-fp32',
    subject: { kind: 'system', id: 'sony-playstation' },
    metric: 'peak-fp32-rate',
    quantity: psxQuantity,
    normalized: normalizeQuantity(psxQuantity),
    scope: 'gpu',
    method: 'theoretical-peak',
    comparabilityGroup: 'peak-fp32-rate|gpu|theoretical-peak',
    status: 'theoretical',
  });

  it('accepts a claim whose stored result recomputes exactly', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, psxFigure],
        derivedClaims: [claim('155000')],
      }),
    );
    expect(codes(issues)).toEqual([]);
  });

  it('rejects a stored result that no longer matches its inputs', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, psxFigure],
        derivedClaims: [claim('200000')],
      }),
    );
    expect(codes(issues)).toContain('derived-mismatch');
  });

  it('rejects a formula that is not in the registry', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, psxFigure],
        derivedClaims: [
          { ...claim('155000'), formula: { id: 'vibes', version: '1', expression: '?' } },
        ],
      }),
    );
    expect(codes(issues)).toContain('unknown-formula');
  });

  it('rejects a claim built from incomparable inputs', () => {
    const mipsQuantity = {
      state: 'value',
      value: '0.5',
      unit: 'MIPS',
      significantDigits: 1,
    } as const;
    const mipsFigure = measurement({
      id: 'playstation:gpu:peak-fp32',
      subject: { kind: 'system', id: 'sony-playstation' },
      metric: 'native-instruction-rate',
      quantity: mipsQuantity,
      normalized: normalizeQuantity(mipsQuantity),
      scope: 'cpu',
      method: 'theoretical-peak',
      comparabilityGroup: 'native-instruction-rate|cpu|theoretical-peak',
    });
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, mipsFigure],
        derivedClaims: [claim('155000')],
      }),
    );
    expect(codes(issues)).toContain('formula-refused');
  });

  // A hand-written caveat survives a change of inputs it no longer describes,
  // which is exactly what generating it from the inputs is meant to prevent.
  it('rejects a hand-written caveat that is not the one the formula generates', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, psxFigure],
        derivedClaims: [claim('155000', 'Same metric, scope and method.')],
      }),
    );
    expect(codes(issues)).toContain('derived-caveat-mismatch');
  });

  it('rejects a claim whose input measurement does not exist', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure],
        derivedClaims: [claim('155000')],
      }),
    );
    expect(codes(issues)).toContain('unknown-measurement');
  });

  it('never derives a figure from reported or rumored evidence', () => {
    const reportedInput = {
      ...gpuFigure,
      evidenceLevel: 'reported' as const,
      editorialStatus: 'provisional' as const,
      sourceIds: ['analysis-one'],
    };
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        sources: [tierB('analysis-one'), tierA],
        measurements: [reportedInput, psxFigure],
        derivedClaims: [claim('155000')],
      }),
    );
    expect(codes(issues)).toContain('derived-from-reduced-evidence');
  });

  it('rejects a claim that excludes one of its own inputs', () => {
    const issues = validateDataset(
      dataset({
        systems: [system, playstation],
        measurements: [gpuFigure, psxFigure],
        derivedClaims: [
          {
            ...claim('155000'),
            exclusions: [
              {
                measurementId: gpuFigure.id,
                label: 'Numerator',
                reason: 'The numerator is already a declared input to this ratio.',
              },
            ],
          },
        ],
      }),
    );
    expect(codes(issues)).toContain('excluded-input');
  });
});

function record(extract: string, hash?: string): ResearchRecord {
  return {
    id: 'agc-ntrs-report:page-12',
    sourceId: 'agc-ntrs-report',
    locator: 'page 12, table 3',
    extract,
    extractHash: hash ?? sha256Hex(extract),
    transcribedOn: '2026-07-28',
    transcribedBy: 'editor',
  };
}

describe('research records', () => {
  const manual: Source = {
    ...tierA,
    id: 'agc-ntrs-report',
    sourceType: 'government-document',
    title: 'Apollo Guidance Computer information series',
  };

  const figure = measurement({ sourceIds: ['agc-ntrs-report'] });
  const citing = measurement({
    sourceIds: ['agc-ntrs-report'],
    extractIds: ['agc-ntrs-report:page-12'],
  });

  it('accepts a document-backed figure that names its research record', () => {
    const issues = validateDataset(
      dataset({
        sources: [manual],
        measurements: [citing],
        extracts: [record('The computer executes about 85,500 instructions per second.')],
      }),
    );
    expect(codes(issues)).not.toContain('missing-research-record');
  });

  it('rejects a document-backed figure with no research record and no adapter', () => {
    const issues = validateDataset(dataset({ sources: [manual], measurements: [figure] }));
    expect(codes(issues)).toContain('missing-research-record');
  });

  // A long report has many figures in it. A record existing somewhere for the
  // same document does not say which sentence this particular number came from.
  it('rejects a document-backed figure that names no record, even when one exists for the source', () => {
    const issues = validateDataset(
      dataset({
        sources: [manual],
        measurements: [figure],
        extracts: [record('The computer executes about 85,500 instructions per second.')],
      }),
    );
    expect(codes(issues)).toContain('missing-research-record');
  });

  it('rejects a figure citing a research record that does not exist', () => {
    const issues = validateDataset(
      dataset({ sources: [manual], measurements: [citing], extracts: [] }),
    );
    expect(codes(issues)).toContain('unknown-research-record');
  });

  it('rejects a figure citing a record that transcribes a source it does not cite', () => {
    const issues = validateDataset(
      dataset({
        sources: [manual, { ...tierA, id: 'other-report' }],
        measurements: [
          measurement({ sourceIds: ['other-report'], extractIds: ['agc-ntrs-report:page-12'] }),
        ],
        extracts: [record('A sentence from a different document entirely.')],
      }),
    );
    expect(codes(issues)).toContain('extract-source-mismatch');
  });

  it('accepts a document source that an adapter reads instead', () => {
    const issues = validateDataset(
      dataset({ sources: [{ ...manual, adapter: 'json-path' }], measurements: [figure] }),
    );
    expect(codes(issues)).not.toContain('missing-research-record');
  });

  it('rejects an extract that no longer matches its hash', () => {
    const issues = validateDataset(
      dataset({
        sources: [manual],
        measurements: [figure],
        extracts: [record('edited after review', 'f'.repeat(64))],
      }),
    );
    expect(codes(issues)).toContain('extract-hash-mismatch');
  });

  it('rejects a research record pointing at a source that does not exist', () => {
    const issues = validateDataset(
      dataset({ extracts: [{ ...record('anything'), sourceId: 'ghost' }] }),
    );
    expect(codes(issues)).toContain('unknown-source');
  });

  it('does not demand a research record for a machine-readable source', () => {
    // tierA is vendor-documentation, which an adapter can read.
    expect(codes(validateDataset(dataset()))).not.toContain('missing-research-record');
  });
});

describe('duplicate figures', () => {
  it('rejects two figures claiming the same subject, metric and comparability group', () => {
    const issues = validateDataset(
      dataset({
        measurements: [measurement(), measurement({ id: 'commodore-64:cpu:clock-alt' })],
      }),
    );
    expect(codes(issues)).toContain('duplicate-figure');
  });

  it('allows the same metric in different comparability groups', () => {
    // One chip can state a double-precision peak twice, once for its vector
    // units, once for a dedicated matrix engine, and those are two figures
    // about two execution paths, not a duplicate.
    const peak = { state: 'value', value: '34', unit: 'TFLOP/s', significantDigits: 2 } as const;
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            id: 'commodore-64:gpu:peak-fp64',
            metric: 'peak-fp64-rate',
            quantity: peak,
            normalized: normalizeQuantity(peak),
            scope: 'gpu',
            method: 'theoretical-peak',
            comparabilityGroup: 'peak-fp64-rate|gpu|theoretical-peak',
          }),
          measurement({
            id: 'commodore-64:gpu:peak-fp64-tensor',
            metric: 'peak-fp64-rate',
            quantity: peak,
            normalized: normalizeQuantity(peak),
            scope: 'gpu',
            method: 'tensor-core-peak',
            comparabilityGroup: 'peak-fp64-rate|gpu|tensor-core-peak',
          }),
        ],
      }),
    );
    expect(codes(issues)).not.toContain('duplicate-figure');
  });

  it('rejects a recorded absence beside a stated value', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement(),
          measurement({
            id: 'commodore-64:cpu:clock-unstated',
            quantity: { state: 'unknown', note: 'the manual states no frequency' },
            normalized: undefined,
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('value-with-absence');
  });

  it('allows two parts of one record to state the same quantity', () => {
    // An Apple M1's performance and efficiency cores both have a clock, and
    // neither disputes the other's. They are two figures about two parts, so
    // they occupy two slots, while staying in one comparability group, which is
    // what keeps the machine in the same row as every other machine's clock.
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            id: 'commodore-64:cpu:clock-fast',
            subject: { kind: 'system', id: 'commodore-64', part: 'performance-cores' },
          }),
          measurement({
            id: 'commodore-64:cpu:clock-slow',
            subject: { kind: 'system', id: 'commodore-64', part: 'efficiency-cores' },
          }),
        ],
      }),
    );
    expect(codes(issues)).not.toContain('duplicate-figure');
  });

  it('still rejects two figures for the same part', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            id: 'commodore-64:cpu:clock-fast',
            subject: { kind: 'system', id: 'commodore-64', part: 'performance-cores' },
          }),
          measurement({
            id: 'commodore-64:cpu:clock-fast-alt',
            subject: { kind: 'system', id: 'commodore-64', part: 'performance-cores' },
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('duplicate-figure');
  });

  it('rejects the same absence recorded twice', () => {
    const absent = {
      quantity: { state: 'unknown' },
      normalized: undefined,
    } as const;
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement(absent),
          measurement({ ...absent, id: 'commodore-64:cpu:clock-unstated' }),
        ],
      }),
    );
    expect(codes(issues)).toContain('duplicate-absence');
  });

  it('rejects an estimate that does not say how it was computed', () => {
    const issues = validateDataset(
      dataset({ measurements: [measurement({ status: 'estimated' })] }),
    );
    expect(codes(issues)).toContain('estimate-without-method');
    expect(codes(issues)).toContain('estimate-without-procedure');
  });

  it('rejects a method the registry does not define for that metric', () => {
    const issues = validateDataset(
      dataset({
        measurements: [
          measurement({
            method: 'design-capacity',
            comparabilityGroup: 'clock-frequency|cpu|design-capacity',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('method-metric-mismatch');
  });
});

describe('conflicts and audited absences', () => {
  const conflict: Conflict = {
    id: 'commodore-64:clock-conflict',
    subject: { kind: 'system', id: 'commodore-64' },
    metric: 'clock-frequency',
    candidates: [
      {
        quantity: { state: 'value', value: '1', unit: 'MHz', significantDigits: 1 },
        sourceIds: ['vendor-datasheet'],
        evidence: 'Data sheet.',
      },
      {
        quantity: { state: 'value', value: '2', unit: 'MHz', significantDigits: 1 },
        sourceIds: ['vendor-datasheet'],
        evidence: 'Revision note.',
      },
    ],
    decision: {
      outcome: 'accepted',
      candidateIndex: 0,
      rationale: 'The data sheet is for the shipped model.',
      decidedOn: '2026-08-25',
    },
  };

  it('rejects a conflict that accepts a candidate outside its ledger', () => {
    const issues = validateDataset(
      dataset({
        conflicts: [
          {
            ...conflict,
            decision: {
              outcome: 'accepted',
              candidateIndex: 2,
              rationale: conflict.decision.rationale,
              decidedOn: conflict.decision.decidedOn,
            },
          },
        ],
      }),
    );
    expect(codes(issues)).toContain('conflict-decision-out-of-range');
  });

  it('reports an unresolved conflict as a warning', () => {
    const issues = validateDataset(
      dataset({
        conflicts: [
          {
            ...conflict,
            decision: {
              outcome: 'unresolved',
              rationale: 'The sources disagree.',
              decidedOn: '2026-08-25',
            },
          },
        ],
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'conflict-unresolved', severity: 'warning' }),
    );
  });

  it('requires a true-unknown repair to point at an audited absence', () => {
    const unknown = measurement({ quantity: { state: 'unknown' }, normalized: undefined });
    const ledger: UnknownRepairLedger = {
      version: 'unknown-repair-v1',
      baselineCommit: '99c5bc2ca113964ff77cde4f9cf0cca9faa323f9',
      entries: [
        {
          measurementId: unknown.id,
          disposition: 'true-unknown',
          targetIds: [unknown.id],
          reviewedOn: '2026-08-25',
        },
        ...Array.from({ length: 253 }, (_, index) => ({
          measurementId: `unreviewed-${index}`,
          disposition: 'unreviewed' as const,
          targetIds: [],
        })),
      ],
    };
    const issues = validateDataset(dataset({ measurements: [unknown] }), {
      unknownRepairLedger: ledger,
    });
    expect(codes(issues)).toContain('unknown-repair-target-mismatch');
  });

  it('requires every true-unknown repair to document a community-source check', () => {
    const unknown = measurement({
      quantity: { state: 'unknown' },
      normalized: undefined,
      unknownAudit: {
        reviewedOn: '2026-08-25',
        routesChecked: ['vendor-documentation', 'independent-analysis'],
        outcome: 'no-published-candidate',
        summary: 'No checked source states this value.',
      },
    });
    const ledger: UnknownRepairLedger = {
      version: 'unknown-repair-v1',
      baselineCommit: '99c5bc2ca113964ff77cde4f9cf0cca9faa323f9',
      entries: [
        {
          measurementId: unknown.id,
          disposition: 'true-unknown',
          targetIds: [unknown.id],
          reviewedOn: '2026-08-25',
        },
        ...Array.from({ length: 253 }, (_, index) => ({
          measurementId: `unreviewed-${index}`,
          disposition: 'unreviewed' as const,
          targetIds: [],
        })),
      ],
    };
    const issues = validateDataset(dataset({ measurements: [unknown] }), {
      unknownRepairLedger: ledger,
    });
    expect(codes(issues)).toContain('unknown-repair-without-community-source');
  });
});

describe('snapshots of moving figures', () => {
  const score = { state: 'value', value: '2364', unit: 'score', significantDigits: 4 } as const;

  function snapshot(overrides: Partial<Measurement> = {}): Measurement {
    return measurement({
      id: 'commodore-64:geekbench-6-single-core',
      metric: 'geekbench-score',
      quantity: score,
      normalized: normalizeQuantity(score),
      scope: 'whole-system',
      method: 'benchmark-chart-average',
      benchmark: { id: 'geekbench', version: '6', variant: 'single-core' },
      comparabilityGroup:
        'geekbench-score|whole-system|benchmark-chart-average|geekbench@6:single-core',
      status: 'measured',
      asOf: '2025-06-01',
      ...overrides,
    });
  }

  it('accepts a chart average that records the day it was read', () => {
    expect(codes(validateDataset(dataset({ measurements: [snapshot()] })))).toEqual([]);
  });

  it('rejects a chart average with no date', () => {
    const issues = validateDataset(dataset({ measurements: [snapshot({ asOf: undefined })] }));
    expect(codes(issues)).toContain('snapshot-without-date');
  });

  it('rejects two readings of one quantity taken on different days', () => {
    // Otherwise a 2025 chart average and a 2027 one would sit in the same
    // comparability group, and a multiplier between them would describe two
    // years of other people's uploads rather than any hardware.
    const issues = validateDataset(
      dataset({
        measurements: [
          snapshot(),
          snapshot({ id: 'commodore-64:geekbench-6-single-core-later', asOf: '2027-01-04' }),
        ],
      }),
    );
    expect(codes(issues)).toContain('snapshot-date-mismatch');
  });
});

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

const CANONICAL_HASH = 'a'.repeat(64);

function image(overrides: Partial<ImageAsset> = {}): ImageAsset {
  const base: ImageAsset = {
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
    attribution: 'Photograph by A Photographer, licensed CC BY-SA 4.0.',
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
      sha256: CANONICAL_HASH,
    },
    transform: {
      preset: 'image-v1',
      sourceWidth: 4608,
      sourceHeight: 3456,
      fit: 'exact',
      note: 'Already 4:3; a reduction and nothing else.',
    },
    editorialStatus: 'approved',
  };
  return { ...base, ...overrides };
}

/** What a healthy canonical file on disk reads as. */
const storedFile = (
  overrides: Partial<ImageFileFacts> = {},
): ReadonlyMap<string, ImageFileReading> =>
  new Map([
    [
      'commodore-64-photo',
      {
        ok: true,
        facts: {
          format: 'avif',
          width: 1280,
          height: 960,
          byteLength: 40_000,
          sha256: CANONICAL_HASH,
          ...overrides,
        },
      } as const,
    ],
  ]);

const withImage = (overrides: Partial<ImageAsset> = {}): ParsedDataset =>
  dataset({
    images: [image(overrides)],
    systems: [{ ...system, imageIds: ['commodore-64-photo'] }],
  });

describe('image records', () => {
  it('accepts a licensed, referenced image whose file is what the record says', () => {
    expect(codes(validateDataset(withImage(), { imageFiles: storedFile() }))).toEqual([]);
  });

  it('refuses terms cited at a URL that is not the canonical one', () => {
    const issues = validateDataset(
      withImage({
        rights: {
          ...image().rights,
          url: 'https://en.wikipedia.org/wiki/Creative_Commons_license',
        },
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('image-rights-url-mismatch');
  });

  it('refuses terms stated somewhere other than the file itself', () => {
    const issues = validateDataset(
      withImage({
        rights: { ...image().rights, statedAt: 'https://example.invalid/terms-of-use' },
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('image-rights-not-on-source-page');
  });

  it('refuses a credit line that does not name the photographer', () => {
    const issues = validateDataset(
      withImage({ attribution: 'Photograph via Wikimedia Commons, CC BY-SA 4.0.' }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('image-attribution-missing');
  });

  it('accepts a public domain release, and still demands the credit line', () => {
    const release = {
      id: 'pd-self',
      url: 'https://commons.wikimedia.org/wiki/Template:PD-self',
      statement: 'I, the copyright holder of this work, release this work into the public domain.',
      statedAt: 'https://example.invalid/wiki/File:C64.jpg',
    };
    expect(
      codes(validateDataset(withImage({ rights: release }), { imageFiles: storedFile() })),
    ).toEqual([]);

    // Nobody can oblige us to credit a public domain photograph, which is why
    // the obligation is this project's own and applies to every image.
    const uncredited = validateDataset(
      withImage({ rights: release, attribution: 'Released into the public domain.' }),
      { imageFiles: storedFile() },
    );
    expect(codes(uncredited)).toContain('image-attribution-missing');
  });

  it('accepts a work of the US government on the statute that puts it outside copyright', () => {
    const issues = validateDataset(
      withImage({
        creator: 'NASA',
        creatorType: 'organization',
        attribution: 'Photograph by NASA, in the public domain.',
        rights: {
          id: 'pd-us-government',
          url: 'https://www.copyright.gov/title17/92chap1.html',
          statement:
            'This file is in the public domain in the United States because it was solely ' +
            'created by NASA.',
          statedAt: 'https://example.invalid/wiki/File:C64.jpg',
        },
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toEqual([]);
  });

  it('refuses terms that are not in the registry at all', () => {
    const issues = validateDataset(
      withImage({
        rights: { ...image().rights, id: 'all-rights-reserved' },
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('unknown-image-rights');
  });

  it('refuses a recipe that does not match the original it was planned against', () => {
    const issues = validateDataset(
      withImage({ original: { ...image().original, width: 4000, height: 3000 } }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('image-transform-source-mismatch');
  });

  it('reports a recipe that would stretch the photograph', () => {
    const issues = validateDataset(
      withImage({
        original: { ...image().original, width: 2400, height: 1607 },
        transform: { ...image().transform, sourceWidth: 2400, sourceHeight: 1607 },
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('transform-source-not-4-3');
  });

  it('refuses a stored file that is over the preset limit', () => {
    const issues = validateDataset(
      withImage({ canonical: { ...image().canonical, byteLength: 300_000 } }),
      { imageFiles: storedFile({ byteLength: 300_000 }) },
    );
    expect(codes(issues)).toContain('image-too-large');
  });

  it('refuses a file that is missing, not AVIF, the wrong size, or a different file', () => {
    expect(codes(validateDataset(withImage(), { imageFiles: new Map() }))).toContain(
      'image-file-missing',
    );
    expect(
      codes(
        validateDataset(withImage(), {
          imageFiles: new Map([['commodore-64-photo', { ok: false, reason: 'not-avif' } as const]]),
        }),
      ),
    ).toContain('image-not-avif');
    expect(
      codes(
        validateDataset(withImage(), { imageFiles: storedFile({ width: 1600, height: 1200 }) }),
      ),
    ).toContain('image-dimensions-mismatch');
    expect(
      codes(validateDataset(withImage(), { imageFiles: storedFile({ sha256: 'c'.repeat(64) }) })),
    ).toContain('image-hash-mismatch');
    expect(
      codes(validateDataset(withImage(), { imageFiles: storedFile({ byteLength: 41_000 }) })),
    ).toContain('image-byte-length-mismatch');
  });

  it('leaves the file checks alone when the caller is not reading files', () => {
    expect(codes(validateDataset(withImage()))).toEqual([]);
  });
});

describe('image references', () => {
  it('refuses a system that names an image which does not exist', () => {
    const issues = validateDataset(
      dataset({ systems: [{ ...system, imageIds: ['no-such-image'] }] }),
      { imageFiles: new Map() },
    );
    expect(codes(issues)).toContain('unknown-image');
  });

  it('refuses a repeated reference, whose order would otherwise be meaningless', () => {
    const issues = validateDataset(
      dataset({
        images: [image()],
        systems: [{ ...system, imageIds: ['commodore-64-photo', 'commodore-64-photo'] }],
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('duplicate-image-reference');
  });

  it('refuses one photograph used as the lead image of two machines', () => {
    const issues = validateDataset(
      dataset({
        images: [image()],
        systems: [
          { ...system, imageIds: ['commodore-64-photo'] },
          {
            ...system,
            id: 'commodore-128',
            slug: 'commodore-128',
            imageIds: ['commodore-64-photo'],
          },
        ],
      }),
      { imageFiles: storedFile() },
    );
    expect(codes(issues)).toContain('duplicate-image-reference');
  });

  it('warns about an image nothing publishes', () => {
    const issues = validateDataset(dataset({ images: [image()] }), { imageFiles: storedFile() });
    expect(codes(issues)).toContain('unused-image');
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });
});

describe('images on components', () => {
  it('are refused by the schema, not merely dropped', () => {
    const result = componentSchema.safeParse({ ...cpu, imageIds: ['commodore-64-photo'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes('imageIds'))).toBe(true);
  });

  it('leaves a component without the field alone', () => {
    expect(componentSchema.safeParse(cpu).success).toBe(true);
  });
});

describe('catalog-v1 numerical consistency gate', () => {
  it('uses stable codes for missing and wrongly assigned configuration measurements', () => {
    const missing = dataset({
      systems: [
        {
          ...system,
          configurations: [
            {
              ...system.configurations[0]!,
              entries: [
                {
                  ...system.configurations[0]!.entries[0]!,
                  measurementIds: ['missing'],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(codes(validateDataset(missing))).toContain('unknown-configuration-measurement');

    const wrongVariant = measurement({
      subject: { kind: 'system', id: 'commodore-64', configurationId: 'ntsc' },
    });
    const systemReferencing = (measurementId: string): System => ({
      ...system,
      configurations: [
        {
          ...system.configurations[0]!,
          entries: [
            {
              ...system.configurations[0]!.entries[0]!,
              measurementIds: [measurementId],
            },
          ],
        },
      ],
    });
    expect(
      codes(
        validateDataset(
          dataset({ systems: [systemReferencing(wrongVariant.id)], measurements: [wrongVariant] }),
        ),
      ),
    ).toContain('configuration-measurement-subject-mismatch');

    const otherCpu = { ...cpu, id: 'other-cpu', slug: 'other-cpu' };
    const wrongComponent = measurement({ subject: { kind: 'component', id: otherCpu.id } });
    expect(
      codes(
        validateDataset(
          dataset({
            systems: [systemReferencing(wrongComponent.id)],
            components: [cpu, otherCpu],
            measurements: [wrongComponent],
          }),
        ),
      ),
    ).toContain('configuration-measurement-subject-mismatch');
  });

  it('rejects raw quantities, missing references and malformed markers in authored prose', () => {
    expect(
      codes(validateDataset(dataset({ systems: [{ ...system, summary: 'Runs at 1 MHz.' }] }))),
    ).toContain('raw-quantity-in-prose');
    expect(
      codes(
        validateDataset(
          dataset({ systems: [{ ...system, summary: '{{measurement:no-such-figure}}' }] }),
        ),
      ),
    ).toContain('unknown-editorial-reference');
    expect(
      codes(
        validateDataset(dataset({ systems: [{ ...system, summary: '{{measurement broken}}' }] })),
      ),
    ).toContain('unresolved-editorial-marker');
  });

  it('rejects a contextual value that shadows a formal configuration measurement', () => {
    const shadowingClaim = contextClaim({
      id: 'commodore-64:context-clock',
      subject: { kind: 'system', id: 'commodore-64' },
      label: 'Frequency',
      quantity: { state: 'value', value: '1.02', unit: 'MHz', significantDigits: 3 },
    });
    const configured = {
      ...system,
      summary: `A computer running at {{context:${shadowingClaim.id}}}.`,
      configurations: [
        {
          ...system.configurations[0]!,
          entries: [
            {
              ...system.configurations[0]!.entries[0]!,
              measurementIds: ['commodore-64:cpu:clock'],
            },
          ],
        },
      ],
    };

    expect(
      codes(validateDataset(dataset({ systems: [configured], contextClaims: [shadowingClaim] }))),
    ).toContain('context-claim-shadows-measurement');
  });

  it('applies the existing sourcing threshold to context claims', () => {
    expect(
      codes(
        validateDataset(
          dataset({
            contextClaims: [contextClaim({ sourceIds: ['review'] })],
            sources: [tierB('review')],
          }),
        ),
      ),
    ).toContain('insufficient-sourcing');
    expect(
      codes(
        validateDataset(
          dataset({ contextClaims: [contextClaim({ sourceIds: ['missing-source'] })] }),
        ),
      ),
    ).toContain('unknown-source');
  });
});
