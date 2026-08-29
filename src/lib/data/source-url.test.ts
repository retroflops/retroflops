// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { sourceCitationUrl } from './source-url.ts';

describe('sourceCitationUrl', () => {
  it('prefers a preserved copy when the original is known unavailable', () => {
    expect(
      sourceCitationUrl({
        url: 'https://publisher.example/article',
        urlStatus: 'known-unavailable',
        archiveUrl: 'https://archive.example/article',
      }),
    ).toBe('https://archive.example/article');
  });

  it('keeps a live original as the citation when an archive is also present', () => {
    expect(
      sourceCitationUrl({
        url: 'https://publisher.example/article',
        archiveUrl: 'https://archive.example/article',
      }),
    ).toBe('https://publisher.example/article');
  });
});
