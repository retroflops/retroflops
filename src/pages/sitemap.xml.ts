// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Sitemap, generated from the route inventory rather than by crawling.
 *
 * It carries no `lastmod`. Identical inputs give byte-identical output, and a
 * timestamp would break that for no benefit. The project has no sourced
 * modification date, so it does not publish one.
 */

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

import { route } from '~/lib/paths';
import { presetAvailability } from '~/lib/presets';
import { getSiteRoutes, methodologyRoute, presetRoute } from '~/lib/site-routes';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  if (site === undefined) {
    throw new Error('A sitemap needs an absolute site URL. Set SITE_URL before building.');
  }

  const methodology = (await getCollection('methodology'))
    .toSorted((a, b) => a.data.order - b.data.order)
    .map((page) => methodologyRoute(page.id, page.data.title, page.data.summary));

  const presets = (await getCollection('presets'))
    .toSorted((a, b) => a.data.order - b.data.order)
    .map((preset) =>
      presetRoute(
        preset.id,
        preset.data.title,
        preset.data.summary,
        presetAvailability(preset.data).availability,
      ),
    );

  const entries = [...getSiteRoutes(), ...presets, ...methodology]
    .filter((entry) => entry.indexing === 'catalog')
    .map((entry) => {
      const url = new URL(route(entry.path), site);
      return `  <url>\n    <loc>${escapeXml(url.href)}</loc>\n    <priority>${entry.priority}</priority>\n  </url>`;
    });

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
