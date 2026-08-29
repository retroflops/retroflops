// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isAvif, readImageFile } from './image-file.ts';

/**
 * A real canonical file, because the point of this module is to read what the
 * repository actually stores. A hand-built fixture would test the parser
 * against my idea of an AVIF rather than against one.
 */
const canonical = fileURLToPath(
  new URL('../../assets/images/systems/sony-playstation-scph-1000.avif', import.meta.url),
);

describe('reading a canonical file', () => {
  it('reports the format, the extents and the bytes', async () => {
    const reading = readImageFile(await readFile(canonical));
    expect(reading.ok).toBe(true);
    if (!reading.ok) {
      return;
    }
    expect(reading.facts.format).toBe('avif');
    expect(reading.facts.width).toBe(1280);
    expect(reading.facts.height).toBe(960);
    expect(reading.facts.byteLength).toBeGreaterThan(0);
    expect(reading.facts.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('refusing what is not a canonical file', () => {
  it('rejects a JPEG whatever its extension says', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 0]);
    expect(isAvif(jpeg)).toBe(false);
    expect(readImageFile(jpeg)).toEqual({ ok: false, reason: 'not-avif' });
  });

  it('rejects an empty file rather than reading past the end of it', () => {
    expect(readImageFile(new Uint8Array())).toEqual({ ok: false, reason: 'not-avif' });
  });

  it('reports a file that declares the format but carries no extents', () => {
    const header = new Uint8Array(32);
    header.set([0, 0, 0, 32], 0);
    header.set(
      [...'ftypavif'].map((character) => character.charCodeAt(0)),
      4,
    );
    expect(isAvif(header)).toBe(true);
    expect(readImageFile(header)).toEqual({ ok: false, reason: 'no-dimensions' });
  });
});
