"""Run one agent design on a task split; logs and results go into the design's own folder.

  uv run python -m agents_a.run_design --design d0_single --split dev [--subset tune|check] [--task-id UFGA-1995]

Writes agents_a/designs/<design>/runs/<config>/<task>.jsonl and .../results/{eval.csv,summary.md}.
The summary compares the design with the frozen baselines (results_baseline/) on exactly the seasons
that were run, with dev reported as dev-tune (1990-2004) and dev-check (2005-2009), see common/splits.py.
Needs the env server (port 9000) and the vLLM endpoint (.env).
Tune on dev-tune, confirm on dev-check; test is run once, at the end (A4).
"""

import argparse
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import agents.run
from agents.run import load_config, load_tasks
from agents_a.common.splits import subset_of
from agents_a.designs import DESIGNS, register_all
from eval.run_eval import read_rows, run_job, write_csv, write_summary

ROOT = Path(__file__).resolve().parent.parent
BASELINES = ROOT / "results_baseline" / "eval.csv"


def main() -> None:
    cfg = load_config()
    ap = argparse.ArgumentParser(description="Run an agent design on a split.")
    ap.add_argument("--design", required=True, choices=sorted(DESIGNS))
    ap.add_argument("--split", default="dev", choices=["dev", "test"])
    ap.add_argument("--subset", choices=["tune", "check", "all"], default="all",
                    help="dev only: tune = 1990-2004, check = 2005-2009")
    ap.add_argument("--limit", type=int, default=None, help="only the first N seasons")
    ap.add_argument("--task-id", default=None, help="run just this season")
    ap.add_argument("--parallel", type=int, default=cfg["eval"]["parallel"])
    args = ap.parse_args()

    register_all()
    config = f"a_{args.design}"
    folder = ROOT / "agents_a" / "designs" / args.design
    agents.run.RUNS_DIR = folder / "runs"          # season logs land in the design folder
    results = folder / "results"
    results.mkdir(parents=True, exist_ok=True)

    tasks = load_tasks(args.split)
    if args.split == "dev" and args.subset != "all":
        tasks = [t for t in tasks if subset_of(t) == f"dev-{args.subset}"]
    tasks = [t for t in tasks if t["task_id"] == args.task_id] if args.task_id else tasks[:args.limit]
    new_rows = []
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(run_job, config, t, cfg["env"]["url"]) for t in tasks]
        for fut in as_completed(futures):
            row = fut.result()
            new_rows.append(row)
            print(f"{row['task_id']:>10}  reward {float(row['reward']):8.1f}  grain {float(row['grain_kg_ha']):7.0f}  "
                  f"N {float(row['n_applied']):5.0f}  irr {float(row['irr_mm']):4.0f}  leached {float(row['n_leached']):5.1f}  "
                  f"llm {row['llm_calls']}  fallbacks {row['fallbacks']}  {float(row['wall_s']):.0f}s")

    rows = write_csv(results / "eval.csv", new_rows)
    done = {(r["split"], r["task_id"]) for r in rows}
    baseline = [r for r in read_rows(BASELINES) if (r["split"], r["task_id"]) in done]
    by_subset = [dict(r, split=subset_of(r)) for r in rows + baseline]   # summary only; eval.csv keeps "dev"
    write_summary(results / "summary.md", by_subset, cfg["eval"].get("farmer_practice", "farmer"))
    print((results / "summary.md").read_text())


if __name__ == "__main__":
    main()
