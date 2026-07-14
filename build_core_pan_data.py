#!/usr/bin/env python3
"""
Precomputes per-habitat, per-tool CENTROID-presence data for the Core-/Pan-
resistome page, matching the R core_resistome()/filter_samples_core()
design: unigenes flagged as ARG by a tool are collapsed to their vsearch
cluster centroid (clusters.uc), and a centroid counts as "present" in a
sample if *any* of its member unigenes (that are ARG calls for that tool in
that habitat) has rarified_count > 0 there.

For every (habitat, tool) pair: which unigenes are ARG calls in that habitat
(from unigenes.tsv + reported_unigenes_as_ARG_per_habitat.csv, same join as
build_app_data.py's per-habitat tables), mapped to centroids, and in which
of that habitat's samples each centroid has >=1 member present (same fixed
rarefaction as core_resistome.py: depth=5e6, seed=2000, via
rarefy_abundances.py).

Output, per habitat, fetched on demand by the Core-/Pan-resistome page (never
eagerly loaded with the rest of webapp/data -- bundling all 21 tools into one
file per habitat ran to 250MB+ for human gut, so data is split per tool too):

  <habitat_slug>.json               small manifest, fetched once per habitat:
    {"samples": [sample_id, ...], "tool_gene_counts": {tool: n_centroids, ...}}

  <habitat_slug>__<tool>.json.gz    fetched only when that tool is selected:
    {"genes": [centroid_id, ...], "presence": [[sample_idx, ...], ...]}  # parallel arrays

Usage:
  ./build_core_pan_data.py [data_dir] [unigenes_tsv] [out_dir] [depth] [seed]

  data_dir      defaults to data_zenodo_github
  unigenes_tsv  defaults to unigenes.tsv
  out_dir       defaults to webapp/data/core_pan
  depth         defaults to 5e6
  seed          defaults to 2000
"""

import sys
import os
import re
import json
import gzip
import time
from pathlib import Path

import pandas as pd

from rarefy_abundances import rarefy

OUR_TO_KEY = {
    "DeepARG": "DeepARG",
    "fARGene": "fARGene",
    "ABRicate-ARGANNOT": "ABRicate-ARGANNOT",
    "ABRicate-MEGARes": "ABRicate-MEGARes",
    "RGI": "RGI-DIAMOND",
    "ABRicate-CARD": "ABRicate-CARD",
    "AMRFinder-Plus": "AMRFinderPlus",
    "ABRicate-NCBI": "ABRicate-NCBI",
    "ResFinder": "ResFinder",
    "ABRicate-ResFinder": "ABRicate-ResFinder",
    "DeepARG-70%": "DeepARG70",
    "DeepARG-80%": "DeepARG80",
    "DeepARG-90%": "DeepARG90",
    "RGI-70%": "RGI-DIAMOND70",
    "RGI-80%": "RGI-DIAMOND80",
    "RGI-90%": "RGI-DIAMOND90",
    "DeepARG-aa": "DeepARG-aa",
    "RGI-BLAST": "RGI-BLAST",
    "RGI-aa": "RGI-DIAMOND-aa",
    "fARGene-aa": "fARGene-aa",
    "AMRFinder-Plus-nt": "AMRFinderPlus-nt",
}

HABITATS = [
    "human gut", "human oral", "human skin", "human nose", "human vagina",
    "dog gut", "cat gut", "mouse gut", "pig gut",
    "wastewater", "marine", "freshwater", "soil",
]


def slug(h):
    return re.sub(r"[^a-z0-9]+", "_", h.lower()).strip("_")


def load_clusters(data_dir):
    """clusters.uc (vsearch UC format) -> {query_id: centroid_id}."""
    cols = [f"V{i}" for i in range(1, 11)]
    df = pd.read_csv(data_dir / "clusters.uc", sep="\t", header=None, names=cols, dtype=str)
    df = df[df["V1"] != "C"]
    df["centroid"] = df["V10"].where(df["V10"] != "*", df["V9"])
    return dict(zip(df["V9"], df["centroid"]))


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data_zenodo_github")
    unigenes_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("unigenes.tsv")
    out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("webapp/data/core_pan")
    depth = float(sys.argv[4]) if len(sys.argv) > 4 else 5e6
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 2000
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()

    print("Reading metadata ...")
    metadata = pd.read_csv(data_dir / "metagenomes_metadata.csv")
    metadata = metadata[metadata["habitat"].isin(HABITATS)]

    print("Reading unigenes.tsv ...")
    unigenes = pd.read_csv(unigenes_path, sep="\t", low_memory=False)
    unigenes["tool"] = unigenes["tool"].map(OUR_TO_KEY)
    assert unigenes["tool"].notna().all(), "unmapped tool name in unigenes.tsv"

    print("Reading habitat-occurrence CSV ...")
    hab = pd.read_csv(data_dir / "reported_unigenes_as_ARG_per_habitat.csv")
    hab.columns = ["query", "habitat"]
    hab = hab[hab["habitat"].isin(HABITATS)]
    uh_all = unigenes.merge(hab, on="query", how="inner")

    print("Reading clusters.uc ...")
    centroid_map = load_clusters(data_dir)
    uh_all["centroid"] = uh_all["query"].map(centroid_map).fillna(uh_all["query"])

    print(f"Reading + rarefying args_abundances.tsv.gz (depth={depth:,.0f}, seed={seed}) ...")
    ar = pd.read_csv(data_dir / "args_abundances.tsv.gz", sep="\t")
    ar = ar.reset_index().rename(columns={"index": "X"})
    print(f"  {len(ar):,} rows loaded ({time.time()-t0:.1f}s elapsed)")
    ar = rarefy(ar, metadata, depth=depth, seed=seed)
    ar = ar[ar["rarified_count"] > 0].rename(columns={"X": "query"})
    hab_map = metadata.set_index("sample_id")["habitat"].to_dict()
    ar["habitat"] = ar["sample"].map(hab_map)
    ar = ar[ar["habitat"].notna()]
    print(f"  {len(ar):,} present (gene,sample) rows after rarefaction ({time.time()-t0:.1f}s elapsed)")

    total_kb = 0
    n_files = 0
    for h in HABITATS:
        th = time.time()
        samples_h = sorted(metadata.loc[metadata["habitat"] == h, "sample_id"].unique())
        sample_to_idx = {s: i for i, s in enumerate(samples_h)}

        ar_h = ar[ar["habitat"] == h]
        gene_to_idxs = (ar_h.groupby("query")["sample"]
                        .apply(lambda s: sorted(sample_to_idx[x] for x in s.unique()))
                        .to_dict())

        uh_h = uh_all[uh_all["habitat"] == h]
        tool_gene_counts = {}
        for t, g in uh_h.groupby("tool"):
            # collapse to centroid: a centroid is present in a sample if any
            # of its member unigenes (ARG calls for this tool, this habitat)
            # is present there -- matches R's filter(query %in% d$query)
            # then group_by(centroid).
            centroid_to_samples = {}
            for query, centroid in g[["query", "centroid"]].drop_duplicates().itertuples(index=False):
                idxs = gene_to_idxs.get(query)
                if not idxs:
                    continue
                centroid_to_samples.setdefault(centroid, set()).update(idxs)

            centroid_list = sorted(centroid_to_samples.keys())
            presence = [sorted(centroid_to_samples[c]) for c in centroid_list]
            tool_gene_counts[t] = len(centroid_list)

            tool_path = out_dir / f"{slug(h)}__{t}.json.gz"
            payload = {"genes": centroid_list, "presence": presence}
            with gzip.open(tool_path, "wt") as f:
                json.dump(payload, f, separators=(",", ":"))
            total_kb += os.path.getsize(tool_path) / 1024
            n_files += 1

        manifest = {"samples": samples_h, "tool_gene_counts": tool_gene_counts}
        manifest_path = out_dir / f"{slug(h)}.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, separators=(",", ":"))
        total_kb += os.path.getsize(manifest_path) / 1024
        n_files += 1

        print(f"  {h}: {len(samples_h)} samples, {len(tool_gene_counts)} tool files "
              f"({time.time()-th:.1f}s)")

    print(f"\nDone in {time.time()-t0:.1f}s total. "
          f"{total_kb/1024:.2f} MB across {n_files} files in {out_dir}")


if __name__ == "__main__":
    main()
