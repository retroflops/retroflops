// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Search and Explore's filters.
 *
 * Both are enhancements over a page that is already complete, so each test
 * checks two things: that the control works, and that what it acts on was
 * already there. The filter panel hides server-rendered cards rather than
 * fetching anything, which is why a filtered view can be a URL.
 */

import { expect, test } from '@playwright/test';

test.describe('full-text search', () => {
  test('finds a machine by name and links to its profile', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('Search systems, components, sources and methodology');
    await input.fill('Amiga');
    const hit = page.getByRole('link', { name: /Amiga/ }).first();
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Amiga/);
  });

  test('says so when nothing matches, rather than showing an empty list', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Search systems, components, sources and methodology').fill('zzzzqqq');
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });
});

test.describe('Explore filters', () => {
  test('finds a system by its editorial alias in a shared URL', async ({ page }) => {
    await page.goto('/explore/?q=psx');

    await expect(page.getByLabel('Name contains')).toHaveValue('psx');
    await expect(page.getByRole('link', { name: 'Sony PlayStation' })).toBeVisible();
    await expect(page.locator('[data-facet-kind]:not([hidden])')).toHaveCount(1);
  });

  test('narrows the catalog and says how far', async ({ page }) => {
    await page.goto('/explore/');
    const count = page.locator('.filters__count');
    await expect(count).toHaveText(/\d+ records/);
    const total = Number(/(\d+) records/.exec((await count.innerText()) || '')?.[1] ?? '0');
    expect(total).toBeGreaterThan(10);

    await page.getByRole('group', { name: 'Kind' }).getByRole('checkbox').first().check();
    await expect(count).toHaveText(/\d+ of \d+ records/);
    const shown = await page.locator('[data-facet-kind]:not([hidden])').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
  });

  test('puts the selection in the URL, and a shared URL restores it', async ({ page }) => {
    await page.goto('/explore/');
    await page.getByRole('group', { name: 'Kind' }).getByRole('checkbox').first().check();
    await page.getByLabel('Name contains').fill('Amiga');
    await expect(page).toHaveURL(/[?&]q=Amiga/);

    const shared = page.url();
    const visible = await page.locator('[data-facet-kind]:not([hidden])').count();

    await page.goto(shared);
    await expect(page.getByLabel('Name contains')).toHaveValue('Amiga');
    await expect(page.locator('[data-facet-kind]:not([hidden])')).toHaveCount(visible);
  });

  test('gives every record back when the filters are cleared', async ({ page }) => {
    await page.goto('/explore/');
    const total = await page.locator('[data-facet-kind]').count();
    await page.getByLabel('Name contains').fill('Amiga');
    expect(await page.locator('[data-facet-kind]:not([hidden])').count()).toBeLessThan(total);

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('[data-facet-kind]:not([hidden])')).toHaveCount(total);
    await expect(page).toHaveURL(/\/explore\/$/);
  });

  test('is a disclosure on a phone and a standing panel on a desktop', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/explore/');
    const summary = page.getByRole('group', { name: 'Kind' });
    // Collapsed: the catalog is what a reader came for, and 2 800 px of
    // controls above it is not a filter panel but a wall.
    await expect(summary).toBeHidden();
    await page.getByText('Show filters').click();
    await expect(summary).toBeVisible();

    // Wide enough for the two-column layout: open, with no disclosure at all.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(summary).toBeVisible();
    await expect(page.getByText('Hide filters')).toBeHidden();
  });

  test('explains a combination that matches nothing instead of showing a blank page', async ({
    page,
  }) => {
    await page.goto('/explore/?q=nothingmatchesthis');
    await expect(page.getByText(/Nothing matches this combination/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
  });
});

/*
 * Explore sends a reader to Research twice: once in the lede, once in a closing
 * note. Both are conditional, because a catalog whose every record has grown a
 * figure leaves Research empty, and a sentence pointing at an empty page is
 * worse than no sentence. The assertion is written as the invariant rather than
 * as today's state, so it holds whichever side of that line the catalog is on.
 */
test('Explore mentions Research only while Research holds something', async ({ page }) => {
  await page.goto('/research/');
  const empty = await page
    .getByText('No records currently await a first numeric measurement.')
    .count();

  await page.goto('/explore/');
  const mentions = await page.locator('main a[href$="/research/"]').count();

  expect(mentions === 0).toBe(empty === 1);
});
