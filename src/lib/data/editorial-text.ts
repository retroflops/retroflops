// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { formatQuantity } from '../display.ts';
import type { ContextClaim, Measurement, SubjectRef } from './schema.ts';
import { UNITS } from './units.ts';
import type { ParsedDataset } from './validate.ts';

export type EditorialReferenceKind = 'measurement' | 'context';

export interface EditorialReference {
  readonly kind: EditorialReferenceKind;
  readonly id: string;
  readonly token: string;
}

export interface EditorialTextField {
  readonly where: string;
  readonly text: string;
  readonly subject?: SubjectRef | undefined;
  /** A system's prose may cite figures for parts fitted to that system. */
  readonly allowedSubjectKeys?: ReadonlySet<string> | undefined;
}

const REFERENCE_PATTERN = /\{\{(measurement|context):([a-z0-9]+(?:[-:][a-z0-9]+)*)\}\}/g;
const ANY_MARKER_PATTERN = /\{\{[^{}]*\}\}/;

const CONTROLLED_NOUNS = [
  'bit',
  'bits',
  'byte',
  'bytes',
  'core',
  'cores',
  'thread',
  'threads',
  'shader',
  'shaders',
  'shading unit',
  'shading units',
  'render output unit',
  'render output units',
  'compute unit',
  'compute units',
  'transistor',
  'transistors',
  'word',
  'words',
] as const;

const UNIT_TERMS = [
  ...new Set(
    [...UNITS.values()].flatMap((unit) => [unit.id, unit.symbol]).filter((term) => term.length > 1),
  ),
]
  .toSorted((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');

const CONTROLLED_NOUN_TERMS = CONTROLLED_NOUNS.toSorted((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');

const NUMBER = String.raw`\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?`;
const RAW_UNIT_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}-])${NUMBER}[\s‑-]*(?:${UNIT_TERMS})(?=$|[^\p{L}\p{N}])`,
  'u',
);
const RAW_SINGLE_UNIT_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}-])${NUMBER}\s+(?:A|B|J|V|W|g|m|s)(?=$|[^\p{L}\p{N}])`,
  'u',
);
const RAW_NOUN_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}-])${NUMBER}[\s‑-]+(?:${CONTROLLED_NOUN_TERMS})(?=$|[^\p{L}\p{N}])`,
  'iu',
);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function referencesIn(text: string): readonly EditorialReference[] {
  return [...text.matchAll(REFERENCE_PATTERN)].map((match) => ({
    kind: match[1] as EditorialReferenceKind,
    id: match[2] ?? '',
    token: match[0],
  }));
}

export function containsMarker(text: string): boolean {
  return ANY_MARKER_PATTERN.test(text);
}

export function containsRawQuantity(text: string): boolean {
  return rawQuantitiesIn(text).length > 0;
}

export function rawQuantitiesIn(text: string): readonly string[] {
  const withoutReferences = text
    .replaceAll(REFERENCE_PATTERN, '')
    // Verbatim material is evidence, not authored prose. The surrounding prose
    // must still use references, but a short quoted source extract stays exact.
    .replace(/"[^"\n]*"|“[^”\n]*”/g, '')
    // Architecture revisions are model identifiers, not counts.
    .replace(/\b(?:RDNA|Zen)\s+\d+\b/g, '');
  return [RAW_UNIT_PATTERN, RAW_SINGLE_UNIT_PATTERN, RAW_NOUN_PATTERN].flatMap((pattern) =>
    [...withoutReferences.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map((match) =>
      (match[0] ?? '').trimStart(),
    ),
  );
}

/** All public, authored catalog prose. Source quotations and research extracts are excluded. */
export function editorialTextFields(dataset: ParsedDataset): readonly EditorialTextField[] {
  const fields: EditorialTextField[] = [];
  const add = (
    where: string,
    text: string | undefined,
    subject?: SubjectRef,
    allowedSubjectKeys?: ReadonlySet<string>,
  ): void => {
    if (text !== undefined) {
      fields.push({ where, text, subject, allowedSubjectKeys });
    }
  };

  for (const system of dataset.systems) {
    const subject = { kind: 'system', id: system.id } as const;
    const allowedSubjectKeys = new Set([
      `system:${system.id}`,
      `system:${system.id}:*`,
      ...system.configurations.flatMap((configuration) =>
        configuration.entries.map((entry) => `component:${entry.componentId}`),
      ),
    ]);
    add(`system ${system.id}.summary`, system.summary, subject, allowedSubjectKeys);
    add(`system ${system.id}.description`, system.description, subject, allowedSubjectKeys);
    add(`system ${system.id}.notes`, system.notes, subject, allowedSubjectKeys);
    for (const configuration of system.configurations) {
      const configurationSubject = { ...subject, configurationId: configuration.id };
      add(
        `system ${system.id}.configuration ${configuration.id}.notes`,
        configuration.notes,
        configurationSubject,
        new Set([
          `system:${system.id}`,
          `system:${system.id}:${configuration.id}`,
          ...configuration.entries.map((entry) => `component:${entry.componentId}`),
        ]),
      );
      for (const entry of configuration.entries) {
        add(
          `system ${system.id}.configuration ${configuration.id}.component ${entry.componentId}.notes`,
          entry.notes,
          { kind: 'component', id: entry.componentId },
          new Set([
            `system:${system.id}`,
            `system:${system.id}:${configuration.id}`,
            `component:${entry.componentId}`,
          ]),
        );
      }
    }
  }

  for (const component of dataset.components) {
    const subject = { kind: 'component', id: component.id } as const;
    add(`component ${component.id}.summary`, component.summary, subject);
    add(`component ${component.id}.notes`, component.notes, subject);
  }

  for (const measurement of dataset.measurements) {
    const allowedSubjectKeys =
      measurement.subject.kind === 'system'
        ? new Set(
            dataset.systems
              .find((system) => system.id === measurement.subject.id)
              ?.configurations.filter(
                (configuration) =>
                  measurement.subject.configurationId === undefined ||
                  configuration.id === measurement.subject.configurationId,
              )
              .flatMap((configuration) =>
                configuration.entries.map((entry) => `component:${entry.componentId}`),
              ) ?? [],
          )
        : undefined;
    add(
      `measurement ${measurement.id}.conditions`,
      measurement.conditions,
      measurement.subject,
      allowedSubjectKeys,
    );
    add(
      `measurement ${measurement.id}.caveat`,
      measurement.caveat,
      measurement.subject,
      allowedSubjectKeys,
    );
    if (measurement.quantity.state !== 'value') {
      add(
        `measurement ${measurement.id}.quantity.note`,
        measurement.quantity.note,
        measurement.subject,
        allowedSubjectKeys,
      );
    }
  }

  for (const claim of dataset.contextClaims) {
    add(`context claim ${claim.id}.caveat`, claim.caveat, claim.subject);
  }

  for (const claim of dataset.derivedClaims) {
    add(`derived claim ${claim.id}.caveat`, claim.caveat);
    for (const exclusion of claim.exclusions ?? []) {
      add(
        `derived claim ${claim.id}.exclusion ${exclusion.measurementId}.reason`,
        exclusion.reason,
      );
    }
    for (const constant of claim.constants ?? []) {
      add(`derived claim ${claim.id}.constant ${constant.id}.reason`, constant.reason);
    }
  }

  for (const conflict of dataset.conflicts) {
    for (const [index, candidate] of conflict.candidates.entries()) {
      add(
        `conflict ${conflict.id}.candidate ${index}.evidence`,
        candidate.evidence,
        conflict.subject,
      );
      if (candidate.quantity.state !== 'value') {
        add(
          `conflict ${conflict.id}.candidate ${index}.quantity.note`,
          candidate.quantity.note,
          conflict.subject,
        );
      }
    }
    add(
      `conflict ${conflict.id}.decision.rationale`,
      conflict.decision.rationale,
      conflict.subject,
    );
  }

  const imageSubjects = new Map<string, SubjectRef>();
  for (const system of dataset.systems) {
    for (const imageId of system.imageIds ?? []) {
      imageSubjects.set(imageId, { kind: 'system', id: system.id });
    }
  }
  for (const image of dataset.images) {
    const subject = imageSubjects.get(image.id);
    const allowedSubjectKeys =
      subject === undefined
        ? undefined
        : new Set([
            `system:${subject.id}`,
            `system:${subject.id}:*`,
            ...(dataset.systems
              .find((system) => system.id === subject.id)
              ?.configurations.flatMap((configuration) =>
                configuration.entries.map((entry) => `component:${entry.componentId}`),
              ) ?? []),
          ]);
    add(`image ${image.id}.alt`, image.alt, subject, allowedSubjectKeys);
    add(`image ${image.id}.caption`, image.caption, subject, allowedSubjectKeys);
    add(`image ${image.id}.transform.note`, image.transform.note, subject, allowedSubjectKeys);
  }

  return fields;
}

export function sameSubject(reference: Measurement | ContextClaim, subject: SubjectRef): boolean {
  return (
    reference.subject.kind === subject.kind &&
    reference.subject.id === subject.id &&
    (reference.subject.configurationId === undefined ||
      subject.configurationId === undefined ||
      reference.subject.configurationId === subject.configurationId)
  );
}

export function resolveEditorialText(
  text: string,
  measurements: ReadonlyMap<string, Measurement>,
  contextClaims: ReadonlyMap<string, ContextClaim>,
): string {
  return text.replaceAll(REFERENCE_PATTERN, (_token, kind: string, id: string) => {
    const record = kind === 'measurement' ? measurements.get(id) : contextClaims.get(id);
    if (record === undefined) {
      throw new Error(`cannot resolve ${kind} reference "${id}"`);
    }
    return formatQuantity(record.quantity).text;
  });
}

/** Resolve markers in an export copy without mutating canonical records. */
export function resolveExportProse<T>(value: T, dataset: ParsedDataset): T {
  const measurements = new Map(dataset.measurements.map((record) => [record.id, record]));
  const contextClaims = new Map(dataset.contextClaims.map((record) => [record.id, record]));
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      return resolveEditorialText(entry, measurements, contextClaims);
    }
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry === null || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}
