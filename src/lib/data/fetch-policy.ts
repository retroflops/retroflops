// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Rules governing the only networked step in the pipeline.
 *
 * `data:fetch` exists to keep provenance honest, not to author data. Two rules
 * make that safe, and both are pure functions so they can be tested without a
 * network:
 *
 * 1. Only allowlisted URLs are requested. A source that wants a new host needs a
 *    reviewed change to the allowlist, not just a new manifest.
 * 2. An editorially approved source is never rewritten. If upstream content
 *    changed, that is reported for a human to review. Silently adopting it
 *    would let a remote edit change a published figure with no diff.
 */

export interface AllowlistEntry {
  /** Exact host, e.g. `ntrs.nasa.gov`. Subdomains are not implied. */
  readonly host: string;
  /** Optional path prefix restricting the entry further. */
  readonly pathPrefix?: string;
  /**
   * Hosts a redirect from this entry may land on, declared per entry because a
   * redirect target is part of what a reviewer is approving.
   *
   * An entry beginning with a dot matches any host under that domain, anchored
   * at the dot so `.archive.org` cannot be satisfied by `evil-archive.org`.
   * Paths are not restricted on a redirect hop: content-delivery nodes use
   * opaque paths that have nothing to do with the requested one.
   */
  readonly redirectHosts?: readonly string[];
  /** Why this host is trusted; shown when a fetch is refused elsewhere. */
  readonly note: string;
}

export type FetchRefusal =
  | 'not-https'
  | 'host-not-allowlisted'
  | 'path-not-allowlisted'
  | 'malformed-url'
  | 'credentials-in-url'
  | 'redirect-host-not-allowlisted'
  | 'too-many-redirects';

/** Redirect hops followed before giving up. Enough for a CDN handoff, not a loop. */
export const MAX_REDIRECTS = 5;

export interface AllowlistDecision {
  readonly allowed: boolean;
  readonly reason?: FetchRefusal;
  readonly entry?: AllowlistEntry;
}

/** Refusals that are about the address itself rather than about who is trusted. */
export type UrlRefusal = Extract<
  FetchRefusal,
  'malformed-url' | 'not-https' | 'credentials-in-url'
>;

export type UrlShape = { readonly url: URL } | { readonly refusal: UrlRefusal };

/**
 * Whether an address is one this project will send a request to at all.
 *
 * Separate from the allowlist because the two answer different questions. This
 * one is about the address: parseable, encrypted, and carrying no credentials
 * that would end up committed in a manifest. It applies to every request the
 * repository makes. The allowlist is about trust in a publisher, and applies
 * only where bytes are kept as evidence.
 */
export function checkUrlShape(url: string): UrlShape {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { refusal: 'malformed-url' };
  }
  if (parsed.protocol !== 'https:') {
    return { refusal: 'not-https' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { refusal: 'credentials-in-url' };
  }
  return { url: parsed };
}

/** Whether a URL may be fetched and its bytes kept as evidence. */
export function checkAllowlist(
  url: string,
  allowlist: readonly AllowlistEntry[],
): AllowlistDecision {
  const shape = checkUrlShape(url);
  if ('refusal' in shape) {
    return { allowed: false, reason: shape.refusal };
  }
  const parsed = shape.url;

  const hostMatches = allowlist.filter((entry) => entry.host === parsed.host);
  if (hostMatches.length === 0) {
    return { allowed: false, reason: 'host-not-allowlisted' };
  }

  const entry = hostMatches.find(
    (candidate) =>
      candidate.pathPrefix === undefined || parsed.pathname.startsWith(candidate.pathPrefix),
  );
  if (entry === undefined) {
    return { allowed: false, reason: 'path-not-allowlisted' };
  }

  return { allowed: true, entry };
}

/**
 * Whether a redirect from `entry` may be followed to `url`.
 *
 * Checking the allowlist before the request and then following redirects
 * wherever they lead would make the allowlist decorative: an allowlisted host
 * could hand the fetch to any origin it liked, and the bytes would be filed as
 * evidence for a cited figure. Every hop is therefore checked, and a target the
 * entry did not declare is refused rather than followed.
 */
export function checkRedirectTarget(url: string, entry: AllowlistEntry): AllowlistDecision {
  const shape = checkUrlShape(url);
  if ('refusal' in shape) {
    return { allowed: false, reason: shape.refusal };
  }
  const parsed = shape.url;

  // Staying on the same host is always fine; that is not a change of origin.
  if (parsed.host === entry.host) {
    return { allowed: true, entry };
  }

  const permitted = (entry.redirectHosts ?? []).some((candidate) =>
    candidate.startsWith('.')
      ? parsed.host.endsWith(candidate) && parsed.host.length > candidate.length
      : parsed.host === candidate,
  );

  return permitted
    ? { allowed: true, entry }
    : { allowed: false, reason: 'redirect-host-not-allowlisted' };
}

/** Which kinds of record a fetch run may touch. */
export interface FetchScope {
  readonly sources: boolean;
  readonly images: boolean;
}

/**
 * Reads the scope flags of one invocation.
 *
 * Documents and photographs share this step because they share the allowlist,
 * not because they are ever curated together. A round of pictures that re-reads
 * a hundred and twenty documents asks other people's servers a hundred and
 * twenty questions nobody wanted answered, and buries the four lines that
 * matter; a round of documents that re-downloads every original does the same
 * with megabytes. Either flag narrows the run to one kind.
 *
 * Naming neither still means both, and so does naming both: a bare `data:fetch`
 * keeps doing what it always did, and the flags add a narrower run rather than
 * changing the default under anyone who relies on it.
 */
export function resolveFetchScope(argv: readonly string[]): FetchScope {
  const sources = argv.includes('--sources');
  const images = argv.includes('--images');
  return sources === images ? { sources: true, images: true } : { sources, images };
}

/** Provenance of one fetch, recorded on the source manifest. */
export interface FetchProvenance {
  readonly url: string;
  /**
   * Where the bytes came from, recorded only when a redirect moved the
   * request off the requested URL. A reviewer should be able to see that from
   * the manifest rather than by re-running the fetch.
   */
  readonly finalUrl?: string | undefined;
  readonly fetchedAt: string;
  readonly httpStatus: number;
  readonly contentType?: string | undefined;
  readonly byteLength: number;
  /** SHA-256 of the fetched bytes. */
  readonly sha256: string;
}

export type FetchOutcome =
  | { readonly action: 'record'; readonly reason: 'first-fetch' | 'unchanged' | 'draft-updated' }
  | { readonly action: 'report'; readonly reason: 'approved-content-changed' };

/**
 * Decides what a fetch result may do to a source manifest.
 *
 * An approved source whose bytes changed upstream is reported and left alone.
 * That is the difference between a pipeline that records evidence and one that
 * lets a remote site silently edit published figures.
 */
export function decideFetchOutcome(
  editorialStatus: 'approved' | 'provisional',
  previous: FetchProvenance | undefined,
  next: FetchProvenance,
): FetchOutcome {
  if (previous === undefined) {
    return { action: 'record', reason: 'first-fetch' };
  }
  if (previous.sha256 === next.sha256) {
    return { action: 'record', reason: 'unchanged' };
  }
  if (editorialStatus === 'approved') {
    return { action: 'report', reason: 'approved-content-changed' };
  }
  return { action: 'record', reason: 'draft-updated' };
}
