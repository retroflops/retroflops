// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Tick labels for a value axis.
 *
 * A timeline axis is drawn in the quantity's base unit, hertz, bytes, FLOP/s,
 * so its values run to ten digits and more. Written out in full, every label on
 * a modern-era chart is the same illegible run of zeros, and the differences
 * between them sit in the digits a reader has to count to find. Ticks are
 * therefore written with an SI multiplier: "3.2G" under an axis labeled "(Hz)"
 * is 3.2 GHz.
 *
 * This abbreviates a tick, never a figure. Every value as its source stated it
 * is in the table on the same page, so nothing here is the only place a number
 * can be read.
 *
 * The multiplier is chosen per tick rather than once for the whole axis,
 * because a logarithmic axis crosses several of them and no single multiplier
 * can write both ends of it.
 */

const SI_MULTIPLIERS = [
  { factor: 1e15, symbol: 'P' },
  { factor: 1e12, symbol: 'T' },
  { factor: 1e9, symbol: 'G' },
  { factor: 1e6, symbol: 'M' },
  { factor: 1e3, symbol: 'k' },
] as const;

function round(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < 1) {
    // Below one, the meaning is in the significant digits rather than in the
    // magnitude: two decimal places would round a 0.004 tick to nothing.
    return value.toLocaleString('en-GB', { maximumSignificantDigits: 2 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/** One axis tick, e.g. `0`, `1.5`, `500M`, `3.2G`. */
export function formatAxisTick(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const magnitude = Math.abs(value);
  const multiplier = SI_MULTIPLIERS.find((candidate) => magnitude >= candidate.factor);
  if (multiplier === undefined) {
    return round(value);
  }
  return `${round(value / multiplier.factor)}${multiplier.symbol}`;
}
