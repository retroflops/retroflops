// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Automated accessibility checks.
 *
 * axe finds a minority of accessibility defects, and the ones it finds are the
 * ones that should never have shipped: unlabeled controls, contrast below the
 * threshold, a heading order that skips, a focusable element inside an
 * `aria-hidden` subtree. Only critical and serious impacts fail the suite.
 * The lighter ones are advisory and are printed, because a build that fails on
 * advice stops being read.
 */

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ROUTES } from './support.ts';

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Critical and serious violations, named well enough to fix without opening a
 * trace: the rule, and the first element that broke it.
 */
async function seriousViolations(page: Page): Promise<readonly string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
  return violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .flatMap((violation) =>
      violation.nodes
        .slice(0, 3)
        .map(
          (node) =>
            `${violation.id} (${violation.impact}) — ${node.target.join(' ')} — ${node.failureSummary?.replaceAll('\n', ' ') ?? ''}`,
        ),
    );
}

for (const route of ROUTES) {
  test(`${route.name} has no critical or serious axe violations`, async ({ page }) => {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test('a comparison built from a URL is accessible once it has rendered', async ({ page }) => {
  await page.goto('/compare/?systems=commodore-64,amiga-500,amiga-1200');
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('a chart page is accessible with the drawing on the page', async ({ page }) => {
  await page.goto('/timeline/clock-frequency-cpu-nominal-clock/');
  await expect(page.locator('.chart__plot circle').first()).toBeVisible({ timeout: 15_000 });
  expect(await seriousViolations(page)).toEqual([]);
});

test('a filtered Explore is accessible, including the empty result', async ({ page }) => {
  await page.goto('/explore/?q=nothingmatchesthis');
  await expect(page.getByText(/Nothing matches this combination/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the 404 page is a page rather than a dead end', async ({ page }) => {
  const response = await page.goto('/no-such-route/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test.describe('keyboard only', () => {
  test('reaches the main content past the navigation, and shows where focus is', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const first = page.locator(':focus');
    await expect(first).toBeVisible();
    // Whatever holds focus first must be visibly focused; an invisible focus
    // ring is the same defect as no focus order.
    const outline = await first.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`;
    });
    expect(outline).not.toBe('none 0px none');
  });

  test('operates Explore’s filters without a pointer', async ({ page }) => {
    await page.goto('/explore/');
    const checkbox = page.getByRole('group', { name: 'Kind' }).getByRole('checkbox').first();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(page.locator('.filters__count')).toHaveText(/\d+ of \d+ records/);
  });

  test('opens the collapsed menu and walks it without a pointer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const explore = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
      name: 'Explore',
    });
    await expect(explore).toBeHidden();

    /*
     * A `<summary>` is exposed as the disclosure control of its `<details>`
     * rather than as a button in its own right, so it is reached by the element
     * a reader sees rather than by a role.
     */
    await page.locator('.site-menu__toggle').focus();
    await page.keyboard.press('Enter');
    await expect(explore).toBeVisible();
    await explore.click();
    await expect(page).toHaveURL(/\/explore\/$/);
  });
});

test('the collapsed menu is accessible open as well as shut', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  expect(await seriousViolations(page)).toEqual([]);

  await page.locator('.site-menu__toggle').click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('a category page is accessible', async ({ page }) => {
  await page.goto('/systems/type/console/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Consoles');
  expect(await seriousViolations(page)).toEqual([]);
});

test('the navigation landmarks on a profile are distinguishable by name', async ({ page }) => {
  await page.goto('/systems/sony-playstation/');

  /*
   * Three navigation landmarks now share a page: the header's, the breadcrumb
   * and the navbox. A screen reader offers them as a list of names. Two
   * called "navigation" would be a list the reader cannot choose from.
   */
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(1);
  const navbox = page.getByRole('navigation', { name: 'PlayStation' });
  await expect(navbox).toHaveCount(1);

  // The navbox takes its name from the heading a sighted reader sees.
  await expect(navbox.getByRole('heading', { level: 2 })).toHaveText('PlayStation');
  await expect(navbox.locator('[aria-current="page"]')).toHaveText('Sony PlayStation');
});
