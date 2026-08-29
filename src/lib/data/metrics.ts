// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Metric registry for `catalog-v1`.
 *
 * A metric fixes what is being measured and in which quantity. It does not fix
 * how it was obtained, that is the measurement's method and benchmark, which
 * together with the metric and the device scope form the comparability group.
 *
 * There is deliberately no aggregate score: metrics never combine.
 */

import type { Quantity } from './units.ts';

export const METRIC_REGISTRY_VERSION = 'metrics-v1';

/** What part of a machine a figure describes. */
export const MEASUREMENT_SCOPES = ['cpu', 'gpu', 'memory', 'storage', 'whole-system'] as const;

export type MeasurementScope = (typeof MEASUREMENT_SCOPES)[number];

/** How a figure was obtained. */
export const CONFIDENCE_STATUSES = [
  'measured',
  'theoretical',
  'vendor-rated',
  'estimated',
  'derived',
] as const;

export type ConfidenceStatus = (typeof CONFIDENCE_STATUSES)[number];

/** How strongly the cited sources support a stated number. */
export const EVIDENCE_LEVELS = ['confirmed', 'reported', 'rumored'] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Editorial state of a record. `provisional` records never feed automatic multipliers. */
export const EDITORIAL_STATUSES = ['approved', 'provisional'] as const;

export type EditorialStatus = (typeof EDITORIAL_STATUSES)[number];

/**
 * Explicit absence of a figure. Never represented as zero.
 *
 * The three absences answer different questions, and only the first two say
 * anything about the machine:
 *
 * - `unknown`, the catalog asked, and no acceptable source states a value.
 *   A finding about the published record, and it must explain itself in a note.
 * - `not-applicable`, the quantity does not exist for this machine.
 * - `unverified`, a source is cited and nobody here has read the page yet.
 *   A statement about this project's work, never about the machine. It must
 *   never claim what the unread source contains, and it counts as a gap rather
 *   than an answer, so recording one can never green a completeness check.
 */
export const VALUE_ABSENCES = ['unknown', 'not-applicable', 'unverified'] as const;

export type ValueAbsence = (typeof VALUE_ABSENCES)[number];

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly quantity: Quantity;
  readonly allowedScopes: readonly MeasurementScope[];
  /**
   * Whether a ratio between two figures of this metric is meaningful at all.
   * False for interval-like or descriptive metrics where "twice as much" says
   * nothing useful, such as a process node or a release-era price.
   */
  readonly allowsRatio: boolean;
  /** Whether a logarithmic axis is mathematically valid (strictly positive ratio scale). */
  readonly allowsLogScale: boolean;
  /** True when the figure is meaningless without a named benchmark and version. */
  readonly requiresBenchmark: boolean;
  /** Direction that counts as "more", used for labels rather than any ranking. */
  readonly higherIsBetter: boolean | null;
  readonly description: string;
}

const METRIC_LIST = [
  {
    id: 'clock-frequency',
    label: 'Clock frequency',
    quantity: 'frequency',
    allowedScopes: ['cpu', 'gpu', 'memory'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Nominal operating clock. Says nothing about work done per cycle and must never be used as a proxy for performance across architectures.',
  },
  {
    id: 'native-instruction-rate',
    label: 'Native instruction rate',
    quantity: 'instruction-rate',
    allowedScopes: ['cpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Instructions executed per second on the machine’s own instruction set. Not comparable across instruction sets, and never interchangeable with Dhrystone-derived figures.',
  },
  {
    id: 'dhrystone-mips',
    label: 'Dhrystone MIPS',
    quantity: 'instruction-rate',
    allowedScopes: ['cpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Dhrystone result expressed in VAX 11/780 MIPS. Comparable only within the same Dhrystone version, compiler and settings.',
  },
  {
    id: 'dhrystone-mips-per-mhz',
    label: 'Dhrystone MIPS per MHz',
    quantity: 'dhrystone-per-clock',
    allowedScopes: ['cpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description: 'Clock-normalized Dhrystone figure. Never interchangeable with DMIPS itself.',
  },
  {
    id: 'peak-fp32-rate',
    label: 'Peak FP32 rate',
    quantity: 'floating-point-rate',
    allowedScopes: ['cpu', 'gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Theoretical single-precision peak from unit count, clock and operations per cycle. An upper bound, not an achieved rate.',
  },
  {
    id: 'peak-fp64-rate',
    label: 'Peak FP64 rate',
    quantity: 'floating-point-rate',
    allowedScopes: ['cpu', 'gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description: 'Theoretical double-precision peak. Never comparable with an FP32 or FP16 peak.',
  },
  {
    id: 'peak-fp16-rate',
    label: 'Peak FP16 rate',
    quantity: 'floating-point-rate',
    allowedScopes: ['gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description: 'Theoretical half-precision peak, frequently quoted with vendor-specific caveats.',
  },
  {
    id: 'pixel-fill-rate',
    label: 'Pixel fill rate',
    quantity: 'pixel-rate',
    allowedScopes: ['gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Theoretical raster-output rate in pixels per second. It describes fixed-function pixel output, not programmable floating-point shader throughput.',
  },
  {
    id: 'texel-fill-rate',
    label: 'Texel fill rate',
    quantity: 'texel-rate',
    allowedScopes: ['gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Theoretical texture-sampling rate in texels per second. It is a fixed-function-era rendering measure and must never stand in for a floating-point rate.',
  },
  {
    id: 'sustained-fp64-rate',
    label: 'Sustained FP64 rate',
    quantity: 'floating-point-rate',
    allowedScopes: ['cpu', 'gpu', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Measured double-precision throughput under a named benchmark, such as HPL. Always below the theoretical peak.',
  },
  {
    id: 'sustained-fp40-rate',
    label: 'Sustained FP40 rate',
    quantity: 'floating-point-rate',
    allowedScopes: ['cpu', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Measured throughput of a five-byte, 40-bit floating-point format under a named benchmark. It records ROM BASIC implementations without relabeling their non-IEEE format as FP32 or FP64.',
  },
  {
    id: 'spec-cpu-result',
    label: 'SPEC CPU result',
    quantity: 'benchmark-score',
    allowedScopes: ['cpu', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Published SPEC CPU result. Suite, version, base/peak and compiler settings all form part of the comparability group, and SPEC fair-use rules apply to any quotation.',
  },
  {
    id: 'geekbench-score',
    label: 'Geekbench score',
    quantity: 'benchmark-score',
    allowedScopes: ['cpu', 'gpu', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Geekbench result for a named major version and run variant. A single-core and a multi-core score answer different questions and the variant is part of the benchmark identity, so they never divide into each other; neither does a version 5 score into a version 6 one, because the suite was rebalanced between them.',
  },
  {
    id: 'geekbench-compute-score',
    label: 'Geekbench Compute score',
    quantity: 'benchmark-score',
    allowedScopes: ['gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: true,
    description:
      'Geekbench Compute result for a named major version and graphics API. The API is part of the benchmark identity, because a Metal run and an OpenCL run execute different code against different drivers, and so is the version. It is a separate metric from the processor score rather than a variant of it: version 7 calibrates a compute result against a baseline of 100,000 and a processor result against 2,500, so the two are not one quantity even when one machine reports both.',
  },
  {
    id: 'memory-capacity',
    label: 'Memory capacity',
    quantity: 'data-capacity',
    allowedScopes: ['memory', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: null,
    description: 'Installed byte-addressed memory of the stated kind.',
  },
  {
    id: 'memory-capacity-words',
    label: 'Memory capacity (words)',
    quantity: 'machine-words',
    allowedScopes: ['memory', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Capacity of a word-addressed machine. Converting to bytes needs the declared word width and is published as a derived claim.',
  },
  {
    id: 'memory-bandwidth',
    label: 'Memory bandwidth',
    quantity: 'data-rate',
    allowedScopes: ['memory', 'gpu', 'whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Peak or measured transfer rate. Theoretical bus bandwidth and benchmarked bandwidth belong to different comparability groups.',
  },
  {
    id: 'memory-transfer-rate',
    label: 'Memory transfer rate',
    quantity: 'transfer-rate',
    allowedScopes: ['memory', 'gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: true,
    description:
      'Transfers per second the fitted memory is specified to run at, the MT/s figure on a memory specification. It is not a bandwidth: how many bytes a transfer carries depends on the width of the interface, so the two never share a row and the multiplication between them is a derived claim.',
  },
  {
    id: 'memory-bus-width',
    label: 'Memory bus width',
    quantity: 'bus-width',
    allowedScopes: ['memory', 'gpu'],
    allowsRatio: true,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: null,
    description: 'Width of the memory interface in bits.',
  },
  {
    id: 'storage-capacity',
    label: 'Storage capacity',
    quantity: 'data-capacity',
    allowedScopes: ['storage'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Capacity of the mass storage fitted to the machine, flash, disk, cartridge. Shares a quantity with memory capacity and answers a different question, so the two never share a row: one is where a program runs, the other is where it is kept. Makers state storage decimally, unlike memory, and the figure is recorded in the unit the source used.',
  },
  {
    id: 'thermal-design-power',
    label: 'Thermal design power',
    quantity: 'power',
    allowedScopes: ['cpu', 'gpu'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: false,
    description:
      'Vendor cooling-design figure. Defined differently by each vendor and across eras, so it is reported but never turned into a multiplier.',
  },
  {
    id: 'system-power-draw',
    label: 'Whole-system power draw',
    quantity: 'power',
    allowedScopes: ['whole-system'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: true,
    higherIsBetter: false,
    description:
      'Measured wall power of a complete system under a stated workload. Never comparable with a component TDP.',
  },
  {
    id: 'rated-power-consumption',
    label: 'Rated power consumption',
    quantity: 'power',
    allowedScopes: ['cpu', 'gpu', 'whole-system'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: false,
    description:
      'Power consumption a device was designed or specified to draw, stated without a reproducible workload. This is the usual historic power figure, the Apollo Guidance Computer’s 70 W, a console power-supply rating, and it is neither a cooling-design target nor a measured wall draw, so it is reported but never turned into a multiplier.',
  },
  {
    id: 'supply-voltage',
    label: 'Supply voltage',
    quantity: 'voltage',
    allowedScopes: ['whole-system'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Output voltage a machine’s power supply is rated at. Recorded because it is often half of what a maker published instead of a wattage, a console specification that says “DC12V x 3.25A” and nothing else, and a figure that only exists to be multiplied still has to be citable on its own. Never a performance figure, so it never forms a multiplier.',
  },
  {
    id: 'supply-current',
    label: 'Supply current',
    quantity: 'current',
    allowedScopes: ['whole-system'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Output current a machine’s power supply is rated at, the other half of a nameplate rating. Like the voltage it stands beside, it is reported and never turned into a multiplier.',
  },
  {
    id: 'memory-cycle-time',
    label: 'Memory cycle time',
    quantity: 'time',
    allowedScopes: ['cpu', 'memory'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: false,
    description:
      'Time for one complete memory read/write cycle. The fundamental timing unit of a core-memory machine, whose instruction times are whole multiples of it.',
  },
  {
    id: 'instruction-execution-time',
    label: 'Instruction execution time',
    quantity: 'time',
    allowedScopes: ['cpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: false,
    description:
      'Time to execute one named instruction. Which instruction it is forms part of the method, so an addition time and a multiplication time are never in the same comparability group.',
  },
  {
    id: 'transistor-count',
    label: 'Transistor count',
    quantity: 'transistor-count',
    allowedScopes: ['cpu', 'gpu'],
    allowsRatio: true,
    allowsLogScale: true,
    requiresBenchmark: false,
    higherIsBetter: null,
    description: 'Vendor-stated transistor count for the die.',
  },
  {
    id: 'process-node',
    label: 'Process node',
    quantity: 'length',
    allowedScopes: ['cpu', 'gpu'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Marketing node name expressed as a length. Modern node names are not physical dimensions, so ratios between them are meaningless.',
  },
  {
    id: 'launch-price',
    label: 'Launch price',
    quantity: 'currency',
    allowedScopes: ['whole-system', 'cpu', 'gpu'],
    allowsRatio: false,
    allowsLogScale: false,
    requiresBenchmark: false,
    higherIsBetter: null,
    description:
      'Nominal launch price in the stated currency and market. A frozen CPI snapshot may restate a U.S. dollar price as a separate derived figure; it does not change the launch price itself.',
  },
] as const satisfies readonly MetricDefinition[];

export type MetricId = (typeof METRIC_LIST)[number]['id'];

export const METRICS: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_LIST.map((metric) => [metric.id, metric]),
);

export const METRIC_IDS: readonly MetricId[] = METRIC_LIST.map((metric) => metric.id);

export function isMetricId(value: string): value is MetricId {
  return METRICS.has(value);
}

export function getMetric(id: string): MetricDefinition | undefined {
  return METRICS.get(id);
}
