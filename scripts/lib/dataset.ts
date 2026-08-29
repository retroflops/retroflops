// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Loads the canonical dataset from disk.
 *
 * Reading is deliberately separate from validation: this module reports what is
 * on disk and where it came from, and `data:validate` decides whether it is
 * acceptable. That split lets `data:normalize` rewrite records that do not yet
 * pass validation.
 */

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { readImageFile, type ImageFileReading } from '../../src/lib/data/image-file.ts';
import { CANONICAL_FORMAT } from '../../src/lib/data/image-preset.ts';
import { listYamlFiles, readYamlFile, repoPath } from './io.ts';

export const DATA_DIRECTORIES = {
  systems: repoPath('data/canonical/systems'),
  components: repoPath('data/canonical/components'),
  images: repoPath('data/canonical/images'),
  measurements: repoPath('data/canonical/measurements'),
  contextClaims: repoPath('data/canonical/context-claims'),
  derivedClaims: repoPath('data/canonical/derived'),
  conflicts: repoPath('data/canonical/conflicts'),
  sources: repoPath('data/sources'),
  extracts: repoPath('data/extracts'),
  cache: repoPath('data/cache'),
  imageCache: repoPath('data/cache/images'),
  /** Canonical AVIF files, the only image bytes this repository stores. */
  imageAssets: repoPath('src/assets/images/systems'),
  reports: repoPath('data/reports'),
  publicData: repoPath('public/data'),
} as const;

export type RecordKind =
  | 'systems'
  | 'components'
  | 'images'
  | 'measurements'
  | 'contextClaims'
  | 'derivedClaims'
  | 'conflicts'
  | 'sources'
  | 'extracts';

/** One record as found on disk, still unvalidated. */
export interface LoadedRecord {
  readonly kind: RecordKind;
  /** Absolute path of the file the record came from. */
  readonly file: string;
  /** Index within the file, for files holding an array of records. */
  readonly index: number;
  readonly value: unknown;
}

export interface RawDataset {
  readonly systems: readonly LoadedRecord[];
  readonly components: readonly LoadedRecord[];
  readonly images: readonly LoadedRecord[];
  readonly measurements: readonly LoadedRecord[];
  readonly contextClaims: readonly LoadedRecord[];
  readonly derivedClaims: readonly LoadedRecord[];
  readonly conflicts: readonly LoadedRecord[];
  readonly sources: readonly LoadedRecord[];
  readonly extracts: readonly LoadedRecord[];
}

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

/**
 * Reads one kind of record. A file may hold a single record or an array of them;
 * both shapes are common in curation, and both flatten to the same list.
 */
export async function loadRecords(kind: RecordKind): Promise<readonly LoadedRecord[]> {
  const directory = DATA_DIRECTORIES[kind];
  const files = await listYamlFiles(directory);
  const parsedFiles = await Promise.all(
    files.map(async (file) => ({ file, parsed: await readYamlFile(file) })),
  );

  return parsedFiles.flatMap(({ file, parsed }) => {
    if (Array.isArray(parsed)) {
      return parsed.map((value, index) => ({ kind, file, index, value }));
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new DatasetError(`${basename(file)}: expected an object or an array of objects`);
    }
    return [{ kind, file, index: 0, value: parsed }];
  });
}

export async function loadRawDataset(): Promise<RawDataset> {
  const [
    systems,
    components,
    images,
    measurements,
    contextClaims,
    derivedClaims,
    conflicts,
    sources,
    extracts,
  ] = await Promise.all([
    loadRecords('systems'),
    loadRecords('components'),
    loadRecords('images'),
    loadRecords('measurements'),
    loadRecords('contextClaims'),
    loadRecords('derivedClaims'),
    loadRecords('conflicts'),
    loadRecords('sources'),
    loadRecords('extracts'),
  ]);
  return {
    systems,
    components,
    images,
    measurements,
    contextClaims,
    derivedClaims,
    conflicts,
    sources,
    extracts,
  };
}

/** Where the canonical file for an image id lives. The id is the filename. */
export function imageAssetPath(imageId: string): string {
  return join(DATA_DIRECTORIES.imageAssets, `${imageId}.${CANONICAL_FORMAT}`);
}

/**
 * Reads what is actually stored for every image the dataset declares.
 *
 * An id missing from the result is a file missing from the repository, which is
 * the state validation reports; a file that cannot be parsed is present with
 * its reason, because "the bytes are not an AVIF" and "there are no bytes" are
 * different failures with different fixes.
 */
export async function loadImageFiles(
  imageIds: readonly string[],
): Promise<ReadonlyMap<string, ImageFileReading>> {
  const readings = await Promise.all(
    imageIds.map(async (id) => {
      try {
        return [id, readImageFile(await readFile(imageAssetPath(id)))] as const;
      } catch {
        return undefined;
      }
    }),
  );
  return new Map(readings.filter((entry) => entry !== undefined));
}

/** Human-readable location of a record, used in every pipeline message. */
export function describeRecord(record: LoadedRecord): string {
  const name = basename(record.file);
  const id = (record.value as { id?: unknown }).id;
  const suffix = typeof id === 'string' ? ` (${id})` : ` [${record.index}]`;
  return `${name}${suffix}`;
}

export function countRecords(dataset: RawDataset): number {
  return (
    dataset.systems.length +
    dataset.components.length +
    dataset.images.length +
    dataset.measurements.length +
    dataset.contextClaims.length +
    dataset.derivedClaims.length +
    dataset.conflicts.length +
    dataset.sources.length +
    dataset.extracts.length
  );
}
