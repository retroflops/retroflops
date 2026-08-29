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

describe('data:gaps', () => {
  it('writes one inventory and both prompts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retroflops-data-gaps-'));
    temporaryDirectories.push(directory);

    await execFile(process.execPath, ['scripts/data-gaps.ts', '--output-directory', directory], {
      cwd: process.cwd(),
    });

    const master = await readFile(join(directory, 'research-requests.md'), 'utf8');
    expect(master).toContain('81 are catalog records with at least');
    expect(master).toContain('0 are research records whose source trail is preserved');
    expect(master).toContain('## Part A, Apple iPhones and Apple silicon Macs');
    expect(master).toContain('## Part V');
    expect(master).toContain('Catalog record');

    const researchPrompt = await readFile(join(directory, 'research-prompt.md'), 'utf8');
    expect(researchPrompt).toContain('Send this prompt with `research-requests.md`.');
    const intakePrompt = await readFile(join(directory, 'research-intake-prompt.md'), 'utf8');
    expect(intakePrompt).toContain('data/reports/research/research-requests.md');

    expect((await readdir(directory)).toSorted()).toEqual([
      'research-intake-prompt.md',
      'research-prompt.md',
      'research-requests.md',
    ]);
  });
});
