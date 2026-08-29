# License of the content and the data

Three different things live in this repository, and they are not under one
license.

## The code — MIT

Everything under `src/`, `scripts/`, `tests/` and the configuration files. See
[LICENSE](LICENSE).

## The catalog and the editorial prose — CC BY 4.0

Everything under `data/canonical/`, the source manifests in `data/sources/`, the
methodology and preset texts in `src/content/`, the documents in `docs/`, and
the published exports built from them:

- `/data/catalog-v1.json`
- `/data/catalog-summary-v1.json`
- `/data/measurements-v1.csv`

These are licensed under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).
You may share and adapt them, including commercially, provided you give
appropriate credit ("RetroFlops", with a link to
<https://github.com/retroflops/retroflops>) and say whether you changed
anything.

Individual facts are not copyrightable in most jurisdictions, and this license
does not claim otherwise. What it covers is the compilation: which machines were
chosen, which figures were judged acceptable, how they were normalized and
grouped, and the prose that explains all of it.

## The cited documents — their publishers'

Every figure in the catalog comes from a document somebody else wrote, and
nothing here grants any right over those documents.

- Each record in `data/sources/` states the license its publisher applies, in
  its `license` field, and any constraint that travels with a quotation in
  `usageNote`. Both are shown on the source's page on the site.
- **32 of the 38 sources are tier A**, mostly vendor documentation and technical
  manuals: they are quoted, not republished. Where an extract appears, in a
  research record or beside a figure, it is short and exists so a reader can
  check the number against its source.
- **NASA documents are public domain** as works of the United States Government,
  and are the only sources here with no restriction at all.
- **SPEC results carry the
  [SPEC Fair Use Rules](https://www.spec.org/products/fairuse/)**, which travel
  with the figure wherever it appears; the `usageNote` on those records is what
  puts the notice next to the number.
- **One source states no license at all** — Netlib's Dhrystone performance
  database, which has no governing body and publishes no terms. Its record says
  so rather than assuming a permission nobody granted.

If you are the rights holder of a cited document and something here overreaches,
open an issue: the figure will be re-sourced or removed, and the reasoning
recorded.

## Redistributing the exports

The exports carry no timestamp and no build identifier, so a copy can be
verified byte for byte against a build of the same records. Redistribute them
under CC BY 4.0 with attribution, and keep the source records with them: a
figure without its citation is exactly what this project exists not to publish.
