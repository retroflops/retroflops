// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The site without JavaScript.
 *
 * The rule is that the main content is HTML, including profiles, tables,
 * sources and methodology. Every control that cannot work without scripts is absent
 * rather than inert. So these tests check both halves: the content is there,
 * and the builder and filter panels are not pretending to be usable.
 */

import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('a system profile is complete: figures, methods and sources', async ({ page }) => {
  await page.goto('/systems/commodore-64/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commodore 64');
  await expect(page.getByRole('heading', { name: 'Figures for the whole machine' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  // Every figure leads to the document it was read from.
  await expect(page.locator('main a[href*="/sources/"]').first()).toBeVisible();
});

test('a trivia section and its citations are HTML', async ({ page }) => {
  await page.goto('/systems/saturn-lvdc/');
  const trivia = page.locator('section.trivia');
  await expect(trivia).toBeVisible();
  // Rendered Markdown, not a script that fetches it.
  await expect(trivia.locator('.trivia__body p').first()).toBeVisible();
  await expect(trivia.locator('.source-list a').first()).toBeVisible();
});

test('a profile navigates to its category and its family without scripts', async ({ page }) => {
  await page.goto('/systems/amiga-500/');

  /*
   * The category crumb is why this navigation is built on static routes rather
   * than on a filtered Explore link: Explore's filter panel is client-only, so
   * `?kind=home-computer` would have delivered all seventy-eight records here.
   */
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await trail.getByRole('link', { name: 'Home computers' }).click();
  await expect(page).toHaveURL(/\/systems\/type\/home-computer\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home computers');
  await expect(page.getByRole('link', { name: 'Commodore Amiga 500' })).toBeVisible();
  /*
   * A category is the machines of one type, not the whole catalog. Named by
   * what must be missing rather than by a count: a count is a fact about how
   * many home computers the catalog holds today, and this test is about where
   * the crumb goes.
   */
  await expect(page.getByRole('link', { name: 'Sony PlayStation 5' })).toHaveCount(0);

  await page.goto('/systems/amiga-500/');
  const navbox = page.getByRole('navigation', { name: 'Amiga' });
  await expect(navbox.getByRole('link', { name: 'Commodore Amiga 1200' })).toBeVisible();
  // The machine you are standing on is named, but is not a link to itself.
  await expect(navbox.getByText('Commodore Amiga 500')).toBeVisible();
  await expect(navbox.getByRole('link', { name: 'Commodore Amiga 500' })).toHaveCount(0);
});

test('a machine with no family ends where it always did', async ({ page }) => {
  await page.goto('/systems/sgi-octane/');
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(page.locator('.family-nav')).toHaveCount(0);
});

test('the collapsed menu still opens, because navigation cannot need scripts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  const explore = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
    name: 'Explore',
  });
  await expect(explore).toBeHidden();

  await page.locator('.site-menu__toggle').click();
  await expect(explore).toBeVisible();
  await explore.click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test('back to top follows the CSS scroll timeline without scripts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/systems/commodore-64/');
  const button = page.getByRole('link', { name: 'Back to top' });

  await expect(button).toBeHidden();
  await page.mouse.wheel(0, 2000);
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('Explore lists every record, with no filter panel offering to do nothing', async ({
  page,
}) => {
  await page.goto('/explore/');
  const records = await page.locator('[data-facet-kind]').count();
  expect(records).toBeGreaterThan(10);
  await expect(page.locator('.filters')).toHaveCount(0);
});

test('Compare offers prepared comparisons instead of an inert builder', async ({ page }) => {
  await page.goto('/compare/');
  await expect(page.locator('.builder')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Prepared comparisons' })).toBeVisible();
  await expect(page.getByText(/Building your own comparison needs JavaScript/)).toBeVisible();
});

test('a prepared comparison is a complete page', async ({ page }) => {
  await page.goto('/compare/02-commodore-decade/');
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  await expect(page.locator('.cmp-table').first()).toBeVisible();
});

test('the folded catalog axis still opens, because a disclosure is not a script', async ({
  page,
}) => {
  await page.goto('/compare/03-four-consoles/');

  const axis = page.locator('.glance-axis').first();
  await expect(axis).toBeHidden();
  await page.locator('.glance-axis-detail > summary').first().click();

  // The names, the ranks and the scale are all HTML; nothing here was waiting
  // for a bundle to arrive.
  await expect(axis.locator('.glance-axis__legend')).toContainText('Intel 80486DX PC');
  await expect(axis.locator('.glance-axis__standings')).toContainText(/lowest of the \d+ figures/);
});

test('a chart page still answers the question the chart would have', async ({ page }) => {
  await page.goto('/timeline/clock-frequency-cpu-nominal-clock/');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await expect(page.getByText(/The chart needs JavaScript/)).toBeVisible();
});

test('a source page states the locator and the tier', async ({ page }) => {
  await page.goto('/sources/c64-programmers-reference-guide/');
  const main = await page.locator('main').innerText();
  expect(main).toMatch(/tier/i);
  expect(main.length).toBeGreaterThan(200);
});
