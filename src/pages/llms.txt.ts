// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `llms.txt` is a plain-text guide for agents reading this site.
 *
 * It leads with the exports rather than the pages, because an agent that wants
 * these figures should take the JSON rather than scrape the HTML. It states the
 * comparison rules up front because dividing two figures the catalog keeps apart
 * is the most common misuse of this dataset.
 */

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

import { getCatalog } from '~/lib/catalog';
import { route } from '~/lib/paths';
import { presetAvailability } from '~/lib/presets';
import { getSiteRoutes, methodologyRoute, presetRoute } from '~/lib/site-routes';

export const GET: APIRoute = async ({ site }) => {
  if (site === undefined) {
    throw new Error('llms.txt needs an absolute site URL. Set SITE_URL before building.');
  }

  const catalog = getCatalog();
  const absolute = (path: string): string => new URL(route(path), site).href;

  const routes = getSiteRoutes();
  const section = (prefix: string): readonly { path: string; title: string; summary: string }[] =>
    routes.filter((entry) => entry.indexing === 'catalog' && entry.path.startsWith(prefix));

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
    )
    .filter((preset) => preset.indexing === 'catalog');

  const list = (
    entries: readonly { path: string; title: string; summary: string }[],
  ): readonly string[] => entries.map((e) => `- [${e.title}](${absolute(e.path)}): ${e.summary}`);

  const body = [
    '# RetroFlops',
    '',
    '> Sourced, comparable performance data for historic and modern computers, consoles, CPUs and GPUs, from the Apollo Guidance Computer to modern accelerators. Every published number carries a source, an exact locator within that source, and a confidence status.',
    '',
    'Rules that govern every figure here, and that any use of this data should respect:',
    '',
    '- There is no aggregate score. Metrics never combine.',
    '- A ratio between two figures is only meaningful within one comparability group: the same metric, device scope, method and benchmark identity. Figures from different groups are not comparable, however similar their units look.',
    '- Numeric evidence is `confirmed` (one tier A or two independent tier B sources), `reported` (one tier B source), or `rumored` (a precise tier C claim). Reported and rumored values are provisional and cannot feed automatic comparisons.',
    '- A missing value is `unknown` only after a recorded search, `not-applicable` when the quantity does not exist, or `unverified` when a cited source remains unread. Never zero.',
    `- ${catalog.measurements.filter((m) => m.editorialStatus === 'provisional').length} of ${catalog.measurements.length} figures are currently provisional.`,
    '- A "teraflops" figure without a stated precision is recorded as the source gave it and held provisional. Most vendor figures in this dataset are of that kind.',
    '',
    '## Data',
    '',
    `Prefer these over scraping the pages. Two builds from identical inputs produce byte-identical files. Schema \`${catalog.schemaVersion}\`; registries: units \`${catalog.registries.units}\`, metrics \`${catalog.registries.metrics}\`, comparability \`${catalog.registries.comparability}\`.`,
    '',
    `- [catalog-v1.json](${absolute('/data/catalog-v1.json')}): the full export, including ${catalog.systems.length} systems, ${catalog.components.length} components, ${catalog.measurements.length} figures, ${catalog.contextClaims.length} contextual claims, ${catalog.sources.length} sources, ${catalog.derivedClaims.length} derived claims and ${catalog.conflicts.length} conflicts.`,
    `- [catalog-summary-v1.json](${absolute('/data/catalog-summary-v1.json')}): names and facets only, no figures.`,
    `- [measurements-v1.csv](${absolute('/data/measurements-v1.csv')}): one row per figure, with its normalized value, comparability group, confidence status and sources.`,
    `- [Research records](${absolute('/research/')}): source trails for records without a numeric measurement. These pages are public but intentionally excluded from this profile list and search indexing.`,
    '',
    '## Methodology',
    '',
    ...list(methodology),
    '',
    '## Prepared comparisons',
    '',
    'Each of these is fully rendered HTML, including the multipliers the rules allow and the stated reason wherever they refuse one.',
    '',
    ...list(presets),
    '',
    '## Timelines',
    '',
    "One comparability group each, plotted against release date. Each page carries the chart's full data as a table, so the chart is optional.",
    '',
    ...list(section('/timeline/').filter((entry) => entry.path !== '/timeline/')),
    '',
    '## Systems',
    '',
    ...list(section('/systems/')),
    '',
    '## Components',
    '',
    ...list(section('/components/')),
    '',
    '## Sources',
    '',
    ...list(section('/sources/')),
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
