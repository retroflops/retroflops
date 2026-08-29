// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:fetch`, the only step in the pipeline that touches the network.
 *
 * It downloads allowlisted source URLs into the ignored cache and records what
 * was retrieved: status, content type, byte length and SHA-256. It never writes
 * a figure, and it never rewrites an editorially approved source. When an
 * approved source changes upstream, that is reported for review; adopting it
 * silently would let a remote edit change a published number with no diff.
 *
 * Nothing else in the pipeline calls it, and `pnpm build` never does.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkAllowlist,
  checkRedirectTarget,
  decideFetchOutcome,
  MAX_REDIRECTS,
  resolveFetchScope,
  type AllowlistEntry,
  type FetchProvenance,
} from '../src/lib/data/fetch-policy.ts';
import {
  imageAssetSchema,
  sourceSchema,
  type ImageAsset,
  type Source,
} from '../src/lib/data/schema.ts';
import { sourceCitationUrl } from '../src/lib/data/source-url.ts';
import { DATA_DIRECTORIES, loadRecords, type LoadedRecord } from './lib/dataset.ts';
import {
  readJsonFile,
  readYamlDocument,
  repoPath,
  sha256,
  writeJsonFileIfChanged,
  writeYamlDocumentIfChanged,
} from './lib/io.ts';

interface AllowlistFile {
  readonly entries: readonly AllowlistEntry[];
}

async function loadAllowlist(): Promise<readonly AllowlistEntry[]> {
  const parsed = (await readJsonFile(repoPath('data/fetch-allowlist.json'))) as AllowlistFile;
  return parsed.entries;
}

/** Updates one record field while preserving the rest of the editor's YAML. */
async function setRecordField(file: string, field: string, value: unknown): Promise<void> {
  const { text, document } = await readYamlDocument(file);
  document.set(field, value);
  await writeYamlDocumentIfChanged(file, text, document);
}

interface FetchReport {
  readonly sourceId: string;
  readonly status: 'fetched' | 'unchanged' | 'refused' | 'needs-review' | 'throttled' | 'failed';
  readonly detail: string;
}

type Retrieval =
  | {
      readonly ok: true;
      readonly response: Response;
      readonly bytes: Uint8Array;
      readonly finalUrl: string;
    }
  /**
   * `throttled` is reported apart from `failed` because the two mean opposite
   * things to whoever reads the log. A failure says the document is not where
   * the record claims; a throttle says the record is fine and we asked too
   * often. Run the same command again later and it closes.
   */
  | { readonly ok: false; readonly detail: string; readonly throttled?: boolean };

/**
 * Who is asking. Several of the archives this pipeline reads, Wikimedia above
 * all, refuse an anonymous client outright, and they are entitled to: an
 * unidentified script hammering a donated file store is exactly what their
 * policy exists to stop. Naming the project turns a 429 into a conversation
 * somebody could have with us.
 *
 * `DATA_FETCH_CONTACT` appends an address to write to. It is left to the
 * operator rather than baked in, because a contact address is a personal
 * detail and this repository is public.
 */
const CONTACT = process.env['DATA_FETCH_CONTACT'];
const USER_AGENT =
  'RetroFlops-data-fetch/0.1 (static hardware catalog; one request at a time' +
  `${CONTACT === undefined || CONTACT === '' ? '' : `; ${CONTACT}`})`;

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits out a "too many requests" answer instead of recording it as a failure.
 *
 * A 429 is not a broken link and it is not a refusal: it is a server saying
 * "later", and a curation round that reports twenty broken links because it
 * asked too quickly has told the curator something false. The wait comes from
 * `Retry-After` where the server states one, and otherwise doubles.
 */
/**
 * Two waits, not ten. A brief throttle is absorbed here; a long one is not
 * something to sit through, because a file store that has blocked one file for
 * half an hour is not going to relent because this process is still holding the
 * line. Moving on and reporting `throttled` lets the rest of the round finish
 * and makes the fix the obvious one: run it again later, with `--if-missing`,
 * and only what is still missing is asked for.
 */
const THROTTLE_ATTEMPTS = 2;
const THROTTLE_MAX_WAIT_MS = 60_000;

function throttleWait(response: Response, attempt: number): number {
  const stated = Number(response.headers.get('retry-after') ?? '');
  return Math.min(
    THROTTLE_MAX_WAIT_MS,
    Number.isFinite(stated) && stated > 0 ? stated * 1000 : 15_000 * 2 ** attempt,
  );
}

/**
 * Requests a URL, following redirects one hop at a time.
 *
 * `redirect: 'follow'` would let an allowlisted host hand the request to any
 * origin at all, which is exactly the guarantee the allowlist exists to make.
 * Each hop is checked against the entry that authorized the original request,
 * so a target the entry never declared stops the fetch instead of being stored
 * as evidence.
 */
async function retrieve(url: string, entry: AllowlistEntry | undefined): Promise<Retrieval> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    let attempt = 0;
    for (;;) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        response = await fetch(current, {
          redirect: 'manual',
          headers: { 'User-Agent': USER_AGENT },
        });
      } catch (error) {
        return { ok: false, detail: `${current}: ${(error as Error).message}` };
      }
      if (response.status !== 429 || attempt >= THROTTLE_ATTEMPTS) break;
      const wait = throttleWait(response, attempt);
      console.log(`  waiting      ${Math.round(wait / 1000)}s: ${current} answered 429`);
      // oxlint-disable-next-line no-await-in-loop
      await sleep(wait);
      attempt += 1;
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location !== null) {
      const target = new URL(location, current).toString();
      const verdict = entry === undefined ? undefined : checkRedirectTarget(target, entry);
      if (verdict?.allowed !== true) {
        return {
          ok: false,
          detail:
            `${current} redirected to ${target}, which is refused: ${verdict?.reason ?? 'no allowlist entry'}. ` +
            'Add the host to the entry\'s "redirectHosts" in data/fetch-allowlist.json if it belongs there.',
        };
      }
      current = target;
      continue;
    }

    if (response.status === 429) {
      return {
        ok: false,
        throttled: true,
        detail: `${current}: still HTTP 429 after ${THROTTLE_ATTEMPTS} waits. Run this again later.`,
      };
    }

    if (!response.ok) {
      return { ok: false, detail: `${current}: HTTP ${response.status}` };
    }

    let bytes: Uint8Array;
    try {
      // oxlint-disable-next-line no-await-in-loop
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return { ok: false, detail: `${current}: ${(error as Error).message}` };
    }
    return { ok: true, response, bytes, finalUrl: current };
  }

  return { ok: false, detail: `${url}: more than ${MAX_REDIRECTS} redirects` };
}

/**
 * Whether the cache already holds exactly the bytes the record describes.
 *
 * `--if-missing` turns that into "then do not ask for them again". A curation
 * round needs the cache filled so the offline steps have something to read; it
 * does not need to re-download twenty megabytes from a donated file store to
 * re-learn what the record already states, and doing so on every run is what
 * earns a rate limit. Without the flag the request is still made, because
 * asking is how an upstream change is noticed at all, that check is the whole
 * reason this step exists, and it stays the default.
 */
async function cacheMatches(path: string, expected: string | undefined): Promise<boolean> {
  if (expected === undefined) {
    return false;
  }
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

async function fetchSource(
  source: Source,
  file: string,
  allowlist: readonly AllowlistEntry[],
  ifMissing: boolean,
): Promise<FetchReport> {
  const url = sourceCitationUrl(source);
  if (url === undefined) {
    return { sourceId: source.id, status: 'refused', detail: 'has no re-checkable URL to fetch' };
  }

  const decision = checkAllowlist(url, allowlist);
  if (!decision.allowed) {
    return {
      sourceId: source.id,
      status: 'refused',
      detail: `${url} refused: ${decision.reason}. Add the host to data/fetch-allowlist.json if it belongs there.`,
    };
  }

  if (
    ifMissing &&
    (await cacheMatches(join(DATA_DIRECTORIES.cache, source.id, 'content'), source.fetch?.sha256))
  ) {
    return { sourceId: source.id, status: 'unchanged', detail: 'already cached, not requested' };
  }

  const retrieval = await retrieve(url, decision.entry);
  if (!retrieval.ok) {
    return {
      sourceId: source.id,
      status: retrieval.throttled === true ? 'throttled' : 'failed',
      detail: retrieval.detail,
    };
  }
  const { response, bytes, finalUrl } = retrieval;

  const digest = sha256(bytes);
  const contentType = response.headers.get('content-type') ?? undefined;
  const next: FetchProvenance = {
    url,
    ...(finalUrl === url ? {} : { finalUrl }),
    // Truncated to whole seconds: sub-second precision is noise in a diff.
    fetchedAt: `${new Date().toISOString().slice(0, 19)}Z`,
    httpStatus: response.status,
    ...(contentType === undefined ? {} : { contentType }),
    byteLength: bytes.byteLength,
    sha256: digest,
  };

  // The artifact itself always lands in the ignored cache, whatever we decide
  // about the manifest, so a reviewer can diff the bytes locally.
  const cacheDirectory = join(DATA_DIRECTORIES.cache, source.id);
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(join(cacheDirectory, 'content'), bytes);
  await writeJsonFileIfChanged(join(cacheDirectory, 'meta.json'), next);

  const outcome = decideFetchOutcome(source.editorialStatus, source.fetch, next);
  if (outcome.action === 'report') {
    return {
      sourceId: source.id,
      status: 'needs-review',
      detail:
        `upstream content changed (${source.fetch?.sha256.slice(0, 12)} → ${digest.slice(0, 12)}). ` +
        'The manifest was left untouched because this source is approved; review the cached copy and update it deliberately.',
    };
  }

  if (outcome.reason === 'unchanged') {
    return { sourceId: source.id, status: 'unchanged', detail: `${url} (${digest.slice(0, 12)})` };
  }

  await setRecordField(file, 'fetch', next);
  return { sourceId: source.id, status: 'fetched', detail: `${url} (${digest.slice(0, 12)})` };
}

/**
 * Retrieves the original behind an image record.
 *
 * Photographs go through the same door as documents and for the same reason:
 * the bytes land in the ignored cache, the repository keeps only the derived
 * AVIF, and an approved record's original is frozen by hash, an upstream
 * re-upload is reported rather than adopted, because a photograph that changes
 * under a credit line is a different photograph.
 *
 * The record's own `original.sha256` is what freezes it; the pixels are decoded
 * later, by `data:images`, which is the step that has an image library.
 */
async function fetchImage(
  image: ImageAsset,
  file: string,
  allowlist: readonly AllowlistEntry[],
  ifMissing: boolean,
): Promise<FetchReport> {
  const decision = checkAllowlist(image.originalUrl, allowlist);
  if (!decision.allowed) {
    return {
      sourceId: image.id,
      status: 'refused',
      detail: `${image.originalUrl} refused: ${decision.reason}. Add the host to data/fetch-allowlist.json if it belongs there.`,
    };
  }

  if (
    ifMissing &&
    (await cacheMatches(
      join(DATA_DIRECTORIES.imageCache, image.id, 'original'),
      image.original.sha256,
    ))
  ) {
    return { sourceId: image.id, status: 'unchanged', detail: 'already cached, not requested' };
  }

  const retrieval = await retrieve(image.originalUrl, decision.entry);
  if (!retrieval.ok) {
    return {
      sourceId: image.id,
      status: retrieval.throttled === true ? 'throttled' : 'failed',
      detail: retrieval.detail,
    };
  }
  const { response, bytes } = retrieval;
  const digest = sha256(bytes);

  const cacheDirectory = join(DATA_DIRECTORIES.imageCache, image.id);
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(join(cacheDirectory, 'original'), bytes);
  await writeJsonFileIfChanged(join(cacheDirectory, 'meta.json'), {
    url: image.originalUrl,
    fetchedAt: `${new Date().toISOString().slice(0, 19)}Z`,
    httpStatus: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    byteLength: bytes.byteLength,
    sha256: digest,
  });

  if (digest === image.original.sha256) {
    return {
      sourceId: image.id,
      status: 'unchanged',
      detail: `${image.originalUrl} (${digest.slice(0, 12)})`,
    };
  }

  if (image.editorialStatus === 'approved') {
    return {
      sourceId: image.id,
      status: 'needs-review',
      detail:
        `upstream file changed (${image.original.sha256.slice(0, 12)} → ${digest.slice(0, 12)}). ` +
        'The record was left untouched because this image is approved; look at the cached copy ' +
        'and decide deliberately whether it is still the photograph the credit line describes.',
    };
  }

  await setRecordField(file, 'original', {
    ...image.original,
    sha256: digest,
    byteLength: bytes.byteLength,
    mediaType: (response.headers.get('content-type') ?? image.original.mediaType).split(';')[0],
  });
  return {
    sourceId: image.id,
    status: 'fetched',
    detail: `${image.originalUrl} (${digest.slice(0, 12)})`,
  };
}

async function main(): Promise<void> {
  const allowlist = await loadAllowlist();
  const requested = process.argv
    .flatMap((argument, index, arguments_) =>
      argument === '--only' ? [arguments_[index + 1] ?? ''] : [],
    )
    .filter((id) => id !== '');
  const requestedIds = new Set(requested);

  const wanted = (record: LoadedRecord): boolean => {
    if (requestedIds.size === 0) {
      return true;
    }
    const id = (record.value as { id?: unknown }).id;
    return typeof id === 'string' && requestedIds.has(id);
  };

  const ifMissing = process.argv.includes('--if-missing');
  const scope = resolveFetchScope(process.argv);
  const sources = scope.sources ? (await loadRecords('sources')).filter(wanted) : [];
  const images = scope.images ? (await loadRecords('images')).filter(wanted) : [];
  const records = [...sources, ...images];

  if (requestedIds.size > 0 && records.length !== requestedIds.size) {
    const found = new Set(
      records
        .map((record) => (record.value as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const missing = requested.filter((id) => !found.has(id));
    // A narrowed run is the likeliest explanation for an id that exists: say so
    // rather than let the flag turn a known source into an unknown one.
    const narrowing =
      scope.sources && scope.images
        ? ''
        : ` This run was limited to ${scope.images ? 'images' : 'sources'}.`;
    throw new Error(`Unknown source or image id(s): ${missing.join(', ')}.${narrowing}`);
  }

  const reports: FetchReport[] = [];
  for (const record of records) {
    const schema = record.kind === 'images' ? imageAssetSchema : sourceSchema;
    const parsed = schema.safeParse(record.value);
    if (!parsed.success) {
      reports.push({
        sourceId: String((record.value as { id?: unknown }).id ?? record.file),
        status: 'failed',
        detail: `does not match the ${record.kind === 'images' ? 'image' : 'source'} schema; run pnpm data:validate`,
      });
      continue;
    }
    // Sequential on purpose, and spaced: one request at a time is a politeness
    // constraint on other people's servers, not a throughput problem worth
    // solving. A curation round of twenty photographs is twenty megabytes off
    // somebody's donated file store, and a second of daylight between requests
    // costs this project nothing.
    if (reports.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
    reports.push(
      record.kind === 'images'
        ? // oxlint-disable-next-line no-await-in-loop
          await fetchImage(parsed.data as ImageAsset, record.file, allowlist, ifMissing)
        : // oxlint-disable-next-line no-await-in-loop
          await fetchSource(parsed.data as Source, record.file, allowlist, ifMissing),
    );
  }

  for (const report of reports) {
    console.log(`  ${report.status.padEnd(12)} ${report.sourceId}  ${report.detail}`);
  }

  const counts = new Map<FetchReport['status'], number>();
  for (const report of reports) {
    counts.set(report.status, (counts.get(report.status) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
  const scanned = [
    ...(scope.sources ? [`${sources.length} source(s)`] : []),
    ...(scope.images ? [`${images.length} image(s)`] : []),
  ].join(' and ');
  console.log(`data:fetch: ${scanned}${summary === '' ? '' : `, ${summary}`}`);

  // A throttle exits non-zero too: nothing was retrieved, and a curation round
  // that quietly reported success would leave the cache half-built.
  if (
    reports.some(
      (report) =>
        report.status === 'failed' ||
        report.status === 'needs-review' ||
        report.status === 'throttled',
    )
  ) {
    process.exitCode = 1;
  }
}

await main();
