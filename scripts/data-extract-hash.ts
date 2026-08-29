// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:extract-hash`, keeps research-record hashes honest without hand work.
 *
 * Every research record carries the SHA-256 of its extract, and validation
 * rejects a record whose extract no longer matches. That check is only worth
 * anything if the hash is mechanically derived from the transcription: an editor
 * computing it by hand, or pasting one from elsewhere, is exactly the mistake it
 * exists to catch.
 *
 * Reports by default and writes only when asked, so it can run as a check in CI
 * and as a fixer during curation. It hashes the parsed string, not the file
 * bytes, so source-file escaping and line wrapping can never change the digest.
 *
 * Offline. It reads and writes `data/extracts` and touches nothing else.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { listYamlFiles, readYamlDocument, repoPath, writeYamlDocumentIfChanged } from './lib/io.ts';

const EXTRACTS_DIRECTORY = repoPath('data/extracts');

const PLACEHOLDER = '0'.repeat(64);

interface RecordShape {
  id?: unknown;
  extract?: unknown;
  extractHash?: unknown;
}

type Status = 'current' | 'updated' | 'stale' | 'unhashable';

interface Report {
  readonly status: Status;
  readonly id: string;
  readonly detail: string;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function reviewRecord(record: RecordShape, write: boolean): Report {
  const id = typeof record.id === 'string' ? record.id : '<record with no id>';

  if (typeof record.extract !== 'string' || record.extract === '') {
    return { status: 'unhashable', id, detail: 'has no extract to hash' };
  }

  const expected = sha256Hex(record.extract);
  if (record.extractHash === expected) {
    return { status: 'current', id, detail: expected.slice(0, 12) };
  }

  const had = typeof record.extractHash === 'string' ? record.extractHash : '';
  const was = had === PLACEHOLDER || had === '' ? 'placeholder' : had.slice(0, 12);

  if (!write) {
    return { status: 'stale', id, detail: `${was} → ${expected.slice(0, 12)}` };
  }

  record.extractHash = expected;
  return { status: 'updated', id, detail: `${was} → ${expected.slice(0, 12)}` };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const files = await listYamlFiles(EXTRACTS_DIRECTORY);
  const reports: Report[] = [];
  let rewritten = 0;

  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    const { text, document } = await readYamlDocument(file);
    const parsed = document.toJS({ maxAliasCount: 0 });
    const records: RecordShape[] = Array.isArray(parsed)
      ? (parsed as RecordShape[])
      : [parsed as RecordShape];

    const before = reports.length;
    for (const record of records) {
      reports.push(reviewRecord(record, write));
    }

    const changed = reports.slice(before).some((report) => report.status === 'updated');
    if (changed) {
      for (const [index, record] of records.entries()) {
        const path = Array.isArray(parsed) ? [index, 'extractHash'] : ['extractHash'];
        document.setIn(path, record.extractHash);
      }
      // oxlint-disable-next-line no-await-in-loop
      await writeYamlDocumentIfChanged(file, text, document);
      rewritten += 1;
      console.log(`  rewrote ${basename(file)}`);
    }
  }

  for (const report of reports) {
    if (report.status !== 'current') {
      console.error(`  ${report.status.padEnd(11)} ${report.id}  ${report.detail}`);
    }
  }

  const counts = new Map<Status, number>();
  for (const report of reports) {
    counts.set(report.status, (counts.get(report.status) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
  console.log(
    `data:extract-hash: ${reports.length} record(s)${summary === '' ? '' : `, ${summary}`}` +
      `${write ? `, ${rewritten} file(s) rewritten` : ''}`,
  );

  // Without --write a stale hash is a failure: it means a transcription was
  // edited after review, which is precisely what the stored hash guards against.
  if (!write && reports.some((report) => report.status !== 'current')) {
    console.error('\nRun `pnpm data:extract-hash --write` and review the resulting diff.');
    process.exitCode = 1;
  }
}

await main();
