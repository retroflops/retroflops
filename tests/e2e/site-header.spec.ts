// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The header that stays.
 *
 * Pinning the bar puts navigation within reach of a long profile's last
 * paragraph, and in exchange makes a promise about the top of the viewport:
 * everything else that sticks has to stop below it, and every anchor has to
 * land where it can be read. Both are held by one number, `--header-height`,
 * which is arithmetic rather than a measurement. The first thing these
 * tests check is that the arithmetic is still true.
 */

import { expect, test, type Page } from '@playwright/test';

import { VIEWPORTS } from './support.ts';

/** Where the bar sits right now, in viewport coordinates. */
async function headerBox(page: Page): Promise<{ top: number; bottom: number }> {
  return page.locator('.site-header').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
}

/** The height the tokens claim, resolved to pixels by the browser. */
async function statedHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.blockSize = 'var(--header-height)';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
}

const scrollDown = (page: Page, y = 1200) => page.evaluate((to) => window.scrollTo(0, to), y);

/** Scoped to the bar, because a profile's breadcrumb names Explore as well. */
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name });

test('stays at the top of the viewport while a long page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/systems/commodore-64/');

  await scrollDown(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await headerBox(page)).top).toBeCloseTo(0, 0);
  await expect(navLink(page, 'Explore')).toBeVisible();
});

test('is exactly as tall as the tokens say, at every width', async ({ page }) => {
  await page.goto('/systems/commodore-64/');

  for (const { name, width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    const stated = await statedHeight(page);
    const { top, bottom } = await headerBox(page);
    // One pixel of tolerance for a sub-pixel line box, no more: the offsets
    // below the bar are computed from the stated number, so a header that
    // outgrew it would hide a table heading instead of failing here.
    expect(Math.abs(bottom - top - stated), `${name} header height`).toBeLessThanOrEqual(1);
  }
});

test('picks up a shadow once there is content behind it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/systems/commodore-64/');
  const header = page.locator('.site-header');

  const supported = await page.evaluate(
    () =>
      CSS.supports('animation-timeline: scroll(root block)') &&
      CSS.supports('animation-range: 100vh 100%'),
  );
  test.skip(!supported, 'no scroll-driven animations, so the bar keeps its plain rule');

  // Flat against the top of its own page, raised over anything that has passed
  // behind it. The hairline stays either way; this is the part that says depth.
  // An animated `none` computes to a transparent shadow rather than the
  // keyword, so the unscrolled state is asserted on its being invisible.
  await expect(header).toHaveCSS('box-shadow', /^(none|rgba\(0, 0, 0, 0\))/);
  await scrollDown(page);
  await expect(header).toHaveCSS('box-shadow', /6px 12px/);
});

test('scrolls away where the viewport is too short to spare the room', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await page.goto('/systems/commodore-64/');

  await scrollDown(page, 600);
  expect((await headerBox(page)).bottom).toBeLessThan(0);
});

test.describe('nothing else pinned hides behind it', () => {
  test("Explore's filter panel parks below the bar and ends on screen", async ({ page }) => {
    for (const { width, height } of [
      { width: 1280, height: 800 },
      // The narrowest viewport in the matrix where the panel sticks at all.
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto('/explore/');
      // The panel is a client-only island; there is nothing to measure until
      // it has rendered inside its wrapper.
      await expect(page.locator('.explore__panel .filters')).toBeVisible();

      await scrollDown(page, 2000);
      const bar = await headerBox(page);
      const panel = await page.locator('.explore__panel').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      });

      expect(panel.top, `${width}×${height} panel top`).toBeGreaterThanOrEqual(bar.bottom - 1);
      expect(panel.bottom, `${width}×${height} panel bottom`).toBeLessThanOrEqual(height + 1);
    }
  });

  test("a comparison's metric heading and table head stack under it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/compare/03-four-consoles/');

    await scrollDown(page, 1500);
    const bar = await headerBox(page);
    const heading = await page.locator('.cmp-block__title').first().boundingBox();
    const head = await page.locator('.cmp-table thead').first().boundingBox();

    expect(heading?.y ?? -1).toBeGreaterThanOrEqual(bar.bottom - 1);
    expect(head?.y ?? -1).toBeGreaterThanOrEqual(bar.bottom - 1);
  });

  test("a profile's measurement table keeps its header row visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/systems/commodore-64/');

    const table = page.locator('.measurement-table table').first();
    await table.scrollIntoViewIfNeeded();
    await scrollDown(page, 2500);
    const bar = await headerBox(page);
    const head = await table.locator('thead th').first().boundingBox();

    // Only while the table is still on screen; once it has scrolled past, its
    // header row goes with it and there is nothing to compare.
    if (head && head.y < 800) {
      expect(head.y).toBeGreaterThanOrEqual(bar.bottom - 1);
    }
  });
});

test('an anchor lands where it can be read, not behind the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#rules');

  const bar = await headerBox(page);
  const heading = await page.locator('#rules').boundingBox();
  expect(heading?.y ?? -1).toBeGreaterThanOrEqual(bar.bottom);
});

test('the collapsed menu still opens once the bar is pinned', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/systems/commodore-64/');

  await scrollDown(page);
  await page.locator('.site-menu__toggle').click();
  await expect(navLink(page, 'Explore')).toBeVisible();

  // The panel hangs off the header, so it has to have travelled with it. It
  // starts a hairline higher than the header's outer edge, because `100%` of
  // the containing block is the padding box and the lower rule sits outside it.
  const bar = await headerBox(page);
  const panel = await page.locator('.site-nav').boundingBox();
  expect(Math.abs((panel?.y ?? -1) - bar.bottom)).toBeLessThanOrEqual(2);
});
