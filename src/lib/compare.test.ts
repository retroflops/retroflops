// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCatalog } from './catalog.ts';
import {
  buildComparison,
  COMPARE_MAX_SUBJECTS,
  compareOptions,
  formatCompareQuery,
  parseCompareQuery,
  resolveSelection,
  type CompareMetricBlock,
  type CompareRow,
  type Comparison,
  type GlanceRow,
} from './compare.ts';
import { BACKBONE } from './data/coverage.ts';

/**
 * These run against the published export rather than a fixture. The engine's job
 * is to be right about the catalog that exists, and a fixture would let a
 * comparison pass here while producing nonsense on the site.
 */
const catalog = getCatalog();

function comparison(...tokens: readonly string[]): Comparison {
  return buildComparison(catalog, parseCompareQuery(`systems=${tokens.join(',')}`));
}

function findRow(result: Comparison, group: string): CompareRow {
  const row = result.sections
    .flatMap((section) => section.blocks)
    .flatMap((block) => block.rows)
    .find((candidate) => candidate.group === group);
  if (row === undefined) {
    throw new Error(`no row for group ${group}; got ${rowGroups(result).join(', ')}`);
  }
  return row;
}

function rowGroups(result: Comparison): readonly string[] {
  return result.sections
    .flatMap((section) => section.blocks)
    .flatMap((block) => block.rows)
    .map((row) => row.group);
}

function blocks(result: Comparison): readonly CompareMetricBlock[] {
  return result.sections.flatMap((section) => section.blocks);
}

function glanceRow(result: Comparison, id: string): GlanceRow {
  const row = result.glance.find((candidate) => candidate.id === id);
  if (row === undefined) {
    throw new Error(`no card row ${id}; got ${result.glance.map((entry) => entry.id).join(', ')}`);
  }
  return row;
}

describe('compare query string', () => {
  it('round-trips a selection of systems and variants', () => {
    const entries = parseCompareQuery('?systems=commodore-64@pal,amiga-500@pal');
    expect(entries).toEqual([
      { kind: 'system', slug: 'commodore-64', configurationId: 'pal' },
      { kind: 'system', slug: 'amiga-500', configurationId: 'pal' },
    ]);
    expect(formatCompareQuery(entries)).toBe('?systems=commodore-64@pal,amiga-500@pal');
  });

  it('keeps systems and components in separate parameters', () => {
    const entries = parseCompareQuery('?components=mos-6510,motorola-68000');
    expect(entries.every((entry) => entry.kind === 'component')).toBe(true);
    expect(formatCompareQuery(entries)).toBe('?components=mos-6510,motorola-68000');
  });

  it('ignores empty tokens rather than inventing records', () => {
    expect(parseCompareQuery('?systems=,,')).toEqual([]);
    expect(formatCompareQuery([])).toBe('');
  });
});

describe('comparison selector', () => {
  it('finds PlayStations by an editorial alias while keeping canonical names', () => {
    const options = compareOptions(catalog);
    const aliases = new Map(
      [
        'sony-playstation',
        'sony-playstation-2',
        'sony-playstation-3',
        'sony-playstation-4',
        'sony-playstation-5',
      ].map((slug) => [slug, options.find((option) => option.slug === slug)?.search]),
    );

    expect(aliases.get('sony-playstation')).toContain('ps1');
    expect(aliases.get('sony-playstation')).toContain('psx');
    expect(aliases.get('sony-playstation-2')).toContain('ps2');
    expect(aliases.get('sony-playstation-3')).toContain('ps3');
    expect(aliases.get('sony-playstation-4')).toContain('ps4');
    expect(aliases.get('sony-playstation-5')).toContain('ps5');
  });

  it('finds the Nintendo consoles by their short names', () => {
    const options = compareOptions(catalog);
    const search = (slug: string): string | undefined =>
      options.find((option) => option.slug === slug)?.search;

    expect(search('nintendo-entertainment-system')).toContain('nes');
    expect(search('super-nintendo')).toContain('snes');
  });
});

describe('selection', () => {
  it('reports a slug that does not exist', () => {
    const { problems } = resolveSelection(catalog, [
      { kind: 'system', slug: 'amiga-500' },
      { kind: 'system', slug: 'atari-st' },
    ]);
    expect(problems).toContainEqual({ code: 'unknown-record', kind: 'system', slug: 'atari-st' });
  });

  it('reports a variant that does not exist, and keeps the record', () => {
    const { subjects, problems } = resolveSelection(catalog, [
      { kind: 'system', slug: 'amiga-500', configurationId: 'secam' },
      { kind: 'system', slug: 'commodore-64', configurationId: 'pal' },
    ]);
    expect(problems).toContainEqual({
      code: 'unknown-configuration',
      slug: 'amiga-500',
      configurationId: 'secam',
    });
    expect(subjects).toHaveLength(2);
  });

  it('refuses a mix of systems and components', () => {
    const { problems } = resolveSelection(catalog, [
      { kind: 'system', slug: 'amiga-500' },
      { kind: 'component', slug: 'mos-6510' },
    ]);
    expect(problems).toContainEqual({ code: 'mixed-kinds' });
  });

  it('refuses fewer than two and more than four records', () => {
    expect(resolveSelection(catalog, [{ kind: 'system', slug: 'amiga-500' }]).problems).toEqual([
      { code: 'too-few', count: 1 },
    ]);

    const five = [
      'amiga-500',
      'commodore-64',
      'amiga-1200',
      'sony-playstation',
      'sony-playstation-2',
    ].map((slug) => ({ kind: 'system' as const, slug }));
    expect(resolveSelection(catalog, five).problems).toContainEqual({ code: 'too-many', count: 5 });
    expect(COMPARE_MAX_SUBJECTS).toBe(4);
  });

  it('reports the same record selected twice', () => {
    const { problems } = resolveSelection(catalog, [
      { kind: 'system', slug: 'amiga-500' },
      { kind: 'system', slug: 'amiga-500' },
    ]);
    expect(problems).toContainEqual({ code: 'repeated-record', slug: 'amiga-500' });
  });

  it('produces no rows at all when the selection is unusable', () => {
    const result = buildComparison(catalog, [{ kind: 'system', slug: 'amiga-500' }]);
    expect(result.sections).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});

describe('rows and sections', () => {
  it('gathers a system’s own figures and those of its parts', () => {
    const result = comparison('commodore-64@pal', 'amiga-500@pal');
    // The clock is recorded on the machine, the RAM capacity on the memory part.
    expect(rowGroups(result)).toContain('clock-frequency|cpu|nominal-clock');
    expect(rowGroups(result)).toContain('memory-capacity|memory|design-capacity');
  });

  it('sorts a figure into the section its quantity belongs to', () => {
    const result = comparison('sony-playstation-2@retail', 'apple-mac-mini-m1@8gb');
    const sections = result.sections.map((section) => section.id);
    // A clock belongs to processing; a power rating to energy, whatever scope it
    // was recorded at. Sections keep their order and never merge into a total.
    expect(sections).toEqual(['processing', 'graphics', 'memory', 'energy']);
    const energy = result.sections.at(-1);
    expect(energy?.blocks.map((block) => block.metric)).toEqual(['rated-power-consumption']);

    const memory = comparison('sony-playstation-2@retail', 'sony-playstation-3@launch');
    expect(memory.sections.map((section) => section.id)).toContain('memory');
  });

  it('drops a quantity only one of the records states at all', () => {
    // Only the M1 has a transistor count, and the PlayStation 2 states nothing
    // of that metric at any scope, so a row for it would compare nothing.
    const result = comparison('apple-mac-mini-m1@8gb', 'sony-playstation-2@retail');
    expect(blocks(result).map((block) => block.metric)).not.toContain('transistor-count');
  });

  it('keeps a quantity both records state at different scopes', () => {
    // The Commodore 64 records 64 KiB against its memory chip; the PlayStation 4
    // records 8 GiB for the whole machine. Two scopes, so two rows and no
    // multiplier, but dropping the older row would hide that both machines
    // answered the question, which is the one thing the reader is here for.
    const result = comparison('commodore-64@pal', 'sony-playstation-4@launch');
    const capacity = blocks(result).filter((block) => block.metric === 'memory-capacity');
    expect(capacity.map((block) => block.scope).toSorted()).toEqual(['memory', 'whole-system']);
    const texts = capacity.flatMap((block) =>
      block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.figures.map((f) => f.text))),
    );
    // The figures carry a no-break space between number and unit.
    expect(texts.map((text) => text.replace(/\s/g, ' '))).toEqual(
      expect.arrayContaining(['64 KiB', '8 GiB']),
    );
  });

  it('shows a clock the vendor never published without a duplicate silence', () => {
    // Sony states no frequency for the PlayStation 4; two independent
    // publications do. Provenance is not part of the comparability group, so the
    // independent figure lands in the same row as every other nominal clock,
    // and the recorded silence rides along as a marker rather than a rival.
    const result = comparison('sony-playstation@retail', 'sony-playstation-4@launch');
    const clock = blocks(result).find(
      (block) => block.metric === 'clock-frequency' && block.scope === 'cpu',
    );
    const cell = clock?.rows[0]?.cells[1];
    const stated = cell?.figures.filter((figure) => !figure.absent) ?? [];
    expect(stated).toHaveLength(1);
    expect(stated[0]?.text).toContain('1.6');
    expect(stated[0]?.measurement.provenance).toBe('independent');
    expect(cell?.figures.some((figure) => figure.absent)).toBe(false);
    expect(cell?.ratio).toBeDefined();
  });

  it('gives a machine with unified memory a row it can appear in', () => {
    // The report behind this: four PlayStations side by side, and the newest one
    // blank in almost every row, because the older three split memory into a
    // main and a video pool and the PlayStation 4 has one pool for everything.
    // The machine-level row is where they meet.
    const result = comparison(
      'sony-playstation',
      'sony-playstation-2@retail',
      'sony-playstation-3@launch',
      'sony-playstation-4@launch',
    );
    const machineLevel = blocks(result).find(
      (block) => block.metric === 'memory-bandwidth' && block.scope === 'whole-system',
    );
    const cells = machineLevel?.rows[0]?.cells ?? [];
    expect(cells[1]?.figures[0]?.text).toContain('3.2');
    expect(cells[2]?.figures[0]?.text).toContain('25.6');
    expect(cells[3]?.figures[0]?.text).toContain('176');
  });

  it('says a machine is built differently rather than that nothing was recorded', () => {
    const result = comparison('sony-playstation-2@retail', 'sony-playstation-4@launch');
    const videoMemory = blocks(result).find(
      (block) => block.metric === 'memory-bandwidth' && block.role === 'video-memory',
    );
    const ps4 = videoMemory?.rows[0]?.cells[1];
    expect(ps4?.figures).toHaveLength(0);
    // Not "not recorded": the figure exists, under the role this machine uses
    // and again at the level of the whole machine.
    expect(ps4?.statedAs).toContainEqual({ kind: 'role', role: 'unified-memory' });
    expect(ps4?.statedAs).toContainEqual({ kind: 'whole-system' });
  });

  it('points a pool row at the machine-level figure instead of saying nothing', () => {
    // The PlayStation 4 records its capacity once, for the machine. In the rows
    // about the older consoles' main and video pools it has nothing to put, but
    // "not recorded" would be false, and the reader would conclude the newest
    // machine states no memory at all.
    const result = comparison('sony-playstation-2@retail', 'sony-playstation-4@launch');
    const pools = blocks(result).filter(
      (block) => block.metric === 'memory-capacity' && block.scope === 'memory',
    );
    expect(pools.length).toBeGreaterThan(0);
    for (const block of pools) {
      expect(block.rows[0]?.cells[1]?.statedAs).toContainEqual({ kind: 'whole-system' });
    }
  });

  it('keeps both capacity rows when one machine counts words and the other bytes', () => {
    // The Apollo Guidance Computer states its memory in machine words and the
    // H100 in bytes, and the two never convert, the word width is not a
    // property of the units. Keyed by metric alone, each was the only column
    // stating its own metric and both rows were dropped, so the reader saw
    // nothing where the answer is "both state it, in quantities that do not
    // convert". Two rows now, in two blocks, each saying what it is.
    const result = comparison('apollo-guidance-computer-block-ii@block-ii', 'nvidia-h100-sxm@sxm');
    const capacity = blocks(result).filter((block) => block.metric.startsWith('memory-capacity'));
    expect(capacity.map((block) => block.metric)).toContain('memory-capacity');
    expect(capacity.map((block) => block.metric)).toContain('memory-capacity-words');
    expect(capacity.every((block) => block.incomparable)).toBe(true);
  });

  it('never points a clock row at a figure about another part', () => {
    // Scope usually means a different part of the machine, not a coarser view of
    // it: a processor clock does not answer a question about a graphics clock.
    const result = comparison('sony-playstation@retail', 'sony-playstation-2@retail');
    const gpuClock = blocks(result).find(
      (block) => block.metric === 'clock-frequency' && block.scope === 'gpu',
    );
    // The PlayStation records the absence, its manual times one chip of the
    // three that do the 3D work, so the cell holds a recorded silence and not
    // a value. What it must never hold is the machine's processor clock.
    expect(gpuClock?.rows[0]?.cells[0]?.figures.every((figure) => figure.absent)).toBe(true);
    expect(gpuClock?.rows[0]?.cells[0]?.statedAs).toBeUndefined();
  });

  it('pairs a figure recorded on a machine with one recorded on a part', () => {
    // Apple states the Mac mini's memory on the machine, Sony states the
    // PlayStation 4's on the memory itself. Same metric, scope, method and
    // unit: the role is a tie-breaker for a record holding several figures in
    // one group, and neither of these does, so they belong in one row.
    const result = comparison('apple-mac-mini-m1@8gb', 'sony-playstation-4@launch');
    const capacity = blocks(result).filter(
      (block) => block.metric === 'memory-capacity' && block.scope === 'whole-system',
    );
    expect(capacity).toHaveLength(1);
    expect(capacity[0]?.rows).toHaveLength(1);
    expect(capacity[0]?.rows[0]?.statedCount).toBe(2);
    expect(capacity[0]?.rows[0]?.cells[1]?.ratio?.text).toBe('1×');
  });

  it('keeps a lone row when the other record states the quantity differently', () => {
    // The Nintendo 64 has one unified pool, the Dreamcast three separate ones.
    // Neither pairs off, and that mismatch is the finding worth showing.
    const result = comparison('nintendo-64@retail', 'sega-dreamcast@retail');
    const pools = blocks(result).filter(
      (block) => block.metric === 'memory-capacity' && block.scope === 'memory',
    );
    expect(pools.length).toBeGreaterThan(1);
    expect(pools.every((block) => block.incomparable)).toBe(true);
  });

  it('pairs figures by the part’s role rather than by the group alone', () => {
    // Both consoles hold main and video memory in one comparability group;
    // pairing main against video would answer a question nobody asked.
    const result = comparison('sony-playstation-2@retail', 'sony-playstation-3@launch');
    const capacity = blocks(result).filter(
      (block) => block.metric === 'memory-capacity' && block.role !== undefined,
    );
    expect(capacity.map((block) => block.role).toSorted()).toEqual([
      'system-memory',
      'video-memory',
    ]);
    const ratios = capacity.flatMap((block) =>
      block.rows.flatMap((row) => row.cells.map((cell) => cell.ratio?.text)),
    );
    expect(ratios).toContain('8×');
    expect(ratios).toContain('60×');
  });

  it('never puts two methods in one row', () => {
    const result = comparison('sony-playstation-2@retail', 'sony-playstation-3@launch');
    for (const row of blocks(result).flatMap((block) => block.rows)) {
      const methods = new Set(
        row.cells.flatMap((cell) => cell.figures.map((figure) => figure.measurement.method)),
      );
      expect(methods.size).toBe(1);
    }
  });
});

describe('multipliers', () => {
  it('divides two figures from one comparability group, against the first column', () => {
    const result = comparison('commodore-64@pal', 'commodore-64@ntsc');
    const row = findRow(result, 'clock-frequency|cpu|nominal-clock');
    const ratio = row.cells[1]?.ratio;
    // 1.02273 ÷ 0.98525, reported to the five digits the PAL figure carries.
    expect(ratio?.text).toBe('1.0380×');
    expect(ratio?.significantDigits).toBe(5);
    expect(ratio?.formula).toEqual({ id: 'ratio', version: '1' });
    expect(ratio?.sourceIds.length).toBeGreaterThan(0);
    expect(ratio?.caveat).toContain('clock-frequency');
    // Numerator first: the multiplier reads as "the NTSC machine over the PAL one".
    expect(ratio?.inputs[0]?.text).toContain('1.02273');
    expect(ratio?.inputs[1]?.text).toContain('0.98525');
  });

  it('leaves the baseline column without a multiplier of its own', () => {
    const result = comparison('commodore-64@pal', 'commodore-64@ntsc');
    const row = findRow(result, 'clock-frequency|cpu|nominal-clock');
    expect(row.cells[0]?.ratio).toBeUndefined();
    expect(row.cells[0]?.ratioRefusals).toEqual([]);
  });

  it('withholds a multiplier when a record states the figure once per variant', () => {
    // Neither machine has a variant chosen, so "the" clock of each is two clocks.
    const result = comparison('commodore-64', 'amiga-500');
    const row = findRow(result, 'clock-frequency|cpu|nominal-clock');
    expect(row.cells[1]?.ratio).toBeUndefined();
    expect(row.cells[1]?.ratioRefusals).toContain('variant-ambiguous');
  });

  it('withholds a multiplier when a machine has several parts in one role', () => {
    // The Commodore 64's RAM and ROM are both system memory, so "its memory
    // capacity" is two figures and there is nothing single to divide.
    const result = comparison('commodore-64@pal', 'commodore-64@ntsc');
    const row = findRow(result, 'memory-capacity|memory|design-capacity');
    expect(row.cells[1]?.ratio).toBeUndefined();
    expect(row.cells[1]?.ratioRefusals).toContain('several-parts');
  });

  it('withholds a multiplier for a metric that forbids ratios', () => {
    // Both machines state a rated power draw, and both are approved: the refusal
    // is the metric's own, because a design rating has no reproducible workload.
    const result = comparison('apollo-guidance-computer-block-ii@block-ii', 'saturn-lvdc');
    const row = findRow(result, 'rated-power-consumption|whole-system|rated-power');
    expect(row.statedCount).toBe(2);
    expect(row.cells[1]?.ratio).toBeUndefined();
    expect(row.cells[1]?.ratioRefusals).toContain('metric-forbids-ratio');
  });

  it('withholds a multiplier when either figure is provisional', () => {
    // The Nintendo 64's RCP clock comes from a damaged scan and is provisional.
    const result = comparison('nintendo-64@retail', 'sega-dreamcast@retail');
    const row = findRow(result, 'clock-frequency|gpu|nominal-clock');
    expect(row.statedCount).toBe(2);
    expect(row.cells[1]?.ratio).toBeUndefined();
    expect(row.cells[1]?.ratioRefusals).toContain('provisional-record');
  });

  it('withholds a multiplier when a figure is recorded as unknown', () => {
    // The iPhone 12 GPU clock remains a researched unknown, so a comparison
    // against it has nothing to divide by and names the missing baseline.
    const result = comparison('apple-iphone-12@retail', 'sony-playstation-2@retail');
    const row = findRow(result, 'clock-frequency|gpu|nominal-clock');
    expect(row.cells[0]?.figures[0]?.absent).toBe(true);
    expect(row.cells[1]?.ratioRefusals).toContain('baseline-has-no-value');
  });

  it('withholds a multiplier when one machine answers the question twice', () => {
    // Four of the M1's eight cores run at 3.2 GHz and four at 2.064 GHz, so the
    // machine has no single clock to divide. Both figures reach the row the
    // Commodore 64's clock is in, the part is not part of the comparability
    // group, and the refusal names the reason rather than leaving the cell
    // looking empty.
    const result = comparison('apple-mac-mini-m1@8gb', 'commodore-64@pal');
    const row = findRow(result, 'clock-frequency|cpu|nominal-clock');
    const parts = row.cells[0]?.figures.filter((figure) => !figure.absent) ?? [];
    expect(parts.map((figure) => figure.part).toSorted()).toEqual([
      'Efficiency cores',
      'Performance cores',
    ]);
    expect(row.cells[1]?.ratioRefusals).toContain('several-parts');
  });

  it('puts an announced clock beside a shipped one and still refuses the multiplier', () => {
    // Both machines state a nominal CPU clock, so there is one row rather than
    // two: the PlayStation 3's figure comes from the announcement of 2005 and is
    // protected by staying provisional, not by being filed under a method of its
    // own where the reader would never see the two numbers together.
    const result = comparison('sony-playstation-2@retail', 'sony-playstation-3@launch');
    const clock = blocks(result).find(
      (block) => block.metric === 'clock-frequency' && block.scope === 'cpu',
    );
    expect(clock?.rows.length).toBe(1);
    expect(clock?.methods).toEqual(['nominal-clock']);
    expect(clock?.incomparable).toBe(false);
    const row = clock?.rows[0];
    expect(row?.statedCount).toBe(2);
    expect(row?.ratioCount).toBe(0);
    expect(row?.cells[1]?.ratioRefusals).toContain('provisional-record');
  });

  it('never produces a multiplier across two methods of one metric', () => {
    // The Dreamcast's 1.4 GFLOPS is reached only by the SH-4's matrix
    // instruction; the PlayStation 2's 6.2 GFLOPS is a plain vector peak. Two
    // methods, so two rows, and neither divides into the other.
    const result = comparison('sega-dreamcast@retail', 'sony-playstation-2@retail');
    const peak = blocks(result).find(
      (block) => block.metric === 'peak-fp32-rate' && block.scope === 'cpu',
    );
    expect(peak?.rows.length).toBe(2);
    expect(peak?.methods).toEqual(['matrix-multiplication-peak', 'theoretical-peak']);
    expect(peak?.rows.every((row) => row.ratioCount === 0)).toBe(true);
  });
});

/**
 * A regression reported against this comparison.
 *
 * `/compare/?systems=commodore-64,apple-mac-mini-m1,sony-playstation-4` produced
 * five rows, four blocks marked incomparable and no multiplier. Removing the
 * Commodore 64 produced the same five rows because the oldest machine added
 * nothing of its own. These assertions cover each repair.
 */
describe('the reported three-machine comparison', () => {
  const reported = () => comparison('commodore-64', 'apple-mac-mini-m1', 'sony-playstation-4');

  it('lets the oldest machine contribute rows of its own', () => {
    const withC64 = reported();
    const withoutC64 = comparison('apple-mac-mini-m1', 'sony-playstation-4');
    expect(rowGroups(withC64).length).toBeGreaterThan(rowGroups(withoutC64).length);

    const stated = withC64.sections
      .flatMap((section) => section.blocks)
      .flatMap((block) => block.rows)
      .filter((row) => (row.cells[0]?.figures ?? []).some((figure) => !figure.absent));
    expect(stated.length).toBeGreaterThan(0);
  });

  it('shows one row with a value in all three columns, and a multiplier', () => {
    // Apple records capacity on the machine, Sony on the memory part, and the
    // Commodore 64 has a computed whole-system total. The result is one row,
    // three figures, and a legal multiplier between the two variants.
    const result = reported();
    const capacity = blocks(result).filter(
      (block) => block.metric === 'memory-capacity' && block.scope === 'whole-system',
    );
    expect(capacity).toHaveLength(1);
    expect(capacity[0]?.rows).toHaveLength(1);
    expect(capacity[0]?.rows[0]?.statedCount).toBe(3);
    expect(result.ratioCount).toBeGreaterThan(0);
  });

  it('keeps the Commodore 64’s memory capacity visible beside them', () => {
    // Recorded at memory scope rather than whole-system, so it cannot pair with
    // the other two, but it is shown, with the scope stated, rather than
    // silently dropped for being alone in its column.
    const capacity = blocks(reported()).filter(
      (block) => block.metric === 'memory-capacity' && block.scope === 'memory',
    );
    expect(capacity).toHaveLength(1);
    const texts = capacity
      .flatMap((block) => block.rows)
      .flatMap((row) => row.cells.flatMap((cell) => cell.figures.map((figure) => figure.text)))
      .map((text) => text.replace(/\s/g, ' '));
    expect(texts).toContain('64 KiB');
  });
});

/**
 * The catalog card and the bars.
 *
 * A reported comparison of the PlayStation 3, first-generation iPhone, and SGI
 * Octane produced twelve rows, no multiplier, and no graphic. The page only
 * described what could not be divided. These assertions cover what the card
 * answers and which rows may use a bar.
 */
describe('the catalog card', () => {
  const reported = () =>
    comparison('sony-playstation-3', 'apple-iphone-1st-generation', 'sgi-octane');

  it('asks every machine the backbone questions, in the coverage report’s own order', () => {
    // Imported, never restated: a card that declared its own six questions could
    // drift from the report that fails the build over them.
    expect(reported().glance.map((row) => row.id)).toEqual(BACKBONE.map((entry) => entry.id));
  });

  it('answers where the sections refuse to, on the comparison from the report', () => {
    const result = reported();
    expect(result.ratioCount).toBe(0);
    // Not one multiplier in the whole comparison, and the card still fills
    // fifteen of its eighteen cells with a recorded answer.
    const answered = result.glance.flatMap((row) =>
      row.cells.filter((cell) => cell.state !== 'absent'),
    );
    expect(answered).toHaveLength(18);
    expect(
      result.glance.flatMap((row) => row.cells.filter((cell) => cell.state === 'stated')),
    ).not.toHaveLength(0);
  });

  it('records an absence as a finding rather than as a hole', () => {
    // The Octane has no graphics part, so it has no graphics clock, and that is
    // a fact about the hardware. The iPhone has one and nobody publishes its
    // clock, which is a different fact, recorded with the reason.
    const row = glanceRow(reported(), 'gpu-clock');
    expect(row.cells[2]?.state).toBe('not-applicable');
    expect(row.cells[2]?.note).toContain('no gpu component');
    expect(row.cells[1]?.state).toBe('unknown');
    expect(row.cells[1]?.figures[0]?.text).toBe('unknown');
    expect(row.cells[1]?.figures[0]?.note).toBeDefined();
  });

  it('draws bars where two records answer within one comparability group', () => {
    const row = glanceRow(reported(), 'cpu-clock');
    expect(row.comparable).toBe(true);
    expect(row.barScale).toBe('linear');
    const bars = row.cells.flatMap((cell) => cell.figures.flatMap((f) => (f.bar ? [f.bar] : [])));
    expect(bars).toHaveLength(4);
    // The longest figure is the full bar and every other is its share of it.
    expect(Math.max(...bars.map((bar) => bar.fraction))).toBe(1);
    expect(bars.every((bar) => bar.fraction > 0 && bar.fraction <= 1)).toBe(true);
  });

  it('draws none where the records answered in different groups', () => {
    // The PlayStation 3 states a memory bandwidth per pool, the other two state
    // none at all. Nothing may be put side by side, so nothing gets a length.
    const row = glanceRow(reported(), 'memory-bandwidth');
    expect(row.comparable).toBe(false);
    expect(row.barScale).toBeUndefined();
    expect(row.cells.every((cell) => cell.figures.every((f) => f.bar === undefined))).toBe(true);
  });

  it('names the difference that stopped a row rather than a plausible one', () => {
    // Four consoles' power: one method, `rated-power`, at two scopes, a
    // processor's rating beside a whole console's. Reporting "different methods"
    // would be false about a catalog that is being careful.
    const row = comparison(
      'sony-playstation@retail',
      'nintendo-64@retail',
      'sega-dreamcast@retail',
      'sony-playstation-2@retail',
    ).glance.find((candidate) => candidate.id === 'power');
    expect(row?.comparable).toBe(false);
    expect(row?.methods).toHaveLength(1);
    expect(row?.scopes.toSorted()).toEqual(['cpu', 'whole-system']);
  });

  it('turns logarithmic where a linear row would show one bar and a sliver', () => {
    // 1.02 MHz against 3.2 GHz is three thousandfold: drawn linearly, the older
    // machine's bar would be a third of a pixel and the reader would read it as
    // zero. The label is what makes the log bar honest, and it is not optional.
    const row = comparison('commodore-64@pal', 'sony-playstation-3@launch').glance.find(
      (candidate) => candidate.id === 'cpu-clock',
    );
    expect(row?.comparable).toBe(true);
    expect(row?.barScale).toBe('log');
    const fractions = row?.cells.flatMap((cell) =>
      cell.figures.flatMap((figure) => (figure.bar === undefined ? [] : [figure.bar.fraction])),
    );
    // Ordered as the figures are, and the smaller one still visible, which is
    // the whole reason the scale changed.
    expect(fractions?.[0]).toBeGreaterThan(0.2);
    expect(fractions?.at(-1)).toBe(1);
  });

  it('keeps two metrics that do not convert out of one bar', () => {
    // The Apollo Guidance Computer counts memory in machine words and the H100
    // in bytes. Both answer the question; neither converts, so neither gets a
    // length measured against the other.
    const row = comparison(
      'apollo-guidance-computer-block-ii@block-ii',
      'nvidia-h100-sxm@sxm',
    ).glance.find((candidate) => candidate.id === 'memory-capacity');
    expect(row?.cells.filter((cell) => cell.state === 'stated')).toHaveLength(2);
    expect(row?.comparable).toBe(false);
    expect(row?.barScale).toBeUndefined();
  });

  it('gives a provisional figure a bar and keeps its multiplier refused', () => {
    // A bar is not a published number, so a provisional figure earns one, drawn
    // hatched, badge intact, while the multiplier it must not feed stays
    // refused in the row below.
    const result = comparison('nintendo-64@retail', 'sega-dreamcast@retail');
    const row = result.glance.find((candidate) => candidate.id === 'gpu-clock');
    const provisional = row?.cells
      .flatMap((cell) => cell.figures)
      .find((figure) => figure.measurement.editorialStatus === 'provisional');
    expect(provisional?.bar?.provisional).toBe(true);
    expect(provisional?.bar?.fraction).toBeGreaterThan(0);
    expect(findRow(result, 'clock-frequency|gpu|nominal-clock').cells[1]?.ratioRefusals).toContain(
      'provisional-record',
    );
  });

  it('refuses a bar for a metric whose ratios mean nothing', () => {
    // Both machines state a rated power draw within one group, so the bar rule's
    // first condition is met, and a rated design figure still has no length,
    // for the same reason it has no multiplier.
    const result = comparison('apollo-guidance-computer-block-ii@block-ii', 'saturn-lvdc');
    const row = result.glance.find((candidate) => candidate.id === 'power');
    expect(row?.comparable).toBe(true);
    expect(row?.barScale).toBeUndefined();
    expect(
      findRow(result, 'rated-power-consumption|whole-system|rated-power').barScale,
    ).toBeUndefined();
  });

  it('points a card row at the block that accounts for it', () => {
    // Every anchor the card offers has to land somewhere on the same page: the
    // card is allowed to say less than the sections, never to send a reader to
    // a heading that is not there.
    const result = reported();
    const anchors = new Set(blocks(result).map((block) => block.anchor));
    const offered = result.glance.flatMap((row) => (row.anchor === undefined ? [] : [row.anchor]));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((anchor) => !anchors.has(anchor))).toEqual([]);
  });

  it('draws the compared machines with their neighbors, every mark named', () => {
    const row = glanceRow(reported(), 'cpu-clock');
    const axis = row.axis;
    expect(axis).toBeDefined();
    // The timeline's own threshold of three machines, inherited rather than
    // restated, and its refusal to plot outside one comparability group.
    expect(axis?.machineCount).toBeGreaterThanOrEqual(3);

    const marks = axis?.marks ?? [];
    // A neighborhood, not the catalog: an axis carrying every machine as an
    // anonymous tick was what this replaced.
    expect(marks.length).toBeLessThanOrEqual(8);
    expect(marks.length).toBeLessThan(axis?.machineCount ?? 0);
    expect(marks.every((mark) => mark.systemName.length > 0 && mark.text.length > 0)).toBe(true);
    expect(marks.every((mark) => mark.position >= 0 && mark.position <= 1)).toBe(true);
    // Sorted by value, so the legend reads along the track in the order it sits.
    const positions = marks.map((mark) => mark.position);
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    // Each compared machine brought a neighbor with it.
    expect(marks.filter((mark) => mark.highlighted).length).toBeGreaterThanOrEqual(2);
    expect(marks.some((mark) => !mark.highlighted)).toBe(true);
    // The scale spans what is drawn: the highest mark reaches the end of the
    // track, or six neighboring machines would crowd into a few percent of it.
    expect(marks.at(-1)?.position).toBe(1);
  });

  it('ranks each compared machine among the figures recorded like its own', () => {
    const axis = glanceRow(reported(), 'cpu-clock').axis;
    const standings = axis?.standings ?? [];
    // One standing per compared machine that the series carries.
    expect(standings.length).toBeGreaterThanOrEqual(2);

    expect(standings.every((standing) => standing.of === axis?.machineCount)).toBe(true);
    expect(standings.every((standing) => standing.rank >= 1 && standing.rank <= standing.of)).toBe(
      true,
    );

    // A rank among four or more contemporaries, inside a window three years
    // either side of the machine's own release.
    const eras = standings.flatMap((standing) =>
      standing.era === undefined ? [] : [standing.era],
    );
    expect(eras.length).toBeGreaterThan(0);
    expect(eras.every((era) => era.of >= 4 && era.of <= (axis?.machineCount ?? 0))).toBe(true);
    expect(eras.every((era) => era.rank >= 1 && era.rank <= era.of)).toBe(true);
    expect(eras.every((era) => era.to - era.from === 6)).toBe(true);

    // The rank is the position in the ordering, so a machine stating a lower
    // figure than another must not be ranked above it.
    const marks = axis?.marks ?? [];
    const positions = standings
      .toSorted((a, b) => a.rank - b.rank)
      .map(
        (standing) => marks.find((mark) => mark.systemSlug === standing.systemSlug)?.position ?? 0,
      );
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  });

  it('builds no card for a comparison of parts', () => {
    // The backbone asks a machine what it is built from. A processor has no
    // answer to most of it, and six "not recorded" rows would say more about the
    // questions than about the records.
    expect(comparison().glance).toEqual([]);
    const parts = buildComparison(catalog, parseCompareQuery('components=mos-6510,motorola-68000'));
    expect(parts.glance).toEqual([]);
  });
});
