---
title: 'Sources, tiers and locators'
order: 4
summary: >-
  What counts as evidence, how much of it a published figure needs, and how a
  reader re-checks a number without taking this project's word for it.
---

# Sources, tiers and locators

Every public number in RetroFlops carries a source, a locator precise enough to
find the number inside that source, and a confidence status. A figure that
cannot be traced back to a document is not published, however plausible it
looks.

## Tiers

| Tier | What it is                                                                                                            | May support publication   |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A    | Manufacturer documentation, government or agency document, technical manual, official benchmark result                | Yes, on its own           |
| B    | High-quality independent analysis: die-shot teardowns, engineering retrospectives, technical press with stated method | Yes, two agreeing sources |
| C    | Wikis, encyclopedias, spec aggregators                                                                                | Yes, as `rumored` only    |

One tier A source, or two independent agreeing tier B sources, makes a value
`confirmed`. One tier B source with a precise locator and extract makes it
`reported`. A precise tier C claim is `rumored`. Reported and rumored values are
visible, but remain provisional and cannot feed automatic ratios, derived claims
or promoted comparisons.

Two acceptable sources that disagree are a conflict. The catalog records both
values and their evidence without averaging them.

## Locators

A URL is not a citation. Every source records a locator, such as a page, table,
figure, section, or timecode. It must be precise enough for a reader to find the
figure without reading the whole document. "Page 2-17, table 2-4" is a locator;
"the datasheet" is not.

The locator field cannot be empty.

## Research records: sources no adapter can read

Structured sources are read by adapters, and the value the adapter extracted can
be re-derived mechanically from the cached artifact. PDFs, scans, printed
manuals and photographs of a nameplate cannot be read that way, and they are
exactly where the most valuable historic figures live.

For those, a figure is backed by a **research record**: an exact locator, a
short verbatim extract containing the number, the date, and the name of whoever
transcribed it. The extract is brief enough to verify the figure without
republishing the source. Its SHA-256 hash is verified on every validation run,
so a transcription edited or corrupted since review is caught.

The transcriber's name is recorded so that a questionable reading has an owner.
Anything ambiguous in the document, such as a smudged digit, an unclear unit, or
a qualifying footnote, goes into the record's notes instead of being resolved
silently.

Validation enforces this: an approved measurement citing a government document,
technical manual, book or periodical that no adapter reads, and that has no
research record, is an error.

## Provenance of the fetch

`data:fetch` is the only step in the pipeline that touches the network, and it
may only contact hosts on a reviewed allowlist. Adding a host is a deliberate
change, not a side effect of adding a source.

Redirects are followed one hop at a time and checked at every hop. An allowlist
that is only consulted before the first request is decorative: an allowlisted
host could hand the fetch to any origin it liked, and those bytes would be filed
as evidence for a cited figure. Some legitimate redirects, including Internet
Archive download URLs, point to per-item storage nodes. The allowlist declares
those permitted targets on its entry, so a reviewer approves them with the host.
When a redirect moves the request, the address that supplied the bytes is
recorded next to the requested address.

What it retrieves is stored as evidence, never as fact: the URL, the timestamp,
the HTTP status, the content type, the byte length and the SHA-256 of the
response. It writes to the cache and to the provenance block of a source
manifest, and nowhere else. It never writes a figure.

It also never overwrites an approved record. When an approved source's upstream
content has changed, the run reports the change and exits with a failure,
leaving the manifest untouched. The change then goes through review like any
other edit. This prevents an upstream document from silently changing beneath a
cited figure.

Production builds never fetch anything. This is checked, not assumed:
`pnpm build:offline-check` runs the build with network access blocked at the
socket layer.

## Archives

Sources that are not permanently hosted record an archive URL alongside the
original. A separate periodic workflow re-checks links and archive availability,
so link rot is found on a schedule instead of by a reader hitting a dead
citation.

## Licenses and usage notes

Sources carry their license where one is stated, and a usage note where
quotation is constrained. SPEC data is the significant case: any figure taken
from a published SPEC result carries the applicable
[SPEC Fair Use Rules](https://www.spec.org/products/fairuse/) note, which is
displayed next to the figure, not buried in a colophon.

Apollo-era figures are taken primarily from [NASA NTRS](https://ntrs.nasa.gov/)
documents, which are public domain as United States government works, and which
are cited by report number and page.
