// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findCatalogNameMatches } from './catalog-search.ts';
import type { CatalogSummary } from './catalog-summary.ts';

const summary = JSON.parse(
  readFileSync('public/data/catalog-summary-v1.json', 'utf8'),
) as CatalogSummary;

describe('catalog name search', () => {
  it('finds a graphics card from its manufacturer', () => {
    expect(findCatalogNameMatches(summary, '3dfx')).toContainEqual(
      expect.objectContaining({ kind: 'system', slug: '3dfx-voodoo-graphics' }),
    );
  });

  it('accepts a one-character misspelling in a card name', () => {
    expect(findCatalogNameMatches(summary, 'vodoo')).toContainEqual(
      expect.objectContaining({ kind: 'system', slug: '3dfx-voodoo-graphics' }),
    );
  });
});
