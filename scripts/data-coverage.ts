// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:coverage`, the metric × machine matrix, so gaps are visible.
 *
 * Offline, and read-only: it never touches the records. Prints the matrix and
 * exits non-zero on either of two failures: a backbone question with nothing
 * recorded at all, or more unread sources than `UNVERIFIED_BUDGET` allows. Both
 * mean unfinished work here rather than a machine that cannot be documented, and
 * a recorded `unknown` is an answer where an unread manual is not. `--quiet`
 * prints only the summary line, `--write <path>` saves the Markdown for a
 * pull-request comment.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { BACKBONE, UNVERIFIED_BUDGET, coverage, renderCoverage } from '../src/lib/data/coverage.ts';
import { UNREVIEWED_UNKNOWN_BUDGET } from '../src/lib/data/unknown-repair.ts';
import { loadRawDataset } from './lib/dataset.ts';
import { parseDataset } from './lib/parse.ts';
import { loadUnknownRepairLedger } from './lib/unknown-repair.ts';

async function main(): Promise<void> {
  const raw = await loadRawDataset();
  const { dataset, issues } = parseDataset(raw);
  if (issues.length > 0) {
    console.error('data:coverage: the records do not parse; run pnpm data:validate first');
    process.exitCode = 1;
    return;
  }

  const rows = coverage({
    schemaVersion: 'catalog-v1',
    registries: {
      units: '',
      metrics: '',
      methods: '',
      comparability: '',
      formulas: '',
      imageRights: '',
    },
    systems: [...dataset.systems],
    components: [...dataset.components],
    images: [...dataset.images],
    measurements: [...dataset.measurements],
    contextClaims: [...dataset.contextClaims],
    sources: [...dataset.sources],
    derivedClaims: [...dataset.derivedClaims],
    conflicts: [...dataset.conflicts],
  });
  const unknownRepairLedger = await loadUnknownRepairLedger();

  const report = renderCoverage(rows);
  const quiet = process.argv.includes('--quiet');
  if (!quiet) {
    console.log(report);
  }

  const writeIndex = process.argv.indexOf('--write');
  const target = writeIndex === -1 ? undefined : process.argv[writeIndex + 1];
  if (target !== undefined) {
    const path = resolve(target);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, report, 'utf8');
    console.log(`data:coverage: written to ${target}`);
  }

  const incomplete = rows.filter((row) => row.gaps > 0);
  const gaps = incomplete.reduce((sum, row) => sum + row.gaps, 0);

  // Two different failures, reported separately because they call for different
  // work. An unasked question means a record is missing and fails at any count.
  // An unread source means the record exists and nobody has opened the document
  // it cites; that one is on a ratchet the repair program walks down to zero.
  const unread = rows.filter((row) => row.unverified > 0);
  const unverified = unread.reduce((sum, row) => sum + row.unverified, 0);
  const unreviewedUnknown = unknownRepairLedger.entries.filter(
    (entry) => entry.disposition === 'unreviewed',
  ).length;

  if (gaps > 0) {
    console.log(
      `data:coverage: ${gaps} backbone question(s) with nothing recorded, across ${incomplete.length} machine(s)`,
    );
    for (const row of incomplete) {
      const missing = row.cells
        .filter((cell) => cell.state === 'absent')
        .map((cell) => cell.entry.label);
      console.log(`  ${row.systemSlug}: ${missing.join(', ')}`);
    }
    process.exitCode = 1;
  }

  if (unverified > UNVERIFIED_BUDGET) {
    console.log(
      `data:coverage: ${unverified} backbone question(s) cite a source nobody has read, over the budget of ${UNVERIFIED_BUDGET}`,
    );
    for (const row of unread) {
      const pending = row.cells
        .filter((cell) => cell.state === 'unverified')
        .map((cell) => cell.entry.label);
      console.log(`  ${row.systemSlug}: ${pending.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  if (unreviewedUnknown > UNREVIEWED_UNKNOWN_BUDGET) {
    console.log(
      `data:coverage: ${unreviewedUnknown} unknown measurement(s) remain unreviewed, over the limit of ${UNREVIEWED_UNKNOWN_BUDGET}`,
    );
    process.exitCode = 1;
  } else if (unreviewedUnknown > 0) {
    console.log(
      `data:coverage: ${unreviewedUnknown} unknown measurement(s) remain unreviewed within the current limit of ${UNREVIEWED_UNKNOWN_BUDGET}`,
    );
  }

  if (unverified > 0) {
    console.log(
      `data:coverage: ${unverified} backbone question(s) still cite an unread source, within the budget of ${UNVERIFIED_BUDGET}. Lower the budget as sources are read; v1 requires zero.`,
    );
  }

  if (gaps === 0 && unverified === 0 && unreviewedUnknown === 0) {
    console.log(
      `data:coverage: all ${rows.length * BACKBONE.length} backbone questions are answered`,
    );
  }
}

await main();
