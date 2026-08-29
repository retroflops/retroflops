// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCatalog } from './catalog.ts';
import { getMetric } from './data/metrics.ts';
import { findTimelineSeries, timelineSeries } from './timeline.ts';

const catalog = getCatalog();
const series = timelineSeries(catalog);

function bySlug(slug: string) {
  const found = findTimelineSeries(catalog, slug);
  if (found === undefined) {
    throw new Error(`no series ${slug}; got ${series.map((s) => s.slug).join(', ')}`);
  }
  return found;
}

describe('timeline series', () => {
  it('is one comparability group per series, never a metric', () => {
    // Two clock series exist because the methods differ; a single "clocks over
    // time" chart would assert the comparison the group rules refuse.
    const groups = series.map((entry) => entry.group);
    expect(new Set(groups).size).toBe(groups.length);
    for (const entry of series) {
      expect(entry.group).toContain(entry.metric);
      expect(entry.group).toContain(entry.method);
    }
  });

  it('gives two series that differ only by benchmark variant two names', () => {
    // The Geekbench pair used to reach the reader as two cards headed
    // "Geekbench score", identical down to the eyebrow; only the numbers inside
    // the summary said which was which.
    const geekbench = series.filter((entry) => entry.metric === 'geekbench-score');
    expect(geekbench.length).toBeGreaterThan(1);
    const labels = geekbench.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('Geekbench score, single-core (Whole system)');
    expect(labels).toContain('Geekbench score, multi-core (Whole system)');
    // The axis keeps the bare quantity: one chart holds one group anyway.
    expect(new Set(geekbench.map((entry) => entry.metricLabel))).toEqual(
      new Set(['Geekbench score']),
    );
  });

  it('carries the compute scores as their own series, split by graphics API', () => {
    const compute = series.filter((entry) => entry.metric === 'geekbench-compute-score');
    expect(compute.length).toBe(2);
    expect(compute.map((entry) => entry.label).toSorted()).toEqual([
      'Geekbench Compute score, metal (GPU)',
      'Geekbench Compute score, opencl (GPU)',
    ]);
    // Two APIs, two versions, two groups, and no series shared with the
    // processor scores, whose baseline is a different number entirely.
    expect(new Set(compute.map((entry) => entry.group)).size).toBe(2);
  });

  it('groups series by metric and then device scope', () => {
    expect(series[0]?.slug).toBe('clock-frequency-cpu-nominal-clock');
    const cpuPeak = series.findIndex(
      (entry) => entry.slug === 'peak-fp32-rate-cpu-theoretical-peak',
    );
    const gpuPeak = series.findIndex(
      (entry) => entry.slug === 'peak-fp32-rate-gpu-theoretical-peak',
    );
    expect(cpuPeak).toBeGreaterThan(-1);
    expect(gpuPeak).toBe(cpuPeak + 1);
    expect(series[cpuPeak]?.label).toBe('Peak FP32 rate (CPU)');
    expect(series[gpuPeak]?.label).toBe('Peak FP32 rate (GPU)');
  });

  it('withholds a series with fewer than three machines', () => {
    // Only the Apollo Guidance Computer and the Saturn LVDC publish an addition
    // time, and two points are a line rather than a history.
    expect(
      findTimelineSeries(catalog, 'instruction-execution-time-cpu-add-instruction'),
    ).toBeUndefined();
  });

  it('plots figures in the quantity’s base unit while keeping the stated text', () => {
    const clocks = bySlug('clock-frequency-cpu-nominal-clock');
    expect(clocks.unit).toBe('Hz');
    const dreamcast = clocks.points.find((point) => point.systemSlug === 'sega-dreamcast');
    expect(dreamcast?.value).toBe('200000000');
    expect(dreamcast?.text).toContain('200');
    expect(dreamcast?.text).toContain('MHz');
  });

  it('dates a component’s figure by the machine it went into', () => {
    const clocks = bySlug('clock-frequency-cpu-nominal-clock');
    const agc = clocks.points.find((point) => point.systemSlug.startsWith('apollo'));
    // The 2.048 MHz is recorded against the processor, not the spacecraft computer.
    expect(agc?.part).toBe('Apollo Guidance Computer Block II processor');
    expect(agc?.year).toBe(1966);
  });

  it('never plots an absent figure', () => {
    const clocks = bySlug('clock-frequency-cpu-nominal-clock');
    expect(clocks.points.every((point) => point.value !== '0')).toBe(true);
    expect(clocks.absences.length).toBeGreaterThan(0);
    expect(clocks.points.some((point) => point.systemSlug === 'sony-playstation-4')).toBe(true);
  });

  it('allows a logarithmic axis only where the metric does', () => {
    for (const entry of series) {
      expect(entry.allowsLogScale).toBe(getMetric(entry.metric)?.allowsLogScale);
    }
    // A rated power draw is stated without a reproducible workload, so the
    // metric forbids both ratios and a log axis. The series is still worth
    // charting, 17 W in 1994 against 380 W in 2006, but only on a linear axis.
    const power = bySlug('rated-power-consumption-whole-system-rated-power');
    expect(power.allowsLogScale).toBe(false);
  });

  it('never states a range as a multiple for a metric that forbids ratios', () => {
    const power = bySlug('rated-power-consumption-whole-system-rated-power');
    // The low end moved again when Sega's own hardware-history page turned out
    // to state 約13W for the Mega Drive, a consumption figure the console's
    // service manual never carried. Both figures came from sources other than
    // the maker's press releases.
    expect(power.summary).toContain('The lowest rated power consumption here is 13');
    expect(power.summary).toContain('and the highest is 380');
    expect(power.summary).not.toMatch(/\d+×/);
    expect(power.summary).toContain('not divided into a multiple');
  });

  it('generates a summary that states the span, the extremes and the range', () => {
    const clocks = bySlug('clock-frequency-cpu-nominal-clock');
    expect(clocks.summary).toContain('spanning 1966 to 2025');
    const machineCount = new Set(clocks.points.map((point) => point.systemSlug)).size;
    expect(clocks.summary).toContain(`${machineCount} machines`);
    // The extremes are the slowest and fastest figures, not the oldest and newest.
    expect(clocks.summary).toContain('0.98525');
    expect(clocks.summary).toContain('4.41');
    expect(clocks.summary).toContain('within one comparability group');
    expect(clocks.summary).toMatch(/\d+× within/);
  });
});
