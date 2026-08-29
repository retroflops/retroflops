// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `image-v1`, the one shape a published photograph may take.
 *
 * The repository stores exactly one file per image, at one size, in one format,
 * so that a reviewer diffing a data change sees a hash change rather than a
 * re-encode, and so that a photograph can never quietly arrive at ten megabytes.
 * Everything a page serves is generated from that file at build time.
 *
 * Two rules do the real work and both are about honesty rather than bytes:
 *
 * - **No deformation.** The canonical file is 4:3, and the way an original of
 *   another shape reaches 4:3 is written down, as a named crop rectangle or a
 *   named margin, never a stretch. A squashed console is a photograph of a
 *   console that does not exist.
 * - **No upscaling.** Whatever region survives the recipe must already be at
 *   least 1280×960, so the stored file is always a reduction of something real.
 *
 * Pure arithmetic, no IO: the normalization script uses it to plan a transform
 * and `data:validate` uses it to check that the plan was legitimate, which is
 * how the two can never disagree.
 */

export const IMAGE_PRESET_ID = 'image-v1';

export const CANONICAL_WIDTH = 1280;
export const CANONICAL_HEIGHT = 960;
export const CANONICAL_FORMAT = 'avif';
export const CANONICAL_QUALITY = 60;
export const CANONICAL_MAX_BYTES = 250 * 1024;

/** Widths the build generates from the canonical file. Never above it: no upscaling. */
export const RESPONSIVE_WIDTHS = [480, 800, CANONICAL_WIDTH] as const;

/** How an original of a different shape is brought to 4:3. */
export const IMAGE_FIT_MODES = ['exact', 'crop', 'pad'] as const;

export type ImageFitMode = (typeof IMAGE_FIT_MODES)[number];

export interface PixelRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TransformRecipe {
  readonly preset: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly fit: ImageFitMode;
  readonly region?: PixelRegion | undefined;
  readonly background?: string | undefined;
}

export function hasCanonicalAspect(width: number, height: number): boolean {
  return width * CANONICAL_HEIGHT === height * CANONICAL_WIDTH;
}

/**
 * The canvas a `pad` recipe composes onto: the smallest 4:3 rectangle that
 * contains the original without moving it, with the original centered on it.
 *
 * Rounded up to a multiple of four so the height is a whole number of pixels.
 * an image size is not a place for a rounding rule nobody wrote down.
 */
export function padCanvas(sourceWidth: number, sourceHeight: number): PixelRegion {
  const fromWidth = Math.ceil(sourceWidth / 4) * 4;
  const fromHeight = Math.ceil((sourceHeight * CANONICAL_WIDTH) / CANONICAL_HEIGHT / 4) * 4;
  const width = Math.max(fromWidth, fromHeight);
  const height = (width * CANONICAL_HEIGHT) / CANONICAL_WIDTH;
  return {
    x: Math.round((width - sourceWidth) / 2),
    y: Math.round((height - sourceHeight) / 2),
    width,
    height,
  };
}

/** A color a margin may be filled with. Written in full so the record is unambiguous. */
const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Why a recipe is not admissible, as stable codes. Empty means the recipe
 * produces a 1280×960 4:3 file out of pixels that were really there.
 */
export function checkTransformRecipe(recipe: TransformRecipe): readonly string[] {
  const reasons: string[] = [];

  if (recipe.preset !== IMAGE_PRESET_ID) {
    reasons.push('transform-unknown-preset');
  }

  const { sourceWidth, sourceHeight, fit, region, background } = recipe;

  if (fit !== 'crop' && region !== undefined) {
    reasons.push('transform-region-without-crop');
  }
  if (fit !== 'pad' && background !== undefined) {
    reasons.push('transform-background-without-pad');
  }

  switch (fit) {
    case 'exact': {
      if (!hasCanonicalAspect(sourceWidth, sourceHeight)) {
        reasons.push('transform-source-not-4-3');
      }
      if (sourceWidth < CANONICAL_WIDTH || sourceHeight < CANONICAL_HEIGHT) {
        reasons.push('transform-upscales');
      }
      break;
    }
    case 'crop': {
      if (region === undefined) {
        reasons.push('transform-crop-without-region');
        break;
      }
      if (
        region.x < 0 ||
        region.y < 0 ||
        region.x + region.width > sourceWidth ||
        region.y + region.height > sourceHeight
      ) {
        reasons.push('transform-region-outside-source');
      }
      if (!hasCanonicalAspect(region.width, region.height)) {
        reasons.push('transform-region-not-4-3');
      }
      if (region.width < CANONICAL_WIDTH || region.height < CANONICAL_HEIGHT) {
        reasons.push('transform-upscales');
      }
      break;
    }
    case 'pad': {
      if (background === undefined) {
        reasons.push('transform-pad-without-background');
      } else if (!HEX_COLOR.test(background)) {
        reasons.push('transform-background-not-hex');
      }
      const canvas = padCanvas(sourceWidth, sourceHeight);
      if (canvas.width < CANONICAL_WIDTH || canvas.height < CANONICAL_HEIGHT) {
        reasons.push('transform-upscales');
      }
      break;
    }
    default: {
      reasons.push('transform-unknown-fit');
    }
  }

  return reasons;
}
