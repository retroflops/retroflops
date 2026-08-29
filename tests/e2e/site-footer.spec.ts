// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The build stamp in the footer.
 *
 * It is the one line on the site that describes the site rather than the
 * hardware, and it exists so that a correction can name a build somebody
 * actually read. Two things have to hold: it is on every page, not just the
 * home page, and the date a reader sees is the one a machine parses out of the
 * attribute beside it.
 */

import { expect, test, type Page } from '@playwright/test';

import { ROUTES } from './support.ts';

const stamp = (page: Page) => page.locator('.site-footer__build');

test('every kind of page carries it', async ({ page }) => {
  for (const { path, name } of ROUTES) {
    await page.goto(path);
    // `useInnerText`, because the source breaks the line where the sentence
    // wants a space and the assertion should read what a reader reads.
    await expect(stamp(page), name).toHaveText(
      /^Version \d+\.\d+\.\d+, built from commit [0-9a-f]{7} of \d{1,2} \w+ \d{4}\.$/,
      { useInnerText: true },
    );
  }
});

test('the date a reader sees is the date a machine reads', async ({ page }) => {
  await page.goto('/');
  const time = stamp(page).locator('time');
  const datetime = (await time.getAttribute('datetime')) ?? '';
  expect(datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  // Both name the same instant in UTC. A formatter left on the machine's own
  // zone would put the visible date a day off the attribute for any commit
  // made near midnight, which is the whole reason the site pins it.
  const inUtc = new Date(datetime).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  expect((await time.innerText()).trim()).toBe(inUtc);
});
