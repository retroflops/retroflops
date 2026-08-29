---
title: 'Derived claims, formulas and rounding'
order: 3
summary: >-
  Every computed number shows its formula, its inputs, its rounding rule and its
  caveats. The pipeline recomputes it from scratch on every build.
---

# Derived claims, formulas and rounding

A derived claim is a number this project computed: a ratio between two figures,
a words-to-bytes conversion, a per-watt rate. Because nobody can check it
against a document, it is held to a stricter standard than a cited figure.

## Nothing derived is trusted as written

A derived claim stores its result, but validation never takes that result at
face value. On every run the pipeline looks the formula up in a versioned
registry, recomputes it from the named input measurements, and rejects the
record if the stored result differs by so much as a digit.

That has a deliberate consequence: **changing a formula requires a new
version**, because every existing result computed with the old one would stop
reproducing and the build would fail. A formula cannot be quietly adjusted after
the fact.

Each claim records, and each page displays:

- the formula identifier and version;
- the human-readable expression, such as `a ÷ b`;
- every input measurement, each with its own source and confidence status;
- the rounding rule and the number of significant digits;
- an automatically generated caveat.

The caveat is generated from the inputs rather than written by hand, so it
cannot fall out of step with them. It names the metric, the device scope, the
method and the benchmark the comparison is valid within, and it says so
explicitly when any input is a theoretical peak rather than an achieved result.

## When a multiplier is refused

The ratio formula is the only route to an "N× faster" claim, and it declines
more often than it succeeds. It refuses when:

| Reason                 | Situation                                                             |
| ---------------------- | --------------------------------------------------------------------- |
| `metric-mismatch`      | The two figures are not the same metric — MIPS against FLOPS.         |
| `scope-mismatch`       | A component figure against a whole-system figure.                     |
| `method-mismatch`      | A theoretical peak against a measured result.                         |
| `benchmark-mismatch`   | Different benchmark, version or base/peak variant.                    |
| `benchmark-required`   | The metric is meaningless without a named benchmark, and none is set. |
| `metric-forbids-ratio` | TDP, process node, launch price — metrics where a ratio says nothing. |
| `provisional-record`   | Either input is not editorially approved.                             |
| `non-positive-value`   | Either value is zero or negative, so the ratio is undefined.          |

A refusal is not a failure state to be worked around. The comparison page shows
both figures with the reason no multiplier was produced, which is more
informative than a number that would have been wrong.

## Precision and rounding

Numbers are stored as exact decimal strings and are never parsed into JavaScript
floating point anywhere in the pipeline. `0.1 + 0.2` problems do not reach this
dataset, and a capacity of exactly 65 536 bytes stays exactly 65 536 bytes.

Each stated figure records the **significant digits the source actually
carried**, as an explicit field rather than as something inferred from the
written digits. This matters in both directions: a source writing "1 MHz" claims
one significant digit, while a source writing "0.985248 MHz" claims six, and a
capacity of "64 KiB" is exact rather than two-digit.

Normalization converts every figure into its quantity's base unit with an exact
factor and **never rounds**. Rounding there would corrupt exact capacities.
Precision is carried in the explicit field instead.

Division does have to round, so every derived claim names its rule:

| Rule        | Behavior                                                                        |
| ----------- | ------------------------------------------------------------------------------- |
| `half-up`   | Ties round away from zero. The convention most readers expect.                  |
| `half-even` | Ties round to the nearest even digit. Avoids bias when many results are summed. |
| `truncate`  | Digits beyond the requested precision are dropped.                              |
| `none`      | No rounding is applied; the value is exact as stored.                           |

A derived result is never more precise than its least precise input. A ratio
between a six-digit figure and a two-digit figure is reported to two significant
digits, and the caveat says so.

## Unit conversion is not comparison

Two units belong to the same quantity only when an exact factor converts between
them. Sharing a quantity is necessary for comparability, but it is not enough.
MIPS and DMIPS share the instruction-rate quantity and are still not comparable
because they were produced by different methods.

Some conversions that look like unit arithmetic are deliberately not available
as unit arithmetic. Machine words do not convert to bytes, because the factor is
the machine's word width rather than a property of the units. Turning 2048 words
into 4096 bytes therefore requires the declared word width and is published as a
derived claim, with the width visible as an input.
