#!/usr/bin/env python3
"""
Builds webapp/data/*.json for the ARG Pipeline Explorer front-end (a port of
Elusive-Resistome-Interactome/{index.html,tabs.js}), sourced from our own
pipeline outputs instead of the paper's data.rds:

  - unigenes.tsv                                    (built by build_unigenes.py)
  - data_zenodo_github/abundance_richness.csv.gz
  - data_zenodo_github/metagenomes_metadata.csv
  - data_zenodo_github/reported_unigenes_as_ARG_per_habitat.csv

Deliberately excludes pan_resistome.json and core_resistome.json -- those
are fed by core_resistome.py separately.

Usage:
  ./build_app_data.py [data_dir] [unigenes_tsv] [out_dir]

  data_dir      defaults to data_zenodo_github
  unigenes_tsv  defaults to unigenes.tsv
  out_dir       defaults to webapp/data
"""

import sys
import os
import json
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Tool metadata: our unigenes.tsv / abundance_richness.csv tool naming ->
# the reference app's internal tool key + display label + db group + texture.
# (abundance_richness.csv's "pipeline" column already uses the reference
# keys directly; unigenes.tsv uses our own display-style names and needs
# remapping via OUR_TO_KEY below.)
# ---------------------------------------------------------------------------
TOOL_META = {
    # our_name:            (key,                 label,                  db,      texture)
    "DeepARG":             ("DeepARG",            "DeepARG",              " ",     "no"),
    "fARGene":              ("fARGene",            "fARGene",              "  ",    "no"),
    "ABRicate-ARGANNOT":   ("ABRicate-ARGANNOT",  "ABRicate-\nARGANNOT",  "   ",   "no"),
    "ABRicate-MEGARes":    ("ABRicate-MEGARes",   "ABRicate-\nMEGARes",   "    ",  "no"),
    "RGI":                 ("RGI-DIAMOND",        "RGI",                  "CARD",  "no"),
    "ABRicate-CARD":       ("ABRicate-CARD",      "ABRicate-\nCARD",      "CARD",  "yes"),
    "AMRFinder-Plus":      ("AMRFinderPlus",      "AMRFinder-\nPlus",     "NCBI",  "no"),
    "ABRicate-NCBI":       ("ABRicate-NCBI",      "ABRicate-\nNCBI",      "NCBI",  "yes"),
    "ResFinder":           ("ResFinder",          "ResFinder",            "ResFinder", "no"),
    "ABRicate-ResFinder":  ("ABRicate-ResFinder", "ABRicate-\nResFinder", "ResFinder", "yes"),
    "DeepARG-70%":         ("DeepARG70",          "DeepARG-70%",          " ",     "no"),
    "DeepARG-80%":         ("DeepARG80",          "DeepARG-80%",          " ",     "no"),
    "DeepARG-90%":         ("DeepARG90",          "DeepARG-90%",          " ",     "no"),
    "RGI-70%":             ("RGI-DIAMOND70",      "RGI-70%",              "CARD",  "no"),
    "RGI-80%":             ("RGI-DIAMOND80",      "RGI-80%",              "CARD",  "no"),
    "RGI-90%":             ("RGI-DIAMOND90",      "RGI-90%",              "CARD",  "no"),
    "DeepARG-aa":          ("DeepARG-aa",         "DeepARG-aa",           " ",     "no"),
    "RGI-BLAST":           ("RGI-BLAST",          "RGI/nBLAST",           "CARD",  "no"),
    "RGI-aa":              ("RGI-DIAMOND-aa",     "RGI-aa",               "CARD",  "no"),
    "fARGene-aa":          ("fARGene-aa",         "fARGene-aa",           "  ",    "no"),
    "AMRFinder-Plus-nt":   ("AMRFinderPlus-nt",   "AMRFinder-\nPlus-nt",  "NCBI",  "no"),
}
OUR_TO_KEY = {our: meta[0] for our, meta in TOOL_META.items()}
KEY_META = {meta[0]: {"tool": meta[0], "tools_labels": meta[1], "tools_db": meta[2], "texture": meta[3]}
            for meta in TOOL_META.values()}

BASIC_TOOLS = ["DeepARG", "fARGene", "ABRicate-ARGANNOT", "ABRicate-MEGARes",
               "RGI-DIAMOND", "ABRicate-CARD", "AMRFinderPlus", "ABRicate-NCBI",
               "ResFinder", "ABRicate-ResFinder"]
IDENTITY_VARIANTS = ["DeepARG70", "DeepARG80", "DeepARG90",
                      "RGI-DIAMOND70", "RGI-DIAMOND80", "RGI-DIAMOND90"]
CSC_TOOLS = BASIC_TOOLS + IDENTITY_VARIANTS
EXCLUDE_FROM_IDENTITY = {"fARGene", "AMRFinderPlus"}
IDENTITY_TOOLS = [t for t in BASIC_TOOLS if t not in EXCLUDE_FROM_IDENTITY]
IDENTITY_BY_CLASS_TOOLS = ["DeepARG", "DeepARG70", "DeepARG80", "DeepARG90",
                           "RGI-DIAMOND", "RGI-DIAMOND70", "RGI-DIAMOND80", "RGI-DIAMOND90"]

HABITATS = [
    "human gut", "human oral", "human skin", "human nose", "human vagina",
    "dog gut", "cat gut", "mouse gut", "pig gut",
    "wastewater", "marine", "freshwater", "soil",
]

BINS = np.linspace(0, 100, 41)
BIN_CENTERS = ((BINS[:-1] + BINS[1:]) / 2).tolist()


# ---------------------------------------------------------------------------
# helpers (ported from preprocess.py)
# ---------------------------------------------------------------------------
def tukey_whisker_bounds(vals, q25, q75, lo=None, hi=None):
    iqr = q75 - q25
    fence_lo, fence_hi = q25 - 1.5 * iqr, q75 + 1.5 * iqr
    in_range = vals[(vals >= fence_lo) & (vals <= fence_hi)]
    w1 = in_range.min() if len(in_range) else vals.min()
    w2 = in_range.max() if len(in_range) else vals.max()
    if lo is not None:
        w1 = max(w1, lo)
    if hi is not None:
        w2 = min(w2, hi)
    return w1, w2


def q(s, p):
    v = s.quantile(p)
    return 0 if v < 0 else v


def clean_nan(obj):
    if isinstance(obj, float) and np.isnan(obj):
        return None
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj


def records(df):
    return clean_nan(df.to_dict(orient="records"))


def columnar(df):
    cols = list(df.columns)
    data = clean_nan(df[cols].values.tolist())
    return {"columns": cols, "data": data}


def dump(obj, path):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {path}  ({os.path.getsize(path)/1024:.1f} KB)")


def with_meta(df, tool_col="tool"):
    """Attach tools_labels/tools_db/texture columns for the tool keys in tool_col."""
    meta_df = pd.DataFrame(KEY_META.values())
    return df.merge(meta_df, left_on=tool_col, right_on="tool", suffixes=("", "_m"))


def jaccard_table(tool_sets, tools):
    rows = []
    for t1 in tools:
        s1 = tool_sets.get(t1, set())
        for t2 in tools:
            s2 = tool_sets.get(t2, set())
            union = len(s1 | s2)
            rows.append({"tool_ref": t1, "tool_comp": t2,
                         "jaccard": (len(s1 & s2) / union if union else 0.0)})
    return rows


# ---------------------------------------------------------------------------
# global (non-habitat) unigenes-derived tables
# ---------------------------------------------------------------------------
def build_unigenes_globals(unigenes: pd.DataFrame, out_dir: Path):
    print("Building tool_meta.json ...")
    tool_meta_rows = [KEY_META[t] for t in unigenes["tool"].unique() if t in KEY_META]
    dump({"basic_tools": BASIC_TOOLS, "tools": clean_nan(tool_meta_rows)},
         out_dir / "tool_meta.json")

    print("Building ARGs tab data ...")
    counts = (unigenes.drop_duplicates(subset=["query", "tool"])
              .groupby("tool").size().reset_index(name="n"))
    counts = with_meta(counts)[["tool", "tools_labels", "tools_db", "texture", "n"]]
    dump(records(counts), out_dir / "arg_counts.json")

    dedup = unigenes.drop_duplicates(subset=["query", "tool", "new_level"])
    class_counts = dedup.groupby(["tool", "new_level"]).size().reset_index(name="n")
    class_counts["p"] = class_counts.groupby("tool")["n"].transform(lambda s: s / s.sum())
    class_counts = with_meta(class_counts)[["tool", "tools_labels", "tools_db", "texture", "new_level", "n", "p"]]
    dump(columnar(class_counts), out_dir / "gene_class_proportion.json")

    gene_class_order = (unigenes.drop_duplicates(subset="query")
                         .groupby("new_level").size().sort_values(ascending=False).index.tolist())
    fargene_classes = sorted(unigenes[unigenes["tool"] == "fARGene"]["new_level"].dropna().unique().tolist())
    extra_default = ["rpoB", "van", "cell wall charge"]
    default_classes = list(dict.fromkeys(fargene_classes + extra_default))
    default_classes = [c for c in default_classes if c != "qnr"]
    default_classes = [c for c in gene_class_order if c in default_classes]
    dump({"all": gene_class_order, "fargene": fargene_classes, "default_20": default_classes},
         out_dir / "gene_class_order.json")

    print("Computing jaccard (basic tools) ...")
    tool_sets = {t: set(g["query"]) for t, g in unigenes.groupby("tool")}
    jrows = jaccard_table(tool_sets, BASIC_TOOLS)
    for r in jrows:
        ref_set, comp_set = tool_sets.get(r["tool_ref"], set()), tool_sets.get(r["tool_comp"], set())
        r["csc"] = (len(ref_set & comp_set) / len(comp_set)) if comp_set else 0.0
        r["tool_lab_ref"] = KEY_META[r["tool_ref"]]["tools_labels"]
        r["tool_lab_comp"] = KEY_META[r["tool_comp"]]["tools_labels"]
    dump(jrows, out_dir / "jaccard.json")

    print("Computing full pairwise Jaccard across all tool variants ...")
    all_tools = sorted(tool_sets.keys())
    jaccard_full = jaccard_table(tool_sets, all_tools)
    dump(jaccard_full, out_dir / "jaccard_full.json")

    print("Computing identity-level distributions ...")
    identity_dist = []
    for t in IDENTITY_TOOLS + IDENTITY_VARIANTS:
        vals = unigenes[unigenes["tool"] == t]["id"].dropna().values
        if len(vals) == 0:
            continue
        counts_, _ = np.histogram(vals, bins=BINS)
        density = (counts_ / counts_.sum()).tolist()
        identity_dist.append({"tool": t, "n": int(len(vals)), "counts": counts_.tolist(), "density": density})
    dump({"bin_centers": BIN_CENTERS, "tools": identity_dist}, out_dir / "identity_distribution.json")

    print("Computing identity-by-gene-class distributions ...")
    id_by_class_rows = _identity_by_class_rows(unigenes, IDENTITY_BY_CLASS_TOOLS)
    dump(columnar(pd.DataFrame(id_by_class_rows)), out_dir / "identity_by_class.json")

    print("Computing global CSC ...")
    csc_rows = _csc_rows(unigenes, CSC_TOOLS, counts.set_index("tool")["n"].to_dict())
    dump(columnar(pd.DataFrame(csc_rows)), out_dir / "csc.json")

    print("Building table_s3_full.csv.gz ...")
    table_s3 = (unigenes[unigenes["tool"].isin(BASIC_TOOLS)][["query", "new_level", "tool"]]
                .rename(columns={"query": "ARG (Unigene)", "new_level": "Gene Class", "tool": "Pipeline"}))
    csv_path = out_dir / "table_s3_full.csv.gz"
    table_s3.to_csv(csv_path, index=False, compression="gzip")
    print(f"  wrote {csv_path}  ({os.path.getsize(csv_path)/1024:.1f} KB, {len(table_s3):,} rows)")

    return gene_class_order


def _identity_by_class_rows(unigenes, tools):
    rows = []
    for t in tools:
        sub = unigenes[unigenes["tool"] == t]
        for cls, g in sub.groupby("new_level"):
            vals = g["id"].dropna()
            if len(vals) < 3:
                continue
            q25, q50, q75 = q(vals, .25), q(vals, .5), q(vals, .75)
            w1, w2 = tukey_whisker_bounds(vals, q25, q75, lo=0, hi=100)
            rows.append({"tool": t, "new_level": cls, "n": int(len(vals)),
                         "q25": q25, "median": q50, "q75": q75, "w1": w1, "w2": w2})
    return rows


def _csc_rows(unigenes, csc_tools, n_all_by_tool):
    class_tool_sets = {}
    for (t, cls), g in unigenes[unigenes["tool"].isin(csc_tools)].groupby(["tool", "new_level"]):
        class_tool_sets[(t, cls)] = set(g["query"])
    classes = unigenes["new_level"].dropna().unique().tolist()
    rows = []
    for cls in classes:
        for t_ref in csc_tools:
            ref_set = class_tool_sets.get((t_ref, cls))
            if not ref_set:
                continue
            for t_comp in csc_tools:
                if t_comp == t_ref:
                    continue
                comp_set = class_tool_sets.get((t_comp, cls))
                if not comp_set:
                    continue
                rows.append({
                    "new_level": cls, "tool_ref": t_ref, "tool_comp": t_comp,
                    "csc": len(ref_set & comp_set) / len(comp_set),
                    "ref_n_class": float(len(ref_set)), "comp_n_class": float(len(comp_set)),
                    "ref_n_all": float(n_all_by_tool.get(t_ref, 0)),
                    "comp_n_all": float(n_all_by_tool.get(t_comp, 0)),
                })
    return rows


# ---------------------------------------------------------------------------
# per-habitat unigenes-derived tables
# ---------------------------------------------------------------------------
def build_habitat_unigenes(unigenes: pd.DataFrame, hab_csv_path: Path, out_dir: Path):
    print(f"\nBuilding per-habitat data from {hab_csv_path} ...")
    hab = pd.read_csv(hab_csv_path)
    hab.columns = ["query", "habitat"]
    hab = hab[hab["habitat"].isin(HABITATS)]
    uh_all = unigenes.merge(hab, on="query", how="inner")

    hab_arg_counts, hab_gene_class_prop = {}, {}
    hab_jaccard, hab_identity_dist = {}, {}
    hab_identity_by_class, hab_csc = {}, {}

    for h in HABITATS:
        uh = uh_all[uh_all["habitat"] == h]
        if uh.empty:
            continue

        counts = (uh.drop_duplicates(["query", "tool"]).groupby("tool").size().reset_index(name="n"))
        counts = with_meta(counts)[["tool", "tools_labels", "tools_db", "texture", "n"]]
        hab_arg_counts[h] = clean_nan(counts.to_dict(orient="records"))

        cc = (uh.drop_duplicates(["query", "tool", "new_level"])
              .groupby(["tool", "new_level"]).size().reset_index(name="n"))
        cc["p"] = cc.groupby("tool")["n"].transform(lambda s: s / s.sum())
        hab_gene_class_prop[h] = columnar(cc)

        tool_sets = {t: set(g["query"]) for t, g in uh.groupby("tool")}
        hab_jaccard[h] = columnar(pd.DataFrame(jaccard_table(tool_sets, CSC_TOOLS)))

        idist = []
        for t in IDENTITY_TOOLS + IDENTITY_VARIANTS:
            vals = uh[uh["tool"] == t]["id"].dropna().values
            if len(vals) == 0:
                continue
            counts_, _ = np.histogram(vals, bins=BINS)
            density = (counts_ / counts_.sum()).tolist()
            idist.append({"tool": t, "n": int(len(vals)), "density": density})
        hab_identity_dist[h] = {"bin_centers": BIN_CENTERS, "tools": idist}

        ibc_rows = _identity_by_class_rows(uh, IDENTITY_BY_CLASS_TOOLS)
        hab_identity_by_class[h] = columnar(pd.DataFrame(ibc_rows)) if ibc_rows else {"columns": [], "data": []}

        n_all_by_tool = counts.set_index("tool")["n"].to_dict()
        crows = _csc_rows(uh, CSC_TOOLS, n_all_by_tool)
        hab_csc[h] = columnar(pd.DataFrame(crows)) if crows else {"columns": [], "data": []}
        print(f"  habitat '{h}' done ({len(crows):,} csc rows)")

    dump(hab_arg_counts, out_dir / "habitat_arg_counts.json")
    dump(hab_gene_class_prop, out_dir / "habitat_gene_class_proportion.json")
    dump(hab_jaccard, out_dir / "habitat_jaccard_full.json")
    dump(hab_identity_dist, out_dir / "habitat_identity_distribution.json")
    dump(hab_identity_by_class, out_dir / "habitat_identity_by_class.json")
    dump(hab_csc, out_dir / "habitat_csc.json")


# ---------------------------------------------------------------------------
# abundance / richness tables
# ---------------------------------------------------------------------------
def build_abundance(data_dir: Path, out_dir: Path):
    print("\nBuilding Abundance & Richness tab data ...")
    ar = pd.read_csv(data_dir / "abundance_richness.csv.gz")
    metadata = pd.read_csv(data_dir / "metagenomes_metadata.csv")
    metadata = metadata[metadata["habitat"].isin(HABITATS)]
    hab_map = metadata.set_index("sample_id")["habitat"].to_dict()

    ar = ar[ar["sample"].isin(hab_map)]
    ar["habitat"] = ar["sample"].map(hab_map)
    ar["geneclass"] = ar["geneclass"].replace("MFS efflux pump", "efflux pump")
    ar = ar.groupby(["sample", "pipeline", "habitat", "geneclass"], as_index=False)[
        ["abundance", "richness", "richness_no_rarified"]].sum()

    # per-sample-per-tool totals (summed across gene classes)
    tot = ar.groupby(["sample", "pipeline", "habitat"], as_index=False)[["abundance", "richness"]].sum()
    tot = tot.rename(columns={"pipeline": "tool"})
    tot = with_meta(tot)

    def summary_stats(s):
        q25, q50, q75 = q(s, .25), q(s, .5), q(s, .75)
        w1, w2 = tukey_whisker_bounds(s, q25, q75, lo=0)
        return pd.Series({"median": q50, "q25": q25, "q75": q75, "w1": w1, "w2": w2})

    grp_cols = ["tool", "habitat", "tools_labels", "tools_db", "texture"]
    abundance_summary = tot.groupby(grp_cols)["abundance"].apply(summary_stats).unstack().reset_index()
    richness_summary = tot.groupby(grp_cols)["richness"].apply(summary_stats).unstack().reset_index()
    n_samples = metadata.groupby("habitat")["sample_id"].nunique().reset_index(name="n_samples")

    dump(records(abundance_summary), out_dir / "abundance_summary.json")
    dump(records(richness_summary), out_dir / "richness_summary.json")
    dump(records(n_samples), out_dir / "habitat_n_samples.json")

    sub = tot[["tool", "habitat", "sample", "abundance", "richness"]]
    rng = np.random.RandomState(0)
    parts = []
    for _, g in sub.groupby(["tool", "habitat"]):
        n = min(40, len(g))
        parts.append(g.sample(n=n, random_state=rng))
    jitter = pd.concat(parts, ignore_index=True)
    dump(columnar(jitter), out_dir / "abundance_jitter_sample.json")

    print("Building abundance_class_summary (per gene class, zero-filled to all samples per habitat) ...")
    class_rows = []
    for (tool, habitat), g in ar.groupby(["pipeline", "habitat"]):
        habitat_samples = metadata.loc[metadata["habitat"] == habitat, "sample_id"].to_numpy()
        for gene, gg in g.groupby("geneclass"):
            vals = gg.set_index("sample")["abundance"].reindex(habitat_samples, fill_value=0.0)
            q25, q50, q75 = q(vals, .25), q(vals, .5), q(vals, .75)
            w1, w2 = tukey_whisker_bounds(vals, q25, q75, lo=0)
            meta = KEY_META.get(tool, {"tools_labels": tool, "tools_db": "", "texture": "no"})
            class_rows.append({"tool": tool, "habitat": habitat, "gene": gene,
                               "texture": meta["texture"], "tools_labels": meta["tools_labels"],
                               "tools_db": meta["tools_db"],
                               "q50": q50, "q25": q25, "q75": q75, "w1": w1, "w2": w2})
    dump(columnar(pd.DataFrame(class_rows)), out_dir / "abundance_class_summary.json")

    print("Building table_s1_samples.json ...")
    table_s1 = metadata[["sample_id", "habitat"]].drop_duplicates().rename(
        columns={"sample_id": "Sample", "habitat": "Habitat"})
    dump(columnar(table_s1), out_dir / "table_s1_samples.json")


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data_zenodo_github")
    unigenes_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("unigenes.tsv")
    out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("webapp/data")
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Reading unigenes.tsv ...")
    unigenes = pd.read_csv(unigenes_path, sep="\t", low_memory=False)
    unigenes["tool"] = unigenes["tool"].map(OUR_TO_KEY)
    assert unigenes["tool"].notna().all(), "unmapped tool name in unigenes.tsv"
    unigenes["new_level"] = unigenes["new_level"].replace("MFS efflux pump", "efflux pump")

    build_unigenes_globals(unigenes, out_dir)
    build_habitat_unigenes(unigenes, data_dir / "reported_unigenes_as_ARG_per_habitat.csv", out_dir)
    build_abundance(data_dir, out_dir)

    print("\nDone. Data volume summary:")
    total = sum(os.path.getsize(out_dir / fn) for fn in os.listdir(out_dir))
    print(f"  total output size: {total/1024/1024:.2f} MB across {len(os.listdir(out_dir))} files")


if __name__ == "__main__":
    main()
