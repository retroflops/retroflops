// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_HEIGHT,
  CANONICAL_WIDTH,
  checkTransformRecipe,
  hasCanonicalAspect,
  padCanvas,
  type TransformRecipe,
} from './image-preset.ts';

function recipe(overrides: Partial<TransformRecipe> = {}): TransformRecipe {
  return {
    preset: 'image-v1',
    sourceWidth: 4608,
    sourceHeight: 3456,
    fit: 'exact',
    ...overrides,
  };
}

describe('canonical aspect', () => {
  it('is exact arithmetic, not a tolerance', () => {
    expect(hasCanonicalAspect(4608, 3456)).toBe(true);
    expect(hasCanonicalAspect(CANONICAL_WIDTH, CANONICAL_HEIGHT)).toBe(true);
    // One pixel out is out: 4:3 is a ratio a curator can always reach exactly by
    // choosing the rectangle, so there is nothing to be lenient about.
    expect(hasCanonicalAspect(7762, 5822)).toBe(false);
  });
});

describe('exact fit', () => {
  it('accepts an original that is already 4:3 and larger than the canonical size', () => {
    expect(checkTransformRecipe(recipe())).toEqual([]);
  });

  it('refuses an original of another shape rather than stretching it', () => {
    expect(checkTransformRecipe(recipe({ sourceWidth: 2400, sourceHeight: 1607 }))).toContain(
      'transform-source-not-4-3',
    );
  });

  it('refuses to enlarge a small original', () => {
    expect(checkTransformRecipe(recipe({ sourceWidth: 800, sourceHeight: 600 }))).toContain(
      'transform-upscales',
    );
  });

  it('refuses a crop rectangle it is not going to use', () => {
    const reasons = checkTransformRecipe(
      recipe({ region: { x: 0, y: 0, width: 4608, height: 3456 } }),
    );
    expect(reasons).toContain('transform-region-without-crop');
  });
});

describe('crop fit', () => {
  const cropped = (region: TransformRecipe['region']): readonly string[] =>
    checkTransformRecipe(
      recipe({ sourceWidth: 4018, sourceHeight: 2678, fit: 'crop', ...(region && { region }) }),
    );

  it('accepts a 4:3 rectangle inside the original', () => {
    expect(cropped({ x: 225, y: 1, width: 3568, height: 2676 })).toEqual([]);
  });

  it('refuses a rectangle that is not 4:3', () => {
    expect(cropped({ x: 0, y: 0, width: 4018, height: 2678 })).toContain(
      'transform-region-not-4-3',
    );
  });

  it('refuses a rectangle that runs off the original', () => {
    expect(cropped({ x: 900, y: 1, width: 3568, height: 2676 })).toContain(
      'transform-region-outside-source',
    );
  });

  it('refuses a rectangle smaller than the canonical size', () => {
    expect(cropped({ x: 0, y: 0, width: 800, height: 600 })).toContain('transform-upscales');
  });

  it('refuses a crop with no rectangle at all', () => {
    expect(cropped(undefined)).toContain('transform-crop-without-region');
  });
});

describe('pad fit', () => {
  const padded = (overrides: Partial<TransformRecipe> = {}): readonly string[] =>
    checkTransformRecipe(
      recipe({
        sourceWidth: 2400,
        sourceHeight: 1607,
        fit: 'pad',
        background: '#000000',
        ...overrides,
      }),
    );

  it('accepts a declared margin on an original of another shape', () => {
    expect(padded()).toEqual([]);
  });

  it('requires the margin color to be written down', () => {
    expect(padded({ background: undefined })).toContain('transform-pad-without-background');
  });

  it('requires the color to be an unambiguous hex triplet', () => {
    expect(padded({ background: 'black' })).toContain('transform-background-not-hex');
  });

  it('refuses to enlarge, counting the margin the reduction would sit in', () => {
    expect(padded({ sourceWidth: 1000, sourceHeight: 670 })).toContain('transform-upscales');
  });
});

describe('pad canvas', () => {
  it('is the smallest 4:3 rectangle that contains the original, centered', () => {
    expect(padCanvas(2400, 1607)).toEqual({ x: 0, y: 97, width: 2400, height: 1800 });
  });

  it('grows sideways for an original that is taller than 4:3', () => {
    const canvas = padCanvas(1200, 1600);
    expect(canvas.width).toBe(2136);
    expect(canvas.height).toBe(1602);
    expect(canvas.x).toBe(468);
  });
});

describe('unknown presets', () => {
  it('are refused, so a recipe cannot outlive the version that produced it', () => {
    expect(checkTransformRecipe(recipe({ preset: 'image-v2' }))).toContain(
      'transform-unknown-preset',
    );
  });
});
