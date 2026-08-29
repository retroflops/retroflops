// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `data:normalize`, recomputes the normalized twin of every stated figure.
 *
 * Offline by construction: it reads canonical records, applies the versioned
 * unit registry with decimal arithmetic, and rewrites only files whose content
 * actually changed. Running it twice in a row is a no-op, which is part of what
 * makes the build deterministic. It retains the editor's key order and prose
 * blocks while changing only the generated normalized field.
 *
 * `--check` reports what would change and exits non-zero instead of writing.
 * That is how CI catches a normalized value that was hand-edited, or left stale
 * after a unit-registry change.
 */

import { writeFile } from 'node:fs/promises';

import { normalizeQuantity, type StatedQuantity } from '../src/lib/data/normalize.ts';
import { loadRecords } from './lib/dataset.ts';
import { readYamlDocument, yamlDocumentText } from './lib/io.ts';

interface MeasurementLike {
  id?: unknown;
  quantity?: { state?: unknown; value?: unknown; unit?: unknown; significantDigits?: unknown };
  normalized?: unknown;
}

/** Returns the stated figure, or undefined for `unknown` / `not-applicable`. */
function statedQuantityOf(measurement: MeasurementLike): StatedQuantity | undefined {
  const quantity = measurement.quantity;
  if (
    quantity === undefined ||
    quantity.state !== 'value' ||
    typeof quantity.value !== 'string' ||
    typeof quantity.unit !== 'string' ||
    typeof quantity.significantDigits !== 'number'
  ) {
    return undefined;
  }
  return {
    value: quantity.value,
    unit: quantity.unit as StatedQuantity['unit'],
    significantDigits: quantity.significantDigits,
  };
}

interface FileOutcome {
  readonly file: string;
  readonly changed: boolean;
  readonly text: string;
  readonly normalized: number;
  readonly withoutValue: number;
}

async function normalizeFile(file: string): Promise<FileOutcome> {
  const { text: originalText, document } = await readYamlDocument(file);
  const parsed: unknown = document.toJS({ maxAliasCount: 0 });
  const isArray = Array.isArray(parsed);
  const measurements = (isArray ? parsed : [parsed]) as MeasurementLike[];

  let normalized = 0;
  let withoutValue = 0;

  for (const [index, measurement] of measurements.entries()) {
    const path = isArray ? [index, 'normalized'] : ['normalized'];
    const stated = statedQuantityOf(measurement);
    if (stated === undefined) {
      document.deleteIn(path);
      withoutValue += 1;
      continue;
    }
    document.setIn(path, normalizeQuantity(stated));
    normalized += 1;
  }

  const text = yamlDocumentText(document);
  return { file, changed: text !== originalText, text, normalized, withoutValue };
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const records = await loadRecords('measurements');
  const files = [...new Set(records.map((record) => record.file))].toSorted();

  const outcomes = await Promise.all(files.map(normalizeFile));
  const stale = outcomes.filter((outcome) => outcome.changed);

  if (!checkOnly) {
    await Promise.all(stale.map((outcome) => writeFile(outcome.file, outcome.text, 'utf8')));
  }

  const normalized = outcomes.reduce((total, outcome) => total + outcome.normalized, 0);
  const withoutValue = outcomes.reduce((total, outcome) => total + outcome.withoutValue, 0);
  const summary = `${normalized} normalized, ${withoutValue} without a value, ${files.length} file(s)`;

  if (checkOnly && stale.length > 0) {
    console.error(`data:normalize --check found ${stale.length} stale file(s):`);
    for (const outcome of stale) {
      console.error(`  ${outcome.file}`);
    }
    console.error('Run `pnpm data:normalize` and commit the result.');
    process.exitCode = 1;
    return;
  }

  console.log(
    checkOnly
      ? `data:normalize --check: up to date (${summary})`
      : `data:normalize: ${summary}, ${stale.length} file(s) rewritten`,
  );
}

await main();
