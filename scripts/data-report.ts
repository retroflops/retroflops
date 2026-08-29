// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:report`, what changed in the data, for a pull-request reviewer.
 *
 * Reads the committed canonical records at a git ref (default `HEAD`), reads
 * the working tree, and reports the difference in the terms a reviewer cares
 * about: figures, sources, confidence and derived results.
 *
 * Offline apart from git, which reads local objects only. Reconstructing the
 * baseline from committed records rather than from a previous export means the
 * report works even though `public/data` is generated and never committed.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

import { diffDatasets, isEmptyDiff, renderReport } from '../src/lib/data/report.ts';
import type { ParsedDataset } from '../src/lib/data/validate.ts';
import { DATA_DIRECTORIES, loadRawDataset, type LoadedRecord } from './lib/dataset.ts';
import { parseYamlDocument, REPO_ROOT } from './lib/io.ts';
import { parseDataset, RECORD_KINDS, type RecordKindName } from './lib/parse.ts';

const run = promisify(execFile);

const KIND_DIRECTORIES: Record<RecordKindName, string> = {
  systems: DATA_DIRECTORIES.systems,
  components: DATA_DIRECTORIES.components,
  images: DATA_DIRECTORIES.images,
  measurements: DATA_DIRECTORIES.measurements,
  contextClaims: DATA_DIRECTORIES.contextClaims,
  derivedClaims: DATA_DIRECTORIES.derivedClaims,
  conflicts: DATA_DIRECTORIES.conflicts,
  sources: DATA_DIRECTORIES.sources,
  extracts: DATA_DIRECTORIES.extracts,
};

/** Reads the canonical records as they were at a git ref. */
async function loadDatasetAtRef(ref: string): Promise<ParsedDataset> {
  const raw: Record<RecordKindName, LoadedRecord[]> = {
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

  const perKind = await Promise.all(
    RECORD_KINDS.map(async (kind) => ({ kind, records: await loadKindAtRef(kind, ref) })),
  );
  for (const { kind, records } of perKind) {
    raw[kind].push(...records);
  }

  return parseDataset(raw).dataset;
}

async function loadKindAtRef(kind: RecordKindName, ref: string): Promise<LoadedRecord[]> {
  const directory = relative(REPO_ROOT, KIND_DIRECTORIES[kind]);

  let listing: string;
  try {
    const { stdout } = await run('git', ['ls-tree', '-r', '--name-only', ref, '--', directory], {
      cwd: REPO_ROOT,
    });
    listing = stdout;
  } catch {
    // The directory did not exist at that ref, which is a legitimate baseline.
    return [];
  }

  const files = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.yaml'));

  const contents = await Promise.all(
    files.map(async (file) => {
      const { stdout } = await run('git', ['show', `${ref}:${file}`], {
        cwd: REPO_ROOT,
        maxBuffer: 32 * 1024 * 1024,
      });
      return { file, stdout };
    }),
  );

  return contents.flatMap(({ file, stdout }) => {
    const parsed: unknown = parseYamlDocument(stdout, `${ref}:${file}`).toJS({ maxAliasCount: 0 });
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map((value, index) => ({ kind, file, index, value }));
  });
}

async function main(): Promise<void> {
  const refIndex = process.argv.indexOf('--base');
  const ref = refIndex === -1 ? 'HEAD' : (process.argv[refIndex + 1] ?? 'HEAD');

  const before = await loadDatasetAtRef(ref);
  const after = parseDataset(await loadRawDataset()).dataset;

  const diff = diffDatasets(before, after);
  const markdown = renderReport(diff);

  await mkdir(DATA_DIRECTORIES.reports, { recursive: true });
  const target = join(DATA_DIRECTORIES.reports, 'data-change-report.md');
  await writeFile(target, markdown, 'utf8');

  const counts = Object.entries(diff).map(
    ([section, value]) =>
      `${section}: +${value.added.length} -${value.removed.length} ~${value.changed.length}`,
  );
  console.log(`data:report: compared the working tree against ${ref}`);
  console.log(`  ${counts.join('  ')}`);
  console.log(`  written to ${relative(REPO_ROOT, target)}`);

  if (isEmptyDiff(diff)) {
    console.log('  no data changes');
  }
}

await main();
