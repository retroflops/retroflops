// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/** System-driven color-scheme behavior. */

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DARK_PAGE = 'rgb(20, 24, 20)';
const DARK_TEXT = 'rgb(240, 243, 235)';
const LIGHT_CHART_APPROVED = 'rgb(13, 107, 65)';
const DARK_CHART_APPROVED = 'rgb(101, 216, 155)';

async function seriousViolations(page: Page): Promise<readonly string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
  return violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id} (${node.target.join(' ')})`),
    );
}

test('follows the system setting and exposes matching browser chrome colors', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 240, 230)');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(28, 30, 29)');
  await expect(
    page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]'),
  ).toHaveAttribute('content', '#f4f0e6');
  await expect(
    page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'),
  ).toHaveAttribute('content', '#141814');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', DARK_PAGE);
  await expect(page.locator('body')).toHaveCSS('color', DARK_TEXT);
});

test('recolors a rendered chart when the system setting changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/timeline/clock-frequency-cpu-nominal-clock/');
  const point = page.locator('.chart__plot circle').first();
  await expect(point).toBeVisible({ timeout: 15_000 });
  await expect(point).toHaveCSS('fill', LIGHT_CHART_APPROVED);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.chart__plot')).toHaveCSS('background-color', 'rgb(28, 34, 29)');
  await expect(point).toHaveCSS('fill', DARK_CHART_APPROVED);
});

for (const route of [
  '/systems/commodore-64/',
  '/timeline/clock-frequency-cpu-nominal-clock/',
] as const) {
  test(`has no critical or serious axe violations in dark mode: ${route}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (route.startsWith('/timeline/')) {
      await expect(page.locator('.chart__plot circle').first()).toBeVisible({ timeout: 15_000 });
    }
    expect(await seriousViolations(page)).toEqual([]);
  });
}
