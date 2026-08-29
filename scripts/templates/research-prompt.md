# Research prompt

Send this prompt with `research-requests.md`. Assign one or more parts from the
inventory before starting.

---

Research the missing hardware specifications in the attached inventory.

[Work through Part F, representative x86 PC platforms.]

Each entry names a machine, a quantity, the required unit, why the catalog has
no answer, and which documents have already been checked. Find a document that
states the number. A wiki, specification database, forum post, or video may
point toward that document, but it is not a substitute for one.

## Evidence rules

- Tier A covers manufacturers, government and standards bodies, official
  benchmark results, manuals, service manuals, and regulatory filings. One tier
  A source can confirm a figure.
- Tier B covers independent technical reporting, die analysis, teardowns,
  conference papers, and academic work. Two independent tier B sources must
  agree to confirm a figure. One tier B source supports a reported, provisional
  figure.
- Tier C covers wikis, specification databases, fan databases, forum posts, and
  video. A precise tier C claim can support only a rumored, provisional figure.

Every figure needs a stable URL, a locator inside the document, and a short
verbatim extract that contains the number. Use an archive capture when the
original page may disappear.

Reject a candidate when any of these rules applies:

- The metric does not match. Storage is not working memory. Battery life is not
  power draw. Fill rate is not floating-point rate. A supply rating is not a
  wall measurement.
- A floating-point rate does not state its precision.
- A benchmark result omits its version or run configuration.
- A price omits its currency, market, launch date, or asking-price basis.
- A derived figure has an unsourced input. Show the formula, every input, and
  the rounding.

Report disagreements. Do not average conflicting values or choose the familiar
one.

Useful places to search include manufacturer archives, developer documents,
service manuals, schematics, regulatory filings, conference papers, patents,
contemporary magazines, scanned document archives, die analyses, teardowns, and
official benchmark databases.

## Response format

Return one block for each attempted entry. Copy its reference key exactly.

```text
ITEM: <reference key>
VALUE: <number> <unit> | NOT FOUND
STATUS: measured | theoretical | vendor-rated | estimated | derived
EVIDENCE: confirmed | reported | rumored
EDITORIAL STATUS: provisional | blank for confirmed
METHOD: <how the figure was obtained>
CONDITIONS: <revision, region, configuration, clock state, or workload>
SOURCE 1:
  TITLE: <document title>
  PUBLISHER: <publisher>
  TIER: A | B | C
  URL: <stable or archived URL>
  DATE: <publication date>
  ARCHIVED: <capture date, if used>
  LOCATOR: <page, table, section, figure, or timecode>
  EXTRACT: "<verbatim text containing the figure>"
SOURCE 2: <same fields when needed>
DERIVATION: <formula, sourced inputs, and rounding>
DISAGREEMENT: <other values and their sources>
CAVEATS: <anything that prevents a direct comparison>
CONFIDENCE: high | medium | low, with a reason
SEARCHED: <required when VALUE is NOT FOUND>
```

Use `provisional` for every reported or rumored result. For `NOT FOUND`, name at
least two search routes, including one outside manufacturer documentation. State
the nearest miss and whether no published candidate exists or the candidates
measured the wrong thing.

Do not return a number that you cannot locate inside a document. Finish with
counts for confirmed, reported, rumored, and not found results. List any entry
that needs another search route.

---

Catalog maintainers verify every source before transcribing a finding. A reply
without a locator and matching extract cannot enter the catalog.
