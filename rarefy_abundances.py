#!/usr/bin/env python3
"""
Rarefies args_abundances.tsv.gz to a common per-sample sequencing depth,
adding a "rarified_count" column.

Port of:

  rarefaction_fast <- function(X, raw, inserts, depth = 5e6, seed = 2025){
    reads_count <- ceiling(raw)
    arg_reads <- sum(reads_count)
    not_arg_reads <- inserts[1] - arg_reads
    depth <- min(depth, inserts[1])
    probs <- c(reads_count, not_arg_reads) / inserts[1]
    names(probs) <- c(X, "not an ARG")
    sampled <- rmultinom(1, size = depth, prob = probs)
    return(sampled[,1])
  }

  rarefied_counts <- args_abundances %>%
    filter(raw > 0) %>%
    group_by(sample) %>%
    summarise(rarefied = list(rarefaction_fast(X, raw, insertsHQ, depth))) %>%
    unnest_longer(rarefied, indices_include = TRUE) %>%
    rename(X = rarefied_id, rarified_count = rarefied)

  args_abundances <- args_abundances %>% left_join(rarefied_counts, by = c("sample", "X"))
  args_abundances <- args_abundances %>% mutate(rarified_count = ifelse(is.na(rarified_count), 0, rarified_count))

For each sample, gene-level read counts (ceiling of "raw") plus an implicit
"not an ARG" bucket (insertsHQ minus the ARG reads) are drawn once from a
multinomial distribution at size min(depth, insertsHQ). This is an
independent-samples approximation to hypergeometric subsampling, matching
R's rmultinom. Genes not sampled (or with raw <= 0) get rarified_count = 0.

Note: seeding a numpy Generator does not reproduce R's rmultinom draws
bit-for-bit (different RNG algorithms) -- "seed" only guarantees the same
result across repeated runs of this script.

Usage:
  ./rarefy_abundances.py [data_dir] [output_file] [depth] [seed]

  data_dir    defaults to data_zenodo_github
  output_file defaults to <data_dir>/args_abundances_rarefied.tsv.gz
  depth       defaults to 5e6
  seed        defaults to 2000
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd


def rarefy(args_abundances: pd.DataFrame, metadata: pd.DataFrame, depth: float, seed: int) -> pd.DataFrame:
    inserts_map = metadata.set_index("sample_id")["insertsHQ"].to_dict()
    rng = np.random.default_rng(seed)

    present = args_abundances[args_abundances["raw"] > 0]

    parts = []
    n_samples = present["sample"].nunique()
    for i, (sample, group) in enumerate(present.groupby("sample", sort=True), start=1):
        if i % 2000 == 0:
            print(f"  rarefying sample {i:,}/{n_samples:,}")

        inserts = inserts_map.get(sample)
        if inserts is None or inserts <= 0:
            continue

        reads_count = np.ceil(group["raw"].to_numpy())
        arg_reads = reads_count.sum()
        not_arg_reads = max(inserts - arg_reads, 0)
        sample_depth = int(round(min(depth, inserts)))

        probs = np.append(reads_count, not_arg_reads) / inserts
        probs = probs / probs.sum()

        sampled = rng.multinomial(sample_depth, probs)
        gene_counts = sampled[:-1]  # drop the "not an ARG" bucket

        parts.append(pd.DataFrame({
            "sample": sample,
            "X": group["X"].to_numpy(),
            "rarified_count": gene_counts,
        }))

    rarefied_counts = pd.concat(parts, ignore_index=True)

    result = args_abundances.merge(rarefied_counts, on=["sample", "X"], how="left")
    result["rarified_count"] = result["rarified_count"].fillna(0).astype(int)
    return result


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data_zenodo_github")
    output_file = Path(sys.argv[2]) if len(sys.argv) > 2 else data_dir / "args_abundances_rarefied.tsv.gz"
    depth = float(sys.argv[3]) if len(sys.argv) > 3 else 5e6
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 2000

    print(f"Reading args_abundances.tsv.gz ...")
    args_abundances = pd.read_csv(data_dir / "args_abundances.tsv.gz", sep="\t")
    args_abundances = args_abundances.reset_index().rename(columns={"index": "X"})

    print(f"Reading metagenomes_metadata.csv ...")
    metadata = pd.read_csv(data_dir / "metagenomes_metadata.csv")

    print(f"Rarefying to depth={depth:,.0f}, seed={seed} ...")
    result = rarefy(args_abundances, metadata, depth=depth, seed=seed)

    print(f"Writing {output_file} ...")
    result.to_csv(output_file, sep="\t", index=False)
    print(f"Wrote {len(result):,} rows "
          f"({(result['rarified_count'] > 0).sum():,} with rarified_count > 0)")


if __name__ == "__main__":
    main()
