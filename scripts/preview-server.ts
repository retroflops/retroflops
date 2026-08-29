// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Serves a finished build, the way the end-to-end suite needs it served.
 *
 * `astro preview` is a single-instance command: it writes `.astro/preview.json`
 * for the project root and refuses to start while another preview holds that
 * lock, whatever port it was asked for. The end-to-end suite serves two builds
 * at once, the root-domain one and the `/retroflops/` one, so the second
 * server could never start. Astro's programmatic preview serves exactly the
 * same files without the CLI's bookkeeping, and stays a plain foreground
 * process, which is what Playwright's `webServer` waits on. Which build gets
 * served is still the environment's decision, read by `astro.config.ts`.
 */

import { preview } from 'astro';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const host = flag('host') ?? '127.0.0.1';
  const requestedPort = flag('port');
  const port = requestedPort === undefined ? undefined : Number(requestedPort);
  if (port !== undefined && !Number.isInteger(port)) {
    console.error(`preview: --port expects a whole number, not ${requestedPort}`);
    process.exitCode = 1;
    return;
  }

  const server = await preview({
    root: process.cwd(),
    server: { host, ...(port === undefined ? {} : { port }) },
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.stop().then(() => process.exit(0));
    });
  }
}

await main();
