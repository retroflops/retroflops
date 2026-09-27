// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Both phases of validation, read from disk in one call. Shared by
 * `data:validate` and `data:build`, so the build refuses exactly what the
 * validator reports.
 */

import {
  validateDataset,
  type ParsedDataset,
  type ValidationIssue,
} from '../../src/lib/data/validate.ts';
import { loadImageFiles, loadRawDataset, type RawDataset } from './dataset.ts';
import { parseDataset } from './parse.ts';
import { loadUnknownRepairLedger } from './unknown-repair.ts';

export interface ValidatedDataset {
  readonly raw: RawDataset;
  readonly dataset: ParsedDataset;
  readonly issues: readonly ValidationIssue[];
}

export async function loadValidatedDataset(): Promise<ValidatedDataset> {
  const raw = await loadRawDataset();
  const { dataset, issues: schemaIssues } = parseDataset(raw);

  // Cross-record checks assume well-formed records, so they only run once the
  // schema phase is clean. Reporting both at once would bury the real cause.
  const imageFiles = await loadImageFiles(dataset.images.map((image) => image.id));
  const unknownRepairLedger = await loadUnknownRepairLedger();
  const issues =
    schemaIssues.length > 0
      ? schemaIssues
      : [...validateDataset(dataset, { imageFiles, unknownRepairLedger })];
  return { raw, dataset, issues };
}
