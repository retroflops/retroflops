# Contributing

Two kinds of change arrive here, and they are held to different standards. A
change to the code has to pass `pnpm check`. A change to the data has to pass
`pnpm check` **and** convince a reader who does not trust it.

## Reporting a correction

The most useful correction names three things: the record, the figure, and the
document that contradicts it.

Open an issue at <https://github.com/retroflops/retroflops/issues> with:

1. the page or record identifier: `sony-playstation-2`, or the measurement id
   from the CSV export;
2. what the catalog says, and what the document says;
3. the document: a URL, or a title with a page or table number. A figure with no
   locator cannot be checked, and this project cannot publish what it cannot
   check.

Two acceptable sources that disagree are not a problem to be averaged. They go
to the conflict ledger with both values, both pieces of evidence and a written
decision, so a documented disagreement is a contribution rather than a
complaint.

A figure marked `provisional` is one whose sourcing is not yet strong enough; it
takes no part in any automatic multiplier or promoted comparison. Supplying the
source that settles one is the single most valuable correction there is.

## Adding or updating a figure

The order matters: each step is what makes the next one checkable.

Canonical records use YAML. Keep prose at 80 columns, using `>-` for an
editorial paragraph and `|-` only where a line break is part of the stored
value. Do not use anchors, aliases, merge keys or explicit tags.

1. **Find the best evidence available.** `confirmed` needs one tier A source
   (vendor documentation, a government document, a technical manual or an
   official benchmark result) or two agreeing tier B sources. One tier B source
   is `reported`; a precise tier C claim is `rumored`. Both remain provisional.
   See [`/methodology/`](../src/content/methodology) for the full rules.
2. **Add the source manifest** in `data/sources/<id>.yaml`: title, publisher,
   accessed date, an exact `locator` (page, table, section, timecode), the
   `tier`, the `license` its publisher applies and any `usageNote` that has to
   travel with a quotation from it.
3. **Add the host to `data/fetch-allowlist.json`**, as narrowly as the source
   allows, then run `pnpm data:fetch`. It records what was retrieved (status,
   content type, byte length and SHA-256) and never writes a figure. It refuses
   to overwrite a record whose `editorialStatus` is `approved`; an upstream
   change is reported for review instead.
4. **For a PDF or a scan, add a research record** in `data/extracts/`: the exact
   locator, a short verbatim extract containing the figure, and what you read it
   as saying. Leave `extractHash` as sixty-four zeros and run
   `pnpm data:extract-hash --write`. Never compute the hash by hand: the point
   is that it is derived mechanically from what was transcribed.
5. **Write the measurement** in `data/canonical/measurements/<subject>.yaml`.
   The fields that decide what the figure may be compared with are `metric`,
   `scope`, `method` and `benchmark`; `provenance` and `evidenceStage` record
   who said it and whether the hardware had shipped, and deliberately do not
   affect comparability. A stated number also needs `evidenceLevel`:
   `confirmed`, `reported` or `rumored`. A figure nobody published after a
   documented search is `unknown` and needs `unknownAudit` with the date, at
   least two research routes including one outside vendor documentation, outcome
   and summary. A quantity that does not apply is `not-applicable`. Never use
   zero or omission. A figure whose source you have named but not yet read is
   `unverified`, and carries no note at all: a note would describe a document
   you have not opened.
6. **Run `pnpm data:normalize`**, which writes the normalized twin in the
   quantity's base unit with decimal arithmetic.
7. **Run `pnpm check`.** Validation will reject a dangling reference, a unit
   from the wrong quantity, a scope the metric forbids, a benchmark-dependent
   figure with no benchmark named, a duplicate in one comparability group, a
   derived claim whose stored result no longer recomputes, and a hand-edited
   comparability group.
8. **Run `pnpm data:report`** and paste the change report into the pull request:
   what values, sources, confidence levels and derived results changed.

### Adding a machine

A new system needs its own record plus the components it is built from, a
configuration that ties them together, and the whole metric backbone (CPU clock,
GPU clock, whole-system memory capacity and bandwidth, peak FP32 and power)
either answered, marked `not-applicable`, or retained as an audited `unknown`.
`pnpm data:coverage` is part of `pnpm check` and fails on a question nobody
asked. It also fails when unread sources rise above the budget recorded beside
the backbone: `unverified` is counted as a gap, never as coverage, so a record
citing an unopened manual cannot make the catalog look finished.

Components are shared where the hardware is the same, and separate where it is
not. Which of those a case is takes an argument, not a guess.

### Adding a photograph

A photograph is the one thing this catalog republishes rather than cites, so it
is held to a different standard than a figure: not "who says so" but "may we
publish this, and is it a picture of the machine".

**What counts as a photograph of the device.** One per machine, and the machine
is the subject.

- The **whole device**, as it was sold. Not a detail, not an opened case, not a
  bare board unless the board is the product. A photograph of the box is a
  photograph of a box. A screenshot of software running on the machine is not a
  photograph of the machine and is never the lead image.
- **No third-party modification.** Recased, repainted, retrobrighted or recapped
  examples, aftermarket shells and mounted expansions all show a machine other
  than the one described. Yellowed plastic and honest wear are the condition of
  the object, not a modification.
- **Context is allowed, competition is not.** A period monitor, a drive or the
  machine's own controller beside it is context. Anything that takes over the
  frame (a display case, a person, another computer) makes it a photograph of
  something else.
- **The frame is narrowed around the machine, never through it.** Most
  photographs are not 4:3 and have to lose something. What a crop may take is
  the room beside the subject: a neighboring exhibit, the end of a museum's
  caption card. What it may never take is a part of the machine, including the
  keyboard or the controller lying in front of it. Where nothing can be cut, the
  recipe pads instead and the record says so.
- **When the photographed model differs from the record**, the caption names the
  model, as the Sega Saturn record does: its figures come from Sega's service
  manual for the PAL console and the photograph is of the first-generation
  machine sold outside Japan, so the caption says both. Silence there would be a
  small false claim made in the reader's own language.
- **`alt` describes the device, not the scene.** It is the picture in words for
  a reader who cannot see it: what the machine looks like, what is beside it,
  and nothing about the lighting or the photographer's studio.

**What makes it publishable.** The rights registry `image-rights-v1` is closed
and admits two bases on identical terms: a license (CC BY, CC BY-SA) and the
public domain (Public Domain Mark, CC0, a photographer's own release, a US
federal government work). `NC` and `ND` are refused, because every published
image here is resized and re-encoded. The record quotes the statement of terms
verbatim as the file's own page words it and records where that statement
stands. It always names the creator, whatever the terms demand, because a
public-domain release may not name anyone else.

**How one is looked for.** Two mistakes cost this catalog four photographs it
already had, so they are worth stating. Search the **category tree**, not the
category: a file repository files a photograph of a console under
`PlayStation 5 models` rather than `PlayStation 5`, and a sweep of the parent
finds die shots and event pictures instead. And never filter candidates **by
shape** before looking at them. A portrait original is a legitimate candidate:
where the subject is short it can be cropped, and where it is not the recipe
pads. Tall machines (an upright console, a phone, a tower) are photographed
portrait almost every time, so a landscape-only filter excludes exactly the
pictures that exist.

**How one is added.** Write the record in
`data/canonical/images/<image-id>.yaml`, run
`pnpm data:fetch --images --only <image-id>` to pull the original into the
ignored cache, then `pnpm data:images` to write the one canonical AVIF the
repository stores and the hash that freezes it. On a whole round of photographs,
add `--if-missing` so files already in the cache are not requested again; a file
store that answers `HTTP 429` is telling you it has been asked too often, and
the fetch waits it out rather than reporting a broken link. Add the id to the
system's `imageIds`; the first entry is the lead photograph. `pnpm check`
verifies the committed file rather than the original, so it needs neither the
cache nor the network.

`pnpm data:image-gaps` writes `data/reports/research/image-requests.md`, the
ignored list of machines still shown in no picture. It is written for somebody
outside this repository. The file is a snapshot, never a gate. Some machines may
never be photographed under terms this project can publish, and that is an
acceptable end state.

### Adding trivia

Trivia is cultural context: what a machine was used for, and the games it is
remembered for. It is not a figure, and no figure rests on it.

Write one file per machine at `src/content/trivia/<system-slug>.md`. The file
name is the system slug, and there is no `system` field in the front matter, so
the machine is named in one place rather than two. `title` is the section
heading and is chosen per entry, because "Trivia" suits an Atari and not a
flight computer. `sourceIds` names records in `data/sources` and needs at least
one.

**The tier exemption, and its limit.** Trivia is not held to the A/B/C evidence
thresholds, for the reason a photograph is not. Those thresholds govern numeric
evidence, and nothing numeric rests on this. Citation still applies. An uncited
cultural claim is a recollection, and a recollection has no locator.

**Authoring constraints.** Start any heading in the body at `###`; the profile
owns the `h2`. No `{{...}}` markers, because nothing resolves them outside the
canonical dataset; write the figure out or write a sentence that does not need
it. Cite through `sourceIds`, never by pasting a URL into the body, which is
also what keeps a long address from overflowing a narrow screen. Run
`pnpm format` and commit what it wrote.

**Keeping a claim checkable.** Game history is easy to get wrong in small ways,
and the failure mode is writing the sentence first and hunting for a citation
afterward. Read the document first; if the sentence you wanted is not in it, the
sentence changes.

- **Never write "first".** It is the most attractive claim and the hardest to
  source, and it is usually wrong on a technicality. Give the year the document
  gives and let the reader do the ordering.
- **A release year is a region and a platform, not a fact.** State what the
  source states, including its region, or state no year.
- **A sales figure is a dated marketing number.** Either "as of `<date>`,
  `<publisher>` stated" or nothing.
- **Authorship is checkable; intent and anecdote are not.** Who wrote something
  is normally documentable. That they wrote it in a weekend is normally
  apocryphal.
- **If the cited document does not contain the sentence, delete the sentence.**
  Do not soften it.

An entry is this project's own sentences about what a document says, never a
rewrite of the document's own passage, and it never quotes more than the short
extract a source record would. The catalog quotes its sources; it does not
republish them.

### What is never a source

- An answer from a language model. It has no locator and cannot be checked.
- A vendor's generational claim ("up to 2× faster than the previous generation")
  with no metric, no benchmark version and no locator.
- A composite vendor index with no unit, such as iCOMP.
- A system-level figure that sums units of different precision.

## Changing the code

- `pnpm check` must pass. So must `pnpm test:e2e` if you touched anything a
  browser renders.
- Main content (profiles, tables, sources, methodology) works without
  JavaScript. A control that cannot work without scripts is absent rather than
  inert.
- Nothing scrolls the page sideways from 320 px up. A wide table or chart
  scrolls inside a container that says it does.
- New quality gates go into the `check` script, not beside it.
- Explain non-obvious invariants beside the code or test that enforces them.

### Changing the logo

`brand/logo.svg` is the artwork. Everything else with a logo in it (the
favicons, the Apple touch icon, the manifest icons, the Open Graph image, the
GitHub avatar and repository social preview) is composed from that file by
`pnpm brand:icons`, so edit the source, run the generator and commit what it
wrote. An output edited by hand is caught by `pnpm check` and lost at the next
run.

The drawing is one stencil alphabet: the mark sets the same R and F as the
wordmark, heavier. A new letterform belongs in `<defs>` beside the others rather
than inline in a composition, and a new output belongs in the generator's list
with a line saying who asks for that file and at what size.

Nothing in the artwork may depend on a font. An SVG that sets type is rendered
with whatever the rasterizer happens to find, which makes the committed image
depend on the machine that produced it.

## License of contributions

Code contributions are under [MIT](../LICENSE); data and prose contributions are
under [CC BY 4.0](../LICENSE-CONTENT.md). Do not paste text from a source
document beyond the short extract a research record needs: the catalog quotes
its sources, it does not republish them.
