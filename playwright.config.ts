// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * End-to-end configuration.
 *
 * Two sites are served at once, because two of the guarantees this project
 * makes can only be checked against a real build: that every route works on a
 * root domain, and that every route works unchanged under a GitHub Pages
 * repository prefix. A prefixed build is not a variant of the first — it is a
 * different set of hrefs — so it gets its own output directory, its own server
 * and its own suite.
 *
 * Both servers preview a production build rather than the dev server. Pagefind
 * only exists after `postbuild`, `client:only` islands only behave like
 * themselves once bundled, and the thing being tested is the artifact that gets
 * deployed.
 */

import { defineConfig, devices } from '@playwright/test';

const ROOT_PORT = 4321;
const PREFIX_PORT = 4322;
const PREFIX = '/retroflops/';

const ci = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: ci,
  // No retries anywhere: a test that only passes on the second attempt is
  // telling us something, and hiding it in CI is how it stops being told.
  retries: 0,
  // Two workers on CI, where the runner has two cores and more of them only
  // means the same tests waiting on each other; locally, Playwright's own count.
  ...(ci ? { workers: 2 } : {}),
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'app',
      testDir: 'tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${ROOT_PORT}/` },
    },
    {
      name: 'pages-prefix',
      testDir: 'tests/e2e-pages',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PREFIX_PORT}${PREFIX}`,
      },
    },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${ROOT_PORT}`,
      url: `http://127.0.0.1:${ROOT_PORT}/`,
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
    {
      command: `pnpm build:pages && pnpm preview:pages --host 127.0.0.1 --port ${PREFIX_PORT}`,
      url: `http://127.0.0.1:${PREFIX_PORT}${PREFIX}`,
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
  ],
});
