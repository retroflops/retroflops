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

describe('data:image-gaps', () => {
  it('writes the photograph inventory to the selected directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retroflops-data-image-gaps-'));
    temporaryDirectories.push(directory);

    await execFile(
      process.execPath,
      ['scripts/data-image-gaps.ts', '--output-directory', directory],
      { cwd: process.cwd() },
    );

    const inventory = await readFile(join(directory, 'image-requests.md'), 'utf8');
    expect(inventory).toContain('# Photograph requests');
    expect(inventory).toContain('## Group 6, Reference platforms, which are not being asked for');
    expect(await readdir(directory)).toEqual(['image-requests.md']);
  });
});
