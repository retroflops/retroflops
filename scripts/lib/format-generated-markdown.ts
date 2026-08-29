// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { repoPath, REPO_ROOT } from './io.ts';

const execFile = promisify(execFileCallback);

/** Formats generated Markdown that Oxfmt cannot discover through an ignored directory. */
export async function formatGeneratedMarkdown(paths: readonly string[]): Promise<void> {
  await execFile(
    process.execPath,
    [repoPath('node_modules/oxfmt/bin/oxfmt'), '--config', repoPath('.oxfmtrc.json'), ...paths],
    { cwd: REPO_ROOT },
  );
}
