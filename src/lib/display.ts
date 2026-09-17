// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Presentation helpers.
 *
 * These format figures for reading; they never compute one. A value arrives
 * here as the exact decimal string the source carried and leaves as text, with
 * its unit attached and any absence spelled out. Readers should not lose track
 * of either detail.
 */

import type { BenchmarkIdentity } from './data/comparability.ts';
import { getMethod, type EvidenceStage, type Provenance } from './data/methods.ts';
import { getMetric, type ConfidenceStatus, type EvidenceLevel } from './data/metrics.ts';
import type {
  Component,
  ComponentRole,
  InstructionSetFamily,
  QuantityValue,
  System,
  SystemType,
} from './data/schema.ts';
import { getUnit } from './data/units.ts';

/** Narrow no-break space, so grouped digits never wrap or drift apart. */
const GROUP_SEPARATOR = ' ';

/** No-break space, so a unit symbol never lands alone on the next line. */
const UNIT_SEPARATOR = ' ';

/**
 * Whether a unit is written as a word rather than as a symbol.
 *
 * A symbol is glued to its number, because "5" and "GHz" on two lines read as
 * two things. A word has to be allowed to wrap instead: "transistors" glued to
 * a fourteen-digit number is one unbreakable run wider than a comparison
 * column, and what a run that wide does is draw over the column beside it. The
 * digits stay together either way, held by the separator above.
 */
function isUnitWord(symbol: string): boolean {
  return symbol.length > 4 && /^\p{Ll}+$/u.test(symbol);
}

/**
 * Groups the integer part in threes. Applied only from five digits up, because
 * "1024" and "8192" read worse grouped than plain.
 */
export function formatDecimalDigits(value: string): string {
  const [integer = '', fraction] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign === '' ? integer : integer.slice(1);
  const grouped =
    digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR) : digits;
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

export interface FormattedQuantity {
  /** The figure as it should be read, unit included. */
  readonly text: string;
  /** True when the quantity is absent rather than measured. */
  readonly absent: boolean;
  /** The record's own explanation of an absence, if it gave one. */
  readonly note?: string | undefined;
}

const ABSENCE_LABELS = {
  unknown: 'unknown',
  'not-applicable': 'not applicable',
  // Worded as a fact about this catalog rather than about the machine, because
  // that is exactly what it is. A reader must be able to tell "nobody published
  // this" from "we have not read the page yet" without opening the record.
  unverified: 'not yet checked',
} as const;

export function formatQuantity(quantity: QuantityValue): FormattedQuantity {
  if (quantity.state !== 'value') {
    return {
      text: ABSENCE_LABELS[quantity.state],
      absent: true,
      note: quantity.note,
    };
  }

  const symbol = getUnit(quantity.unit)?.symbol ?? quantity.unit;
  const digits = formatDecimalDigits(quantity.value);
  if (symbol === '') {
    return { text: digits, absent: false };
  }
  const separator = isUnitWord(symbol) ? ' ' : UNIT_SEPARATOR;
  return { text: `${digits}${separator}${symbol}`, absent: false };
}

/** A ratio has no unit, so it is written the way a reader expects one: "15×". */
export function formatRatio(quantity: QuantityValue): string {
  if (quantity.state !== 'value') {
    return ABSENCE_LABELS[quantity.state];
  }
  return `${formatDecimalDigits(quantity.value)}×`;
}

/**
 * A derived claim's result, which is a ratio only when the formula produced one.
 *
 * Not every computation is a comparison. A clock recovered from a published
 * floating-point rate comes out in hertz. Writing it as "799 000 000×", as this
 * did until a formula returned something other than the dimensionless `unit`,
 * states a multiple of nothing.
 */
export function formatClaimResult(quantity: QuantityValue): string {
  if (quantity.state === 'value' && quantity.unit !== 'unit') {
    return formatQuantity(quantity).text;
  }
  return formatRatio(quantity);
}

export function metricLabel(metricId: string): string {
  return getMetric(metricId)?.label ?? metricId;
}

/**
 * The metric alone does not always name the figure. Two Geekbench results
 * differ only by benchmark variant, so a table listing both repeats one
 * heading, and below the restack threshold that is two cards with the same
 * title. The variant belongs where the eye lands, not only in the method note.
 */
export function measurementLabel(
  metricId: string,
  benchmark: BenchmarkIdentity | undefined,
): string {
  const label = metricLabel(metricId);
  return benchmark?.variant === undefined ? label : `${label}, ${benchmark.variant}`;
}

export function metricDescription(metricId: string): string | undefined {
  return getMetric(metricId)?.description;
}

export function methodLabel(methodId: string): string {
  return getMethod(methodId)?.label ?? humaniseIdentifier(methodId);
}

export function methodDescription(methodId: string): string | undefined {
  return getMethod(methodId)?.description;
}

/**
 * Who stated a figure, and whether the hardware had shipped when they did.
 *
 * It sits next to the method because neither belongs in the comparability
 * group. An announced clock can share a row with clocks from machines that
 * shipped, and this line keeps that difference visible.
 */
const PROVENANCE_NOTES: Record<Provenance, string> = {
  vendor: 'Stated by the vendor',
  independent: 'Published independently',
  community: 'From community documentation',
};

/** The same three, as the provenance of a figure this project computed. */
const DERIVED_PROVENANCE_NOTES: Record<Provenance, string> = {
  vendor: 'Computed here from figures the vendor stated',
  independent: 'Computed here from independently published figures',
  community: 'Computed here from community documentation',
};

export function attributionNote(
  provenance: Provenance,
  evidenceStage: EvidenceStage,
  status?: ConfidenceStatus,
): string {
  // A derived figure is this project's arithmetic over somebody else's figures,
  // so the provenance describes its inputs. Saying only "stated by the vendor"
  // next to a number no vendor ever wrote would be the wrong claim.
  const who =
    status === 'derived' ? DERIVED_PROVENANCE_NOTES[provenance] : PROVENANCE_NOTES[provenance];
  return evidenceStage === 'pre-launch' ? `${who}, before the hardware shipped` : who;
}

/** "The manufacturer publishes none" identifies who did not state the figure. */
const ABSENCE_BY_PROVENANCE: Record<Provenance, string> = {
  vendor: 'The manufacturer publishes none',
  independent: 'No independent figure is recorded',
  community: 'No community figure is recorded',
};

/** "…the figure shown is the manufacturer's" identifies the number's source. */
const SHOWN_BY_PROVENANCE: Record<Provenance, string> = {
  vendor: 'the figure shown is the manufacturer’s',
  independent: 'the figure shown was published independently',
  community: 'the figure shown comes from community documentation',
};

/**
 * One line for a recorded absence that shares a cell with a stated value.
 *
 * Since provenance is not part of the comparability group, "the manufacturer
 * states no clock" and a clock somebody else established belong in the same row.
 * Shown as two entries they would read as two figures, one of them missing; this
 * makes the absence clear: it is a fact about the evidence, next to the number
 * the reader came for.
 */
export function absenceMarker({
  absentProvenance,
  absentText,
  shownProvenance,
  note,
}: {
  readonly absentProvenance: Provenance;
  readonly absentText: string;
  readonly shownProvenance?: Provenance | undefined;
  readonly note?: string | undefined;
}): string {
  const missing = ABSENCE_BY_PROVENANCE[absentProvenance];
  const source = shownProvenance === undefined ? '' : `; ${SHOWN_BY_PROVENANCE[shownProvenance]}`;
  return `${missing} (recorded as ${absentText})${source}.${note === undefined ? '' : ` ${note}`}`;
}

/**
 * A plain-language definition of the `provisional` badge.
 *
 * The badge is a single word of jargon sitting next to a number, and a reader
 * who does not already know the term cannot guess whether it is a warning about
 * the machine or about the record. It is about the record. This text appears
 * wherever the badge does, instead of being left in the methodology chapter.
 */
export const PROVISIONAL_EXPLAINER =
  'A figure marked provisional is recorded but not accepted: its evidence is unsettled. It may ' +
  'rely on one source, an unconfirmed announcement, or a digit read from a damaged scan. The ' +
  'reason appears under the figure. The catalog shows the figure but never uses it in a ' +
  'multiplier.';

/** Where the badge's full definition lives, without the deployment prefix. */
export const PROVISIONAL_EXPLAINER_PATH = '/methodology/02-confidence-and-absence/';

const STATUS_LABELS: Record<ConfidenceStatus, string> = {
  measured: 'Measured',
  theoretical: 'Theoretical',
  'vendor-rated': 'Vendor-rated',
  estimated: 'Estimated',
  derived: 'Derived',
};

export function statusLabel(status: ConfidenceStatus): string {
  return STATUS_LABELS[status];
}

const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  confirmed: 'Confirmed',
  reported: 'Reported',
  rumored: 'Rumored',
};

export function evidenceLabel(level: EvidenceLevel): string {
  return EVIDENCE_LABELS[level];
}

/**
 * Roles are written out because `humaniseIdentifier` would produce "Main cpu"
 * and "Co processor", neither of which uses the intended capitalization.
 */
const ROLE_LABELS: Record<ComponentRole, string> = {
  'main-cpu': 'Main CPU',
  'co-processor': 'Co-processor',
  'sound-cpu': 'Sound CPU',
  gpu: 'GPU',
  'system-memory': 'System memory',
  'video-memory': 'Video memory',
  'unified-memory': 'Unified memory',
  cache: 'Cache',
  storage: 'Storage',
};

export function roleLabel(role: ComponentRole): string {
  return ROLE_LABELS[role];
}

/**
 * Instruction sets as their makers capitalize them. Same reason as the roles
 * above: `humaniseIdentifier` renders "Mos 6502" and "Superh".
 */
/**
 * Typed as `Record<string, string>` so the facet counter can look up a map key
 * that has lost its type on the way, and `satisfies` so the table still has to
 * cover every lineage the schema admits.
 */
const INSTRUCTION_SET_LABELS: Record<string, string> = {
  'mos-6502': 'MOS 6502',
  'motorola-68000': 'Motorola 68000',
  mips: 'MIPS',
  superh: 'SuperH',
  power: 'Power',
  x86: 'x86',
  arm: 'Arm',
} satisfies Record<InstructionSetFamily, string>;

/**
 * An identifier outside the table falls back instead of throwing: a new
 * lineage should render readably before someone capitalizes it properly.
 */
export function instructionSetLabel(family: string): string {
  return INSTRUCTION_SET_LABELS[family] ?? humaniseIdentifier(family);
}

/**
 * Turns an identifier into something readable without inventing words for it.
 * `guidance-computer` becomes "Guidance computer", and an identifier this
 * misreads is a sign the identifier was badly chosen.
 */
export function humaniseIdentifier(id: string): string {
  const spaced = id.replaceAll('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `1999-03-02` reads as "March 1999" because the day is rarely the point. */
export function formatPartialDate(date: string): string {
  const [year = '', month] = date.split('-');
  if (month === undefined) {
    return year;
  }
  const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${monthName} ${year}`;
}

/**
 * Category names in the plural, because a category page holds many machines and
 * a breadcrumb pointing at one reads as a claim about this machine alone.
 * Only the types that pluralize irregularly are listed; the rest take an "s".
 */
const SYSTEM_TYPE_PLURALS: Partial<Record<SystemType, string>> = {
  'guidance-computer': 'Guidance computers',
  'home-computer': 'Home computers',
  'personal-computer': 'Personal computers',
  accelerator: 'Graphics hardware',
};

const COMPONENT_KIND_PLURALS = {
  cpu: 'Processors',
  gpu: 'Graphics chips',
  memory: 'Memory',
} as const;

export function systemTypeLabel(type: SystemType): string {
  return SYSTEM_TYPE_PLURALS[type] ?? `${humaniseIdentifier(type)}s`;
}

export function componentKindLabel(kind: Component['kind']): string {
  return COMPONENT_KIND_PLURALS[kind];
}

/** The types that have records, ordered by each type's earliest release. */
export function systemTypesByFirstRelease(systems: readonly System[]): readonly SystemType[] {
  const earliest = new Map<SystemType, string>();
  for (const system of systems) {
    const seen = earliest.get(system.type);
    if (seen === undefined || system.releaseDate < seen) {
      earliest.set(system.type, system.releaseDate);
    }
  }
  return [...earliest.keys()].toSorted((a, b) =>
    (earliest.get(a) ?? '').localeCompare(earliest.get(b) ?? ''),
  );
}
