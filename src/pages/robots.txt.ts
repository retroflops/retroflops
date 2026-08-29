// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `robots.txt`.
 *
 * Everything here is meant to be read, including by machines, so nothing that
 * is a document is disallowed. The file publishes the sitemap's address, points
 * at `llms.txt`, keeps crawlers out of the Pagefind index, which is machinery
 * rather than a document, and states the site's position on generative use.
 *
 * That last part is a `Content-Signal` line, which separates search indexing,
 * grounding an answer, and training a model. All three are permitted, because a
 * catalog that publishes CC BY exports and a plain-text guide for agents
 * cannot coherently object to being read by one. Saying so explicitly is worth
 * a few lines. `llms.txt` describes the site, but it grants nothing. GitHub
 * Pages serves no custom headers, so `X-Robots-Tag` is not available to the
 * exports and this is the only place to state the terms.
 */

import type { APIRoute } from 'astro';

import { route } from '~/lib/paths';

export const GET: APIRoute = ({ site }) => {
  if (site === undefined) {
    throw new Error('robots.txt needs an absolute site URL. Set SITE_URL before building.');
  }

  const body = [
    '# As a condition of accessing this website, you agree to abide by the',
    '# following content signals:',
    '#   search:   building a search index and linking to the page',
    '#   ai-input: using the page to ground an answer given to a user',
    '#   ai-train: using the page to train a generative model',
    '# All three are permitted here. The catalog is published to be read, by',
    '# people and by machines alike, and its data is CC BY 4.0. Whichever',
    '# use this is, the attribution condition travels with it.',
    '',
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
    `Allow: ${route('/')}`,
    '',
    '# The Pagefind index is fetched by the browser on demand. It is machinery,',
    '# not a document, and there is nothing in it to index.',
    `Disallow: ${route('/pagefind/')}`,
    '',
    `Sitemap: ${new URL(route('/sitemap.xml'), site).href}`,
    '',
    '# Structured exports and a plain-text guide to the site:',
    `# ${new URL(route('/llms.txt'), site).href}`,
    `# ${new URL(route('/data/catalog-v1.json'), site).href}`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
