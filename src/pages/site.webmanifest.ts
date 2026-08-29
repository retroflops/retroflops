// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `site.webmanifest`.
 *
 * A route rather than a file in `public/`, because every address inside a
 * manifest is resolved against the manifest itself and the icons live at
 * `/icon-192.png` on a root domain and `/<repository>/icon-192.png` on GitHub
 * Pages. A static file would have to guess; this one asks `route()`.
 *
 * The icons themselves are generated from `brand/logo.svg` by `pnpm
 * brand:icons`, which is also where the sizes named here come from.
 */

import type { APIRoute } from 'astro';

import { route } from '~/lib/paths';

export const GET: APIRoute = () => {
  const manifest = {
    id: route('/'),
    name: 'RetroFlops',
    short_name: 'RetroFlops',
    description:
      'Comparing computers, consoles and landmark processors, where every number carries its ' +
      'source, its locator and how it was obtained.',
    lang: 'en',
    dir: 'ltr',
    start_url: route('/'),
    scope: route('/'),
    display: 'minimal-ui',
    // The manifest has no media-query colors, so installed launches keep the
    // existing paper fallback. Browser chrome follows the document metadata.
    theme_color: '#f4f0e6',
    background_color: '#f4f0e6',
    categories: ['education', 'reference'],
    icons: [
      { src: route('/favicon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: route('/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: route('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: route('/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
