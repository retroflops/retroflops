---
title: 'Metrics: what each number actually measures'
order: 1
summary: >-
  MIPS, DMIPS, FLOPS, SPEC results, TDP and whole-system power answer different
  questions. RetroFlops keeps them apart instead of folding them into a single
  figure of merit.
---

# Metrics: what each number actually measures

A performance figure is only meaningful together with the question it answers.
"Two million instructions per second" and "two million floating-point operations
per second" are different claims about different work, and a machine can be fast
at one while being incapable of the other. RetroFlops therefore stores each
quantity as its own metric, and no metric is ever converted into another.

There is no RetroFlops Score. An aggregate would have to decide, on the reader's
behalf, how much a floating-point operation is worth relative to an instruction,
a byte of bandwidth or a watt. That exchange rate does not exist outside a
specific workload.

## Instruction rates

### Native instruction rate

The number of instructions the machine executes per second **on its own
instruction set**.

This is the appropriate figure for pre-benchmark hardware: the Apollo Guidance
Computer's rate is derived from its memory cycle time and instruction timings,
not from running a program written decades later. It is also the figure that
travels worst between machines. One 6502 instruction and one PowerPC instruction
are not the same amount of work, so a 6502 at 1 MIPS is not "as fast as" a RISC
processor at 1 MIPS. Comparing native instruction rates across different
instruction sets tells you about instruction issue, not about performance.

RetroFlops publishes native instruction rates because they are historically
meaningful and well-sourced, and refuses to let them stand in for throughput on
unrelated architectures.

### Dhrystone MIPS (DMIPS)

A Dhrystone result expressed relative to the DEC VAX-11/780, which is defined as
1 MIPS. DMIPS is therefore **not a count of instructions at all**; it is a
benchmark score wearing an instruction-rate unit, and its value depends on the
Dhrystone version, the compiler, the optimization flags and whether string
operations were inlined.

Because of that, DMIPS figures are comparable only within an identical benchmark
identity. A DMIPS number and a native MIPS number are never comparable, even
though both are stored with an instruction-rate unit and both are commonly
written "MIPS" in the sources.

### DMIPS per MHz

The clock-normalized Dhrystone figure, used to talk about a core's efficiency
independently of the speed it happens to be clocked at. It is dimensionless and
is not interchangeable with DMIPS: you cannot compare a DMIPS/MHz figure with a
DMIPS figure any more than you can compare fuel consumption with distance
traveled.

## Floating-point rates

FLOPS counts floating-point operations per second. RetroFlops splits it by
precision and by how the figure was obtained, because both change the number by
an order of magnitude or more.

- **Peak FP32 / FP64 / FP16 rate** — a theoretical upper bound computed from
  unit count, clock and operations per cycle. No program reaches it. It is the
  figure vendors quote, and it is legitimate as long as it is labeled as a
  ceiling.
- **Sustained FP64 rate** — throughput actually measured under a named benchmark
  such as HPL. Always materially below the peak.
- **Sustained FP40 rate** — measured throughput of the five-byte, 40-bit format
  used by several ROM BASIC implementations. It is neither FP32 nor FP64, so a
  BASIC benchmark is never relabeled as an IEEE result merely to fit an older
  column.

Different precisions are different metrics. A GPU's FP16 rate is often four or
eight times its FP64 rate on the same silicon, so quoting the largest available
number without its precision is the single most common way hardware comparisons
go wrong. RetroFlops will not compare an FP16 figure with an FP32 figure, and
will not compare a theoretical peak with a measured result.

Floating-point rates and instruction rates never convert into one another. A
machine with no floating-point hardware has a well-defined instruction rate and
an FP rate that must be recorded as `not-applicable`. It is neither zero nor a
count of the instructions in a software emulation library.

## SPEC CPU results

Published SPEC CPU results are the most rigorous cross-architecture figures
available for the modern part of the catalog, and the most constrained.

A SPEC result means nothing without its full identity: the suite (CPU95,
CPU2000, CPU2006, CPU 2017), the sub-metric (integer or floating point, rate or
speed), the base/peak variant, and the exact compiler and flags. Two results
from different suites are different metrics; SPEC explicitly does not publish
conversion factors between suite generations, and RetroFlops does not invent
any.

Quotations of SPEC data follow the
[SPEC Fair Use Rules](https://www.spec.org/products/fairuse/). Any source
carrying SPEC data records the applicable usage note, which is displayed with
the figure.

## Geekbench scores

Geekbench is the only benchmark most modern machines have in common, because it
is the only one their owners run. Its results reach RetroFlops under two rules
that nothing else in the catalog needs.

**The version and the run variant are part of the identity.** A single-core and
a multi-core score answer different questions. One is about a core; the other is
about a scheduler, a thermal envelope, and however many cores of however many
kinds the machine has. They are never divided into each other. Neither are
scores from different major versions: the suite was rebalanced between 5 and 6,
and the publisher states no conversion.

**A chart average is a dated snapshot, not a score.** The benchmark's publisher
also charts the mean of every result uploaded for a machine, and recomputes it
as more arrive. That figure is useful. It is often the only one available for a
machine nobody benchmarked in a laboratory, and it is true of one day only.
RetroFlops therefore records it by its own method, separate from a single run,
carrying the date it was read and the hash of the capture it was read from. Two
such figures may be compared only when they were read on the same day, which
validation enforces rather than trusts.

**A compute score is not a processor score.** Geekbench also benchmarks a
graphics processor, through Metal on Apple's platforms and through OpenCL
elsewhere, and RetroFlops records that as a metric of its own rather than as
another variant of the processor score. The reason is in the publisher's own
calibration: version 7 sets the baseline of a compute result at 100,000 and the
baseline of a processor result at 2,500, so the two numbers are not one quantity
even when a single machine reports both. The graphics API is part of the
benchmark identity for the same reason as the variant. A Metal run and an OpenCL
run execute different code against different drivers, so a Metal figure and an
OpenCL figure never divide into each other either.

That leaves this catalog holding its Metal figures under version 6 and its
OpenCL figures under version 7, which is not an oversight: those are the
versions the charts stood at when each was captured, and version 7 replaced
version 6 at the same addresses shortly afterwards. The two sit in separate
comparability groups and no comparison crosses between them.

**One product reaches a chart under several names.** The charts key their rows
on the string a driver reports, so a processor can appear two or three times,
with different averages, under a name its maker never used: a "GPU" suffix, a
die designation, or another company's prefix. RetroFlops curates the row that
names the product as its maker names it, and records the rival rows in the
conflict ledger with the reasoning, rather than picking the flattering number or
averaging the two.

## Memory

- **Memory capacity** is stored in bytes, with binary (KiB, MiB, GiB) and
  decimal (kB, MB, GB) prefixes kept distinct, because sources use both and the
  difference reaches 7% by the gigabyte.
- **Memory capacity in words** is a separate metric for word-addressed machines.
  The Apollo Guidance Computer's erasable memory is 2048 words of 16 bits;
  calling that "4 kB" requires the word width and is published as a derived
  claim with its formula visible, never as a silent unit conversion.
- **Memory bandwidth** separates theoretical bus bandwidth (bus width × transfer
  rate) from benchmarked bandwidth. They are different comparability groups.
- **Memory bus width** is recorded in bits. It is reported, and it is
  deliberately not log-scaled.

## Power

TDP and whole-system power draw are the two figures most often conflated, and
they are not the same measurement of the same thing.

- **Thermal design power** is a vendor's cooling-design target for a component.
  Its definition has changed between vendors and between eras: sometimes an
  average under a sustained workload, sometimes a sustained-power limit,
  sometimes a marketing bin. RetroFlops publishes TDP because sources quote it,
  but the metric is flagged as ratio-forbidden: "twice the TDP" is not a claim
  this project will generate.
- **Whole-system power draw** is measured at the wall for a complete machine
  under a stated workload, and therefore includes the power supply, storage,
  memory, fans and everything else in the case.

A component TDP and a whole-system draw are never comparable, in either
direction. A console drawing 200 W at the wall does not have a 200 W processor,
and a 95 W CPU does not sit in a 95 W computer.

## Descriptive figures

Two metrics serve as context, not comparison, and both are ratio-forbidden:

- **Process node** is recorded as a length because sources state it that way,
  but modern node names stopped being physical dimensions years ago. "5 nm is
  twice as good as 10 nm" is not a statement about anything measurable.
- **Launch price** remains nominal, in the stated currency and market. A derived
  figure may restate a U.S. dollar price in the target month of a frozen CPI-U
  snapshot. It never replaces the launch price, converts currencies or markets,
  or permits a price multiplier.

## The rule that holds all of this together

Two figures may appear in the same chart, the same table column or the same
multiplier only when they share a **comparability group**: the same metric, the
same device scope, the same method, and the same benchmark identity and version.
That group is derived from the figure's own facets and re-checked on every
validation run, so it cannot drift from what it claims to describe. The method
comes from a closed registry, not free text, so the group can never be created
by a curator's choice of word. The next chapter describes the registry and the
two fields, provenance and evidence stage, that deliberately stay out of the
group.

Anything else is not rendered as a comparison. Incompatible figures are shown
side by side as what they are, with an explanation of why no multiplier is
offered.
