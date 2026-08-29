// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:build`, writes the public exports Astro reads at build time.
 *
 * Offline, and refuses to emit anything from a dataset that does not validate:
 * an invalid source, unit, reference or comparability group stops the build
 * rather than reaching `public/data`.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildArtifacts } from '../src/lib/data/build.ts';
import { hasErrors, validateDataset } from '../src/lib/data/validate.ts';
import { loadImageFiles, loadRawDataset } from './lib/dataset.ts';
import { repoPath, sha256 } from './lib/io.ts';
import { parseDataset } from './lib/parse.ts';
import { loadUnknownRepairLedger } from './lib/unknown-repair.ts';

async function main(): Promise<void> {
  const raw = await loadRawDataset();
  const { dataset, issues: schemaIssues } = parseDataset(raw);

  const imageFiles = await loadImageFiles(dataset.images.map((image) => image.id));
  const unknownRepairLedger = await loadUnknownRepairLedger();
  const issues =
    schemaIssues.length > 0
      ? schemaIssues
      : [...validateDataset(dataset, { imageFiles, unknownRepairLedger })];
  if (hasErrors(issues)) {
    for (const issue of issues.filter((candidate) => candidate.severity === 'error')) {
      console.error(`  error  ${issue.where}\n         ${issue.message}  [${issue.code}]`);
    }
    console.error('\ndata:build: refusing to build from a dataset that does not validate');
    process.exitCode = 1;
    return;
  }

  const artifacts = buildArtifacts(dataset);
  const publicDir = repoPath('public');

  await Promise.all(
    artifacts.map(async (artifact) => {
      const target = join(publicDir, artifact.path);
      await mkdir(dirname(target), { recursive: true });
      /*
       * Written beside the target and renamed onto it, because a reader of these
       * files is never only this script: an Astro build imports the catalog
       * while another build may be writing it, and an interrupted run would
       * otherwise leave half a JSON file where the site expects a catalog.
       * A rename within one directory is atomic, so a reader sees the previous
       * artifact or the new one and never the middle of either.
       */
      const staging = `${target}.tmp`;
      await writeFile(staging, artifact.content, 'utf8');
      await rename(staging, target);
    }),
  );

  console.log(`data:build: ${artifacts.length} artifact(s)`);
  for (const artifact of artifacts) {
    const bytes = Buffer.byteLength(artifact.content, 'utf8');
    console.log(
      `  ${artifact.path}  ${bytes} bytes  sha256:${sha256(artifact.content).slice(0, 12)}`,
    );
  }
}

await main();
