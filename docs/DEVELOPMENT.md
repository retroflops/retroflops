# Development

Everything here runs offline except the two commands that say otherwise. The
site is generated: there is no backend to stand up, no database to seed and no
API key to obtain, so a checkout, an install and one command are the whole
setup.

## Running it locally

Node and pnpm are pinned by `.node-version`, `engines` and `packageManager`. Use
[Corepack](https://nodejs.org/api/corepack.html) or a version manager that reads
`.node-version` rather than whatever is on the path.

```bash
pnpm install
pnpm dev
```

`predev` runs `data:build` first, so the dev server always starts from freshly
exported data. Editing a record under `data/canonical/` means running
`pnpm data:build` again to see it.

Full-text search does not exist on the dev server. Pagefind indexes the built
output, so search only works after a production build:

```bash
pnpm build && pnpm preview
```

`pnpm preview` serves `dist` exactly as it will be deployed, base path and all.

## Commands

| Command                | What it does                                                                |
| ---------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`             | Astro dev server. It does not include the search index.                     |
| `pnpm build`           | `data:build`, then the production build, then the Pagefind index.           |
| `pnpm preview`         | Serves `dist` exactly as it will be deployed.                               |
| `pnpm check`           | The aggregate gate. Run this before opening a pull request.                 |
| `pnpm test`            | Unit tests (Vitest).                                                        |
| `pnpm test:e2e`        | End-to-end suite (Playwright): builds both sites, then runs against them.   |
| `pnpm lighthouse`      | Lighthouse CI over `dist`, with the budgets in `lighthouserc.json`.         |
| `pnpm budgets`         | Initial JavaScript per page kind, gzipped, and which chunks must stay lazy. |
| `pnpm brand:icons`     | Regenerates every icon and social image from `brand/logo.svg`.              |
| `pnpm format` / `lint` | Oxfmt (plus Prettier for `.astro`) / Oxlint.                                |
| `pnpm typecheck`       | `astro check`.                                                              |

`pnpm check` runs, in order: `format:check`, `lint`, `typecheck`,
`brand:icons:check`, `data:normalize:check`, `data:validate`, `data:coverage`,
`test`, `build` and `budgets`. New gates are added to that script rather than
beside it.

## The data pipeline

| Command                  | Network | What it does                                                         |
| ------------------------ | ------- | -------------------------------------------------------------------- |
| `pnpm data:fetch`        | **yes** | Downloads allowlisted sources into the ignored cache, with SHA-256.  |
| `pnpm data:normalize`    | no      | Converts units with decimal arithmetic, preserving source precision. |
| `pnpm data:validate`     | no      | Schema, references, units, sources, comparability, duplicates.       |
| `pnpm data:coverage`     | no      | The metric backbone × machine matrix; fails on any unasked question. |
| `pnpm data:build`        | no      | Writes the deterministic public exports.                             |
| `pnpm data:report`       | no      | Change report for a data pull request.                               |
| `pnpm data:extract-hash` | no      | Hashes a transcribed extract in a research record.                   |
| `pnpm data:links`        | **yes** | Are the cited documents still reachable? Run monthly by a workflow.  |

`data:fetch` and `data:links` are the only commands that reach the network, and
neither runs during a build. Two builds from identical inputs produce identical
artifacts. Adding or correcting a record is a separate procedure, written up in
[CONTRIBUTING.md](CONTRIBUTING.md).

## How the site is published

The source lives in this repository, `retroflops/retroflops`. The site is served
at <https://retroflops.github.io/>, which is a different repository:
`retroflops/retroflops.github.io`, named after the domain because that is the
only way GitHub serves an organization site from the root.

The build happens there, not here. `actions/deploy-pages` publishes to the Pages
site of the repository it runs in and takes no repository argument, so the
publishing repository holds one workflow and nothing else: it checks this
repository out, builds it and deploys the result through the ordinary artifact
deployment. Pushing to `main` here runs
[deploy.yml](../.github/workflows/deploy.yml), whose whole job is to ask for
that run and name the commit it wants built. Consequences worth knowing:

- **Nothing generated is ever committed.** The published site exists as a Pages
  artifact, so neither repository carries build output in its history.
- **What is published is the commit that passed CI.** The dispatch names
  `GITHUB_SHA` rather than letting the other repository resolve `main`, which by
  then may have moved.
- **The dispatch needs a credential, and only that.** `PAGES_DISPATCH_TOKEN`, a
  secret here, is a fine-grained token whose sole permission is `actions: write`
  on the publishing repository. It can start that workflow and nothing else; it
  cannot write a file anywhere.
- **The other repository's workflow is versioned here.**
  [.github/pages-repository/publish.yml](../.github/pages-repository/publish.yml)
  is the canonical copy, kept beside the source it builds and reviewed in the
  pull request that changes the build. The deployed copy is updated by hand, but
  not on trust: a run checks out both repositories and compares the two files
  byte for byte, and refuses to publish if they differ. Changing the build
  therefore means copying the file across: a forgotten copy fails the next
  deployment instead of quietly publishing a recipe nobody reviewed.
- **The build and the deployment log live over there.** A failed publish shows
  up in the publishing repository's Actions tab, not in the run that asked for
  it.

## Building for the deployed address

The deployed build is served from the root of the domain, so it takes the
default `BASE_PATH=/`:

```bash
SITE_URL=https://retroflops.github.io pnpm build
```

A build under a repository prefix still has to work, and CI still proves it:

```bash
BASE_PATH=/retroflops/ SITE_URL=https://example.github.io pnpm build
```

That is a portability check rather than a deployment; nothing is served from
that address. It exists because an absolute path hard-coded anywhere in a route,
an asset URL or the manifest is invisible at the root and total under a prefix,
and finding out later would mean the site could never move. The end-to-end suite
runs both at once; `pnpm build:pages` and `pnpm preview:pages` are the prefixed
pair.
