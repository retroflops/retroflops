// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Unit registry for `catalog-v1`.
 *
 * Every unit belongs to exactly one quantity, and every unit inside a quantity is
 * convertible to every other by an exact decimal factor. Quantities that must
 * never be converted into one another, instruction rates versus floating-point
 * rates, machine words versus bytes, are kept as separate quantities rather than
 * as flags on a shared one.
 *
 * Factors are decimal strings so `data:normalize` can apply them with decimal
 * arithmetic instead of binary floating point. The registry is versioned:
 * changing a factor requires bumping `UNIT_REGISTRY_VERSION` so derived claims
 * can be recomputed and re-checked.
 */

export const UNIT_REGISTRY_VERSION = 'units-v1';

/**
 * A dimension shared by mutually convertible units. Deliberately narrow: an
 * instruction rate is not a floating-point rate, and a benchmark score has no
 * dimension at all.
 */
export const QUANTITIES = [
  'frequency',
  'instruction-rate',
  'floating-point-rate',
  'pixel-rate',
  'texel-rate',
  'benchmark-score',
  'dhrystone-per-clock',
  'data-capacity',
  'machine-words',
  'data-rate',
  'transfer-rate',
  'bus-width',
  'power',
  'voltage',
  'current',
  'energy',
  'time',
  'length',
  'mass',
  'count',
  'transistor-count',
  'currency',
] as const;

export type Quantity = (typeof QUANTITIES)[number];

export interface UnitDefinition {
  /** Stable identifier used in data files. */
  readonly id: string;
  /** Short symbol for display, e.g. `MHz`. An empty symbol renders as a bare number. */
  readonly symbol: string;
  /** Full name, used for accessible labels and table headers. */
  readonly label: string;
  readonly quantity: Quantity;
  /** Exact decimal multiplier converting one of this unit into the quantity's base unit. */
  readonly toBase: string;
  /** Note for units that carry methodological baggage. */
  readonly note?: string;
}

const UNIT_LIST = [
  // Frequency. Base unit: Hz.
  { id: 'Hz', symbol: 'Hz', label: 'hertz', quantity: 'frequency', toBase: '1' },
  { id: 'kHz', symbol: 'kHz', label: 'kilohertz', quantity: 'frequency', toBase: '1000' },
  { id: 'MHz', symbol: 'MHz', label: 'megahertz', quantity: 'frequency', toBase: '1000000' },
  { id: 'GHz', symbol: 'GHz', label: 'gigahertz', quantity: 'frequency', toBase: '1000000000' },

  // Instruction rate. Base unit: instructions per second.
  {
    id: 'IPS',
    symbol: 'IPS',
    label: 'instructions per second',
    quantity: 'instruction-rate',
    toBase: '1',
  },
  {
    id: 'kIPS',
    symbol: 'kIPS',
    label: 'thousand instructions per second',
    quantity: 'instruction-rate',
    toBase: '1000',
  },
  {
    id: 'MIPS',
    symbol: 'MIPS',
    label: 'million instructions per second',
    quantity: 'instruction-rate',
    toBase: '1000000',
    note: 'Native instruction rate. The unit converts to IPS, but a MIPS figure is only comparable with another figure produced by the same method, see the comparability group.',
  },
  {
    id: 'DMIPS',
    symbol: 'DMIPS',
    label: 'Dhrystone MIPS',
    quantity: 'instruction-rate',
    toBase: '1000000',
    note: 'Dhrystone result normalized against the VAX 11/780, not a native instruction count. Only comparable within the same Dhrystone version and compiler settings.',
  },
  {
    id: 'DMIPS/MHz',
    symbol: 'DMIPS/MHz',
    label: 'Dhrystone MIPS per megahertz',
    quantity: 'dhrystone-per-clock',
    toBase: '1',
    note: 'Clock-normalized Dhrystone figure. Dimensionless by construction and never interchangeable with DMIPS. It has a quantity of its own rather than sharing one with other dimensionless scores: being unitless is not a dimension two figures can have in common.',
  },

  // Floating-point rate. Base unit: FLOP/s.
  {
    id: 'FLOP/s',
    symbol: 'FLOP/s',
    label: 'floating-point operations per second',
    quantity: 'floating-point-rate',
    toBase: '1',
  },
  {
    id: 'kFLOP/s',
    symbol: 'kFLOP/s',
    label: 'kiloFLOPS',
    quantity: 'floating-point-rate',
    toBase: '1000',
  },
  {
    id: 'MFLOP/s',
    symbol: 'MFLOP/s',
    label: 'megaFLOPS',
    quantity: 'floating-point-rate',
    toBase: '1000000',
  },
  {
    id: 'GFLOP/s',
    symbol: 'GFLOP/s',
    label: 'gigaFLOPS',
    quantity: 'floating-point-rate',
    toBase: '1000000000',
  },
  {
    id: 'TFLOP/s',
    symbol: 'TFLOP/s',
    label: 'teraFLOPS',
    quantity: 'floating-point-rate',
    toBase: '1000000000000',
  },

  // Raster fill rates, deliberately separate from FLOP/s: a texel or pixel
  // is output or sampled data, not a floating-point operation.
  {
    id: 'pixel/s',
    symbol: 'pixel/s',
    label: 'pixels per second',
    quantity: 'pixel-rate',
    toBase: '1',
  },
  {
    id: 'Mpixel/s',
    symbol: 'Mpixel/s',
    label: 'megapixels per second',
    quantity: 'pixel-rate',
    toBase: '1000000',
  },
  {
    id: 'Gpixel/s',
    symbol: 'Gpixel/s',
    label: 'gigapixels per second',
    quantity: 'pixel-rate',
    toBase: '1000000000',
  },
  {
    id: 'texel/s',
    symbol: 'texel/s',
    label: 'texels per second',
    quantity: 'texel-rate',
    toBase: '1',
  },
  {
    id: 'Mtexel/s',
    symbol: 'Mtexel/s',
    label: 'megatexels per second',
    quantity: 'texel-rate',
    toBase: '1000000',
  },
  {
    id: 'Gtexel/s',
    symbol: 'Gtexel/s',
    label: 'gigatexels per second',
    quantity: 'texel-rate',
    toBase: '1000000000',
  },

  // Benchmark score. Dimensionless and meaningful only within one benchmark version.
  {
    id: 'score',
    symbol: '',
    label: 'benchmark score',
    quantity: 'benchmark-score',
    toBase: '1',
    note: 'Dimensionless. Comparability is decided entirely by the benchmark identity and version, never by the unit.',
  },

  // Data capacity. Base unit: byte. Binary and decimal prefixes stay distinct.
  { id: 'B', symbol: 'B', label: 'byte', quantity: 'data-capacity', toBase: '1' },
  { id: 'KiB', symbol: 'KiB', label: 'kibibyte', quantity: 'data-capacity', toBase: '1024' },
  { id: 'MiB', symbol: 'MiB', label: 'mebibyte', quantity: 'data-capacity', toBase: '1048576' },
  { id: 'GiB', symbol: 'GiB', label: 'gibibyte', quantity: 'data-capacity', toBase: '1073741824' },
  { id: 'kB', symbol: 'kB', label: 'kilobyte', quantity: 'data-capacity', toBase: '1000' },
  { id: 'MB', symbol: 'MB', label: 'megabyte', quantity: 'data-capacity', toBase: '1000000' },
  { id: 'GB', symbol: 'GB', label: 'gigabyte', quantity: 'data-capacity', toBase: '1000000000' },

  // Machine words. Capacity of word-addressed machines, never auto-converted to bytes.
  {
    id: 'word',
    symbol: 'words',
    label: 'machine word',
    quantity: 'machine-words',
    toBase: '1',
    note: 'Word-addressed capacity. Converting to bytes requires the declared word width and is recorded as a derived claim, never as a unit conversion.',
  },

  // Data rate. Base unit: byte per second.
  { id: 'B/s', symbol: 'B/s', label: 'bytes per second', quantity: 'data-rate', toBase: '1' },
  {
    id: 'MB/s',
    symbol: 'MB/s',
    label: 'megabytes per second',
    quantity: 'data-rate',
    toBase: '1000000',
  },
  {
    id: 'GB/s',
    symbol: 'GB/s',
    label: 'gigabytes per second',
    quantity: 'data-rate',
    toBase: '1000000000',
  },
  {
    id: 'TB/s',
    symbol: 'TB/s',
    label: 'terabytes per second',
    quantity: 'data-rate',
    toBase: '1000000000000',
  },

  // transfer rate, base transfer per second. Separate from `data-rate` on
  // purpose: a transfer carries as many bytes as the interface is wide, so
  // transfers per second become bytes per second only through a bus width, and
  // that multiplication is a derived claim rather than a unit conversion.
  {
    id: 'T/s',
    symbol: 'T/s',
    label: 'transfers per second',
    quantity: 'transfer-rate',
    toBase: '1',
  },
  {
    id: 'MT/s',
    symbol: 'MT/s',
    label: 'megatransfers per second',
    quantity: 'transfer-rate',
    toBase: '1000000',
  },
  {
    id: 'GT/s',
    symbol: 'GT/s',
    label: 'gigatransfers per second',
    quantity: 'transfer-rate',
    toBase: '1000000000',
  },

  // Bus width. Base unit: bit.
  { id: 'bit', symbol: 'bit', label: 'bit', quantity: 'bus-width', toBase: '1' },

  // power and energy
  { id: 'W', symbol: 'W', label: 'watt', quantity: 'power', toBase: '1' },
  { id: 'kW', symbol: 'kW', label: 'kilowatt', quantity: 'power', toBase: '1000' },

  // supply rating, the two halves of a nameplate
  { id: 'V', symbol: 'V', label: 'volt', quantity: 'voltage', toBase: '1' },
  { id: 'A', symbol: 'A', label: 'ampere', quantity: 'current', toBase: '1' },
  { id: 'J', symbol: 'J', label: 'joule', quantity: 'energy', toBase: '1' },
  { id: 'Wh', symbol: 'Wh', label: 'watt hour', quantity: 'energy', toBase: '3600' },

  // time
  { id: 's', symbol: 's', label: 'second', quantity: 'time', toBase: '1' },
  { id: 'ms', symbol: 'ms', label: 'millisecond', quantity: 'time', toBase: '0.001' },
  { id: 'us', symbol: 'µs', label: 'microsecond', quantity: 'time', toBase: '0.000001' },
  { id: 'ns', symbol: 'ns', label: 'nanosecond', quantity: 'time', toBase: '0.000000001' },

  // physical
  { id: 'm', symbol: 'm', label: 'meter', quantity: 'length', toBase: '1' },
  { id: 'mm', symbol: 'mm', label: 'millimeter', quantity: 'length', toBase: '0.001' },
  { id: 'nm', symbol: 'nm', label: 'nanometer', quantity: 'length', toBase: '0.000000001' },
  { id: 'kg', symbol: 'kg', label: 'kilogram', quantity: 'mass', toBase: '1' },
  { id: 'g', symbol: 'g', label: 'gram', quantity: 'mass', toBase: '0.001' },

  // countable
  { id: 'unit', symbol: '', label: 'count', quantity: 'count', toBase: '1' },
  {
    id: 'transistor',
    symbol: 'transistors',
    label: 'transistor count',
    quantity: 'transistor-count',
    toBase: '1',
  },

  // Currency. Historical prices stay nominal until a versioned CPI snapshot exists.
  {
    id: 'USD',
    symbol: 'USD',
    label: 'United States dollar (nominal)',
    quantity: 'currency',
    toBase: '1',
    note: 'Nominal, not inflation adjusted. Comparing across years requires a versioned CPI snapshot and is recorded as a derived claim.',
  },
] as const satisfies readonly UnitDefinition[];

export type UnitId = (typeof UNIT_LIST)[number]['id'];

export const UNITS: ReadonlyMap<string, UnitDefinition> = new Map(
  UNIT_LIST.map((unit) => [unit.id, unit]),
);

export const UNIT_IDS: readonly UnitId[] = UNIT_LIST.map((unit) => unit.id);

export function isUnitId(value: string): value is UnitId {
  return UNITS.has(value);
}

export function getUnit(id: string): UnitDefinition | undefined {
  return UNITS.get(id);
}

/** Quantity of a known unit, or `undefined` for an unknown identifier. */
export function quantityOf(id: string): Quantity | undefined {
  return UNITS.get(id)?.quantity;
}

/** A unit as registered here, with its `id` narrowed to the registry's members. */
export type RegisteredUnit = (typeof UNIT_LIST)[number];

/** Base unit of a quantity. Its `toBase` factor is exactly 1. */
export function baseUnitOf(quantity: Quantity): RegisteredUnit | undefined {
  return UNIT_LIST.find((unit) => unit.quantity === quantity && unit.toBase === '1');
}

/**
 * Whether a value in `from` can be expressed in `to` by a unit conversion alone.
 * Sharing a quantity is necessary but never sufficient for comparability, that
 * decision belongs to `comparability.ts`.
 */
export function isConvertible(from: string, to: string): boolean {
  const fromUnit = UNITS.get(from);
  const toUnit = UNITS.get(to);
  return fromUnit !== undefined && toUnit !== undefined && fromUnit.quantity === toUnit.quantity;
}
