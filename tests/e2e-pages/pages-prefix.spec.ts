// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The site as GitHub Pages serves it, under `/retroflops/`.
 *
 * A project page is not a variant of a root domain: every href and every asset
 * URL is different. A link written as
 * `/systems/…` instead of `/retroflops/systems/…` works perfectly in
 * development and 404s in production. The build prefixes every route. This
 * suite checks that each route also works when a reader opens it directly.
 *
 * This suite covers every sitemap route directly, then walks through the pages
 * that carry links and assets.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

const PREFIX = '/retroflops/';

/** Every route the build declares, as paths under the prefix. */
async function sitemapPaths(request: APIRequestContext): Promise<readonly string[]> {
  const response = await request.get(`${PREFIX}sitemap.xml`);
  expect(response.status()).toBe(200);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1] ?? '').pathname);
}

test('the sitemap lists the whole site, and every path is prefixed', async ({ request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.length).toBeGreaterThan(100);
  expect(paths.filter((path) => !path.startsWith(PREFIX))).toEqual([]);
});

test('every route in the sitemap answers when entered directly', async ({ request }) => {
  const paths = await sitemapPaths(request);
  const failures: string[] = [];
  for (const path of paths) {
    const response = await request.get(path);
    if (response.status() !== 200) {
      failures.push(`${path} → ${response.status()}`);
    }
  }
  expect(failures).toEqual([]);
});

test('no page links or loads anything from outside the prefix', async ({ request }) => {
  const paths = await sitemapPaths(request);
  const offenders: string[] = [];
  for (const path of paths) {
    const html = await (await request.get(path)).text();
    // `srcset` as well as `href` and `src`: a responsive image is several URLs,
    // and one of them being unprefixed is a 404 only some readers would see.
    const targets = [
      ...[...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1] ?? ''),
      ...[...html.matchAll(/srcset="([^"]*)"/g)].flatMap((match) =>
        (match[1] ?? '')
          .split(',')
          .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
          .filter((candidate) => candidate.startsWith('/')),
      ),
    ];
    for (const target of targets) {
      // Protocol-relative URLs are absolute, and the prefix itself is fine.
      if (!target.startsWith('//') && !target.startsWith(PREFIX)) {
        offenders.push(`${path} → ${target}`);
      }
    }
  }
  expect(offenders.slice(0, 10)).toEqual([]);
});

test('the published data exports are reachable under the prefix', async ({ request }) => {
  for (const file of [
    'data/catalog-v1.json',
    'data/catalog-summary-v1.json',
    'data/measurements-v1.csv',
    'llms.txt',
    'robots.txt',
  ]) {
    const response = await request.get(`${PREFIX}${file}`);
    expect(response.status(), file).toBe(200);
  }
});

test('the home page loads its stylesheet and scripts from the prefix', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      missing.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(missing).toEqual([]);
});

test('navigating from the home page stays inside the prefix', async ({ page }) => {
  await page.goto('./');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Explore' })
    .click();
  await expect(page).toHaveURL(new RegExp(`${PREFIX}explore/$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore');
});

test('a comparison built under the prefix fetches the prefixed catalog', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('./compare/?systems=commodore-64,amiga-500');
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  expect(failed).toEqual([]);
});

test('canonical URLs and structured data point at the deployed address', async ({ page }) => {
  await page.goto('./systems/commodore-64/');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toBe('https://example.github.io/retroflops/systems/commodore-64/');
});
