// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * A timeline chart.
 *
 * Observable Plot is imported dynamically inside an effect, so it lands in its
 * own lazy chunk and is fetched only on a page that draws a chart. Nothing on
 * this page depends on it arriving: the data table and the text summary are in
 * the static HTML, and this island adds a picture of the same figures.
 *
 * The chart is redrawn from the container's measured width rather than from a
 * viewport breakpoint, because the same chart has to work in a wide page and in a
 * narrow column.
 *
 * The scale toggle appears only where a logarithmic axis is mathematically valid,
 * and the choice lives in the query string so a shared link shows the same chart.
 *
 * Points are labeled by Plot's own tip mark rather than by an SVG `<title>`. A
 * `<title>` is not a tooltip: the browser draws it in its own chrome after about
 * a second of stillness, ignores the page's palette and never appears under a
 * finger, so a chart that had labels all along still read as anonymous dots.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { formatAxisTick } from '~/lib/axis-ticks';
import type { TimelinePoint } from '~/lib/timeline';

interface Props {
  readonly points: readonly TimelinePoint[];
  /** Axis label, e.g. `Clock frequency (Hz)`. */
  readonly axisLabel: string;
  readonly allowsLogScale: boolean;
  /** Read by screen readers in place of the drawing. */
  readonly description: string;
}

type Scale = 'linear' | 'log';

const SCALE_PARAM = 'scale';

/**
 * Narrower than this and the axis labels collide. A container this small clips
 * the chart rather than shrinking it into illegibility. The data table
 * below is unaffected either way.
 */
const MIN_PLOT_WIDTH = 240;

/**
 * Room for a tick label, its tick and the gap between them. Abbreviated ticks
 * are short, "3.2G" rather than "3,200,000,000", so this is enough for every
 * axis in the catalog, and `overflowLeft` below catches the one that isn't
 * instead of leaving it clipped.
 */
const BASE_MARGIN_LEFT = 48;

/**
 * How the tip and the highlight find their point: the nearest one within this
 * many pixels of the pointer. Both marks share it, so they can never disagree
 * about which point is being described.
 */
const POINTED = { x: 'year', y: 'value', maxRadius: 30 } as const;

/** The drawing's own type size, and the room it leaves at its right edge. */
const PLOT_FONT_SIZE = 12;
const MARGIN_RIGHT = 16;

/**
 * The label's padding, and everything else its box needs beside its text: that
 * padding on both sides, the pointer tying the box to the point, and slack. See
 * `labelWidth`.
 */
const LABEL_PADDING = 8;
const LABEL_CLEARANCE = 40;

/**
 * How wide the label may run, in ems of its own text.
 *
 * Half the drawing, because that is Plot's own rule read backwards. Plot hangs
 * the box off whichever side of the point it fits on, measuring the rendered
 * text rather than guessing at it. When it fits on neither side, it centers
 * the box on the point instead, and then `.chart__plot` clips whatever hangs
 * out. A box no wider than half the drawing always fits on one side, whatever
 * the point's position, so the case that clips cannot arise.
 *
 * On a phone that costs a narrower box and more wrapping, and below roughly
 * 380 px of drawing it costs more than that. Plot breaks a label at its spaces
 * to fit this width and ellipsizes whatever still does not fit, and the longest
 * figures in the catalog. Memory capacities of twelve digits, written with
 * separators that do not break, stop fitting there. That is the trade this
 * number takes deliberately: an ellipsized line keeps a `<title>` holding the
 * whole of it and a row in the table below, where a clipped box keeps nothing.
 */
function labelWidth(width: number): number {
  return Math.max(8, Math.min(34, Math.floor((width / 2 - LABEL_CLEARANCE) / PLOT_FONT_SIZE)));
}

function readScale(search: string, allowsLog: boolean): Scale {
  return allowsLog && new URLSearchParams(search).get(SCALE_PARAM) === 'log' ? 'log' : 'linear';
}

/**
 * How far the drawing's own text sticks out past its left edge, in pixels.
 *
 * Plot reserves exactly `marginLeft` for the value axis and clips whatever does
 * not fit, so a margin guessed too small does not shrink the labels. It cuts
 * their leading digits off, which is how "3,200,000,000" became "0,000,000" on
 * every timeline. Measuring the rendered labels turns that guess into a
 * fact, and the caller redraws once with the margin the labels turned out to
 * need.
 */
function overflowLeft(figure: Element): number {
  // The widest one: a legend swatch is an `<svg>` too, and it is not the chart.
  let svg: SVGSVGElement | undefined;
  for (const candidate of figure.querySelectorAll('svg')) {
    if (
      svg === undefined ||
      candidate.getBoundingClientRect().width > svg.getBoundingClientRect().width
    ) {
      svg = candidate;
    }
  }
  if (svg === undefined) {
    return 0;
  }
  const edge = svg.getBoundingClientRect().left;
  let overflow = 0;
  for (const text of svg.querySelectorAll('text')) {
    overflow = Math.max(overflow, edge - text.getBoundingClientRect().left);
  }
  return overflow;
}

/**
 * The container's content width, which the drawing has to fit into.
 *
 * `clientWidth` counts the padding, which is what a `ResizeObserver` entry does
 * not: the two measurements below disagreed by the padding, so the same chart
 * came out sixteen pixels wider on mount than on resize and the SVG was drawn
 * over its own frame.
 */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

export default function MetricChart({ points, axisLabel, allowsLogScale, description }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<Scale>('linear');
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sync = (): void => setScale(readScale(globalThis.location.search, allowsLogScale));
    sync();
    globalThis.addEventListener('popstate', sync);
    return () => globalThis.removeEventListener('popstate', sync);
  }, [allowsLogScale]);

  /*
   * Container width, not viewport width, so the same chart works in a full-width
   * page and in a narrower column.
   *
   * Measured after the first frame as well as observed afterwards. A
   * ResizeObserver only delivers callbacks while the page is being painted. In
   * a background tab, or a pane the browser has stopped rendering, it may never
   * fire at all. A chart waiting for a resize that never comes draws
   * nothing. Measuring before layout has the opposite failure, a chart drawn at
   * the width of its own padding, so the measurement waits a frame and never
   * goes below a width where a chart remains readable.
   */
  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return;
    }
    const measure = (candidate: number): void => {
      if (candidate > 0) {
        setWidth(Math.max(MIN_PLOT_WIDTH, Math.round(candidate)));
      }
    };
    // Immediately, so a chart exists even where the rendering loop is idle and
    // neither the frame callback nor the observer will ever run; then again after
    // a frame, when the real width is known.
    measure(contentWidth(element));
    const frame = requestAnimationFrame(() => measure(contentWidth(element)));
    const observer = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (element === null || width === 0) {
      return;
    }
    let canceled = false;

    void (async () => {
      try {
        const Plot = await import('@observablehq/plot');
        if (canceled) {
          return;
        }
        const data = points.map((point) => ({
          year: point.year,
          value: Number(point.value),
          label:
            point.part === undefined ? point.systemName : `${point.systemName} — ${point.part}`,
          status: point.editorialStatus === 'provisional' ? 'Provisional' : 'Approved',
          text: point.text,
        }));

        const draw = (marginLeft: number) =>
          Plot.plot({
            width,
            height: Math.max(280, Math.min(460, Math.round(width * 0.55))),
            marginLeft,
            marginBottom: 42,
            marginRight: MARGIN_RIGHT,
            style: { background: 'transparent', fontSize: `${PLOT_FONT_SIZE}px` },
            x: {
              label: 'Release year of the machine →',
              tickFormat: (year: number) => String(year),
              nice: true,
            },
            y: {
              label: `↑ ${axisLabel}`,
              type: scale === 'log' ? 'log' : 'linear',
              grid: true,
              /*
               * Abbreviated, because this axis is drawn in the quantity's base
               * unit and those run to ten digits: the unit is in the axis label
               * and the exact figure is in the table below.
               */
              tickFormat: formatAxisTick,
            },
            color: {
              legend: true,
              domain: ['Approved', 'Provisional'],
              // CSS variables let an already-drawn chart follow a system theme change.
              range: ['var(--chart-approved)', 'var(--chart-provisional)'],
            },
            marks: [
              // A zero rule only means anything on a linear axis.
              ...(scale === 'linear' ? [Plot.ruleY([0])] : []),
              Plot.dot(data, {
                x: 'year',
                y: 'value',
                stroke: 'status',
                fill: 'status',
                fillOpacity: 0.25,
                r: 5,
              }),
              /*
               * The point nearest the pointer, drawn again larger, and its label.
               *
               * The highlight is not decoration. The pointer transform picks the
               * nearest point within its radius rather than whatever is exactly
               * under the cursor, so in a crowded year the label alone would
               * leave a reader guessing which dot it belongs to.
               *
               * The label is a convenience over figures that are already on the
               * page in text: it is not reachable by keyboard, which is why
               * every point is also a row in the table below and nothing here is
               * available only on hover.
               */
              Plot.dot(
                data,
                Plot.pointer({
                  ...POINTED,
                  r: 8,
                  stroke: 'status',
                  fill: 'status',
                  fillOpacity: 0.55,
                  strokeWidth: 2,
                }),
              ),
              Plot.tip(
                data,
                Plot.pointer({
                  ...POINTED,
                  title: (d: { label: string; text: string; year: number }) =>
                    `${d.label}\n${d.text}\n${d.year}`,
                  lineWidth: labelWidth(width),
                  textPadding: LABEL_PADDING,
                  // Flat, like every other raised surface in this palette.
                  pathFilter: 'none',
                }),
              ),
            ],
          });

        element.replaceChildren(draw(BASE_MARGIN_LEFT));

        /*
         * Then, if a label turned out wider than the margin reserved for it,
         * draw the same chart once more with room for it. Both passes run in
         * one task, so the browser paints the corrected chart only. The
         * correction is capped, because a margin that ate the plot would be a
         * worse answer than a slightly tight one.
         */
        const overflow = overflowLeft(element);
        if (overflow > 0) {
          const margin = Math.min(Math.ceil(BASE_MARGIN_LEFT + overflow), Math.round(width / 3));
          if (margin > BASE_MARGIN_LEFT) {
            element.replaceChildren(draw(margin));
          }
        }
      } catch {
        setFailed(true);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [points, axisLabel, scale, width]);

  function chooseScale(next: Scale): void {
    setScale(next);
    const params = new URLSearchParams(globalThis.location.search);
    if (next === 'log') {
      params.set(SCALE_PARAM, 'log');
    } else {
      params.delete(SCALE_PARAM);
    }
    const query = params.toString();
    globalThis.history.replaceState(
      undefined,
      '',
      `${globalThis.location.pathname}${query === '' ? '' : `?${query}`}`,
    );
  }

  if (failed) {
    return (
      <p class="chart__status">
        The chart library could not be loaded. Every figure it would have drawn is in the table
        below.
      </p>
    );
  }

  return (
    <figure class="chart stack">
      {allowsLogScale && (
        <fieldset class="chart__scale">
          <legend class="visually-hidden">Value axis scale</legend>
          {(['linear', 'log'] as const).map((option) => (
            <button
              key={option}
              type="button"
              class="chart__scale-button"
              aria-pressed={scale === option}
              onClick={() => chooseScale(option)}
            >
              {option === 'linear' ? 'Linear' : 'Logarithmic'}
            </button>
          ))}
        </fieldset>
      )}

      {/*
       * The drawing is hidden from assistive technology and described in text
       * instead. A plotted SVG is several hundred nodes of ticks and gridlines
       * that read as noise, and every figure in it is also a row in the table on
       * this page, so the text alternative is the data itself rather than a
       * paraphrase of a picture.
       */}
      <p class="visually-hidden">{description}</p>
      <div class="chart__plot" ref={host} aria-hidden="true" />
      <figcaption class="chart__caption">
        {scale === 'log'
          ? 'Logarithmic value axis: equal vertical distances are equal ratios, not equal differences.'
          : 'Linear value axis. Switch to logarithmic when the range spans orders of magnitude.'}{' '}
        Pointing at or tapping a point labels it. Every point also has a row in the table below, so
        the same information is available without hovering.
      </figcaption>
    </figure>
  );
}
