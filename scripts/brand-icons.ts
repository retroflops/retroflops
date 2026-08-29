// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `brand:icons`, every icon this project ships, composed from one drawing.
 *
 * [brand/logo.svg](../brand/logo.svg) is the only place a curve is drawn. It
 * holds the stencil alphabet, the mark, the wordmark and the tile in `<defs>`;
 * this script lifts those definitions out and re-wraps them for each output, so
 * a favicon, an Apple touch icon and a social preview cannot disagree about
 * what the logo looks like. Nothing here re-draws anything, and nothing
 * downstream is hand-edited.
 *
 * The offline counterpart of `data:images`, and it takes the same position on
 * reproducibility. Composing an SVG is pure text and is byte-identical
 * everywhere; rasterizing it is not, the encoder is a native library whose
 * build differs between a laptop and a CI runner. So `--check` verifies what a
 * reviewer actually needs verified: that the artwork the committed file was
 * made from still hashes to what was recorded, and that the committed file is
 * still the format, size and dimensions it claims to be. Regenerating is a
 * deliberate act, like a curation round, not something a gate demands.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import sharp from 'sharp';

import { repoPath, sha256, writeJsonFileIfChanged } from './lib/io.ts';

/** Where the recorded state of every generated file lives. */
const MANIFEST_FILE = 'brand/generated-icons.json';
const SOURCE_FILE = 'brand/logo.svg';

/** Palette, repeated here because an SVG cannot read a CSS custom property. */
const PAPER = '#f4f0e6';
const GRAPHITE = '#1c1e1d';
const PHOSPHOR = '#16a862';

/** The source lockup's own dimensions, checked against the file on load. */
const LOCKUP_WIDTH = 2278;
const LOCKUP_HEIGHT = 512;

/**
 * A PNG nobody should have to wait for. Flat color at these sizes compresses
 * to a fraction of it; the limit exists to catch a recipe that has started
 * emitting a photograph-sized file, not to be approached.
 */
const MAX_PNG_BYTES = 150 * 1024;

interface Artwork {
  /** Viewport of the emitted SVG, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
  /** Markup placed inside the root `<svg>`, referencing the source's defs. */
  readonly body: string;
  /** Definitions this composition adds of its own, such as a fill pattern. */
  readonly extraDefs?: string;
}

type OutputFormat = 'svg' | 'png' | 'ico';

interface OutputSpec {
  /** Repository-relative path of the file this produces. */
  readonly path: string;
  readonly format: OutputFormat;
  readonly artwork: Artwork;
  /** Rendered pixel size; for an ICO, every size it contains. */
  readonly sizes: readonly number[];
  /** Why the file exists, printed by the report, and the reason not to delete it. */
  readonly why: string;
}

interface OutputRecord {
  readonly artworkSha256: string;
  readonly fileSha256: string;
  readonly bytes: number;
  readonly format: OutputFormat;
  readonly width: number;
  readonly height: number;
  readonly why: string;
}

/* -------------------------------------------------------------------------- */
/* The source's definitions                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The `<defs>` children of the master drawing, by id.
 *
 * A hand-rolled scan rather than a parser dependency: the input is one file
 * this repository writes, and the only structure that matters is where each
 * top-level child begins and ends. Anything it cannot make sense of stops the
 * run instead of being skipped, because a definition silently dropped here
 * would come out as a blank icon.
 */
function parseDefinitions(svg: string): Map<string, string> {
  const open = svg.indexOf('<defs>');
  const close = svg.indexOf('</defs>');
  if (open === -1 || close === -1) {
    throw new Error(`${SOURCE_FILE} has no <defs> block to compose from`);
  }
  const inner = svg.slice(open + '<defs>'.length, close);

  const definitions = new Map<string, string>();
  let cursor = 0;
  while (cursor < inner.length) {
    const character = inner[cursor] ?? '';
    if (character.trim() === '') {
      cursor += 1;
      continue;
    }
    if (inner.startsWith('<!--', cursor)) {
      const end = inner.indexOf('-->', cursor);
      if (end === -1) {
        throw new Error(`${SOURCE_FILE} has an unterminated comment inside <defs>`);
      }
      cursor = end + '-->'.length;
      continue;
    }
    if (character !== '<') {
      throw new Error(`${SOURCE_FILE} has stray text inside <defs> at offset ${cursor}`);
    }

    const [element, next] = readElement(inner, cursor);
    const id = /\sid="([\w-]+)"/.exec(element)?.[1];
    if (id === undefined) {
      throw new Error(`${SOURCE_FILE} has a definition without an id: ${element.slice(0, 60)}…`);
    }
    if (definitions.has(id)) {
      throw new Error(`${SOURCE_FILE} defines "${id}" twice`);
    }
    definitions.set(id, element);
    cursor = next;
  }
  return definitions;
}

/** One element starting at `start`, returned with the offset just past it. */
function readElement(markup: string, start: number): [string, number] {
  const name = /^<([\w:-]+)/.exec(markup.slice(start))?.[1];
  if (name === undefined) {
    throw new Error(`${SOURCE_FILE} has an unreadable tag at offset ${start}`);
  }

  let cursor = start;
  let depth = 0;
  while (cursor < markup.length) {
    const tagEnd = findTagEnd(markup, cursor);
    const tag = markup.slice(cursor, tagEnd);
    if (tag.startsWith(`</${name}`)) {
      depth -= 1;
      if (depth === 0) {
        return [markup.slice(start, tagEnd), tagEnd];
      }
    } else if (tag.startsWith(`<${name}`)) {
      if (tag.endsWith('/>')) {
        if (depth === 0) {
          return [markup.slice(start, tagEnd), tagEnd];
        }
      } else {
        depth += 1;
      }
    }
    cursor = tagEnd;
    const nextTag = markup.indexOf('<', cursor);
    if (nextTag === -1) {
      break;
    }
    cursor = nextTag;
  }
  throw new Error(`${SOURCE_FILE} has an unclosed <${name}> inside <defs>`);
}

/** The offset just past the `>` of the tag starting at `start`, quotes respected. */
function findTagEnd(markup: string, start: number): number {
  let quote: string | undefined;
  for (let cursor = start; cursor < markup.length; cursor += 1) {
    const character = markup[cursor];
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      return cursor + 1;
    }
  }
  throw new Error(`${SOURCE_FILE} has an unterminated tag at offset ${start}`);
}

/**
 * Composes one standalone SVG, carrying only the definitions it actually uses.
 *
 * References are followed transitively, so asking for the mark brings the two
 * glyphs it is built from and nothing else: a favicon does not ship the
 * wordmark's eight letters to draw two.
 */
function compose(artwork: Artwork, definitions: ReadonlyMap<string, string>): string {
  const needed = new Set<string>();
  const queue = [...referencedIds(artwork.body), ...referencedIds(artwork.extraDefs ?? '')];
  while (queue.length > 0) {
    const id = queue.pop() ?? '';
    if (needed.has(id)) {
      continue;
    }
    const definition = definitions.get(id);
    if (definition === undefined) {
      throw new Error(`the composition references "#${id}", which ${SOURCE_FILE} does not define`);
    }
    needed.add(id);
    queue.push(...referencedIds(definition));
  }

  // Source order, so two compositions that need the same definitions agree on
  // how they are laid out and a diff of the outputs stays readable.
  const used = [...definitions.entries()]
    .filter(([id]) => needed.has(id))
    .map(([, markup]) => `    ${markup}`)
    .join('\n');

  const defs = [artwork.extraDefs === undefined ? '' : `    ${artwork.extraDefs}`, used]
    .filter((part) => part !== '')
    .join('\n');

  return [
    '<!-- Generated by "pnpm brand:icons" from brand/logo.svg. Do not edit. -->',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${artwork.viewBox}" ` +
      `width="${artwork.width}" height="${artwork.height}" role="img" aria-label="RetroFlops">`,
    '  <title>RetroFlops</title>',
    '  <defs>',
    defs,
    '  </defs>',
    artwork.body
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    '</svg>',
    '',
  ].join('\n');
}

function referencedIds(markup: string): string[] {
  return [...markup.matchAll(/href="#([\w-]+)"/g)].map((match) => match[1] ?? '');
}

/* -------------------------------------------------------------------------- */
/* The compositions                                                            */
/* -------------------------------------------------------------------------- */

/** The rounded tile: the logo as it appears anywhere the corners are ours to draw. */
const TILE: Artwork = {
  width: 512,
  height: 512,
  viewBox: '0 0 512 512',
  body: '<use href="#tile" />\n<use href="#mark" />',
};

/**
 * The same mark on a square that bleeds to the edge.
 *
 * iOS and GitHub both round an icon themselves, and a rounded tile inside their
 * rounding shows as a dark ring with paper corners behind it.
 */
const PLATE: Artwork = {
  width: 512,
  height: 512,
  viewBox: '0 0 512 512',
  body: '<use href="#plate" />\n<use href="#mark" />',
};

/**
 * The maskable variant, whose mark sits inside the safe circle.
 *
 * Android may crop this to any shape it likes, a circle, a squircle, a
 * teardrop, and only the middle 80% is guaranteed to survive, so the mark is
 * scaled to fit inside it rather than trusting the corners.
 */
const MASKABLE: Artwork = {
  width: 512,
  height: 512,
  viewBox: '0 0 512 512',
  body: [
    '<use href="#plate" />',
    '<g transform="translate(256 256) scale(0.72) translate(-256 -256)">',
    '  <use href="#mark" />',
    '</g>',
  ].join('\n'),
};

/** Tile, wordmark and paper, the horizontal lockup as a standalone file. */
const LOCKUP: Artwork = {
  width: LOCKUP_WIDTH,
  height: LOCKUP_HEIGHT + 96,
  viewBox: `0 -48 ${LOCKUP_WIDTH} ${LOCKUP_HEIGHT + 96}`,
  body: [
    `<rect x="0" y="-48" width="${LOCKUP_WIDTH}" height="${LOCKUP_HEIGHT + 96}" fill="${PAPER}" />`,
    '<use href="#tile" />',
    '<use href="#mark" />',
    `<g color="${GRAPHITE}">`,
    '  <use href="#wordmark" transform="translate(608 156) scale(2.5)" />',
    '</g>',
  ].join('\n'),
};

/** One corner of the drawing frame: a short vertical and horizontal at `(x, y)`. */
function cropMark(x: number, y: number, dx: number, dy: number): string {
  return `<path d="M${x} ${y + dy}V${y}H${x + dx}" />`;
}

/**
 * The social preview: 1200×630, the size every card reader crops to.
 *
 * It carries no prose, and not for want of something to say. Text in an SVG is
 * rendered with whatever font the rasterizer finds, which makes the file depend
 * on the machine that generated it, the one thing an artifact in this
 * repository may not do. So the words are the wordmark, which is drawn, and the
 * rest is the site's own furniture: a faint raster, drawing crop marks, and an
 * axis with one phosphor bar on it.
 */
function socialPreview(): Artwork {
  const width = 1200;
  const height = 630;
  const left = 144;
  const right = 1056;
  const axisY = 470;

  const ticks: string[] = [];
  for (let index = 0; index <= 12; index += 1) {
    const x = left + index * 76;
    const length = index % 4 === 0 ? 18 : 10;
    ticks.push(`<path d="M${x} ${axisY}V${axisY + length}" />`);
  }

  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    extraDefs:
      '<pattern id="raster" width="8" height="8" patternUnits="userSpaceOnUse">' +
      `<path d="M0 7.5H8" stroke="${GRAPHITE}" stroke-opacity="0.05" stroke-width="1" /></pattern>`,
    body: [
      `<rect width="${width}" height="${height}" fill="${PAPER}" />`,
      `<rect width="${width}" height="${height}" fill="url(#raster)" />`,
      `<g fill="none" stroke="${GRAPHITE}" stroke-opacity="0.35" stroke-width="3">`,
      `  ${cropMark(48, 48, 56, 56)}`,
      `  ${cropMark(width - 48, 48, -56, 56)}`,
      `  ${cropMark(48, height - 48, 56, -56)}`,
      `  ${cropMark(width - 48, height - 48, -56, -56)}`,
      '</g>',
      // The lockup at 0.4, which puts the tile at 205 px, large enough to read
      // in a timeline card scaled to a third of this size.
      '<g transform="translate(144 158) scale(0.4)">',
      '  <use href="#tile" />',
      '  <use href="#mark" />',
      `  <g color="${GRAPHITE}">`,
      '    <use href="#wordmark" transform="translate(608 156) scale(2.5)" />',
      '  </g>',
      '</g>',
      `<rect x="${left}" y="${axisY - 14}" width="228" height="8" fill="${PHOSPHOR}" />`,
      `<path d="M${left} ${axisY}H${right}" fill="none" stroke="${GRAPHITE}" stroke-width="3" />`,
      `<g fill="none" stroke="${GRAPHITE}" stroke-opacity="0.55" stroke-width="3">`,
      ...ticks.map((tick) => `  ${tick}`),
      '</g>',
    ].join('\n'),
  };
}

/**
 * Everything this project publishes a logo into.
 *
 * The web-facing files land in `public/` under the names browsers and crawlers
 * look for; the two that are uploaded somewhere else by hand land in
 * `brand/exports/`, because a GitHub avatar is not a route.
 */
const OUTPUTS: readonly OutputSpec[] = [
  {
    path: 'public/favicon.svg',
    format: 'svg',
    artwork: TILE,
    sizes: [512],
    why: 'the favicon a current browser prefers, resolution-independent',
  },
  {
    path: 'public/favicon.ico',
    format: 'ico',
    artwork: TILE,
    sizes: [16, 32, 48],
    why: 'the fallback for browsers, feed readers and bookmark bars that ask for /favicon.ico',
  },
  {
    path: 'public/apple-touch-icon.png',
    format: 'png',
    artwork: PLATE,
    sizes: [180],
    why: 'iOS home screen, which rounds the corners itself and drops any transparency',
  },
  {
    path: 'public/icon-192.png',
    format: 'png',
    artwork: TILE,
    sizes: [192],
    why: 'the web app manifest, at the size Android uses for a shortcut',
  },
  {
    path: 'public/icon-512.png',
    format: 'png',
    artwork: TILE,
    sizes: [512],
    why: 'the web app manifest, at the size used for a splash screen',
  },
  {
    path: 'public/icon-maskable-512.png',
    format: 'png',
    artwork: MASKABLE,
    sizes: [512],
    why: 'the maskable manifest icon, drawn inside the safe circle',
  },
  {
    path: 'public/og-image.png',
    format: 'png',
    artwork: socialPreview(),
    sizes: [1200],
    why: 'the Open Graph and Twitter card image every page falls back to',
  },
  {
    path: 'brand/exports/avatar-512.png',
    format: 'png',
    artwork: PLATE,
    sizes: [512],
    why: 'the GitHub organization and social profile picture, uploaded by hand',
  },
  {
    path: 'brand/exports/lockup-1600.png',
    format: 'png',
    artwork: LOCKUP,
    sizes: [1600],
    why: 'the horizontal lockup for a README, a slide or an issue, on the site paper',
  },
];

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rasterizes a composition at an exact pixel width.
 *
 * The density is computed rather than left at the default, because the default
 * renders the SVG at its own dimensions and then resamples, which turns a
 * 512-unit drawing bound for a 16 px favicon into a blur. Encoder options are
 * stated in full for the same reason `data:images` states them: a default that
 * moves with the library is an artifact that moves without an edit.
 */
async function renderPng(svg: string, artwork: Artwork, size: number): Promise<Buffer> {
  const height = Math.round((size * artwork.height) / artwork.width);
  return await sharp(Buffer.from(svg), { density: (72 * size) / artwork.width })
    .resize({ width: size, height, fit: 'fill' })
    .toColorspace('srgb')
    .png({ compressionLevel: 9, effort: 10, palette: false, adaptiveFiltering: false })
    .toBuffer();
}

/**
 * Packs PNGs into an ICO.
 *
 * The container holds whole PNG files rather than the older bitmap-and-mask
 * pair: every browser still asking for `favicon.ico`, and every Windows since
 * Vista, reads that form, and it keeps the alpha channel the rounded corners
 * need.
 */
function encodeIco(entries: readonly { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    // 256 is written as 0: the field is one byte wide and 256 does not fit.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

interface Rendered {
  readonly spec: OutputSpec;
  readonly artworkSha256: string;
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

async function render(
  spec: OutputSpec,
  definitions: ReadonlyMap<string, string>,
): Promise<Rendered> {
  const svg = compose(spec.artwork, definitions);
  const artworkSha256 = sha256(svg);
  const largest = Math.max(...spec.sizes);
  const height = Math.round((largest * spec.artwork.height) / spec.artwork.width);

  if (spec.format === 'svg') {
    return { spec, artworkSha256, bytes: Buffer.from(svg, 'utf8'), width: largest, height };
  }
  if (spec.format === 'png') {
    const bytes = await renderPng(svg, spec.artwork, largest);
    return { spec, artworkSha256, bytes, width: largest, height };
  }

  const images = await Promise.all(
    spec.sizes.map(async (size) => ({ size, data: await renderPng(svg, spec.artwork, size) })),
  );
  return { spec, artworkSha256, bytes: encodeIco(images), width: largest, height: largest };
}

/* -------------------------------------------------------------------------- */
/* Writing and checking                                                        */
/* -------------------------------------------------------------------------- */

function toRecord(rendered: Rendered, fileSha256: string, bytes: number): OutputRecord {
  return {
    artworkSha256: rendered.artworkSha256,
    fileSha256,
    bytes,
    format: rendered.spec.format,
    width: rendered.width,
    height: rendered.height,
    why: rendered.spec.why,
  };
}

/** What `--check` reads back: the record written when the file was generated. */
async function readManifest(): Promise<Record<string, OutputRecord>> {
  try {
    const text = await readFile(repoPath(MANIFEST_FILE), 'utf8');
    const parsed: unknown = JSON.parse(text);
    const outputs = (parsed as { outputs?: unknown }).outputs;
    return outputs === undefined ? {} : (outputs as Record<string, OutputRecord>);
  } catch {
    return {};
  }
}

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

async function write(rendered: readonly Rendered[]): Promise<number> {
  let changed = 0;
  await Promise.all(
    rendered.map(async (item) => {
      const path = repoPath(item.spec.path);
      const current = await readIfPresent(path);
      if (current !== undefined && current.equals(item.bytes)) {
        console.log(`  unchanged  ${item.spec.path}`);
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.bytes);
      changed += 1;
      console.log(`  written    ${item.spec.path}  ${item.bytes.length} B`);
    }),
  );

  const outputs: Record<string, OutputRecord> = {};
  for (const item of rendered) {
    outputs[item.spec.path] = toRecord(item, sha256(item.bytes), item.bytes.length);
  }
  await writeJsonFileIfChanged(repoPath(MANIFEST_FILE), {
    generatedBy: 'pnpm brand:icons',
    source: SOURCE_FILE,
    outputs,
  });
  return changed;
}

/**
 * Verifies the committed files without re-encoding anything.
 *
 * Three questions, each catching a different mistake: has the artwork moved
 * since the file was made (someone edited the logo and forgot to regenerate),
 * has the file moved since it was recorded (someone edited a PNG by hand), and
 * is the file still what it claims to be (a truncated or mislabeled image).
 */
async function check(rendered: readonly Rendered[]): Promise<string[]> {
  const manifest = await readManifest();
  const problems: string[] = [];

  const known = new Set(rendered.map((item) => item.spec.path));
  for (const path of Object.keys(manifest)) {
    if (!known.has(path)) {
      problems.push(`${path}: recorded in ${MANIFEST_FILE} but no longer generated`);
    }
  }

  const results = await Promise.all(
    rendered.map(async (item) => {
      const found: string[] = [];
      const record = manifest[item.spec.path];
      const file = await readIfPresent(repoPath(item.spec.path));

      if (record === undefined) {
        return [`${item.spec.path}: not recorded in ${MANIFEST_FILE}, run pnpm brand:icons`];
      }
      if (file === undefined) {
        return [`${item.spec.path}: missing, run pnpm brand:icons`];
      }
      if (record.artworkSha256 !== item.artworkSha256) {
        found.push(
          `${item.spec.path}: ${SOURCE_FILE} has changed since this was generated, ` +
            'run pnpm brand:icons',
        );
      }
      const digest = sha256(file);
      if (record.fileSha256 !== digest) {
        found.push(
          `${item.spec.path}: the committed file hashes to ${digest.slice(0, 12)}, but ` +
            `${MANIFEST_FILE} records ${record.fileSha256.slice(0, 12)}`,
        );
      }
      if (record.bytes !== file.length) {
        found.push(`${item.spec.path}: ${file.length} bytes on disk, ${record.bytes} recorded`);
      }

      if (item.spec.format === 'svg') {
        if (!file.equals(item.bytes)) {
          found.push(`${item.spec.path}: does not match the composition, run pnpm brand:icons`);
        }
        return found;
      }
      if (file.length > MAX_PNG_BYTES) {
        found.push(
          `${item.spec.path}: ${file.length} bytes, over the ${MAX_PNG_BYTES} byte budget`,
        );
      }
      if (item.spec.format === 'ico') {
        const count = file.readUInt16LE(4);
        if (file.readUInt16LE(2) !== 1 || count !== item.spec.sizes.length) {
          found.push(`${item.spec.path}: not an ICO holding ${item.spec.sizes.length} images`);
        }
        return found;
      }

      const metadata = await sharp(file).metadata();
      if (metadata.format !== 'png') {
        found.push(`${item.spec.path}: is a ${metadata.format ?? 'unreadable'} file, not a PNG`);
      }
      if (metadata.width !== item.width || metadata.height !== item.height) {
        found.push(
          `${item.spec.path}: is ${metadata.width}×${metadata.height}, ` +
            `expected ${item.width}×${item.height}`,
        );
      }
      return found;
    }),
  );

  return [...problems, ...results.flat()];
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');

  const source = await readFile(repoPath(SOURCE_FILE), 'utf8');
  const declared = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(source);
  if (declared?.[1] !== String(LOCKUP_WIDTH) || declared[2] !== String(LOCKUP_HEIGHT)) {
    throw new Error(
      `${SOURCE_FILE} is ${declared?.[1]}×${declared?.[2]}, but the compositions are laid out ` +
        `for ${LOCKUP_WIDTH}×${LOCKUP_HEIGHT}. Update the lockup geometry in this script too.`,
    );
  }

  const definitions = parseDefinitions(source);
  const rendered = await Promise.all(OUTPUTS.map(async (spec) => await render(spec, definitions)));

  if (checkOnly) {
    const problems = await check(rendered);
    if (problems.length > 0) {
      console.error('brand:icons --check found problems:');
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`brand:icons: ${rendered.length} generated files match ${MANIFEST_FILE}.`);
    return;
  }

  console.log(`brand:icons: composing ${rendered.length} files from ${SOURCE_FILE}`);
  const changed = await write(rendered);
  console.log(
    changed === 0
      ? 'brand:icons: nothing changed.'
      : `brand:icons: ${changed} file(s) rewritten, commit them with the logo.`,
  );
}

await main();
