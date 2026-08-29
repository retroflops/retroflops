// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Catalog-wide consistency.
 *
 * `data:validate` checks each record against the schema and the references
 * between them. These are the invariants that only make sense across the whole
 * catalog: that every machine is linked to the parts it is built from, that
 * every missing link is a documented exception rather than an oversight, and
 * that every record with reduced confidence says why in its own words.
 *
 * The exception lists are the point. A machine with no graphics component is
 * either a fact about the hardware or an editorial decision, and both are fine,
 * what is not fine is a fifteenth machine quietly joining them because nobody
 * noticed the link was missing. Adding a record to one of these lists should
 * take an argument.
 */

import { describe, expect, it } from 'vitest';

import { getCatalog, getMeasurementsFor } from './catalog.ts';
import { checkComparable } from './data/comparability.ts';
import { getMetric } from './data/metrics.ts';
import { SYSTEM_FAMILIES } from './data/schema.ts';
import { getUnit, UNIT_IDS } from './data/units.ts';
import { sortConfigurationEntries } from './presentation-order.ts';

const catalog = getCatalog();
const normalizeProse = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

describe('profile presentation order', () => {
  for (const id of ['amiga-500', 'amiga-1200']) {
    it(`starts ${id}'s figures and configuration with its CPU`, () => {
      const system = catalog.systems.find((candidate) => candidate.id === id);
      expect(system).toBeDefined();
      if (system === undefined) return;

      expect(getMeasurementsFor('system', id)[0]?.scope).toBe('cpu');
      expect(sortConfigurationEntries(system.configurations[0]?.entries ?? [])[0]?.role).toBe(
        'main-cpu',
      );
    });
  }
});

describe('pilot profile records', () => {
  it('keeps the iPhone 17 Pro configuration tied to the repaired component figures', () => {
    const system = catalog.systems.find((candidate) => candidate.id === 'apple-iphone-17-pro');
    expect(system?.configurations[0]?.entries.map((entry) => entry.measurementIds)).toEqual([
      ['apple-iphone-17-pro:cpu-clock-frequency'],
      ['apple-iphone-17-pro:gpu-clock-frequency'],
      ['apple-iphone-17-pro:whole-system-memory-capacity'],
    ]);

    const levels = new Map(
      catalog.measurements
        .filter((measurement) => measurement.subject.id === 'apple-iphone-17-pro')
        .map((measurement) => [measurement.id, measurement.evidenceLevel]),
    );
    expect(levels.get('apple-iphone-17-pro:cpu-clock-frequency')).toBe('reported');
    expect(levels.get('apple-iphone-17-pro:gpu-clock-frequency')).toBe('rumored');
    expect(levels.get('apple-iphone-17-pro:whole-system-memory-capacity')).toBe('reported');
  });

  it("keeps ZX Spectrum 48K's ULA timing separate from invented bandwidth or FP32 values", () => {
    const figures = new Map(
      catalog.measurements
        .filter(
          (measurement) =>
            measurement.subject.id === 'zx-spectrum-48k' ||
            measurement.subject.id === 'zx-spectrum-z80a',
        )
        .map((measurement) => [measurement.id, measurement]),
    );
    expect(figures.get('zx-spectrum-48k:gpu-clock-frequency')?.quantity).toMatchObject({
      state: 'value',
      value: '14',
      unit: 'MHz',
    });
    expect(figures.get('zx-spectrum-48k:memory-bandwidth')?.quantity.state).toBe('unknown');
    expect(figures.get('zx-spectrum-z80a:peak-fp32-rate')?.quantity.state).toBe('not-applicable');
  });
});

describe('editorial profile prose', () => {
  it('keeps every system summary and description distinct', () => {
    for (const field of ['summary', 'description'] as const) {
      const seen = new Map<string, string>();
      for (const system of catalog.systems) {
        const source = system[field];
        if (source === undefined) continue;
        const text = normalizeProse(source);
        const previous = seen.get(text);
        expect(previous, `Duplicate ${field}: ${previous} and ${system.slug}`).toBeUndefined();
        seen.set(text, system.slug);
      }
    }
  });

  it('never resolves a narrative sentence into an absence label', () => {
    // The built artifact, not the canonical record: markers are already resolved
    // here, which is the only place the defect is visible. `/systems/zx-spectrum-48k/`
    // once published "the RAM and ROM capacities are unknown and unknown"
    // because the summary was a template whose slots had nothing to fill them.
    const absenceLabel = /\b(unknown|not applicable|not yet checked)\b/i;
    const broken: string[] = [];
    for (const record of [...catalog.systems, ...catalog.components]) {
      for (const field of ['summary', 'description'] as const) {
        const text = (record as Record<string, unknown>)[field];
        if (typeof text === 'string' && absenceLabel.test(text)) {
          broken.push(`${record.slug}.${field}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

/** Slug → why the machine has no graphics component. */
const NO_GPU: Readonly<Record<string, string>> = {
  'apollo-guidance-computer-block-ii':
    'Fact about the hardware: the AGC drove a numeric display, not a raster.',
  'saturn-lvdc': 'Fact about the hardware: the LVDC had no display output at all.',
  'sgi-octane':
    'Editorial: the Octane shipped with several graphics subsystems and the cited SPEC results do not say which was fitted. Recording a guess would be worse than recording nothing.',
};

/** Slug → why the record has no processor. */
const NO_CPU: Readonly<Record<string, string>> = {
  'nvidia-h100-sxm':
    'The nature of an accelerator: the H100 is a card in a host machine, and the host is not this record.',
  'nvidia-geforce-gtx-1080':
    'The same fact about the same kind of device: a graphics card is fitted to a computer, and the computer it is fitted to is not part of this record.',
  'nvidia-geforce-rtx-5090':
    'A graphics card like the GeForce GTX 1080 and the H100, and recorded the same way: the processor in the machine it plugs into belongs to that machine.',
  '3dfx-voodoo-graphics':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the Voodoo card record.',
  'nvidia-geforce-256':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'ati-radeon-9700-pro':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the Radeon card record.',
  'nvidia-geforce-6800-ultra':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'nvidia-geforce-8800-gtx':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'nvidia-geforce-gtx-580':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'nvidia-geforce-gtx-780-ti':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'nvidia-geforce-rtx-2080-ti':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'nvidia-geforce-rtx-4090':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the GeForce card record.',
  'amd-radeon-rx-7900-xtx':
    'A graphics accelerator in a host computer; the host processor belongs to that computer rather than to the Radeon card record.',
};

/**
 * Slug → why the machine belongs to no product lineage.
 *
 * Twenty of seventy-eight, and every one of them is a decision rather than an
 * oversight, which is the whole reason this list is written out. A
 * seventy-ninth machine cannot join them quietly: it has to be argued for here
 * first, exactly as `NO_GPU` and `NO_CPU` demand.
 */
const NO_FAMILY: Readonly<Record<string, string>> = {
  '3dfx-voodoo-graphics':
    'The only 3dfx card here. Voodoo 2 and Banshee are not in the catalog, so there is no line to be part of.',
  'acorn-archimedes-a310':
    'Acorn also made the BBC Micro, but a 6502 home computer and an ARM desktop are two lines, not one.',
  'amstrad-cpc-464': 'The only Amstrad machine in the catalog, so there is no line to be part of.',
  'apollo-guidance-computer-block-ii':
    'Built once for one program. The Saturn LVDC flew the same rocket and shares no design with it.',
  'apple-ii':
    'The Apple II line is not the Macintosh line, and only one Apple II is recorded here.',
  'atari-2600':
    'Atari made all three of a console, an eight-bit computer and a sixteen-bit one, and no two of them are a lineage.',
  'atari-520st': 'See the Atari 2600: one firm, three unrelated lines, one machine recorded each.',
  'atari-800':
    'See the Atari 2600: the 800 is the eight-bit computer line, sharing a maker with the console and the ST and a lineage with neither.',
  'bbc-micro-model-b': 'See the Archimedes: Acorn, but the other line, and only one of it.',
  'commodore-64':
    'A Commodore machine but not an Amiga. The relation to the Amigas is an argument, and the Commodore decade comparison preset is where an argument belongs.',
  'ibm-pc-5150':
    'The machine the reference PCs descend from, but not one of them: those are constructed records for a class of clone, and this is a specific IBM product.',
  msx: 'A standard several firms built to, which is the opposite of a single maker’s lineage.',
  'nec-pc-engine':
    'The only NEC console in the catalog; the PC-FX that followed it is not recorded here, so there is no line to join.',
  'nvidia-h100-sxm':
    'An NVIDIA accelerator but not a GeForce: a data-center part, sold into a different market from the cards it would sit beside.',
  'raspberry-pi-5':
    'The only Raspberry Pi recorded here. The earlier boards are a real lineage, but a lineage needs two members in the catalog.',
  'saturn-lvdc': 'See the Apollo Guidance Computer: one machine, one program, no successor here.',
  'sgi-octane': 'The only workstation in the catalog at all.',
  'snk-neo-geo-aes':
    'The only SNK machine in the catalog; the MVS arcade board it shares hardware with is not a record here.',
  'valve-steam-deck': 'The only Valve machine, and the only handheld that is not a Nintendo one.',
  'zx-spectrum-48k': 'The only Sinclair machine in the catalog.',
};

/**
 * Component id → why the part belongs to no machine's configuration.
 *
 * Empty, and meant to stay that way. A component exists because a machine in
 * this catalog contains it, so an entry here would be a claim that some part
 * is worth a record and a page while belonging to nothing, which is a case
 * nobody has had to argue yet. The map exists so that arguing it is the only
 * way to add one.
 */
const UNFITTED: Readonly<Record<string, string>> = {};

function componentKinds(systemId: string): ReadonlySet<string> {
  const system = catalog.systems.find((candidate) => candidate.id === systemId);
  const ids = new Set(
    system?.configurations.flatMap((configuration) =>
      configuration.entries.map((entry) => entry.componentId),
    ) ?? [],
  );
  return new Set(
    catalog.components
      .filter((component) => ids.has(component.id))
      .map((component) => component.kind),
  );
}

describe('every machine is linked to its parts', () => {
  it('links a processor, or names why there is none', () => {
    const missing = catalog.systems
      .filter((system) => !componentKinds(system.id).has('cpu'))
      .map((system) => system.slug);
    expect(missing.toSorted()).toEqual(Object.keys(NO_CPU).toSorted());
  });

  it('links memory, without exception', () => {
    // Every machine in the catalog has memory, including the ones that have
    // nothing else, the AGC's core rope is the oldest record here.
    const missing = catalog.systems
      .filter((system) => !componentKinds(system.id).has('memory'))
      .map((system) => system.slug);
    expect(missing).toEqual([]);
  });

  it('links graphics, or names why there is none', () => {
    const missing = catalog.systems
      .filter((system) => !componentKinds(system.id).has('gpu'))
      .map((system) => system.slug);
    expect(missing.toSorted()).toEqual(Object.keys(NO_GPU).toSorted());
  });

  it('has a written reason for every missing link', () => {
    for (const reason of [
      ...Object.values(NO_GPU),
      ...Object.values(NO_CPU),
      ...Object.values(NO_FAMILY),
      ...Object.values(UNFITTED),
    ]) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it('names a component that exists for every configuration entry', () => {
    const ids = new Set(catalog.components.map((component) => component.id));
    const dangling = catalog.systems.flatMap((system) =>
      system.configurations.flatMap((configuration) =>
        configuration.entries
          .filter((entry) => !ids.has(entry.componentId))
          .map((entry) => `${system.slug} → ${entry.componentId}`),
      ),
    );
    expect(dangling).toEqual([]);
  });

  /*
   * The same link read from the other end.
   *
   * Every check above walks machine → parts, and a part no machine names passes
   * all of them: it validates, it carries figures, and those figures can even
   * reach the site through a derived claim. What it does not get is a way in.
   * Its own page shows no "Fitted to" section, it is missing from the parent's
   * configuration table, and nothing links to it but the sitemap, eight memory
   * records sat like that until this direction was checked.
   */
  it('fits every component to a machine', () => {
    const fitted = new Set(
      catalog.systems.flatMap((system) =>
        system.configurations.flatMap((configuration) =>
          configuration.entries.map((entry) => entry.componentId),
        ),
      ),
    );
    const unfitted = catalog.components
      .filter((component) => !fitted.has(component.id))
      .map((component) => component.id);
    expect(unfitted.toSorted()).toEqual(Object.keys(UNFITTED).toSorted());
  });
});

/**
 * Slug → why the machine has no whole-system memory capacity in bytes.
 *
 * Every other machine has one, because "how much memory does it have" is the
 * question a reader asks first and a catalog that answers it for some eras
 * and not others cannot compare them at all.
 */
const NO_WHOLE_SYSTEM_MEMORY: Readonly<Record<string, string>> = {
  'apple-iphone-3gs':
    'Apple identifies the phone but does not publish its installed DRAM capacity; listed flash storage is a different medium and cannot answer the memory question.',
  'apollo-guidance-computer-block-ii':
    'Fact about the hardware: the AGC is word-addressed, with 15-bit words and no byte at all. Its whole-system figure is in machine words, and converting it to bytes would invent a unit the machine never had.',
  'saturn-lvdc':
    'Fact about the hardware: the LVDC is word-addressed like the AGC, with 28-bit words. It carries its whole-system capacity as machine words for the same reason.',
  'acorn-archimedes-a310':
    'The surviving model-specific manual index does not expose a page-level RAM figure, so the catalog cannot state a whole-system total.',
  'amstrad-cpc-464':
    'The verified regional user-guide record does not expose a page-level RAM figure, so the catalog cannot state a whole-system total.',
  'apple-ii':
    'The cited Apple II reference leaves the installed RAM configuration unspecified, so the catalog cannot state a whole-system total.',
  'game-boy-advance':
    'The verified Nintendo manual passage does not state the internal-RAM capacity, so the catalog cannot state a whole-system total.',
  'intel-core-2-duo-e6600-pc':
    'The cited Intel reference does not map a specific retail PC memory configuration to the E6600, so the catalog cannot state a total.',
  msx: 'The verified MSX Technical Data Book record does not expose a page-level RAM figure, so the catalog cannot state a whole-system total.',
  'nec-pc-engine':
    'The verified developer-documentation bundle does not expose a page-level RAM figure, so the catalog cannot state a whole-system total.',
  'nintendo-wii':
    'Nintendo public Wii manuals do not state the installed memory pools, so the catalog cannot state a whole-system total.',
  'nvidia-geforce-6800-ultra':
    'No qualifying source establishes installed board memory, so the catalog records the capacity as unknown rather than adding a guessed total.',
  'sega-master-system':
    'The verified service-manual record does not expose a page-level RAM figure, so the catalog cannot state a whole-system total.',
};

describe('every machine states how much memory it has', () => {
  const capacities = catalog.measurements.filter(
    (measurement) =>
      measurement.metric === 'memory-capacity' && measurement.scope === 'whole-system',
  );

  it('carries a whole-system capacity, or names why it cannot', () => {
    const stated = new Set(
      capacities
        .filter((measurement) => measurement.quantity.state === 'value')
        .map((measurement) =>
          measurement.subject.kind === 'system'
            ? measurement.subject.id
            : subjectSystemOf(measurement.subject.id),
        ),
    );
    const missing = catalog.systems
      .filter((system) => !stated.has(system.id))
      .map((system) => system.slug);
    expect(missing.toSorted()).toEqual(Object.keys(NO_WHOLE_SYSTEM_MEMORY).toSorted());
    for (const reason of Object.values(NO_WHOLE_SYSTEM_MEMORY)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it('computes a split machine’s total rather than adding it up by hand', () => {
    // A machine whose memory comes in several pools has a total only because
    // somebody decided what belongs in it. That decision is a derived claim with
    // named inputs and named exclusions, recomputed on every build.
    const claims = new Map(catalog.derivedClaims.map((claim) => [claim.id, claim]));
    const derived = capacities.filter((measurement) => measurement.status === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    for (const measurement of derived) {
      const claim = claims.get(measurement.derivedFrom ?? '');
      expect(claim?.formula.id).toBe('sum');
      for (const exclusion of claim?.exclusions ?? []) {
        expect(exclusion.reason.length).toBeGreaterThan(20);
      }
    }
  });
});

/** Which machine a component figure belongs to, through the configurations that fit it. */
function subjectSystemOf(componentId: string): string | undefined {
  return catalog.systems.find((system) =>
    system.configurations.some((configuration) =>
      configuration.entries.some((entry) => entry.componentId === componentId),
    ),
  )?.id;
}

describe('reduced confidence always explains itself', () => {
  it('gives every provisional figure a caveat in its own words', () => {
    const silent = catalog.measurements
      .filter((measurement) => measurement.editorialStatus === 'provisional')
      // An unverified figure is the one reduced-confidence record that must stay
      // silent: it cites a document nobody here has read, so anything it said
      // about that document would be invented. The state is the explanation, and
      // the schema forbids it a note for the same reason.
      .filter((measurement) => measurement.quantity.state !== 'unverified')
      // A figure explains itself either beside the number, in a caveat, or in
      // place of it, in an absence note. Requiring the caveat specifically is
      // what once let a formulaic one be pasted over records whose notes already
      // said something true.
      .filter(
        (measurement) =>
          measurement.caveat === undefined &&
          (measurement.quantity.state === 'value' || measurement.quantity.note === undefined),
      )
      .map((measurement) => measurement.id);
    expect(silent).toEqual([]);
  });

  it('keeps provisional figures out of every published multiplier', () => {
    const provisional = new Set(
      catalog.measurements
        .filter((measurement) => measurement.editorialStatus === 'provisional')
        .map((measurement) => measurement.id),
    );
    // Multipliers specifically: a ratio built on an announced figure would claim
    // one machine is N times another on evidence nobody has confirmed.
    const leaks = catalog.derivedClaims
      .filter((claim) => claim.formula.id === 'ratio')
      .filter((claim) => claim.inputMeasurementIds.some((id) => provisional.has(id)))
      .map((claim) => claim.id);
    expect(leaks).toEqual([]);
  });

  it('never lets a computation come out more certain than its inputs', () => {
    // A sum may add announced figures, the PlayStation 4's memory bandwidth was
    // only ever announced, and a console with no machine-level bandwidth at all
    // is worse than one with a provisional figure. What it may not do is arrive
    // approved, which is what would let an announcement launder itself.
    const provisional = new Set(
      catalog.measurements
        .filter((measurement) => measurement.editorialStatus === 'provisional')
        .map((measurement) => measurement.id),
    );
    const laundered = catalog.derivedClaims
      .filter(
        (claim) =>
          claim.editorialStatus === 'approved' &&
          claim.inputMeasurementIds.some((id) => provisional.has(id)),
      )
      .map((claim) => claim.id);
    expect(laundered).toEqual([]);
  });

  it('gives every absent figure a state rather than a zero', () => {
    const zeroes = catalog.measurements
      .filter(
        (measurement) =>
          measurement.quantity.state === 'value' && Number(measurement.quantity.value) === 0,
      )
      .map((measurement) => measurement.id);
    expect(zeroes).toEqual([]);

    const states = new Set(
      catalog.measurements
        .filter((measurement) => measurement.quantity.state !== 'value')
        .map((measurement) => measurement.quantity.state),
    );
    expect([...states].toSorted()).toEqual(['not-applicable', 'unknown']);
  });

  it('never lets an unverified figure describe the source nobody read', () => {
    // The defect this state was introduced to end: a note reading "the service
    // manual does not state a standalone clock" beside a caveat conceding the
    // manual had never been transcribed. One of the two was invented, and it was
    // always the note.
    const talkative = catalog.measurements
      .filter((measurement) => {
        const { quantity } = measurement;
        if (quantity.state !== 'unverified') return false;
        return quantity.note !== undefined || measurement.caveat !== undefined;
      })
      .map((measurement) => measurement.id);
    expect(talkative).toEqual([]);

    // Every one of them names the document waiting to be read, so the backlog
    // says which manual would close it.
    const unsourced = catalog.measurements
      .filter((measurement) => measurement.quantity.state === 'unverified')
      .filter((measurement) => measurement.sourceIds.length === 0)
      .map((measurement) => measurement.id);
    expect(unsourced).toEqual([]);
  });
});

describe('configuration figure references', () => {
  it('resolves every displayed value to one formal measurement', () => {
    const measurements = new Map(
      catalog.measurements.map((measurement) => [measurement.id, measurement]),
    );
    const dangling = catalog.systems.flatMap((system) =>
      system.configurations.flatMap((configuration) =>
        configuration.entries.flatMap((entry) =>
          entry.measurementIds
            .filter((id) => !measurements.has(id))
            .map((id) => `${system.id}/${configuration.id}/${entry.componentId}/${id}`),
        ),
      ),
    );
    expect(dangling).toEqual([]);
  });

  it('contains none of the removed duplicate value fields', () => {
    const serialized = JSON.stringify(
      catalog.systems.flatMap((system) =>
        system.configurations.flatMap((configuration) => configuration.entries),
      ),
    );
    expect(serialized).not.toMatch(/"(?:clock|capacity|busWidth)":/);
  });
});

describe('a figure the vendor never published', () => {
  it('is sourced independently without retaining a duplicate vendor-silence record', () => {
    const clocks = catalog.measurements.filter(
      (measurement) =>
        measurement.comparabilityGroup === 'clock-frequency|cpu|nominal-clock' &&
        measurement.subject.id === 'sony-playstation-4',
    );
    const stated = clocks.find((measurement) => measurement.quantity.state === 'value');
    expect(stated?.provenance).toBe('independent');
    expect(clocks).toHaveLength(1);
    expect(stated?.sourceIds.length).toBeGreaterThanOrEqual(2);
  });

  it('cites two independent sources for anything it approves', () => {
    // A figure no vendor document states needs two agreeing independent sources
    // before it can be approved. One is enough to record it, not to approve it.
    // Unless the one source is tier A, which a benchmark publisher's own
    // results are: the rule is about a figure resting on somebody's single
    // analysis, not about the number of documents.
    const tierA = new Set(
      catalog.sources.filter((source) => source.tier === 'A').map((source) => source.id),
    );
    const thin = catalog.measurements
      .filter(
        (measurement) =>
          measurement.provenance === 'independent' &&
          measurement.editorialStatus === 'approved' &&
          measurement.quantity.state === 'value',
      )
      .filter(
        (measurement) =>
          measurement.sourceIds.length < 2 && !measurement.sourceIds.some((id) => tierA.has(id)),
      )
      .map((measurement) => measurement.id);
    expect(thin).toEqual([]);
  });
});

/**
 * Traceability of the published export.
 *
 * `data:validate` enforces these on the canonical records, which is where a bad
 * record is stopped. This asserts them of `public/data/catalog-v1.json`, the
 * file the site reads and the one a reader downloads, so a figure cannot reach
 * the public artifact without the citation that makes it checkable, whatever
 * happened between the record and the build.
 */
describe('every published number can be traced back to a document', () => {
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));

  it('cites at least one source that exists, for every figure and every absence', () => {
    // Absences too: "no maker ever published this" is a claim about the
    // documents, and the documents that were read are the evidence for it.
    const untraceable = catalog.measurements
      .filter((measurement) => measurement.sourceIds.some((id) => !sources.has(id)))
      .map((measurement) => measurement.id);
    expect(untraceable).toEqual([]);
  });

  it('gives every cited source a locator and the day it was read', () => {
    const vague = [...sources.values()]
      .filter(
        (source) =>
          source.locator.trim() === '' || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedDate),
      )
      .map((source) => source.id);
    expect(vague).toEqual([]);
  });

  it('never rests an approved figure on discovery sources alone', () => {
    // Tier C is for finding out that a document exists, never for what it says.
    const discovery = catalog.measurements
      .filter((measurement) => measurement.editorialStatus === 'approved')
      .filter((measurement) => measurement.sourceIds.every((id) => sources.get(id)?.tier === 'C'))
      .map((measurement) => measurement.id);
    expect(discovery).toEqual([]);
  });

  it('sources the constants a formula divides by, not only its measurements', () => {
    // A constant is where a derivation goes wrong quietly: nothing in the
    // catalog states it, so nothing else would catch it being invented.
    for (const claim of catalog.derivedClaims) {
      for (const constant of claim.constants ?? []) {
        expect(constant.sourceIds.length).toBeGreaterThan(0);
        expect(constant.sourceIds.filter((id) => !sources.has(id))).toEqual([]);
        expect(constant.reason.length).toBeGreaterThan(20);
      }
    }
  });

  it('cites an existing source for every side of every conflict', () => {
    const dangling = catalog.conflicts.flatMap((conflict) =>
      conflict.candidates.flatMap((candidate) =>
        candidate.sourceIds.filter((id) => !sources.has(id)).map((id) => `${conflict.id} → ${id}`),
      ),
    );
    expect(dangling).toEqual([]);
  });

  it('surfaces the usage restrictions a source carries wherever it is quoted', () => {
    // SPEC fair use is the live case: the results are quotable, on terms that
    // travel with the quotation rather than with the reader's memory.
    const restricted = catalog.sources.filter((source) => source.usageNote !== undefined);
    expect(restricted.length).toBeGreaterThan(0);
    for (const source of restricted) {
      expect(source.usageNote?.length).toBeGreaterThan(20);
    }
  });
});

describe('conflicts are decided in writing', () => {
  it('records a rationale and a date for every decision', () => {
    for (const conflict of catalog.conflicts) {
      expect(conflict.decision.rationale.length).toBeGreaterThan(40);
      expect(conflict.decision.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(conflict.candidates.length).toBeGreaterThanOrEqual(2);
      for (const candidate of conflict.candidates) {
        expect(candidate.sourceIds.length).toBeGreaterThan(0);
        expect(candidate.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it('accepts a candidate that exists', () => {
    const dangling = catalog.conflicts
      .filter(
        (conflict) =>
          conflict.decision.outcome === 'accepted' &&
          conflict.candidates[conflict.decision.candidateIndex] === undefined,
      )
      .map((conflict) => conflict.id);
    expect(dangling).toEqual([]);
  });

  it('has no unresolved conflict left unreviewed', () => {
    // Unresolved is a legitimate outcome, and an empty list here is a statement
    // that the ledger has been read rather than that conflicts cannot exist.
    const unresolved = catalog.conflicts
      .filter((conflict) => conflict.decision.outcome === 'unresolved')
      .map((conflict) => conflict.id);
    expect(unresolved).toEqual([]);
  });
});

/**
 * Prices in the catalog.
 *
 * A price is the one figure in the catalog whose unit does not convert into
 * anything, and the rules that keep it honest are easy to lose the day a second
 * currency arrives. These pin them to the published catalog rather than to a
 * fixture, so a yen price added without a decision fails here.
 */
describe('a launch price is nominal, in one currency, with a separate CPI adjustment', () => {
  const prices = catalog.measurements.filter(
    (measurement) => measurement.metric === 'launch-price',
  );

  it('records at least one, obtained by the method the registry names', () => {
    expect(prices.length).toBeGreaterThan(0);
    expect([...new Set(prices.map((price) => price.method))]).toEqual(['list-price']);
  });

  it('holds one currency, so that no row can ever put two side by side', () => {
    const units = new Set(
      prices.flatMap((price) => (price.quantity.state === 'value' ? [price.quantity.unit] : [])),
    );
    // Not a claim that a second currency would be wrong, a claim that adding
    // one is a decision about how two of them sit in one row, taken on purpose.
    expect([...units]).toEqual(['USD']);
  });

  it('keeps price multipliers forbidden and routes every stated price through the CPI formula', () => {
    // The metric forbids ratios outright, which is also what keeps a bar off
    // the row: there is no honest length for "1.5× the price" across two years.
    expect(getMetric('launch-price')?.allowsRatio).toBe(false);
    const priceIds = new Set(prices.map((price) => price.id));
    const priceClaims = catalog.derivedClaims.filter((claim) =>
      claim.inputMeasurementIds.some((id) => priceIds.has(id)),
    );
    const statedPriceIds = prices
      .filter((price) => price.quantity.state === 'value')
      .map((price) => price.id)
      .toSorted();
    expect(priceClaims).toHaveLength(statedPriceIds.length);
    expect([...new Set(priceClaims.map((claim) => claim.formula.id))]).toEqual([
      'price-adjusted-by-cpi',
    ]);
    expect(priceClaims.flatMap((claim) => claim.inputMeasurementIds).toSorted()).toEqual(
      statedPriceIds,
    );
  });

  it('pins every price adjustment to the fetched CPI-U snapshot', () => {
    const cpi = catalog.sources.find((source) => source.id === 'bls-cpi-u-july-2026');
    expect(cpi?.editorialStatus).toBe('approved');
    expect(cpi?.fetch?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const priceIds = new Set(
      prices.filter((price) => price.quantity.state === 'value').map((price) => price.id),
    );
    const claims = catalog.derivedClaims.filter((claim) =>
      claim.inputMeasurementIds.some((id) => priceIds.has(id)),
    );
    for (const claim of claims) {
      expect(claim.constants?.map((constant) => constant.sourceIds)).toEqual([
        ['bls-cpi-u-july-2026'],
        ['bls-cpi-u-july-2026'],
      ]);
    }
  });

  it('compares two prices in the same currency, and has one currency to compare', () => {
    const dollars = {
      metric: 'launch-price',
      scope: 'whole-system',
      method: 'list-price',
      status: 'vendor-rated',
      editorialStatus: 'approved',
      unit: 'USD',
      value: '399',
    } as const;
    expect(checkComparable(dollars, dollars).comparable).toBe(true);

    /*
     * What protects the catalog today is that there is nothing to mismatch
     * against: `UnitId` is a closed union, so a second currency cannot even be
     * written down without being registered first. `currency-mismatch` in
     * `checkComparable` is the rule waiting behind that for the day one is,
     * it cannot be exercised until then, and inventing a currency to exercise
     * it would put one in the registry with no record needing it.
     */
    expect(UNIT_IDS.filter((id) => getUnit(id)?.quantity === 'currency')).toEqual(['USD']);
  });
});

describe('product families', () => {
  it('gives every machine a family, or names why it has none', () => {
    const orphans = catalog.systems
      .filter((system) => system.family === undefined)
      .map((system) => system.slug);
    expect(orphans.toSorted()).toEqual(Object.keys(NO_FAMILY).toSorted());
  });

  it('uses every family in the vocabulary', () => {
    // An unused entry is a lineage someone planned and never curated, and it
    // would sit in the schema looking like a fact about the catalog.
    const used = new Set(catalog.systems.map((system) => system.family));
    expect(SYSTEM_FAMILIES.filter((family) => !used.has(family))).toEqual([]);
  });
});

describe('Geekbench compute figures', () => {
  const compute = catalog.measurements.filter(
    (measurement) => measurement.metric === 'geekbench-compute-score',
  );

  it('records every one against a graphics processor', () => {
    // The charts key their rows on the GPU a driver reported, not on the
    // machine around it, so the subject is the part and the scope says so.
    expect(compute.length).toBeGreaterThan(0);
    for (const measurement of compute) {
      expect(measurement.scope).toBe('gpu');
      expect(measurement.subject.kind).toBe('component');
      expect(measurement.benchmark?.id).toBe('geekbench-compute');
      expect(['metal', 'opencl']).toContain(measurement.benchmark?.variant);
    }
  });

  it('dates every one and says in words what the date is for', () => {
    for (const measurement of compute) {
      expect(measurement.asOf).toBeDefined();
      expect(measurement.caveat).toMatch(/2026/);
    }
  });

  it('decides in the ledger wherever the chart named one product twice', () => {
    // A curated row whose caveat mentions a rival string must have somewhere a
    // reader can go and see the rejected number.
    const decided = new Set(
      catalog.conflicts
        .filter((conflict) => conflict.metric === 'geekbench-compute-score')
        .map((conflict) => conflict.subject.id),
    );
    const claiming = compute
      .filter((measurement) => measurement.caveat?.includes('conflict ledger') === true)
      .map((measurement) => measurement.subject.id);
    expect(claiming.length).toBeGreaterThan(0);
    for (const subject of claiming) {
      expect(decided).toContain(subject);
    }
  });
});
