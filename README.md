# RetroFlops

RetroFlops is a catalog and comparison site for historic and modern computers,
consoles, CPUs, and GPUs. Each catalog figure carries its source, an exact
locator, how it was obtained, and its evidence-review status.

There is no aggregate score. MIPS, DMIPS, FLOPS, SPEC results, memory bandwidth,
TDP, and whole-system power stay separate. An "N× faster" multiplier appears
only when the metric, method, benchmark identity, and device scope match.
`reported` and `rumored` figures remain visible, but stay provisional and never
feed automatic multipliers. Missing data is recorded as `unknown`;
`not-applicable` is reserved for a quantity that does not exist for that
hardware. Neither is represented as zero.

> [!NOTE]
>
> RetroFlops began as the catalog I wanted to browse: a deliberately chosen set
> of older computers and consoles placed beside modern machines. I never wanted
> to build another database that compares every current processor or phone.
>
> I am happy with the architecture and automation behind the site. The data has
> been much harder. Finding the right documents, checking the exact hardware
> configuration and deciding which figures can be compared takes more time than
> building the software. There is still a long list of gaps I want to close.
>
> I use automation, including AI-assisted tools, while developing the project
> and reviewing changes. Their output is never accepted as evidence and cannot
> approve a figure on its own. Every catalog figure still needs a source that a
> person can open and check.
>
> If you spot a wrong figure or know a better source, please
> [open an issue](https://github.com/retroflops/retroflops/issues) with the
> machine, the value, and a page or table locator. Each proposal has to pass the
> same sourcing and validation rules as the rest of the catalog. Full data pull
> requests are welcome too; [the contribution guide](docs/CONTRIBUTING.md)
> explains the process.

Built with Astro in fully static output, deployed to GitHub Pages, with no
backend and no runtime API. The production build never touches the network.

## The site

The catalog is a website; reading it is the point.

**<https://retroflops.github.io/>**

- **Explore** — every machine in one list, with search, filters and sorting.
- **Compare** — two to four systems side by side, one metric at a time, with the
  formula and the caveats attached to each cell.
- **Timeline** — one metric, one comparability group, plotted across the years.
- **Methodology** — what each metric means and when a comparison is refused.

Every profile ends in its sources, and the whole catalog is published as
`/data/catalog-v1.json` and `/data/measurements-v1.csv` for anyone who would
rather have the numbers than the pages.

## Working on it

`pnpm install && pnpm dev` is the whole setup: there is nothing to stand up
behind it. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the commands, the
quality gate, the data pipeline and how the two published addresses are built.

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — running it locally, the commands
  and the pipeline.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — adding or correcting data.
- [data/README.md](data/README.md) — what each data directory holds and who
  writes it.

## License

Copyright © 2026 Wojciech Polak and contributors. The source lives at
<https://github.com/retroflops/retroflops>.

The code is [MIT](LICENSE). The catalog, the editorial prose and the published
exports are [CC BY 4.0](LICENSE-CONTENT.md). The documents cited by the catalog
belong to their publishers and are quoted, not republished. Each source record
states its license and any constraint that travels with a quotation.
