// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:index` writes `docs/CATALOG.md`, the list of every system, processor
 * and graphics chip in the catalog.
 *
 * It lets a person or an agent see what the catalog already holds without
 * building the site. Memory configurations are left out: they describe fitted
 * capacities, not products anyone would propose adding.
 *
 * The file is committed, so the output carries no date and two runs over the
 * same records write the same bytes. `--check` regenerates it into a temporary
 * directory and fails when the committed copy differs, which is how
 * `pnpm check` catches a new record added without rerunning this command.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { catalogAvailability, type CatalogAvailability } from '../src/lib/catalog-availability.ts';
import type { Component, System } from '../src/lib/data/schema.ts';
import {
  componentKindLabel,
  systemTypeLabel,
  systemTypesByFirstRelease,
} from '../src/lib/display.ts';
import { loadRawDataset } from './lib/dataset.ts';
import { formatGeneratedMarkdown } from './lib/format-generated-markdown.ts';
import { repoPath } from './lib/io.ts';
import { parseDataset } from './lib/parse.ts';

const INDEX_FILE = 'CATALOG.md';
const DEFAULT_OUTPUT_DIRECTORY = 'docs';
const LISTED_COMPONENT_KINDS = ['cpu', 'gpu'] as const;

function outputDirectory(): string {
  const index = process.argv.indexOf('--output-directory');
  const target = index === -1 ? DEFAULT_OUTPUT_DIRECTORY : process.argv[index + 1];
  if (target === undefined) {
    throw new Error('data:index: --output-directory needs a path');
  }
  return resolve(isAbsolute(target) ? target : repoPath(target));
}

interface Entry {
  readonly name: string;
  readonly date: string | undefined;
  readonly research: boolean;
}

function entryLine(entry: Entry): string {
  const year = entry.date === undefined ? '' : ` · ${entry.date.slice(0, 4)}`;
  return `- ${entry.name}${year}${entry.research ? ' (research)' : ''}`;
}

/**
 * A component record belongs to the machine it is fitted in, so the Apple II,
 * Atari 800 and Commodore 64 each carry their own 6502. The index prints one
 * line per name with the earliest known date, marked as research only when
 * every record behind it is.
 */
function mergeByName(entries: readonly Entry[]): Entry[] {
  const merged = new Map<string, Entry>();
  for (const entry of entries) {
    const seen = merged.get(entry.name);
    if (seen === undefined) {
      merged.set(entry.name, entry);
      continue;
    }
    const dates = [seen.date, entry.date].filter((date) => date !== undefined).toSorted();
    merged.set(entry.name, {
      name: entry.name,
      date: dates[0],
      research: seen.research && entry.research,
    });
  }
  return [...merged.values()];
}

function section(title: string, entries: readonly Entry[]): string[] {
  const sorted = entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return [`## ${title}`, '', ...sorted.map(entryLine), ''];
}

function systemEntry(availability: CatalogAvailability, system: System): Entry {
  return {
    name: system.name,
    date: system.releaseDate,
    research: availability.systems.get(system.id)?.availability === 'research',
  };
}

function componentEntry(availability: CatalogAvailability, component: Component): Entry {
  return {
    name: component.name,
    date: component.introducedDate,
    research: availability.components.get(component.id)?.availability === 'research',
  };
}

function render(
  systems: readonly System[],
  components: readonly Component[],
  availability: CatalogAvailability,
): string {
  const groups: { title: string; entries: Entry[] }[] = [
    ...systemTypesByFirstRelease(systems).map((type) => ({
      title: systemTypeLabel(type),
      entries: systems
        .filter((system) => system.type === type)
        .map((system) => systemEntry(availability, system)),
    })),
    ...LISTED_COMPONENT_KINDS.map((kind) => ({
      title: componentKindLabel(kind),
      entries: mergeByName(
        components
          .filter((component) => component.kind === kind)
          .map((component) => componentEntry(availability, component)),
      ),
    })),
  ];

  const researchCount = groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.research).length;
  const researchNote =
    researchCount === 0
      ? 'No entry is marked at the moment.'
      : `${researchCount} ${researchCount === 1 ? 'entry is' : 'entries are'} marked.`;

  return [
    '# Catalog index',
    '',
    `Every system, processor and graphics chip in the RetroFlops catalog. The ${systems.length} systems are grouped by type, and processors and graphics chips follow. Each group is sorted by name, and the year after a name is its release or introduction date. A chip fitted in several machines is listed once. Memory configurations are left out.`,
    '',
    `An entry marked "(research)" is in the repository but has no numeric measurement yet, so Explore does not list it. ${researchNote}`,
    '',
    'This file is generated. Run `pnpm data:index` after adding or renaming a record; `pnpm check` fails while it is out of date.',
    '',
    ...groups.flatMap((group) => section(group.title, group.entries)),
  ].join('\n');
}

async function writeIndex(directory: string, markdown: string): Promise<string> {
  const path = join(directory, INDEX_FILE);
  await writeFile(path, markdown, 'utf8');
  await formatGeneratedMarkdown([path]);
  return path;
}

async function main(): Promise<void> {
  const raw = await loadRawDataset();
  const { dataset, issues } = parseDataset(raw);
  if (issues.length > 0) {
    console.error('data:index: the records do not parse; run pnpm data:validate first');
    process.exitCode = 1;
    return;
  }

  const markdown = render(dataset.systems, dataset.components, catalogAvailability(dataset));

  if (process.argv.includes('--check')) {
    const committed = repoPath(DEFAULT_OUTPUT_DIRECTORY, INDEX_FILE);
    const scratch = await mkdtemp(join(tmpdir(), 'retroflops-data-index-'));
    try {
      const fresh = await readFile(await writeIndex(scratch, markdown), 'utf8');
      const current = await readFile(committed, 'utf8').catch(() => undefined);
      if (current !== fresh) {
        console.error(`data:index: ${committed} is out of date; run pnpm data:index`);
        process.exitCode = 1;
        return;
      }
    } finally {
      await rm(scratch, { force: true, recursive: true });
    }
    console.log('data:index: docs/CATALOG.md is up to date');
    return;
  }

  const path = await writeIndex(outputDirectory(), markdown);
  console.log(`data:index: wrote ${path}`);
}

await main();
