// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { bumpVersion, parseUnreleased, promoteUnreleased, seedFromCommits } from './release.ts';

const HEADER = `# Changelog

All notable changes to RetroFlops will be documented in this file.

`;

const EMPTY = `${HEADER}## [Unreleased]

## [1.0.0] - 2026-08-29

Initial public release.
`;

const WITH_NOTES = `${HEADER}## [Unreleased]

### Added

- A catalog index.

## [1.0.0] - 2026-08-29

Initial public release.
`;

describe('bumpVersion', () => {
  it('resets the lower fields', () => {
    expect(bumpVersion('1.4.7', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.4.7', 'minor')).toBe('1.5.0');
    expect(bumpVersion('1.4.7', 'patch')).toBe('1.4.8');
  });

  it('refuses anything but X.Y.Z', () => {
    expect(() => bumpVersion('1.0.0-beta.1', 'patch')).toThrow(/plain X\.Y\.Z/);
    expect(() => bumpVersion('1.0', 'patch')).toThrow(/plain X\.Y\.Z/);
  });
});

describe('parseUnreleased', () => {
  it('is empty when no notes stand under the heading', () => {
    expect(parseUnreleased(EMPTY)).toBe('');
  });

  it('stops at the next version heading', () => {
    expect(parseUnreleased(WITH_NOTES)).toBe('### Added\n\n- A catalog index.');
  });

  it('fails without an Unreleased heading', () => {
    expect(() => parseUnreleased('# Changelog\n')).toThrow(/Unreleased/);
  });
});

describe('seedFromCommits', () => {
  it('groups conventional subjects and skips the rest', () => {
    expect(
      seedFromCommits([
        'feat: add a generated catalog index',
        'Merge pull request #1 from feat/trivia',
        'chore: upgrade dependencies',
        'chore(release): version 1.0.1',
        'fix(data): repair a locator',
        'feat(ui)!: redraw the footer',
        'wip',
      ]),
    ).toBe(
      [
        '### Added',
        '',
        '- Add a generated catalog index.',
        '- Redraw the footer.',
        '',
        '### Changed',
        '',
        '- Upgrade dependencies.',
        '',
        '### Fixed',
        '',
        '- Repair a locator.',
        '',
      ].join('\n'),
    );
  });

  it('is empty when nothing qualifies', () => {
    expect(seedFromCommits(['Merge branch main', 'chore(release): version 1.0.1'])).toBe('');
  });
});

describe('promoteUnreleased', () => {
  it('moves the notes under a dated heading and leaves Unreleased empty', () => {
    expect(promoteUnreleased(WITH_NOTES, '1.1.0', '2026-09-17')).toBe(`${HEADER}## [Unreleased]

## [1.1.0] - 2026-09-17

### Added

- A catalog index.

## [1.0.0] - 2026-08-29

Initial public release.
`);
  });
});
