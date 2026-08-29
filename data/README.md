# Data directories

Everything under `data/` is either hand-curated and committed or generated and
ignored. Every file is authoritative or disposable.

| Directory                     | Committed | Written by                           | Contents                                                                   |
| ----------------------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `data/canonical/systems`      | yes       | editors                              | One `System` record per file, `<slug>.yaml`.                               |
| `data/canonical/components`   | yes       | editors                              | One `Component` record per file, `<kind>-<slug>.yaml`.                     |
| `data/canonical/images`       | yes       | editors, `data:fetch`, `data:images` | One `ImageAsset` record per file, `<image-id>.yaml`.                       |
| `data/canonical/measurements` | yes       | editors, `data:normalize`            | Measurement records grouped per subject, `<subject-slug>.yaml`.            |
| `data/canonical/derived`      | yes       | editors                              | `DerivedClaim` records; results are recomputed and checked, never trusted. |
| `data/canonical/conflicts`    | yes       | editors                              | Conflict ledger entries with the editorial decision.                       |
| `data/sources`                | yes       | editors, `data:fetch`                | Source manifests, `<source-id>.yaml`. Fetch may add metadata, never facts. |
| `data/extracts`               | yes       | editors, `data:extract-hash`         | Research records for PDFs and scans: locator, short extract, hash.         |
| `data/cache`                  | **no**    | `data:fetch`                         | Raw downloaded artifacts plus response metadata and SHA-256.               |
| `src/assets/images/systems`   | yes       | `data:images`                        | Canonical AVIF files, `<image-id>.avif`. The only image bytes committed.   |
| `data/reports`                | **no**    | `data:build`                         | Change reports for data pull requests.                                     |
| `public/data`                 | **no**    | `data:build`                         | Public exports: `catalog-v1.json`, `catalog-summary-v1.json`, CSV.         |

## Transcribing a research record

Write the record with the locator, the verbatim extract and any notes, leave
`extractHash` as sixty-four zeros, then run:

```bash
pnpm data:extract-hash --write
```

It hashes the parsed extract string rather than the file bytes, so YAML layout
can never change the digest. Without `--write` it reports and exits non-zero,
which makes it usable as a check; the same mismatch is an error in
`data:validate`, so a hand-edited transcription fails the build either way.
Computing the hash by hand defeats its purpose. The command derives it from the
transcribed extract.

## Adding a photograph

Write the image record with the creator, the source page, the original's URL and
pixel size, the rights basis with its verbatim statement, the credit line, the
alternative text and the transformation recipe. Leave both hashes as sixty-four
zeros and the canonical byte length as `1`; they are derived, not transcribed.
Then:

```bash
pnpm data:fetch --only <image-id>
```

```bash
pnpm data:images
```

The first downloads the original into the ignored cache and records its hash;
the second applies the recipe, writes the canonical AVIF and records its hash
and size. The commands stop if a recipe would stretch or enlarge the photograph,
the original hash has changed, or the file exceeds 250 KiB. Run
`pnpm data:images --check` to confirm that a committed file still matches its
recipe.

Only then set `editorialStatus` to `approved` and add the id to the system's
`imageIds`. `data:fetch` does not update an approved record. It reports an
upstream re-upload for review.

## Writing YAML

Canonical records use YAML 1.2. Keep prose at 80 columns: `>-` folds editorial
paragraphs into one string, while `|-` preserves a line break that belongs to a
verbatim extract or another value. Do not use anchors, aliases, merge keys or
explicit tags. JSON remains only for machine-oriented inputs such as the fetch
allowlist, cache metadata and public exports.

## Who formats what

Whoever writes a file owns its layout. `data:normalize` rewrites
`data/canonical/measurements`, `data:fetch` rewrites `data/sources`, and
`data:fetch` and `data:images` both rewrite `data/canonical/images`. They keep
the existing key order, comments and prose blocks while writing their own
fields, and emit YAML at 80 columns. Oxfmt ignores those three directories so it
cannot make `data:normalize --check` stale after a formatting pass. Oxfmt
formats the directories that only editors write, like any other source file.

## Editorial ownership

`data:fetch` is the only step that touches the network. It writes only to
`data/cache` and the fetch-provenance block of a source manifest. It does not
rewrite a figure or overwrite a record whose `editorialStatus` is `approved`.
When upstream source content changes, it reports the change for review.

## Record identity

Identifiers are stable and human-meaningful. Renaming a slug breaks public
exports and shared comparison URLs, so it requires a redirect.

## Numbers

Every figure is an exact decimal string with the significant digits the source
actually carried. Values are never parsed into JavaScript numbers anywhere in
the pipeline. Absence is `unknown` or `not-applicable`; it is never zero.
