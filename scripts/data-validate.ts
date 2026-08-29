// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:validate`, the gate every figure passes before it can be published.
 *
 * Runs entirely offline. Two phases: schema parsing rejects malformed records,
 * then dataset validation rejects a set of records that is individually valid
 * but collectively unpublishable, dangling references, duplicate figures,
 * under-sourced numbers, derived claims that no longer recompute.
 *
 * Exits non-zero on any error, so an invalid source, unit, reference or
 * comparability group stops the build.
 */

import { CATALOG_SCHEMA_VERSION } from '../src/lib/data/schema.ts';
import { hasErrors, validateDataset, type ValidationIssue } from '../src/lib/data/validate.ts';
import { countRecords, loadImageFiles, loadRawDataset } from './lib/dataset.ts';
import { parseDataset } from './lib/parse.ts';
import { loadUnknownRepairLedger } from './lib/unknown-repair.ts';

function formatIssue(issue: ValidationIssue): string {
  const marker = issue.severity === 'error' ? 'error' : 'warn ';
  return `  ${marker}  ${issue.where}\n         ${issue.message}  [${issue.code}]`;
}

async function main(): Promise<void> {
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

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  for (const issue of [...errors, ...warnings]) {
    console.error(formatIssue(issue));
  }

  if (hasErrors(issues)) {
    console.error(
      `\ndata:validate: ${errors.length} error(s), ${warnings.length} warning(s) across ` +
        `${countRecords(raw)} record(s)`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `data:validate: ${countRecords(raw)} record(s) valid against ${CATALOG_SCHEMA_VERSION}, ` +
      `${warnings.length} warning(s)`,
  );
}

await main();
