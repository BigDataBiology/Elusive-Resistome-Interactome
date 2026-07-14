# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A data pipeline plus a static web app ("ARG Pipeline Explorer") that accompany the paper
*"The elusive resistome: a global comparison reveals large discrepancies among detection
pipelines"* (Inda-Díaz et al., bioRxiv 2026). The Python scripts rebuild every JSON the
front-end needs from the paper's raw data (Zenodo record 19702877 + VSEARCH clustering
output from `BigDataBiology/IndaDiaz2026__ARGTools`). This is a reimplementation of the
paper's original R analysis (`data.rds`, `core_resistome()`); scripts aim to faithfully port
that R logic, with documented deviations in their docstrings.

## Commands

The pipeline is a strict dependency chain — run in order the first time. Each stage
overwrites its output and is safe to re-run; downloads are skipped if the file exists.

With pixi (reproducible, pins versions via `pixi.lock`):

```bash
pixi install
pixi run download    # download_data.sh -> data_zenodo_github/
pixi run unigenes    # build_unigenes.py -> unigenes.tsv
pixi run app-data    # build_app_data.py -> webapp/data/*.json
pixi run core-pan    # build_core_pan_data.py -> webapp/data/core_pan/*
pixi run serve       # serve_webapp.sh -> http://localhost:8010
pixi run pipeline    # runs download->unigenes->app-data->core-pan, then serves
```

Without pixi, run the scripts directly (they are chmod +x, each takes positional args with
defaults — see each script's docstring):

```bash
./download_data.sh [dest_dir]
./build_unigenes.py [data_dir] [output_tsv]
./build_app_data.py [data_dir] [unigenes_tsv] [out_dir]
./build_core_pan_data.py [data_dir] [unigenes_tsv] [out_dir] [depth] [seed]
./serve_webapp.sh
```

There are no automated tests, linter, or build step. Verify changes by re-running the
relevant stage and opening the app. `build_core_pan_data.py` and `core_resistome.py` are slow
(the rarefaction step alone is ~90s over the ~900MB `args_abundances.tsv.gz`).

## Data flow and dependency chain

```
download_data.sh   -> data_zenodo_github/          20 Zenodo files + clusters.uc (from GitHub)
build_unigenes.py  -> unigenes.tsv                 ~565k rows: per-tool ARG calls, habitat-filtered
build_app_data.py  -> webapp/data/*.json           everything the front-end eager-loads
build_core_pan_data.py -> webapp/data/core_pan/*   per-habitat/tool presence, fetched on demand
```

`build_app_data.py` and `build_core_pan_data.py` both read `unigenes.tsv`; they are
independent of each other but both depend on it. `build_core_pan_data.py` imports
`rarefy(...)` directly from `rarefy_abundances.py`.

**None of the generated data is in git** — `data_zenodo_github/`, `unigenes.tsv`, and
`webapp/data/` are all gitignored (only `webapp/index.html` and `webapp/tabs.js` are tracked).
A fresh clone must run the pipeline before the app has anything to serve.

## Key domain concepts (needed to read any script)

- **Tools / pipelines**: 21 ARG-detection variants (DeepARG, fARGene, five ABRicate
  databases, RGI, AMRFinder-Plus, ResFinder, plus 70/80/90%-identity and amino-acid/BLAST
  variants). `build_unigenes.py`'s `JOBS` list defines them: `(source_csv, tool_label, min_id)`.
  Note some tools reuse the same source CSV filtered at different identity thresholds.
- **Tool name remapping (cross-file gotcha)**: `build_unigenes.py` writes human display names
  (e.g. `"RGI"`, `"DeepARG-70%"`). The front-end and `abundance_richness.csv` use internal
  keys (e.g. `"RGI-DIAMOND"`, `"DeepARG70"`). `build_app_data.py` (`TOOL_META` / `OUR_TO_KEY`)
  and `build_core_pan_data.py` (`OUR_TO_KEY`) both translate one to the other. If you add or
  rename a tool, update **all** of: `JOBS`, both `OUR_TO_KEY` maps, and `TOOL_META`.
- **Centroids**: `clusters.uc` (VSEARCH UC format) maps each unigene → its cluster centroid.
  Core/pan analysis collapses each tool's ARG calls to centroids; a centroid is "present" in a
  sample if *any* member unigene has rarefied count > 0.
- **Habitats**: a fixed set of 13 (human gut/oral/skin/nose/vagina, dog/cat/mouse/pig gut,
  wastewater, marine, freshwater, soil), hard-coded in multiple scripts. `build_unigenes.py`
  keeps only genes reported as an ARG in ≥1 of these.
- **Rarefaction**: multinomial subsampling to a common depth (default 5e6, seed 2000). The
  Python `rng.multinomial` does **not** reproduce R's `rmultinom` bit-for-bit; the seed only
  guarantees reproducibility across runs of the Python script.

## Front-end (`webapp/`)

Static site: `index.html` + `tabs.js` (~1800 lines, no framework, no build), Plotly loaded
from CDN (so serving needs internet even though logic is client-side). `index.html` defines
`DATA_FILES` and eagerly fetches every `data/*.json` into a global `DATA` object on load;
`tabs.js` renders a collapsible-sidebar SPA (`initApp` → `buildSidebar` → `navigateTo`) with
`render*Section` functions per view. The Core-/Pan-resistome page is the exception: it fetches
`webapp/data/core_pan/` files on demand (manifest once per habitat, each `__<tool>.json.gz`
only when selected) and does the subsampling client-side in JS — the ~61MB of presence data is
too large to preload.

## Standalone scripts (not wired into the app)

- `core_resistome.py` — gene-*class*-level core-resistome across all 21 tools; a separate port
  of the R pipeline, superseded for the app by `build_core_pan_data.py` but kept as a CLI.
- `rarefy_abundances.py` — also runnable standalone to inspect the rarefied abundance table;
  its `rarefy()` is imported by `build_core_pan_data.py`.
