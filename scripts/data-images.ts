// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:images`, turns a fetched original into the one file this repository
 * stores for it.
 *
 * The counterpart of `data:normalize`: offline, idempotent, and the only writer
 * of the canonical AVIF files under `src/assets/images/systems/`. Given the
 * same original and the same recipe it must produce the same bytes, which is
 * what makes the hash in the image record worth recording, and what lets
 * `data:validate` check the committed file without ever seeing the original.
 *
 * It refuses more than it fixes, on purpose. A recipe that would stretch or
 * enlarge the photograph, an original whose hash has moved, an original whose
 * pixel size is not what the record says: all stop here rather than being
 * quietly accommodated, because each one means the record describes a
 * photograph other than the one on disk.
 *
 * `--check` writes nothing and exits non-zero if anything would change, which
 * is how a hand-edited hash or a stale canonical file is caught.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp, { type Sharp } from 'sharp';

import {
  CANONICAL_HEIGHT,
  CANONICAL_QUALITY,
  CANONICAL_WIDTH,
  CANONICAL_MAX_BYTES,
  checkTransformRecipe,
} from '../src/lib/data/image-preset.ts';
import { imageAssetSchema, type ImageAsset } from '../src/lib/data/schema.ts';
import { DATA_DIRECTORIES, imageAssetPath, loadRecords } from './lib/dataset.ts';
import { readYamlDocument, sha256, writeYamlDocumentIfChanged } from './lib/io.ts';

interface ImageOutcome {
  readonly id: string;
  readonly status: 'written' | 'unchanged' | 'skipped' | 'failed';
  readonly detail: string;
}

/**
 * Encoding options are stated in full rather than left to defaults, because a
 * default that changes with the library is a hash that changes without a data
 * change, and the whole point of storing the hash is that it does not.
 *
 * `background` turns the reduction into a `contain` fit: the photograph lands
 * inside the frame at its own proportions and the remainder is the margin the
 * record declares. Without it the input is already 4:3 and the fit is exact.
 */
async function encode(pipeline: Sharp, background?: string): Promise<Buffer> {
  return await pipeline
    .resize({
      width: CANONICAL_WIDTH,
      height: CANONICAL_HEIGHT,
      fit: background === undefined ? 'fill' : 'contain',
      position: 'center',
      ...(background === undefined ? {} : { background }),
    })
    .toColorspace('srgb')
    .avif({ quality: CANONICAL_QUALITY, effort: 4, chromaSubsampling: '4:4:4', lossless: false })
    .toBuffer();
}

/** Applies the record's recipe, producing the exact bytes the repository stores. */
async function render(image: ImageAsset, original: Buffer): Promise<Buffer> {
  // Metadata is dropped rather than carried: a stored photograph should not
  // publish somebody's camera serial number or the coordinates of their desk.
  const source = sharp(original, { failOn: 'error' }).rotate();

  switch (image.transform.fit) {
    case 'crop': {
      const region = image.transform.region;
      if (region === undefined) {
        throw new Error('a crop recipe without a region should have been refused');
      }
      return await encode(
        source.extract({
          left: region.x,
          top: region.y,
          width: region.width,
          height: region.height,
        }),
      );
    }
    case 'pad': {
      // The margin is added in output pixels rather than around the original:
      // sharp applies `extend` after the resize, so padding the original first
      // would be silently reordered into padding the reduction.
      return await encode(source, image.transform.background);
    }
    default: {
      return await encode(source);
    }
  }
}

async function processImage(
  image: ImageAsset,
  file: string,
  checkOnly: boolean,
): Promise<ImageOutcome> {
  const fail = (detail: string): ImageOutcome => ({ id: image.id, status: 'failed', detail });

  let original: Buffer;
  try {
    original = await readFile(join(DATA_DIRECTORIES.imageCache, image.id, 'original'));
  } catch {
    return {
      id: image.id,
      status: 'skipped',
      detail: `no cached original; run pnpm data:fetch --only ${image.id}`,
    };
  }

  const digest = sha256(original);
  if (digest !== image.original.sha256) {
    return fail(
      `the cached original hashes to ${digest.slice(0, 12)}, but the record states ` +
        `${image.original.sha256.slice(0, 12)}`,
    );
  }

  const reasons = checkTransformRecipe(image.transform);
  if (reasons.length > 0) {
    return fail(`the recipe is not admissible: ${reasons.join(', ')}`);
  }

  const metadata = await sharp(original).metadata();
  // `rotate()` applies the EXIF orientation, so an upright photograph stored
  // sideways would make every coordinate in a crop rectangle wrong.
  const upright = (metadata.orientation ?? 1) >= 5;
  const width = upright ? (metadata.height ?? 0) : (metadata.width ?? 0);
  const height = upright ? (metadata.width ?? 0) : (metadata.height ?? 0);
  if (width !== image.original.width || height !== image.original.height) {
    return fail(
      `the original is ${width}×${height}, but the record states ` +
        `${image.original.width}×${image.original.height}`,
    );
  }

  let canonical: Buffer;
  try {
    canonical = await render(image, original);
  } catch (error) {
    return fail((error as Error).message);
  }

  if (canonical.byteLength > CANONICAL_MAX_BYTES) {
    return fail(
      `the encoded file is ${canonical.byteLength} bytes, over the ${CANONICAL_MAX_BYTES} byte ` +
        'limit. Crop tighter or choose a photograph with less noise; the quality is fixed by the preset.',
    );
  }

  const target = imageAssetPath(image.id);
  const canonicalDigest = sha256(canonical);
  let current: Buffer | undefined;
  try {
    current = await readFile(target);
  } catch {
    current = undefined;
  }

  const fileChanged = current === undefined || sha256(current) !== canonicalDigest;
  const recordChanged =
    image.canonical.sha256 !== canonicalDigest ||
    image.canonical.byteLength !== canonical.byteLength;

  if (!fileChanged && !recordChanged) {
    return { id: image.id, status: 'unchanged', detail: `${canonical.byteLength} bytes` };
  }

  if (checkOnly) {
    return fail(
      `${fileChanged ? 'the stored file' : 'the record'} is stale; run pnpm data:images and ` +
        'commit the result',
    );
  }

  await mkdir(DATA_DIRECTORIES.imageAssets, { recursive: true });
  await writeFile(target, canonical);
  const { text, document } = await readYamlDocument(file);
  document.set('canonical', {
    ...image.canonical,
    byteLength: canonical.byteLength,
    sha256: canonicalDigest,
  });
  await writeYamlDocumentIfChanged(file, text, document);

  return {
    id: image.id,
    status: 'written',
    detail: `${canonical.byteLength} bytes  sha256:${canonicalDigest.slice(0, 12)}`,
  };
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const records = await loadRecords('images');

  const outcomes: ImageOutcome[] = [];
  for (const record of records) {
    const parsed = imageAssetSchema.safeParse(record.value);
    if (!parsed.success) {
      outcomes.push({
        id: String((record.value as { id?: unknown }).id ?? record.file),
        status: 'failed',
        detail: 'does not match the image schema; run pnpm data:validate',
      });
      continue;
    }
    // Sequential: each image is an encode that already saturates the machine,
    // and a readable log matters more here than a second saved.
    // oxlint-disable-next-line no-await-in-loop
    outcomes.push(await processImage(parsed.data, record.file, checkOnly));
  }

  for (const outcome of outcomes) {
    console.log(`  ${outcome.status.padEnd(10)} ${outcome.id}  ${outcome.detail}`);
  }
  console.log(`data:images${checkOnly ? ' --check' : ''}: ${outcomes.length} image(s)`);

  if (outcomes.some((outcome) => outcome.status === 'failed')) {
    process.exitCode = 1;
  }
}

await main();
