// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Routes that come from content collections rather than from the catalog: the
 * methodology chapters and the preset comparisons, each in its authored order.
 *
 * Kept apart from `site-routes.ts` because reading a collection needs
 * `astro:content`, which exists only inside an Astro build.
 */

import { getCollection } from 'astro:content';

import { presetAvailability } from './presets.ts';
import { methodologyRoute, presetRoute, type SiteRoute } from './site-routes.ts';

export interface CollectionRoutes {
  readonly methodology: readonly SiteRoute[];
  readonly presets: readonly SiteRoute[];
}

export async function getCollectionRoutes(): Promise<CollectionRoutes> {
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

  return { methodology, presets };
}
