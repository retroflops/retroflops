// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Dataset validation.
 *
 * Schema parsing tells you a record is well-formed. This tells you the dataset
 * is publishable: references resolve, identifiers are unique, units match their
 * metric, every published figure carries sufficient sourcing, no two figures
 * claim the same slot, and every derived claim still recomputes from its inputs.
 *
 * Pure and offline. IO belongs to the calling script.
 */

import { createHash } from 'node:crypto';

import { checkFacets, checkGroupFacets, type ComparabilityFacets } from './comparability.ts';
import { compareDecimal, parseDecimal } from './decimal.ts';
import {
  containsMarker,
  containsRawQuantity,
  editorialTextFields,
  markerTargets,
  type EditorialReference,
  type EditorialTextField,
  referencesIn,
  sameSubject,
} from './editorial-text.ts';
import {
  acceptsInputCount,
  getFormula,
  type FormulaDefinition,
  type FormulaInput,
} from './formulas.ts';
import type { ImageFileReading } from './image-file.ts';
import { CANONICAL_MAX_BYTES, checkTransformRecipe } from './image-preset.ts';
import { getImageRights } from './image-rights.ts';
import { getMetric } from './metrics.ts';
import { normalizeQuantity } from './normalize.ts';
import type {
  Component,
  ConfigurationEntry,
  Conflict,
  ContextClaim,
  DerivedClaim,
  ImageAsset,
  Measurement,
  ResearchRecord,
  Source,
  SubjectRef,
  System,
} from './schema.ts';
import { quantityOf } from './units.ts';
import type { UnknownRepairLedger } from './unknown-repair.ts';
import { UNKNOWN_REPAIR_BASELINE_COUNT, UNREVIEWED_UNKNOWN_BUDGET } from './unknown-repair.ts';

export interface ParsedDataset {
  readonly systems: readonly System[];
  readonly components: readonly Component[];
  readonly images: readonly ImageAsset[];
  readonly measurements: readonly Measurement[];
  readonly contextClaims: readonly ContextClaim[];
  readonly derivedClaims: readonly DerivedClaim[];
  readonly conflicts: readonly Conflict[];
  readonly sources: readonly Source[];
  readonly extracts: readonly ResearchRecord[];
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  readonly severity: IssueSeverity;
  /** Stable machine-readable code, used in tests and in CI output. */
  readonly code: string;
  /** Which record the issue is about. */
  readonly where: string;
  readonly message: string;
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

/**
 * What is actually on disk for each canonical image, keyed by image id.
 *
 * Absent from the map means the file is missing, which is an error. An absent
 * *map* means the caller is not checking files at all. The pure unit tests do
 * that, and the pipeline scripts never do.
 */
export interface ValidationInputs {
  readonly imageFiles?: ReadonlyMap<string, ImageFileReading>;
  readonly unknownRepairLedger?: UnknownRepairLedger;
}

export function validateDataset(
  dataset: ParsedDataset,
  inputs: ValidationInputs = {},
): readonly ValidationIssue[] {
  return [
    ...checkUniqueIdentifiers(dataset),
    ...checkFamilies(dataset),
    ...checkReferences(dataset),
    ...checkImages(dataset, inputs.imageFiles),
    ...checkMeasurementFacets(dataset),
    ...checkSourceSufficiency(dataset),
    ...checkEditorialText(dataset),
    ...checkDuplicateFigures(dataset),
    ...checkDerivedClaims(dataset),
    ...checkDerivedFigures(dataset),
    ...checkConflicts(dataset),
    ...checkResearchRecords(dataset),
    ...checkSnapshots(dataset),
    ...(inputs.unknownRepairLedger === undefined
      ? []
      : checkUnknownRepairLedger(dataset, inputs.unknownRepairLedger)),
  ];
}

type LedgerEntry = UnknownRepairLedger['entries'][number];

function checkUnknownRepairLedger(
  dataset: ParsedDataset,
  ledger: UnknownRepairLedger,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...checkLedgerTotals(ledger)];
  const measurements = new Map(
    dataset.measurements.map((measurement) => [measurement.id, measurement]),
  );
  const conflicts = new Set(dataset.conflicts.map((conflict) => conflict.id));
  const seen = new Set<string>();

  for (const entry of ledger.entries) {
    const where = `unknown repair ${entry.measurementId}`;
    if (seen.has(entry.measurementId)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-unknown-repair-entry',
        where,
        message: 'appears more than once',
      });
      continue;
    }
    seen.add(entry.measurementId);
    issues.push(...checkLedgerEntry(entry, where, measurements, conflicts));
  }

  for (const measurement of dataset.measurements) {
    if (measurement.quantity.state === 'unknown' && !seen.has(measurement.id)) {
      issues.push({
        severity: 'error',
        code: 'unknown-outside-repair-ledger',
        where: `measurement ${measurement.id}`,
        message: 'is unknown but does not appear in the v1 repair ledger',
      });
    }
  }

  return issues;
}

function checkLedgerTotals(ledger: UnknownRepairLedger): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (ledger.entries.length < UNKNOWN_REPAIR_BASELINE_COUNT) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-baseline-count',
      where: 'unknown repair ledger',
      message: `must contain all ${UNKNOWN_REPAIR_BASELINE_COUNT} baseline entries; found ${ledger.entries.length}`,
    });
  }

  const unreviewed = ledger.entries.filter((entry) => entry.disposition === 'unreviewed').length;
  if (unreviewed > UNREVIEWED_UNKNOWN_BUDGET) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-budget-exceeded',
      where: 'unknown repair ledger',
      message: `${unreviewed} entries remain unreviewed, over the limit of ${UNREVIEWED_UNKNOWN_BUDGET}`,
    });
  }
  return issues;
}

function checkLedgerEntry(
  entry: LedgerEntry,
  where: string,
  measurements: ReadonlyMap<string, Measurement>,
  conflicts: ReadonlySet<string>,
): ValidationIssue[] {
  if (entry.disposition === 'unreviewed') {
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (entry.reviewedOn === undefined) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-without-date',
      where,
      message: 'a completed disposition needs a review date',
    });
  }
  if (entry.targetIds.length === 0) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-without-target',
      where,
      message: 'a completed disposition must name its resulting record',
    });
    return issues;
  }

  if (entry.disposition === 'conflict') {
    if (!entry.targetIds.every((id) => conflicts.has(id))) {
      issues.push({
        severity: 'error',
        code: 'unknown-repair-target-mismatch',
        where,
        message: 'a conflict disposition must point to conflict records',
      });
    }
    return issues;
  }

  const targets = entry.targetIds.map((id) => measurements.get(id));
  if (targets.some((target) => target === undefined)) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-target-missing',
      where,
      message: 'points to a measurement that does not exist',
    });
    return issues;
  }
  issues.push(
    ...checkLedgerTargets(
      entry.disposition,
      targets.filter((target) => target !== undefined),
      where,
    ),
  );
  return issues;
}

/** Whether the records a completed disposition points to are what it says they are. */
function checkLedgerTargets(
  disposition: Exclude<LedgerEntry['disposition'], 'unreviewed' | 'conflict'>,
  targets: readonly Measurement[],
  where: string,
): ValidationIssue[] {
  const mismatch = (message: string): ValidationIssue => ({
    severity: 'error',
    code: 'unknown-repair-target-mismatch',
    where,
    message,
  });

  if (disposition === 'not-applicable') {
    return targets.some((target) => target.quantity.state !== 'not-applicable')
      ? [mismatch('must point only to not-applicable measurements')]
      : [];
  }
  if (disposition !== 'true-unknown') {
    const stated = targets.filter((target) => target.quantity.state === 'value');
    const matches =
      stated.length === targets.length &&
      stated.every((target) => target.evidenceLevel === disposition);
    return matches ? [] : [mismatch(`must point only to ${disposition} values`)];
  }

  const issues: ValidationIssue[] = [];
  if (
    targets.some(
      (target) => target.quantity.state !== 'unknown' || target.unknownAudit === undefined,
    )
  ) {
    issues.push(mismatch('a true-unknown disposition must point to audited unknown measurements'));
  }
  if (targets.some((target) => !target.unknownAudit?.routesChecked.includes('community-source'))) {
    issues.push({
      severity: 'error',
      code: 'unknown-repair-without-community-source',
      where,
      message: 'a true-unknown disposition requires a documented community-source route check',
    });
  }
  return issues;
}

/**
 * Methods whose figures move on their own.
 *
 * A benchmark publisher's chart average is recomputed as results arrive, so a
 * figure taken from one is a photograph of a moving thing. Two rules follow, and
 * both exist to stop the catalog quietly comparing two different days: the
 * figure must say which day it was read, and every figure of one quantity
 * obtained this way must have been read on the same day. Without the second
 * rule, a chart average from 2025 and one from 2027 would sit in the same
 * comparability group and divide into each other, and the multiplier would
 * describe two years of other people's uploads rather than any hardware.
 */
const ROLLING_METHODS = new Set(['benchmark-chart-average']);

function checkSnapshots(dataset: ParsedDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dates = new Map<string, { asOf: string; id: string }>();

  for (const measurement of dataset.measurements) {
    if (!ROLLING_METHODS.has(measurement.method)) {
      continue;
    }
    const where = `measurement ${measurement.id}`;
    if (measurement.asOf === undefined) {
      issues.push({
        severity: 'error',
        code: 'snapshot-without-date',
        where,
        message:
          `is obtained by "${measurement.method}", which produces a figure that changes on its ` +
          'own, so it must record the day it was read in "asOf"',
      });
      continue;
    }
    const first = dates.get(measurement.comparabilityGroup);
    if (first === undefined) {
      dates.set(measurement.comparabilityGroup, { asOf: measurement.asOf, id: measurement.id });
      continue;
    }
    if (first.asOf !== measurement.asOf) {
      issues.push({
        severity: 'error',
        code: 'snapshot-date-mismatch',
        where,
        message:
          `was read on ${measurement.asOf}, but "${first.id}" holds the same quantity read on ` +
          `${first.asOf}. Figures that move must be re-read together, or a multiplier between ` +
          'them compares two different days rather than two machines.',
      });
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */

function checkUniqueIdentifiers(dataset: ParsedDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const groups: readonly [string, readonly { id: string }[]][] = [
    ['system', dataset.systems],
    ['component', dataset.components],
    ['image', dataset.images],
    ['measurement', dataset.measurements],
    ['context claim', dataset.contextClaims],
    ['derived claim', dataset.derivedClaims],
    ['conflict', dataset.conflicts],
    ['source', dataset.sources],
    ['research record', dataset.extracts],
  ];

  for (const [label, records] of groups) {
    issues.push(
      ...duplicatesOf(
        records.map((record) => record.id),
        label,
        'duplicate-id',
        'id',
      ),
    );
  }

  // Slugs become URLs, so they must be unique within their own namespace.
  issues.push(
    ...duplicatesOf(
      dataset.systems.map((system) => system.slug),
      'system',
      'duplicate-slug',
      'slug',
    ),
  );
  for (const kind of ['cpu', 'gpu', 'memory'] as const) {
    const slugs = dataset.components
      .filter((component) => component.kind === kind)
      .map((component) => component.slug);
    issues.push(...duplicatesOf(slugs, `${kind} component`, 'duplicate-slug', 'slug'));
  }

  return issues;
}

/**
 * The two rules that keep `family` from decaying into a second, sloppier `type`.
 *
 * The schema can only check that a family is in the vocabulary. Neither rule it
 * cannot check is cosmetic: a lineage of one renders a navbox whose only entry
 * is the page the reader is already on, and a lineage spanning two types renders
 * one that contradicts the category named in the breadcrumb above it. Both are
 * curation mistakes that look fine in a single record and only become visible
 * across the set, which is exactly what this stage is for.
 */
function checkFamilies(dataset: ParsedDataset): ValidationIssue[] {
  const members = new Map<string, System[]>();
  for (const system of dataset.systems) {
    if (system.family !== undefined) {
      const group = members.get(system.family);
      if (group === undefined) {
        members.set(system.family, [system]);
      } else {
        group.push(system);
      }
    }
  }

  const issues: ValidationIssue[] = [];
  for (const [family, group] of members) {
    if (group.length < 2) {
      issues.push({
        severity: 'error',
        code: 'family-of-one',
        where: `system family ${family}`,
        message:
          `family "${family}" has only one member (${group.map((system) => system.id).join(', ')}). ` +
          'A lineage needs at least two machines; a single machine belongs to no family.',
      });
    }

    const types = [...new Set(group.map((system) => system.type))].toSorted();
    if (types.length > 1) {
      issues.push({
        severity: 'error',
        code: 'family-spans-types',
        where: `system family ${family}`,
        message:
          `family "${family}" spans more than one system type (${types.join(', ')}). ` +
          'A family never crosses a type, because the navbox would contradict the breadcrumb.',
      });
    }
  }

  return issues;
}

function duplicatesOf(
  values: readonly string[],
  label: string,
  code: string,
  field: string,
): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return [...duplicated].map((value) => ({
    severity: 'error' as const,
    code,
    where: `${label} ${value}`,
    message: `${field} "${value}" is used by more than one ${label} record`,
  }));
}

/** The identifiers a reference may point to, and the checks every kind of record shares. */
class ReferenceIndex {
  readonly #dataset: ParsedDataset;
  readonly #systemIds: ReadonlySet<string>;
  readonly #componentIds: ReadonlySet<string>;
  readonly #sourceIds: ReadonlySet<string>;

  constructor(dataset: ParsedDataset) {
    this.#dataset = dataset;
    this.#systemIds = new Set(dataset.systems.map((system) => system.id));
    this.#componentIds = new Set(dataset.components.map((component) => component.id));
    this.#sourceIds = new Set(dataset.sources.map((source) => source.id));
  }

  hasComponent(id: string): boolean {
    return this.#componentIds.has(id);
  }

  sources(where: string, ids: readonly string[]): ValidationIssue[] {
    return ids
      .filter((id) => !this.#sourceIds.has(id))
      .map((id): ValidationIssue => ({
        severity: 'error',
        code: 'unknown-source',
        where,
        message: `references source "${id}", which does not exist`,
      }));
  }

  /**
   * The subject a record describes must exist, and so must the variant it
   * narrows the figure to, when it names one and `withConfiguration` asks.
   */
  subject(where: string, subject: SubjectRef, withConfiguration: boolean): ValidationIssue[] {
    const exists =
      subject.kind === 'system'
        ? this.#systemIds.has(subject.id)
        : this.#componentIds.has(subject.id);
    if (!exists) {
      return [
        {
          severity: 'error',
          code: 'unknown-subject',
          where,
          message: `subject ${subject.kind} "${subject.id}" does not exist`,
        },
      ];
    }
    if (!withConfiguration || subject.configurationId === undefined) {
      return [];
    }
    const system = this.#dataset.systems.find((candidate) => candidate.id === subject.id);
    const known = system?.configurations.some(
      (configuration) => configuration.id === subject.configurationId,
    );
    return known === true
      ? []
      : [
          {
            severity: 'error',
            code: 'unknown-configuration',
            where,
            message: `configuration "${subject.configurationId}" does not exist on that system`,
          },
        ];
  }
}

function checkReferences(dataset: ParsedDataset): ValidationIssue[] {
  const index = new ReferenceIndex(dataset);
  const measurementsById = new Map<string, Measurement>();
  for (const measurement of dataset.measurements) {
    if (!measurementsById.has(measurement.id)) {
      measurementsById.set(measurement.id, measurement);
    }
  }

  return [
    ...dataset.systems.flatMap((system) => [
      ...index.sources(`system ${system.id}`, system.sourceIds),
      ...checkConfigurationReferences(system, index, measurementsById),
    ]),
    ...dataset.components.flatMap((component) =>
      index.sources(`component ${component.id}`, component.sourceIds),
    ),
    ...dataset.measurements.flatMap((measurement) => {
      const where = `measurement ${measurement.id}`;
      return [
        ...index.sources(where, measurement.sourceIds),
        ...index.subject(where, measurement.subject, true),
      ];
    }),
    ...dataset.contextClaims.flatMap((claim) => {
      const where = `context claim ${claim.id}`;
      return [
        ...index.sources(where, claim.sourceIds),
        ...index.subject(where, claim.subject, true),
      ];
    }),
    ...dataset.derivedClaims.flatMap((claim) => [
      ...claim.inputMeasurementIds
        .filter((id) => !measurementsById.has(id))
        .map((id): ValidationIssue => ({
          severity: 'error',
          code: 'unknown-measurement',
          where: `derived claim ${claim.id}`,
          message: `references measurement "${id}", which does not exist`,
        })),
      // A constant is a claim about hardware like any other, so it is held to the
      // same standard: it cites sources, and those sources have to exist.
      ...(claim.constants ?? []).flatMap((constant) =>
        index.sources(`derived claim ${claim.id}, constant ${constant.id}`, constant.sourceIds),
      ),
    ]),
    ...dataset.conflicts.flatMap((conflict) => {
      const where = `conflict ${conflict.id}`;
      return [
        ...conflict.candidates.flatMap((candidate) => index.sources(where, candidate.sourceIds)),
        ...index.subject(where, conflict.subject, false),
      ];
    }),
  ];
}

function checkConfigurationReferences(
  system: System,
  index: ReferenceIndex,
  measurementsById: ReadonlyMap<string, Measurement>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const configuration of system.configurations) {
    for (const entry of configuration.entries) {
      if (!index.hasComponent(entry.componentId)) {
        issues.push({
          severity: 'error',
          code: 'unknown-component',
          where: `system ${system.id}, configuration ${configuration.id}`,
          message: `references component "${entry.componentId}", which does not exist`,
        });
      }
      const where = `system ${system.id}, configuration ${configuration.id}, component ${entry.componentId}`;
      const seen = new Set<string>();
      for (const measurementId of entry.measurementIds) {
        if (seen.has(measurementId)) {
          issues.push({
            severity: 'error',
            code: 'duplicate-configuration-measurement',
            where,
            message: `lists measurement "${measurementId}" more than once`,
          });
        }
        seen.add(measurementId);
        issues.push(
          ...checkEntryMeasurement(
            measurementsById.get(measurementId),
            measurementId,
            { system, configurationId: configuration.id, entry },
            where,
          ),
        );
      }
    }
  }
  return issues;
}

/** The device scopes a figure attached to a fitted part may have, given that part's role. */
function scopesForRole(role: ConfigurationEntry['role']): readonly string[] {
  if (role === 'gpu' || role === 'storage') {
    return [role];
  }
  return role.includes('memory') || role === 'cache' ? ['memory', 'whole-system'] : ['cpu'];
}

/**
 * A figure shown for a fitted part must exist and describe either that part or
 * this machine (in this variant). A machine-level figure must also have the
 * scope the part's role implies.
 */
function checkEntryMeasurement(
  measurement: Measurement | undefined,
  measurementId: string,
  fitted: { system: System; configurationId: string; entry: ConfigurationEntry },
  where: string,
): ValidationIssue[] {
  if (measurement === undefined) {
    return [
      {
        severity: 'error',
        code: 'unknown-configuration-measurement',
        where,
        message: `references measurement "${measurementId}", which does not exist`,
      },
    ];
  }
  const { subject } = measurement;
  const belongsToSystem =
    subject.kind === 'system' &&
    subject.id === fitted.system.id &&
    (subject.configurationId === undefined || subject.configurationId === fitted.configurationId);
  const belongsToComponent =
    subject.kind === 'component' && subject.id === fitted.entry.componentId;
  if (!belongsToSystem && !belongsToComponent) {
    return [
      {
        severity: 'error',
        code: 'configuration-measurement-subject-mismatch',
        where,
        message: `measurement "${measurementId}" belongs to another system, variant or component`,
      },
    ];
  }
  if (belongsToSystem && !scopesForRole(fitted.entry.role).includes(measurement.scope)) {
    return [
      {
        severity: 'error',
        code: 'configuration-measurement-scope-mismatch',
        where,
        message: `measurement "${measurementId}" has ${measurement.scope} scope, which does not match the ${fitted.entry.role} role`,
      },
    ];
  }
  return [];
}

/**
 * The prose a reader meets as narrative, rather than as a note attached to a
 * figure. A summary or description is read as a sentence about the machine; a
 * caveat, condition or absence note is read as commentary on a record, and may
 * name an absence freely.
 */
const NARRATIVE_FIELD = /\.(summary|description)$/;

/** Numerical prose must point back to the record that owns and sources the value. */
function checkEditorialText(dataset: ParsedDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { measurements, contextClaims } = markerTargets(dataset);
  const summaryQuantities = configurationQuantities(dataset.systems, measurements);

  for (const field of editorialTextFields(dataset)) {
    const references = referencesIn(field.text);
    const completeTokens = references.map((reference) => reference.token).join('');
    const markerText = [...field.text.matchAll(/\{\{[^{}]*\}\}/g)]
      .map((match) => match[0])
      .join('');
    if (containsMarker(field.text) && markerText !== completeTokens) {
      issues.push({
        severity: 'error',
        code: 'unresolved-editorial-marker',
        where: field.where,
        message: 'contains a malformed or unsupported editorial reference marker',
      });
    }

    for (const reference of references) {
      const record =
        reference.kind === 'measurement'
          ? measurements.get(reference.id)
          : contextClaims.get(reference.id);
      issues.push(...checkEditorialReference(field, reference, record, summaryQuantities));
    }

    if (containsRawQuantity(field.text)) {
      issues.push({
        severity: 'error',
        code: 'raw-quantity-in-prose',
        where: field.where,
        message:
          'contains a directly written number with a registered unit or controlled quantity noun',
      });
    }
  }

  return issues;
}

/** The quantities each system's configuration already states through a measurement. */
function configurationQuantities(
  systems: readonly System[],
  measurements: ReadonlyMap<string, Measurement>,
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    systems.map((system) => {
      const quantities = system.configurations
        .flatMap((configuration) => configuration.entries.flatMap((entry) => entry.measurementIds))
        .map((id) => {
          const measurement = measurements.get(id);
          return measurement === undefined ? undefined : getMetric(measurement.metric)?.quantity;
        })
        .filter((quantity) => quantity !== undefined);
      return [system.id, new Set<string>(quantities)];
    }),
  );
}

function checkEditorialReference(
  field: EditorialTextField,
  reference: EditorialReference,
  record: Measurement | ContextClaim | undefined,
  summaryQuantities: ReadonlyMap<string, ReadonlySet<string>>,
): ValidationIssue[] {
  if (record === undefined) {
    return [
      {
        severity: 'error',
        code: 'unknown-editorial-reference',
        where: field.where,
        message: `references ${reference.kind} "${reference.id}", which does not exist`,
      },
    ];
  }
  const issues: ValidationIssue[] = [];
  // A marker is a slot, and prose is written expecting it to fill. When the
  // referenced figure is absent, `formatQuantity` substitutes its absence
  // label and the sentence survives the build reading "the RAM and ROM
  // capacities are unknown and unknown". The existing marker guards catch
  // only a marker that failed to *resolve*; this one catches a marker that
  // resolved to an absence label. Narrative fields only, such as a caveat or an
  // absence note is where naming an absence belongs.
  if (
    reference.kind === 'measurement' &&
    record.quantity.state !== 'value' &&
    NARRATIVE_FIELD.test(field.where)
  ) {
    issues.push({
      severity: 'error',
      code: 'absence-marker-in-prose',
      where: field.where,
      message:
        `references measurement "${record.id}", which is ${record.quantity.state}; ` +
        'narrative prose may not resolve to an absence label. Write a sentence that does ' +
        'not need the figure, or state the figure.',
    });
  }
  if (reference.kind === 'context' && shadowsMeasurement(field, record, summaryQuantities)) {
    issues.push({
      severity: 'error',
      code: 'context-claim-shadows-measurement',
      where: field.where,
      message:
        `references context claim "${record.id}" for a quantity already represented by a ` +
        'formal configuration measurement; the summary must reference that measurement',
    });
  }
  if (!subjectMayBeReferenced(field, record)) {
    issues.push({
      severity: 'error',
      code: 'editorial-reference-subject-mismatch',
      where: field.where,
      message: `references ${reference.kind} "${reference.id}", which belongs to another subject or variant`,
    });
  }
  return issues;
}

/** A system summary quoting a context claim for a quantity its configuration already measures. */
function shadowsMeasurement(
  field: EditorialTextField,
  record: Measurement | ContextClaim,
  summaryQuantities: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (record.quantity.state !== 'value' || field.subject?.kind !== 'system') {
    return false;
  }
  if (field.where !== `system ${field.subject.id}.summary`) {
    return false;
  }
  const quantity = quantityOf(record.quantity.unit) ?? '__unknown__';
  return summaryQuantities.get(field.subject.id)?.has(quantity) === true;
}

/** Prose may name its own subject's records, and those of subjects it explicitly allows. */
function subjectMayBeReferenced(
  field: EditorialTextField,
  record: Measurement | ContextClaim,
): boolean {
  if (field.subject === undefined || sameSubject(record, field.subject)) {
    return true;
  }
  const allowed = field.allowedSubjectKeys;
  const referenceKey = `${record.subject.kind}:${record.subject.id}`;
  const exactReferenceKey =
    record.subject.configurationId === undefined
      ? referenceKey
      : `${referenceKey}:${record.subject.configurationId}`;
  return (
    allowed?.has(exactReferenceKey) === true ||
    (record.subject.configurationId === undefined && allowed?.has(referenceKey) === true) ||
    allowed?.has(`${referenceKey}:*`) === true
  );
}

/**
 * Images: the right to publish the file, the honesty of the transformation, and
 * the file itself.
 *
 * A photograph is the one thing this project republishes rather than merely
 * cites, so the license is checked the way a figure's sourcing is: against a
 * closed registry, with the canonical deed URL and the statement that ties the
 * license to this file and no other. The rest is arithmetic, a recipe that
 * neither stretches nor invents pixels, and a file whose bytes are the bytes
 * the record says they are.
 */
function checkImages(
  dataset: ParsedDataset,
  files: ReadonlyMap<string, ImageFileReading> | undefined,
): ValidationIssue[] {
  const imagesById = new Map(dataset.images.map((image) => [image.id, image]));
  const referencedBy = new Map<string, string[]>();
  for (const system of dataset.systems) {
    for (const imageId of system.imageIds ?? []) {
      referencedBy.set(imageId, [...(referencedBy.get(imageId) ?? []), system.id]);
    }
  }

  return [
    ...dataset.systems.flatMap((system) => checkSystemImageList(system, imagesById)),
    ...[...referencedBy]
      .filter(([, holders]) => holders.length > 1)
      .map(([imageId, holders]): ValidationIssue => ({
        severity: 'error',
        code: 'duplicate-image-reference',
        where: `image ${imageId}`,
        message: `is used by more than one system (${holders.toSorted().join(', ')})`,
      })),
    ...dataset.images.flatMap((image) => [
      ...checkImageRecord(image, referencedBy.has(image.id)),
      ...(files === undefined ? [] : checkImageFile(image, files.get(image.id))),
    ]),
  ];
}

function checkSystemImageList(
  system: System,
  imagesById: ReadonlyMap<string, ImageAsset>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const imageIds = system.imageIds ?? [];
  for (const imageId of imageIds) {
    if (!imagesById.has(imageId)) {
      issues.push({
        severity: 'error',
        code: 'unknown-image',
        where: `system ${system.id}`,
        message: `references image "${imageId}", which does not exist`,
      });
    }
  }
  const seen = new Set<string>();
  for (const imageId of imageIds) {
    if (seen.has(imageId)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-image-reference',
        where: `system ${system.id}`,
        message:
          `lists image "${imageId}" more than once. The order of this list is the editorial ` +
          'order of a gallery, so a repeat is a mistake rather than an emphasis.',
      });
    }
    seen.add(imageId);
  }
  return issues;
}

/** What an image record states: its terms, its credit and its recipe. */
function checkImageRecord(image: ImageAsset, referenced: boolean): ValidationIssue[] {
  const where = `image ${image.id}`;
  const issues: ValidationIssue[] = [];

  if (!referenced) {
    issues.push({
      severity: 'warning',
      code: 'unused-image',
      where,
      message: 'is not referenced by any system, so nothing publishes it',
    });
  }

  issues.push(...checkImageRights(image, where));

  for (const reason of checkTransformRecipe(image.transform)) {
    issues.push({
      severity: 'error',
      code: reason,
      where,
      message: `the "${image.transform.preset}" recipe is not admissible: ${reason}`,
    });
  }

  if (
    image.transform.sourceWidth !== image.original.width ||
    image.transform.sourceHeight !== image.original.height
  ) {
    issues.push({
      severity: 'error',
      code: 'image-transform-source-mismatch',
      where,
      message:
        `the recipe was planned against ${image.transform.sourceWidth}×${image.transform.sourceHeight}, ` +
        `but the original is ${image.original.width}×${image.original.height}`,
    });
  }

  if (image.canonical.byteLength > CANONICAL_MAX_BYTES) {
    issues.push({
      severity: 'error',
      code: 'image-too-large',
      where,
      message:
        `the canonical file is ${image.canonical.byteLength} bytes, over the ` +
        `${CANONICAL_MAX_BYTES} byte limit`,
    });
  }
  return issues;
}

function checkImageRights(image: ImageAsset, where: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rights = getImageRights(image.rights.id);
  if (rights === undefined) {
    issues.push({
      severity: 'error',
      code: 'unknown-image-rights',
      where,
      message: `"${image.rights.id}" is not in the image rights registry`,
    });
  } else if (image.rights.url !== rights.url) {
    issues.push({
      severity: 'error',
      code: 'image-rights-url-mismatch',
      where,
      message:
        `cites ${image.rights.url} for ${rights.id}; the canonical statement of those terms ` +
        `is ${rights.url}`,
    });
  }

  // Every image names its creator, whether or not the terms oblige it to.
  // Under a public domain release nobody can make us, which is precisely why
  // the rule belongs to this project rather than to the license: a catalog
  // that publishes somebody's photograph says whose it is.
  if (!image.attribution.includes(image.creator)) {
    issues.push({
      severity: 'error',
      code: 'image-attribution-missing',
      where,
      message: `the credit line does not name "${image.creator}"`,
    });
  }

  // The terms must be stated where the file is, not somewhere on the site
  // that hosts it. A footer licenses a website; this project needs the file.
  if (
    image.rights.statedAt !== image.sourcePageUrl &&
    image.rights.statedAt !== image.originalUrl
  ) {
    issues.push({
      severity: 'error',
      code: 'image-rights-not-on-source-page',
      where,
      message:
        `states its terms at ${image.rights.statedAt}, which is neither the file's source page ` +
        'nor the file itself, so nothing ties those terms to this image in particular',
    });
  }
  return issues;
}

/** The stored file against what its record says the bytes are. */
function checkImageFile(
  image: ImageAsset,
  reading: ImageFileReading | undefined,
): ValidationIssue[] {
  const where = `image ${image.id}`;
  if (reading === undefined) {
    return [
      {
        severity: 'error',
        code: 'image-file-missing',
        where,
        message: 'has no canonical file; run pnpm data:images',
      },
    ];
  }
  if (!reading.ok) {
    return [
      {
        severity: 'error',
        code: `image-${reading.reason}`,
        where,
        message:
          reading.reason === 'not-avif'
            ? 'the stored file is not AVIF; the preset stores exactly one format'
            : 'the stored file carries no readable image dimensions',
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  const facts = reading.facts;
  if (facts.width !== image.canonical.width || facts.height !== image.canonical.height) {
    issues.push({
      severity: 'error',
      code: 'image-dimensions-mismatch',
      where,
      message:
        `the stored file is ${facts.width}×${facts.height}, but the record states ` +
        `${image.canonical.width}×${image.canonical.height}`,
    });
  }
  if (facts.byteLength !== image.canonical.byteLength) {
    issues.push({
      severity: 'error',
      code: 'image-byte-length-mismatch',
      where,
      message: `the stored file is ${facts.byteLength} bytes; the record states ${image.canonical.byteLength}`,
    });
  }
  if (facts.sha256 !== image.canonical.sha256) {
    issues.push({
      severity: 'error',
      code: 'image-hash-mismatch',
      where,
      message:
        'the stored file does not match its recorded hash. Re-run pnpm data:images, or ' +
        'establish why the bytes changed before recording the new digest.',
    });
  }
  return issues;
}

/** Metric, unit, scope and benchmark must agree, and the normalized twin must be present. */
function checkMeasurementFacets(dataset: ParsedDataset): ValidationIssue[] {
  return dataset.measurements.flatMap((measurement) =>
    measurement.quantity.state === 'value'
      ? checkStatedFacets(measurement)
      : checkAbsentFacets(measurement),
  );
}

function facetIssues(
  measurement: Measurement,
  reasons: readonly string[],
  where: string,
): ValidationIssue[] {
  return reasons.map((reason) => ({
    severity: 'error',
    code: reason,
    where,
    message: `metric "${measurement.metric}" rejects this measurement: ${reason}`,
  }));
}

function checkAbsentFacets(measurement: Measurement): ValidationIssue[] {
  const where = `measurement ${measurement.id}`;
  // Checked for absent figures too: an absence still declares a comparability
  // group, and that group is how "this machine states no clock" reaches the
  // same row as the machines that do.
  //
  // A benchmark identifies a result, and an absence has none. Demanding one
  // would make a curator invent a benchmark version for a number that does
  // not exist to record that it does not exist.
  const reasons = checkGroupFacets({
    metric: measurement.metric,
    scope: measurement.scope,
    method: measurement.method,
    benchmark: measurement.benchmark,
  }).filter((reason) => reason !== 'benchmark-required');
  const issues = facetIssues(measurement, reasons, where);
  if (measurement.normalized !== undefined) {
    issues.push({
      severity: 'error',
      code: 'normalized-without-value',
      where,
      message: 'has no stated value but carries a normalized twin',
    });
  }
  return issues;
}

function checkStatedFacets(measurement: Measurement): ValidationIssue[] {
  const where = `measurement ${measurement.id}`;
  const issues = facetIssues(measurement, checkFacets(facetsOf(measurement)), where);

  if (measurement.normalized === undefined) {
    issues.push({
      severity: 'error',
      code: 'missing-normalized',
      where,
      message: 'has a stated value but no normalized twin; run pnpm data:normalize',
    });
  }

  // An estimate is somebody else's computation, and it is publishable only
  // when the computation is visible. Without the method and the extract that
  // carries the formula or the procedure, "estimated" is indistinguishable
  // from a number a curator liked the look of.
  if (measurement.status !== 'estimated') {
    return issues;
  }
  if (measurement.method !== 'estimate-from-formula') {
    issues.push({
      severity: 'error',
      code: 'estimate-without-method',
      where,
      message:
        'an estimated figure must use the "estimate-from-formula" method, so that it never ' +
        'sits in the same comparability group as a figure somebody measured or specified',
    });
  }
  if ((measurement.extractIds ?? []).length === 0) {
    issues.push({
      severity: 'error',
      code: 'estimate-without-procedure',
      where,
      message:
        'an estimated figure must name a research record carrying the formula or the ' +
        'procedure it was computed by; the sourcing threshold is the same as for any figure',
    });
  }
  return issues;
}

/** Checks that the declared evidence level matches the sources that state the number. */
function checkSourceSufficiency(dataset: ParsedDataset): ValidationIssue[] {
  const byId = new Map(dataset.sources.map((source) => [source.id, source]));

  const records: readonly (Measurement | ContextClaim)[] = [
    ...dataset.measurements.filter((measurement) => measurement.quantity.state === 'value'),
    ...dataset.contextClaims,
  ];

  return records.flatMap((record) => {
    const kind = 'metric' in record ? 'measurement' : 'context claim';
    const where = `${kind} ${record.id}`;
    const sources = record.sourceIds
      .map((id) => byId.get(id))
      .filter((source): source is Source => source !== undefined);
    return checkSourceTiers(record, sources, where).concat(
      checkReducedEvidence(record, sources, where),
      sources.filter((source) => !isRecheckable(source)).map(unverifiableSource),
    );
  });
}

function isRecheckable(source: Source): boolean {
  return (
    source.url !== undefined || source.archiveUrl !== undefined || source.extract !== undefined
  );
}

function unverifiableSource(source: Source): ValidationIssue {
  return {
    severity: 'warning',
    code: 'unverifiable-source',
    where: `source ${source.id}`,
    message: 'has neither a URL, an archive URL nor a stored extract, so it cannot be re-checked',
  };
}

/** Each evidence level needs sources of the tiers that can carry it, and no others. */
function checkSourceTiers(
  record: Measurement | ContextClaim,
  sources: readonly Source[],
  where: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tierA = sources.filter((source) => source.tier === 'A');
  const tierB = sources.filter((source) => source.tier === 'B');
  const tierC = sources.filter((source) => source.tier === 'C');
  const independentTierB = new Set(tierB.map((source) => source.publisher)).size;

  if (record.evidenceLevel === 'confirmed' && tierA.length === 0 && independentTierB < 2) {
    issues.push({
      severity: 'error',
      code: 'insufficient-sourcing',
      where,
      message:
        'a confirmed number needs one tier A source or two agreeing tier B sources from ' +
        `different publishers; found ${tierA.length} tier A and ${independentTierB} independent tier B`,
    });
  }

  if (record.evidenceLevel === 'reported' && tierB.length === 0) {
    issues.push({
      severity: 'error',
      code: 'reported-without-tier-b',
      where,
      message: 'a reported number needs at least one tier B source',
    });
  }

  if (record.evidenceLevel === 'rumored' && tierC.length === 0) {
    issues.push({
      severity: 'error',
      code: 'rumor-without-tier-c',
      where,
      message: 'a rumored number needs at least one tier C source that states it',
    });
  }

  return issues;
}

/**
 * A reported or rumored number stays provisional and must be re-checkable
 * exactly; a tier C source may support nothing else.
 */
function checkReducedEvidence(
  record: Measurement | ContextClaim,
  sources: readonly Source[],
  where: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const reduced = record.evidenceLevel === 'reported' || record.evidenceLevel === 'rumored';
  const exactEvidence =
    sources.some((source) => source.locator.length > 0 && isRecheckable(source)) ||
    (record.extractIds ?? []).length > 0;

  if (reduced && record.editorialStatus !== 'provisional') {
    issues.push({
      severity: 'error',
      code: 'reduced-evidence-approved',
      where,
      message: `${record.evidenceLevel} numbers must remain provisional`,
    });
  }

  if (reduced && !exactEvidence) {
    issues.push({
      severity: 'error',
      code: 'reduced-evidence-without-extract',
      where,
      message:
        `${record.evidenceLevel} numbers need an exact locator and a re-checkable citation ` +
        'or research record',
    });
  }

  if (record.evidenceLevel !== 'rumored' && sources.some((source) => source.tier === 'C')) {
    issues.push({
      severity: 'error',
      code: 'tier-c-on-non-rumor',
      where,
      message: 'tier C sources may support only numbers marked rumored',
    });
  }
  return issues;
}

/**
 * One subject may state a quantity once per comparability group.
 *
 * Two *values* in one slot are a conflict, and a conflict is decided in the
 * ledger with evidence and a written rationale, never by a display rule
 * quietly preferring one of them.
 *
 * An absence beside a value is also a contradiction. `unknown` is the catalog's
 * conclusion after checking every allowed source route, not a record of one
 * publisher's silence.
 */
function checkDuplicateFigures(dataset: ParsedDataset): ValidationIssue[] {
  const slots = new Map<string, { stated: string[]; absent: string[] }>();
  const issues: ValidationIssue[] = [];

  for (const measurement of dataset.measurements) {
    const key = [
      measurement.subject.kind,
      measurement.subject.id,
      measurement.subject.configurationId ?? '-',
      // Two parts of one record answering the same question differently are two
      // figures, not a conflict: an M1's performance cores and its efficiency
      // cores both have a clock and neither disputes the other's.
      measurement.subject.part ?? '-',
      measurement.metric,
      measurement.comparabilityGroup,
    ].join('|');

    const slot = slots.get(key) ?? { stated: [], absent: [] };
    (measurement.quantity.state === 'value' ? slot.stated : slot.absent).push(measurement.id);
    slots.set(key, slot);
  }

  for (const slot of slots.values()) {
    for (const id of slot.stated.slice(1)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-figure',
        where: `measurement ${id}`,
        message:
          `states a second value for the same subject, metric and comparability group as ` +
          `"${slot.stated[0]}". Competing values belong in the conflict ledger, where one is ` +
          'chosen with a written rationale, not in two measurements.',
      });
    }
    for (const id of slot.absent.slice(1)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-absence',
        where: `measurement ${id}`,
        message: `records the same absence as "${slot.absent[0]}" for one subject and group`,
      });
    }
    if (slot.stated.length > 0 && slot.absent.length > 0) {
      issues.push({
        severity: 'error',
        code: 'value-with-absence',
        where: `measurement ${slot.absent[0]}`,
        message: `records an absence in the same slot as stated value "${slot.stated[0]}"`,
      });
    }
  }

  return issues;
}

/** Every derived claim must recompute to exactly the stored result. */
function checkDerivedClaims(dataset: ParsedDataset): ValidationIssue[] {
  const byId = new Map(dataset.measurements.map((measurement) => [measurement.id, measurement]));
  return dataset.derivedClaims.flatMap((claim) => checkDerivedClaim(claim, byId));
}

function checkDerivedClaim(
  claim: DerivedClaim,
  byId: ReadonlyMap<string, Measurement>,
): ValidationIssue[] {
  const where = `derived claim ${claim.id}`;
  const formula = getFormula(claim.formula.id, claim.formula.version);
  if (formula === undefined) {
    return [
      {
        severity: 'error',
        code: 'unknown-formula',
        where,
        message: `formula "${claim.formula.id}@${claim.formula.version}" is not in the registry`,
      },
    ];
  }

  const inputs = derivedInputs(claim, byId);
  if (inputs === undefined) {
    return [
      {
        severity: 'error',
        code: 'unusable-derived-input',
        where,
        message: 'an input measurement is missing or has no stated value',
      },
    ];
  }

  if (!acceptsInputCount(formula, inputs.length)) {
    return [
      {
        severity: 'error',
        code: 'formula-arity',
        where,
        message: `formula ${formula.id} takes ${arityText(formula)} inputs, got ${inputs.length}`,
      },
    ];
  }

  return [
    ...checkDerivedConfidence(claim, byId, where),
    ...checkExclusions(claim, byId, where),
    ...checkRecomputation(claim, formula, inputs, where),
  ];
}

/** The claim's inputs as the formula takes them, or `undefined` if one is missing or absent. */
function derivedInputs(
  claim: DerivedClaim,
  byId: ReadonlyMap<string, Measurement>,
): FormulaInput[] | undefined {
  const inputs: FormulaInput[] = [];
  for (const id of claim.inputMeasurementIds) {
    const measurement = byId.get(id);
    if (measurement === undefined || measurement.quantity.state !== 'value') {
      return undefined;
    }
    const normalized = measurement.normalized ?? normalizeQuantity(measurement.quantity);
    inputs.push({
      facets: facetsOf(measurement),
      value: normalized.value,
      significantDigits: normalized.significantDigits,
    });
  }
  return inputs;
}

function arityText(formula: FormulaDefinition): string {
  const { min, max } = formula.arity;
  if (max === null) {
    return `at least ${min}`;
  }
  return min === max ? `${min}` : `${min}–${max}`;
}

/**
 * A computation is only as approved as what it was computed from. The
 * formula no longer refuses provisional inputs. A total of two announced
 * figures is a legitimate announced total, so the confidence has to travel
 * here instead, or an announcement would launder itself into an approved
 * figure by being added up.
 */
function checkDerivedConfidence(
  claim: DerivedClaim,
  byId: ReadonlyMap<string, Measurement>,
  where: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const provisionalInputs = claim.inputMeasurementIds.filter(
    (id) => byId.get(id)?.editorialStatus === 'provisional',
  );
  const reducedEvidenceInputs = claim.inputMeasurementIds.filter((id) => {
    const level = byId.get(id)?.evidenceLevel;
    return level === 'reported' || level === 'rumored';
  });
  if (reducedEvidenceInputs.length > 0) {
    issues.push({
      severity: 'error',
      code: 'derived-from-reduced-evidence',
      where,
      message:
        `uses reported or rumored input(s) ${reducedEvidenceInputs.join(', ')}. ` +
        'Those numbers may be displayed but may not produce a new number.',
    });
  }
  if (provisionalInputs.length > 0 && claim.editorialStatus !== 'provisional') {
    issues.push({
      severity: 'error',
      code: 'derived-from-provisional',
      where,
      message:
        `is approved but computes from provisional input(s) ${provisionalInputs.join(', ')}. ` +
        'A result cannot be more certain than what it was computed from.',
    });
  }
  return issues;
}

function checkExclusions(
  claim: DerivedClaim,
  byId: ReadonlyMap<string, Measurement>,
  where: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const exclusion of claim.exclusions ?? []) {
    if (!byId.has(exclusion.measurementId)) {
      issues.push({
        severity: 'error',
        code: 'unknown-measurement',
        where,
        message: `excludes measurement "${exclusion.measurementId}", which does not exist`,
      });
    }
    if (claim.inputMeasurementIds.includes(exclusion.measurementId)) {
      issues.push({
        severity: 'error',
        code: 'excluded-input',
        where,
        message: `measurement "${exclusion.measurementId}" is both an input and an exclusion`,
      });
    }
  }
  return issues;
}

/** The stored value, unit and caveat against what the formula computes now. */
function checkRecomputation(
  claim: DerivedClaim,
  formula: FormulaDefinition,
  inputs: readonly FormulaInput[],
  where: string,
): ValidationIssue[] {
  if (claim.result.state !== 'value') {
    return [
      {
        severity: 'error',
        code: 'derived-without-value',
        where,
        message: 'a derived claim must carry a computed value',
      },
    ];
  }

  const outcome = formula.compute(inputs, {
    significantDigits: claim.result.significantDigits,
    rounding: claim.rounding,
    exclusions: claim.exclusions,
    constants: claim.constants,
  });
  if (!outcome.ok) {
    return [
      {
        severity: 'error',
        code: 'formula-refused',
        where,
        message: `the formula refuses these inputs: ${outcome.reasons.join(', ')}`,
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  if (compareDecimal(parseDecimal(outcome.result.value), parseDecimal(claim.result.value)) !== 0) {
    issues.push({
      severity: 'error',
      code: 'derived-mismatch',
      where,
      message: `stored result ${claim.result.value} does not match the recomputed ${outcome.result.value}`,
    });
  }
  if (outcome.result.unit !== claim.result.unit) {
    issues.push({
      severity: 'error',
      code: 'derived-unit-mismatch',
      where,
      message: `stored unit ${claim.result.unit} does not match the computed ${outcome.result.unit}`,
    });
  }
  // The caveat is generated from the inputs precisely so it cannot fall out of
  // step with them. A hand-written one would survive a change of inputs.
  if (outcome.result.caveat !== claim.caveat) {
    issues.push({
      severity: 'error',
      code: 'derived-caveat-mismatch',
      where,
      message:
        'the stored caveat is not the one the formula generates for these inputs. ' +
        `Replace it with: ${outcome.result.caveat}`,
    });
  }
  return issues;
}

/**
 * A figure this project computed must still say what its claim says.
 *
 * The claim is recomputed from its inputs on every run, so pinning the figure to
 * it means a total can never drift from the pools it adds up: change a pool and
 * either the claim stops recomputing or the figure stops matching.
 */
function checkDerivedFigures(dataset: ParsedDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claimsById = new Map(dataset.derivedClaims.map((claim) => [claim.id, claim]));

  for (const measurement of dataset.measurements) {
    if (measurement.derivedFrom === undefined) {
      continue;
    }
    const where = `measurement ${measurement.id}`;
    const claim = claimsById.get(measurement.derivedFrom);
    if (claim === undefined) {
      issues.push({
        severity: 'error',
        code: 'unknown-derived-claim',
        where,
        message: `carries derived claim "${measurement.derivedFrom}", which does not exist`,
      });
      continue;
    }

    if (measurement.quantity.state !== 'value' || claim.result.state !== 'value') {
      issues.push({
        severity: 'error',
        code: 'derived-figure-without-value',
        where,
        message: 'a figure carrying a derived claim must state the computed value',
      });
      continue;
    }

    // Compared through the normalized twins, because the claim computes in the
    // quantity's base unit and the figure is written in the unit a reader wants.
    const normalized = measurement.normalized ?? normalizeQuantity(measurement.quantity);
    const claimResult = normalizeQuantity(claim.result);
    if (
      normalized.unit !== claimResult.unit ||
      compareDecimal(parseDecimal(normalized.value), parseDecimal(claimResult.value)) !== 0
    ) {
      issues.push({
        severity: 'error',
        code: 'derived-figure-mismatch',
        where,
        message:
          `states ${normalized.value} ${normalized.unit}, but claim "${claim.id}" computes ` +
          `${claimResult.value} ${claimResult.unit}`,
      });
    }

    if (measurement.editorialStatus === 'approved' && claim.editorialStatus !== 'approved') {
      issues.push({
        severity: 'error',
        code: 'derived-figure-provisional-claim',
        where,
        message: `is approved but carries provisional claim "${claim.id}"`,
      });
    }
  }

  return issues;
}

function checkConflicts(dataset: ParsedDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const conflict of dataset.conflicts) {
    const where = `conflict ${conflict.id}`;
    if (
      conflict.decision.outcome === 'accepted' &&
      conflict.decision.candidateIndex >= conflict.candidates.length
    ) {
      issues.push({
        severity: 'error',
        code: 'conflict-decision-out-of-range',
        where,
        message: `accepted candidate ${conflict.decision.candidateIndex} does not exist`,
      });
    }
    if (conflict.decision.outcome === 'unresolved') {
      issues.push({
        severity: 'warning',
        code: 'conflict-unresolved',
        where,
        message: 'is still unresolved; figures for this subject stay provisional',
      });
    }
  }

  return issues;
}

/**
 * Sources that no adapter can read. A figure taken from one of these must be
 * backed by a research record: an exact locator plus a verbatim extract, so the
 * reading can be checked without re-acquiring the document.
 */
const DOCUMENT_SOURCE_TYPES = new Set([
  'government-document',
  'technical-manual',
  'book',
  'periodical',
]);

function checkResearchRecords(dataset: ParsedDataset): ValidationIssue[] {
  const sourcesById = new Map(dataset.sources.map((source) => [source.id, source]));
  const recordsById = new Map(dataset.extracts.map((record) => [record.id, record]));

  const numericalRecords: readonly (Measurement | ContextClaim)[] = [
    ...dataset.measurements,
    ...dataset.contextClaims,
  ];
  return [
    ...dataset.extracts.flatMap((record) => checkExtract(record, sourcesById)),
    ...numericalRecords.flatMap((numericalRecord) => {
      const recordKind = 'metric' in numericalRecord ? 'measurement' : 'context claim';
      const where = `${recordKind} ${numericalRecord.id}`;
      return checkCitedExtracts(numericalRecord, recordsById, where).concat(
        'metric' in numericalRecord
          ? checkDocumentExtracts(numericalRecord, sourcesById, recordsById, where)
          : [],
      );
    }),
  ];
}

function checkExtract(
  record: ResearchRecord,
  sourcesById: ReadonlyMap<string, Source>,
): ValidationIssue[] {
  const where = `research record ${record.id}`;
  if (!sourcesById.has(record.sourceId)) {
    return [
      {
        severity: 'error',
        code: 'unknown-source',
        where,
        message: `references source "${record.sourceId}", which does not exist`,
      },
    ];
  }
  // A transcription that no longer matches its hash has been edited or
  // corrupted since it was reviewed, so it cannot be trusted as evidence.
  if (sha256Hex(record.extract) !== record.extractHash) {
    return [
      {
        severity: 'error',
        code: 'extract-hash-mismatch',
        where,
        message: 'the extract does not match its recorded hash; re-transcribe and re-hash it',
      },
    ];
  }
  return [];
}

/**
 * A cited extract must exist and must belong to a source this figure cites,
 * otherwise the number points at evidence for something else.
 */
function checkCitedExtracts(
  numericalRecord: Measurement | ContextClaim,
  recordsById: ReadonlyMap<string, ResearchRecord>,
  where: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const extractId of numericalRecord.extractIds ?? []) {
    const record = recordsById.get(extractId);
    if (record === undefined) {
      issues.push({
        severity: 'error',
        code: 'unknown-research-record',
        where,
        message: `references research record "${extractId}", which does not exist`,
      });
    } else if (!numericalRecord.sourceIds.includes(record.sourceId)) {
      issues.push({
        severity: 'error',
        code: 'extract-source-mismatch',
        where,
        message:
          `cites research record "${extractId}", which transcribes source ` +
          `"${record.sourceId}", a source this numerical record does not cite`,
      });
    }
  }
  return issues;
}

/**
 * An approved figure read from a document no adapter can parse must name the
 * research record it was read from.
 */
function checkDocumentExtracts(
  measurement: Measurement,
  sourcesById: ReadonlyMap<string, Source>,
  recordsById: ReadonlyMap<string, ResearchRecord>,
  where: string,
): ValidationIssue[] {
  if (measurement.quantity.state !== 'value' || measurement.editorialStatus !== 'approved') {
    return [];
  }
  const documents = measurement.sourceIds
    .map((sourceId) => sourcesById.get(sourceId))
    .filter(
      (source): source is Source =>
        source !== undefined &&
        DOCUMENT_SOURCE_TYPES.has(source.sourceType) &&
        source.adapter === undefined,
    );
  // The extract must be named by this measurement. A record merely existing
  // somewhere for the same document does not say which sentence this
  // particular figure was read from, and a long report has many.
  return documents
    .filter(
      (source) =>
        !(measurement.extractIds ?? []).some(
          (extractId) => recordsById.get(extractId)?.sourceId === source.id,
        ),
    )
    .map((source) => ({
      severity: 'error',
      code: 'missing-research-record',
      where,
      message:
        `cites "${source.id}", a ${source.sourceType} that no adapter reads, but names no ` +
        'research record carrying the extract and locator this figure was read from',
    }));
}

function facetsOf(measurement: Measurement): ComparabilityFacets {
  if (measurement.quantity.state !== 'value') {
    throw new Error(`measurement ${measurement.id} has no stated value`);
  }
  return {
    metric: measurement.metric,
    unit: measurement.quantity.unit,
    scope: measurement.scope,
    method: measurement.method,
    benchmark: measurement.benchmark,
    status: measurement.status,
    editorialStatus: measurement.editorialStatus,
  };
}
