// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:image-gaps`, the machines with no photograph, written for somebody
 * outside this project.
 *
 * The counterpart of `data:gaps`, and it exists for the same reason: a gap
 * nobody can see is a gap nobody closes. Where that document asks for a figure
 * and a document stating it, this one asks for a picture and the terms under
 * which it may be republished.
 *
 * The readership is why the output names no file, no command and no schema
 * field: an entry is a machine, what it is, when it appeared, and what a usable
 * photograph of it would have to show. What it is emphatically not is a gate.
 * "Every machine has a photograph" is not a state this catalog will ever
 * reach, nobody has photographed a Saturn instrument unit under terms this
 * project can publish, so an absence here is a standing invitation and never a
 * build failure.
 *
 * Offline and read-only apart from the document it writes. Regenerate after a
 * curation round and run `pnpm format` after it, which wraps the prose.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { resolveEditorialText } from '../src/lib/data/editorial-text.ts';
import type { System } from '../src/lib/data/schema.ts';
import { loadRawDataset } from './lib/dataset.ts';
import { formatGeneratedMarkdown } from './lib/format-generated-markdown.ts';
import { repoPath } from './lib/io.ts';
import { parseDataset } from './lib/parse.ts';

const DEFAULT_OUTPUT_DIRECTORY = 'data/reports/research';
const IMAGE_REQUESTS_FILE = 'image-requests.md';

function outputDirectory(): string {
  const index = process.argv.indexOf('--output-directory');
  const target = index === -1 ? DEFAULT_OUTPUT_DIRECTORY : process.argv[index + 1];
  if (target === undefined) {
    throw new Error('data:image-gaps: --output-directory needs a path');
  }
  return resolve(isAbsolute(target) ? target : repoPath(target));
}

/** External research briefs need copy-and-paste-safe plain text, not web typography. */
function plainText(value: string): string {
  return value.replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ');
}

/**
 * The ten records that describe a processor in a typical machine of its era
 * rather than a machine anybody sold.
 *
 * They are listed as `personal-computer` because that is what they stand for,
 * and photographing one would be a small false statement: a picture of some
 * beige tower under "Intel 80386DX PC" tells a reader this catalog holds a
 * record about that tower, which it does not. They are named individually
 * rather than matched on the slug suffix, so a real machine can never fall into
 * the group by accident of naming.
 */
const REFERENCE_PLATFORMS: ReadonlySet<string> = new Set([
  'intel-8086-pc',
  'intel-80286-pc',
  'intel-80386dx-pc',
  'intel-80486dx-pc',
  'intel-pentium-pc',
  'intel-pentium-ii-pc',
  'intel-pentium-4-pc',
  'intel-core-2-duo-e6600-pc',
  'intel-core-i7-2600k-pc',
  'intel-core-i9-14900k-pc',
]);

interface Group {
  readonly id: string;
  readonly title: string;
  /** What a photograph of this kind of machine has to show, and what spoils one. */
  readonly blurb: string;
  readonly holds: (system: System) => boolean;
  /** Groups where the absence is the answer rather than the request. */
  readonly wanted: boolean;
}

const GROUPS: readonly Group[] = [
  {
    id: '1',
    title: 'Consoles',
    wanted: true,
    blurb:
      'Show the console itself. Include its controller when that helps identify the machine. Regional cases matter. A Mega Drive and a Genesis share hardware but not a shell, as do a Famicom and a Nintendo Entertainment System. The photograph must make the pictured version clear.',
    holds: (system) => system.type === 'console',
  },
  {
    id: '2',
    title: 'Home and personal computers',
    wanted: true,
    blurb:
      'Show the complete machine as sold. A keyboard computer needs no monitor beside it. A boxed computer may include a period monitor and drive. Do not use heavily modified or recased examples.',
    holds: (system) =>
      system.type === 'home-computer' ||
      (system.type === 'personal-computer' && !REFERENCE_PLATFORMS.has(system.slug)),
  },
  {
    id: '3',
    title: 'Graphics cards, accelerators and workstations',
    wanted: true,
    blurb:
      'A card on a table and a card installed in a machine answer different questions. Either works if the photograph makes the setting clear. The board must be the whole subject, with enough of the cooler, bracket and board visible to identify it. A glimpse inside a lit case is not enough.',
    holds: (system) => system.type === 'accelerator' || system.type === 'workstation',
  },
  {
    id: '4',
    title: 'Phones and portable machines',
    wanted: true,
    blurb:
      "Prefer a photograph with the screen off. A lit screen republishes somebody else's interface along with the hardware. If the screen is lit, its contents must be describable in one sentence.",
    holds: (system) => system.type === 'smartphone' || system.type === 'handheld',
  },
  {
    id: '5',
    title: 'Flight and guidance hardware',
    wanted: true,
    blurb:
      'Look first in the archives of the agencies that built these machines. Museum objects and flight spares are usable. A training mock-up or replica is also usable when labeled as such. A photograph dominated by a display case does not show the computer well enough.',
    holds: (system) => system.type === 'guidance-computer',
  },
  {
    id: '6',
    title: 'Reference platforms, which are not being asked for',
    wanted: false,
    blurb:
      'Do not send photographs for these entries. Each one represents a processor in a typical computer of its era, not a product that somebody sold. Any case would falsely tie the record to one specific machine. The list records that decision.',
    holds: () => true,
  },
];

function frontMatter(
  wantedCount: number,
  systemCount: number,
  illustrated: number,
  today: string,
): string {
  return `# Photograph requests

A list of machines in a comparative hardware catalog, ${systemCount} computers,
consoles, phones and graphics cards, from the Apollo Guidance Computer to the
present, that are described in words and shown in no picture. ${illustrated} of them
have a photograph; ${wantedCount} are being looked for.

Compiled ${today}. It is a snapshot, and it is not a checklist to be completed:
some of these machines may never be photographed under terms this catalog can
publish, and an entry that stays open for good is an acceptable outcome.

## What is being asked for

One photograph per machine, of the machine.

- **The whole device.** Not a detail, not an open case, not a circuit board
  unless the board is the product. A packshot of the box is a photograph of a
  box; a screenshot of software running on the machine is a photograph of
  nothing at all.
- **Unmodified.** Recapped, retrobrighted or repainted examples, third-party
  shells, mounted expansions and aftermarket parts all show a machine that is
  no longer the one described. Wear and yellowing are the honest condition of
  forty-year-old plastic and are not modifications.
- **Identifiable as the model named.** Where the photographed variant differs
  from the one the entry describes, such as a later revision or another region's case,
  a different bundled controller, that is usable, and the difference has to be
  stated so it can be printed under the picture.
- **Legible at a glance.** Landscape, roughly 4:3 or wider, and at least
  1280 pixels across before any cropping. A photograph is reduced to a fixed
  frame for publication, so anything smaller cannot be used and nothing is ever
  enlarged.
- **Described in words.** A sentence saying what the picture shows, written for
  a reader who cannot see it, describing the device rather than the setting.

## What terms are acceptable

Photographs are republished here rather than merely cited, so the terms matter
more than the source's standing does. Two bases are accepted and both are held
to the same standard of checkability:

- **A license.** Creative Commons Attribution or Attribution-ShareAlike, in a
  stated version.
- **The public domain.** A Public Domain Mark, a CC0 dedication, a
  photographer's own release of their work, or a work made by a US federal
  government employee in the course of their duties.

Refused, whatever the picture: any license carrying a non-commercial or
no-derivatives condition, since every published photograph here is resized and
re-encoded; a file with no statement of terms at all, which on a photograph
means all rights reserved rather than probably fine; and a statement that
belongs to a website rather than to the file, such as a notice in a site footer.

The terms must be stated on the page that describes the file, and the
photographer must be named. Naming them is a rule of this catalog rather than
a condition of the terms: under a public domain release nobody can require it,
which is exactly why it is required here.

## What to hand back

One block per machine attempted, keeping the reference key exactly as it is
printed below.

\`\`\`
ITEM: <reference key, verbatim>
FILE PAGE:   <address of the page describing the file>
FILE:        <address of the full-resolution image itself>
CREATOR:     <photographer or institution, spelled as the page spells it>
TITLE:       <the file's own title>
PUBLISHED BY: <the archive, repository or museum hosting it>
TERMS:       <license and version, or which public domain basis>
STATEMENT:   "<the sentence on that page stating the terms, verbatim>"
DIMENSIONS:  <width x height in pixels>
SHOWS:       <what is in the picture, including anything beside the machine>
VARIANT:     <the exact model or region photographed, if it differs from the entry>
\`\`\`

Where nothing usable exists, say what came closest and why it failed. Common
reasons include a small file, incompatible terms, a modified machine, or a page
with no rights statement. This result prevents the next researcher from
repeating the same search.
`;
}

async function main(): Promise<void> {
  const raw = await loadRawDataset();
  const { dataset, issues } = parseDataset(raw);
  if (issues.length > 0) {
    console.error('data:image-gaps: the records do not parse; run pnpm data:validate first');
    process.exitCode = 1;
    return;
  }

  const measurements = new Map(dataset.measurements.map((record) => [record.id, record]));
  const contextClaims = new Map(dataset.contextClaims.map((record) => [record.id, record]));

  const missing = dataset.systems.filter(
    (system) => system.imageIds === undefined || system.imageIds.length === 0,
  );
  const illustrated = dataset.systems.length - missing.length;

  // The last group holds anything the others do not, so every machine lands.
  const groupOf = new Map<string, Group>();
  for (const system of missing) {
    const group = GROUPS.find((candidate) => candidate.holds(system));
    if (group !== undefined) groupOf.set(system.id, group);
  }

  const wantedCount = missing.filter((system) => groupOf.get(system.id)?.wanted === true).length;
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [frontMatter(wantedCount, dataset.systems.length, illustrated, today)];

  for (const group of GROUPS) {
    const machines = missing
      .filter((system) => groupOf.get(system.id) === group)
      .toSorted((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    if (machines.length === 0) continue;

    out.push(
      `## Group ${group.id}, ${group.title}`,
      '',
      `${machines.length} machine${machines.length === 1 ? '' : 's'}.`,
      '',
      group.blurb,
      '',
    );

    for (const system of machines) {
      const aliases =
        system.aliases === undefined || system.aliases.length === 0
          ? ''
          : `\n\nAlso known as: ${system.aliases.join(', ')}.`;
      out.push(
        `### ${system.name}`,
        '',
        `${system.manufacturer} · ${system.releaseDate} · ${system.region} · \`${system.slug}\`${aliases}`,
        '',
        plainText(resolveEditorialText(system.summary, measurements, contextClaims)),
        '',
      );
    }
  }

  const directory = outputDirectory();
  const path = join(directory, IMAGE_REQUESTS_FILE);
  await mkdir(directory, { recursive: true });
  await writeFile(path, out.join('\n'), 'utf8');
  await formatGeneratedMarkdown([path]);
  console.log(
    `data:image-gaps: ${illustrated} of ${dataset.systems.length} machines have a photograph; ` +
      `${wantedCount} are being looked for, written to ${path}`,
  );
}

await main();
