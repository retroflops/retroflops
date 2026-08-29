// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Timeline series.
 *
 * A series is one comparability group plotted against release date. Every chart
 * point is implicitly compared with every other, so mixing methods or benchmark
 * versions would assert a comparison the project rejects. An "all clocks over
 * time" chart would combine different quantities, so this view does not offer
 * one.
 *
 * Points are dated by the machine, not by the part. A figure recorded against a
 * processor is plotted at the release date of each system that machine went into.
 * A release date applies to a shipped machine. The chart therefore answers what
 * a reader could buy in a given year.
 *
 * Every series carries its own data table and a generated text summary, so the
 * chart is never the only way to read it.
 */

import type { BenchmarkIdentity } from './data/comparability.ts';
import { compareDecimal, parseDecimal } from './data/decimal.ts';
import {
  getMetric,
  type ConfidenceStatus,
  type EditorialStatus,
  type MeasurementScope,
  type MetricId,
} from './data/metrics.ts';
import type { Catalog, Measurement, System } from './data/schema.ts';
import { getUnit } from './data/units.ts';
import { formatDecimalDigits, formatQuantity, measurementLabel, metricLabel } from './display.ts';

/**
 * A history needs at least three points. A two-point series is better read on
 * the profiles.
 */
const MIN_POINTS = 3;

const SCOPE_LABELS: Readonly<Record<MeasurementScope, string>> = {
  cpu: 'CPU',
  gpu: 'GPU',
  memory: 'Memory',
  storage: 'Storage',
  'whole-system': 'Whole system',
};

const SCOPE_ORDER: Readonly<Record<MeasurementScope, number>> = {
  cpu: 0,
  gpu: 1,
  memory: 2,
  storage: 3,
  'whole-system': 4,
};

function timelineLabel(
  metric: MetricId,
  scope: MeasurementScope,
  benchmark: BenchmarkIdentity | undefined,
): string {
  return `${measurementLabel(metric, benchmark)} (${SCOPE_LABELS[scope]})`;
}

export interface TimelinePoint {
  readonly measurementId: string;
  /** The machine the point is dated by. */
  readonly systemName: string;
  readonly systemSlug: string;
  /** Release date as recorded, `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly date: string;
  readonly year: number;
  /** The part the figure belongs to, when it is not the machine itself. */
  readonly part?: string | undefined;
  /** Variant of the machine, when the figure is specific to one. */
  readonly variant?: string | undefined;
  /** Exact decimal in the quantity's base unit, for the axis. */
  readonly value: string;
  /** The figure as the source stated it, unit included. */
  readonly text: string;
  readonly status: ConfidenceStatus;
  readonly editorialStatus: EditorialStatus;
  readonly sourceIds: readonly string[];
}

/**
 * A figure in this group that has no value, and so no point on the chart.
 *
 * Carried alongside the points because leaving it out would make the chart look
 * like the whole of the evidence. A machine whose clock nobody published is not
 * a machine with a low clock.
 */
export interface TimelineAbsence {
  readonly measurementId: string;
  readonly systemName: string;
  readonly systemSlug: string;
  readonly date: string;
  readonly part?: string | undefined;
  /** `unknown` or `not applicable`, written out. */
  readonly text: string;
  readonly note?: string | undefined;
}

export interface TimelineSeries {
  /** URL-safe identifier for the series' own route. */
  readonly slug: string;
  readonly group: string;
  readonly metric: MetricId;
  readonly metricLabel: string;
  /**
   * What to call the series in a heading. The metric alone is insufficient when
   * two series differ only by benchmark variant. A page of cards would otherwise
   * say "Geekbench score" twice. This label carries the variant, while
   * `metricLabel` remains the quantity used on the axis.
   */
  readonly label: string;
  readonly scope: MeasurementScope;
  readonly method: string;
  readonly benchmark?: BenchmarkIdentity | undefined;
  /** Base unit of the quantity; the axis is drawn in it. */
  readonly unit: string;
  readonly unitLabel: string;
  /** Whether a logarithmic axis is mathematically valid for this metric. */
  readonly allowsLogScale: boolean;
  readonly points: readonly TimelinePoint[];
  /** Figures in this group that state no value, so the table outlives the chart. */
  readonly absences: readonly TimelineAbsence[];
  /** Generated prose stating what the chart shows. Never hand-written. */
  readonly summary: string;
  readonly metricDescription: string;
}

function slugify(group: string): string {
  return group
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

/** Every system a measurement can be dated by: its subject, or the machines using it. */
function owningSystems(catalog: Catalog, measurement: Measurement): readonly System[] {
  if (measurement.subject.kind === 'system') {
    return catalog.systems.filter((system) => system.id === measurement.subject.id);
  }
  return catalog.systems.filter((system) =>
    system.configurations.some((configuration) =>
      configuration.entries.some((entry) => entry.componentId === measurement.subject.id),
    ),
  );
}

/**
 * The series a chart may be drawn for, grouped by metric and device scope.
 *
 * Only stated values take part. An absent figure has no point at zero, and the
 * chart never interpolates it. The data table records that the figure was
 * considered.
 */
export function timelineSeries(catalog: Catalog): readonly TimelineSeries[] {
  const byGroup = new Map<string, TimelinePoint[]>();
  const absencesByGroup = new Map<string, TimelineAbsence[]>();
  const facets = new Map<string, Measurement>();

  for (const measurement of catalog.measurements) {
    const partName =
      measurement.subject.kind === 'component'
        ? catalog.components.find((component) => component.id === measurement.subject.id)?.name
        : undefined;

    if (measurement.quantity.state !== 'value' || measurement.normalized === undefined) {
      const formatted = formatQuantity(measurement.quantity);
      for (const system of owningSystems(catalog, measurement)) {
        const absences = absencesByGroup.get(measurement.comparabilityGroup) ?? [];
        absences.push({
          measurementId: measurement.id,
          systemName: system.name,
          systemSlug: system.slug,
          date: system.releaseDate,
          part: partName,
          text: formatted.text,
          note: formatted.note,
        });
        absencesByGroup.set(measurement.comparabilityGroup, absences);
      }
      continue;
    }

    for (const system of owningSystems(catalog, measurement)) {
      const onVariant = measurement.subject.configurationId;
      const variant = system.configurations.find(
        (configuration) => configuration.id === onVariant,
      )?.label;
      const year = Number(system.releaseDate.slice(0, 4));
      if (!Number.isFinite(year)) {
        continue;
      }
      const points = byGroup.get(measurement.comparabilityGroup) ?? [];
      points.push({
        measurementId: measurement.id,
        systemName: system.name,
        systemSlug: system.slug,
        date: system.releaseDate,
        year,
        part: partName,
        variant,
        value: measurement.normalized.value,
        text: formatQuantity(measurement.quantity).text,
        status: measurement.status,
        editorialStatus: measurement.editorialStatus,
        sourceIds: measurement.sourceIds,
      });
      byGroup.set(measurement.comparabilityGroup, points);
      facets.set(measurement.comparabilityGroup, measurement);
    }
  }

  const series: TimelineSeries[] = [];
  for (const [group, points] of byGroup) {
    const sample = facets.get(group);
    const metric = sample === undefined ? undefined : getMetric(sample.metric);
    if (sample === undefined || metric === undefined) {
      continue;
    }
    // Count machines, not figures. Eight capacities from two machines are a
    // parts list, not a history.
    const machines = new Set(points.map((point) => point.systemSlug)).size;
    if (machines < MIN_POINTS) {
      continue;
    }

    const unit = sample.normalized?.unit ?? '';
    const ordered = points.toSorted(
      (a, b) => a.date.localeCompare(b.date) || a.systemName.localeCompare(b.systemName),
    );

    series.push({
      slug: slugify(group),
      group,
      metric: sample.metric,
      metricLabel: metricLabel(sample.metric),
      label: timelineLabel(sample.metric, sample.scope, sample.benchmark),
      scope: sample.scope,
      method: sample.method,
      benchmark: sample.benchmark,
      unit,
      unitLabel: getUnit(unit)?.label ?? unit,
      allowsLogScale: metric.allowsLogScale,
      points: ordered,
      absences: (absencesByGroup.get(group) ?? []).toSorted((a, b) => a.date.localeCompare(b.date)),
      summary: summarize(ordered, sample.metric, unit),
      metricDescription: metric.description,
    });
  }

  // Keep related charts together. A CPU and GPU FP32 chart answer different
  // questions, but a reader should see both before moving on to another metric.
  return series.toSorted(
    (a, b) =>
      a.metricLabel.localeCompare(b.metricLabel) ||
      SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] ||
      a.method.localeCompare(b.method) ||
      a.label.localeCompare(b.label),
  );
}

export function findTimelineSeries(catalog: Catalog, slug: string): TimelineSeries | undefined {
  return timelineSeries(catalog).find((series) => series.slug === slug);
}

/**
 * The text alternative to the chart.
 *
 * Generated from the points, so it cannot drift from the chart. It states the
 * span, extremes, and range as a multiple. This is valid because every point in
 * a series shares a comparability group by construction.
 */
function summarize(points: readonly TimelinePoint[], metric: MetricId, unit: string): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }

  const sorted = points.toSorted((a, b) => compareValues(a.value, b.value));
  const lowest = sorted[0];
  const highest = sorted.at(-1);
  const symbol = getUnit(unit)?.symbol ?? unit;
  const label = metricLabel(metric).toLowerCase();
  const machines = new Set(points.map((point) => point.systemSlug)).size;

  const sentences = [
    `${points.length} figures from ${machines} machines, spanning ${first.year} to ${last.year}.`,
  ];
  if (lowest !== undefined && highest !== undefined && lowest !== highest) {
    sentences.push(
      `The lowest ${label} here is ${lowest.text} (${lowest.systemName}, ${lowest.year}) and the highest is ${highest.text} (${highest.systemName}, ${highest.year}).`,
    );
    const plottedIn = `the figures are plotted in ${symbol === '' ? 'the base unit' : symbol}`;
    const factor = ratioText(highest.value, lowest.value);
    // A shared comparability group permits a range multiplier only when the
    // metric allows ratios. A rated power draw states no workload, so the
    // summary treats a 2.1× range as a span.
    if (factor !== undefined && getMetric(metric)?.allowsRatio === true) {
      sentences.push(
        `That is a range of about ${factor}× within one comparability group; ${plottedIn}.`,
      );
    } else {
      sentences.push(
        `The two are not divided into a multiple: ${label} is not a metric where a ratio means anything. ${plottedIn.charAt(0).toUpperCase()}${plottedIn.slice(1)}.`,
      );
    }
  }
  sentences.push(
    'Points use the release date of the machine the figure belongs to. The table below lists absent figures with their recorded reasons.',
  );
  return sentences.join(' ');
}

/**
 * Compares two figures as exact decimals.
 *
 * The chart passes values to its plotting library as doubles because drawing a
 * pixel needs JavaScript numbers. The text summary ranks figures using exact
 * decimal values.
 */
function compareValues(a: string, b: string): number {
  return compareDecimal(parseDecimal(a), parseDecimal(b));
}

/**
 * A deliberately rough order-of-magnitude factor for the summary sentence. It
 * describes the chart's range. Exact multipliers belong to the ratio formula and
 * the pages that show its inputs.
 */
function ratioText(high: string, low: string): string | undefined {
  const numerator = Number(high);
  const denominator = Number(low);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  const factor = numerator / denominator;
  if (factor < 10) {
    return factor.toFixed(1);
  }
  return formatDecimalDigits(String(Math.round(factor)));
}
