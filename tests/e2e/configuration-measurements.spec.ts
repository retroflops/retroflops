// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function configurationRowText(
  page: Page,
  path: string,
  componentName: string,
): Promise<string> {
  await page.goto(path);
  const row = page
    .locator('.config-table tbody tr')
    .filter({ has: page.getByRole('link', { name: componentName, exact: true }) });
  await expect(row).toHaveCount(1);
  return (await row.textContent()) ?? '';
}

test.describe('configuration values come from formal measurements', () => {
  /*
   * The 6507's clock is quoted in every wiki and in no document that can
   * support a value here. The catalog now carries the wiki's figure as rumored,
   * which a reader may see on one condition: everything saying how far to trust
   * it stands beside it.
   */
  test('Atari 2600 shows the 6507 clock as the rumored figure it is', async ({ page }) => {
    const row = await configurationRowText(page, '/systems/atari-2600/', 'MOS Technology 6507');
    expect(row).toContain('1.19 MHz');
    expect(row).toContain('Nominal clock');

    const figure = page.locator('.measurement-table tbody tr').filter({ hasText: '1.19 MHz' });
    await expect(figure).toHaveCount(1);
    await expect(figure).toContainText('provisional');
    await expect(figure).toContainText('Rumored');
  });

  /*
   * The graphics clock on the same machine is the durable absence: the manual
   * names the tile-and-sprite unit and states no frequency for it, and the
   * research audit closed on there being none published to find.
   */
  test('Atari 2600 shows the absent graphics clock in configuration and figures', async ({
    page,
  }) => {
    const row = await configurationRowText(
      page,
      '/systems/atari-2600/',
      'Television Interface Adapter',
    );
    expect(row).toContain('unknown');
    expect(row).toContain('Nominal clock');
    await expect(page.locator('details.measurement-table--absences table').first()).toContainText(
      'unknown',
    );
  });

  test('PlayStation 5 labels ceilings as peak clocks and keeps nominal absent', async ({
    page,
  }) => {
    const row = await configurationRowText(
      page,
      '/systems/sony-playstation-5/',
      'PlayStation 5 custom processor (CPU section)',
    );
    expect(row).toContain('not applicable');
    expect(row).toContain('Nominal clock');
    expect(row).toContain('3.5 GHz');
    expect(row).toContain('Peak clock');
  });

  test('Game Boy renders the formal operating-frequency figure', async ({ page }) => {
    const row = await configurationRowText(page, '/systems/nintendo-game-boy/', 'Sharp LR35902');
    expect(row).toContain('1.05 MHz');
  });

  test('one component can display several referenced measurements', async ({ page }) => {
    const row = await configurationRowText(
      page,
      '/systems/sony-playstation-5/',
      'PlayStation 5 custom processor (GPU section)',
    );
    expect(row).toContain('not applicable');
    expect(row).toContain('2.23 GHz');
    expect(row).toContain('Peak clock');
  });
});
