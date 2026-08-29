// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The comparison builder.
 *
 * The property being tested is that the address bar is the state: two readers
 * with the same URL see the same comparison, in the same column order, and a
 * comparison that the rules refuse still renders as a written refusal rather
 * than as an error or an empty cell.
 */

import { expect, test } from '@playwright/test';

import { AWKWARD_COMPARE_QUERY, FOUR_UP_COMPARE_QUERY } from './support.ts';

test.describe('a comparison restored from its URL', () => {
  test('shows two records with the metrics they share', async ({ page }) => {
    await page.goto(`/compare/${AWKWARD_COMPARE_QUERY}`);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /Apollo Guidance Computer/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: /RTX 5090/ }).first()).toBeVisible();
  });

  test('shows four records without dropping any of them', async ({ page }) => {
    await page.goto(`/compare/${FOUR_UP_COMPARE_QUERY}`);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    for (const name of ['Commodore 64', 'Amiga 500', 'Amiga 1200', 'PlayStation']) {
      // A record is a column, so it is a column header. The old locator asked
      // for a `cell` and only ever passed while some cell happened to spell the
      // name out in its body.
      await expect(
        page.getByRole('columnheader', { name: new RegExp(name) }).first(),
      ).toBeVisible();
    }
  });

  test('names the records it is comparing in the chips as well as the columns', async ({
    page,
  }) => {
    await page.goto('/compare/?systems=commodore-64,amiga-500');
    await expect(page.locator('.builder__chip')).toHaveCount(2);
    await expect(page.locator('.builder__chip').first()).toContainText('Commodore 64');
    await expect(page.locator('.builder__chip').first()).toContainText('baseline');
  });
});

test.describe('building one by hand', () => {
  test('clears a record search from its in-field control', async ({ page }) => {
    await page.goto('/compare/');
    const search = page.getByLabel('Find a record');
    await search.fill('Amiga');

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
  });

  test('finds canonical records by an editorial alias', async ({ page }) => {
    await page.goto('/compare/');
    await page
      .getByLabel(/Search records|Find a record|Name contains|Search/)
      .first()
      .fill('psx');

    await expect(page.getByRole('checkbox', { name: /^Sony PlayStation Console/ })).toBeVisible();
  });

  test('keeps a long record name beside its checkbox', async ({ page }) => {
    await page.goto('/compare/');
    await page
      .getByLabel(/Search records|Find a record|Name contains|Search/)
      .first()
      .fill('Apollo');

    const checkbox = page.getByRole('checkbox', {
      name: /^Apollo Guidance Computer \(Block II\)/,
    });
    const option = checkbox.locator('..');
    const [checkboxBox, name] = await Promise.all([
      checkbox.boundingBox(),
      option.locator('.builder__option-name').boundingBox(),
    ]);

    expect(checkboxBox).not.toBeNull();
    expect(name).not.toBeNull();
    expect(name?.x).toBeGreaterThan(checkboxBox?.x ?? 0);
    expect(name?.y).toBeLessThanOrEqual((checkboxBox?.y ?? 0) + 1);
  });

  test('adds records, computes a comparison and writes the selection into the URL', async ({
    page,
  }) => {
    await page.goto('/compare/');
    await page
      .getByLabel(/Search records|Find a record|Name contains|Search/)
      .first()
      .fill('Amiga');
    const options = page.locator('.builder__option input[type="checkbox"]');
    await options.nth(0).check();
    await options.nth(1).check();

    await expect(page).toHaveURL(/systems=/);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  });

  test('reorders the columns, and the new order survives a reload', async ({ page }) => {
    await page.goto('/compare/?systems=commodore-64,amiga-500');
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();

    await page.getByRole('button', { name: /Make baseline.*Amiga 500/ }).click();
    await expect(page).toHaveURL(/systems=amiga-500,commodore-64/);

    const reordered = page.url();
    await page.goto(reordered);
    await expect(page.locator('.builder__chip').first()).toContainText('Amiga 500');
  });

  test('removes a record and stops comparing rather than showing one column', async ({ page }) => {
    await page.goto('/compare/?systems=commodore-64,amiga-500');
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    await page.getByRole('button', { name: /Remove.*Amiga 500/ }).click();
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeHidden();
    await expect(page.locator('.builder__chip')).toHaveCount(1);
  });
});

test.describe('prepared comparisons', () => {
  test('render completely without the builder', async ({ page }) => {
    await page.goto('/compare/01-two-guidance-computers/');
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    await expect(page.locator('.cmp-table').first()).toBeVisible();
  });

  test('write out why a multiplier is refused instead of hiding the row', async ({ page }) => {
    await page.goto('/compare/04-what-a-pre-launch-spec-costs/');
    const main = await page.locator('main').innerText();
    expect(main.toLowerCase()).toContain('provisional');
  });

  /*
   * The quarantine has nothing to hold. Every record the prepared comparisons
   * select now carries a figure, so no comparison is a methodology example and
   * `/research/` lists nobody. What that state has to prove is the reverse of
   * what it once did: a comparison released from quarantine is an ordinary
   * catalog page again, indexed and exported, at the address it always had.
   *
   * The quarantine machinery itself keeps its coverage in `presets.test.ts`,
   * which builds a catalog where a record still lacks a value rather than
   * waiting for one to reappear here.
   */
  test('releases a comparison from quarantine at the address it always had', async ({
    page,
    request,
  }) => {
    await page.goto('/compare/');
    await expect(page.getByRole('heading', { name: 'Prepared comparisons' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Methodology examples' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'From GeForce 256 to RTX 5090' })).toBeVisible();

    await page.goto('/compare/06-from-geforce-256-to-rtx-5090/');
    await expect(page.getByLabel('Research example notice')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('main[data-pagefind-ignore]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();

    await page.goto('/research/');
    await expect(page.getByRole('heading', { name: 'Research records' })).toBeVisible();
    await expect(
      page.getByText('No records currently await a first numeric measurement.'),
    ).toBeVisible();

    const [sitemap, llms] = await Promise.all([
      request.get('/sitemap.xml').then((response) => response.text()),
      request.get('/llms.txt').then((response) => response.text()),
    ]);
    expect(sitemap).toContain('/compare/06-from-geforce-256-to-rtx-5090/');
    expect(llms).toContain('/compare/06-from-geforce-256-to-rtx-5090/');
  });

  test('an old shared comparison link still answers', async ({ page }) => {
    await page.goto(
      '/compare/?systems=nvidia-geforce-256,nvidia-geforce-8800-gtx,nvidia-geforce-gtx-1080,nvidia-geforce-rtx-5090',
    );
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    // The warning went with the research record that caused it. The link did not.
    await expect(page.getByText(/This link includes a research record/)).toHaveCount(0);
  });

  test('places the compared records among named neighbors, not anonymous ticks', async ({
    page,
  }) => {
    await page.goto('/compare/03-four-consoles/');

    // Folded away until it is asked for: open, three of these run to a fifth of
    // the card on a desktop and to a screen and a half on a phone.
    const axis = page.locator('.glance-axis').first();
    await expect(axis).toBeHidden();
    await page.locator('.glance-axis-detail > summary').first().click();
    await expect(axis).toBeVisible();

    // Every mark is a machine a reader can place, and at least one of them is a
    // machine that was not asked for. That is the point of the axis.
    const legend = await axis.locator('.glance-axis__legend').innerText();
    expect(legend).toContain('Sony PlayStation');
    expect(legend).toContain('Intel 80486DX PC');

    // A rank, never a multiple, and always with the scale named.
    const standings = await axis.locator('.glance-axis__standings').innerText();
    expect(standings).toMatch(/lowest of the \d+ figures recorded this way/);
    await expect(axis.locator('.glance-axis__scale')).toContainText(/(logarithmic|linear) scale/);
  });
});
