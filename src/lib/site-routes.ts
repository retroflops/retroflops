// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The site's route inventory.
 *
 * One place enumerates every page, so the sitemap, `llms.txt` and any future
 * link check all describe the same site. A route missing here is a route search
 * engines and agents never learn about, which is a quieter failure than a broken
 * link and worth having a single cause for.
 */

import { getCatalog, getCatalogAvailability } from './catalog.ts';
import { COMPONENT_KINDS } from './data/schema.ts';
import { componentKindLabel, systemTypeLabel, systemTypesInUse } from './families.ts';
import { timelineSeries } from './timeline.ts';

export interface SiteRoute {
  /** Site-absolute path, without the deployment base prefix. */
  readonly path: string;
  readonly title: string;
  /** One line describing the page, used by `llms.txt`. */
  readonly summary: string;
  /**
   * Relative weight for the sitemap. Reference pages and profiles matter more
   * than the section landing pages that merely point at them.
   */
  readonly priority: '1.0' | '0.8' | '0.6' | '0.4';
  /** Research profiles remain public, but search engines must not index them. */
  readonly indexing: 'catalog' | 'research';
}

const STATIC_ROUTES: readonly SiteRoute[] = [
  {
    path: '/',
    title: 'RetroFlops',
    summary: 'What the project is and the rules every figure in it obeys.',
    priority: '1.0',
    indexing: 'catalog',
  },
  {
    path: '/explore/',
    title: 'Explore',
    summary: 'Every system and component in the catalog, oldest first.',
    priority: '0.8',
    indexing: 'catalog',
  },
  {
    path: '/compare/',
    title: 'Compare',
    summary:
      'Prepared comparisons of two to four systems, and how a comparison is put together. Each multiplier is shown with its formula, inputs and sources; where the rules refuse one, the reason is written out.',
    priority: '0.8',
    indexing: 'catalog',
  },
  {
    path: '/timeline/',
    title: 'Timeline',
    summary:
      'Charts of one metric and one comparability group over time, each with its data table and a generated summary. There is no chart of everything, because everything is not one quantity.',
    priority: '0.8',
    indexing: 'catalog',
  },
  {
    path: '/methodology/',
    title: 'Methodology',
    summary:
      'What each metric measures, what the confidence statuses mean, when two figures may be divided, and what counts as a source.',
    priority: '0.8',
    indexing: 'catalog',
  },
  {
    path: '/data/',
    title: 'Data and contributing',
    summary:
      'Public JSON and CSV exports, the versioned schema and registries, licensing, and how to report an error in a record.',
    priority: '0.8',
    indexing: 'catalog',
  },
];

/** Every page on the site, in the order a reader would sensibly meet them. */
export function getSiteRoutes(): readonly SiteRoute[] {
  const catalog = getCatalog();
  const availability = getCatalogAvailability();

  const systems = catalog.systems.map((system): SiteRoute => ({
    path: `/systems/${system.slug}/`,
    title: system.name,
    summary: system.summary,
    priority: '0.8',
    indexing: availability.systems.get(system.id)?.availability ?? 'research',
  }));

  const components = catalog.components.map((component): SiteRoute => ({
    path: `/components/${component.kind}/${component.slug}/`,
    title: component.name,
    summary: component.summary,
    priority: '0.6',
    indexing: availability.components.get(component.id)?.availability ?? 'research',
  }));

  /**
   * Category pages, which are where a profile's breadcrumb points. They are
   * derived from the records rather than listed, for the same reason the
   * timeline series below are: a new type of machine should create its category
   * from the same place it creates its route.
   */
  const systemCategories = systemTypesInUse().map((type): SiteRoute => ({
    path: `/systems/type/${type}/`,
    title: systemTypeLabel(type),
    summary: `Every ${systemTypeLabel(type).toLowerCase()} record in the catalog, oldest first.`,
    priority: '0.6',
    indexing: 'catalog',
  }));

  const componentCategories = COMPONENT_KINDS.map((kind): SiteRoute => ({
    path: `/components/${kind}/`,
    title: componentKindLabel(kind),
    summary: `Every ${componentKindLabel(kind).toLowerCase()} record in the catalog, by name.`,
    priority: '0.6',
    indexing: 'catalog',
  }));

  /**
   * Timeline series are derived from the catalog rather than authored, so they
   * belong here rather than in the static list, a new record can create a
   * chartable series, and the sitemap should learn about it from the same place
   * the route does.
   */
  const timelines = timelineSeries(catalog).map((series): SiteRoute => ({
    path: `/timeline/${series.slug}/`,
    title: `${series.metricLabel} over time`,
    summary: series.summary,
    priority: '0.6',
    indexing: 'catalog',
  }));

  const sources = catalog.sources.map((source): SiteRoute => ({
    path: `/sources/${source.id}/`,
    title: source.title,
    summary: `${source.publisher}, tier ${source.tier} source. ${source.locator}`,
    priority: '0.4',
    indexing: 'catalog',
  }));

  return [
    ...STATIC_ROUTES,
    ...timelines,
    ...systemCategories,
    ...systems,
    ...componentCategories,
    ...components,
    ...sources,
  ];
}

/** The methodology chapters, which come from a content collection rather than the catalog. */
export function methodologyRoute(id: string, title: string, summary: string): SiteRoute {
  return { path: `/methodology/${id}/`, title, summary, priority: '0.6', indexing: 'catalog' };
}

/** A preset comparison, also a content collection rather than part of the catalog. */
export function presetRoute(
  id: string,
  title: string,
  summary: string,
  indexing: SiteRoute['indexing'],
): SiteRoute {
  return { path: `/compare/${id}/`, title, summary, priority: '0.6', indexing };
}
