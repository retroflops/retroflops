// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Joins an image record to the file it describes.
 *
 * The record lives in the published catalog and the pixels live in
 * `src/assets`, so that the build can generate the responsive variants from a
 * local asset and never at request time. This module is the one place the two
 * meet, which keeps the lookup, and the failure when a record names a file
 * that is not there, out of the page templates.
 *
 * Build-time only, like the rest of `catalog.ts`.
 */

import { getCatalog } from './catalog.ts';
import type { ImageAsset, System } from './data/schema.ts';

const ASSET_DIRECTORY = '/src/assets/images/systems';

/**
 * Eager because a profile page needs the metadata, width, height, hashed path
 * while rendering its own frontmatter, and there is no moment later at which
 * a static page could wait for a dynamic import.
 */
const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/images/systems/*.avif', {
  eager: true,
});

export interface SystemImage {
  readonly asset: ImageAsset;
  readonly file: ImageMetadata;
}

export function getImageById(id: string): ImageAsset | undefined {
  return getCatalog().images.find((image) => image.id === id);
}

/**
 * The lead photograph of a system, or nothing.
 *
 * The first id is the lead image by definition; a profile with no images keeps
 * its layout rather than showing a placeholder, which is why this returns
 * `undefined` instead of some empty stand-in.
 */
export function getLeadImage(system: System): SystemImage | undefined {
  const id = system.imageIds?.[0];
  if (id === undefined) {
    return undefined;
  }
  const asset = getImageById(id);
  if (asset === undefined) {
    return undefined;
  }

  const module = files[`${ASSET_DIRECTORY}/${asset.id}.${asset.canonical.format}`];
  if (module === undefined) {
    // Validation already refuses this, so reaching it means the build is
    // running against records and assets that came from different commits.
    throw new Error(
      `image "${asset.id}" has a record but no file under ${ASSET_DIRECTORY}. ` +
        'Run pnpm data:images.',
    );
  }

  return { asset, file: module.default };
}
