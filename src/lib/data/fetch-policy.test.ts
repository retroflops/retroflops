// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  checkAllowlist,
  checkRedirectTarget,
  checkUrlShape,
  decideFetchOutcome,
  resolveFetchScope,
  type AllowlistEntry,
  type FetchProvenance,
} from './fetch-policy.ts';

const allowlist: readonly AllowlistEntry[] = [
  { host: 'ntrs.nasa.gov', pathPrefix: '/api/citations/', note: 'NASA technical reports' },
  { host: 'www.spec.org', note: 'Published SPEC results' },
];

describe('checkUrlShape', () => {
  it('accepts an address nobody has allowlisted', () => {
    // The point of the split: `data:links` asks whether a citation resolves, and
    // an address off the fetch allowlist is still an address a reader will open.
    const shape = checkUrlShape('https://archive.org/details/zxspectrum48kmanual');
    expect(shape).toEqual({ url: new URL('https://archive.org/details/zxspectrum48kmanual') });
  });

  it.each([
    ['not a url', 'malformed-url'],
    ['http://www.spec.org/results', 'not-https'],
    ['https://user:pw@www.spec.org/results', 'credentials-in-url'],
  ])('refuses %s', (target, refusal) => {
    expect(checkUrlShape(target)).toEqual({ refusal });
  });
});

describe('checkAllowlist', () => {
  it('allows an allowlisted host and path', () => {
    const decision = checkAllowlist(
      'https://ntrs.nasa.gov/api/citations/19760016247/downloads/19760016247.pdf',
      allowlist,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.entry?.host).toBe('ntrs.nasa.gov');
  });

  it('allows any path when the entry sets no prefix', () => {
    expect(checkAllowlist('https://www.spec.org/cpu2006/results/', allowlist).allowed).toBe(true);
  });

  it('refuses a host that is not on the list', () => {
    const decision = checkAllowlist('https://example.invalid/spec.pdf', allowlist);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('host-not-allowlisted');
  });

  it('does not treat a subdomain as covered by its parent', () => {
    expect(checkAllowlist('https://evil.ntrs.nasa.gov/api/citations/1', allowlist).reason).toBe(
      'host-not-allowlisted',
    );
  });

  it('refuses an allowlisted host outside its permitted path', () => {
    expect(checkAllowlist('https://ntrs.nasa.gov/search?q=apollo', allowlist).reason).toBe(
      'path-not-allowlisted',
    );
  });

  it('refuses plain HTTP', () => {
    expect(checkAllowlist('http://www.spec.org/results', allowlist).reason).toBe('not-https');
  });

  it('refuses a URL carrying credentials, which would be committed', () => {
    expect(checkAllowlist('https://user:pw@www.spec.org/results', allowlist).reason).toBe(
      'credentials-in-url',
    );
  });

  it('refuses a malformed URL', () => {
    expect(checkAllowlist('not a url', allowlist).reason).toBe('malformed-url');
  });
});

describe('checkRedirectTarget', () => {
  const archive: AllowlistEntry = {
    host: 'archive.org',
    pathPrefix: '/download/',
    redirectHosts: ['.archive.org'],
    note: 'Internet Archive item files',
  };
  const ntrs: AllowlistEntry = { host: 'ntrs.nasa.gov', note: 'NASA technical reports' };

  it('allows a redirect that stays on the same host', () => {
    expect(checkRedirectTarget('https://ntrs.nasa.gov/elsewhere', ntrs).allowed).toBe(true);
  });

  it('allows a declared subdomain, whatever path the storage node uses', () => {
    // The requested path is /download/…; the node answers from /0/items/….
    expect(
      checkRedirectTarget('https://dn760008.eu.archive.org/0/items/manual.txt', archive).allowed,
    ).toBe(true);
  });

  it('refuses a host the entry never declared', () => {
    const decision = checkRedirectTarget('https://cdn.example.invalid/manual.txt', archive);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('redirect-host-not-allowlisted');
  });

  it('refuses a redirect when the entry declares no targets at all', () => {
    expect(checkRedirectTarget('https://cdn.nasa.gov/file', ntrs).reason).toBe(
      'redirect-host-not-allowlisted',
    );
  });

  // The dot anchor is the whole point: a bare suffix match would accept this.
  it('refuses a lookalike domain ending in the permitted suffix', () => {
    expect(checkRedirectTarget('https://evil-archive.org/manual.txt', archive).reason).toBe(
      'redirect-host-not-allowlisted',
    );
  });

  it('refuses a suffix entry matching the bare domain with nothing in front', () => {
    const suffixOnly: AllowlistEntry = {
      host: 'example.org',
      redirectHosts: ['.example.org'],
      note: 'test',
    };
    expect(checkRedirectTarget('https://.example.org/file', suffixOnly).allowed).toBe(false);
  });

  it('refuses a redirect downgraded to plain HTTP', () => {
    expect(checkRedirectTarget('http://ia1.archive.org/manual.txt', archive).reason).toBe(
      'not-https',
    );
  });

  it('refuses a redirect carrying credentials', () => {
    expect(checkRedirectTarget('https://user:pw@ia1.archive.org/m.txt', archive).reason).toBe(
      'credentials-in-url',
    );
  });
});

function provenance(sha256: string): FetchProvenance {
  return {
    url: 'https://www.spec.org/results',
    fetchedAt: '2026-07-28T00:00:00Z',
    httpStatus: 200,
    byteLength: 1024,
    sha256,
  };
}

describe('decideFetchOutcome', () => {
  const a = provenance('a'.repeat(64));
  const b = provenance('b'.repeat(64));

  it('records the first fetch of a source', () => {
    expect(decideFetchOutcome('approved', undefined, a)).toEqual({
      action: 'record',
      reason: 'first-fetch',
    });
  });

  it('records an unchanged re-fetch', () => {
    expect(decideFetchOutcome('approved', a, a).action).toBe('record');
  });

  it('reports, rather than applies, an upstream change to an approved source', () => {
    expect(decideFetchOutcome('approved', a, b)).toEqual({
      action: 'report',
      reason: 'approved-content-changed',
    });
  });

  it('updates a provisional source in place', () => {
    expect(decideFetchOutcome('provisional', a, b)).toEqual({
      action: 'record',
      reason: 'draft-updated',
    });
  });
});

describe('resolveFetchScope', () => {
  it('touches both kinds when no scope is named', () => {
    expect(resolveFetchScope(['node', 'data-fetch.ts'])).toEqual({ sources: true, images: true });
  });

  it('limits a photograph round to images', () => {
    expect(resolveFetchScope(['node', 'data-fetch.ts', '--images'])).toEqual({
      sources: false,
      images: true,
    });
  });

  it('limits a document round to sources', () => {
    expect(resolveFetchScope(['node', 'data-fetch.ts', '--sources'])).toEqual({
      sources: true,
      images: false,
    });
  });

  it('reads both flags together as no narrowing at all', () => {
    // Rather than as an empty intersection, which would fetch nothing and say
    // nothing about why.
    expect(resolveFetchScope(['--sources', '--images'])).toEqual({ sources: true, images: true });
  });

  it('ignores a scope word that is not a flag', () => {
    expect(resolveFetchScope(['--only', 'images'])).toEqual({ sources: true, images: true });
  });
});
