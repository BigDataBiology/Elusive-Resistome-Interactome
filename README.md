# ARG Pipeline Explorer — JS rewrite

A fast, fully client-side replacement for the original R Shiny app. All charts
are interactive (hover, zoom, filter) via Plotly.js, and there is no backend —
every filter change re-renders instantly because the (pre-aggregated) data is
already loaded in the browser.

## Running it

This is a static site — any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser. (Opening `index.html` directly
via `file://` will NOT work — browsers block `fetch()` of local files under
`file://` for security reasons; it needs to be served over http.)

To deploy for real: upload this whole folder (`index.html`, `tabs.js`, `data/`)
to Netlify, GitHub Pages, S3 + CloudFront, or any static host. No server code,
no database, no build step.

## Regenerating the data from your own files

`preprocess.py` + `rds_parser.py` turn the underlying `data.rds` (the same
one your Shiny app's `global.R` loads) into the compact JSON files in `data/`.

```bash
python3 preprocess.py /path/to/data.rds data
```

**Important — this was built against the 8.3MB `data.rds` you uploaded**,
which is already the pre-aggregated, app-ready dataset (summary statistics,
Jaccard/CSC tables, etc.) — not your 3GB raw file. That 3GB file is almost
certainly the raw per-gene, per-pipeline prediction output further upstream
in the pipeline (before the `sumpan2`/`sumcore`/`unigenes`/`csc_fnr`
aggregation step that produces `data.rds`). Two paths forward if you need to
rebuild `data.rds` itself from the 3GB file:

1. **If you still have the R analysis scripts** that produced `data.rds`
   originally (referenced in your `global.R` as living under
   `code_R_analysis/`), the fastest fix is just to keep using those — they
   already do the heavy aggregation once, offline, producing a small file.
   Nothing about switching the *frontend* to JS requires re-doing that step.

2. **If you need to reproduce that aggregation without R**, `rds_parser.py`
   is a from-scratch, dependency-free RDS reader (no `rpy2`/`pyreadr`
   needed) — it can load any RDS file (list-of-dataframes, factors, etc.)
   into pandas. Point me at the 3GB file's structure (or a small sample) and
   I can extend `preprocess.py` to replicate the specific aggregation logic
   in pandas instead of R.

Either way, the JS app itself only ever needs to load the small, aggregated
JSON in `data/` — never the 3GB file directly. That's what makes it fast.

## File overview

| File | Purpose |
|---|---|
| `index.html` | App shell, layout, data loading |
| `tabs.js` | All chart logic (6 tabs) |
| `data/*.json` | Pre-aggregated data (~8MB total, loaded once on startup) |
| `data/table_s3_full.csv.gz` | Full per-gene ARG list — served as a direct download rather than an in-browser table, since it's 240k rows |
| `preprocess.py` | Regenerates everything in `data/` from a `data.rds` |
| `rds_parser.py` | Standalone RDS → pandas reader (no R installation required) |

## What changed vs. the original Shiny app

- **Static images → interactive Plotly charts**: every chart now supports
  hover tooltips, zoom, and pan for free.
- **Server-side re-render on every filter → client-side filtering**: since
  all data is already in the browser, changing a dropdown or chip is instant
  — no round-trip, no spinner.
- **Redesigned, not just ported**:
  - *Pan-/core-resistome*: the dense faceted lollipop grid became a
    per-habitat dumbbell chart (pan vs. core as two connected points per
    pipeline), which is far easier to read at a glance.
  - *Class-specific Overlap*: the large faceted boxplot grid became a
    heatmap (gene class × reference pipeline) with click-through to a
    detail bar chart — you see the overview first, then drill in.
  - *Supplementary ARG table*: rather than rendering 240k rows in a
    browser table (slow, and not that useful to scroll through), it's a
    direct CSV download; the samples table (which is genuinely
    browsable-sized) got a real search + pager instead.
