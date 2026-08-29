// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:links`, are the documents still where the catalog says they are?
 *
 * Networked, and deliberately outside every other command: the build must never
 * reach the network, and a link that rots is not a reason for a build to fail
 * five minutes before a deployment. A scheduled workflow runs this and reports;
 * a person decides whether to find a new copy, promote the archive to the
 * primary URL, or record that the document has gone.
 *
 * It checks reachability only. Whether the bytes still say what they said is
 * `data:fetch`'s question, it hashes them and refuses to overwrite an approved
 * record, and answering it here would duplicate that with weaker evidence.
 *
 * Every re-checkable address a source names is checked, allowlisted or not. A
 * record can retain a known-unavailable original URL for provenance and name an
 * archive copy as its citation. The checker leaves that historical URL alone.
 * The allowlist governs what may be fetched and kept as evidence, which is a
 * question about trusting a publisher. This command asks whether a citation
 * still resolves. Nothing is stored: the request is a HEAD or a discarded GET
 * to an address already published beside the figure it supports.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { checkUrlShape } from '../src/lib/data/fetch-policy.ts';
import { sourceSchema, type Source } from '../src/lib/data/schema.ts';
import { loadRecords } from './lib/dataset.ts';

/** A source with neither of these cannot be re-checked by anybody, ever. */
type Role = 'url' | 'archiveUrl';

export type Verdict = 'ok' | 'redirected' | 'blocked' | 'unreachable' | 'refused' | 'absent';

export interface Result {
  readonly sourceId: string;
  readonly role: Role;
  readonly target: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

export function targetsForSource(
  source: Pick<Source, 'url' | 'urlStatus' | 'archiveUrl'>,
): readonly (readonly [Role, string | undefined])[] {
  return [
    ...(source.urlStatus === 'known-unavailable' ? [] : ([['url', source.url]] as const)),
    ['archiveUrl', source.archiveUrl],
  ];
}

const TIMEOUT_MS = 20_000;
const execFile = promisify(execFileCallback);

/**
 * Ask for the same document formats a browser would. The minimal compatibility
 * user agent avoids Node-specific filters without inventing a browser version
 * or platform. JavaScript challenges are reported as blocked instead of dead.
 */
const REQUEST_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,text/plain;q=0.7,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.8',
  'Cache-Control': 'no-cache',
  'User-Agent': 'Mozilla/5.0',
} as const;

interface Reachable {
  readonly status: number;
  readonly finalUrl: string;
  readonly headers: Headers;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as Error & { readonly cause?: unknown }).cause;
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
}

/**
 * curl uses the operating system's TLS setup, which can validate a few servers
 * whose incomplete certificate chain Node rejects. It remains a validating
 * client. The checker never turns off certificate checks.
 */
async function reachWithCurl(target: string): Promise<Reachable | Error> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const curlArguments = [
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        String(TIMEOUT_MS / 1000),
        '--output',
        '/dev/null',
        '--write-out',
        '\n%{http_code}\n%{url_effective}',
        '--user-agent',
        REQUEST_HEADERS['User-Agent'],
        '--header',
        `Accept: ${REQUEST_HEADERS.Accept}`,
        '--header',
        `Accept-Language: ${REQUEST_HEADERS['Accept-Language']}`,
        '--header',
        `Cache-Control: ${REQUEST_HEADERS['Cache-Control']}`,
      ];
      if (method === 'HEAD') {
        curlArguments.push('--head');
      } else {
        curlArguments.push('--range', '0-0');
      }
      curlArguments.push(target);

      // oxlint-disable-next-line no-await-in-loop
      const { stdout } = await execFile('curl', curlArguments, { timeout: TIMEOUT_MS + 5_000 });
      const lines = stdout.trimEnd().split('\n');
      const finalUrl = lines.pop() ?? target;
      const status = Number(lines.pop());
      if (!Number.isInteger(status) || status < 100) {
        return new Error(`curl returned an invalid HTTP status for ${target}`);
      }
      if (status < 400 || method === 'GET') {
        return { status, finalUrl, headers: new Headers() };
      }
    } catch (error) {
      if (method === 'GET') {
        return error as Error;
      }
    }
  }
  return new Error('no response');
}

/**
 * A HEAD first, because it costs the host almost nothing; a GET after, because
 * a fair number of archives and vendor pages answer HEAD with 403 or 405 and
 * serve the document perfectly well.
 */
export async function reach(target: string): Promise<Reachable | Error> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      // Sequential on purpose: the GET only happens because the HEAD was
      // refused, so there is nothing here to run in parallel.
      // oxlint-disable-next-line no-await-in-loop
      const response = await fetch(target, {
        headers: REQUEST_HEADERS,
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok || method === 'GET') {
        // The body is never read: this is a reachability check, and reading it
        // would download hundreds of megabytes of scanned manuals every month.
        // oxlint-disable-next-line no-await-in-loop
        await response.body?.cancel();
        return { status: response.status, finalUrl: response.url, headers: response.headers };
      }
    } catch (error) {
      if (method === 'GET') {
        // The fallback only runs after both Node requests fail.
        // oxlint-disable-next-line no-await-in-loop
        const fallback = await reachWithCurl(target);
        return fallback instanceof Error ? new Error(errorDetail(error)) : fallback;
      }
    }
  }
  return new Error('no response');
}

export async function checkTarget(sourceId: string, role: Role, target: string): Promise<Result> {
  // The only addresses left unchecked are the ones no request can be made to:
  // unparseable, unencrypted, or carrying credentials. A refusal here is a
  // defect in the record, not a gap in the report.
  const shape = checkUrlShape(target);
  if ('refusal' in shape) {
    return { sourceId, role, target, verdict: 'refused', detail: shape.refusal };
  }

  const outcome = await reach(target);
  if (outcome instanceof Error) {
    return { sourceId, role, target, verdict: 'unreachable', detail: outcome.message };
  }
  if (outcome.status === 403 || outcome.status === 429) {
    const challenge = outcome.headers.get('cf-mitigated') === 'challenge';
    return {
      sourceId,
      role,
      target,
      verdict: 'blocked',
      detail: challenge
        ? `HTTP ${outcome.status} (Cloudflare challenge; verify in a browser)`
        : `HTTP ${outcome.status} (automated request refused; verify in a browser)`,
    };
  }
  if (outcome.status >= 400) {
    return {
      sourceId,
      role,
      target,
      verdict: 'unreachable',
      detail: `HTTP ${outcome.status}`,
    };
  }
  if (outcome.finalUrl !== target) {
    return {
      sourceId,
      role,
      target,
      verdict: 'redirected',
      detail: `now served from ${outcome.finalUrl}`,
    };
  }
  return { sourceId, role, target, verdict: 'ok', detail: `HTTP ${outcome.status}` };
}

export function resultsForReport(
  results: readonly Result[],
  showSuccessful: boolean,
): readonly Result[] {
  return showSuccessful ? results : results.filter((result) => result.verdict !== 'ok');
}

function showProgress(index: number, total: number, sourceId: string, role: Role): void {
  if (process.stderr.isTTY !== true) {
    return;
  }
  process.stderr.write(`\r\u001B[2Kchecking ${index}/${total}: ${sourceId} [${role}]`);
}

function clearProgress(): void {
  if (process.stderr.isTTY === true) {
    process.stderr.write('\r\u001B[2K');
  }
}

async function main(): Promise<void> {
  const records = await loadRecords('sources');
  const requested = process.argv
    .flatMap((argument, index, arguments_) =>
      argument === '--only' ? [arguments_[index + 1] ?? ''] : [],
    )
    .filter((id) => id !== '');
  const requestedIds = new Set(requested);
  const allSources = records.map((record) => sourceSchema.parse(record.value));
  const sources =
    requestedIds.size === 0
      ? allSources
      : allSources.filter((source) => requestedIds.has(source.id));
  const showSuccessful = process.argv.includes('--all');

  if (requestedIds.size > 0 && sources.length !== requestedIds.size) {
    const found = new Set(sources.map((source) => source.id));
    const missing = requested.filter((id) => !found.has(id));
    throw new Error(`Unknown source id(s): ${missing.join(', ')}`);
  }

  const results: Result[] = [];
  const targetCount = sources.reduce(
    (count, source) =>
      count + targetsForSource(source).filter(([, target]) => target !== undefined).length,
    0,
  );
  let targetIndex = 0;
  for (const source of sources) {
    const targets = targetsForSource(source);
    const present = targets.filter(([, target]) => target !== undefined);
    if (present.length === 0) {
      results.push({
        sourceId: source.id,
        role: 'url',
        target: '—',
        verdict: 'absent',
        detail: 'no URL and no archive address: nobody can re-check this document',
      });
      continue;
    }
    for (const [role, target] of present) {
      // One request at a time, deliberately. These are other people's archives
      // and vendor servers, and thirty-eight parallel requests once a month is
      // the kind of politeness failure that ends in a block.
      showProgress(targetIndex + 1, targetCount, source.id, role);
      // oxlint-disable-next-line no-await-in-loop
      results.push(await checkTarget(source.id, role, target ?? ''));
      targetIndex += 1;
    }
  }
  clearProgress();

  const report = resultsForReport(results, showSuccessful);
  const order: readonly Verdict[] = [
    'unreachable',
    'absent',
    'refused',
    'blocked',
    'redirected',
    'ok',
  ];
  for (const verdict of order) {
    const group = report.filter((result) => result.verdict === verdict);
    if (group.length === 0) {
      continue;
    }
    console.log(`\n${verdict} (${group.length})`);
    for (const result of group) {
      console.log(`  ${result.sourceId} [${result.role}] ${result.target}\n      ${result.detail}`);
    }
  }

  // `refused` now means the address itself is malformed, which is a defect in
  // the record rather than a policy decision, so it counts as much as a 404.
  const broken = results.filter(
    (result) =>
      result.verdict !== 'ok' && result.verdict !== 'redirected' && result.verdict !== 'blocked',
  );
  const blocked = results.filter((result) => result.verdict === 'blocked');
  const redirected = results.filter((result) => result.verdict === 'redirected');
  console.log(
    `\ndata:links: ${results.length} address(es) checked across ${sources.length} source(s), ${broken.length} broken, ${blocked.length} blocked, ${redirected.length} redirected`,
  );
  if (broken.length > 0) {
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
