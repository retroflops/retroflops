// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The Compare view.
 *
 * Written as a Preact component rather than an Astro one so that a single
 * implementation serves both places a comparison appears: rendered to static
 * HTML on the preset pages, where it ships no JavaScript at all, and hydrated
 * inside the interactive selector, where the reader assembles their own.
 *
 * The page is two layers, and the order matters. First comes a catalog card: six
 * questions, every record's answer, and bars where the answers can be read
 * together. It says what these machines are before anything is divided. Then come the
 * sections: one quantity of one part of a machine per block, each a small table
 * of its own with methods down the side and records across. Repeating the record
 * names per block costs a little space and buys two things. Every block is
 * comprehensible on its own, and the layout can turn from columns into stacked
 * cards at narrow widths without a single row losing its heading.
 *
 * A cell shows its value, its bar and the two labels that make the value
 * intelligible at all. Everything else, including how the figure was obtained,
 * its caveat, its sources, the multiplier and the audit trail behind it,
 * lives in one expander. Nothing is hidden that was visible: it is one click
 * further away, which is where the audit trail already was.
 *
 * Nothing here decides anything. Values, multipliers, bar lengths and refusals
 * arrive decided from `compare.ts`; this file only chooses the words for them.
 */

import { Fragment } from 'preact';
import { useState } from 'preact/hooks';

import {
  type CatalogAxis,
  type CatalogStanding,
  type CompareBar,
  type CompareCell,
  type CompareElsewhere,
  type CompareFigure,
  type CompareMetricBlock,
  type CompareProblem,
  type CompareRatio,
  type CompareRatioRefusal,
  type CompareSubject,
  type Comparison,
  type GlanceCell,
  type GlanceRow,
} from '~/lib/compare';
import type { MeasurementScope } from '~/lib/data/metrics';
import {
  absenceMarker,
  attributionNote,
  evidenceLabel,
  methodLabel,
  PROVISIONAL_EXPLAINER,
  PROVISIONAL_EXPLAINER_PATH,
  roleLabel,
  statusLabel,
} from '~/lib/display';
import { route } from '~/lib/paths';

interface Props {
  readonly comparison: Comparison;
  /**
   * Whether to offer a control that opens every breakdown at once.
   *
   * True only from the island. On a preset page nothing would be listening, and
   * a control that does nothing is worse than no control.
   */
  readonly expandable?: boolean;
}

/**
 * Why a selection could not be used, in words a reader can act on. A shared URL
 * naming a record that has since been renamed lands here, so each message says
 * what to do rather than what went wrong internally.
 */
function problemText(problem: CompareProblem): string {
  switch (problem.code) {
    case 'too-few': {
      return 'A comparison needs at least two records. Pick another one.';
    }
    case 'too-many': {
      return `Four records is the most this view will show, and ${problem.count} were asked for. The rest are ignored rather than squeezed in.`;
    }
    case 'mixed-kinds': {
      return 'A comparison holds either whole systems or components, not both. A machine and one of its parts answer different questions, and putting them in one column would imply they answer the same one.';
    }
    case 'unknown-record': {
      return `No ${problem.kind} in the catalog has the identifier “${problem.slug}”. It may have been renamed since this link was made.`;
    }
    case 'unknown-configuration': {
      return `“${problem.slug}” has no variant called “${problem.configurationId}”, so every variant of it is shown.`;
    }
    case 'repeated-record': {
      return `“${problem.slug}” was asked for twice; the repeat is ignored.`;
    }
  }
}

/** The single sentence that explains a withheld multiplier. */
function refusalText(refusals: readonly CompareRatioRefusal[], baseline: string): string {
  if (refusals.includes('metric-forbids-ratio')) {
    return 'No multiplier: this quantity is not defined consistently enough for one figure to be divided by another.';
  }
  if (refusals.includes('provisional-record')) {
    return 'No multiplier: one of these figures is provisional, and provisional records never feed a multiplier.';
  }
  if (refusals.includes('variant-ambiguous')) {
    return 'No multiplier: this figure differs between variants, so choose a variant above first.';
  }
  if (refusals.includes('several-parts')) {
    return 'No multiplier: the machine states this quantity for more than one part, so there is no single figure to divide.';
  }
  if (refusals.includes('baseline-has-no-value')) {
    return `No multiplier: ${baseline} records no value here, so there is nothing to divide by.`;
  }
  if (refusals.includes('no-value')) {
    return 'No multiplier: no value is recorded here.';
  }
  if (refusals.includes('non-positive-value')) {
    return 'No multiplier: a multiplier needs both figures to be greater than zero.';
  }
  // Everything left is a mismatch the row itself should have prevented, or a
  // stale export. Naming the codes beats inventing prose for a bug.
  return `No multiplier (${refusals.join(', ')}).`;
}

/**
 * The same refusal in three words, for the line the reader sees before opening
 * anything. It says which kind of refusal this is; the sentence inside says the
 * rest. A summary long enough to be a sentence would put prose back where the
 * number belongs.
 */
function refusalSummary(refusals: readonly CompareRatioRefusal[]): string {
  if (refusals.includes('metric-forbids-ratio')) {
    return 'not a ratio';
  }
  if (refusals.includes('provisional-record')) {
    return 'provisional figure';
  }
  if (refusals.includes('variant-ambiguous')) {
    return 'variant not chosen';
  }
  if (refusals.includes('several-parts')) {
    return 'several parts stated';
  }
  if (refusals.includes('baseline-has-no-value')) {
    return 'baseline states none';
  }
  if (refusals.includes('no-value')) {
    return 'no value here';
  }
  return 'no multiplier';
}

/** `a`, `a and b`, `a, b and c`: a list that reads as a sentence. */
function listOf(items: readonly string[]): string {
  if (items.length < 2) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** How a comparability group reads when it has to be named in prose. */
function groupDescription(row: CompareMetricBlock['rows'][number]): string {
  const method = methodLabel(row.method).toLowerCase();
  if (row.benchmark === undefined) {
    return method;
  }
  const variant = row.benchmark.variant === undefined ? '' : ` ${row.benchmark.variant}`;
  return `${method} under ${row.benchmark.id} ${row.benchmark.version}${variant}`;
}

/**
 * How a block explains itself when nothing in it lines up.
 *
 * Three different things produce an empty comparison, and telling them apart is
 * the whole value of the message: the records answered the question in
 * incompatible ways, they answered it with an explicit absence, or only one of
 * them answered it at all.
 */
function incomparableText(block: CompareMetricBlock): string {
  const paired = block.rows.some(
    (row) => row.cells.filter((cell) => cell.figures.length > 0).length >= 2,
  );
  if (paired) {
    return 'Both records address this quantity, but neither states a value. The figures are recorded as an explicit absence, so there is nothing to compare.';
  }
  if (block.rows.length > 1) {
    const groups = [...new Set(block.rows.map(groupDescription))];
    return `These figures belong to different comparability groups (${listOf(groups)}). They are shown separately, and no multiplier is produced.`;
  }
  return 'Only one of these records states this figure in this form, so there is nothing here to compare it with.';
}

/** Where a machine states a quantity it does not state in the row asking. */
function elsewhereText(elsewhere: CompareElsewhere): string {
  return elsewhere.kind === 'role'
    ? `as ${roleLabel(elsewhere.role).toLowerCase()}`
    : 'for the whole machine';
}

function subjectLabel(subject: CompareSubject): string {
  return subject.configuration === undefined
    ? subject.name
    : `${subject.name} (${subject.configuration.label})`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A bar, which is a length and nothing else.
 *
 * Hidden from assistive technology because the figure beside it is the same
 * information stated exactly. The timeline chart uses the same arrangement.
 * It is drawn in CSS with no SVG and no script, so it works on the
 * preset pages, which ship no JavaScript at all.
 *
 * The baseline is marked by a rule across every bar in the row rather than by a
 * color, because color would have to encode magnitude to be read, and this is
 * the one thing a bar must not do twice.
 */
function Bar({
  bar,
  baselineFraction,
}: {
  readonly bar: CompareBar;
  readonly baselineFraction?: number | undefined;
}) {
  return (
    <span
      class={`cmp-bar${bar.provisional ? ' cmp-bar--provisional' : ''}`}
      aria-hidden="true"
      style={{ '--cmp-bar': percent(bar.fraction) }}
    >
      <span class="cmp-bar__fill" />
      {baselineFraction !== undefined && baselineFraction > 0 && (
        <span class="cmp-bar__baseline" style={{ '--cmp-baseline': percent(baselineFraction) }} />
      )}
    </span>
  );
}

/**
 * One figure as the reader first meets it: the value, the two labels without
 * which the value is ambiguous, and the bar.
 *
 * `part` and `variant` stay visible because they are what tell 3.2 GHz from
 * 2.064 GHz on one machine. Everything else about the figure is in the
 * breakdown under the cell.
 */
function Figure({
  figure,
  baselineFraction,
  showOrigin = false,
}: {
  readonly figure: CompareFigure;
  readonly baselineFraction?: number | undefined;
  /**
   * Whether to name the part the figure belongs to.
   *
   * False in the sections, where the block heading and the expander below carry
   * it. True on the card, which has no expander and where three bandwidths in
   * one cell are unreadable without knowing which pool each describes. Also,
   * where a processor's rated draw beside a console's would otherwise look like
   * the same quantity.
   */
  readonly showOrigin?: boolean;
}) {
  return (
    <span class="cmp-figure">
      <span class="cmp-figure__line">
        <span class={figure.absent ? 'cmp-figure__absent' : 'cmp-figure__value numeric'}>
          {figure.text}
        </span>
        {showOrigin && figure.origin !== undefined && (
          <span class="cmp-figure__part">{figure.origin}</span>
        )}
        {figure.part !== undefined && <span class="cmp-figure__part">{figure.part}</span>}
        {figure.variant !== undefined && <span class="cmp-figure__part">{figure.variant}</span>}
        {figure.measurement.editorialStatus === 'provisional' && (
          <span class="badge badge--provisional">provisional</span>
        )}
        {!figure.absent && figure.measurement.evidenceLevel !== undefined && (
          <span class={`badge badge--${figure.measurement.evidenceLevel}`}>
            {evidenceLabel(figure.measurement.evidenceLevel)}
          </span>
        )}
      </span>
      {figure.note !== undefined && <span class="cmp-figure__note">{figure.note}</span>}
      {figure.bar !== undefined && <Bar bar={figure.bar} baselineFraction={baselineFraction} />}
    </span>
  );
}

/**
 * What a cell shows when one record answers the same question twice.
 *
 * Since a figure's provenance no longer splits its comparability group, a
 * recorded absence and a stated value can land in one cell. "Apple publishes no
 * clock" beside a clock somebody else established. Printing both as entries
 * would read as two figures, one of which is missing, which is not what
 * happened. So the value is the cell, and the absence becomes one short line
 * under it saying what is missing and where the number on show came from.
 *
 * A cell whose figures are all absences is unchanged: then the absence *is* the
 * answer.
 */
function CellFigures({
  figures,
  baselineFraction,
}: {
  readonly figures: readonly CompareFigure[];
  readonly baselineFraction?: number | undefined;
}) {
  const stated = figures.filter((figure) => !figure.absent);
  const absent = figures.filter((figure) => figure.absent);

  if (stated.length === 0) {
    return (
      <>
        {figures.map((figure) => (
          <Figure key={figure.measurement.id} figure={figure} />
        ))}
      </>
    );
  }

  return (
    <>
      {stated.map((figure) => (
        <Figure key={figure.measurement.id} figure={figure} baselineFraction={baselineFraction} />
      ))}
      {absent.map((figure) => (
        <span key={figure.measurement.id} class="cmp-figure__marker">
          {absenceMarker({
            absentProvenance: figure.measurement.provenance,
            absentText: figure.text,
            shownProvenance: stated[0]?.measurement.provenance,
            note: figure.note,
          })}
        </span>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The breakdown under a cell                                                  */
/* -------------------------------------------------------------------------- */

/** The multiplier's audit trail: formula, version, inputs, rounding and caveat. */
function RatioDetail({ ratio }: { readonly ratio: CompareRatio }) {
  return (
    <>
      <dt>Multiplier</dt>
      <dd>
        <code>{ratio.expression}</code> ({ratio.formula.id} v{ratio.formula.version}, to{' '}
        {ratio.significantDigits} significant digit
        {ratio.significantDigits === 1 ? '' : 's'})
        <ul>
          {ratio.inputs.map((input) => (
            <li key={input.subject}>
              {input.subject}: <span class="numeric">{input.text}</span>
            </li>
          ))}
        </ul>
        <span class="cmp-detail__caveat">{ratio.caveat}</span>
      </dd>
    </>
  );
}

/**
 * Everything about a cell that is not its value.
 *
 * One expander, not two. This replaces the multiplier's own expander rather
 * than wrapping it, so a reader never opens one disclosure to find the
 * next. The summary carries the multiplier, the word `baseline`, or three
 * words that name the refusal. It flags a caveat inside, so nothing that was a
 * warning becomes invisible. It becomes one click away,
 * which is where the audit trail already lived.
 */
function Breakdown({
  cell,
  baselineName,
  isBaseline,
  open,
}: {
  readonly cell: CompareCell;
  readonly baselineName: string;
  readonly isBaseline: boolean;
  readonly open?: boolean | undefined;
}) {
  const caveats = cell.figures.flatMap((figure) =>
    figure.measurement.caveat === undefined ? [] : [figure.measurement.caveat],
  );
  const sourceIds = [...new Set(cell.figures.flatMap((figure) => figure.measurement.sourceIds))];
  const refused = cell.ratio === undefined && cell.ratioRefusals.length > 0;

  return (
    <details class="cmp-detail" open={open}>
      <summary>
        {isBaseline ? (
          <span class="cmp-detail__baseline">baseline</span>
        ) : cell.ratio === undefined ? (
          <span class="cmp-detail__refusal">{refusalSummary(cell.ratioRefusals)}</span>
        ) : (
          <>
            <span class="cmp-detail__ratio numeric">{cell.ratio.text}</span>
            <span class="cmp-detail__label">the baseline</span>
          </>
        )}
        {caveats.length > 0 && <span class="cmp-detail__flag">caveat</span>}
      </summary>

      <dl class="cmp-detail__body">
        <dt>Recorded as</dt>
        <dd>
          <ul>
            {cell.figures.map((figure) => (
              <li key={figure.measurement.id}>
                {figure.origin !== undefined && <span>{figure.origin}: </span>}
                {!figure.absent && `${statusLabel(figure.measurement.status)}. `}
                {attributionNote(
                  figure.measurement.provenance,
                  figure.measurement.evidenceStage,
                  figure.measurement.status,
                )}
                .
              </li>
            ))}
          </ul>
        </dd>

        {caveats.length > 0 && (
          <>
            <dt>Caveat</dt>
            <dd>
              {caveats.map((caveat) => (
                <span key={caveat} class="cmp-detail__caveat">
                  {caveat}
                </span>
              ))}
            </dd>
          </>
        )}

        {cell.ratio !== undefined && <RatioDetail ratio={cell.ratio} />}
        {refused && (
          <>
            <dt>Multiplier</dt>
            <dd>{refusalText(cell.ratioRefusals, baselineName)}</dd>
          </>
        )}

        <dt>Sources</dt>
        <dd>
          <ul>
            {sourceIds.map((id) => (
              <li key={id}>
                <a class="wrap-anywhere" href={route(`/sources/${id}/`)}>
                  {id}
                </a>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </details>
  );
}

function Cell({
  cell,
  subject,
  baselineName,
  baselineFraction,
  isBaseline,
  open,
}: {
  readonly cell: CompareCell;
  readonly subject: CompareSubject | undefined;
  readonly baselineName: string;
  readonly baselineFraction?: number | undefined;
  readonly isBaseline: boolean;
  readonly open?: boolean | undefined;
}) {
  return (
    <td class="cmp-cell">
      {/* Visible only when the layout stacks, where the column header is out of sight. */}
      <span class="cmp-cell__for">{subject === undefined ? '' : subjectLabel(subject)}</span>
      {cell.figures.length === 0 ? (
        <span class="cmp-figure__absent">
          {cell.statedAs === undefined ? 'not recorded' : 'built differently'}
          {cell.statedAs !== undefined && (
            <span class="cmp-figure__note">
              Stated {listOf(cell.statedAs.map(elsewhereText))}, in another row here.
            </span>
          )}
        </span>
      ) : (
        <>
          <CellFigures figures={cell.figures} baselineFraction={baselineFraction} />
          <Breakdown cell={cell} baselineName={baselineName} isBaseline={isBaseline} open={open} />
        </>
      )}
    </td>
  );
}

function Block({
  block,
  subjects,
  baselineName,
  open,
}: {
  readonly block: CompareMetricBlock;
  readonly subjects: readonly CompareSubject[];
  readonly baselineName: string;
  readonly open?: boolean | undefined;
}) {
  const qualifier = [
    block.role === undefined ? undefined : roleLabel(block.role),
    block.scope,
  ].filter((part) => part !== undefined);

  return (
    <div class="cmp-block stack" id={block.anchor}>
      <h3 class="cmp-block__title">
        {block.label}
        <span class="cmp-block__qualifier">{qualifier.join(' · ')}</span>
      </h3>

      {block.incomparable && <p class="cmp-block__warning">{incomparableText(block)}</p>}

      {/*
       * The column count is both a custom property, for the grid template, and a
       * class, because the width at which columns become readable depends on how
       * many there are and a container query cannot do that arithmetic.
       */}
      <table
        class={`cmp-table cmp-table--${Math.min(subjects.length, 4)}`}
        style={{ '--cmp-columns': subjects.length }}
      >
        <thead>
          <tr>
            <th scope="col">Method</th>
            {subjects.map((subject) => (
              <th key={subject.id} scope="col">
                <a href={route(subject.path)}>{subject.name}</a>
                {subject.configuration !== undefined && (
                  <span class="cmp-table__variant">{subject.configuration.label}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => {
            const baselineFraction = row.cells[0]?.figures.find(
              (figure) => figure.bar !== undefined,
            )?.bar?.fraction;
            return (
              <tr key={row.group}>
                <th scope="row">
                  {methodLabel(row.method)}
                  {row.benchmark !== undefined && (
                    <span class="cmp-table__benchmark">
                      {row.benchmark.id} {row.benchmark.version}
                      {row.benchmark.variant !== undefined && `, ${row.benchmark.variant}`}
                    </span>
                  )}
                  {row.barScale === 'log' && <span class="cmp-table__scale">log scale</span>}
                </th>
                {row.cells.map((cell) => (
                  <Cell
                    key={cell.subjectIndex}
                    cell={cell}
                    subject={subjects[cell.subjectIndex]}
                    baselineName={baselineName}
                    baselineFraction={baselineFraction}
                    isBaseline={cell.subjectIndex === 0}
                    open={open}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* At a glance                                                                 */
/* -------------------------------------------------------------------------- */

/** `1st`, `2nd`, `13th`: a rank as it is written beside a count. */
function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) {
    return `${rank}th`;
  }
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] ?? 'th';
  return `${rank}${suffix}`;
}

/** A rank at either end of the order reads as a superlative, not as a number. */
function place(rank: number, of: number): string {
  if (rank === 1) {
    return 'the lowest';
  }
  if (rank === of) {
    return 'the highest';
  }
  return `${ordinal(rank)}-lowest`;
}

/**
 * Where one compared machine's figure stands, in words.
 *
 * A rank rather than a multiple, and phrased as a statement about the recorded
 * figures rather than about speed: what the catalog can support is that these
 * numbers fall in this order, not that one machine outperformed another. Short,
 * because four columns produce four of these under every row, and four full
 * sentences of preamble would bury the two numbers that matter.
 */
function standingText(standing: CatalogStanding): string {
  const overall = `${place(standing.rank, standing.of)} of the ${standing.of} figures recorded this way`;
  if (standing.era === undefined) {
    return `${overall}.`;
  }
  return `${overall}, and ${place(standing.era.rank, standing.era.of)} of the ${standing.era.of} from ${standing.era.from}–${standing.era.to}.`;
}

/**
 * These machines and their neighbors on one question, named.
 *
 * Never the whole catalog: a track of anonymous ticks says only that the
 * catalog is large, and its ends would be the same two machines under every
 * comparison of that metric. What is drawn instead is the compared records with
 * whoever stands immediately either side of them, each one named and carrying
 * its own figure, under a line saying where the compared records rank, among
 * everything recorded alike, and among the machines of their own years. That is
 * the question the columns cannot answer: whether a figure was remarkable for
 * its time.
 *
 * The names are listed under the track in the order they sit on it rather than
 * floated above their own marks: a machine name is long enough that six of them
 * anchored to six positions overlap at any width a table cell has, and a label
 * lying about which tick it belongs to is worse than one read in order. So the
 * track keeps the spacing, which a picture communicates better than a list,
 * while the names, figures and ranks stay ordinary text.
 */
function CatalogScale({ axis }: { readonly axis: CatalogAxis }) {
  return (
    <div class="glance-axis">
      <span class="glance-axis__track" aria-hidden="true">
        {axis.marks.map((mark) => (
          <span
            key={mark.systemSlug}
            class={`glance-axis__mark${mark.highlighted ? ' is-compared' : ''}`}
            style={{ '--cmp-at': percent(mark.position) }}
          />
        ))}
      </span>
      <ol class="glance-axis__legend">
        {axis.marks.map((mark) => (
          <li
            key={mark.systemSlug}
            class={`glance-axis__entry${mark.highlighted ? ' is-compared' : ''}`}
          >
            <span class="glance-axis__figure">{mark.text}</span>
            <span class="glance-axis__name">{mark.systemName}</span>
          </li>
        ))}
      </ol>
      <ul class="glance-axis__standings">
        {axis.standings.map((standing) => (
          <li key={standing.systemSlug}>
            <b>{standing.systemName}</b> — {standingText(standing)}
          </li>
        ))}
      </ul>
      <p class="glance-axis__scale">
        {/*
         * The scale is always named, never only when it is logarithmic: a log
         * track read as a linear one understates the gaps by orders of
         * magnitude, and a reader who has to infer which one they are looking
         * at will infer the wrong one.
         */}
        Positions on a {axis.scale === 'log' ? 'logarithmic' : 'linear'} scale.{' '}
        <a href={route(`/timeline/${axis.seriesSlug}/`)}>See all {axis.machineCount} over time</a>.
      </p>
    </div>
  );
}

function GlanceCellView({
  cell,
  subject,
  baselineFraction,
}: {
  readonly cell: GlanceCell;
  readonly subject: CompareSubject | undefined;
  readonly baselineFraction?: number | undefined;
}) {
  return (
    <td class="cmp-cell">
      <span class="cmp-cell__for">{subject === undefined ? '' : subjectLabel(subject)}</span>
      {cell.figures.length === 0 ? (
        <span class="cmp-figure__absent">
          {cell.state === 'not-applicable'
            ? 'not applicable'
            : // Said of this catalog rather than of the machine, because an
              // unread source is our gap and not the manufacturer's silence.
              cell.state === 'unverified'
              ? 'not yet checked'
              : // A pinned variant narrows what the record answers with: the
                // machine may state the quantity for a configuration other than
                // the one on show, and a flat "not recorded" would read as a
                // claim about the whole record.
                subject?.configuration === undefined
                ? 'not recorded'
                : 'not recorded for this variant'}
          {cell.note !== undefined && <span class="cmp-figure__note">{cell.note}</span>}
        </span>
      ) : (
        cell.figures.map((figure) => (
          <Figure
            key={figure.measurement.id}
            figure={figure}
            baselineFraction={baselineFraction}
            showOrigin
          />
        ))
      )}
    </td>
  );
}

/** Scopes as they read inside a sentence, rather than as the identifiers they are. */
const SCOPE_PHRASES: Record<MeasurementScope, string> = {
  cpu: 'the processor',
  gpu: 'the graphics processor',
  memory: 'the memory',
  storage: 'the storage',
  'whole-system': 'the whole machine',
};

/**
 * Why a card row has no bars, in terms of what differs.
 *
 * Naming the wrong difference is worse than naming none: four rated power
 * figures obtained by one method, one of them a processor's and one a whole
 * console's, are not "different methods", and a reader told they are learns
 * something false about a catalog that is in fact being careful.
 */
function mismatchText(row: GlanceRow): string {
  if (row.methods.length > 1) {
    return `These records state this by different methods (${listOf(row.methods)}). The figures are shown separately, and no bar is drawn.`;
  }
  if (row.scopes.length > 1) {
    return `These figures describe different parts of a machine (${listOf(row.scopes.map((scope) => SCOPE_PHRASES[scope]))}). The figures are shown separately, and no bar is drawn.`;
  }
  return 'These figures do not all belong to one comparability group, so they are not put side by side and no bar is drawn.';
}

/** How many records answered a card row with a value. */
function statedCount(row: GlanceRow): number {
  return row.cells.filter((cell) => cell.state === 'stated').length;
}

/**
 * Whether the line under a card row has anything to say.
 *
 * A row every record answered with `not applicable` has no mismatch to explain,
 * no block below to point at and no place on a catalog axis. An empty line
 * under it would be a promise of an explanation that is not coming.
 */
function hasAside(row: GlanceRow): boolean {
  return (
    row.axis !== undefined ||
    (row.comparable && row.anchor !== undefined) ||
    (!row.comparable && statedCount(row) >= 2)
  );
}

/** The line under a card row: why there are no bars, and where the reckoning is. */
function GlanceAside({ row }: { readonly row: GlanceRow }) {
  return (
    <>
      {!row.comparable && statedCount(row) >= 2 && (
        <p class="glance__mismatch">
          {mismatchText(row)}
          {row.anchor !== undefined && (
            <>
              {' '}
              <a href={`#${row.anchor}`}>See how they are accounted for</a>.
            </>
          )}
        </p>
      )}
      {row.comparable && row.anchor !== undefined && (
        <p class="glance__link">
          {/*
           * Never "multipliers": a row can be perfectly comparable and still
           * produce none, because the metric refuses ratios. The block below
           * always has the methods, the caveats and the sources.
           */}
          <a href={`#${row.anchor}`}>Methods, caveats and sources for {row.label.toLowerCase()}</a>
        </p>
      )}
      {/*
       * Folded away by default. Open, the axis runs to a third of the card's
       * height on two records and to a screen and a half of a phone on four,
       * and six questions each carrying that stop being a card at all. The
       * summary is a promise rather than the answer. It stays one line at two
       * records and at four. `details` keeps the promise without a script, which
       * is what the preset pages need.
       */}
      {row.axis !== undefined && (
        <details class="cmp-detail glance-axis-detail">
          <summary>
            {/*
             * The caret hangs off this span rather than off the summary, so it
             * flows with the words. As a flex item of its own it took a line to
             * itself the moment the sentence had to wrap, which on a phone is
             * always.
             */}
            <span class="glance-axis-detail__label">
              Where these sit among {row.axis.machineCount} machines recorded this way
            </span>
          </summary>
          <CatalogScale axis={row.axis} />
        </details>
      )}
    </>
  );
}

/**
 * The catalog card.
 *
 * A card, not a comparison: it answers "what does each of these machines state"
 * rather than "which is faster", and that is exactly what lets it put beside
 * each other quantities the sections below are right to keep apart. The six
 * questions are `BACKBONE` from the coverage report, so a machine that leaves
 * one unasked fails the build rather than quietly showing a hole here.
 */
function Glance({
  glance,
  subjects,
}: {
  readonly glance: readonly GlanceRow[];
  readonly subjects: readonly CompareSubject[];
}) {
  const columns = Math.min(subjects.length, 4);
  return (
    <section class="glance stack" aria-labelledby="at-a-glance">
      <div class="stack">
        <h2 id="at-a-glance">At a glance</h2>
        <p class="prose meta">
          This card lists what each record states. These are the six questions every machine in the
          catalog is asked. A row with answers from different methods has no bar or multiplier; the
          line beneath it explains the difference.
        </p>
      </div>

      <table
        class={`cmp-table glance-table cmp-table--${columns}`}
        style={{ '--cmp-columns': subjects.length }}
      >
        <thead>
          <tr>
            <th scope="col">Question</th>
            {subjects.map((subject) => (
              <th key={subject.id} scope="col">
                <a href={route(subject.path)}>{subject.name}</a>
                <span class="glance__meta">{subject.manufacturer}</span>
                <span class="glance__meta">
                  {[subject.typeLabel, subject.year]
                    .filter((part) => part !== undefined)
                    .join(' · ')}
                </span>
                {subject.configuration !== undefined && (
                  <span class="cmp-table__variant">{subject.configuration.label}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {glance.map((row) => {
            const baselineFraction = row.cells[0]?.figures.find(
              (figure) => figure.bar !== undefined,
            )?.bar?.fraction;
            return (
              <Fragment key={row.id}>
                <tr>
                  <th scope="row">
                    {row.label}
                    {row.barScale === 'log' && <span class="cmp-table__scale">log scale</span>}
                  </th>
                  {row.cells.map((cell) => (
                    <GlanceCellView
                      key={cell.subjectIndex}
                      cell={cell}
                      subject={subjects[cell.subjectIndex]}
                      baselineFraction={baselineFraction}
                    />
                  ))}
                </tr>
                {hasAside(row) && (
                  <tr class="glance__aside-row">
                    <td class="glance__aside" colSpan={subjects.length + 1}>
                      <GlanceAside row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export default function ComparisonView({ comparison, expandable = false }: Props) {
  const { subjects, sections, problems, baseline, glance } = comparison;
  const baselineName = baseline === undefined ? 'the first record' : subjectLabel(baseline);
  /**
   * Undefined until the reader asks, so every expander keeps its own state and
   * the static pages render with none of them forced open.
   */
  const [openAll, setOpenAll] = useState<boolean | undefined>(undefined);

  // Shown only where the badge is, so a reader never meets the word without it.
  const hasProvisional = sections.some((section) =>
    section.blocks.some((block) =>
      block.rows.some((row) =>
        row.cells.some((cell) =>
          cell.figures.some((figure) => figure.measurement.editorialStatus === 'provisional'),
        ),
      ),
    ),
  );

  return (
    <div class="cmp stack-l">
      {problems.length > 0 && (
        <output class="cmp-problems stack">
          {problems.map((problem) => (
            <p key={`${problem.code}-${'slug' in problem ? problem.slug : ''}`}>
              {problemText(problem)}
            </p>
          ))}
        </output>
      )}

      {glance.length > 0 && <Glance glance={glance} subjects={subjects} />}

      {sections.length === 0 ? (
        subjects.length >= 2 && (
          <p class="prose">
            The catalog has no quantity these records can show side by side. A figure is comparable
            only within one metric, one method, one benchmark version and one device scope.
          </p>
        )
      ) : (
        <>
          <p class="prose meta">
            <strong>{baselineName}</strong>, the first record, is the multiplier baseline. Each
            section covers its own metrics. This comparison has no overall score. Bars are drawn to
            scale within a row and carry no number of their own.
          </p>

          {hasProvisional && (
            <p class="prose meta">
              <span class="badge badge--provisional">provisional</span> {PROVISIONAL_EXPLAINER}{' '}
              <a href={route(PROVISIONAL_EXPLAINER_PATH)}>How records are judged</a>.
            </p>
          )}

          {expandable && (
            <button
              type="button"
              class="cmp-expand"
              aria-pressed={openAll === true}
              onClick={() => setOpenAll((current) => current !== true)}
            >
              {openAll === true ? 'Close every breakdown' : 'Open every breakdown'}
            </button>
          )}

          {sections.map((section) => (
            <section key={section.id} class="stack-l" aria-labelledby={`section-${section.id}`}>
              <div class="stack">
                <h2 id={`section-${section.id}`}>{section.label}</h2>
                <p class="prose meta">{section.note}</p>
              </div>
              {section.blocks.map((block) => (
                <Block
                  key={block.anchor}
                  block={block}
                  subjects={subjects}
                  baselineName={baselineName}
                  open={openAll}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
