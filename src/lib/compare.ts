// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The comparison engine.
 *
 * Given two to four records, this assembles what the Compare view renders: rows
 * grouped by comparability group, one cell per record, and a multiplier only
 * where the rules already in `comparability.ts` allow one. It computes nothing
 * itself, the ratio comes from the versioned formula registry, so an ad-hoc
 * comparison on the page and a published `DerivedClaim` in the catalog are the
 * same arithmetic checked by the same rules.
 *
 * The function is pure and takes the catalog as an argument. That keeps it
 * testable against fixtures as well as against the real export, and it is what
 * lets the same code run in a page's frontmatter and inside a browser island.
 *
 * Two structural decisions are worth knowing before reading further.
 *
 * A row is a comparability group, not a metric. Two clock frequencies obtained
 * by different methods are two rows, never two columns of one row, because the
 * whole point of the group is that those figures do not belong side by side.
 * Rows that share a metric and scope are collected into a block so the view can
 * say why they did not merge.
 *
 * Sections are never combined. There is no aggregate, no total, no score, the
 * sections exist to group like with like, and a reader who wants a single number
 * for "faster" is being told, by the shape of the page, that it does not exist.
 */

import { catalogAvailability, type RecordAvailability } from './catalog-availability.ts';
import type { BenchmarkIdentity, RatioRefusal } from './data/comparability.ts';
import { BACKBONE, type CoverageState } from './data/coverage.ts';
import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  isPositive,
  parseDecimal,
  type Decimal,
} from './data/decimal.ts';
import { getFormula, type FormulaInput } from './data/formulas.ts';
import { getMetric, METRIC_IDS, type MeasurementScope, type MetricId } from './data/metrics.ts';
import type { Catalog, Component, ComponentRole, Measurement, System } from './data/schema.ts';
import { formatQuantity, formatRatio, methodLabel, metricLabel } from './display.ts';
import { timelineSeries, type TimelinePoint, type TimelineSeries } from './timeline.ts';

/** A comparison of one record is not a comparison; five columns stop being readable. */
export const COMPARE_MIN_SUBJECTS = 2;
export const COMPARE_MAX_SUBJECTS = 4;

/** Precision ceiling for an ad-hoc ratio. The formula lowers it to match its inputs. */
const RATIO_MAX_DIGITS = 6;

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

export interface CompareSelectionEntry {
  readonly kind: 'system' | 'component';
  readonly slug: string;
  /** One variant of a system, when the reader picked one. */
  readonly configurationId?: string | undefined;
}

/**
 * Why a selection could not be turned into a comparison. Reported rather than
 * thrown: a shared URL that names a record which has since been renamed should
 * explain itself, not produce a blank page.
 */
export type CompareProblem =
  | { readonly code: 'too-few'; readonly count: number }
  | { readonly code: 'too-many'; readonly count: number }
  | { readonly code: 'mixed-kinds' }
  | { readonly code: 'unknown-record'; readonly kind: string; readonly slug: string }
  | {
      readonly code: 'unknown-configuration';
      readonly slug: string;
      readonly configurationId: string;
    }
  | { readonly code: 'repeated-record'; readonly slug: string };

export interface CompareSubject {
  readonly kind: 'system' | 'component';
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Site-absolute path, without the deployment base prefix. */
  readonly path: string;
  /** Short line of context: type and date for a system, kind and maker for a part. */
  readonly context: string;
  readonly manufacturer: string;
  /** What kind of thing it is, in words: `Home computer`, `Processor`. */
  readonly typeLabel: string;
  /** Release year, for a system. A part is dated by the machines it went into. */
  readonly year?: string | undefined;
  readonly configuration?: { readonly id: string; readonly label: string } | undefined;
  /** Variants the record offers, so the view can invite the reader to pick one. */
  readonly configurations: readonly { readonly id: string; readonly label: string }[];
}

/* -------------------------------------------------------------------------- */
/* Rows and cells                                                              */
/* -------------------------------------------------------------------------- */

export interface CompareFigure {
  readonly measurement: Measurement;
  /** Formatted value, or the recorded absence written out. */
  readonly text: string;
  readonly absent: boolean;
  /** The record's own explanation of an absence. */
  readonly note?: string | undefined;
  /** The component the figure belongs to, when the subject is a system built from it. */
  readonly origin?: string | undefined;
  /** The variant the figure is specific to, when it is. */
  readonly variant?: string | undefined;
  /**
   * The part of the record the figure describes, when it describes one of
   * several. Shown beside the value, because "3.2 GHz" and "2.064 GHz" in one
   * cell are only intelligible once the reader knows which cores each belongs
   * to.
   */
  readonly part?: string | undefined;
  /** The part's role in the machine, which is what makes two figures each other's counterpart. */
  readonly role?: ComponentRole | undefined;
  /** How long to draw this figure, when its row earned bars. Presentational only. */
  readonly bar?: CompareBar | undefined;
}

/* -------------------------------------------------------------------------- */
/* Bars                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The length of a bar, and nothing else.
 *
 * A bar is drawn wherever at least two records state a value in one
 * comparability group, exactly where the row already says they may be read
 * together. It carries no number, so it is not a published multiplier: a
 * provisional figure gets a hatched bar and keeps its badge while its printed
 * multiplier stays refused, which is the whole point of the distinction. Where
 * the metric itself forbids a ratio there is no bar either, because a quantity
 * that may not be divided has no length.
 *
 * The fraction is a share of the row's longest bar, computed from normalized
 * values, one base unit per comparability group by construction, and it exists
 * only to become a CSS width. Nothing reads it back as a figure.
 */
export interface CompareBar {
  /** Share of the row's longest bar, from 0 to 1. */
  readonly fraction: number;
  /** Hatched rather than solid: the figure is recorded but not accepted. */
  readonly provisional: boolean;
}

export type BarScaleKind = 'linear' | 'log';

/**
 * The spread at which a linear row stops saying anything: the Apollo Guidance
 * Computer beside an H100 is one full bar and one invisible one.
 */
const LOG_SCALE_THRESHOLD = parseDecimal('1000');

/** Precision of a bar length. Four decimals is finer than any screen. */
const BAR_DIGITS = 4;

interface BarScale {
  readonly kind: BarScaleKind;
  readonly fractionOf: (value: string) => number;
}

/** An exact quotient, then a float, the last step before a CSS width. */
function quotient(a: Decimal, b: Decimal): number {
  return Number(formatDecimal(divideDecimal(a, b, 6, 'half-up')));
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.min(1, Math.max(0, value)).toFixed(BAR_DIGITS));
}

/**
 * The scale a row's bars are drawn on, or nothing where a bar would mislead.
 *
 * Linear against the row's maximum, which is what a reader assumes a bar means.
 * Above a thousandfold spread that assumption produces one bar and a row of
 * slivers, so the scale turns logarithmic and says so on the page, the label is
 * not optional, because a log bar read as a linear one understates the gap by
 * orders of magnitude. The logarithm is taken from one decade below the smallest
 * figure so that the shortest bar is still a bar.
 */
function barScaleFor(metric: MetricId, values: readonly string[]): BarScale | undefined {
  if (getMetric(metric)?.allowsRatio !== true) {
    return undefined;
  }
  const decimals = values.map((value) => parseDecimal(value)).filter(isPositive);
  if (decimals.length < 2) {
    return undefined;
  }
  const max = decimals.reduce((a, b) => (compareDecimal(a, b) >= 0 ? a : b));
  const min = decimals.reduce((a, b) => (compareDecimal(a, b) <= 0 ? a : b));

  if (compareDecimal(divideDecimal(max, min, 6, 'half-up'), LOG_SCALE_THRESHOLD) < 0) {
    return {
      kind: 'linear',
      fractionOf: (value) => clampFraction(quotient(parseDecimal(value), max)),
    };
  }

  const floor: Decimal = { ...min, exponent: min.exponent - 1 };
  const span = Math.log(quotient(max, floor));
  return {
    kind: 'log',
    fractionOf: (value) => clampFraction(Math.log(quotient(parseDecimal(value), floor)) / span),
  };
}

/** The normalized value a bar could be drawn from, when the figure has one. */
function barValue(figure: CompareFigure): readonly string[] {
  const normalized = figure.measurement.normalized;
  return figure.absent || normalized === undefined ? [] : [normalized.value];
}

/**
 * Attaches bar lengths to the figures of one row, when the row has earned them.
 *
 * Counted in records rather than figures: a machine that states a quantity twice
 * has still only answered once, and a bar against itself compares nothing.
 */
function withBars(
  metric: MetricId,
  columns: readonly (readonly CompareFigure[])[],
): { readonly columns: readonly (readonly CompareFigure[])[]; readonly scale?: BarScaleKind } {
  const stating = columns.filter((figures) => figures.some((f) => barValue(f).length > 0)).length;
  if (stating < 2) {
    return { columns };
  }
  const scale = barScaleFor(metric, columns.flat().flatMap(barValue));
  if (scale === undefined) {
    return { columns };
  }
  return {
    scale: scale.kind,
    columns: columns.map((figures) =>
      figures.map((figure) => {
        const [value] = barValue(figure);
        return value === undefined
          ? figure
          : {
              ...figure,
              bar: {
                fraction: scale.fractionOf(value),
                provisional: figure.measurement.editorialStatus === 'provisional',
              },
            };
      }),
    ),
  };
}

/** Reasons a multiplier was withheld, beyond the ones the comparability rules give. */
export type CompareRatioRefusal =
  | RatioRefusal
  | 'baseline-has-no-value'
  | 'no-value'
  | 'variant-ambiguous'
  | 'several-parts'
  | 'not-normalized';

export interface CompareRatio {
  /** The multiplier as a reader expects to see it, e.g. `15×`. */
  readonly text: string;
  readonly value: string;
  readonly formula: { readonly id: string; readonly version: string };
  readonly expression: string;
  readonly significantDigits: number;
  /** Generated by the formula, never hand-written. */
  readonly caveat: string;
  readonly inputs: readonly { readonly subject: string; readonly text: string }[];
  /** Sources behind both inputs, so a multiplier is never shown without them. */
  readonly sourceIds: readonly string[];
}

/**
 * Where a record states a quantity, when it does not state it in the row asking.
 *
 * `whole-system` is the only scope allowed to stand in for a part's row, and
 * only for a quantity a machine can hold in one place: memory. A processor clock
 * recorded at `cpu` scope does not answer a question about the graphics clock,
 * so scope generally means a different part rather than a different level of
 * detail, and pointing across it would be the category error the scopes exist
 * to prevent.
 */
export type CompareElsewhere =
  | { readonly kind: 'role'; readonly role: ComponentRole }
  | { readonly kind: 'whole-system' };

export interface CompareCell {
  readonly subjectIndex: number;
  /** Usually one figure; more than one means the record states it per variant. */
  readonly figures: readonly CompareFigure[];
  /**
   * Where this record does state the quantity, when it states none in this row.
   *
   * A row about one part of a machine has nothing in it for a machine built
   * differently, the PlayStation 4 holds one unified pool where the
   * PlayStation 2 holds a main and a video one, and records its capacity for the
   * machine rather than for a pool. Saying "not recorded" there is false: the
   * figure exists, under another role or at the level of the whole machine. This
   * carries where, so the empty cell can point at it.
   */
  readonly statedAs?: readonly CompareElsewhere[] | undefined;
  /** The multiplier against the baseline column, when the rules allow one. */
  readonly ratio?: CompareRatio | undefined;
  /** Why no multiplier was produced. Empty for the baseline column itself. */
  readonly ratioRefusals: readonly CompareRatioRefusal[];
}

export interface CompareRow {
  /** The canonical comparability group: metric, scope, method and benchmark. */
  readonly group: string;
  readonly metric: MetricId;
  readonly metricLabel: string;
  readonly scope: MeasurementScope;
  readonly method: string;
  readonly benchmark?: BenchmarkIdentity | undefined;
  /**
   * The role the figures describe, when they come from a part fitted to a
   * machine. Main memory and video memory sit in one comparability group, and
   * pairing them would answer a question nobody asked, so the role splits the
   * row. Splitting only ever withholds a comparison, it can never create one.
   */
  readonly role?: ComponentRole | undefined;
  readonly cells: readonly CompareCell[];
  /** Subjects that state a figure here, absences excluded. */
  readonly statedCount: number;
  readonly ratioCount: number;
  /** How this row's bars were drawn, when it has any. */
  readonly barScale?: BarScaleKind | undefined;
}

/**
 * Every row describing one quantity of one part of the machine. More than one
 * row means the subjects state that quantity in ways that must not be divided,
 * and the block carries what differs so the view can say so in words.
 */
export interface CompareMetricBlock {
  readonly metric: MetricId;
  readonly scope: MeasurementScope;
  readonly role?: ComponentRole | undefined;
  readonly label: string;
  /** Fragment identifier, so the card above can send a reader to the reckoning. */
  readonly anchor: string;
  readonly rows: readonly CompareRow[];
  readonly methods: readonly string[];
  /** True when several subjects state this quantity but never within one group. */
  readonly incomparable: boolean;
}

export type CompareSectionId = 'processing' | 'graphics' | 'memory' | 'energy' | 'cost';

export interface CompareSection {
  readonly id: CompareSectionId;
  readonly label: string;
  readonly note: string;
  readonly blocks: readonly CompareMetricBlock[];
}

/* -------------------------------------------------------------------------- */
/* At a glance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One machine's answer to one backbone question.
 *
 * The state is the same four-way distinction the coverage report makes, and for
 * the same reason: a quantity a machine cannot have, a quantity nobody has
 * published and a question the catalog never asked are three different
 * findings, and only the last is a hole.
 */
export interface GlanceCell {
  readonly subjectIndex: number;
  readonly state: CoverageState;
  /** The figures answering the question, or the recorded absence carrying its note. */
  readonly figures: readonly CompareFigure[];
  /** Why the question does not arise, when it does not. */
  readonly note?: string | undefined;
}

/**
 * One machine on the neighborhood axis, named.
 *
 * Every mark carries a machine name and that machine's figure, because an
 * unnamed tick states nothing a reader can use: it says only that something
 * exists at some position, and a row of them says only that the catalog is
 * large. The marks a reader gets are the compared machines and their immediate
 * neighbors in the ordering.
 */
export interface CatalogMark {
  readonly systemSlug: string;
  readonly systemName: string;
  /** The figure as its source stated it. */
  readonly text: string;
  /** 0–1 along the axis. */
  readonly position: number;
  /** One of the records being compared. */
  readonly highlighted: boolean;
}

/**
 * How one compared machine's figure stands among the figures recorded like it.
 *
 * A rank, never a multiple: an ordinal is a statement about the order of the
 * recorded numbers, so it survives the rule that forbids dividing figures the
 * catalog has not put in one comparability group, and this whole axis is one
 * such group already. `era` is the same standing among machines released close
 * to it, which is the only form in which "was this fast for its time" can be
 * answered without inventing a performance verdict.
 */
export interface CatalogStanding {
  readonly systemSlug: string;
  readonly systemName: string;
  /** 1 + the number of machines stating a strictly lower figure; ties share a rank. */
  readonly rank: number;
  readonly of: number;
  readonly era?: CatalogEra | undefined;
}

export interface CatalogEra {
  readonly rank: number;
  readonly of: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Where the compared machines sit among the machines that answer the same
 * question the same way.
 *
 * Drawn from the timeline series, so it inherits that view's threshold of three
 * machines and its refusal to plot anything outside one comparability group. It
 * answers the question the compared figures cannot, whether a number was
 * remarkable for its time, with named neighbors and a rank rather than a
 * printed multiple.
 */
export interface CatalogAxis {
  /** The timeline series this axis is a neighborhood of. */
  readonly seriesSlug: string;
  readonly scale: BarScaleKind;
  /** Every machine in the group, not only the ones drawn. */
  readonly machineCount: number;
  readonly marks: readonly CatalogMark[];
  readonly standings: readonly CatalogStanding[];
}

/**
 * One question, asked of every record in the comparison.
 *
 * A card, not a verdict: it says what each machine states, and the sections
 * below stay responsible for whether two statements may be divided. A row whose
 * figures do not share one comparability group gets no bars, it says so in one
 * line and points down at the block that explains it.
 */
export interface GlanceRow {
  /** The backbone entry's identifier, taken from `coverage.ts` and never redeclared. */
  readonly id: string;
  readonly label: string;
  readonly cells: readonly GlanceCell[];
  /** True when every stated figure here sits in one comparability group. */
  readonly comparable: boolean;
  readonly barScale?: BarScaleKind | undefined;
  /**
   * The methods and the scopes behind the stated figures.
   *
   * Both, because either can be what stopped a row from lining up, and a line
   * that says "different methods" over four figures obtained by the same method
   * is worse than no line: it names the wrong reason. A console's rated draw and
   * a processor's are one method at two scopes, and that is the difference the
   * reader has to be told about.
   */
  readonly methods: readonly string[];
  readonly scopes: readonly MeasurementScope[];
  /** The block below that accounts for this quantity, when there is one. */
  readonly anchor?: string | undefined;
  readonly axis?: CatalogAxis | undefined;
}

export interface Comparison {
  readonly subjects: readonly CompareSubject[];
  /** The column every multiplier is measured against: the first subject. */
  readonly baseline?: CompareSubject | undefined;
  /** The catalog card: what each record states, before anything is divided. */
  readonly glance: readonly GlanceRow[];
  readonly sections: readonly CompareSection[];
  readonly problems: readonly CompareProblem[];
  readonly rowCount: number;
  readonly ratioCount: number;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Power is its own section whatever the scope, because the useful distinction is
 * not where the watts were drawn but that a cooling-design figure, a specified
 * rating and a measured wall draw are three different things, a point the rows
 * inside the section then make individually.
 */
const POWER_METRICS: ReadonlySet<MetricId> = new Set([
  'thermal-design-power',
  'system-power-draw',
  'rated-power-consumption',
]);

const MEMORY_METRICS: ReadonlySet<MetricId> = new Set([
  'memory-capacity',
  'memory-capacity-words',
  'memory-bandwidth',
  'memory-bus-width',
  'memory-cycle-time',
]);

const SECTION_ORDER: readonly {
  readonly id: CompareSectionId;
  readonly label: string;
  readonly note: string;
}[] = [
  {
    id: 'processing',
    label: 'Processing',
    note: 'Instruction rates, floating-point peaks, benchmark results and clocks. None of these converts into another.',
  },
  {
    id: 'graphics',
    label: 'Graphics',
    note: 'Figures recorded against a graphics processor.',
  },
  {
    id: 'memory',
    label: 'Memory',
    note: 'Capacity, bandwidth, bus width and timing. Binary and decimal prefixes are kept as the source wrote them.',
  },
  {
    id: 'energy',
    label: 'Energy',
    note: 'A cooling-design target, a specified rating and a measured wall draw are separate quantities, and only the last supports a multiplier.',
  },
  {
    id: 'cost',
    label: 'Cost',
    note: 'Nominal launch prices. Profiles show CPI-U adjustments as separate derived figures, while this table keeps the cited launch price and never forms a price multiplier.',
  },
];

function sectionOf(metric: MetricId, scope: MeasurementScope): CompareSectionId {
  if (POWER_METRICS.has(metric)) {
    return 'energy';
  }
  if (metric === 'launch-price') {
    return 'cost';
  }
  if (MEMORY_METRICS.has(metric) || scope === 'memory') {
    return 'memory';
  }
  return scope === 'gpu' ? 'graphics' : 'processing';
}

/* -------------------------------------------------------------------------- */
/* Selectable records                                                          */
/* -------------------------------------------------------------------------- */

/** One choosable record, with the variants a reader may narrow it to. */
export interface CompareOption {
  readonly kind: 'system' | 'component';
  readonly slug: string;
  readonly name: string;
  readonly context: string;
  readonly availability: RecordAvailability;
  /** Words the record can be found by, lowercased for matching. */
  readonly search: string;
  readonly variants: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Every record a comparison may be built from, systems first and each group
 * ordered as a reader would look for them: systems oldest first, so the
 * catalog reads as a sequence, components by name.
 *
 * Computed at build time and handed to the builder as props. The selector
 * therefore needs no request to show its options, only assembling an actual
 * comparison needs the full catalog, because only that needs the figures.
 */
export function compareOptions(catalog: Catalog): readonly CompareOption[] {
  const availability = catalogAvailability(catalog);
  const systems = catalog.systems
    .toSorted((a, b) => a.releaseDate.localeCompare(b.releaseDate))
    .map((system): CompareOption => ({
      kind: 'system',
      slug: system.slug,
      name: system.name,
      context: systemContext(system),
      availability: availability.systems.get(system.id)?.availability ?? 'research',
      search:
        `${system.name} ${system.aliases?.join(' ') ?? ''} ${system.manufacturer} ${system.type}`.toLowerCase(),
      variants: system.configurations.map((configuration) => ({
        id: configuration.id,
        label: configuration.label,
      })),
    }));

  const components = catalog.components
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((component): CompareOption => ({
      kind: 'component',
      slug: component.slug,
      name: component.name,
      context: componentContext(component),
      availability: availability.components.get(component.id)?.availability ?? 'research',
      search:
        `${component.name} ${component.aliases?.join(' ') ?? ''} ${component.manufacturer} ${component.kind}`.toLowerCase(),
      variants: [],
    }));

  return [...systems, ...components];
}

/* -------------------------------------------------------------------------- */
/* Query string                                                                */
/* -------------------------------------------------------------------------- */

const SYSTEMS_PARAM = 'systems';
const COMPONENTS_PARAM = 'components';

/**
 * Reads a selection out of a query string.
 *
 * The shape is deliberately legible, `?systems=commodore-64@pal,amiga-500@pal`
 * because these URLs are meant to be pasted into prose, and a reader should be
 * able to see which machines a link compares before following it.
 */
export function parseCompareQuery(
  search: string | URLSearchParams,
): readonly CompareSelectionEntry[] {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const entries: CompareSelectionEntry[] = [];
  for (const [param, kind] of [
    [SYSTEMS_PARAM, 'system'],
    [COMPONENTS_PARAM, 'component'],
  ] as const) {
    for (const raw of params.getAll(param).flatMap((value) => value.split(','))) {
      const token = raw.trim();
      if (token === '') {
        continue;
      }
      const [slug = '', configurationId] = token.split('@');
      entries.push({ kind, slug, configurationId });
    }
  }
  return entries;
}

/** The inverse, so a view can produce its restored URL. */
export function formatCompareQuery(entries: readonly CompareSelectionEntry[]): string {
  const params = new URLSearchParams();
  for (const [param, kind] of [
    [SYSTEMS_PARAM, 'system'],
    [COMPONENTS_PARAM, 'component'],
  ] as const) {
    const tokens = entries
      .filter((entry) => entry.kind === kind)
      .map((entry) =>
        entry.configurationId === undefined ? entry.slug : `${entry.slug}@${entry.configurationId}`,
      );
    if (tokens.length > 0) {
      params.set(param, tokens.join(','));
    }
  }
  const query = params.toString();
  // URLSearchParams escapes the separators this format relies on being readable.
  return query === '' ? '' : `?${query.replaceAll('%2C', ',').replaceAll('%40', '@')}`;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

interface ResolvedSubject {
  readonly subject: CompareSubject;
  readonly figures: readonly CompareFigure[];
  /**
   * Kinds of part fitted to the record. The backbone card asks a machine for its
   * graphics clock only when it has graphics, exactly as the coverage report
   * does, otherwise "not recorded" would be reported against hardware that
   * never had the thing.
   */
  readonly kinds: ReadonlySet<Component['kind']>;
}

export interface ResolvedSelection {
  readonly subjects: readonly ResolvedSubject[];
  readonly problems: readonly CompareProblem[];
}

function systemTypeLabel(system: System): string {
  const type = system.type.replaceAll('-', ' ');
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function systemContext(system: System): string {
  return `${systemTypeLabel(system)} · ${system.releaseDate.slice(0, 4)}`;
}

function componentKindLabel(component: Component): string {
  return { cpu: 'Processor', gpu: 'Graphics', memory: 'Memory' }[component.kind];
}

function componentContext(component: Component): string {
  return `${componentKindLabel(component)} · ${component.manufacturer}`;
}

function toFigure(
  measurement: Measurement,
  origin: string | undefined,
  variant: string | undefined,
  role?: ComponentRole | undefined,
): CompareFigure {
  const formatted = formatQuantity(measurement.quantity);
  return {
    measurement,
    text: formatted.text,
    absent: formatted.absent,
    note: formatted.note,
    origin,
    variant,
    part: partLabel(measurement.subject.part),
    role,
  };
}

/** `performance-cores` → `Performance cores`. The identifier is the label. */
function partLabel(part: string | undefined): string | undefined {
  if (part === undefined) {
    return undefined;
  }
  const words = part.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * A system's figures are its own plus those of the parts it is built from.
 *
 * Splitting them would make most system comparisons empty: a console's clock
 * lives on the console record, but a workstation's SPEC result and a
 * processor's transistor count live on different records, and a reader
 * comparing two machines means the machines as built.
 */
function systemFigures(
  catalog: Catalog,
  system: System,
  configurationId: string | undefined,
): readonly CompareFigure[] {
  const configurations =
    configurationId === undefined
      ? system.configurations
      : system.configurations.filter((configuration) => configuration.id === configurationId);

  const variantLabels = new Map(
    system.configurations.map((configuration) => [configuration.id, configuration.label]),
  );
  /**
   * The role each part plays. A part fitted in two roles across variants keeps
   * the first, which is a display detail: the role only decides which figures
   * are each other's counterpart, never whether they are comparable.
   */
  const roles = new Map<string, ComponentRole>();
  for (const configuration of configurations) {
    for (const entry of configuration.entries) {
      if (!roles.has(entry.componentId)) {
        roles.set(entry.componentId, entry.role);
      }
    }
  }

  const figures: CompareFigure[] = [];
  for (const measurement of catalog.measurements) {
    const { kind, id, configurationId: onVariant } = measurement.subject;
    if (kind === 'system' && id === system.id) {
      // A figure recorded against one variant belongs only to that variant.
      if (
        onVariant !== undefined &&
        configurationId !== undefined &&
        onVariant !== configurationId
      ) {
        continue;
      }
      // The variant is named on the figure only when the reader has not chosen
      // one: with a variant selected, the column header already says which it is
      // and repeating it on every figure is noise.
      const variant =
        onVariant === undefined || configurationId !== undefined
          ? undefined
          : (variantLabels.get(onVariant) ?? onVariant);
      figures.push(toFigure(measurement, undefined, variant));
      continue;
    }
    const role = roles.get(id);
    if (kind === 'component' && role !== undefined) {
      const component = catalog.components.find((candidate) => candidate.id === id);
      figures.push(toFigure(measurement, component?.name ?? id, undefined, role));
    }
  }
  return figures.toSorted(compareFigureEvidence);
}

function componentFigures(catalog: Catalog, component: Component): readonly CompareFigure[] {
  return catalog.measurements
    .filter(
      (measurement) =>
        measurement.subject.kind === 'component' && measurement.subject.id === component.id,
    )
    .map((measurement) => toFigure(measurement, undefined, undefined))
    .toSorted(compareFigureEvidence);
}

function compareFigureEvidence(a: CompareFigure, b: CompareFigure): number {
  const rank = { confirmed: 3, reported: 2, rumored: 1 } as const;
  return (
    (b.measurement.evidenceLevel === undefined ? 0 : rank[b.measurement.evidenceLevel]) -
    (a.measurement.evidenceLevel === undefined ? 0 : rank[a.measurement.evidenceLevel])
  );
}

/** Turns slugs into records, reporting every reason a selection cannot be used. */
export function resolveSelection(
  catalog: Catalog,
  entries: readonly CompareSelectionEntry[],
): ResolvedSelection {
  const problems: CompareProblem[] = [];
  const subjects: ResolvedSubject[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = `${entry.kind}:${entry.slug}:${entry.configurationId ?? ''}`;
    if (seen.has(key)) {
      problems.push({ code: 'repeated-record', slug: entry.slug });
      continue;
    }
    seen.add(key);

    if (entry.kind === 'system') {
      const system = catalog.systems.find((candidate) => candidate.slug === entry.slug);
      if (system === undefined) {
        problems.push({ code: 'unknown-record', kind: entry.kind, slug: entry.slug });
        continue;
      }
      const configurations = system.configurations.map((configuration) => ({
        id: configuration.id,
        label: configuration.label,
      }));
      const chosen =
        entry.configurationId === undefined
          ? undefined
          : configurations.find((configuration) => configuration.id === entry.configurationId);
      if (entry.configurationId !== undefined && chosen === undefined) {
        problems.push({
          code: 'unknown-configuration',
          slug: entry.slug,
          configurationId: entry.configurationId,
        });
      }
      const componentIds = new Set(
        system.configurations.flatMap((configuration) =>
          configuration.entries.map((fitted) => fitted.componentId),
        ),
      );
      subjects.push({
        subject: {
          kind: 'system',
          id: system.id,
          slug: system.slug,
          name: system.name,
          path: `/systems/${system.slug}/`,
          context: systemContext(system),
          manufacturer: system.manufacturer,
          typeLabel: systemTypeLabel(system),
          year: system.releaseDate.slice(0, 4),
          configuration: chosen,
          configurations,
        },
        figures: systemFigures(catalog, system, chosen?.id),
        kinds: new Set(
          catalog.components
            .filter((component) => componentIds.has(component.id))
            .map((component) => component.kind),
        ),
      });
      continue;
    }

    const component = catalog.components.find((candidate) => candidate.slug === entry.slug);
    if (component === undefined) {
      problems.push({ code: 'unknown-record', kind: entry.kind, slug: entry.slug });
      continue;
    }
    subjects.push({
      subject: {
        kind: 'component',
        id: component.id,
        slug: component.slug,
        name: component.name,
        path: `/components/${component.kind}/${component.slug}/`,
        context: componentContext(component),
        manufacturer: component.manufacturer,
        typeLabel: componentKindLabel(component),
        configuration: undefined,
        configurations: [],
      },
      figures: componentFigures(catalog, component),
      kinds: new Set([component.kind]),
    });
  }

  const kinds = new Set(subjects.map((resolved) => resolved.subject.kind));
  if (kinds.size > 1) {
    problems.push({ code: 'mixed-kinds' });
  }
  if (subjects.length < COMPARE_MIN_SUBJECTS) {
    problems.push({ code: 'too-few', count: subjects.length });
  }
  if (subjects.length > COMPARE_MAX_SUBJECTS) {
    problems.push({ code: 'too-many', count: subjects.length });
  }

  return { subjects, problems };
}

/* -------------------------------------------------------------------------- */
/* Ratios                                                                      */
/* -------------------------------------------------------------------------- */

const RATIO_FORMULA = getFormula('ratio', '1');

/**
 * A multiplier against the baseline column, or the reasons there is none.
 *
 * Everything strict here is strict in `checkRatioEligibility` already; this
 * function only adds the refusals that come from the shape of a comparison
 * rather than from the figures: nothing to divide, nothing to divide by, or a
 * record that states the quantity once per variant and so has no single value
 * until the reader picks one.
 */
function ratioAgainst(
  baselineFigures: readonly CompareFigure[],
  candidateFigures: readonly CompareFigure[],
  baselineName: string,
  candidateName: string,
): { ratio?: CompareRatio; refusals: readonly CompareRatioRefusal[] } {
  const baselineStated = baselineFigures.filter((figure) => !figure.absent);
  const candidateStated = candidateFigures.filter((figure) => !figure.absent);
  const baseline = baselineStated[0];
  const candidate = candidateStated[0];

  const refusals: CompareRatioRefusal[] = [];
  for (const stated of [baselineStated, candidateStated]) {
    if (stated.length > 1) {
      // Two different answers to the same question: either the record states the
      // figure per variant, or the machine has several parts in this role. The
      // remedies differ, so the refusals do too.
      refusals.push(
        new Set(stated.map((figure) => figure.variant)).size > 1
          ? 'variant-ambiguous'
          : 'several-parts',
      );
    }
  }
  if (baseline === undefined || baseline.absent) {
    refusals.push('baseline-has-no-value');
  }
  if (candidate === undefined || candidate.absent) {
    refusals.push('no-value');
  }
  if (refusals.length > 0 || baseline === undefined || candidate === undefined) {
    return { refusals: refusals.length > 0 ? [...new Set(refusals)] : ['no-value'] };
  }

  const numerator = formulaInput(candidate.measurement);
  const denominator = formulaInput(baseline.measurement);
  if (numerator === undefined || denominator === undefined || RATIO_FORMULA === undefined) {
    return { refusals: ['not-normalized'] };
  }

  const outcome = RATIO_FORMULA.compute([numerator, denominator], {
    significantDigits: RATIO_MAX_DIGITS,
    rounding: 'half-up',
  });

  if (!outcome.ok) {
    return { refusals: outcome.reasons as readonly CompareRatioRefusal[] };
  }

  return {
    ratio: {
      text: formatRatio({
        state: 'value',
        value: outcome.result.value,
        unit: outcome.result.unit,
        significantDigits: outcome.result.significantDigits,
      }),
      value: outcome.result.value,
      formula: { id: RATIO_FORMULA.id, version: RATIO_FORMULA.version },
      expression: RATIO_FORMULA.expression,
      significantDigits: outcome.result.significantDigits,
      caveat: outcome.result.caveat,
      inputs: [
        { subject: candidateName, text: candidate.text },
        { subject: baselineName, text: baseline.text },
      ],
      sourceIds: [
        ...new Set([...candidate.measurement.sourceIds, ...baseline.measurement.sourceIds]),
      ],
    },
    refusals: [],
  };
}

/**
 * A measurement as the formula registry wants it: normalized value, base unit,
 * and the facets the comparability rules judge. Absent when the figure has no
 * normalized twin, which `data:normalize` guarantees for every stated value,
 * so this returning `undefined` means the artifact is stale rather than that the
 * figure is unsuitable.
 */
function formulaInput(measurement: Measurement): FormulaInput | undefined {
  const normalized = measurement.normalized;
  if (normalized === undefined) {
    return undefined;
  }
  return {
    facets: {
      metric: measurement.metric,
      unit: normalized.unit,
      scope: measurement.scope,
      method: measurement.method,
      benchmark: measurement.benchmark,
      status: measurement.status,
      editorialStatus: measurement.editorialStatus,
    },
    value: normalized.value,
    significantDigits: normalized.significantDigits,
  };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/** Builds the whole comparison: sections, blocks, rows, cells and multipliers. */
export function buildComparison(
  catalog: Catalog,
  entries: readonly CompareSelectionEntry[],
): Comparison {
  const { subjects: resolved, problems } = resolveSelection(catalog, entries);
  const subjects = resolved.map((entry) => entry.subject);
  const baseline = subjects[0];

  if (resolved.length < COMPARE_MIN_SUBJECTS || problems.some((p) => p.code === 'mixed-kinds')) {
    return { subjects, baseline, glance: [], sections: [], problems, rowCount: 0, ratioCount: 0 };
  }

  /**
   * Groups where the part's role has to decide which figure pairs with which.
   *
   * The role exists because one machine can hold several figures in a single
   * group, the PlayStation 2 states a main and a graphics memory capacity the
   * same way, and pairing main against video would answer a question nobody
   * asked. It is a tie-breaker, so it only applies where there is a tie: one
   * record holding figures in *different roles* within one group. Where every
   * record fills a single role, the role must not split the row, or a capacity
   * recorded on a machine would never meet the same capacity recorded on
   * another machine's memory part.
   *
   * Counting roles rather than figures matters for a record whose variants each
   * state the quantity, the Mac mini's 8 GiB and 16 GiB are one role twice,
   * and splitting on them would leave two half-rows for one machine.
   */
  const roleSplitGroups = new Set<string>();
  for (const entry of resolved) {
    const rolesPerGroup = new Map<string, Set<string>>();
    for (const figure of entry.figures) {
      const group = figure.measurement.comparabilityGroup;
      const roles = rolesPerGroup.get(group) ?? new Set<string>();
      roles.add(figure.role ?? '');
      rolesPerGroup.set(group, roles);
      if (roles.size > 1) {
        roleSplitGroups.add(group);
      }
    }
  }

  // Row key, comparability group, plus role only where roles decide, →
  // per-subject figures, in order.
  const rowKeys = new Map<string, CompareFigure[][]>();
  resolved.forEach((entry, index) => {
    for (const figure of entry.figures) {
      const group = figure.measurement.comparabilityGroup;
      const key = roleSplitGroups.has(group) ? `${group}#${figure.role ?? ''}` : group;
      let columns = rowKeys.get(key);
      if (columns === undefined) {
        columns = resolved.map(() => []);
        rowKeys.set(key, columns);
      }
      columns[index]?.push(figure);
    }
  });

  /**
   * Which subjects state each metric at all, whatever the scope, method or role.
   *
   * A row with figures in one column only is usually noise, but not when
   * another record states the same quantity by a different method, at a
   * different scope or against a differently organized part. That mismatch is
   * the case the reader most needs explained, so the count here decides whether
   * a lone row is dropped or kept as the evidence for it. Keying it by metric
   * alone is what lets the Commodore 64's 64 KiB of system memory appear beside
   * the PlayStation 4's 8 GiB of whole-machine memory: the two are not
   * comparable, and a reader who cannot see that both machines stated a memory
   * capacity learns nothing from the silence.
   */
  const quantitySubjects = new Map<string, Set<number>>();
  resolved.forEach((entry, index) => {
    for (const figure of entry.figures) {
      const key = quantityKeyOf(figure.measurement.metric);
      const subjectsHere = quantitySubjects.get(key) ?? new Set<number>();
      subjectsHere.add(index);
      quantitySubjects.set(key, subjectsHere);
    }
  });

  let ratioCount = 0;
  const rows: CompareRow[] = [];

  for (const rawColumns of rowKeys.values()) {
    const first = rawColumns.flat()[0];
    if (first === undefined) {
      continue;
    }
    const { columns, scale: barScale } = withBars(first.measurement.metric, rawColumns);
    const { comparabilityGroup, metric, scope, method, benchmark } = first.measurement;
    // Carried only where it decided the row. Naming one column's role above a
    // row that merged two roles would label the figures wrongly.
    const role = roleSplitGroups.has(comparabilityGroup) ? first.role : undefined;

    const columnsWithFigures = columns.filter((figures) => figures.length > 0).length;
    const subjectsStatingIt = quantitySubjects.get(quantityKeyOf(metric))?.size ?? 0;
    if (columnsWithFigures < 2 && subjectsStatingIt < 2) {
      continue;
    }

    const baselineFigures = columns[0] ?? [];

    /** Where this record states the quantity, when this row holds none of its figures. */
    const statedAs = (index: number): readonly CompareElsewhere[] | undefined => {
      if ((columns[index]?.length ?? 0) > 0) {
        return undefined;
      }
      const figures = resolved[index]?.figures ?? [];
      const elsewhere: CompareElsewhere[] = [];

      // Another role inside this same group: one pool where this row wants two.
      if (role !== undefined) {
        const roles = new Set(
          figures
            .filter(
              (figure) =>
                figure.measurement.comparabilityGroup === comparabilityGroup &&
                figure.role !== undefined &&
                figure.role !== role,
            )
            .map((figure) => figure.role as ComponentRole),
        );
        elsewhere.push(
          ...[...roles].map((named): CompareElsewhere => ({ kind: 'role', role: named })),
        );
      }

      // Or at the level of the whole machine, for a machine that holds the
      // quantity in one place and records it once.
      if (
        scope !== 'whole-system' &&
        figures.some(
          (figure) =>
            figure.measurement.metric === metric &&
            figure.measurement.scope === 'whole-system' &&
            !figure.absent,
        )
      ) {
        elsewhere.push({ kind: 'whole-system' });
      }

      return elsewhere.length === 0 ? undefined : elsewhere;
    };

    const cells: CompareCell[] = columns.map((figures, index) => {
      if (index === 0) {
        return { subjectIndex: index, figures, statedAs: statedAs(index), ratioRefusals: [] };
      }
      const { ratio, refusals } = ratioAgainst(
        baselineFigures,
        figures,
        baseline?.name ?? '',
        subjects[index]?.name ?? '',
      );
      if (ratio !== undefined) {
        ratioCount += 1;
      }
      return {
        subjectIndex: index,
        figures,
        statedAs: statedAs(index),
        ratio,
        ratioRefusals: refusals,
      };
    });

    rows.push({
      group: comparabilityGroup,
      metric,
      metricLabel: metricLabel(metric),
      scope,
      method,
      benchmark,
      role,
      cells,
      statedCount: columns.filter((figures) => figures.some((figure) => !figure.absent)).length,
      ratioCount: cells.filter((cell) => cell.ratio !== undefined).length,
      barScale,
    });
  }

  const sections: CompareSection[] = [];
  for (const section of SECTION_ORDER) {
    const blocks = blocksFor(rows, section.id);
    if (blocks.length > 0) {
      sections.push({ id: section.id, label: section.label, note: section.note, blocks });
    }
  }

  return {
    subjects,
    baseline,
    glance: glanceRows(catalog, resolved, sections),
    sections,
    problems,
    rowCount: rows.length,
    ratioCount,
  };
}

/* -------------------------------------------------------------------------- */
/* The catalog card                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Builds the card that sits above the comparison.
 *
 * The questions are `BACKBONE`, imported rather than restated, so the card and
 * `pnpm data:coverage` cannot disagree about what a machine is expected to
 * answer. Everything else here is presentation of figures already resolved: no
 * figure reaches the card that the sections below would not also show, and no
 * pair is put side by side that the comparability rules would separate.
 *
 * Only for systems. The backbone asks a machine what it is built from, and a
 * part has no answer to most of it, a card of six "not recorded" rows would be
 * a statement about the questions rather than about the records.
 */
function glanceRows(
  catalog: Catalog,
  resolved: readonly ResolvedSubject[],
  sections: readonly CompareSection[],
): readonly GlanceRow[] {
  if (resolved.some((entry) => entry.subject.kind !== 'system')) {
    return [];
  }
  const blocks = sections.flatMap((section) => section.blocks);
  const compared = new Set(resolved.map((entry) => entry.subject.slug));
  let series: readonly TimelineSeries[] | undefined;

  return BACKBONE.map((entry): GlanceRow => {
    const cells = resolved.map((subject, subjectIndex): GlanceCell => {
      if (entry.requiresKind !== undefined && !subject.kinds.has(entry.requiresKind)) {
        return {
          subjectIndex,
          state: 'not-applicable',
          figures: [],
          note: `no ${entry.requiresKind} component is fitted to this record`,
        };
      }
      const candidates = subject.figures.filter(
        (figure) =>
          entry.metrics.includes(figure.measurement.metric) &&
          entry.scopes.includes(figure.measurement.scope),
      );
      const stated = candidates.filter((figure) => !figure.absent);
      if (stated.length > 0) {
        return { subjectIndex, state: 'stated', figures: stated };
      }
      // A record that answers outranks one that only admits nobody has looked,
      // matching the rule the coverage matrix applies to the same backbone.
      const recorded =
        candidates.find((candidate) => candidate.measurement.quantity.state !== 'unverified') ??
        candidates[0];
      if (recorded === undefined) {
        return { subjectIndex, state: 'absent', figures: [] };
      }
      const { state } = recorded.measurement.quantity;
      return {
        subjectIndex,
        state: state === 'value' ? 'stated' : state,
        figures: [recorded],
        note: recorded.note,
      };
    });

    const stated = cells.filter((cell) => cell.state === 'stated');
    const groups = new Set(
      stated.flatMap((cell) => cell.figures.map((figure) => figure.measurement.comparabilityGroup)),
    );
    // One group, and more than one record inside it: the same condition the rows
    // below use to allow a bar, asked once for the whole question.
    const comparable = stated.length >= 2 && groups.size === 1;
    const metric = stated[0]?.figures[0]?.measurement.metric;

    const { columns, scale } =
      comparable && metric !== undefined
        ? withBars(
            metric,
            cells.map((cell) => cell.figures),
          )
        : { columns: cells.map((cell) => cell.figures), scale: undefined };

    const anchor = blocks.find(
      (block) => entry.metrics.includes(block.metric) && entry.scopes.includes(block.scope),
    )?.anchor;

    const group = comparable ? [...groups][0] : undefined;
    if (group !== undefined && scale !== undefined) {
      series ??= timelineSeries(catalog);
    }

    return {
      id: entry.id,
      label: entry.label,
      cells: cells.map((cell, index): GlanceCell => ({
        subjectIndex: cell.subjectIndex,
        state: cell.state,
        figures: columns[index] ?? cell.figures,
        note: cell.note,
      })),
      comparable,
      barScale: scale,
      methods: [
        ...new Set(
          stated.flatMap((cell) =>
            cell.figures.map((figure) => methodLabel(figure.measurement.method)),
          ),
        ),
      ],
      scopes: [
        ...new Set(
          stated.flatMap((cell) => cell.figures.map((figure) => figure.measurement.scope)),
        ),
      ],
      anchor,
      axis:
        group === undefined || scale === undefined
          ? undefined
          : catalogAxis(series ?? [], group, compared),
    };
  });
}

/**
 * How far either side of a machine's release another machine still counts as a
 * contemporary.
 *
 * Three years is one console generation's worth of slack: wide enough that the
 * NES is measured against the ZX Spectrum, the MSX and the Master System rather
 * than against nothing, narrow enough that it is never measured against a
 * machine from the following decade.
 */
const ERA_WINDOW_YEARS = 3;

/**
 * Below this many contemporaries, a rank among them describes the catalog's
 * coverage rather than the machine, so no era standing is offered at all.
 */
const ERA_MIN_MACHINES = 4;

/** More named marks than this stop being readable side by side. */
const AXIS_MAX_MARKS = 8;

/**
 * The compared machines' neighborhood on one question, named.
 *
 * Not the whole catalog: an axis carrying every machine as an anonymous tick
 * says only that the catalog is large, and its two ends are the same two
 * machines on every comparison of that metric, which is furniture rather than
 * information. What a reader can use is who stands immediately either side of
 * these machines, and where they rank, among everything recorded alike, and
 * among the machines of their own years.
 *
 * It reuses `timelineSeries` rather than scanning the catalog again, which is
 * what keeps the threshold of three machines and the one-group rule in a single
 * place.
 */
function catalogAxis(
  series: readonly TimelineSeries[],
  group: string,
  compared: ReadonlySet<string>,
): CatalogAxis | undefined {
  const found = series.find((candidate) => candidate.group === group);
  if (found === undefined) {
    return undefined;
  }

  // One mark per machine: a machine stating the quantity twice is still one
  // machine, and two marks under one name would read as two.
  const perMachine = new Map<string, TimelinePoint>();
  for (const point of found.points) {
    if (!perMachine.has(point.systemSlug)) {
      perMachine.set(point.systemSlug, point);
    }
  }
  const points = [...perMachine.values()];
  if (points.length < 3) {
    return undefined;
  }

  const ordered = points.toSorted((a, b) =>
    compareDecimal(parseDecimal(a.value), parseDecimal(b.value)),
  );
  const here = ordered.flatMap((point, index) => (compared.has(point.systemSlug) ? [index] : []));
  if (here.length === 0) {
    return undefined;
  }

  const shown = neighborhood(ordered.length, here);
  const drawn = shown.flatMap((index) => {
    const point = ordered[index];
    return point === undefined ? [] : [point];
  });
  // The scale spans what is drawn, not the catalog, or six neighboring
  // machines would crowd into a few percent of the track. It is the same
  // function the row's bars are drawn with, so a linear window is still measured
  // from zero and the thousandfold switch to a logarithm happens in one place.
  const scale = barScaleFor(
    found.metric,
    drawn.map((point) => point.value),
  );
  if (scale === undefined) {
    return undefined;
  }

  return {
    seriesSlug: found.slug,
    scale: scale.kind,
    machineCount: ordered.length,
    marks: drawn.map((point): CatalogMark => ({
      systemSlug: point.systemSlug,
      systemName: point.systemName,
      text: point.text,
      position: scale.fractionOf(point.value),
      highlighted: compared.has(point.systemSlug),
    })),
    standings: here.flatMap((index) => {
      const point = ordered[index];
      return point === undefined ? [] : [standingOf(ordered, point)];
    }),
  };
}

/**
 * Which machines get drawn: the compared ones and whoever stands next to them.
 *
 * When four columns would ask for more marks than fit, the ones given up are
 * the interior neighbors. The outermost pair survives because it is what bounds
 * the picture, losing it would leave a compared machine sitting on the edge of
 * a track with nothing beyond it, which reads as a record it does not hold.
 */
function neighborhood(length: number, here: readonly number[]): readonly number[] {
  const compared = new Set(here);
  const first = here[0];
  const last = here.at(-1);
  const outer: number[] = [];
  const inner: number[] = [];

  for (const index of here) {
    for (const side of [index - 1, index + 1]) {
      if (side < 0 || side >= length || compared.has(side)) {
        continue;
      }
      const isOuter = (index === first && side < index) || (index === last && side > index);
      (isOuter ? outer : inner).push(side);
    }
  }

  const picked = new Set(compared);
  for (const index of [...outer, ...inner]) {
    if (picked.size >= AXIS_MAX_MARKS) {
      break;
    }
    picked.add(index);
  }
  return [...picked].toSorted((a, b) => a - b);
}

/**
 * One machine's rank among the figures recorded like its own.
 *
 * Ties share a rank, as a race does: the Apollo Guidance Computer and the Saturn
 * LVDC state the same clock, and calling one of them the faster would be an
 * ordering the sources do not support.
 */
function standingOf(ordered: readonly TimelinePoint[], point: TimelinePoint): CatalogStanding {
  const value = parseDecimal(point.value);
  const below = (candidates: readonly TimelinePoint[]): number =>
    candidates.filter((other) => compareDecimal(parseDecimal(other.value), value) < 0).length;

  const from = point.year - ERA_WINDOW_YEARS;
  const to = point.year + ERA_WINDOW_YEARS;
  const peers = ordered.filter((other) => other.year >= from && other.year <= to);

  return {
    systemSlug: point.systemSlug,
    systemName: point.systemName,
    rank: below(ordered) + 1,
    of: ordered.length,
    era:
      peers.length < ERA_MIN_MACHINES
        ? undefined
        : { rank: below(peers) + 1, of: peers.length, from, to },
  };
}

/**
 * The question a metric answers, for deciding whether a lone row is noise.
 *
 * Two metrics answer the same question when a reader would ask it once. "How
 * much memory does it have" is one question, and the Apollo Guidance Computer
 * answers it in machine words while every later machine answers it in bytes,
 * two metrics on purpose, because the conversion needs a word width the units do
 * not carry. Keyed by metric alone, neither machine's capacity survived a
 * comparison of the two: each was the only column stating its own metric, so
 * both rows were dropped and the reader was shown nothing at all where the real
 * answer is "both state it, in quantities that do not convert".
 *
 * This only ever keeps rows that would otherwise vanish. It never merges them,
 * the rows stay separate, in separate blocks, each saying what it is.
 */
const QUANTITY_KEYS: Partial<Record<MetricId, string>> = {
  'memory-capacity': 'memory-capacity',
  'memory-capacity-words': 'memory-capacity',
};

function quantityKeyOf(metric: MetricId): string {
  return QUANTITY_KEYS[metric] ?? metric;
}

function blockKeyOf(
  metric: MetricId,
  scope: MeasurementScope,
  role: ComponentRole | undefined,
): string {
  return `${metric}|${scope}|${role ?? ''}`;
}

/** Collects a section's rows into blocks, in metric-registry order. */
function blocksFor(
  rows: readonly CompareRow[],
  section: CompareSectionId,
): readonly CompareMetricBlock[] {
  const mine = rows.filter((row) => sectionOf(row.metric, row.scope) === section);
  const keys = [
    ...new Set(mine.map((row) => blockKeyOf(row.metric, row.scope, row.role))),
  ].toSorted((a, b) => METRIC_IDS.indexOf(metricOf(a)) - METRIC_IDS.indexOf(metricOf(b)));

  return keys.map((key): CompareMetricBlock => {
    const blockRows = mine
      .filter((row) => blockKeyOf(row.metric, row.scope, row.role) === key)
      .toSorted((a, b) => a.method.localeCompare(b.method));
    const first = blockRows[0];
    return {
      metric: metricOf(key),
      scope: first?.scope ?? 'whole-system',
      role: first?.role,
      label: first?.metricLabel ?? metricOf(key),
      anchor: `cmp-${key.replaceAll('|', '-').replace(/-$/, '')}`,
      rows: blockRows,
      methods: [...new Set(blockRows.map((row) => row.method))],
      // No row here holds two figures that may sit side by side. The block is
      // kept anyway: that the records do not line up is itself the finding, and
      // saying so beats an empty section the reader cannot account for.
      incomparable: blockRows.every((row) => row.statedCount < 2),
    };
  });
}

function metricOf(key: string): MetricId {
  return (key.split('|')[0] ?? '') as MetricId;
}
