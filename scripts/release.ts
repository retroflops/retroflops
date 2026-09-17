// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `release <major|minor|patch>` cuts a version.
 *
 * It bumps `package.json`, moves the notes under `## [Unreleased]` in
 * `CHANGELOG.md` beneath a dated heading for the new version, commits both as
 * `chore(release): version X.Y.Z` and tags `vX.Y.Z`. It never pushes.
 *
 * The notes are written by a person. When `[Unreleased]` is empty the script
 * drafts it from the conventional commit subjects since the last tag and stops
 * without bumping, so the draft can be edited and committed before the release
 * is cut. The release commit then holds only the version and the moved heading.
 *
 * `--dry-run` prints what would happen and changes nothing.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { formatGeneratedMarkdown } from './lib/format-generated-markdown.ts';
import { repoPath, REPO_ROOT } from './lib/io.ts';

const execFile = promisify(execFileCallback);

export const RELEASE_LEVELS = ['major', 'minor', 'patch'] as const;
export type ReleaseLevel = (typeof RELEASE_LEVELS)[number];

const UNRELEASED_HEADING = '## [Unreleased]';
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL_SUBJECT = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/;

/** Keep a Changelog sections, in the order the file lists them. */
const SECTIONS = ['Added', 'Changed', 'Fixed'] as const;
type Section = (typeof SECTIONS)[number];

export function isReleaseLevel(value: string | undefined): value is ReleaseLevel {
  return RELEASE_LEVELS.some((level) => level === value);
}

/** Plain `X.Y.Z` only; a pre-release or build suffix is refused. */
export function bumpVersion(version: string, level: ReleaseLevel): string {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new Error(`release: "${version}" is not a plain X.Y.Z version`);
  }
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function unreleasedBounds(changelog: string): { start: number; end: number } {
  const heading = changelog.indexOf(`${UNRELEASED_HEADING}\n`);
  if (heading === -1) {
    throw new Error(`release: CHANGELOG.md has no "${UNRELEASED_HEADING}" heading`);
  }
  const start = heading + UNRELEASED_HEADING.length + 1;
  const next = changelog.indexOf('\n## [', start - 1);
  return { start, end: next === -1 ? changelog.length : next + 1 };
}

/** The notes under `[Unreleased]`, trimmed; empty when there are none. */
export function parseUnreleased(changelog: string): string {
  const { start, end } = unreleasedBounds(changelog);
  return changelog.slice(start, end).trim();
}

function replaceUnreleased(changelog: string, body: string): string {
  const { start, end } = unreleasedBounds(changelog);
  const rest = changelog.slice(end);
  return `${changelog.slice(0, start)}\n${body}${rest === '' ? '' : '\n'}${rest}`;
}

function sectionFor(type: string, scope: string | undefined): Section | undefined {
  if (type === 'feat') {
    return 'Added';
  }
  if (type === 'fix') {
    return 'Fixed';
  }
  if (type === 'chore' && scope === 'release') {
    return undefined;
  }
  return ['chore', 'perf', 'refactor', 'build', 'docs'].includes(type) ? 'Changed' : undefined;
}

/**
 * Drafts changelog notes from commit subjects. Merge commits, earlier release
 * commits and subjects that are not conventional are left out.
 */
export function seedFromCommits(subjects: readonly string[]): string {
  const grouped = new Map<Section, string[]>();
  for (const subject of subjects) {
    const match = CONVENTIONAL_SUBJECT.exec(subject.trim());
    if (match === null) {
      continue;
    }
    const [, type = '', scope, description = ''] = match;
    const section = sectionFor(type, scope);
    if (section === undefined) {
      continue;
    }
    const entry = description.charAt(0).toUpperCase() + description.slice(1);
    grouped.set(section, [...(grouped.get(section) ?? []), `- ${entry}.`]);
  }
  return SECTIONS.filter((section) => grouped.has(section))
    .map((section) => `### ${section}\n\n${(grouped.get(section) ?? []).join('\n')}\n`)
    .join('\n');
}

/** Leaves `[Unreleased]` empty and puts its notes under `[version] - date`. */
export function promoteUnreleased(changelog: string, version: string, date: string): string {
  const notes = parseUnreleased(changelog);
  return replaceUnreleased(changelog, `## [${version}] - ${date}\n\n${notes}\n`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Today in local time, which is the date the person running this sees. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: REPO_ROOT });
  return stdout;
}

async function tagExists(tag: string): Promise<boolean> {
  try {
    await git('rev-parse', '--quiet', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const level = args.find((arg) => !arg.startsWith('--'));
  if (!isReleaseLevel(level)) {
    console.error(`usage: pnpm release <${RELEASE_LEVELS.join('|')}> [--dry-run]`);
    process.exitCode = 1;
    return;
  }

  if ((await git('status', '--porcelain')).trim() !== '') {
    console.error('release: the working tree has uncommitted changes; commit or stash them first');
    process.exitCode = 1;
    return;
  }

  const packagePath = repoPath('package.json');
  const changelogPath = repoPath('CHANGELOG.md');
  const packageText = await readFile(packagePath, 'utf8');
  const current = (JSON.parse(packageText) as { version: string }).version;
  const next = bumpVersion(current, level);
  const tag = `v${next}`;
  if (await tagExists(tag)) {
    console.error(`release: tag ${tag} already exists`);
    process.exitCode = 1;
    return;
  }

  const changelog = await readFile(changelogPath, 'utf8');
  if (parseUnreleased(changelog) === '') {
    const previousTag = `v${current}`;
    if (!(await tagExists(previousTag))) {
      console.error(`release: [Unreleased] is empty and tag ${previousTag} does not exist`);
      process.exitCode = 1;
      return;
    }
    const log = await git('log', '--no-merges', '--format=%s', `${previousTag}..HEAD`);
    const subjects = log.split('\n').filter((line) => line !== '');
    const seed = seedFromCommits(subjects);
    if (seed === '') {
      console.error(`release: [Unreleased] is empty and no commit since ${previousTag} has notes`);
      process.exitCode = 1;
      return;
    }
    if (dryRun) {
      console.log(`release: [Unreleased] is empty; would draft it from ${previousTag}..HEAD:\n`);
      console.log(seed);
      return;
    }
    await writeFile(changelogPath, replaceUnreleased(changelog, seed));
    await formatGeneratedMarkdown([changelogPath]);
    console.error(
      `release: [Unreleased] was empty, so it now holds a draft from ${subjects.length} commits.`,
    );
    console.error(`Edit CHANGELOG.md, commit it, then run pnpm release ${level} again.`);
    process.exitCode = 1;
    return;
  }

  const date = today();
  const promoted = promoteUnreleased(changelog, next, date);
  if (dryRun) {
    console.log(`release: would bump ${current} to ${next}, commit and tag ${tag}\n`);
    const previous = promoted.indexOf(`\n## [${current}]`);
    console.log(promoted.slice(0, previous === -1 ? undefined : previous).trimEnd());
    return;
  }

  const versionLine = /("version":\s*")[^"]*(")/;
  await writeFile(packagePath, packageText.replace(versionLine, `$1${next}$2`));
  await writeFile(changelogPath, promoted);
  await formatGeneratedMarkdown([changelogPath]);
  await git('add', 'package.json', 'CHANGELOG.md');
  await git('commit', '--quiet', '-m', `chore(release): version ${next}`);
  await git('tag', tag);
  console.log(`release: committed ${next} and tagged ${tag}. To publish it:`);
  console.log(`  git push origin HEAD ${tag}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
