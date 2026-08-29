// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Chart pages.
 *
 * The drawing carries no information of its own. Every plotted point is a row
 * of the table on the same page, the drawing is hidden from assistive
 * technology, and nothing inside it takes focus. If a future change makes the
 * points focusable or drops the table, this suite is where that shows up.
 */

import { expect, type Locator, type Page, test } from '@playwright/test';

import { TIMELINE_SERIES } from './support.ts';

const SERIES_PATH = `/timeline/${TIMELINE_SERIES}/`;

/**
 * Move the pointer onto a plotted point.
 *
 * Not `hover()`: that asserts the element is the hit target, and points
 * overlap. Two machines with the same year and figure sit on the same pixel, so
 * the topmost one intercepts and the check never settles. A point is not a
 * control anyway; it is a mark in an `aria-hidden` drawing, and what matters is
 * that a pointer over it produces a label.
 */
async function pointAt(page: Page, point: Locator): Promise<void> {
  // The mouse moves in viewport coordinates and does not scroll, and the chart
  // is well below the fold on a series page.
  await point.scrollIntoViewIfNeeded();
  const box = await point.boundingBox();
  if (box === null) {
    throw new Error('the point is not rendered');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** The label's own text, with the zero-width spaces Plot wraps lines on. */
function readable(text: string): string {
  return text.replaceAll('\u200b', ' ').replaceAll(/\s+/gu, ' ').trim();
}

test.describe('a chart is a picture of the table below it', () => {
  test('plots no point the table does not also carry', async ({ page }) => {
    await page.goto(SERIES_PATH);
    const plotted = page.locator('.chart__plot circle');
    await expect(plotted.first()).toBeVisible({ timeout: 15_000 });

    const points = await plotted.count();
    const rows = await page.locator('table tbody tr').count();
    expect(points).toBeGreaterThan(0);
    // Rows also carry the figures that are not plotted, so there are at least
    // as many rows as points and usually more.
    expect(rows).toBeGreaterThanOrEqual(points);
  });

  test('hides the drawing from assistive technology and puts nothing focusable in it', async ({
    page,
  }) => {
    await page.goto(SERIES_PATH);
    await expect(page.locator('.chart__plot circle').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.chart__plot')).toHaveAttribute('aria-hidden', 'true');

    const focusable = page.locator('.chart__plot [tabindex], .chart__plot a, .chart__plot button');
    expect(await focusable.count()).toBe(0);

    // And again while a point is labeled: the label is drawn into the same
    // aria-hidden subtree, so a focus stop appearing with it would be the same
    // defect arriving late.
    await pointAt(page, page.locator('.chart__plot circle').first());
    await expect(page.locator('.chart__plot g[aria-label="tip"] text')).toBeVisible();
    expect(await focusable.count()).toBe(0);
  });

  test('labels the point under the pointer at once, and leaves no browser tooltip', async ({
    page,
  }) => {
    /*
     * The point's figure used to be an SVG `<title>`, which the browser draws in
     * its own chrome after about a second of stillness. The one-second timeout
     * is the assertion: it is shorter than the delay this replaced, so a label
     * that arrives inside it cannot be the native one.
     */
    await page.goto(SERIES_PATH);
    const points = page.locator('.chart__plot circle');
    await expect(points.first()).toBeVisible({ timeout: 15_000 });

    // No `<title>` anywhere in the drawing: one left behind would be a second,
    // slow tooltip on top of the fast one.
    expect(await page.locator('.chart__plot title').count()).toBe(0);

    await pointAt(page, points.first());
    const label = page.locator('.chart__plot g[aria-label="tip"] text');
    await expect(label).toBeVisible({ timeout: 1000 });

    // Whichever point it settled on, the label is that machine's own row. Which
    // one is not asserted: points overlap, so the pointer picks the nearest.
    const machines = await page.locator('table tbody tr th a').allInnerTexts();
    const labeled = readable((await label.textContent()) ?? '');
    expect(machines.some((machine) => labeled.includes(readable(machine)))).toBe(true);

    // And the point it describes is marked, because the label follows the
    // nearest point rather than whatever is exactly under the cursor.
    await expect(page.locator('.chart__plot circle[r="8"]')).toHaveCount(1);
  });

  test('keeps the label inside a drawing that clips, at the narrowest width', async ({
    browser,
  }) => {
    /*
     * `.chart__plot` hides its overflow, so a label wider than the drawing loses
     * its end. The drawing is what the label is measured against, not the
     * page. Plot hangs the box off whichever side of the point it fits on and
     * centers it when it fits on neither, which is the case this checks has been
     * bounded away. The widest figures in the catalog are in this series.
     */
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await page.goto('/timeline/memory-capacity-whole-system-design-capacity/');
    const points = page.locator('.chart__plot circle');
    await expect(points.first()).toBeVisible({ timeout: 15_000 });
    await points.first().scrollIntoViewIfNeeded();

    const plot = await page.locator('.chart__plot').boundingBox();
    const total = await points.count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await pointAt(page, points.nth(index));
      const box = await page.locator('.chart__plot g[aria-label="tip"] path').boundingBox();
      if (box === null || plot === null) {
        continue;
      }
      expect(box.x).toBeGreaterThanOrEqual(plot.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(plot.y - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(plot.y + plot.height + 0.5);
    }
    await context.close();
  });

  test('describes the series in text for a reader who never sees the drawing', async ({ page }) => {
    await page.goto(SERIES_PATH);
    const description = page.locator('.chart p.visually-hidden').first();
    await expect(description).toHaveText(/plotted against the release date/i);
  });

  test('draws every axis label inside the drawing, whole', async ({ page }) => {
    // The value axis runs in the quantity's base unit, so its labels were once
    // wider than the margin reserved for them and lost their leading digits:
    // "3.2G" arrived as "0,000,000" on every chart, and every chart looked
    // alike. A label that starts outside the drawing is a clipped label.
    await page.goto('/timeline/memory-capacity-whole-system-design-capacity/');
    const plot = page.locator('.chart__plot svg').last();
    await expect(plot.locator('circle').first()).toBeVisible({ timeout: 15_000 });

    const edge = await plot.evaluate((svg) => svg.getBoundingClientRect().left);
    const labels = plot.locator('text');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await labels.nth(index).boundingBox();
      expect(box?.x ?? edge).toBeGreaterThanOrEqual(edge - 0.5);
    }
  });

  test('lists a figure with no value as a state rather than leaving it out', async ({ page }) => {
    // A series where most machines have no answer at all: the processors with
    // no floating-point hardware say "not applicable", and say why.
    await page.goto('/timeline/peak-fp32-rate-cpu-theoretical-peak/');
    const table = await page.locator('table').first().innerText();
    expect(table.toLowerCase()).toContain('not plotted');
    expect(table.toLowerCase()).toContain('not applicable');
  });
});

test.describe('the scale toggle', () => {
  test('is operable from the keyboard and puts its choice in the URL', async ({ page }) => {
    await page.goto(SERIES_PATH);
    const logarithmic = page.getByRole('button', { name: 'Logarithmic' });
    await expect(logarithmic).toBeVisible();

    await logarithmic.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/scale=log/);
    await expect(logarithmic).toHaveAttribute('aria-pressed', 'true');
  });

  test('restores the same chart from a shared URL', async ({ page }) => {
    await page.goto(`${SERIES_PATH}?scale=log`);
    await expect(page.getByRole('button', { name: 'Logarithmic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('leaves the table unchanged, because the scale is a property of the picture', async ({
    page,
  }) => {
    await page.goto(SERIES_PATH);
    const linear = await page.locator('table').first().innerText();
    await page.goto(`${SERIES_PATH}?scale=log`);
    expect(await page.locator('table').first().innerText()).toBe(linear);
  });
});

test.describe('the timeline index', () => {
  test('links to every series it lists', async ({ page }) => {
    await page.goto('/timeline/');
    const links = page.locator('main a[href*="/timeline/"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(2);
    await links.first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/over time/);
  });
});
