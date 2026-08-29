---
title: 'Confidence, absence and editorial status'
order: 2
summary: >-
  How evidence, numerical basis, absence and editorial review determine what a
  figure means and whether automation may use it.
---

# Confidence, absence and editorial status

Every published figure separates four questions: does the quantity have a
number, how strong is the evidence for that number, what is the number's basis,
and has an editor approved it? They answer different questions and are stored
separately.

| Field            | Answers                                | Examples                                           |
| ---------------- | -------------------------------------- | -------------------------------------------------- |
| Quantity state   | Does this slot contain a number?       | `value`, `unknown`, `not-applicable`, `unverified` |
| Evidence         | How well is a stated number supported? | `confirmed`, `reported`, `rumored`                 |
| Basis            | What kind of number is it?             | `measured`, `theoretical`, `vendor-rated`          |
| Editorial status | Has its record completed review?       | `approved`, `provisional`                          |

The profile table shows Evidence and Basis in separate columns. A number can be
reported but measured, or confirmed but theoretical. Neither label replaces the
other.

## Basis: how the figure was obtained

| Status         | Meaning                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `measured`     | Someone ran something and recorded the result. The workload and conditions are part of the record.   |
| `theoretical`  | Computed from architecture: unit count × clock × operations per cycle, or bus width × transfer rate. |
| `vendor-rated` | Stated by the manufacturer without a reproducible method — datasheet clocks, TDP, rated capacities.  |
| `estimated`    | Reconstructed by a third party from partial evidence, with the reasoning stated in the source.       |
| `derived`      | Computed by this project from other measurements in the catalog, through a versioned formula.        |

Basis is not a quality ranking. A `theoretical` peak FP32 rate is exactly as
legitimate as a `measured` one. It answers a different question and belongs to a
different comparability group. Status is always displayed with a figure.

`derived` is reserved for figures this project computed. A figure a magazine
derived in 1987 is `estimated` and cites that magazine; only numbers produced by
the pipeline's own formula registry are `derived`, because only those can be
recomputed and re-checked on every build.

`estimated` carries two further requirements, because an estimate is only worth
publishing when the reasoning behind it is visible. It must use the
`estimate-from-formula` method, which keeps it out of the comparability group of
figures somebody measured or specified; and it must name a research record
carrying the formula or the procedure it was computed by. The sourcing threshold
is the ordinary one: one tier A source or two agreeing tier B sources. An
estimate whose method cannot be cited is not a low-confidence figure but an
absent one.

Basis does not decide whether a multiplier may be produced; the comparability
group, evidence level and editorial status do. But a multiplier built on an
estimate says so in its generated caveat, so a result never reads as firmer than
what it was computed from.

## Method, provenance and evidence stage

The confidence status says what kind of number it is. Three further fields say
how it was produced, who produced it, and whether the hardware existed yet. Only
the first changes what the figure may be compared with.

- **Method** comes from a closed registry, `methods-v1`, in the same way units
  and metrics do. It names the operation behind the figure: a nominal clock, a
  theoretical peak, a design capacity, a published SPEC run, a wall measurement.
  It is part of the comparability group, so a theoretical peak never divides
  into a measured result. Before the registry existed the field was free text,
  and two curators describing the same kind of figure could split the catalog
  along a seam that said nothing about the hardware.
- **Provenance** — one of `vendor`, `independent` or `community`, recording who
  stated the figure. It is deliberately _not_ part of the comparability group. A
  manufacturer's silence must not cut its hardware off from every number
  somebody else published: an independently established clock for a chip whose
  maker never quoted one belongs in the same row as the clocks that were quoted.
- **Evidence stage** — either `shipped` or `pre-launch`, recording whether the
  hardware had reached buyers when the figure was published. A `pre-launch`
  figure must stay `provisional`, which is what keeps it out of every automatic
  multiplier. It is not filed under a method of its own, because that would only
  hide it in a separate row: the announced number is shown beside the shipped
  one, with the reason no multiplier follows written underneath.

Sourcing rules apply identically whoever the source is. Community documentation
is not a lower tier by definition. A wiki is tier C because it aggregates, not
because enthusiasts wrote it; a carefully sourced independent teardown is tier B
on its evidence.

## Evidence level: confirmed, reported and rumored

Every numeric record has an evidence level. It records the best support for the
specific value, not whether a manufacturer happened to publish a specification.
A manufacturer's silence cannot turn an independently reported number into an
`unknown`.

| Evidence    | Minimum support                                                           | What the catalog does with it                            |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `confirmed` | One tier A source, or two independent, agreeing tier B sources            | May be approved after editorial review.                  |
| `reported`  | One tier B source with an exact locator and quotation or research extract | Visible, `provisional`, and excluded from automated use. |
| `rumored`   | One precisely identified tier C source                                    | Visible, `provisional`, and excluded from automated use. |

Tier C can support only a `rumored` value. Repeating the same claim across
aggregators does not promote it. Sources must support the value itself: an
otherwise authoritative document that says nothing about the quantity does not
meet the tier A threshold.

`reported` and `rumored` values cannot feed automatic ratios, derived claims or
promoted comparison presets. A comparison orders available figures as confirmed,
reported, then rumored; an unresolved conflict does not select a number
automatically.

## Absence states

`unknown`, `not-applicable` and `unverified` are not evidence levels. They are
absence states.

A missing figure is never zero, never an empty string and never omitted
silently. It is one of three explicit states. The first two are findings about
the machine and mean opposite things; the third is a statement about this
project, and is the only one that is nobody's fault but ours:

- **`unknown`** — the quantity exists, but a recorded search found no published
  candidate or no compatible candidate. Its `unknownAudit` names the review
  date, research routes, conclusion and a short summary. At least one route must
  be outside manufacturer documentation. Manufacturer silence alone cannot
  establish this.
- **`not-applicable`** — the quantity does not exist for this machine. The
  Commodore 64 has no floating-point unit, so its peak FP64 rate is not "0
  FLOPS" and not "unknown"; the question does not apply.
- **`unverified`** — a document is cited for the quantity and nobody here has
  read the page yet. It contains no number and carries no note, because anything
  it said about that document would be invented, and it never claims the source
  is silent.

The third state exists because the first was doing two jobs at once. A figure
recorded as `unknown` asserts that somebody looked; a backlog of unread manuals
recorded the same way turned an unfinished job into a claim about what the world
never published. Separating them means a reader can tell the Xbox Series X,
whose full specification table contains no wattage at all, from a machine whose
manual is sitting on a shelf here unopened. An `unverified` figure is counted as
a gap rather than as coverage, so recording one can never make this catalog look
more complete than it is.

Collapsing either into zero would be the single most damaging thing this dataset
could do. Zero is a value: it sorts, it charts, it divides, and it would
silently claim that a machine was measured and found to do nothing. Absent
quantities carry no normalized twin, never enter a formula, and are rendered as
text rather than as a bar of length zero.

An absence may carry a short note explaining it, which is displayed instead of
the value.

Records that contain only documented absences remain public in the
[research section](../../research/). They keep their source trails, but do not
appear in the catalog, search, or new comparison choices until a numeric
measurement is available.

## When one machine answers twice

Some machines answer a question more than once, and neither answer is wrong. An
Apple M1 runs four cores at 3.2 GHz and four at 2.064 GHz, at the same time;
asking "what is the M1's clock" has two correct replies and no single one.

A figure may therefore name the **part** of the machine it describes. The part
is not part of the comparability group. A clock is a clock whichever cores hold
it, so both figures reach the same row as every other machine's clock, where a
reader looking for the M1 expects to find it. What the part does is make the two
figures two figures rather than a disagreement: they occupy separate slots, and
validation keeps treating a genuine second value in one slot as a conflict.

The cost is that such a machine offers no multiplier for that quantity. There is
nothing to divide, and the comparison says so in those words rather than leaving
a cell that looks empty.

## Editorial status: `approved` and `provisional`

Editorial status is about the review process, not about the hardware.

- **`approved`** — an editor has checked the figure against its sources and
  accepted it. Approved measurements must satisfy the full sourcing policy, and
  only approved records may feed automatic comparisons.
- **`provisional`** — the figure is recorded and visible, but not yet accepted.
  It might be sourced only from a tier C aggregator, it might be the subject of
  an unresolved conflict, or it might simply be awaiting review.

The consequences are enforced by the pipeline rather than by convention:

- A `provisional` record can never appear in an automatically generated
  multiplier. The ratio formula refuses provisional inputs outright, with
  `provisional-record` as the stated reason.
- A `provisional` record can never appear in an editorially promoted comparison
  preset.
- An `approved` measurement without sufficient sourcing fails validation and
  stops the build. It is not downgraded automatically. A person must source the
  record properly or mark it provisional.

Sources carry the same status for a different reason: an `approved` source is
frozen against `data:fetch`. If the upstream document changes, the change is
reported for review instead of being written into the manifest, so a silent edit
upstream can never rewrite a figure here.

## Conflicts

When two acceptable sources state different values for the same subject and
metric, that is not resolved by picking the newer one or by averaging. Averaging
two disputed figures produces a third figure that no source supports.

The competing values go into the conflict ledger with their evidence, and an
editor records a decision:

- **`accepted`** — one candidate is chosen, with a written rationale and a date.
  The rationale is part of the public record.
- **`unresolved`** — the disagreement stands. Validation warns on every run, and
  figures for that subject stay provisional until someone settles it.

An unresolved conflict remains visible instead of becoming a silent omission.
