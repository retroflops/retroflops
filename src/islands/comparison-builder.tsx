// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The Compare builder.
 *
 * Assembles a comparison the build could not have enumerated, and keeps the
 * whole selection in the query string so the address bar is the shareable
 * artifact. It has no copy button or state hidden in memory.
 *
 * `client:only`, for the reason Explore's filters are: server-rendering this
 * would hand a reader without JavaScript a set of controls that do nothing. What
 * they get instead is the prepared comparisons, which are complete static pages.
 *
 * The options come from the server as props, so choosing records costs no
 * request. Only computing a comparison needs the catalog, because only that
 * needs the figures, and it is fetched once when the first comparison is asked
 * for.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';

import ComparisonView from '~/components/comparison-view';
import { followLocation } from '~/islands/follow-location';
import { fetchCatalog } from '~/lib/catalog-client';
import {
  fetchCatalogSummary,
  sharedComparabilityGroups,
  type CatalogSummary,
} from '~/lib/catalog-summary';
import {
  buildComparison,
  COMPARE_MAX_SUBJECTS,
  COMPARE_MIN_SUBJECTS,
  formatCompareQuery,
  parseCompareQuery,
  type CompareOption,
  type CompareSelectionEntry,
} from '~/lib/compare';
import type { Catalog } from '~/lib/data/schema';

interface Props {
  readonly options: readonly CompareOption[];
  /** Where the published catalog lives, base prefix already applied. */
  readonly catalogUrl: string;
  /** The light index, fetched first: it answers "is there anything to compare?". */
  readonly summaryUrl: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

function keyOf(entry: { kind: string; slug: string }): string {
  return `${entry.kind}:${entry.slug}`;
}

/**
 * A record with several variants and none chosen has no single figure for
 * anything it states per variant, so every multiplier against it is refused.
 */
function isAmbiguous(entry: CompareSelectionEntry, option: CompareOption | undefined): boolean {
  return option !== undefined && option.variants.length > 1 && entry.configurationId === undefined;
}

interface ChipProps {
  readonly entry: CompareSelectionEntry;
  readonly option: CompareOption | undefined;
  readonly index: number;
  readonly count: number;
  readonly onVariant: (configurationId: string) => void;
  readonly onMove: (delta: number) => void;
  readonly onBaseline: () => void;
  readonly onRemove: () => void;
}

function ChosenChip({
  entry,
  option,
  index,
  count,
  onVariant,
  onMove,
  onBaseline,
  onRemove,
}: ChipProps) {
  const name = option?.name ?? entry.slug;
  // Said here, where the remedy is: the refusals it causes are far below.
  const undecided = option !== undefined && option.variants.length > 1;
  return (
    <li class="builder__chip">
      <span class="builder__chip-name">
        {name}
        {index === 0 && <span class="builder__chip-role">baseline</span>}
      </span>

      {undecided && (
        <label
          class={`builder__variant${isAmbiguous(entry, option) ? ' builder__variant--any' : ''}`}
        >
          <span class="visually-hidden">Variant of {name}</span>
          <select
            value={entry.configurationId ?? ''}
            onChange={(event) => onVariant((event.target as HTMLSelectElement).value)}
          >
            <option value="">Choose a variant</option>
            {option.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/*
       * Both controls are always rendered and disabled at the ends,
       * rather than appearing and vanishing: a panel that changes
       * height under the pointer moves the next control out from
       * under it.
       */}
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>
        Earlier<span class="visually-hidden"> — move {name} toward the baseline</span>
      </button>
      <button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>
        Later<span class="visually-hidden"> — move {name} away from the baseline</span>
      </button>
      <button type="button" disabled={index === 0} onClick={onBaseline}>
        Make baseline<span class="visually-hidden"> — move {name} to the front</span>
      </button>
      <button type="button" onClick={onRemove}>
        Remove<span class="visually-hidden"> {name}</span>
      </button>
    </li>
  );
}

/** What the current selection means for the comparison, said before it is built. */
function SelectionNotes({
  entries,
  optionsByKey,
  summary,
}: {
  readonly entries: readonly CompareSelectionEntry[];
  readonly optionsByKey: ReadonlyMap<string, CompareOption>;
  readonly summary: CatalogSummary | undefined;
}) {
  const selectedKind = entries[0]?.kind;
  const sharedGroups = useMemo(
    () => (summary === undefined ? [] : sharedComparabilityGroups(summary, entries)),
    [summary, entries],
  );
  return (
    <>
      {entries.some((entry) => isAmbiguous(entry, optionsByKey.get(keyOf(entry)))) && (
        <p class="builder__note">
          One of these records ships in more than one variant and none is chosen, so figures that
          differ between variants have no single value here and no multiplier can be produced from
          them. Pick a variant above to settle it.
        </p>
      )}

      {entries.length >= COMPARE_MIN_SUBJECTS && summary !== undefined && (
        <output class="builder__shared">
          {sharedGroups.length === 0
            ? 'These records share no numeric comparability group. The comparison will show each record separately.'
            : `These records share ${sharedGroups.length} comparability group${
                sharedGroups.length === 1 ? '' : 's'
              }: quantities every one of them answers in the same way.`}
        </output>
      )}

      {entries.some((entry) => optionsByKey.get(keyOf(entry))?.availability === 'research') && (
        <p class="builder__note">
          This link includes a research record with no numeric measurement. It remains readable, but
          the record is not offered in new comparisons.
        </p>
      )}

      {selectedKind === 'system' && (
        <p class="builder__note">
          Components are unavailable while systems are chosen: a machine and one of its parts answer
          different questions, so a comparison holds one kind or the other.
        </p>
      )}
      {selectedKind === 'component' && (
        <p class="builder__note">
          Systems are unavailable while components are chosen. Most figures, including clocks,
          capacities, and power, are recorded against machines rather than parts. A comparison of
          two processors is often emptier than a comparison of the machines they went into.
        </p>
      )}
    </>
  );
}

function SearchBox({
  query,
  onQuery,
}: {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}) {
  return (
    <div class="builder__search">
      <label htmlFor="compare-record-search">Find a record</label>
      <div class="builder__search-control">
        <input
          id="compare-record-search"
          type="search"
          value={query}
          placeholder="Amiga, PlayStation, R10000…"
          onInput={(event) => onQuery((event.target as HTMLInputElement).value)}
        />
        {query !== '' && (
          <button
            type="button"
            class="builder__search-clear"
            aria-label="Clear search"
            onClick={() => onQuery('')}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Every record that may be chosen, narrowed by the search box. */
function OptionList({
  options,
  entries,
  query,
  onToggle,
}: {
  readonly options: readonly CompareOption[];
  readonly entries: readonly CompareSelectionEntry[];
  readonly query: string;
  readonly onToggle: (option: CompareOption) => void;
}) {
  const selectedKind = entries[0]?.kind;
  const full = entries.length >= COMPARE_MAX_SUBJECTS;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter(
      (option) =>
        (option.availability === 'catalog' ||
          entries.some((entry) => keyOf(entry) === keyOf(option))) &&
        (needle === '' || option.search.includes(needle)),
    );
  }, [entries, options, query]);

  return (
    <>
      <ul class="builder__options">
        {visible.map((option) => {
          const chosen = entries.some((entry) => keyOf(entry) === keyOf(option));
          const blocked =
            !chosen && (full || (selectedKind !== undefined && selectedKind !== option.kind));
          return (
            <li key={keyOf(option)}>
              <label class="builder__option">
                <input
                  type="checkbox"
                  checked={chosen}
                  disabled={blocked}
                  onChange={() => onToggle(option)}
                />
                <span class="builder__option-name">{option.name}</span>
                <span class="builder__option-context">{option.context}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p class="builder__note">No record matches “{query}”.</p>}
    </>
  );
}

/**
 * The summary is small and is wanted before the reader has finished choosing,
 * so it is fetched once on mount. A failure here is silent on purpose: the
 * hint it powers is worth having and not worth an error message.
 */
function useCatalogSummary(summaryUrl: string): CatalogSummary | undefined {
  const [summary, setSummary] = useState<CatalogSummary | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      try {
        setSummary(await fetchCatalogSummary(summaryUrl));
      } catch {
        setSummary(undefined);
      }
    })();
  }, [summaryUrl]);
  return summary;
}

/** The catalog, fetched as soon as `wanted` first holds, and never before. */
function useCatalogWhen(
  wanted: boolean,
  catalogUrl: string,
): { catalog: Catalog | undefined; load: LoadState; error: string | undefined } {
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!wanted || load !== 'idle') {
      return;
    }
    setLoad('loading');
    void (async () => {
      try {
        setCatalog(await fetchCatalog(catalogUrl));
        setLoad('ready');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoad('failed');
      }
    })();
  }, [wanted, load, catalogUrl]);
  return { catalog, load, error };
}

function LoadStatus({
  load,
  error,
}: {
  readonly load: LoadState;
  readonly error: string | undefined;
}) {
  if (load === 'loading') {
    return <p class="builder__status">Loading the catalog…</p>;
  }
  if (load === 'failed') {
    return (
      <p class="builder__status builder__status--error">
        {error ?? 'The catalog could not be loaded.'} The prepared comparisons below need no catalog
        download and work without scripts.
      </p>
    );
  }
  return null;
}

export default function ComparisonBuilder({ options, catalogUrl, summaryUrl }: Props) {
  const [entries, setEntries] = useState<readonly CompareSelectionEntry[]>([]);
  const [query, setQuery] = useState('');
  /**
   * What the last reordering did, announced politely.
   *
   * Moving a chip changes which column a record occupies, and the columns are
   * far enough down the page to be off screen, so the visible effect of the
   * control is somewhere the reader is not looking, whether or not they use a
   * screen reader.
   */
  const [announcement, setAnnouncement] = useState('');

  // Restore from the URL on load, and follow back and forward.
  useEffect(() => followLocation((search) => setEntries(parseCompareQuery(search))), []);

  const summary = useCatalogSummary(summaryUrl);
  // The catalog is wanted as soon as a comparison could exist, and never before.
  const { catalog, load, error } = useCatalogWhen(
    entries.length >= COMPARE_MIN_SUBJECTS,
    catalogUrl,
  );

  function commit(next: readonly CompareSelectionEntry[]): void {
    setEntries(next);
    // replaceState, not pushState: a click on each of four records would
    // otherwise leave four history entries between the reader and the way back.
    globalThis.history.replaceState(
      undefined,
      '',
      `${globalThis.location.pathname}${formatCompareQuery(next)}`,
    );
  }

  const selectedKind = entries[0]?.kind;
  const full = entries.length >= COMPARE_MAX_SUBJECTS;

  function toggle(option: CompareOption): void {
    const existing = entries.findIndex((entry) => keyOf(entry) === keyOf(option));
    if (existing !== -1) {
      commit(entries.filter((_, index) => index !== existing));
      return;
    }
    if (full || (selectedKind !== undefined && selectedKind !== option.kind)) {
      return;
    }
    commit([...entries, { kind: option.kind, slug: option.slug }]);
  }

  function removeAt(index: number): void {
    commit(entries.filter((_, position) => position !== index));
  }

  function chooseVariant(index: number, configurationId: string): void {
    commit(
      entries.map((entry, position) =>
        position === index
          ? { ...entry, configurationId: configurationId === '' ? undefined : configurationId }
          : entry,
      ),
    );
  }

  /**
   * Moves a record one place, which is what changes the column it occupies.
   *
   * Order is the only thing about a comparison the query string encodes and the
   * panel could not previously edit: until this existed, the second, third and
   * fourth columns could be rearranged only by removing everything and choosing
   * again. `formatCompareQuery` already encodes the order, so a shared URL
   * restores it without another parameter.
   */
  function moveBy(index: number, delta: number): void {
    const target = index + delta;
    const chosen = entries[index];
    const displaced = entries[target];
    if (chosen === undefined || displaced === undefined) {
      return;
    }
    const next = [...entries];
    next[index] = displaced;
    next[target] = chosen;
    commit(next);
    announce(chosen, target, next.length);
  }

  /** Moving a record to the front changes what every multiplier is measured against. */
  function makeBaseline(index: number): void {
    const chosen = entries[index];
    if (chosen === undefined) {
      return;
    }
    commit([chosen, ...entries.filter((_, position) => position !== index)]);
    announce(chosen, 0, entries.length);
  }

  function announce(entry: CompareSelectionEntry, position: number, total: number): void {
    const name = optionsByKey.get(keyOf(entry))?.name ?? entry.slug;
    const where = position === 0 ? ', now the baseline' : '';
    setAnnouncement(`${name} moved to position ${position + 1} of ${total}${where}.`);
  }

  const comparison = useMemo(
    () => (catalog === undefined ? undefined : buildComparison(catalog, entries)),
    [catalog, entries],
  );

  const optionsByKey = useMemo(
    () => new Map(options.map((option) => [keyOf(option), option])),
    [options],
  );

  return (
    <div class="builder stack-l">
      <div class="builder__panel stack">
        <div class="builder__header">
          <h2 class="builder__title">Build a comparison</h2>
          <output class="builder__count">
            {entries.length === 0
              ? `Choose ${COMPARE_MIN_SUBJECTS} to ${COMPARE_MAX_SUBJECTS} records`
              : `${entries.length} of ${COMPARE_MAX_SUBJECTS} chosen`}
          </output>
          {entries.length > 0 && (
            <button type="button" class="builder__clear" onClick={() => commit([])}>
              Start again
            </button>
          )}
        </div>

        {entries.length > 0 && (
          <ol class="builder__chosen">
            {entries.map((entry, index) => (
              <ChosenChip
                key={keyOf(entry)}
                entry={entry}
                option={optionsByKey.get(keyOf(entry))}
                index={index}
                count={entries.length}
                onVariant={(configurationId) => chooseVariant(index, configurationId)}
                onMove={(delta) => moveBy(index, delta)}
                onBaseline={() => makeBaseline(index)}
                onRemove={() => removeAt(index)}
              />
            ))}
          </ol>
        )}

        <output class="visually-hidden" aria-live="polite">
          {announcement}
        </output>

        <SelectionNotes entries={entries} optionsByKey={optionsByKey} summary={summary} />

        <SearchBox query={query} onQuery={setQuery} />

        <OptionList options={options} entries={entries} query={query} onToggle={toggle} />
      </div>

      <LoadStatus load={load} error={error} />
      {comparison !== undefined && <ComparisonView comparison={comparison} expandable />}
    </div>
  );
}
