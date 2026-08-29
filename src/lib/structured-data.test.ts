// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { website } from './structured-data.ts';

describe('website structured data', () => {
  it('identifies the site at its canonical home URL', () => {
    expect(website((path) => `https://example.test${path}`)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'RetroFlops',
      url: 'https://example.test/',
    });
  });
});
