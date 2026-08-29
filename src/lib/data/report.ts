// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Change report for data pull requests.
 *
 * A diff of canonical records is technically complete and practically unreadable.
 * This turns two dataset revisions into the four questions a reviewer actually
 * has: which figures moved, which sources changed, which confidence levels
 * shifted, and which derived results no longer hold.
 *
 * Pure, so it can be tested without git or a filesystem.
 */

import type { ParsedDataset } from './validate.ts';

export interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface ChangedRecord {
  readonly id: string;
  readonly changes: readonly FieldChange[];
}

export interface SectionDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly ChangedRecord[];
}

export interface DatasetDiff {
  readonly measurements: SectionDiff;
  readonly contextClaims: SectionDiff;
  readonly sources: SectionDiff;
  readonly images: SectionDiff;
  readonly derivedClaims: SectionDiff;
  readonly conflicts: SectionDiff;
}

export function diffDatasets(before: ParsedDataset, after: ParsedDataset): DatasetDiff {
  return {
    measurements: diffSection(before.measurements, after.measurements, measurementFields),
    contextClaims: diffSection(before.contextClaims, after.contextClaims, contextClaimFields),
    sources: diffSection(before.sources, after.sources, sourceFields),
    images: diffSection(before.images, after.images, imageFields),
    derivedClaims: diffSection(before.derivedClaims, after.derivedClaims, derivedClaimFields),
    conflicts: diffSection(before.conflicts, after.conflicts, conflictFields),
  };
}

export function isEmptyDiff(diff: DatasetDiff): boolean {
  return Object.values(diff).every(
    (section: SectionDiff) =>
      section.added.length === 0 && section.removed.length === 0 && section.changed.length === 0,
  );
}

/* -------------------------------------------------------------------------- */

type FieldExtractor<T> = (record: T) => Record<string, string>;

function diffSection<T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
  fields: FieldExtractor<T>,
): SectionDiff {
  const beforeById = new Map(before.map((record) => [record.id, record]));
  const afterById = new Map(after.map((record) => [record.id, record]));

  const added = after
    .filter((record) => !beforeById.has(record.id))
    .map((record) => record.id)
    .toSorted();
  const removed = before
    .filter((record) => !afterById.has(record.id))
    .map((record) => record.id)
    .toSorted();

  const changed: ChangedRecord[] = [];
  for (const [id, afterRecord] of [...afterById.entries()].toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const beforeRecord = beforeById.get(id);
    if (beforeRecord === undefined) {
      continue;
    }
    const beforeFields = fields(beforeRecord);
    const afterFields = fields(afterRecord);
    const changes = [...new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])]
      .toSorted()
      .filter((field) => beforeFields[field] !== afterFields[field])
      .map((field) => ({
        field,
        before: beforeFields[field] ?? '(absent)',
        after: afterFields[field] ?? '(absent)',
      }));
    if (changes.length > 0) {
      changed.push({ id, changes });
    }
  }

  return { added, removed, changed };
}

const measurementFields: FieldExtractor<ParsedDataset['measurements'][number]> = (measurement) => ({
  value:
    measurement.quantity.state === 'value'
      ? `${measurement.quantity.value} ${measurement.quantity.unit}`
      : measurement.quantity.state,
  significantDigits:
    measurement.quantity.state === 'value' ? String(measurement.quantity.significantDigits) : '—',
  normalized:
    measurement.normalized === undefined
      ? '—'
      : `${measurement.normalized.value} ${measurement.normalized.unit}`,
  confidence: measurement.status,
  editorialStatus: measurement.editorialStatus,
  comparabilityGroup: measurement.comparabilityGroup,
  sources: measurement.sourceIds.toSorted().join(', '),
});

const sourceFields: FieldExtractor<ParsedDataset['sources'][number]> = (source) => ({
  tier: source.tier,
  sourceType: source.sourceType,
  url: source.url ?? '(none)',
  archiveUrl: source.archiveUrl ?? '(none)',
  locator: source.locator,
  editorialStatus: source.editorialStatus,
  fetchedHash: source.fetch?.sha256.slice(0, 12) ?? '(never fetched)',
});

const contextClaimFields: FieldExtractor<ParsedDataset['contextClaims'][number]> = (claim) => ({
  value: `${claim.quantity.value} ${claim.quantity.unit}`,
  confidence: claim.status,
  editorialStatus: claim.editorialStatus,
  sources: claim.sourceIds.toSorted().join(', '),
});

/**
 * A reviewer of an image change has three questions and they are not the
 * questions a measurement raises: may we publish this, is it still the same
 * file, and what was done to it on the way in.
 */
const imageFields: FieldExtractor<ParsedDataset['images'][number]> = (image) => ({
  creator: image.creator,
  rights: image.rights.id,
  sourcePage: image.sourcePageUrl,
  originalHash: `${image.original.sha256.slice(0, 12)} (${image.original.byteLength} bytes)`,
  canonicalHash: `${image.canonical.sha256.slice(0, 12)} (${image.canonical.byteLength} bytes)`,
  transform:
    image.transform.region === undefined
      ? image.transform.fit
      : `${image.transform.fit} ${image.transform.region.width}×${image.transform.region.height}` +
        `+${image.transform.region.x}+${image.transform.region.y}`,
  alt: image.alt,
  editorialStatus: image.editorialStatus,
});

const derivedClaimFields: FieldExtractor<ParsedDataset['derivedClaims'][number]> = (claim) => ({
  formula: `${claim.formula.id}@${claim.formula.version}`,
  inputs: claim.inputMeasurementIds.join(', '),
  result:
    claim.result.state === 'value'
      ? `${claim.result.value} ${claim.result.unit}`
      : claim.result.state,
  rounding: claim.rounding,
  editorialStatus: claim.editorialStatus,
});

const conflictFields: FieldExtractor<ParsedDataset['conflicts'][number]> = (conflict) => ({
  metric: conflict.metric,
  candidates: String(conflict.candidates.length),
  outcome: conflict.decision.outcome,
  chosen:
    conflict.decision.outcome === 'accepted' ? String(conflict.decision.candidateIndex) : '(none)',
  decidedOn: conflict.decision.decidedOn,
});

/* -------------------------------------------------------------------------- */

/** Renders the diff as Markdown for a pull-request comment. */
export function renderReport(diff: DatasetDiff): string {
  if (isEmptyDiff(diff)) {
    return (
      '# Data change report\n\nNo changes to measurements, context claims, sources, images, derived claims or ' +
      'conflicts.\n'
    );
  }

  const sections = [
    renderSection('Measurements', diff.measurements),
    renderSection('Context claims', diff.contextClaims),
    renderSection('Sources', diff.sources),
    renderSection('Images', diff.images),
    renderSection('Derived claims', diff.derivedClaims),
    renderSection('Conflicts', diff.conflicts),
  ].filter((section) => section !== '');

  return `# Data change report\n\n${sections.join('\n')}`;
}

function renderSection(title: string, section: SectionDiff): string {
  if (section.added.length === 0 && section.removed.length === 0 && section.changed.length === 0) {
    return '';
  }

  const lines = [`## ${title}`, ''];

  if (section.added.length > 0) {
    lines.push(`### Added (${section.added.length})`, '');
    lines.push(...section.added.map((id) => `- \`${id}\``), '');
  }
  if (section.removed.length > 0) {
    lines.push(`### Removed (${section.removed.length})`, '');
    lines.push(...section.removed.map((id) => `- \`${id}\``), '');
  }
  if (section.changed.length > 0) {
    lines.push(`### Changed (${section.changed.length})`, '');
    for (const record of section.changed) {
      lines.push(`#### \`${record.id}\``, '', '| Field | Before | After |', '| --- | --- | --- |');
      lines.push(
        ...record.changes.map(
          (change) =>
            `| ${change.field} | ${escapeCell(change.before)} | ${escapeCell(change.after)} |`,
        ),
      );
      lines.push('');
    }
  }

  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|');
}
