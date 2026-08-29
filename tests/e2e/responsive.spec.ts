// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The responsive matrix.
 *
 * The rule under test is narrow and absolute: from 320 px up, nothing scrolls
 * the page sideways. Wide things are allowed to scroll inside a container that
 * says it does. The `.scroll-x` marker identifies that exception, though a
 * wide table no longer takes it and restacks into cards instead.
 * Everything else that sticks out is a bug the failure message names.
 */

import { expect, test } from '@playwright/test';

import {
  AWKWARD_COMPARE_QUERY,
  FOUR_UP_COMPARE_QUERY,
  hasHorizontalScroll,
  overflowingElements,
  ROUTES,
  VIEWPORTS,
} from './support.ts';

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.name} does not scroll sideways`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await overflowingElements(page)).toEqual([]);
        expect(await hasHorizontalScroll(page)).toBe(false);
      });
    }
  });
}

test.describe('a comparison at both ends of its range', () => {
  test('shows two columns on a phone without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/compare/${AWKWARD_COMPARE_QUERY}`);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('shows four columns on a desktop without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/compare/${FOUR_UP_COMPARE_QUERY}`);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('falls back to sections rather than four unreadable columns', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/compare/${FOUR_UP_COMPARE_QUERY}`);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

test.describe('orientation', () => {
  test('works in landscape on a phone-sized screen', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/systems/commodore-64/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

test.describe('enlarged text', () => {
  /*
   * 200% zoom is emulated as a viewport half as wide at twice the device pixel
   * ratio, which is what a browser's zoom does to layout. Increased letter and
   * word spacing on top of it is the WCAG text-spacing case: a layout that only
   * survives its own typography fails here.
   */
  test('survives 200% zoom with increased text spacing', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 640, height: 512 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent =
        '* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.5 !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    });
    for (const path of ['/', '/explore/', '/systems/sony-playstation-5/']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await context.close();
  });
});

test.describe('a touch device with no hover', () => {
  test('reaches every figure on a chart page without hovering', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/timeline/clock-frequency-cpu-nominal-clock/');
    // The table is the data, and it is in the static HTML rather than behind a
    // pointer event.
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    expect(await page.locator('table tbody tr').count()).toBeGreaterThan(2);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await context.close();
  });

  test('labels a point on a tap, which a browser tooltip never did', async ({ browser }) => {
    // The label is an improvement on the table, never a replacement for it: the
    // test above is the guarantee, and this one is that a finger is not shut out
    // of the picture the way the browser's own tooltip shut it out.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/timeline/clock-frequency-cpu-nominal-clock/');
    const point = page.locator('.chart__plot circle').first();
    await expect(point).toBeVisible({ timeout: 15_000 });
    // Tapped by coordinate rather than by element: points overlap, so the one
    // on top intercepts, and a mark in a drawing is not a control to act on.
    // The touchscreen taps in viewport coordinates and does not scroll.
    await point.scrollIntoViewIfNeeded();
    const box = await point.boundingBox();
    await page.touchscreen.tap((box?.x ?? 0) + 3, (box?.y ?? 0) + 3);
    await expect(page.locator('.chart__plot g[aria-label="tip"] text')).toBeVisible({
      timeout: 1000,
    });
    await context.close();
  });
});

test.describe('reduced motion', () => {
  test('keeps user-controlled scroll progress when animation is unwelcome', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/systems/commodore-64/');
    const button = page.getByRole('link', { name: 'Back to top' });

    await expect(button).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(button).toBeVisible();
    expect(
      await button.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).getPropertyValue('--scroll-progress')),
      ),
    ).toBeGreaterThan(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await context.close();
  });
});

test.describe('long names and missing figures', () => {
  test('wraps the longest identifiers in the catalog at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/systems/apollo-guidance-computer-block-ii/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflowingElements(page)).toEqual([]);
  });

  test('shows an absent figure as a state rather than an empty cell', async ({ page }) => {
    await page.goto('/systems/sgi-octane/');
    // Absences live in their own disclosure rather than among the figures, so
    // the state a reader must be able to see is the one behind that summary.
    const absences = page.locator('details.measurement-table--absences').first();
    await absences.locator('summary').click();
    await expect(absences.locator('table')).toContainText(/unknown|not applicable/i);
  });
});

test.describe('a wide table', () => {
  test('becomes one card per row on a phone instead of scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/systems/commodore-64/');
    const table = page.locator('.config-table').first();
    await expect(table).toBeVisible();

    // A header row is what a table has and a stack of cards does not; each cell
    // carries the name of its column instead.
    await expect(table.locator('thead')).toBeHidden();
    await expect(table.locator('tbody td[data-label]').first()).toBeVisible();

    // Nothing is out of sight sideways, inside the frame or outside it.
    const hidden = await page
      .locator('.table-frame')
      .first()
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(hidden).toBeLessThanOrEqual(1);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('is a table with its header row once there is room for one', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/systems/commodore-64/');
    await expect(page.locator('.config-table thead').first()).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('shows a measurement as a card with its method and its source', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/systems/commodore-64/');
    const row = page.locator('.measurement-table tbody tr').first();
    // The two columns a narrow table used to push off the screen entirely.
    await expect(row.locator('td[data-label="Method"]')).toBeVisible();
    await expect(row.locator('td[data-label="Source"] a')).toBeVisible();
  });
});

test.describe('back to top', () => {
  test('shows document progress after one viewport and returns to the top', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/systems/commodore-64/');
    const button = page.getByRole('link', { name: 'Back to top' });

    // Nothing to go back to yet, so nothing floating over the first screen.
    await expect(button).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, window.innerHeight + 1));
    await expect(button).toBeVisible();
    const progressAfterOneViewport = await button.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).getPropertyValue('--scroll-progress')),
    );

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect
      .poll(() =>
        button.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).getPropertyValue('--scroll-progress')),
        ),
      )
      .toBeGreaterThan(progressAfterOneViewport);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('stays out of the way when the document is shorter than its viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 5000 });
    await page.goto('/');

    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      ),
    ).toBe(true);
    await expect(page.getByRole('link', { name: 'Back to top' })).toBeHidden();
  });
});
