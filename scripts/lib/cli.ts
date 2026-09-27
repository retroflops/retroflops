// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/** Command-line helpers shared by the pipeline scripts. */

import { isAbsolute, resolve } from 'node:path';

import { repoPath } from './io.ts';

/** Every value given to a repeatable flag such as `--only <id>`, in order. */
export function flagValues(argv: readonly string[], flag: string): string[] {
  return argv
    .flatMap((argument, index, arguments_) =>
      argument === flag ? [arguments_[index + 1] ?? ''] : [],
    )
    .filter((value) => value !== '');
}

/** How many reports ended in each status, in first-seen order: `3 fetched, 1 failed`. */
export function statusSummary(statuses: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
}

/**
 * Where a report generator writes: `--output-directory <path>` when given,
 * relative to the repository unless absolute, and the generator's own default
 * otherwise.
 */
export function outputDirectory(
  argv: readonly string[],
  fallback: string,
  command: string,
): string {
  const index = argv.indexOf('--output-directory');
  const target = index === -1 ? fallback : argv[index + 1];
  if (target === undefined) {
    throw new Error(`${command}: --output-directory needs a path`);
  }
  return resolve(isAbsolute(target) ? target : repoPath(target));
}
