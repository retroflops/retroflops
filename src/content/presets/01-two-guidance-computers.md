---
title: Two guidance computers, one clock
order: 1
summary:
  The Apollo Guidance Computer and the Saturn Launch Vehicle Digital Computer
  ran at the same 2.048 MHz and were not the same speed.
kind: system
records:
  - apollo-guidance-computer-block-ii@block-ii
  - saturn-lvdc@four-module
promoted: true
---

# Two guidance computers, one clock

Both machines flew on the same vehicle, and both were clocked at 2.048 MHz. The
multiplier on the clock row is therefore exactly 1×, and it says nothing at all
about which computer did more work per second.

The instruction timings say it instead. They are the figures to read here,
because on a core-memory machine an instruction time is a whole number of memory
cycles, and the cycle is a physical property of the machine rather than a
benchmark result. Each instruction is its own comparability group: an addition
time and a multiplication time were obtained by timing different work. The
multipliers therefore compare addition with addition and multiplication with
multiplication.

Both machines have a rated power consumption from their own documentation, and
the two figures are not turned into a multiplier, because a design rating states
what a machine was specified to draw and not what it drew under any reproducible
workload. Two ratings from two programs, fifteen years apart in engineering
practice, would produce a number with no defensible meaning.
