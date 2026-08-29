// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

/**
 * `SITE_URL` and `BASE_PATH` let the same build target either a root domain or a
 * GitHub Pages project page served from `/<repository>/`.
 */
const site = process.env['SITE_URL'] ?? 'https://retroflops.github.io';
const base = process.env['BASE_PATH'] ?? '/';

/**
 * `OUT_DIR` exists so a second build can stand beside the first rather than
 * overwrite it: the end-to-end suite serves a root-domain build and a
 * `/retroflops/` build at once, and checking that every route answers under the
 * repository prefix means having both at the same time.
 */
const outDir = process.env['OUT_DIR'] ?? 'dist';

export default defineConfig({
  site,
  base,
  outDir,
  /**
   * The default since Astro 7 is `'jsx'`, which applies React's whitespace
   * rules and so deletes the line break before an inline element that has been
   * wrapped onto its own line — "or read<a>one metric over time</a>". Where a
   * line breaks in an `.astro` file is Prettier's decision, not an editorial
   * one, which would make the rendered prose hostage to the formatter and the
   * remedy a site full of `{' '}` that the next reformat can silently undo.
   * `true` is the lossless compressor: it still strips the whitespace that
   * only indents the source, but keeps what the text needs to read correctly,
   * for about 2% more HTML.
   */
  compressHTML: true,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [preact()],
});
