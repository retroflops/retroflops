// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The lead photograph on a profile.
 *
 * Three things have to hold and none of them is about how the picture looks:
 * the credit and the license are visible to a reader rather than buried in a
 * data file, the image costs a phone the phone-sized variant, and the whole
 * thing is HTML. A photograph that needs JavaScript would be the first part of
 * a profile that does.
 */

import { expect, test, type Page } from '@playwright/test';

const ILLUSTRATED = '/systems/commodore-64/';
// A record that stands for a processor in a typical machine of its era rather
// than for a machine anybody sold, so it is one of the few entries that will
// stay unillustrated on purpose however far the photography rounds get.
const UNILLUSTRATED = '/systems/intel-8086-pc/';

const photo = (page: Page) => page.locator('figure.system-photo');

test('shows the photograph with its credit, its license and its source', async ({ page }) => {
  await page.goto(ILLUSTRATED);
  const figure = photo(page);
  await expect(figure).toBeVisible();

  const image = figure.locator('img');
  await expect(image).toHaveAttribute('alt', /Commodore 64/);
  await expect(image).toHaveAttribute('width', '1280');
  await expect(image).toHaveAttribute('height', '960');

  // The credit line is a link to the file's own page and a link to the deed,
  // which together are what the license requires of us.
  await expect(figure.getByRole('link', { name: 'Evan-Amos' })).toHaveAttribute(
    'href',
    /commons\.wikimedia\.org/,
  );
  // A public domain release has no deed, so the terms link is to the wording
  // Commons publishes for it. Crediting the photographer is this project's own
  // rule and holds here exactly as it does under a license.
  await expect(figure.getByRole('link', { name: /public domain/i })).toHaveAttribute(
    'href',
    'https://commons.wikimedia.org/wiki/Template:PD-self',
  );
});

test('offers three widths and lets the browser pick', async ({ page }) => {
  await page.goto(ILLUSTRATED);
  const image = photo(page).locator('img');

  // Read the width descriptor off each candidate rather than scanning the whole
  // attribute: a build hash in a filename can itself contain a digit followed by
  // a "w", and a regex over the string then reports widths nobody asked for.
  const srcset = (await image.getAttribute('srcset')) ?? '';
  const widths = srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/).at(-1))
    .filter((descriptor) => descriptor !== undefined);
  expect(widths).toEqual(['480w', '800w', '1280w']);
  expect(await image.getAttribute('sizes')).toBeTruthy();
  // The largest variant is the canonical size and never more: the build reduces
  // a stored photograph, it does not invent detail for a wide screen.
  expect(srcset).not.toMatch(/\b(1600|1920|2560)w\b/);
});

test('is the priority image, so the profile has one clear largest paint', async ({ page }) => {
  await page.goto(ILLUSTRATED);
  const image = photo(page).locator('img');
  await expect(image).toHaveAttribute('loading', 'eager');
  await expect(image).toHaveAttribute('fetchpriority', 'high');
});

test('keeps its proportions and stays inside a 320 px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(ILLUSTRATED);
  const image = photo(page).locator('img');
  await expect(image).toBeVisible();

  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeLessThanOrEqual(320);
  // 4:3, within a pixel of rounding.
  expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - 4 / 3)).toBeLessThan(0.02);
});

test('sits beside the text once there is room for both', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ILLUSTRATED);
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const figure = await photo(page).boundingBox();
  expect(heading).not.toBeNull();
  expect(figure).not.toBeNull();
  // Two columns: the photograph starts to the right of where the heading ends.
  expect(figure?.x ?? 0).toBeGreaterThan((heading?.x ?? 0) + (heading?.width ?? 0) - 1);
});

test('a machine with no photograph shows no placeholder', async ({ page }) => {
  await page.goto(UNILLUSTRATED);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(photo(page)).toHaveCount(0);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the photograph, the credit and the license are all still there', async ({ page }) => {
    await page.goto(ILLUSTRATED);
    const figure = photo(page);
    await expect(figure.locator('img')).toBeVisible();
    await expect(figure.getByRole('link', { name: /public domain/i })).toBeVisible();
    await expect(figure.locator('figcaption')).toContainText('Commodore 64');
  });
});
