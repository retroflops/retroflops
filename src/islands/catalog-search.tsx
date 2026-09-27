// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Full-text search over the built site.
 *
 * Pagefind indexes `dist` after the production build, so the index does not
 * exist during development or in any environment where the post-build step did
 * not run. That is a normal state rather than an error, and the component says
 * so instead of failing.
 *
 * Search is an aid, not the content: every record is reachable from Explore
 * without JavaScript, and the `<noscript>` fallback beside this island says so.
 */

import { useEffect, useId, useRef, useState } from 'preact/hooks';

import { findCatalogNameMatches } from '~/lib/catalog-search';
import { fetchCatalogSummary } from '~/lib/catalog-summary';

interface PagefindResultData {
  readonly url: string;
  readonly meta?: { readonly title?: string };
  readonly excerpt: string;
}

interface PagefindResult {
  readonly id: string;
  data: () => Promise<PagefindResultData>;
}

interface PagefindApi {
  search: (query: string) => Promise<{ results: readonly PagefindResult[] }>;
  init?: () => Promise<void>;
}

type Status = 'idle' | 'loading' | 'ready' | 'catalog' | 'unavailable';

interface Hit {
  readonly url: string;
  readonly title: string;
  readonly excerpt: string;
}

/** Results beyond this are noise; the query wants narrowing instead. */
const MAX_RESULTS = 12;
const DEBOUNCE_MS = 180;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function catalogHits(query: string, base: string): Promise<readonly Hit[]> {
  const summary = await fetchCatalogSummary(`${base}data/catalog-summary-v1.json`);
  return findCatalogNameMatches(summary, query)
    .filter((match) => {
      const records = match.kind === 'system' ? summary.systems : summary.components;
      return records.find((record) => record.slug === match.slug)?.availability === 'catalog';
    })
    .slice(0, MAX_RESULTS)
    .map((match) => ({
      url:
        match.kind === 'system'
          ? `${base}systems/${match.slug}/`
          : `${base}components/${match.componentKind}/${match.slug}/`,
      title: match.name,
      excerpt: `${escapeHtml(match.manufacturer)} · catalog ${match.kind}`,
    }));
}

async function importPagefind(base: string): Promise<PagefindApi | undefined> {
  try {
    // The specifier is built at runtime so the bundler does not try to
    // resolve an index that only exists once the site has been built.
    const module = (await import(/* @vite-ignore */ `${base}pagefind/pagefind.js`)) as PagefindApi;
    await module.init?.();
    return module;
  } catch {
    return undefined;
  }
}

async function pagefindHits(api: PagefindApi | undefined, query: string): Promise<readonly Hit[]> {
  if (api === undefined) {
    return [];
  }
  try {
    const search = await api.search(query);
    const data = await Promise.all(
      search.results.slice(0, MAX_RESULTS).map((result) => result.data()),
    );
    return data.map((entry) => ({
      url: entry.url,
      title: entry.meta?.title ?? entry.url,
      excerpt: entry.excerpt,
    }));
  } catch {
    // The small catalog is still useful if Pagefind has an incomplete index.
    return [];
  }
}

/** Pagefind's hits for a query, or the catalog's name matches when it has none. */
async function searchHits(
  api: PagefindApi | undefined,
  query: string,
  base: string,
): Promise<readonly Hit[]> {
  const hits = await pagefindHits(api, query);
  if (hits.length > 0) {
    return hits;
  }
  try {
    return await catalogHits(query, base);
  } catch {
    // The user-facing state explains the rare case where both fail.
    return [];
  }
}

/** Debounced search that loads the Pagefind index the first time it is needed. */
function useSearch(query: string, base: string): { status: Status; hits: readonly Hit[] } {
  const [status, setStatus] = useState<Status>('idle');
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const apiRef = useRef<PagefindApi | undefined>(undefined);

  useEffect(() => {
    async function loadApi(): Promise<PagefindApi | undefined> {
      if (apiRef.current !== undefined) {
        return apiRef.current;
      }
      setStatus('loading');
      const module = await importPagefind(base);
      if (module !== undefined) {
        apiRef.current = module;
        setStatus('ready');
      }
      return module;
    }

    if (query.trim().length < 2) {
      setHits([]);
      return undefined;
    }

    let canceled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const api = await loadApi();
        if (canceled) {
          return;
        }
        const nextHits = await searchHits(api, query, base);
        if (!canceled) {
          setHits(nextHits);
          // A search that ran and matched nothing is a working search, so the
          // absence of hits says nothing about the index. Only a missing index
          // with no catalog names to fall back on leaves search unavailable.
          setStatus(
            api === undefined ? (nextHits.length > 0 ? 'catalog' : 'unavailable') : 'ready',
          );
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [query, base]);

  return { status, hits };
}

function statusMessage(status: Status, query: string, hits: readonly Hit[]): string {
  switch (status) {
    case 'catalog':
      return 'Showing catalog name matches while the full-text index is unavailable.';
    case 'unavailable':
      return 'Search is temporarily unavailable. Every record is listed on Explore.';
    case 'loading':
      return 'Loading the search index…';
    case 'ready':
      return query.trim().length >= 2 && hits.length === 0 ? `Nothing matches “${query}”.` : '';
    default:
      return '';
  }
}

export default function CatalogSearch({ base = '/' }: { base?: string }) {
  const [query, setQuery] = useState('');
  const { status, hits } = useSearch(query, base);
  const inputId = useId();
  const statusId = useId();
  const message = statusMessage(status, query, hits);

  return (
    <div class="search">
      <label class="search__label" htmlFor={inputId}>
        Search systems, components, sources and methodology
      </label>
      <input
        id={inputId}
        class="search__input"
        type="search"
        autocomplete="off"
        placeholder="Emotion Engine, 68000, FLOPS, Rambus…"
        value={query}
        aria-describedby={statusId}
        onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
      />

      <output id={statusId} class="search__status">
        {message}
      </output>

      {hits.length > 0 && (
        <ul class="search__results">
          {hits.map((hit) => (
            <li key={hit.url}>
              <a href={hit.url}>{hit.title}</a>
              {/*
                Pagefind wraps matched terms in <mark>, which is the whole point of
                the excerpt. The markup comes from an index built from this site's
                own pages during the build, not from user input.
              */}
              <span class="search__excerpt" dangerouslySetInnerHTML={{ __html: hit.excerpt }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
