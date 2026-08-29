// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * What a stored image file is, read from its own bytes.
 *
 * An image record states a format, a size in pixels, a size in bytes and a
 * hash. Every one of those is a claim about a file, and a claim about a file is
 * checkable, so none of them is taken on trust. This module answers the
 * question the record cannot: what is really in `src/assets/images/`.
 *
 * AVIF is ISO base media format, so the bytes are a tree of length-prefixed
 * boxes. Two of them are enough here: `ftyp` says what the file claims to be,
 * and `ispe`, the image spatial extents property, says how large the image
 * is. A full parser is not needed and would be a liability: this one refuses
 * anything it cannot read rather than guessing, which is the behavior a gate
 * wants.
 */

import { createHash } from 'node:crypto';

export interface ImageFileFacts {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export type ImageFileReading =
  | { readonly ok: true; readonly facts: ImageFileFacts }
  /** Stable codes, reported by validation exactly as they are. */
  | { readonly ok: false; readonly reason: 'not-avif' | 'no-dimensions' };

const FTYP_OFFSET = 4;
const BRAND_OFFSET = 8;

/** AVIF still images and image sequences; anything else is not this format. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Padded, because a truncated file yields fewer bytes than asked for rather than throwing. */
function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4)).padEnd(4, ' ');
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

export function isAvif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < BRAND_OFFSET + 4) {
    return false;
  }
  return fourCc(bytes, FTYP_OFFSET) === 'ftyp' && AVIF_BRANDS.has(fourCc(bytes, BRAND_OFFSET));
}

/**
 * The largest `ispe` in the file, which is the primary image.
 *
 * A file may carry several: a thumbnail, an alpha plane, a gain map. Taking the
 * largest is the reading that cannot be fooled into reporting a 320-pixel
 * preview as the picture, and the canonical files here have exactly one anyway.
 */
function readSpatialExtents(bytes: Uint8Array): { width: number; height: number } | undefined {
  let best: { width: number; height: number } | undefined;

  for (let offset = 0; offset + 16 <= bytes.byteLength; offset += 1) {
    if (fourCc(bytes, offset) !== 'ispe') {
      continue;
    }
    // The fourcc, then a one-byte version and three flag bytes, then the extents.
    const width = readUint32(bytes, offset + 8);
    const height = readUint32(bytes, offset + 12);
    if (width === 0 || height === 0) {
      continue;
    }
    if (best === undefined || width * height > best.width * best.height) {
      best = { width, height };
    }
  }

  return best;
}

export function readImageFile(bytes: Uint8Array): ImageFileReading {
  if (!isAvif(bytes)) {
    return { ok: false, reason: 'not-avif' };
  }
  const extents = readSpatialExtents(bytes);
  if (extents === undefined) {
    return { ok: false, reason: 'no-dimensions' };
  }
  return {
    ok: true,
    facts: {
      format: 'avif',
      width: extents.width,
      height: extents.height,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}
