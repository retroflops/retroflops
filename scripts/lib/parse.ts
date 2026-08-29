// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Schema phase of the pipeline: turns loose records read from disk into typed
 * ones, reporting every rejection with the file it came from.
 *
 * Shared by `data:validate` and `data:build` so the two can never disagree
 * about what counts as a well-formed record.
 */

import {
  componentSchema,
  conflictSchema,
  contextClaimSchema,
  derivedClaimSchema,
  imageAssetSchema,
  measurementSchema,
  researchRecordSchema,
  sourceSchema,
  systemSchema,
} from '../../src/lib/data/schema.ts';
import type { ParsedDataset, ValidationIssue } from '../../src/lib/data/validate.ts';
import { describeRecord, type LoadedRecord, type RawDataset } from './dataset.ts';

const SCHEMAS = {
  systems: systemSchema,
  components: componentSchema,
  images: imageAssetSchema,
  measurements: measurementSchema,
  contextClaims: contextClaimSchema,
  derivedClaims: derivedClaimSchema,
  conflicts: conflictSchema,
  sources: sourceSchema,
  extracts: researchRecordSchema,
} as const;

export type RecordKindName = keyof typeof SCHEMAS;

export const RECORD_KINDS = Object.keys(SCHEMAS) as RecordKindName[];

export interface ParseResult {
  /** Records that parsed. Incomplete when `issues` contains errors. */
  readonly dataset: ParsedDataset;
  readonly issues: readonly ValidationIssue[];
}

export function parseDataset(raw: RawDataset): ParseResult {
  const dataset: Record<RecordKindName, unknown[]> = {
    systems: [],
    components: [],
    images: [],
    measurements: [],
    contextClaims: [],
    derivedClaims: [],
    conflicts: [],
    sources: [],
    extracts: [],
  };
  const issues: ValidationIssue[] = [];

  for (const kind of RECORD_KINDS) {
    for (const record of raw[kind]) {
      const result = SCHEMAS[kind].safeParse(record.value);
      if (result.success) {
        dataset[kind].push(result.data);
        continue;
      }
      issues.push(...schemaIssuesOf(kind, record, result.error.issues));
    }
  }

  return { dataset: dataset as unknown as ParsedDataset, issues };
}

function schemaIssuesOf(
  kind: RecordKindName,
  record: LoadedRecord,
  errors: readonly { path: readonly PropertyKey[]; message: string }[],
): ValidationIssue[] {
  return errors.map((error) => ({
    severity: 'error' as const,
    code: 'schema',
    where: `${kind}: ${describeRecord(record)}`,
    message: `${error.path.length > 0 ? error.path.join('.') : '(root)'}: ${error.message}`,
  }));
}
