// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Which build a reader is looking at.
 *
 * The footer names the version, the commit and the commit's date, so that a
 * correction can be filed against a page somebody actually saw. The date is the
 * commit's own committer date rather than the clock at build time: the site is
 * only ever deployed from a commit, so the two differ by the CI queue, and
 * reading the commit keeps the rendered HTML reproducible the way the data
 * artifacts already are. A build stamped with `new Date()` would differ from
 * the last one on every rebuild, which costs the diff its meaning.
 *
 * This runs at build time only. The footer is not an island, so `git` and the
 * package manifest are both reachable here; importing this module into
 * anything under `src/islands/` would ask Vite to bundle `node:child_process`
 * for a browser and fail.
 *
 * The version is imported rather than read from disk for the reason
 * `catalog.ts` gives: the import resolves against this source file, which
 * survives bundling, while a working directory is an assumption.
 */

import { execFileSync } from 'node:child_process';

import packageJson from '../../package.json';

export interface GitDescription {
  /** The full commit SHA. */
  readonly commit: string;
  /** That commit's committer date, ISO 8601. */
  readonly commitDate: string;
}

export interface BuildInfo {
  /** The version `package.json` declares. */
  readonly version: string;
  /** The commit built, absent when the tree carries no repository. */
  readonly git: GitDescription | undefined;
}

/** How much of a SHA a person reads. Git's own abbreviation length. */
const SHORT_COMMIT_LENGTH = 7;

const GIT_DESCRIPTION = /^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}T[\d:+-]+)$/;

/**
 * Reads `git log`'s one-line answer. Returns nothing for anything that is not
 * exactly a full SHA and an ISO date, because a half-parsed build stamp is
 * worse than none.
 */
export function parseGitDescription(output: string): GitDescription | undefined {
  const [, commit, commitDate] = GIT_DESCRIPTION.exec(output.trim()) ?? [];
  if (commit === undefined || commitDate === undefined) {
    return undefined;
  }
  return { commit, commitDate };
}

/** The first seven characters, which is what the hash is quoted as. */
export function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

/**
 * `2026-08-25` reads as "25 August 2026". Pinned to UTC and to the locale
 * `formatPartialDate` uses, so every date on the site is spelled the same way
 * and none of them shift with the machine that rendered the page.
 */
export function formatBuildDate(date: string): string {
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function readGitDescription(): GitDescription | undefined {
  try {
    const output = execFileSync('git', ['log', '-1', '--format=%H %cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return parseGitDescription(output);
  } catch {
    /*
     * A source tarball has no `.git`, and a build from one is still a valid
     * build. The footer then names the version alone rather than inventing a
     * commit for it.
     */
    return undefined;
  }
}

function readBuildInfo(): BuildInfo {
  return { version: packageJson.version, git: readGitDescription() };
}

/** Resolved once, when this module is first evaluated. */
export const BUILD_INFO: BuildInfo = readBuildInfo();
