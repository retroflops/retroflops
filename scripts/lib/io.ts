// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Deterministic file IO for the data pipeline.
 *
 * Two runs over identical inputs must produce byte-identical public outputs, so
 * generated JSON goes through here with sorted keys, fixed indentation, LF line
 * endings and a trailing newline. Editable YAML keeps its own key order and
 * prose layout instead.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isAlias, isPair, isScalar, parseDocument, Scalar, type Document, visit } from 'yaml';

export const REPO_ROOT = new URL('../../', import.meta.url).pathname;

export function repoPath(...segments: string[]): string {
  return join(REPO_ROOT, ...segments);
}

/** Recursively sorts object keys so serialization does not depend on insertion order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortKeysDeep(entryValue)]));
}

/** Canonical JSON text: sorted keys, two-space indent, trailing newline. */
export function toCanonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export class YamlFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlFileError';
  }
}

const YAML_PARSE_OPTIONS = {
  version: '1.2' as const,
  schema: 'core',
  strict: true,
  uniqueKeys: true,
  keepSourceTokens: true,
};

const YAML_WRITE_OPTIONS = {
  blockQuote: 'folded' as const,
  collectionStyle: 'block' as const,
  directives: false,
  indent: 2,
  lineWidth: 80,
};

const PROSE_FIELDS = new Set([
  'alt',
  'caveat',
  'creditLine',
  'description',
  'evidence',
  'extract',
  'locator',
  'note',
  'notes',
  'rationale',
  'summary',
  'title',
  'usageNote',
]);

/** Uses block scalars for the editorial fields that benefit from visible prose. */
export function formatYamlProse(document: Document): void {
  visit(document, {
    Pair(_, pair) {
      if (!isPair(pair) || !isScalar(pair.key) || !isScalar(pair.value)) {
        return undefined;
      }
      if (typeof pair.key.value !== 'string' || typeof pair.value.value !== 'string') {
        return undefined;
      }
      if (!PROSE_FIELDS.has(pair.key.value) || pair.value.value.length < 80) {
        return undefined;
      }
      pair.value.type = pair.value.value.includes('\n')
        ? Scalar.BLOCK_LITERAL
        : Scalar.BLOCK_FOLDED;
      return undefined;
    },
  });
}

/** Parses the deliberately small YAML subset accepted by canonical records. */
export function parseYamlDocument(text: string, path: string): Document {
  const document = parseDocument(text, YAML_PARSE_OPTIONS);
  if (document.errors.length > 0) {
    throw new YamlFileError(
      `${path}: ${document.errors.map((error) => error.message.replace(/\n/g, ' ')).join('; ')}`,
    );
  }

  let unsupported: string | undefined;
  visit(document, {
    Pair(_, pair) {
      if (isPair(pair) && isScalar(pair.key) && pair.key.value === '<<') {
        unsupported = 'merge keys are not allowed';
        return visit.BREAK;
      }
      return undefined;
    },
    Node(_, node) {
      if (isAlias(node)) {
        unsupported = 'aliases are not allowed';
        return visit.BREAK;
      }
      if (node.tag !== undefined) {
        unsupported = 'explicit YAML tags are not allowed';
        return visit.BREAK;
      }
      if ('anchor' in node && typeof node.anchor === 'string') {
        unsupported = 'anchors are not allowed';
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (unsupported !== undefined) {
    throw new YamlFileError(`${path}: ${unsupported}`);
  }
  return document;
}

/** Reads one canonical YAML record without changing its editable layout. */
export async function readYamlDocument(
  path: string,
): Promise<{ readonly text: string; readonly document: Document }> {
  const text = await readFile(path, 'utf8');
  return { text, document: parseYamlDocument(text, path) };
}

export async function readYamlFile(path: string): Promise<unknown> {
  const { document } = await readYamlDocument(path);
  return document.toJS({ maxAliasCount: 0 });
}

/** Serializes a parsed document using the repository's 80-column YAML style. */
export function yamlDocumentText(document: Document): string {
  formatYamlProse(document);
  return document.toString(YAML_WRITE_OPTIONS);
}

/** Writes a changed parsed document without replacing comments or key order. */
export async function writeYamlDocumentIfChanged(
  path: string,
  originalText: string,
  document: Document,
): Promise<boolean> {
  const next = yamlDocumentText(document);
  if (next === originalText) {
    return false;
  }
  await writeFile(path, next, 'utf8');
  return true;
}

export async function readJsonFile(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

/** Writes canonical JSON, returning true when the file's content actually changed. */
export async function writeJsonFileIfChanged(path: string, value: unknown): Promise<boolean> {
  const next = toCanonicalJson(value);
  let current: string | undefined;
  try {
    current = await readFile(path, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === next) {
    return false;
  }
  await writeFile(path, next, 'utf8');
  return true;
}

/** YAML files in a directory, sorted by name so traversal order is stable. */
export async function listYamlFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((name) => name.endsWith('.yaml'))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => join(directory, name));
}

/** JSON files in a directory, sorted by name so traversal order is stable. */
export async function listJsonFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((name) => name.endsWith('.json'))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => join(directory, name));
}

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
