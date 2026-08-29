// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Browser-side access to the published catalog.
 *
 * The Compare builder assembles comparisons the build could not have enumerated
 * there are far too many combinations of four records to pre-render, so it
 * fetches the same `catalog-v1.json` the site publishes and runs the same engine
 * over it.
 *
 * Unlike the build-time loader in `catalog.ts` this does not validate with Zod.
 * The artifact was validated when it was produced: `data:validate` ran over the
 * canonical records, `data:build` refused to write an invalid export, and
 * `catalog.ts` parsed it again for every page rendered from it. Shipping a schema
 * validator to the browser to re-check a file that has already passed three gates
 * would cost every reader tens of kilobytes to defend against nothing. The cast
 * is therefore deliberate, and it is confined to this module so it is easy to
 * find if that reasoning ever stops holding.
 */

import type { Catalog } from './data/schema.ts';

export class CatalogFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogFetchError';
  }
}

let cached: Catalog | undefined;

/** Fetches the catalog once per page. */
export async function fetchCatalog(url: string): Promise<Catalog> {
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new CatalogFetchError(
      `The catalog could not be loaded from ${url} (HTTP ${response.status}).`,
    );
  }
  const catalog = (await response.json()) as Catalog;
  if (!Array.isArray(catalog.systems) || !Array.isArray(catalog.measurements)) {
    throw new CatalogFetchError(`${url} does not look like a RetroFlops catalog export.`);
  }
  cached = catalog;
  return catalog;
}
