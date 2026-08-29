---
title: One processor or two
order: 5
summary: >-
  The same SGI Octane in its single- and dual-R10000 configurations: identical
  clocks, twice the memory, and four SPEC results that still cannot be divided.
kind: system
records:
  - sgi-octane@1x-250mhz
  - sgi-octane@2x-250mhz
promoted: false
---

# One processor or two

One machine, two configurations, so almost everything about them is held
constant. The clock is identical, which the 1× multiplier states plainly, and
the memory capacity doubles.

The SPEC rows are the reason this preset exists. Four published results appear
here, and not one of them pairs with another. Each result is a separate
comparability group. Its suite, version and base or peak variant are part of the
group's identity. The two configurations were submitted under different
variants, so no column ever meets another inside one group. The figures are
shown apart, with their benchmark identity next to each, and no multiplier is
produced.

This is the correct outcome even though it is a frustrating one. A SPEC CFP
result and a SPEC CINT result measure different work; a base result and a peak
result allow different compiler settings. Dividing across those lines is exactly
what SPEC's own fair-use rules exist to prevent, and it is what most "N× faster"
claims on the internet are made of.
