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
import { hasErrors, type ValidationIssue } from '../src/lib/data/validate.ts';
import { countRecords } from './lib/dataset.ts';
import { loadValidatedDataset } from './lib/validated-dataset.ts';

function formatIssue(issue: ValidationIssue): string {
  const marker = issue.severity === 'error' ? 'error' : 'warn ';
  return `  ${marker}  ${issue.where}\n         ${issue.message}  [${issue.code}]`;
}

async function main(): Promise<void> {
  const { raw, issues } = await loadValidatedDataset();

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
