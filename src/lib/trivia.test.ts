// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { getCatalog } from './catalog.ts';
import { resolveTrivia, type TriviaData, type TriviaEntry } from './trivia.ts';

function isTriviaData(value: unknown): value is TriviaData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['title'] === 'string' &&
    Array.isArray(candidate['sourceIds']) &&
    candidate['sourceIds'].every((id) => typeof id === 'string')
  );
}

function readTrivia(file: string): TriviaEntry {
  const source = readFileSync(`src/content/trivia/${file}`, 'utf8');
  const match = /^---\n([\s\S]*?)\n---/m.exec(source);
  const data = match?.[1] === undefined ? undefined : parse(match[1]);
  if (!isTriviaData(data)) {
    throw new Error(`Could not read trivia entry ${file}.`);
  }

  return {
    id: file.replace(/\.md$/, ''),
    data,
    body: source.slice(match?.[0].length ?? 0),
  };
}

const entries = readdirSync('src/content/trivia')
  .filter((file) => file.endsWith('.md'))
  .toSorted()
  .map(readTrivia);

const catalog = getCatalog();

describe('trivia entries', () => {
  it('names a machine the catalog holds, in every file name', () => {
    const slugs = new Set(catalog.systems.map((system) => system.slug));
    const orphans = entries.filter((entry) => !slugs.has(entry.id)).map((entry) => entry.id);

    expect(orphans).toEqual([]);
  });

  it('cites only sources the catalog holds', () => {
    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const dangling = entries.flatMap((entry) =>
      entry.data.sourceIds.filter((id) => !sourceIds.has(id)).map((id) => `${entry.id}: ${id}`),
    );

    expect(dangling).toEqual([]);
  });

  /*
   * `data:build` resolves `{{…}}` over the canonical dataset only. A content
   * collection never passes through it, so a marker written here would not fail
   * as a broken reference. It would publish a pair of braces to a reader.
   */
  it('leaves no editorial marker in a body, because nothing would resolve it', () => {
    const withMarkers = entries
      .filter((entry) => /\{\{[^{}]*\}\}/.test(entry.body ?? ''))
      .map((entry) => entry.id);

    expect(withMarkers).toEqual([]);
  });

  /*
   * The profile owns the `h2`. Unlike a methodology page, a trivia body is not a
   * document of its own, so a `#` or `##` here breaks the page outline. That is
   * an axe finding nobody would think to look for.
   */
  it('starts any heading in a body at the third level', () => {
    const shallow = entries
      .filter((entry) => /^#{1,2} /m.test(entry.body ?? ''))
      .map((entry) => entry.id);

    expect(shallow).toEqual([]);
  });

  /** The sibling of "keeps every system summary and description distinct". */
  it('keeps every title and body distinct', () => {
    const titles = entries.map((entry) => entry.data.title);
    const bodies = entries.map((entry) => (entry.body ?? '').replaceAll(/\s+/g, ' ').trim());

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  /*
   * The catalog's own guard covers `summary` and `description` in the built
   * artifact. Trivia is not in the artifact, so this test enforces the same
   * rule. A profile section that names an absence reads as a gap in the record
   * rather than as the editorial choice it is.
   */
  it('names no absence in a body', () => {
    const absenceLabel = /\b(unknown|not applicable|not yet checked)\b/i;
    const offenders = entries
      .filter((entry) => absenceLabel.test(entry.body ?? ''))
      .map((entry) => entry.id);

    expect(offenders).toEqual([]);
  });

  /*
   * This stands in for a rule it cannot check, that an entry is this project's
   * own sentences about what a document says rather than a rewrite of the
   * document's passage. A character count does not catch a short copy, but it
   * does stop an entry growing into an article, which is where the copyright
   * problem starts. `Source.extract` is capped at 600 characters for the same
   * reason.
   */
  it('stays a section rather than an article', () => {
    const overlong = entries
      .filter((entry) => (entry.body ?? '').trim().length > 2500)
      .map((entry) => entry.id);

    expect(overlong).toEqual([]);
  });
});

describe('trivia resolution', () => {
  it('refuses a file naming a machine the catalog does not have', () => {
    expect(() =>
      resolveTrivia({ id: 'sinclair-ql', data: { title: 'Trivia', sourceIds: [] } }, catalog),
    ).toThrow('names no system in the catalog');
  });

  it('refuses a citation the catalog cannot resolve', () => {
    expect(() =>
      resolveTrivia(
        { id: 'commodore-64', data: { title: 'Trivia', sourceIds: ['no-such-source'] } },
        catalog,
      ),
    ).toThrow('which the catalog does not hold');
  });

  it('refuses a body carrying an editorial marker', () => {
    expect(() =>
      resolveTrivia(
        {
          id: 'saturn-lvdc',
          data: { title: 'Trivia', sourceIds: ['ntrs-19700023342'] },
          body: 'It holds {{measurement:saturn-lvdc:memory-capacity}} of core.',
        },
        catalog,
      ),
    ).toThrow('contains a "{{…}}" marker');
  });
});
