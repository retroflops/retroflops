// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCatalog } from '../catalog.ts';
import { BACKBONE, coverage, renderCoverage } from './coverage.ts';

const catalog = getCatalog();
const rows = coverage(catalog);

describe('metric coverage', () => {
  it('asks every machine the same questions', () => {
    expect(rows).toHaveLength(catalog.systems.length);
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.entry.id)).toEqual(BACKBONE.map((entry) => entry.id));
    }
  });

  it('counts a figure recorded against a part as the machine’s answer', () => {
    // The Commodore 64's capacity is recorded on its RAM and its clock on the
    // machine; a matrix that missed the first would report a gap that is not one.
    const c64 = rows.find((row) => row.systemSlug === 'commodore-64');
    const capacity = c64?.cells.find((cell) => cell.entry.id === 'memory-capacity');
    expect(capacity?.state).toBe('stated');
  });

  it('does not report a missing graphics clock for a machine with no graphics', () => {
    const agc = rows.find((row) => row.systemSlug === 'apollo-guidance-computer-block-ii');
    const gpuClock = agc?.cells.find((cell) => cell.entry.id === 'gpu-clock');
    expect(gpuClock?.state).toBe('not-applicable');
    expect(gpuClock?.note).toContain('no gpu component');
  });

  it('distinguishes a recorded absence from nothing recorded', () => {
    // The iPhone 12 GPU clock is a researched unknown, which remains an answer.
    // A gap is not.
    const iphone = rows.find((row) => row.systemSlug === 'apple-iphone-12');
    expect(iphone?.cells.find((cell) => cell.entry.id === 'gpu-clock')?.state).toBe('unknown');

    const states = new Set(rows.flatMap((row) => row.cells.map((cell) => cell.state)));
    expect(states.has('unknown')).toBe(true);
    expect(states.has('stated')).toBe(true);
    expect(states.has('not-applicable')).toBe(true);
  });

  it('reports no gaps, which is what puts this report in the quality gate', () => {
    // The report belongs in `pnpm check` only when it passes. A gate that fails
    // from the first day stops being useful.
    expect(rows.flatMap((row) => (row.gaps === 0 ? [] : [row.systemSlug]))).toEqual([]);
  });

  it('gives every recorded absence in the backbone its own words', () => {
    const silent = rows.flatMap((row) =>
      row.cells
        .filter((cell) => cell.state === 'unknown' && (cell.note ?? '') === '')
        .map((cell) => `${row.systemSlug}: ${cell.entry.id}`),
    );
    expect(silent).toEqual([]);
  });

  it('holds the line on backbone questions answered only with an unknown', () => {
    /*
     * This cap applies to the current catalog. It is not a target for new
     * records. A source audit removed every gap and left 26 of 108 backbone
     * cells recorded as "no source here states it." Later research answered
     * three of those cells. Two answers came from console instruction manuals,
     * which rate power where the maker's press releases do not. The third came
     * from arithmetic over a processor manual that documents floating-point
     * units per cycle. When research finds no source, the note records what was
     * searched.
     *
     * Recent additions account for 53 explicit absences: 48 from eight phones
     * and five from the Mac mini M4 and Raspberry Pi 5. Apple names its chips
     * but does not publish phone clocks, DRAM, bandwidth, FP32 rate, or a
     * whole-system power rating. The catalog therefore allows at most 227
     * unknown backbone cells. An archive-source review replaced 22 unsupported
     * values with recorded absences. Adding a machine must account for each new
     * unknown in this cap. An existing figure changing to `unknown` still fails.
     */
    const unknown = rows.flatMap((row) => row.cells.filter((cell) => cell.state === 'unknown'));
    expect(unknown.length).toBeLessThanOrEqual(227);
  });

  it('renders a matrix with a row per machine and a legend', () => {
    const report = renderCoverage(rows);
    expect(report).toContain('| Machine |');
    expect(report).toContain('stated ·');
    expect(report).toContain('unasked.');
    for (const row of rows) {
      expect(report).toContain(row.systemName);
    }
  });
});
