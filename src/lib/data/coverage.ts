// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Metric coverage for the questions readers use to compare machines.
 *
 * A catalog may validate every source and comparability group yet still fail to
 * compare two machines. Record validity does not guarantee shared measurements.
 *
 * The backbone tracks CPU and GPU clocks, memory capacity and bandwidth, peak
 * FP32 rate, and power. Each cell has one of five states:
 *
 * - `stated`: a figure with a value.
 * - `not-applicable`: the machine has no such quantity, recorded as a fact.
 * - `unknown`: the quantity exists and no source here states it.
 * - `unverified`: a cited source that no contributor has read.
 * - `absent`: no record exists, so the catalog has a gap.
 *
 * Only `stated`, `not-applicable`, and `unknown` answer a backbone question.
 * `unverified` and `absent` keep the coverage gate failing.
 *
 * The function is pure, so the script can print its result and tests can assert
 * on it directly.
 */

import type { EvidenceLevel, MeasurementScope, MetricId, ValueAbsence } from './metrics.ts';
import type { Catalog } from './schema.ts';

export interface BackboneEntry {
  readonly id: string;
  readonly label: string;
  /** Metrics that answer this question. More than one where the era changed the word. */
  readonly metrics: readonly MetricId[];
  /**
   * Scopes that answer it. A question about the machine's floating point is
   * answered by a figure at either processor scope, and pretending otherwise
   * would report a gap where a figure exists.
   */
  readonly scopes: readonly MeasurementScope[];
  /** The component kind without which the question does not arise. */
  readonly requiresKind?: 'cpu' | 'gpu';
}

/**
 * Questions every machine is asked. The backbone includes the figures needed
 * for comparison, not every quantity the catalog may record.
 */
export const BACKBONE: readonly BackboneEntry[] = [
  {
    id: 'cpu-clock',
    label: 'CPU clock',
    metrics: ['clock-frequency'],
    scopes: ['cpu'],
    requiresKind: 'cpu',
  },
  {
    id: 'gpu-clock',
    label: 'GPU clock',
    metrics: ['clock-frequency'],
    scopes: ['gpu'],
    requiresKind: 'gpu',
  },
  {
    id: 'memory-capacity',
    label: 'Memory capacity',
    metrics: ['memory-capacity', 'memory-capacity-words'],
    scopes: ['whole-system'],
  },
  {
    id: 'memory-bandwidth',
    label: 'Memory bandwidth',
    metrics: ['memory-bandwidth'],
    scopes: ['memory', 'gpu', 'whole-system'],
  },
  {
    id: 'peak-fp32',
    label: 'Peak FP32',
    metrics: ['peak-fp32-rate'],
    scopes: ['cpu', 'gpu'],
  },
  {
    // Three metrics, because the word changed with the era: a rated draw, a
    // cooling-design target and a measured wall figure are different quantities
    // that answer the same question about a machine.
    id: 'power',
    label: 'Power',
    metrics: ['rated-power-consumption', 'thermal-design-power', 'system-power-draw'],
    scopes: ['cpu', 'gpu', 'whole-system'],
  },
];

/**
 * How many backbone questions may still cite a source nobody has read.
 *
 * `data:coverage` fails when the count exceeds this budget. The first release
 * requires zero unread sources.
 *
 * A nonzero value means that at least one catalog record cites a document no
 * contributor has read.
 */
export const UNVERIFIED_BUDGET = 0;

/**
 * This type derives from `VALUE_ABSENCES`. Adding a registry absence then breaks
 * every exhaustive map until the new state is handled. A hand-written union once
 * let `unverified` be reported as `unknown`.
 *
 * `absent` has no counterpart in the registry: it means no record exists at all,
 * which is a question the catalog never asked.
 */
export type CoverageState = 'stated' | ValueAbsence | 'absent';

export interface CoverageCell {
  readonly entry: BackboneEntry;
  readonly state: CoverageState;
  readonly evidenceLevel?: EvidenceLevel | undefined;
  readonly auditedUnknown?: boolean | undefined;
  /** The record's own words about an absence, when it gave any. */
  readonly note?: string | undefined;
}

export interface CoverageRow {
  readonly systemId: string;
  readonly systemSlug: string;
  readonly systemName: string;
  readonly cells: readonly CoverageCell[];
  /** Backbone questions with no record of any kind. */
  readonly gaps: number;
  /** Backbone questions whose only record cites a source nobody has read. */
  readonly unverified: number;
}

/**
 * A machine may answer with figures from its fitted parts. The Commodore 64's
 * memory capacity, for example, is recorded against its RAM. A figure counts
 * when it belongs to the machine or one of its fitted components.
 */
export function coverage(catalog: Catalog): readonly CoverageRow[] {
  return catalog.systems.map((system) => {
    const componentIds = new Set(
      system.configurations.flatMap((configuration) =>
        configuration.entries.map((entry) => entry.componentId),
      ),
    );
    const figures = catalog.measurements.filter(
      (measurement) =>
        (measurement.subject.kind === 'system' && measurement.subject.id === system.id) ||
        (measurement.subject.kind === 'component' && componentIds.has(measurement.subject.id)),
    );

    const kinds = new Set(
      catalog.components
        .filter((component) => componentIds.has(component.id))
        .map((component) => component.kind),
    );

    const cells = BACKBONE.map((entry): CoverageCell => {
      // A machine with no graphics part has no graphics clock, and that is a
      // fact about the hardware rather than a hole in the catalog.
      if (entry.requiresKind !== undefined && !kinds.has(entry.requiresKind)) {
        return {
          entry,
          state: 'not-applicable',
          note: `no ${entry.requiresKind} component is fitted to this record`,
        };
      }

      const candidates = figures.filter(
        (measurement) =>
          entry.metrics.includes(measurement.metric) && entry.scopes.includes(measurement.scope),
      );
      const stated = candidates
        .filter((measurement) => measurement.quantity.state === 'value')
        .toSorted((a, b) => evidenceRank(b.evidenceLevel) - evidenceRank(a.evidenceLevel))[0];
      if (stated !== undefined) {
        return { entry, state: 'stated', evidenceLevel: stated.evidenceLevel };
      }
      // A record that answers the question outranks one that only admits nobody
      // has looked: if any source was read and found to state nothing, that is
      // the finding, whatever else is filed against the same question.
      const answered = candidates.find(
        (measurement) => measurement.quantity.state !== 'unverified',
      );
      const recorded = answered ?? candidates[0];
      if (recorded === undefined) {
        return { entry, state: 'absent' };
      }
      const { quantity } = recorded;
      if (quantity.state === 'value') {
        return { entry, state: 'stated' };
      }
      return {
        entry,
        state: quantity.state,
        note: quantity.note,
        auditedUnknown:
          quantity.state === 'unknown' ? recorded.unknownAudit !== undefined : undefined,
      };
    });

    return {
      systemId: system.id,
      systemSlug: system.slug,
      systemName: system.name,
      cells,
      gaps: cells.filter((cell) => cell.state === 'absent').length,
      unverified: cells.filter((cell) => cell.state === 'unverified').length,
    };
  });
}

function evidenceRank(level: EvidenceLevel | undefined): number {
  return level === 'confirmed' ? 3 : level === 'reported' ? 2 : level === 'rumored' ? 1 : 0;
}

const SYMBOLS: Record<CoverageState, string> = {
  stated: '●',
  unknown: '○',
  'not-applicable': '–',
  unverified: '…',
  absent: '?',
};

/** The matrix as Markdown, for `data:coverage` and for a pull-request comment. */
export function renderCoverage(rows: readonly CoverageRow[]): string {
  const header = ['Machine', ...BACKBONE.map((entry) => entry.label), 'Unread', 'Gaps'];
  const lines = [
    '# Metric coverage',
    '',
    '● stated · ○ researched unknown · ◌ unreviewed unknown · – not applicable · … unread source · ? nothing recorded',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    const cells = row.cells.map((cell) =>
      cell.state === 'unknown' && cell.auditedUnknown !== true ? '◌' : SYMBOLS[cell.state],
    );
    lines.push(`| ${row.systemName} | ${cells.join(' | ')} | ${row.unverified} | ${row.gaps} |`);
  }

  const totals: Record<CoverageState, number> = {
    stated: 0,
    unknown: 0,
    'not-applicable': 0,
    unverified: 0,
    absent: 0,
  };
  for (const row of rows) {
    for (const cell of row.cells) {
      totals[cell.state] += 1;
    }
  }
  const evidence = { confirmed: 0, reported: 0, rumored: 0 };
  let unreviewedUnknown = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.evidenceLevel !== undefined) evidence[cell.evidenceLevel] += 1;
      if (cell.state === 'unknown' && cell.auditedUnknown !== true) unreviewedUnknown += 1;
    }
  }
  lines.push(
    '',
    `${rows.length} machines, ${rows.length * BACKBONE.length} backbone questions.`,
    '',
    `${totals.stated} stated: ${evidence.confirmed} confirmed, ${evidence.reported} reported, ${evidence.rumored} rumored.`,
    `${totals.unknown} unknown: ${totals.unknown - unreviewedUnknown} researched, ${unreviewedUnknown} unreviewed · ${totals['not-applicable']} not applicable · ${totals.unverified} unread · ${totals.absent} unasked.`,
    '',
    'A researched unknown is a completed finding. An unreviewed unknown, an',
    'unread source and an unasked question are unfinished catalog work.',
  );
  return `${lines.join('\n')}\n`;
}
