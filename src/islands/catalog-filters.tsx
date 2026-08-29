// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Explore's filter panel.
 *
 * A progressive enhancement over a list that is already complete in the
 * markup: this component owns the controls, and filtering is done by toggling
 * `hidden` on the cards the server rendered. Without JavaScript the panel never
 * appears and every record stays visible and linked, which is the behavior the
 * project requires of its main content.
 *
 * Selections live in the query string, so a filtered view is a shareable URL
 * and the back button walks through filter states rather than leaving the page.
 */

import { useEffect, useState } from 'preact/hooks';

/*
 * From `facet-groups`, not `facets`: the latter reaches the catalog and would
 * ship Zod to the browser with it.
 */
import { FACET_GROUP_IDS, type FacetGroup, type FacetGroupId } from '~/lib/facet-groups';

type Facets = Readonly<Record<FacetGroupId, readonly string[]>>;

interface Selection {
  readonly facets: Facets;
  /** Free-text narrowing by name, applied on top of the facets. */
  readonly query: string;
}

const NO_FACETS: Facets = { kind: [], era: [], maker: [], isa: [], status: [] };
const EMPTY: Selection = { facets: NO_FACETS, query: '' };

const QUERY_PARAM = 'q';

function readSelection(search: string): Selection {
  const params = new URLSearchParams(search);
  const facets: Record<FacetGroupId, readonly string[]> = { ...NO_FACETS };
  for (const group of FACET_GROUP_IDS) {
    facets[group] = params.getAll(group).filter((value) => value !== '');
  }
  return { facets, query: params.get(QUERY_PARAM) ?? '' };
}

function toSearch(selection: Selection): string {
  const params = new URLSearchParams();
  for (const group of FACET_GROUP_IDS) {
    for (const value of selection.facets[group]) {
      params.append(group, value);
    }
  }
  if (selection.query.trim() !== '') {
    params.set(QUERY_PARAM, selection.query.trim());
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * A card matches when every group with a selection has at least one of its
 * values, and the text query, if there is one, appears in its canonical name
 * or editorial aliases. Within a group the selections are alternatives; across
 * groups they narrow. Selecting an instruction set therefore hides systems,
 * which have none. That is the intended answer to "show me the MIPS parts".
 *
 * The text match is over the card's build-time search text rather than a search
 * index: this narrows the list a reader is already looking at, and site-wide
 * full-text search is a different tool with its own index behind it.
 */
function matches(card: HTMLElement, selection: Selection): boolean {
  const needle = selection.query.trim().toLowerCase();
  if (needle !== '') {
    const searchText = card.dataset.search ?? card.querySelector('h3')?.textContent ?? '';
    if (!searchText.toLowerCase().includes(needle)) {
      return false;
    }
  }
  return FACET_GROUP_IDS.every((group) => {
    const wanted = selection.facets[group];
    if (wanted.length === 0) {
      return true;
    }
    const have = new Set(
      (card.dataset[`facet${group.charAt(0).toUpperCase()}${group.slice(1)}`] ?? '')
        .split(' ')
        .filter((value) => value !== ''),
    );
    return wanted.some((value) => have.has(value));
  });
}

/** Where the panel stops being a disclosure and becomes a standing sidebar. */
const STANDING_PANEL = '(min-width: 60rem)';

export default function CatalogFilters({ groups }: { groups: readonly FacetGroup[] }) {
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [visible, setVisible] = useState<number | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // The panel is a disclosure on a phone and a standing sidebar from the
  // two-column breakpoint up, and it follows a resize in both directions.
  // otherwise a reader who widens the window keeps a collapsed panel whose
  // summary is no longer displayed, and so can never open it again.
  useEffect(() => {
    const standing = globalThis.matchMedia(STANDING_PANEL);
    const sync = (): void => setExpanded(standing.matches);
    sync();
    standing.addEventListener('change', sync);
    return () => standing.removeEventListener('change', sync);
  }, []);

  // Restore from the URL on load, and follow back/forward.
  useEffect(() => {
    const sync = (): void => setSelection(readSelection(globalThis.location.search));
    sync();
    globalThis.addEventListener('popstate', sync);
    return () => globalThis.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-facet-kind]')];
    let shown = 0;
    for (const card of cards) {
      const show = matches(card, selection);
      card.hidden = !show;
      if (show) {
        shown += 1;
      }
    }

    // A section whose cards are all hidden is noise; its heading goes too.
    for (const section of document.querySelectorAll<HTMLElement>('[data-facet-section]')) {
      const any = [...section.querySelectorAll<HTMLElement>('[data-facet-kind]')].some(
        (card) => !card.hidden,
      );
      section.hidden = !any;
    }

    setTotal(cards.length);
    setVisible(cards.length === 0 ? undefined : shown);
  }, [selection]);

  function commit(next: Selection): void {
    setSelection(next);
    // replaceState, not pushState: every checkbox click would otherwise add a
    // history entry and make the back button useless for leaving the page.
    globalThis.history.replaceState(
      undefined,
      '',
      `${globalThis.location.pathname}${toSearch(next)}`,
    );
  }

  function toggle(group: FacetGroupId, value: string): void {
    const current = selection.facets[group];
    commit({
      ...selection,
      facets: {
        ...selection.facets,
        [group]: current.includes(value)
          ? current.filter((entry) => entry !== value)
          : [...current, value],
      },
    });
  }

  function followDisclosure(event: Event): void {
    setExpanded((event.currentTarget as HTMLDetailsElement).open);
  }

  function clear(): void {
    setSelection(EMPTY);
    globalThis.history.replaceState(undefined, '', globalThis.location.pathname);
  }

  const active =
    FACET_GROUP_IDS.reduce((count, group) => count + selection.facets[group].length, 0) +
    (selection.query.trim() === '' ? 0 : 1);

  return (
    <div class="filters">
      <div class="filters__header">
        <h2 class="filters__title">Filter</h2>
        {/*
         * Both of these are written to keep the panel exactly as tall whether or
         * not anything is selected, because the panel sits above the list at
         * narrow widths and any height change pushes the whole catalog down
         * under the reader's finger.
         *
         * So the count keeps one shape, "12 of 61 records", rather than
         * growing a sentence that wraps to a second line, and the button is
         * always in the layout, hidden rather than absent when there is nothing
         * to clear. `visibility` keeps its space while taking it out of the tab
         * order and out of the accessibility tree, which a disabled button would
         * not: this way there is never a control that looks broken.
         */}
        <output class="filters__count">
          {visible === undefined
            ? ''
            : active === 0
              ? `${total} records`
              : `${visible} of ${total} records`}
        </output>
        <button
          type="button"
          class={`filters__clear${active === 0 ? ' filters__clear--idle' : ''}`}
          onClick={clear}
        >
          Clear all
        </button>
      </div>

      {/*
       * The note carries no figure, and that is deliberate rather than an
       * omission. It used to say "14 machines", which was true of a catalog
       * that has since grown past seventy. Copy stating a count goes stale
       * silently, because nothing fails when the catalog grows. The live
       * count is already one line above in `filters__count`, so a number here
       * would either repeat it or contradict it.
       */}
      {visible === 0 && (
        <p class="filters__note">
          Nothing matches this combination. Select “Clear all” to return to the catalog.
        </p>
      )}

      {/*
       * Collapsed at phone widths, open from the two-column breakpoint up.
       *
       * Open everywhere, the controls were 2 800 px of panel between the reader
       * and the catalog they filter, and appearing at hydration they moved the
       * whole list down the page, a layout shift of 0.34, most of that page's
       * performance score. A disclosure is also what the responsive plan asked
       * for: filters in a panel below 640 px, a standing panel above 960 px.
       *
       * The summary is hidden rather than removed on wide screens, and the state
       * follows the media query, so a reader who resizes never ends up with a
       * closed panel and no way to open it.
       */}
      <details class="filters__disclosure" open={expanded} onToggle={followDisclosure}>
        <summary class="filters__summary">
          {expanded ? 'Hide filters' : 'Show filters'}
          <span class="filters__summary-count numeric">{active === 0 ? '' : active}</span>
        </summary>

        <label class="filters__query">
          <span>Name contains</span>
          <input
            type="search"
            value={selection.query}
            placeholder="Amiga, RDRAM, R10000…"
            onInput={(event) =>
              commit({ ...selection, query: (event.target as HTMLInputElement).value })
            }
          />
        </label>

        <div class="filters__groups">
          {groups
            .filter((group) => group.options.length > 1)
            .map((group) => (
              <fieldset key={group.id} class="filters__group">
                <legend>{group.label}</legend>
                {group.note !== undefined && <p class="filters__note">{group.note}</p>}
                <ul>
                  {group.options.map((option) => (
                    <li key={option.value}>
                      <label class="filters__option">
                        <input
                          type="checkbox"
                          checked={selection.facets[group.id].includes(option.value)}
                          onChange={() => toggle(group.id, option.value)}
                        />
                        <span>{option.label}</span>
                        <span class="filters__option-count numeric">{option.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
        </div>
      </details>
    </div>
  );
}
