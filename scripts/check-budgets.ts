// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `budgets`, what each page costs a reader before it is usable.
 *
 * Lighthouse measures a page as loaded; this measures the artifact, which is
 * the thing a change can be reviewed against. For every page kind it walks the
 * scripts the HTML references, follows their *static* imports transitively, and
 * gzips the result, the bytes a browser must have before the island runs.
 * Dynamic imports are deliberately not followed: the whole point of importing
 * the plotting library inside an effect is that it is not part of this number.
 *
 * Offline, and it reads `dist`, so it runs after a build and never instead of
 * one.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { CANONICAL_MAX_BYTES, RESPONSIVE_WIDTHS } from '../src/lib/data/image-preset.ts';
import { DATA_DIRECTORIES } from './lib/dataset.ts';
import { repoPath } from './lib/io.ts';

/** Initial JavaScript a page may cost, gzipped. */
const PAGE_BUDGET_BYTES = 50 * 1024;

/**
 * Any single chunk larger than this must be reached by a dynamic import.
 *
 * Set above the comparison builder, which is 68 kB uncompressed and belongs on
 * the page that is nothing but that builder, and far below the plotting library
 * at 389 kB, which belongs nowhere until a reader asks for a picture.
 */
const LAZY_CHUNK_THRESHOLD_BYTES = 100 * 1024;

interface PageBudget {
  readonly path: string;
  /** Why this page is in the list, printed with the result. */
  readonly why: string;
}

const PAGES: readonly PageBudget[] = [
  { path: 'index.html', why: 'home, with the search island' },
  { path: 'explore/index.html', why: 'Explore, with the filter island' },
  { path: 'compare/index.html', why: 'Compare, with the builder, the heaviest island' },
  { path: 'systems/commodore-64/index.html', why: 'a system profile' },
  { path: 'components/cpu/mos-6510/index.html', why: 'a component profile' },
  {
    path: 'timeline/clock-frequency-cpu-nominal-clock/index.html',
    why: 'a chart page, whose plotting library must not be in this number',
  },
  { path: 'methodology/index.html', why: 'methodology' },
];

const SCRIPT_REFERENCE = /["'`(](\/?[\w./-]*_astro\/[\w.-]+\.js)["'`)]/g;
/** `import x from "./y.js"`, `export … from "./y.js"`, `import "./y.js"`, never `import(`. */
const STATIC_IMPORT =
  /(?:^|[\s;}])(?:import|export)\s*(?:[\w*{},$\s]*?\s*from\s*)?["']([^"']+)["']/g;

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Every chunk a page loads before its islands can run, following static imports only. */
async function initialChunks(distDir: string, pagePath: string): Promise<ReadonlySet<string>> {
  const html = await readIfPresent(join(distDir, pagePath));
  if (html === undefined) {
    throw new Error(`budgets: ${pagePath} is not in the build, run "pnpm build" first`);
  }

  const queue = [...html.matchAll(SCRIPT_REFERENCE)]
    .map((match) => match[1] ?? '')
    .map((reference) => resolve(distDir, reference.replace(/^\//, '')));
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    // A graph walk: what to read next is only known once this file has been
    // read, so there is nothing to run in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const code = await readIfPresent(file);
    if (code === undefined) {
      continue;
    }
    seen.add(file);
    for (const match of code.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? '';
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        queue.push(
          specifier.startsWith('/')
            ? resolve(distDir, specifier.replace(/^\//, ''))
            : resolve(dirname(file), specifier),
        );
      }
    }
  }
  return seen;
}

async function gzippedSize(files: Iterable<string>): Promise<number> {
  const sizes = await Promise.all(
    [...files].map(async (file) => gzipSync(await readFile(file)).byteLength),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Photographs, both the ones the repository stores and the ones the build makes
 * from them.
 *
 * The stored file has a hard ceiling because it is committed and reviewed as a
 * diff; the generated variants have one because a reader on a phone pays for
 * whichever the browser picks. Neither is a page budget, an image is fetched
 * after the HTML and never blocks the island, so they are counted separately
 * rather than folded into the JavaScript number.
 */
async function checkImages(): Promise<string[]> {
  const failures: string[] = [];

  const canonicalFiles = (await readdir(DATA_DIRECTORIES.imageAssets).catch(() => []))
    .filter((name) => name.endsWith('.avif'))
    .toSorted();

  const canonical = await Promise.all(
    canonicalFiles.map(async (name) => ({
      name,
      bytes: (await readFile(join(DATA_DIRECTORIES.imageAssets, name))).byteLength,
    })),
  );

  console.log('\nbudgets: canonical images stored in the repository\n');
  for (const file of canonical) {
    const over = file.bytes > CANONICAL_MAX_BYTES;
    console.log(`  ${over ? 'OVER' : 'ok  '} ${kb(file.bytes).padStart(9)}  ${file.name}`);
    if (over) {
      failures.push(
        `${file.name} is ${kb(file.bytes)}, over the ${kb(CANONICAL_MAX_BYTES)} the image-v1 ` +
          'preset allows',
      );
    }
  }
  if (canonicalFiles.length === 0) {
    console.log('  none');
  }

  const generated = (await readdir(join(repoPath('dist'), '_astro')))
    .filter((name) => name.endsWith('.avif'))
    .toSorted();
  const measured = await Promise.all(
    generated.map(async (name) => ({
      name,
      bytes: (await readFile(join(repoPath('dist'), '_astro', name))).byteLength,
    })),
  );
  const largest = measured.reduce((total, file) => Math.max(total, file.bytes), 0);

  console.log(
    `\nbudgets: ${measured.length} generated image variant(s) at ` +
      `${RESPONSIVE_WIDTHS.join('/')} px, largest ${kb(largest)}`,
  );
  for (const file of measured.filter((candidate) => candidate.bytes > CANONICAL_MAX_BYTES)) {
    failures.push(
      `${file.name} is ${kb(file.bytes)}, larger than the canonical file it was generated from`,
    );
  }

  // Three variants per canonical file and nothing else: a fourth would mean a
  // page asked for a width the preset does not publish.
  const expected = canonicalFiles.length * RESPONSIVE_WIDTHS.length;
  if (measured.length !== expected) {
    failures.push(
      `the build emitted ${measured.length} image variant(s); ${canonicalFiles.length} ` +
        `canonical image(s) at ${RESPONSIVE_WIDTHS.length} widths should emit ${expected}`,
    );
  }

  return failures;
}

async function main(): Promise<void> {
  const distDir = repoPath('dist');
  const failures: string[] = [];

  const perPage = await Promise.all(
    PAGES.map(async (page) => {
      const chunks = await initialChunks(distDir, page.path);
      return { page, chunks, size: await gzippedSize(chunks) };
    }),
  );

  console.log('budgets: initial JavaScript per page, gzipped\n');
  for (const { page, chunks, size } of perPage) {
    const status = size <= PAGE_BUDGET_BYTES ? 'ok  ' : 'OVER';
    console.log(
      `  ${status} ${kb(size).padStart(9)}  ${page.path}\n         ${chunks.size} chunk(s), ${page.why}`,
    );
    if (size > PAGE_BUDGET_BYTES) {
      failures.push(
        `${page.path} loads ${kb(size)} of JavaScript, over the ${kb(PAGE_BUDGET_BYTES)} budget`,
      );
    }
  }

  /*
   * The plotting library is the only thing in the build large enough to matter,
   * and the rule it has to obey is not "be small" but "be absent until asked
   * for". So every chunk over the threshold must be unreachable through static
   * imports from any page, which is exactly what the sets above collect.
   */
  const assets = join(distDir, '_astro');
  const chunkFiles = (await readdir(assets))
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(assets, name));
  const measured = await Promise.all(
    chunkFiles.map(async (file) => ({ file, bytes: (await readFile(file)).byteLength })),
  );
  const large = measured
    .filter((chunk) => chunk.bytes > LAZY_CHUNK_THRESHOLD_BYTES)
    .map((chunk) => chunk.file);

  const eager = new Set<string>();
  for (const entry of perPage) {
    for (const chunk of entry.chunks) {
      eager.add(chunk);
    }
  }

  console.log('\nbudgets: chunks that must stay behind a dynamic import\n');
  for (const file of large) {
    const name = relative(distDir, file);
    const shipped = eager.has(file);
    console.log(`  ${shipped ? 'EAGER' : 'lazy '} ${name}`);
    if (shipped) {
      failures.push(`${name} is loaded eagerly; a chunk this size must be imported dynamically`);
    }
  }

  failures.push(...(await checkImages()));

  if (failures.length > 0) {
    console.error('');
    for (const failure of failures) {
      console.error(`  error  ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('\nbudgets: every page is inside its budget');
}

await main();
