// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Adapters for structured sources.
 *
 * Where a source publishes machine-readable content, an adapter pulls the
 * figure out of it so the value in the catalog can be traced to an exact
 * position in the fetched bytes rather than to someone's reading of them.
 *
 * Adapters extract; they never interpret. They return the literal text found at
 * a locator, leaving unit parsing, normalization and comparability to the rest
 * of the pipeline. A source that is a PDF or a scan gets a manual research
 * record instead. See `researchRecordSchema` in `schema.ts`.
 */

export const ADAPTER_REGISTRY_VERSION = 'adapters-v1';

export interface ExtractedValue {
  /** The locator that produced this value, echoed back for the audit trail. */
  readonly locator: string;
  /** Literal text as found. Never coerced to a number here. */
  readonly text: string;
}

export type AdapterOutcome =
  | { readonly ok: true; readonly value: ExtractedValue }
  | { readonly ok: false; readonly reason: string };

export interface AdapterDefinition {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  /** Human-readable description of the locator syntax, shown in editor docs. */
  readonly locatorSyntax: string;
  extract(content: string, locator: string): AdapterOutcome;
}

/**
 * Reads a value out of a JSON document using a slash-delimited path, e.g.
 * `/results/0/base_score`. Array indices are plain integers.
 */
const jsonPath: AdapterDefinition = {
  id: 'json-path',
  version: '1',
  description: 'Reads one value from a JSON document.',
  locatorSyntax: '/key/0/nested-key',
  extract(content, locator) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      return { ok: false, reason: `source is not valid JSON: ${(error as Error).message}` };
    }

    const segments = locator.split('/').filter((segment) => segment !== '');
    let current: unknown = parsed;
    for (const segment of segments) {
      if (Array.isArray(current)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          return { ok: false, reason: `no array index "${segment}" at ${locator}` };
        }
        current = current[index];
        continue;
      }
      if (current === null || typeof current !== 'object') {
        return { ok: false, reason: `cannot descend into "${segment}" at ${locator}` };
      }
      if (!Object.hasOwn(current, segment)) {
        return { ok: false, reason: `no key "${segment}" at ${locator}` };
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current === null || typeof current === 'object') {
      return { ok: false, reason: `${locator} points at a container, not a value` };
    }
    return { ok: true, value: { locator, text: String(current) } };
  },
};

/**
 * Reads one cell out of a delimited table. The locator is `row:N,col:M`, both
 * 1-based and counted including the header row, so a locator matches what a
 * person sees in a spreadsheet.
 */
const delimitedCell: AdapterDefinition = {
  id: 'delimited-cell',
  version: '1',
  description: 'Reads one cell from a comma- or tab-delimited table.',
  locatorSyntax: 'row:4,col:2',
  extract(content, locator) {
    const match = /^row:(\d+),col:(\d+)$/.exec(locator.trim());
    if (match === null) {
      return { ok: false, reason: `locator must look like "row:4,col:2", got "${locator}"` };
    }
    const row = Number(match[1]);
    const column = Number(match[2]);
    if (row < 1 || column < 1) {
      return { ok: false, reason: 'row and column are 1-based' };
    }

    const delimiter = content.includes('\t') ? '\t' : ',';
    const lines = content.split(/\r?\n/).filter((line) => line !== '');
    const line = lines[row - 1];
    if (line === undefined) {
      return { ok: false, reason: `row ${row} is beyond the ${lines.length}-row table` };
    }
    const cell = splitDelimited(line, delimiter)[column - 1];
    if (cell === undefined) {
      return { ok: false, reason: `column ${column} is beyond row ${row}` };
    }
    return { ok: true, value: { locator, text: cell.trim() } };
  },
};

const ADAPTER_LIST: readonly AdapterDefinition[] = [jsonPath, delimitedCell];

export const ADAPTERS: ReadonlyMap<string, AdapterDefinition> = new Map(
  ADAPTER_LIST.map((adapter) => [adapter.id, adapter]),
);

export function getAdapter(id: string): AdapterDefinition | undefined {
  return ADAPTERS.get(id);
}

/** Minimal RFC 4180 field splitting, so a quoted cell containing the delimiter survives. */
function splitDelimited(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      field += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      fields.push(field);
      field = '';
      continue;
    }
    field += character;
  }

  fields.push(field);
  return fields;
}
