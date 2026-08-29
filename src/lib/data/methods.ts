// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Method registry for `catalog-v1`.
 *
 * A method says *how a figure was obtained*, and it is part of the comparability
 * group: a nominal clock and a clock read off a running machine answer different
 * questions and must never divide into each other.
 *
 * Before this registry the method was any identifier the regular expression
 * allowed, so a typo silently created a comparability group of one, and two
 * curators describing the same kind of figure, a vendor's rated peak, could
 * write `vendor-stated-peak` and `design-specification` and cut the catalog in
 * half along a seam that says nothing about the hardware.
 *
 * The registry therefore splits two things that used to share the field:
 *
 * - the **method**, which is how the number came to exist, and which stays in
 *   the comparability group;
 * - the **provenance** and **evidence stage**, which are who said it and whether
 *   the hardware had shipped, and which do not. A figure is not incomparable
 *   because the vendor stayed silent and somebody else measured it, that is
 *   what the reader is here to find out.
 *
 * Each method names the metrics it may describe, so `nominal-clock` cannot end
 * up on a memory capacity.
 */

import { METRIC_IDS, type MetricId } from './metrics.ts';

export const METHOD_REGISTRY_VERSION = 'methods-v1';

/**
 * Who stated the figure. Deliberately outside the comparability group: a
 * vendor's clock and an independently published clock for the same part are the
 * same quantity obtained the same way, and separating them would mean a machine
 * whose maker never published a frequency could never be compared with one whose
 * maker did.
 */
export const PROVENANCES = ['vendor', 'independent', 'community'] as const;

export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  /** The party responsible for the hardware: manufacturer, or the program that specified it. */
  vendor: 'Vendor',
  /** A third party with no stake in the figure: a laboratory, a journal, a benchmark body. */
  independent: 'Independent',
  /** Enthusiast documentation, held to the same source tiers as everything else. */
  community: 'Community',
};

/**
 * Whether the figure describes hardware that reached buyers or an announcement
 * made before it did. Also outside the comparability group, a pre-launch figure
 * is protected by staying `provisional`, which already blocks every automatic
 * multiplier, rather than by being pushed into a group of its own where it would
 * occupy a separate row and explain nothing.
 */
export const EVIDENCE_STAGES = ['shipped', 'pre-launch'] as const;

export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];

export const EVIDENCE_STAGE_LABELS: Record<EvidenceStage, string> = {
  shipped: 'Shipped hardware',
  'pre-launch': 'Pre-launch announcement',
};

export interface MethodDefinition {
  readonly id: string;
  readonly label: string;
  /** Metrics this method may describe. Anything else is a mislabeled figure. */
  readonly allowedMetrics: readonly MetricId[];
  readonly description: string;
}

const METHOD_LIST = [
  {
    id: 'nominal-clock',
    label: 'Nominal clock',
    allowedMetrics: ['clock-frequency'],
    description:
      'The frequency the part is specified to run at. Not a measurement of a running machine and not a boost or turbo figure.',
  },
  {
    id: 'peak-clock',
    label: 'Peak clock',
    allowedMetrics: ['clock-frequency'],
    description:
      'The highest frequency a part is specified to reach when power and thermal headroom allow, on a machine whose clock varies continuously. A ceiling rather than the rate the part holds, so it never divides into a nominal clock: a GeForce boost clock and a console’s "up to" frequency answer the same question as each other and a different one from a fixed specified frequency.',
  },
  {
    id: 'theoretical-peak',
    label: 'Theoretical peak',
    allowedMetrics: [
      'peak-fp32-rate',
      'peak-fp64-rate',
      'peak-fp16-rate',
      'memory-bandwidth',
      'native-instruction-rate',
      'pixel-fill-rate',
      'texel-fill-rate',
    ],
    description:
      'An upper bound computed from unit count, clock and work per cycle, whoever published it. No workload ever reaches it, so it is never interchangeable with a benchmarked result.',
  },
  {
    id: 'design-capacity',
    label: 'Design capacity',
    allowedMetrics: [
      'memory-capacity',
      'memory-capacity-words',
      'memory-bus-width',
      'storage-capacity',
    ],
    description:
      'A capacity or interface width fixed by the design of the machine, as fitted. Not a maximum the machine could be expanded to.',
  },
  {
    id: 'rated-power',
    label: 'Rated power',
    allowedMetrics: ['rated-power-consumption', 'thermal-design-power'],
    description:
      'A power figure the maker specifies without a reproducible workload, a supply rating or a cooling-design target. Never a measured draw.',
  },
  {
    id: 'nameplate-rating',
    label: 'Nameplate rating',
    allowedMetrics: ['supply-voltage', 'supply-current'],
    description:
      'A voltage or a current as printed on a power supply’s rating plate or listed in its technical characteristics. It describes what the supply delivers, not what the machine draws, and an adapter with two output modes yields one pair of figures per mode.',
  },
  {
    id: 'nominal-transfer-rate',
    label: 'Nominal transfer rate',
    allowedMetrics: ['memory-transfer-rate'],
    description:
      'The transfers per second a memory interface is specified to run at, as fitted. A specification of the interface rather than a measurement of traffic across it.',
  },
  {
    id: 'die-specification',
    label: 'Die specification',
    allowedMetrics: ['transistor-count', 'process-node'],
    description:
      'A stated property of the die itself: how many transistors it holds, which process named it. Both describe the whole chip, not one block on it.',
  },
  {
    id: 'nominal-cycle-time',
    label: 'Nominal cycle time',
    allowedMetrics: ['memory-cycle-time'],
    description:
      'The specified duration of one complete memory cycle, the timing unit whole instruction times are multiples of on a core-memory machine.',
  },
  {
    id: 'add-instruction',
    label: 'Addition instruction',
    allowedMetrics: ['instruction-execution-time'],
    description:
      'Time to execute the machine’s add instruction. Which instruction is timed is part of the method, so an addition never divides into a multiplication.',
  },
  {
    id: 'multiply-instruction',
    label: 'Multiplication instruction',
    allowedMetrics: ['instruction-execution-time'],
    description: 'Time to execute the machine’s multiply instruction.',
  },
  {
    id: 'divide-instruction',
    label: 'Division instruction',
    allowedMetrics: ['instruction-execution-time'],
    description: 'Time to execute the machine’s divide instruction.',
  },
  {
    id: 'instruction-mix',
    label: 'Instruction mix',
    allowedMetrics: ['native-instruction-rate'],
    description:
      'A rate obtained by running a stated mix of instructions, so it reflects real instruction timings rather than the fastest one.',
  },
  {
    id: 'tensor-core-peak',
    label: 'Tensor core peak',
    allowedMetrics: ['peak-fp32-rate', 'peak-fp64-rate', 'peak-fp16-rate'],
    description:
      'Theoretical peak of a dedicated matrix engine rather than the general vector units. A different execution path on the same die, and therefore a different question about the hardware.',
  },
  {
    id: 'tensor-core-sparsity-peak',
    label: 'Tensor core peak with sparsity',
    allowedMetrics: ['peak-fp32-rate', 'peak-fp64-rate', 'peak-fp16-rate'],
    description:
      'Tensor engine peak claimed with structured sparsity, which doubles the headline figure for weights half of whose values are zero. Only reachable by workloads shaped that way.',
  },
  {
    id: 'matrix-multiplication-peak',
    label: 'Matrix instruction peak',
    allowedMetrics: ['peak-fp32-rate', 'peak-fp64-rate'],
    description:
      'Peak reached only by a dedicated matrix or vector instruction, quoted without the precision or the operation count it assumes.',
  },
  {
    id: 'estimate-from-formula',
    label: 'Estimate from a stated formula',
    // Any metric: an estimate is a way of arriving at a number, not a kind of
    // number. The sourcing rule, not a narrow list, determines whether it is accepted.
    allowedMetrics: METRIC_IDS,
    description:
      'A figure somebody else computed from stated inputs, published with the formula or the procedure it came from. Never this project’s own arithmetic, that is a derived claim, and never a guess: without a citable method the figure does not exist.',
  },
  {
    id: 'benchmark-run',
    label: 'Benchmark run',
    allowedMetrics: [
      'dhrystone-mips',
      'dhrystone-mips-per-mhz',
      'sustained-fp64-rate',
      'sustained-fp40-rate',
      'geekbench-score',
      'geekbench-compute-score',
    ],
    description:
      'One published run of a named benchmark on a stated machine, operating system and compiler. The benchmark identity carries the version, so this method never mixes suites; what it asserts is that somebody ran the program and reported what came out, which is a different claim from a rate computed off a specification.',
  },
  {
    id: 'benchmark-chart-average',
    label: 'Benchmark chart average',
    allowedMetrics: ['geekbench-score', 'geekbench-compute-score'],
    description:
      'The mean of every result a benchmark’s publisher holds for a machine, read off its own chart on a stated day. A rolling quantity rather than a run: it moves as results arrive, so a figure obtained this way is a dated snapshot and is never interchangeable with one machine’s own result.',
  },
  {
    id: 'spec-published-result',
    label: 'Published SPEC result',
    allowedMetrics: ['spec-cpu-result'],
    description:
      'A result published by SPEC for a named suite, version and base/peak run. Comparable only with results from the same suite and version, under SPEC fair-use rules.',
  },
  {
    id: 'wall-measurement',
    label: 'Wall measurement',
    allowedMetrics: ['system-power-draw'],
    description:
      'Power drawn by a complete system, measured at the supply under a stated workload. Never comparable with a component rating.',
  },
  {
    id: 'list-price',
    label: 'List price',
    allowedMetrics: ['launch-price'],
    description:
      'The price the maker asked for the machine as launched, in one named currency and one market, taken from the maker’s own announcement. Not a street price, not a bundle, not a later cut. A CPI adjustment is a separate derived claim with a frozen price-index snapshot; it never replaces this nominal figure or converts between currencies or markets.',
  },
] as const satisfies readonly MethodDefinition[];

export type MethodId = (typeof METHOD_LIST)[number]['id'];

export const METHODS: ReadonlyMap<string, MethodDefinition> = new Map(
  METHOD_LIST.map((method) => [method.id, method]),
);

export const METHOD_IDS: readonly MethodId[] = METHOD_LIST.map((method) => method.id);

export function isMethodId(value: string): value is MethodId {
  return METHODS.has(value);
}

export function getMethod(id: string): MethodDefinition | undefined {
  return METHODS.get(id);
}

/** Whether this method may describe this metric. */
export function methodAllowsMetric(method: string, metric: MetricId): boolean {
  const definition = METHODS.get(method);
  return (
    definition !== undefined && (definition.allowedMetrics as readonly string[]).includes(metric)
  );
}
