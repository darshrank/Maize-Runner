"""Run configs over a task split; write results/eval.csv and results/summary.md.

  uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]

eval.csv columns are FROZEN (see COLUMNS). Rows for the same (config, task_id)
are replaced, others are kept, so you can add configs incrementally.
"""

import argparse
import csv
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from agents.run import ROOT, load_config, load_tasks, run_one
from eval.hindsight import run_hindsight

RESULTS = ROOT / "results"
COLUMNS = ["config", "task_id", "split", "grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas",
           "irr_mm", "profit_usd_ha", "reward", "llm_calls", "wall_s", "fallbacks"]
SUMMARY_METRICS = ["reward", "profit_usd_ha", "grain_kg_ha", "n_applied", "n_leached"]
LABELS = {"hindsight": "hindsight (unreachable ceiling)"}


def run_job(config: str, task: dict, env_url: str) -> dict:
    if config == "hindsight":
        final, stats = run_hindsight(task, env_url)
    else:
        final, stats = run_one(config, task, env_url)
    row = {"config": config, "task_id": task["task_id"], "split": task["split"], **final, **stats}
    return {c: row[c] for c in COLUMNS}


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, new_rows: list[dict]) -> list[dict]:
    """Merge new rows into eval.csv, replacing same (config, task_id). Returns all rows."""
    keys = {(r["config"], r["task_id"]) for r in new_rows}
    rows = [r for r in read_rows(path) if (r["config"], r["task_id"]) not in keys] + new_rows
    rows.sort(key=lambda r: (r["split"], r["config"], len(r["task_id"]), r["task_id"]))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return rows


def mean_ci(values: list[float]) -> tuple[float, float]:
    """Mean and 95% CI half-width (normal approximation)."""
    a = np.asarray(values, dtype=float)
    if len(a) < 2:
        return float(a.mean()), 0.0
    return float(a.mean()), float(1.96 * a.std(ddof=1) / math.sqrt(len(a)))


def summary_table(split: str, rows: list[dict], farmer_practice: str = "farmer") -> str:
    configs = sorted({r["config"] for r in rows}, key=lambda c: (c == "hindsight", c))
    means = {c: {m: mean_ci([float(r[m]) for r in rows if r["config"] == c]) for m in SUMMARY_METRICS}
             for c in configs}
    farmer, ceiling = means.get(farmer_practice), means.get("hindsight")

    lines = [f"## Split: {split}", "",
             "| config | n | " + " | ".join(SUMMARY_METRICS) + " | gap closed | leaching vs farmer |",
             "|---" * (len(SUMMARY_METRICS) + 4) + "|"]
    for c in configs:
        n = sum(r["config"] == c for r in rows)
        cells = [f"{m:.1f} ± {ci:.1f}" for m, ci in (means[c][k] for k in SUMMARY_METRICS)]
        reward = means[c]["reward"][0]
        gap = "n/a"
        if farmer and ceiling and ceiling["reward"][0] != farmer["reward"][0]:
            gap = f"{(reward - farmer['reward'][0]) / (ceiling['reward'][0] - farmer['reward'][0]):.2f}"
        leach = "n/a"
        if farmer and farmer["n_leached"][0] > 0:
            leach = f"{100 * (means[c]['n_leached'][0] - farmer['n_leached'][0]) / farmer['n_leached'][0]:+.0f}%"
        label = LABELS.get(c, c) + (" (farmer practice)" if c == farmer_practice else "")
        lines.append(f"| {label} | {n} | " + " | ".join(cells) + f" | {gap} | {leach} |")
    return "\n".join(lines)


def write_summary(path: Path, rows: list[dict], provenance: str = "", *, farmer_practice: str = "farmer") -> None:
    parts = ["# FieldTwin eval summary", "",
             f"Mean ± 95% CI (normal approx). Farmer practice = `{farmer_practice}` (config.yaml eval.farmer_practice). "
             "gap closed = (reward - farmer practice) / (hindsight - farmer practice). "
             "Hindsight knows the future: it is an unreachable ceiling.", ""]
    if provenance:
        parts += [provenance, ""]
    for split in sorted({r["split"] for r in rows}):
        parts += [summary_table(split, [r for r in rows if r["split"] == split], farmer_practice), ""]
    path.write_text("\n".join(parts), encoding="utf-8")


def main() -> None:
    cfg = load_config()
    ap = argparse.ArgumentParser(description="Evaluate configs over a task split.")
    ap.add_argument("--split", default="dev")
    ap.add_argument("--configs", default=",".join(cfg["eval"]["configs"]))
    ap.add_argument("--limit", type=int, default=None, help="only the first N tasks")
    args = ap.parse_args()

    tasks = load_tasks(args.split)[:args.limit]
    configs = [c.strip() for c in args.configs.split(",") if c.strip()]
    env_url = cfg["env"]["url"]
    RESULTS.mkdir(exist_ok=True)

    new_rows = []
    with ThreadPoolExecutor(max_workers=cfg["eval"]["parallel"]) as pool:
        futures = {pool.submit(run_job, c, t, env_url): (c, t["task_id"]) for c in configs for t in tasks}
        for fut in as_completed(futures):
            row = fut.result()
            new_rows.append(row)
            print(f"{row['config']:>12} {row['task_id']:>10}  reward {row['reward']:8.1f}  "
                  f"grain {row['grain_kg_ha']:8.1f}  leached {row['n_leached']:6.1f}")

    rows = write_csv(RESULTS / "eval.csv", new_rows)
    backend = os.environ.get("FIELDTWIN_MODEL_BACKEND", cfg.get("agents", {}).get("backend", "vllm"))
    simulator = cfg["env"]["simulator"]
    provenance = f"Run context: simulator `{simulator}`; model backend `{backend}`."
    if simulator == "toy" or backend == "stub":
        provenance += " Synthetic plumbing results; not crop-performance evidence."
    write_summary(RESULTS / "summary.md", rows, provenance,
                  farmer_practice=cfg["eval"].get("farmer_practice", "farmer"))
    print((RESULTS / "summary.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
