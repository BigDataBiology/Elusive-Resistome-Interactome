"""
Preprocess the resistome Shiny data (data.rds) into compact JSON bundles
for the JS/Plotly web app. Run this once (or whenever the source data.rds
changes) to regenerate /data/*.json.

Usage:
    python3 preprocess.py /path/to/data.rds /path/to/output_dir
"""
import sys, os, json
import numpy as np
import pandas as pd
from rds_parser import load_rds, rlist_names, rdf_to_pandas

def clean_nan(obj):
    """Recursively replace NaN/NaT with None so json.dumps produces valid JSON."""
    if isinstance(obj, float) and (np.isnan(obj)):
        return None
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj

def records(df):
    return clean_nan(df.to_dict(orient="records"))

def columnar(df):
    """Column-oriented representation: {columns:[...], data:[[row],[row],...]}
    Cuts JSON size substantially vs record-per-row when there are many text columns."""
    cols = list(df.columns)
    data = clean_nan(df[cols].values.tolist())
    return {"columns": cols, "data": data}


def dump(obj, path):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {path}  ({os.path.getsize(path)/1024:.1f} KB)")

def build_habitat_data(unigenes, hab_csv_path, basic_tools, out_dir):
    import time
    t0 = time.time()
    print(f"\nBuilding per-habitat data from {hab_csv_path} ...")
    hab = pd.read_csv(hab_csv_path)
    hab.columns = ["query", "habitat"]
    uh_all = unigenes.merge(hab, on="query", how="inner")
    habitats = sorted(uh_all["habitat"].unique().tolist())
    all_tools = sorted(unigenes["tool"].unique().tolist())
    # Only tool variants actually selectable in the UI (10 core + the 6 identity-threshold
    # variants for DeepARG/RGI-DIAMOND) -- excludes -aa/-nt/RGI-BLAST duplicates never shown.
    csc_tools = [t for t in (list(basic_tools) +
                 ["DeepARG70","DeepARG80","DeepARG90","RGI-DIAMOND70","RGI-DIAMOND80","RGI-DIAMOND90"])
                 if t in all_tools]
    EXCLUDE_FROM_IDENTITY = {"fARGene", "AMRFinderPlus"}
    IDENTITY_TOOLS = [t for t in basic_tools if t not in EXCLUDE_FROM_IDENTITY]
    bins = np.linspace(0, 100, 41)
    centers = ((bins[:-1] + bins[1:]) / 2).tolist()

    def q(s, p):
        v = s.quantile(p)
        return 0 if v < 0 else v

    hab_arg_counts = {}
    hab_gene_class_prop = {}
    hab_jaccard = {}
    hab_identity_dist = {}
    hab_identity_by_class = {}
    hab_csc = {}

    for h in habitats:
        uh = uh_all[uh_all["habitat"] == h]
        meta_cols = uh.drop_duplicates("tool")[["tool", "tools_labels", "tools_db", "texture"]]

        # ARG counts
        counts = (uh.drop_duplicates(["query", "tool"]).groupby("tool").size()
                  .reset_index(name="n").merge(meta_cols, on="tool"))
        hab_arg_counts[h] = clean_nan(counts.to_dict(orient="records"))

        # Gene class proportion/counts
        cc = (uh.drop_duplicates(["query", "tool", "new_level"])
              .groupby(["tool", "new_level"]).size().reset_index(name="n"))
        cc["p"] = cc.groupby("tool")["n"].transform(lambda s: s / s.sum())
        hab_gene_class_prop[h] = columnar(cc)

        # Jaccard (tool pairs actually used in the UI)
        tool_sets = {t: set(g["query"]) for t, g in uh.groupby("tool")}
        jrows = []
        for t1 in csc_tools:
            s1 = tool_sets.get(t1, set())
            for t2 in csc_tools:
                s2 = tool_sets.get(t2, set())
                union = len(s1 | s2)
                jrows.append({"tool_ref": t1, "tool_comp": t2,
                              "jaccard": (len(s1 & s2) / union if union else 0.0)})
        hab_jaccard[h] = columnar(pd.DataFrame(jrows))

        # Identity distribution (DeepARG/RGI-family basic tools, excl. fARGene/AMRFinderPlus)
        idist = []
        for t in IDENTITY_TOOLS:
            vals = uh[uh["tool"] == t]["id"].dropna().values
            if len(vals) == 0:
                continue
            counts_, _ = np.histogram(vals, bins=bins)
            density = (counts_ / counts_.sum()).tolist()
            idist.append({"tool": t, "n": int(len(vals)), "density": density})
        hab_identity_dist[h] = {"bin_centers": centers, "tools": idist}

        # Identity by class (DeepARG, RGI-DIAMOND only)
        ibc_rows = []
        for t in ["DeepARG", "RGI-DIAMOND"]:
            sub = uh[uh["tool"] == t]
            for cls, g in sub.groupby("new_level"):
                vals = g["id"].dropna()
                if len(vals) < 3:
                    continue
                q25, q50, q75 = q(vals, .25), q(vals, .5), q(vals, .75)
                iqr = q75 - q25
                ibc_rows.append({"tool": t, "new_level": cls, "n": int(len(vals)),
                                  "q25": q25, "median": q50, "q75": q75,
                                  "w1": max(0, q25-1.5*iqr), "w2": min(100, q75+1.5*iqr)})
        hab_identity_by_class[h] = columnar(pd.DataFrame(ibc_rows)) if ibc_rows else {"columns": [], "data": []}

        # CSC (class-specific coverage), same formula as the global csc_fnr table:
        # csc(ref, comp, class) = |genes(ref,class) ∩ genes(comp,class)| / |genes(comp,class)|
        class_tool_sets = {}
        for (t, cls), g in uh.groupby(["tool", "new_level"]):
            class_tool_sets[(t, cls)] = set(g["query"])
        classes_here = uh["new_level"].unique().tolist()
        crows = []
        for cls in classes_here:
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
                    csc_val = len(ref_set & comp_set) / len(comp_set)
                    crows.append({"new_level": cls, "tool_ref": t_ref, "tool_comp": t_comp, "csc": csc_val})
        hab_csc[h] = columnar(pd.DataFrame(crows)) if crows else {"columns": [], "data": []}
        print(f"  habitat '{h}' done ({time.time()-t0:.1f}s elapsed, {len(crows):,} csc rows)")

    dump(hab_arg_counts, os.path.join(out_dir, "habitat_arg_counts.json"))
    dump(hab_gene_class_prop, os.path.join(out_dir, "habitat_gene_class_proportion.json"))
    dump(hab_jaccard, os.path.join(out_dir, "habitat_jaccard_full.json"))
    dump(hab_identity_dist, os.path.join(out_dir, "habitat_identity_distribution.json"))
    dump(hab_identity_by_class, os.path.join(out_dir, "habitat_identity_by_class.json"))
    dump(hab_csc, os.path.join(out_dir, "habitat_csc.json"))
    print(f"Per-habitat data done in {time.time()-t0:.1f}s total.")


def main(rds_path, out_dir, hab_csv_path=None):
    os.makedirs(out_dir, exist_ok=True)
    print("Parsing RDS ...")
    obj = load_rds(rds_path)
    names = rlist_names(obj)
    tables = {name: rdf_to_pandas(item) for name, item in zip(names, obj["value"])}

    abundance_tool_sample = tables["abundance_tool_sample"]
    sumpan2               = tables["sumpan2"]
    unigenes               = tables["unigenes"]
    csc_fnr                = tables["csc_fnr"]
    abundance_class_summary = tables["abundance_class_summary"]
    sumcore                = tables["sumcore"]
    JI_all_plot            = tables["JI_all_plot"]

    # ---------- static lookup: tool metadata (mirrors global.R) ----------
    basic_tools = ["DeepARG","fARGene","ABRicate-ARGANNOT","ABRicate-MEGARes",
                   "RGI-DIAMOND","ABRicate-CARD","AMRFinderPlus","ABRicate-NCBI",
                   "ResFinder","ABRicate-ResFinder"]
    tool_meta = (abundance_tool_sample[["tool","tools_labels","tools_db","texture"]]
                 .drop_duplicates(subset="tool")
                 .to_dict(orient="records"))
    dump({"basic_tools": basic_tools, "tools": clean_nan(tool_meta)},
         os.path.join(out_dir, "tool_meta.json"))

    # ---------- ARGs tab ----------
    print("Building ARGs tab data ...")
    unigenes_counts = (unigenes.drop_duplicates(subset=["query","tool"])
                       .groupby(["tool","tools_labels","tools_db","texture"])
                       .size().reset_index(name="n"))
    dump(records(unigenes_counts), os.path.join(out_dir, "arg_counts.json"))

    unigenes_dedup = unigenes.drop_duplicates(subset=["query","tool","new_level"])
    class_counts = (unigenes_dedup.groupby(["tool","tools_labels","tools_db","texture","new_level"])
                    .size().reset_index(name="n"))
    class_counts["p"] = class_counts.groupby("tool")["n"].transform(lambda s: s / s.sum())
    dump(columnar(class_counts), os.path.join(out_dir, "gene_class_proportion.json"))

    gene_class_order = (unigenes.drop_duplicates(subset="query")
                         .groupby("new_level").size()
                         .sort_values(ascending=False).index.tolist())

    fargene_classes = sorted(unigenes[unigenes["tool"] == "fARGene"]["new_level"].unique().tolist())

    # Default classes: every class fARGene reports (except qnr, excluded per request),
    # plus rpoB, van, and cell wall charge.
    extra_default = ["rpoB", "van", "cell wall charge"]
    default_classes = list(dict.fromkeys(fargene_classes + extra_default))
    default_classes = [c for c in default_classes if c != "qnr"]
    # keep the display order rank-based rather than fARGene-first
    default_classes = [c for c in gene_class_order if c in default_classes]

    dump({"all": gene_class_order, "fargene": fargene_classes, "default_20": default_classes},
         os.path.join(out_dir, "gene_class_order.json"))

    dump(records(JI_all_plot), os.path.join(out_dir, "jaccard.json"))

    # Full pairwise Jaccard across ALL tools (incl. 70/80/90% identity variants),
    # computed directly from raw gene sets -- JI_all_plot only covers the 10 basic tools.
    print("Computing full pairwise Jaccard across all tool variants ...")
    tool_sets = {t: set(g["query"]) for t, g in unigenes.groupby("tool")}
    all_tools = sorted(tool_sets.keys())
    jaccard_rows = []
    for i, t1 in enumerate(all_tools):
        for t2 in all_tools:
            s1, s2 = tool_sets[t1], tool_sets[t2]
            inter = len(s1 & s2)
            union = len(s1 | s2)
            jaccard_rows.append({"tool_ref": t1, "tool_comp": t2,
                                  "jaccard": (inter/union if union else 0.0)})
    dump(jaccard_rows, os.path.join(out_dir, "jaccard_full.json"))

    # Identity (%) distribution per tool, as a histogram (density) -- avoids shipping
    # raw per-gene values. Excludes fARGene (HMM profile score, not alignment identity)
    # and AMRFinderPlus (mixes HMM-based and BLAST-based hits; this dataset has no
    # column distinguishing which method found which gene, so the two can't be split).
    print("Computing identity-level distributions ...")
    EXCLUDE_FROM_IDENTITY = {"fARGene", "AMRFinderPlus"}
    IDENTITY_TOOLS = [t for t in basic_tools if t not in EXCLUDE_FROM_IDENTITY]
    bins = np.linspace(0, 100, 41)  # 40 bins, width 2.5
    centers = ((bins[:-1] + bins[1:]) / 2).tolist()
    identity_dist = []
    for t in IDENTITY_TOOLS:
        g = unigenes[unigenes["tool"] == t]
        vals = g["id"].dropna().values
        if len(vals) == 0:
            continue
        counts, _ = np.histogram(vals, bins=bins)
        density = (counts / counts.sum()).tolist()
        identity_dist.append({"tool": t, "n": int(len(vals)),
                               "counts": counts.tolist(), "density": density})
    dump({"bin_centers": centers, "tools": identity_dist},
         os.path.join(out_dir, "identity_distribution.json"))

    # Identity (%) distribution PER GENE CLASS, for DeepARG and RGI-DIAMOND only.
    # Used to show that DeepARG's identity is uniformly low across all classes,
    # while RGI-DIAMOND is high for most classes but low for a handful.
    print("Computing identity-by-gene-class distributions ...")
    def q(s, p):
        v = s.quantile(p)
        return 0 if v < 0 else v
    id_by_class_rows = []
    for t in ["DeepARG", "RGI-DIAMOND"]:
        sub = unigenes[unigenes["tool"] == t]
        for cls, g in sub.groupby("new_level"):
            vals = g["id"].dropna()
            if len(vals) < 3:
                continue
            q25, q50, q75 = q(vals,.25), q(vals,.5), q(vals,.75)
            iqr = q75 - q25
            id_by_class_rows.append({
                "tool": t, "new_level": cls, "n": int(len(vals)),
                "q25": q25, "median": q50, "q75": q75,
                "w1": max(0, q25-1.5*iqr), "w2": min(100, q75+1.5*iqr)
            })
    dump(columnar(pd.DataFrame(id_by_class_rows)), os.path.join(out_dir, "identity_by_class.json"))

    # ---------- Abundance & Richness tab ----------
    print("Building Abundance & Richness tab data (this is the biggest table)...")
    def q(s, p):
        v = s.quantile(p)
        return 0 if v < 0 else v

    grp_cols = ["tool","habitat","tools_labels","tools_db","texture"]
    abundance_summary = (abundance_tool_sample.groupby(grp_cols)["abundance"]
        .agg(median="median",
             q25=lambda s: q(s, .25), q75=lambda s: q(s, .75))
        .reset_index())
    abundance_summary["iqr"] = abundance_summary["q75"] - abundance_summary["q25"]
    abundance_summary["w1"] = (abundance_summary["q25"] - 1.5*abundance_summary["iqr"]).clip(lower=0)
    abundance_summary["w2"] = (abundance_summary["q75"] + 1.5*abundance_summary["iqr"]).clip(lower=0)

    richness_summary = (abundance_tool_sample.groupby(grp_cols)["richness"]
        .agg(median="median",
             q25=lambda s: q(s, .25), q75=lambda s: q(s, .75))
        .reset_index())
    richness_summary["iqr"] = richness_summary["q75"] - richness_summary["q25"]
    richness_summary["w1"] = (richness_summary["q25"] - 1.5*richness_summary["iqr"]).clip(lower=0)
    richness_summary["w2"] = (richness_summary["q75"] + 1.5*richness_summary["iqr"]).clip(lower=0)

    n_samples = (abundance_tool_sample.groupby("habitat")["sample"]
                 .nunique().reset_index(name="n_samples"))

    dump(records(abundance_summary.drop(columns="iqr")), os.path.join(out_dir, "abundance_summary.json"))
    dump(records(richness_summary.drop(columns="iqr")), os.path.join(out_dir, "richness_summary.json"))
    dump(records(n_samples), os.path.join(out_dir, "habitat_n_samples.json"))

    # capped random sample per tool+habitat, for a jitter/strip overlay (mirrors the R app's own subsampling)
    sub = abundance_tool_sample[["tool","habitat","sample","abundance","richness"]]
    rng = np.random.RandomState(0)
    parts = []
    for _, g in sub.groupby(["tool","habitat"]):
        n = min(40, len(g))
        parts.append(g.sample(n=n, random_state=rng))
    jitter = pd.concat(parts, ignore_index=True)
    dump(columnar(jitter), os.path.join(out_dir, "abundance_jitter_sample.json"))

    dump(columnar(abundance_class_summary), os.path.join(out_dir, "abundance_class_summary.json"))

    # ---------- Pan-/core-resistome tab ----------
    print("Building Pan-/Core tab data ...")
    dump(records(sumpan2), os.path.join(out_dir, "pan_resistome.json"))
    dump(columnar(sumcore), os.path.join(out_dir, "core_resistome.json"))

    # ---------- Class-specific overlap (CSC) tab ----------
    print("Building CSC/overlap tab data ...")
    dump(columnar(csc_fnr), os.path.join(out_dir, "csc.json"))

    # ---------- Supplementary tables ----------
    print("Building supplementary tables ...")
    table_s1 = (abundance_tool_sample[["sample","habitat"]]
                .drop_duplicates().rename(columns={"sample":"Sample","habitat":"Habitat"}))
    dump(columnar(table_s1), os.path.join(out_dir, "table_s1_samples.json"))

    # Full per-gene table is large -> ship as a downloadable CSV, not an in-browser table
    table_s3 = (unigenes[unigenes["tool"].isin(basic_tools)][["query","new_level","tool"]]
                .rename(columns={"query":"ARG (Unigene)","new_level":"Gene Class","tool":"Pipeline"}))
    csv_path = os.path.join(out_dir, "table_s3_full.csv.gz")
    table_s3.to_csv(csv_path, index=False, compression="gzip")
    print(f"  wrote {csv_path}  ({os.path.getsize(csv_path)/1024:.1f} KB, {len(table_s3):,} rows)")

    print("\nDone. Data volume summary:")
    total = 0
    for fn in os.listdir(out_dir):
        p = os.path.join(out_dir, fn)
        total += os.path.getsize(p)
    print(f"  total output size: {total/1024/1024:.2f} MB across {len(os.listdir(out_dir))} files")

    if hab_csv_path:
        build_habitat_data(unigenes, hab_csv_path, basic_tools, out_dir)

if __name__ == "__main__":
    rds_path = sys.argv[1] if len(sys.argv) > 1 else "data.rds"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "data"
    hab_csv_path = sys.argv[3] if len(sys.argv) > 3 else None
    main(rds_path, out_dir, hab_csv_path)
