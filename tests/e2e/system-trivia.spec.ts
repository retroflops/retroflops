// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The trivia section on a profile.
 *
 * Three things have to hold. The section says on the page that it is context
 * rather than evidence, because a reader meeting a cultural claim among sourced
 * figures has no other way to tell which they are looking at. Its citations
 * lead to the same source pages every figure's do, and those pages say what
 * rests on them. And a machine with no trivia file ends where it did before,
 * with no heading and no empty box. That is the same answer this project gives
 * for a missing photograph and a missing navbox.
 */

import { expect, test, type Page } from '@playwright/test';

const WITH_TRIVIA = '/systems/saturn-lvdc/';
// The record that stands for a processor in a typical machine of its era rather
// than a machine anybody sold. It has no photograph on purpose, and it is not
// getting a trivia section either.
const WITHOUT_TRIVIA = '/systems/intel-8086-pc/';

const trivia = (page: Page) => page.locator('section.trivia');

test('shows the section, marked as context rather than evidence', async ({ page }) => {
  await page.goto(WITH_TRIVIA);
  const section = trivia(page);
  await expect(section).toBeVisible();

  // The heading is per entry, so the anchor rather than the wording is the contract.
  await expect(section.locator('h2#trivia')).toBeVisible();
  await expect(section).toContainText('cited but not evidence');
});

test('the section has its own citations, and they resolve', async ({ page }) => {
  await page.goto(WITH_TRIVIA);
  const citation = trivia(page).locator('.source-list a').first();
  await expect(citation).toBeVisible();

  const href = await citation.getAttribute('href');
  expect(href).toMatch(/\/sources\/[a-z0-9-]+\/$/);

  // The source page reciprocates, which is why the section was worth adding there.
  await citation.click();
  await expect(page.getByRole('heading', { name: 'Trivia citing this source' })).toBeVisible();
  await expect(page.getByRole('link', { name: /yardstick/i })).toBeVisible();
});

test('the fragment link reaches the section', async ({ page }) => {
  await page.goto(`${WITH_TRIVIA}#trivia`);
  await expect(page.locator('h2#trivia')).toBeInViewport();
});

test('a machine with no trivia gets no section and no placeholder', async ({ page }) => {
  await page.goto(WITHOUT_TRIVIA);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await expect(trivia(page)).toHaveCount(0);
  await expect(page.locator('#trivia')).toHaveCount(0);
  await expect(page.getByText(/no trivia/i)).toHaveCount(0);
});
