// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { BUILD_INFO, formatBuildDate, parseGitDescription, shortCommit } from './build-info.ts';

const COMMIT = '21c26719d3f4a6b8c0e15d27f9a4b3c8e6d201af';

describe('parseGitDescription', () => {
  it('reads a full SHA and an ISO date', () => {
    expect(parseGitDescription(`${COMMIT} 2026-08-25T09:00:00+02:00\n`)).toEqual({
      commit: COMMIT,
      commitDate: '2026-08-25T09:00:00+02:00',
    });
  });

  it('rejects an abbreviated SHA', () => {
    expect(parseGitDescription('21c2671 2026-08-25T09:00:00+02:00')).toBeUndefined();
  });

  it('rejects a date git did not format as ISO 8601', () => {
    expect(parseGitDescription(`${COMMIT} Tue Aug 25 09:00:00 2026`)).toBeUndefined();
  });

  it('rejects anything else, including an error message', () => {
    expect(parseGitDescription('')).toBeUndefined();
    expect(parseGitDescription('fatal: not a git repository')).toBeUndefined();
  });
});

describe('shortCommit', () => {
  it('abbreviates to the seven characters the footer quotes', () => {
    expect(shortCommit(COMMIT)).toBe('21c2671');
  });
});

describe('formatBuildDate', () => {
  it('spells the date the way the rest of the site does', () => {
    expect(formatBuildDate('2026-08-25T09:00:00+02:00')).toBe('25 August 2026');
  });

  /*
   * A commit made late in a positive offset falls on the previous day in UTC.
   * The formatter is pinned to UTC so that the visible date always matches the
   * one in the `datetime` attribute a reader's tools will parse.
   */
  it('reads the instant in UTC rather than in the machine time zone', () => {
    expect(formatBuildDate('2026-08-25T01:00:00+02:00')).toBe('24 August 2026');
  });
});

describe('BUILD_INFO', () => {
  it('names the version this package declares', () => {
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  /*
   * The suite runs inside the repository, so `git` answers. A checkout without
   * one is the fallback the footer handles, not a state this test can reach.
   */
  it('describes the commit it was built from', () => {
    expect(BUILD_INFO.git?.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
