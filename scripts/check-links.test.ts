// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkTarget,
  reach,
  resultsForReport,
  targetsForSource,
  type Result,
} from './check-links.ts';

const cloudflareChallenge = async (): Promise<Response> =>
  new Response(null, {
    status: 403,
    headers: { 'cf-mitigated': 'challenge' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('data:links requests', () => {
  it('retries a refused HEAD with GET and identifies the checker', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await reach('https://example.com/document');

    expect(outcome).not.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['HEAD', 'GET']);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('user-agent')).toBe('Mozilla/5.0');
    expect(headers.get('accept-language')).toBe('en-US,en;q=0.8');
  });

  it('reports a Cloudflare challenge as blocked rather than unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(cloudflareChallenge));

    const result = await checkTarget('benchmark-result', 'url', 'https://example.com/result');

    expect(result.verdict).toBe('blocked');
    expect(result.detail).toContain('Cloudflare challenge');
  });
});

describe('data:links report', () => {
  it('checks the archive copy instead of a known-unavailable original URL', () => {
    expect(
      targetsForSource({
        url: 'https://publisher.example/article',
        urlStatus: 'known-unavailable',
        archiveUrl: 'https://archive.example/article',
      }),
    ).toEqual([['archiveUrl', 'https://archive.example/article']]);
  });

  it('hides successful checks unless --all is requested', () => {
    const results: readonly Result[] = [
      {
        sourceId: 'working',
        role: 'url',
        target: 'https://example.com/working',
        verdict: 'ok',
        detail: 'HTTP 200',
      },
      {
        sourceId: 'missing',
        role: 'url',
        target: 'https://example.com/missing',
        verdict: 'unreachable',
        detail: 'HTTP 404',
      },
    ];

    expect(resultsForReport(results, false)).toEqual([results[1]]);
    expect(resultsForReport(results, true)).toEqual(results);
  });
});
