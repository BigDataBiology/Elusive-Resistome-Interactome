# Elusive_app

Data pipeline and interactive web app companion to *"The elusive resistome: a
global comparison reveals large discrepancies among detection pipelines"*
(Inda-Díaz et al., bioRxiv 2026). Rebuilt from the paper's
Zenodo data record and VSEARCH clustering output (GitHub).

## Overview

```
download_data.sh      ->  data_zenodo_github/          (raw source files)
build_unigenes.py     ->  unigenes.tsv                 (per-tool ARG calls, habitat-filtered)
rarefy_abundances.py  ->  (rarefaction helper, used by build_core_pan_data.py / core_resistome.py)
build_app_data.py     ->  webapp/data/*.json           (everything the web app needs, except pan/core)
build_core_pan_data.py -> webapp/data/core_pan/*       (per-habitat/tool presence data, fetched on demand)
serve_webapp.sh       ->  http://localhost:8010        (serves webapp/)
```

Run the steps in this order the first time; each script is safe to re-run
(downloads are skipped if the file already exists; the rest just overwrite
their output).

## Requirements

- `curl` (step 1)
- Python 3 with `pandas` and `numpy` (steps 2–4) — see step 0 for setting
  this up reproducibly with pixi
- Any modern browser (step 5) — Plotly is loaded from a CDN, so an internet
  connection is needed even though the app itself runs entirely client-side

## 0. Set up the Python environment

You just cloned this repo. The pipeline scripts (steps 2–4) need Python 3
with `pandas` and `numpy` — pick **one** of the two options below, then use
the matching command style for every step further down.

### Option A — pixi (reproducible, recommended)

This repo already includes `pixi.toml` and `pixi.lock`, pinning the exact
package versions everyone should use.

```bash
curl -fsSL https://pixi.sh/install.sh | sh   # one-time install, then restart your terminal
git clone https://github.com/indajuan/Elusive-Resistome-Interactome.git
cd Elusive-Resistome-Interactome
pixi install                                  # reproduces the exact environment from pixi.lock
```

Then prefix every command in steps 1–5 below with `pixi run`, this will only run each stage,
This runs each stage independently, so you can use it if you want to re-run one stage without 
rebuilding everything from scratch:

+ pixi run download
+ pixi run unigenes
+ pixi run app-data
+ pixi run core-pan
+ pixi run serve

If you want to run everything in order and at once, you use:

```
pixi run pipeline
```

### Option B — install it yourself, no pixi

```bash
pip install pandas numpy   # ideally inside a virtualenv, or: conda install pandas numpy
```

Then run every command in steps 1–5 below exactly as written, no prefix
needed.

## 1. Download the raw data

```bash
./download_data.sh data_zenodo_github
```

Downloads 20 files from the Zenodo record (record 19702877) plus
`clusters.uc` (vsearch cluster assignments) from the
`BigDataBiology/IndaDiaz2026__ARGTools` GitHub repo, into
`data_zenodo_github/`. Includes the per-pipeline ARG call tables
(`pipeline_*.csv`), sample metadata (`metagenomes_metadata.csv`), gene-class
abundance/richness (`abundance_richness.csv.gz`), per-gene abundance
(`args_abundances.tsv.gz`), and the habitat-occurrence table
(`reported_unigenes_as_ARG_per_habitat.csv`).

```bash
./download_data.sh [destination_dir]   # destination_dir defaults to ./data_zenodo_github
```

## 2. Build the unigenes table

```bash
./build_unigenes.py [data_dir] [output_tsv]
# data_dir defaults to data_zenodo_github, output_tsv defaults to unigenes.tsv
```

For each of the tool/identity-threshold variants (DeepARG, fARGene, the
five ABRicate databases, RGI, AMRFinder-Plus, ResFinder, plus their
70/80/90%-identity and amino-acid/BLAST variants), tags every ARG call with
its `tool` name, maps its vsearch cluster centroid, and derives
`new_level_centroid` (the ARG class, propagated across every tool sharing a
centroid via a global majority vote — see the script's diagnostics output
for clusters with disagreeing classifications). Rows are kept only if the
gene was reported as an ARG in at least one of 13 target habitats (human
gut/oral/skin/nose/vagina, dog/cat/mouse/pig gut, wastewater, marine,
freshwater, soil). Writes `unigenes.tsv` (~565k rows).

## 3. Build the web app data

```bash
./build_app_data.py [data_dir] [unigenes_tsv] [out_dir]
# defaults: data_zenodo_github, unigenes.tsv, webapp/data
```

Reads `unigenes.tsv` plus `abundance_richness.csv.gz` and
`metagenomes_metadata.csv`, and reproduces every JSON file the front-end
needs (ARG counts, Jaccard index, identity distributions, gene-class
breakdowns, class-specific coverage, habitat-resolved abundance/richness,
plus per-habitat variants of all of the above) — **except** the Pan-/Core-resistome
page's presence data, which comes from step 4 instead. Also writes
`table_s3_full.csv.gz` (the full per-gene ARG table, offered as a direct
download in the app).

## 4. Build the Pan-/Core-resistome presence data

```bash
./build_core_pan_data.py [data_dir] [unigenes_tsv] [out_dir] [depth] [seed]
# defaults: data_zenodo_github, unigenes.tsv, webapp/data/core_pan, 5e6, 2000
```

Rarefies `args_abundances.tsv.gz` once (same fixed depth/seed as
`rarefy_abundances.py`, ~90s), then collapses each tool's ARG-tagged
unigenes to their vsearch cluster centroid (`clusters.uc`) — matching the R
`core_resistome()`/`filter_samples_core()` design, where a centroid counts
as present in a sample if *any* of its member unigenes is (rarefied count
> 0). Writes, per habitat: a small manifest (`<habitat>.json`, the sample
list + centroid counts per tool) and, per tool, a gzip-compressed presence
file (`<habitat>__<tool>.json.gz`, which centroids are present in which of
that habitat's samples). 286 files, ~61MB total, worst case (human gut +
RGI-BLAST) ~7MB — fetched on demand by the app (manifest once per habitat,
each tool file only when actually run), never preloaded with the rest of
`webapp/data`.

The app's **Pan- and Core-resistome** page (under Habitat level) does the
actual subsampling client-side in JS, per pipeline you select (the 10 basic
tools, with separate DeepARG/RGI identity-threshold dropdowns that swap in
for those two): N times, draw n samples from the chosen habitat and tally
distinct centroids present. **Pan-resistome** = mean distinct-centroid count
across the N subsamples. **Core-resistome** = centroids present in ≥p of a
subsample's n samples, in ≥P of the N subsamples. Bars use each pipeline's
usual color; there's no seeded RNG, so re-running gives slightly different
(but statistically equivalent) results each time, and there's no gene-list
download from the page itself.

## 5. Run the web app

```bash
./serve_webapp.sh
```

Serves `webapp/` at **http://localhost:8010** (needs `webapp/data/*.json`
from step 3 to already exist). Open that URL in a browser — it's a static
site (HTML + JS + JSON, via Plotly), so any static file server works
equally well if you'd rather not use the provided script.

The app has a collapsible left-hand menu (Introduction / General analysis /
Habitat level, each with its own submenu) instead of a single scrolling
page — click any item to jump straight to that view.

## Standalone scripts (not used by the web app)

```bash
./core_resistome.py [data_dir] [output_tsv] [sub_sampling_size] [number_of_subsamples] [depth] [seed]
# defaults: data_zenodo_github, core_resistome.tsv, 100, 500, 5e6, 2000
```

A separate, gene-*class*-level (not per-unigene) core-resistome analysis
across all 21 tools at once, computing `core_resistome.tsv`: a
faithful-but-adapted port of the paper's R `core_resistome()`/
`filter_samples_core()` pipeline — see the script's docstring for the exact
differences from the original R code. This predates, and is superseded for
the web app by, `build_core_pan_data.py` (step 4) — kept here as a
standalone CLI analysis, not wired into the app.

`rarefy_abundances.py` can also be run standalone to inspect the rarefied
abundance table on its own:

```bash
./rarefy_abundances.py [data_dir] [output_file] [depth] [seed]
# defaults: data_zenodo_github, data_zenodo_github/args_abundances_rarefied.tsv.gz, 5e6, 2000
```
