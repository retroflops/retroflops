// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Facts about the project itself, as opposed to its catalog.
 *
 * The repository address is here rather than in `paths.ts`, which is strictly
 * about prefixing internal routes with the deployment base. This URL takes no
 * base and never will.
 */

/** Where the source, the data and the issue tracker live. */
export const REPOSITORY_URL = 'https://github.com/retroflops/retroflops';

/** The rights holder named by LICENSE, so the footer cannot drift from it. */
export const COPYRIGHT_HOLDER = 'Wojciech Polak';

/** The year of first publication. */
export const COPYRIGHT_YEAR = '2026';
