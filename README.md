# ARG Pipeline Explorer

An interactive companion to:

**"The elusive resistome: a global comparison reveals large discrepancies among detection pipelines"**
Inda-Díaz et al., bioRxiv, 2026
https://www.biorxiv.org/content/10.64898/2026.05.11.724158v1

This app presents the paper's results as an interactive, guided walkthrough — ARG
counts, pairwise pipeline agreement (Jaccard index), identity-to-reference
distributions, gene-class breakdowns, class-specific coverage, and
habitat-resolved abundance/richness/resistome-size — instead of static figures.
Every chart supports hovering, filtering by pipeline or identity threshold, and
switching habitats, and everything updates instantly since it all runs
client-side in the browser (no server, no backend).

This is an independent, unofficial rebuild of the paper's companion Shiny app,
not affiliated with the authors.

## Running it locally

This is a static site (HTML + JS + JSON data) — no build step, no server code.
From inside this folder, start any local static file server, for example:

​```bash
python3 -m http.server 8000
​```

Then open **http://localhost:8000** in a browser.

> Opening `index.html` directly by double-clicking it (`file://...`) will
> **not** work — browsers block `fetch()` requests to local files for security
> reasons, and this app loads its data via `fetch()`. It has to be served over
> `http://`.

To stop the server, go back to the terminal and press `Ctrl+C`.

## Regenerating the data

The JSON files in `data/` are pre-built from the underlying `data.rds` (plus a
habitat-occurrence CSV for the habitat-specific analysis). You only need to
regenerate them if that source data changes:

​```bash
python3 preprocess.py path/to/data.rds data path/to/habitat_occurrence.csv
​```

(the third argument is optional — omit it to skip building the habitat-specific
data). This uses `rds_parser.py`, a standalone RDS reader, so no R installation
is required.

## File overview

| File | Purpose |
|---|---|
| `index.html` | App shell: page structure, styling, data loading |
| `tabs.js` | All chart and interaction logic |
| `data/*.json` | Pre-aggregated data, loaded once on startup |
| `data/table_s3_full.csv.gz` | Full per-gene ARG list, provided as a direct download |
| `preprocess.py` | Regenerates everything in `data/` |
| `rds_parser.py` | Standalone RDS → pandas reader (no R required) |