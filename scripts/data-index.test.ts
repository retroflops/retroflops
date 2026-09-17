// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('data:index', () => {
  it('writes the catalog index to the selected directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retroflops-data-index-'));
    temporaryDirectories.push(directory);

    await execFile(process.execPath, ['scripts/data-index.ts', '--output-directory', directory], {
      cwd: process.cwd(),
    });

    const index = await readFile(join(directory, 'CATALOG.md'), 'utf8');
    expect(index).toContain('# Catalog index');
    expect(index).toContain('## Consoles');
    expect(index).toContain('- Commodore 64 · 1982');
    expect(index.match(/^- MOS Technology 6502 · 1975$/gm)).toHaveLength(1);
    expect(index.indexOf('- Commodore Amiga 500 ·')).toBeLessThan(
      index.indexOf('- Commodore Amiga 1200 ·'),
    );
    expect(index.indexOf('- Apple iPhone 4 ·')).toBeLessThan(index.indexOf('- Apple iPhone 12 ·'));
    expect(await readdir(directory)).toEqual(['CATALOG.md']);
    expect(await readFile('docs/CATALOG.md', 'utf8')).toBe(index);
  });
});
