// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:gaps`, the open questions, written for somebody outside this project.
 *
 * `data:coverage` answers "does the catalog have a figure here?" for the six
 * backbone questions, in a matrix meant for whoever maintains the data. This
 * script answers a different question, "what is still missing, for which
 * machine, and why?", across every metric, in a document meant to be handed to
 * an outside researcher who has never seen this repository.
 *
 * That readership is why the output names no file, no command and no schema
 * field: an entry is a machine, a quantity, the unit it is recorded in, the
 * record's own account of why it is empty, and the documents already read.
 * The inventory and both prompts share one ignored output directory. Tracked
 * templates make the full research package reproducible from a clean checkout.
 *
 * Offline, and read-only as far as the records go: the only thing it writes is
 * the document. Regenerate after a curation round and run `pnpm format` after
 * it, which wraps the prose; the document is a snapshot of the records on the
 * day it was written and says so.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { catalogAvailability, type RecordAvailability } from '../src/lib/catalog-availability.ts';
import type { Component, Measurement, Source, System } from '../src/lib/data/schema.ts';
import { sourceCitationUrl } from '../src/lib/data/source-url.ts';
import { loadRawDataset } from './lib/dataset.ts';
import { formatGeneratedMarkdown } from './lib/format-generated-markdown.ts';
import { repoPath } from './lib/io.ts';
import { parseDataset } from './lib/parse.ts';

const DEFAULT_OUTPUT_DIRECTORY = 'data/reports/research';
const RESEARCH_REQUESTS_FILE = 'research-requests.md';
const PROMPT_TEMPLATES = ['research-prompt.md', 'research-intake-prompt.md'] as const;

/** How a quantity is recorded, in the words of somebody who has to go and find it. */
const METRIC_NOTES: Partial<Record<Measurement['metric'], { label: string; unit: string }>> = {
  'clock-frequency': { label: 'Clock frequency', unit: 'MHz or GHz' },
  'memory-bandwidth': { label: 'Memory bandwidth', unit: 'MB/s or GB/s' },
  'memory-capacity': { label: 'Memory capacity', unit: 'KiB, MiB or GiB of working memory' },
  'memory-capacity-words': { label: 'Memory capacity', unit: 'machine words' },
  'memory-bus-width': { label: 'Memory bus width', unit: 'bits' },
  'storage-capacity': { label: 'Storage capacity', unit: 'GB as the maker states it, decimal' },
  'rated-power-consumption': { label: 'Rated power consumption', unit: 'W' },
  'system-power-draw': { label: 'Whole-system power draw', unit: 'W under a named workload' },
  'thermal-design-power': { label: 'Thermal design power', unit: 'W' },
  'peak-fp32-rate': { label: 'Peak FP32 rate', unit: 'FLOP/s, precision stated' },
  'peak-fp64-rate': { label: 'Peak FP64 rate', unit: 'FLOP/s, precision stated' },
  'peak-fp16-rate': { label: 'Peak FP16 rate', unit: 'FLOP/s, precision stated' },
  'sustained-fp40-rate': {
    label: 'Sustained 40-bit float rate',
    unit: 'FLOP/s from a named benchmark run',
  },
  'native-instruction-rate': {
    label: 'Native instruction rate',
    unit: "MIPS on the machine's own instruction set",
  },
  'dhrystone-mips': { label: 'Dhrystone MIPS', unit: 'DMIPS, with the Dhrystone version' },
  'launch-price': { label: 'Launch price', unit: 'one currency, one market, at launch' },
  'transistor-count': { label: 'Transistor count', unit: 'transistors on one named die' },
  'process-node': { label: 'Process node', unit: 'the node name, plus the foundry' },
};

interface Part {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly holds: (system: System) => boolean;
}

const PARTS: readonly Part[] = [
  {
    id: 'A',
    title: 'Apple iPhones and Apple silicon Macs',
    blurb:
      'Apple publishes chip names, core counts and marketing throughput figures. It rarely publishes clocks, installed DRAM capacity, memory bandwidth or power ratings. Teardowns, die analyses and instrumented tests are the usual routes to those numbers.',
    holds: (system) => system.type === 'smartphone' || system.slug.startsWith('apple-mac-mini'),
  },
  {
    id: 'B',
    title: 'Consoles and handhelds',
    blurb:
      'Two gaps repeat across console generations. One is the power rating printed on the machine or its supply. The other is a graphics clock or floating-point rate for a chip described only by its output. Manuals and regulatory filings often settle power ratings. Developer documents and conference talks are better bets for graphics clocks.',
    holds: (system) => system.type === 'console' || system.type === 'handheld',
  },
  {
    id: 'C',
    title: 'Home and personal computers of the 8- and 16-bit era',
    blurb:
      'Period documentation describes these machines through capacity, address maps and bus organization, not transfer rates or wattage. Missing figures may appear in service manuals, technical references, regulatory nameplates or contemporary magazine benchmarks that print their method.',
    holds: (system) =>
      system.type === 'home-computer' ||
      ['acorn-archimedes-a310', 'apple-macintosh-128k', 'atari-520st', 'ibm-pc-5150'].includes(
        system.slug,
      ),
  },
  {
    id: 'D',
    title: 'Workstations, guidance computers and single-board computers',
    blurb:
      'This is a small group of unusual machines. The Silicon Graphics Octane is the difficult case. No citable archive found so far holds its hardware documentation, so the search needs either that document or another source that states the same figures.',
    holds: (system) =>
      system.type === 'guidance-computer' ||
      system.type === 'workstation' ||
      system.slug === 'raspberry-pi-5',
  },
  {
    id: 'E',
    title: 'Graphics cards and accelerators',
    blurb:
      'Vendors documented these parts unevenly. Common gaps include board power for an early card, a floating-point peak stated in FLOP/s instead of fill rate, or a clock for a data-center part specified only by throughput.',
    holds: (system) => system.type === 'accelerator',
  },
  {
    id: 'F',
    title: 'Representative x86 PC platforms',
    blurb:
      'These entries are composites, such as "Pentium II PC" and "display adapter of the VGA era". They give the x86 line a place in the catalog without pretending that one complete machine represents the whole category. A composite has no single true clock or bandwidth. Filling most empty fields would require splitting the entry into named configurations. Only figures for one specific part in one specific configuration would help.',
    holds: () => true,
  },
];

interface BulkAsk {
  readonly metric: Measurement['metric'];
  readonly label: string;
  readonly description: string;
  readonly skip: (system: System) => boolean;
}

interface Entry {
  readonly measurement: Measurement;
  readonly owners: readonly System[];
  readonly primary: System;
}

interface PartEntries {
  readonly part: Part;
  readonly entries: readonly Entry[];
  readonly machines: readonly System[];
}

function isUnknown(measurement: Measurement): boolean {
  return (
    (measurement.quantity.state === 'unknown' && measurement.unknownAudit === undefined) ||
    measurement.quantity.state === 'unverified'
  );
}

function noteOf(measurement: Measurement): string {
  if (measurement.quantity.state === 'value') {
    return '';
  }
  // An unverified figure is forbidden a note, because it may not describe a
  // document nobody opened. What a researcher needs to be told is that the
  // document is named and waiting, which is a fact about the record itself.
  if (measurement.quantity.state === 'unverified') {
    return 'A document is cited for this quantity and has not yet been read.';
  }
  return measurement.quantity.note ?? 'No reason is recorded.';
}

function componentsOf(system: System): ReadonlySet<string> {
  return new Set(
    system.configurations.flatMap((configuration) =>
      configuration.entries.map((entry) => entry.componentId),
    ),
  );
}

function subjectOf(measurement: Measurement, components: ReadonlyMap<string, Component>): string {
  if (measurement.subject.kind === 'system') {
    const configuration =
      measurement.subject.configurationId === undefined
        ? ''
        : `, variant "${measurement.subject.configurationId}"`;
    return `the machine as a whole${configuration}`;
  }
  const component = components.get(measurement.subject.id);
  if (component === undefined) return measurement.subject.id;
  const kind = component.kind === 'memory' ? 'memory' : component.kind.toUpperCase();
  return `its ${kind}, ${component.name}`;
}

function describeSource(id: string, sources: ReadonlyMap<string, Source>): string {
  const source = sources.get(id);
  if (source === undefined) return id;
  const url = sourceCitationUrl(source);
  return `${source.title}, ${source.publisher}, tier ${source.tier}${url === undefined ? '' : `, ${url}`}`;
}

/** Everything already read for a machine: its own citations, its parts' and its figures'. */
function consulted(
  system: System,
  entries: readonly Entry[],
  components: ReadonlyMap<string, Component>,
  sources: ReadonlyMap<string, Source>,
): readonly string[] {
  const ids = new Set<string>(system.sourceIds);
  for (const entry of entries) {
    for (const id of entry.measurement.sourceIds) ids.add(id);
  }
  for (const componentId of componentsOf(system)) {
    for (const id of components.get(componentId)?.sourceIds ?? []) ids.add(id);
  }
  return [...ids].map((id) => describeSource(id, sources));
}

function renderEntry(entry: Entry, components: ReadonlyMap<string, Component>): string {
  const { measurement } = entry;
  const metric = METRIC_NOTES[measurement.metric];
  const shared =
    entry.owners.length > 1
      ? ` Also fitted to: ${entry.owners
          .slice(1)
          .map((system) => system.name)
          .join(', ')}.`
      : '';
  const lines = [
    `- **\`${measurement.id}\`**. ${metric?.label ?? measurement.metric}, for ${subjectOf(
      measurement,
      components,
    )}. Scope \`${measurement.scope}\`, recorded in ${metric?.unit ?? "the source's own unit"}.${shared}`,
    `  - Why it is empty: ${noteOf(measurement)}`,
  ];
  if (measurement.caveat !== undefined && measurement.caveat !== noteOf(measurement)) {
    lines.push(`  - Note: ${measurement.caveat}`);
  }
  if (measurement.conditions !== undefined) {
    lines.push(`  - Conditions the figure would have to match: ${measurement.conditions}`);
  }
  return lines.join('\n');
}

function availabilityLabel(availability: RecordAvailability): string {
  return availability === 'catalog' ? 'Catalog record' : 'Research record';
}

function outputDirectory(): string {
  const index = process.argv.indexOf('--output-directory');
  const target = index === -1 ? DEFAULT_OUTPUT_DIRECTORY : process.argv[index + 1];
  if (target === undefined) {
    throw new Error('data:gaps: --output-directory needs a path');
  }
  return resolve(isAbsolute(target) ? target : repoPath(target));
}

function renderPart(
  section: PartEntries,
  components: ReadonlyMap<string, Component>,
  sources: ReadonlyMap<string, Source>,
  availabilityBySystem: ReadonlyMap<string, RecordAvailability>,
): readonly string[] {
  const { part, entries, machines } = section;
  const byMachine = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = byMachine.get(entry.primary.id) ?? [];
    list.push(entry);
    byMachine.set(entry.primary.id, list);
  }

  const out: string[] = [
    `## Part ${part.id}, ${part.title}`,
    '',
    `${entries.length} open quantities across ${machines.length} machines.`,
    '',
    part.blurb,
    '',
  ];

  for (const system of machines) {
    const list = (byMachine.get(system.id) ?? []).toSorted((a, b) =>
      a.measurement.id.localeCompare(b.measurement.id),
    );
    const availability = availabilityBySystem.get(system.id);
    if (availability === undefined) {
      throw new Error(`data:gaps: missing availability for ${system.id}`);
    }
    out.push(
      `### ${system.name}`,
      '',
      `${system.manufacturer} · ${system.releaseDate} · ${system.type} · \`${system.slug}\` · ${availabilityLabel(availability)}`,
      '',
      system.summary,
      '',
      `Already read for this machine: ${consulted(system, list, components, sources).join('; ')}.`,
      '',
    );
    for (const entry of list) out.push(renderEntry(entry, components), '');
  }

  return out;
}

function frontMatter(
  entryCount: number,
  machineCount: number,
  systemCount: number,
  catalogSystemCount: number,
  researchSystemCount: number,
  parts: readonly { part: Part; count: number }[],
  today: string,
): string {
  return `# Hardware specification gaps

An inventory of quantities the full export of a comparative hardware catalog has
been unable to state. The export contains ${systemCount} computers, consoles,
processors and graphics cards from the Apollo Guidance Computer to the present.
It holds ${entryCount} open quantities across
${machineCount} machines, each with the reason it is empty and the documents already read
for that machine.

Compiled ${today}. It is a snapshot: entries close as documents are found.

## Catalog and research records

The full export has ${systemCount} systems. ${catalogSystemCount} are catalog records with at least
one numeric measurement. ${researchSystemCount} are research records whose source trail is preserved
but which have no numeric measurement yet. This inventory covers unknown quantities in both groups.
A catalog record can still have many unknowns. Availability is a browsing rule, not an evidence-review
status.

## What "unknown" means here

Not "nobody knows". Every entry below was asked as a question and answered
"we have not finished checking this". The catalog distinguishes the following
states, and only unfinished work appears in this document:

- **stated.** A figure with a value, a source and a locator.
- **not applicable.** The quantity does not exist for that machine, which is a
  fact about the hardware and is recorded as one;
- **unknown.** A completed search found no published candidate that matches the
  machine and quantity;
- **unreviewed unknown.** The record has not yet passed that search.
- **nothing recorded.** The question was never asked of that machine. None of
  the core quantities are in this state any longer; the metrics gathered in
  Appendix 1 are almost entirely in it.

Most open entries here have a number circulating somewhere, in teardowns, die
analyses, developer presentations, service manuals, regulatory filings, magazine
benchmark suites and enthusiast databases. What is missing is the document that
states it.

## The evidence standard behind that word

A figure is publishable in this catalog when a document states it and the
document can be pointed at:

- **Tier A.** The vendor or manufacturer, a government or standards body, an
  official benchmark result, a printed manual or service manual, a regulatory
  filing. One tier A source suffices.
- **Tier B.** Independent technical journalism, die analyses, teardowns,
  conference papers, academic work. Two independent and agreeing tier B sources
  confirm a number. One makes it reported and provisional.
- **Tier C.** Wikis, specification aggregators, fan databases, forum posts,
  video. An exactly cited tier C claim may appear as rumored and provisional.
  Repetition does not raise it to a stronger level.

Alongside the figure, a record carries a locator (page, table, section or
timecode), a short verbatim extract containing the number as the document states
it, and a stable URL, an archive capture where the original is perishable.

Some absences below are absences of a usable *form* rather than of a number.
A floating-point rate with no stated precision, a benchmark result with no
version, a price hedged as "expected to start at", a battery life offered where
watts were asked for: each of those was found and none of them could be
recorded.

## How each quantity is recorded

- **Clock frequency.** The nominal operating frequency of the named part.
  Where a part has base and boost clocks, they are separate figures; where a
  clock is derived from a video standard or a master crystal, the divider chain
  is part of the story.
- **Memory bandwidth.** A stated peak, or a derivation from bus width and
  transfer rate with both inputs sourced. A theoretical bus peak and a measured
  rate are different quantities and never share a row.
- **Memory capacity.** Installed working memory. Storage is a separate metric,
  and flash is never counted as working memory.
- **Rated power consumption.** The wattage a machine or part was specified to
  draw: a nameplate, a supply rating, a manual's electrical section, a
  regulatory filing. Distinct from a cooling-design figure and from a measured
  draw.
- **Whole-system power draw.** Watts measured at the wall under a workload that
  is named and reproducible.
- **Thermal design power.** The vendor's own cooling-design figure.
- **Peak FP32 / FP64 rate.** FLOP/s with the precision stated explicitly. A
  derivation from units, clock and operations per cycle is welcome and is often
  better evidence than a marketing figure, provided each input has its own
  source.
- **Native instruction rate.** Instructions per second on the machine's own
  instruction set, valid only with a stated instruction mix. A clock divided by
  one cycle per instruction describes no real workload.
- **Sustained 40-bit float rate.** For 8-bit machines whose BASIC used a
  five-byte float: the result of a named, reproducible, published benchmark,
  with the listing the source printed.
- **Launch price.** Nominal, one currency, one market, at launch, from a
  document stating it as the asking price.

## How to read an entry

Each entry opens with a reference key of the form \`machine:quantity\`, which is
how a finding gets filed. Then the quantity and the part of the machine it
describes, the unit it is recorded in, the record's own account of why it is
empty, and, where one exists, a note on what would not qualify as an answer.
Each machine lists the documents already read for it.

## Contents

${parts
  .map(({ part, count }) => `- Part ${part.id}, ${part.title}: ${count} open quantities.`)
  .join('\n')}
- Part V, figures the catalog shows on a document nobody could open. These are not
  gaps: numbers that are on the site and cannot be checked, so a contradicting
  document is as valuable as a confirming one.
- **Appendix 1.** Quantities the catalog has barely asked at all: transistor
  counts, process nodes, launch prices, memory bus widths, Dhrystone results.
- **Appendix 2.** The complete machine list with the identifier used for each.
`;
}

async function main(): Promise<void> {
  const raw = await loadRawDataset();
  const { dataset, issues } = parseDataset(raw);
  if (issues.length > 0) {
    console.error('data:gaps: the records do not parse; run pnpm data:validate first');
    process.exitCode = 1;
    return;
  }

  const systems = new Map(dataset.systems.map((system) => [system.id, system]));
  const components = new Map(dataset.components.map((component) => [component.id, component]));
  const sources = new Map(dataset.sources.map((source) => [source.id, source]));
  const availability = catalogAvailability(dataset);
  const availabilityBySystem = new Map(
    [...availability.systems].map(([id, record]) => [id, record.availability]),
  );

  const fittedTo = new Map<string, Set<string>>();
  for (const system of dataset.systems) {
    for (const componentId of componentsOf(system)) {
      const owners = fittedTo.get(componentId) ?? new Set<string>();
      owners.add(system.id);
      fittedTo.set(componentId, owners);
    }
  }

  // The last group holds anything the others do not, so every machine lands.
  const partOf = new Map<string, string>();
  for (const system of dataset.systems) {
    const part = PARTS.find((candidate) => candidate.holds(system));
    if (part !== undefined) partOf.set(system.id, part.id);
  }

  // A figure recorded against a shared part belongs to every machine fitted with
  // it, and is listed once, under the first of them.
  const entries: Entry[] = [];
  for (const measurement of dataset.measurements) {
    if (!isUnknown(measurement)) continue;
    const ownerIds =
      measurement.subject.kind === 'system'
        ? [measurement.subject.id]
        : [...(fittedTo.get(measurement.subject.id) ?? [])];
    const owners = ownerIds
      .map((id) => systems.get(id))
      .filter((system): system is System => system !== undefined)
      .toSorted((a, b) => a.name.localeCompare(b.name));
    const primary = owners[0];
    if (primary === undefined) continue;
    entries.push({ measurement, owners, primary });
  }

  const sections = PARTS.map((part): PartEntries => {
    const mine = entries.filter((entry) => partOf.get(entry.primary.id) === part.id);
    const machineIds = new Set(mine.map((entry) => entry.primary.id));
    const machines = [...machineIds]
      .map((id) => systems.get(id))
      .filter((system): system is System => system !== undefined)
      .toSorted((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    return { part, entries: mine, machines };
  });

  const today = new Date().toISOString().slice(0, 10);
  const machineCount = new Set(entries.map((entry) => entry.primary.id)).size;
  const catalogSystemCount = [...availability.systems.values()].filter(
    (record) => record.availability === 'catalog',
  ).length;
  const researchSystemCount = dataset.systems.length - catalogSystemCount;
  const out: string[] = [
    frontMatter(
      entries.length,
      machineCount,
      dataset.systems.length,
      catalogSystemCount,
      researchSystemCount,
      sections.map(({ part, entries: partEntries }) => ({ part, count: partEntries.length })),
      today,
    ),
  ];

  for (const section of sections) {
    out.push(...renderPart(section, components, sources, availabilityBySystem));
  }

  const unbacked = unverified(
    dataset.systems,
    dataset.components,
    dataset.measurements,
    dataset.sources,
    [...dataset.extracts],
    availabilityBySystem,
  );
  out.push(
    ...unbacked.lines,
    ...appendixOne(dataset.systems, dataset.measurements),
    ...appendixTwo(dataset.systems),
  );

  const directory = outputDirectory();
  const templateDirectory = repoPath('scripts/templates');
  await mkdir(directory, { recursive: true });
  const promptFiles = await Promise.all(
    PROMPT_TEMPLATES.map(async (file) => ({
      file,
      text: await readFile(join(templateDirectory, file), 'utf8'),
    })),
  );
  const outputFiles = [{ file: RESEARCH_REQUESTS_FILE, text: out.join('\n') }, ...promptFiles].map(
    ({ file, text }) => ({ path: join(directory, file), text }),
  );
  await Promise.all(outputFiles.map(({ path, text }) => writeFile(path, text, 'utf8')));
  await formatGeneratedMarkdown(outputFiles.map(({ path }) => path));
  console.log(
    `data:gaps: ${entries.length} open quantities across ${machineCount} machines, ` +
      `plus ${unbacked.figures} figures across ${unbacked.machines} machines shown on no ` +
      `retrieved document, written to ${directory}`,
  );
}

/**
 * Figures the catalog shows that no retrieved document backs.
 *
 * A different question from the rest of this file, and for the same reader. The
 * entries above are quantities nobody could state; these are quantities somebody
 * stated on the strength of a document that cannot be produced, an address that
 * returns nothing, or a page that turns out to be about other hardware. The
 * number may well be right. What is missing is the paper.
 *
 * The test is deliberately mechanical: a figure counts as unbacked when not one
 * of the documents it cites has ever been retrieved and transcribed. That is
 * checkable offline and it does not depend on anybody's opinion of the source.
 */
function unverified(
  systems: readonly System[],
  components: readonly Component[],
  measurements: readonly Measurement[],
  sources: readonly Source[],
  extracts: readonly { readonly sourceId: string }[],
  availabilityBySystem: ReadonlyMap<string, RecordAvailability>,
): { readonly lines: readonly string[]; readonly figures: number; readonly machines: number } {
  const transcribed = new Set(extracts.map((extract) => extract.sourceId));
  const byId = new Map(sources.map((source) => [source.id, source]));
  const backed = (id: string): boolean => {
    const source = byId.get(id);
    return source !== undefined && (source.fetch !== undefined || transcribed.has(id));
  };

  const componentMap = new Map(components.map((component) => [component.id, component]));
  const ownerOf = new Map<string, string>();
  for (const system of systems) {
    for (const componentId of componentsOf(system)) {
      if (!ownerOf.has(componentId)) ownerOf.set(componentId, system.id);
    }
  }

  const byMachine = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    if (measurement.quantity.state !== 'value') continue;
    if (measurement.sourceIds.length === 0) continue;
    if (measurement.sourceIds.some(backed)) continue;
    const owner =
      measurement.subject.kind === 'system'
        ? measurement.subject.id
        : ownerOf.get(measurement.subject.id);
    if (owner === undefined) continue;
    byMachine.set(owner, [...(byMachine.get(owner) ?? []), measurement]);
  }

  const machines = [...byMachine.keys()]
    .map((id) => systems.find((system) => system.id === id))
    .filter((system): system is System => system !== undefined)
    .toSorted((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  const total = [...byMachine.values()].reduce((sum, list) => sum + list.length, 0);

  const out: string[] = [
    '## Part V, figures shown on a document nobody could open',
    '',
    `${total} figures across ${machines.length} machines.`,
    '',
    'These are not gaps. Each of these quantities has a number, and that number is',
    'on the site today. What none of them has is a document anybody has retrieved:',
    'the cited address returns nothing, or it resolves to a page about different',
    'hardware. Every figure here is marked provisional, which keeps it out of the',
    'comparisons that multiply one machine by another, and each carries a note',
    'saying which of the two problems it has.',
    '',
    'What would close an entry is a document that states the same quantity for the',
    'same machine, and, where the number below turns out to be wrong, a document',
    'that states a different one. Both are useful. A finding that contradicts the',
    'figure is worth more than one that confirms it, because the figure is',
    'currently unfalsifiable.',
    '',
  ];

  for (const system of machines) {
    const list = (byMachine.get(system.id) ?? []).toSorted((a, b) => a.id.localeCompare(b.id));
    const cited = new Set(list.flatMap((measurement) => measurement.sourceIds));
    const availability = availabilityBySystem.get(system.id);
    if (availability === undefined) {
      throw new Error(`data:gaps: missing availability for ${system.id}`);
    }
    out.push(
      `### ${system.name}`,
      '',
      `${system.manufacturer} · ${system.releaseDate} · ${system.type} · \`${system.slug}\` · ${availabilityLabel(availability)}`,
      '',
      `Documents cited but never retrieved: ${[...cited]
        .map((id) => describeSource(id, byId))
        .join('; ')}.`,
      '',
    );
    for (const measurement of list) {
      const metric = METRIC_NOTES[measurement.metric];
      const quantity =
        measurement.quantity.state === 'value'
          ? `${measurement.quantity.value} ${measurement.quantity.unit}`
          : '';
      out.push(
        `- **\`${measurement.id}\`**. ${metric?.label ?? measurement.metric}, for ${subjectOf(
          measurement,
          componentMap,
        )}. Shown as **${quantity}**, scope \`${measurement.scope}\`.`,
      );
    }
    out.push('');
  }

  return { lines: out, figures: total, machines: machines.length };
}

/** Metrics with so few records that the machines have no entry at all, not even an unknown. */
function appendixOne(
  systems: readonly System[],
  measurements: readonly Measurement[],
): readonly string[] {
  const guidance = new Set(['apollo-guidance-computer-block-ii', 'saturn-lvdc']);
  const composite = new Set(
    systems.filter((system) => system.slug.endsWith('-pc')).map((system) => system.slug),
  );

  const asks: readonly BulkAsk[] = [
    {
      metric: 'transistor-count',
      label: 'Transistor count',
      description:
        'A vendor-stated count for one named processor or graphics die, not for a machine as a whole. A count for another revision or another die of the same family is a different number, so which die it is belongs with the figure.',
      skip: (system) => guidance.has(system.slug),
    },
    {
      metric: 'process-node',
      label: 'Process node',
      description:
        'The node a processor or graphics die was fabricated on, as the vendor or foundry names it, together with the foundry. Node names are marketing labels rather than dimensions, so the label and its owner are both part of the answer.',
      skip: (system) => guidance.has(system.slug),
    },
    {
      metric: 'launch-price',
      label: 'Launch price',
      description:
        'One currency, one market, at launch, from a document stating it as the asking price, a press release, a printed advertisement, a contemporary trade report. Where a machine launched in several configurations, the priced one has to be named.',
      skip: (system) => guidance.has(system.slug) || composite.has(system.slug),
    },
    {
      metric: 'memory-bus-width',
      label: 'Memory bus width',
      description:
        'The width of the memory interface in bits, for one specific machine or card. Frequently the missing input that would let a bandwidth be derived rather than hunted for.',
      skip: (system) => guidance.has(system.slug) || composite.has(system.slug),
    },
    {
      metric: 'dhrystone-mips-per-mhz',
      label: 'Dhrystone MIPS per MHz',
      description:
        'Recorded for ten Intel x86 generations and for nothing else. The non-x86 processors in the catalog, ARM, 68000, MIPS, PowerPC, SuperH, 6502-class parts, have none, and a figure needs its Dhrystone version (1.1 and 2.1 are different quantities), compiler and settings. ARM has historically published DMIPS/MHz for its own cores; processor manuals and contemporary trade press carry others.',
      skip: (system) =>
        guidance.has(system.slug) || composite.has(system.slug) || system.type === 'accelerator',
    },
  ];

  const has = (system: System, metric: Measurement['metric']): boolean => {
    const fitted = componentsOf(system);
    return measurements.some(
      (measurement) =>
        measurement.metric === metric &&
        ((measurement.subject.kind === 'system' && measurement.subject.id === system.id) ||
          (measurement.subject.kind === 'component' && fitted.has(measurement.subject.id))),
    );
  };

  const out: string[] = [
    '## Appendix 1, quantities the catalog has barely asked',
    '',
    'These are not unknowns. They are metrics the catalog carries and has almost',
    'never filled in, so for the machines listed there is no record of any kind. The',
    'work is bulkier and more mechanical than the entries above: one number, one',
    'document, one locator, repeated across many machines.',
    '',
  ];
  for (const ask of asks) {
    const present = systems.filter((system) => has(system, ask.metric));
    const missing = systems.filter((system) => !has(system, ask.metric) && !ask.skip(system));
    out.push(
      `### ${ask.label}`,
      '',
      ask.description,
      '',
      `Recorded for ${present.length} of ${systems.length} machines${
        present.length === 0 ? '' : `: ${present.map((system) => system.name).join(', ')}`
      }.`,
      '',
      `Absent for: ${missing.map((system) => `\`${system.slug}\``).join(', ')}.`,
      '',
    );
  }
  return out;
}

function appendixTwo(systems: readonly System[]): readonly string[] {
  const out: string[] = [
    '## Appendix 2, the complete machine list',
    '',
    'Every machine in the catalog, with the identifier a finding is filed under.',
    '',
    '| Identifier | Machine | Maker | Released | Type |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const system of systems.toSorted((a, b) => a.releaseDate.localeCompare(b.releaseDate))) {
    out.push(
      `| \`${system.slug}\` | ${system.name} | ${system.manufacturer} | ${system.releaseDate} | ${system.type} |`,
    );
  }
  out.push('');
  return out;
}

await main();
