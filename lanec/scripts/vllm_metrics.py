"""Build results/vllm_metrics.json from recorded dev run logs and the S3 sweep (no network, no Brev).

  uv run python -m lanec.scripts.vllm_metrics [--out results/vllm_metrics.json] [--sweep results/s3_sweep]

Shape: STATE.md contract {vllm_version, model, measured_at, rows: [{parallel, seasons_per_hour, p50_ms, p99_ms,
prefix_cache_hit_rate}]} plus Lane C fields on every row: setting, split, calls, fallbacks, peak_overlap_seasons,
peak_running, max_waiting, cached_prompt_share (null = not measured, never estimated) and labels.

Two settings:
- "shared server" (SHARED_CONFIGS): A's recorded a_d1c_multi dev run on the shared H100. Dev task ids come from the
  split column of its eval.csv (non-dev rows dropped before any other cell is read), also required in
  tasks/dev.jsonl. No /metrics, so cache fields and running / waiting are null. Placeholder rows for levels that
  never ran there (SHARED_SWEEP) keep every metric null.
- "dedicated H100, controlled run" (SWEEP_LEVELS): lanec/scripts/s3_sweep.sh on numerous-peach-bird, copied to
  <sweep>/ (s3/p<N>/ = driver files, p<N>/runs/ = run_design logs). Task ids from p<N>/runs/index.json, kept only
  if in tasks/dev.jsonl and the reset line says split dev. The container restarted before every level, so each
  level has its own before.prom / after.prom window.

Per row:
- parallel = configured level (dedicated) or the measured peak of overlapping seasons (shared).
- peak_overlap_seasons = peak number of overlapping season spans (first to last event t of each log).
- seasons_per_hour = seasons / hours from the first to the last event t over the level's logs.
- p50_ms / p99_ms = percentiles (linear interpolation between closest ranks) of latency_s on message events, x 1000.
- calls = message events with a latency_s; fallbacks = fallback events.
- prefix_cache_hit_rate = delta vllm:prefix_cache_hits_total / delta vllm:prefix_cache_queries_total.
- cached_prompt_share = delta vllm:prompt_tokens_cached_total / delta vllm:prompt_tokens_total.
- peak_running / max_waiting = max of vllm:num_requests_running / _waiting over the 15 s polls (poll.csv).
No eval results are taken from the sweep (its eval.csv / summary.md are never read).
"""

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHARED_CONFIGS = {
    "a_d1c_multi": {"eval": "agents_a/designs/d1c_multi/results/eval.csv",
                    "runs": "agents_a/designs/d1c_multi/runs/a_d1c_multi"},
}
SHARED_SWEEP = (1, 8, 32)
SWEEP_CONFIG = "a_d1c_multi"
SWEEP_LEVELS = (1, 8, 20)
HOST = "results/b0-host.json"
SHARED = "shared server"
DEDICATED = "dedicated H100, controlled run"
PROM = {"hits": "vllm:prefix_cache_hits_total", "queries": "vllm:prefix_cache_queries_total",
        "cached": "vllm:prompt_tokens_cached_total", "prompt": "vllm:prompt_tokens_total",
        "requests": "vllm:request_success_total"}
LANEC_NULL = ("peak_overlap_seasons", "peak_running", "max_waiting", "cached_prompt_share", "calls", "fallbacks")


def dev_ids() -> set[str]:
    return {json.loads(l)["task_id"] for l in (ROOT / "tasks/dev.jsonl").read_text().splitlines() if l.strip()}


def eval_dev_ids(config: str, eval_path: Path) -> list[str]:
    """Task ids of the config's dev rows. Non-dev rows are dropped on the split cell alone."""
    with eval_path.open(newline="") as f:
        rows = csv.reader(f)
        header = next(rows)
        split, cfg, task = header.index("split"), header.index("config"), header.index("task_id")
        ids = [r[task] for r in rows if r[split] == "dev" and r[cfg] == config]
    return sorted(t for t in ids if t in dev_ids())


def percentile(values: list[float], q: float) -> float:
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def peak_overlap(spans: list[tuple[datetime, datetime]]) -> int:
    # An end and a start at the same instant do not overlap: ends sort first.
    events = sorted([(a, 1) for a, _ in spans] + [(b, -1) for _, b in spans], key=lambda e: (e[0], e[1]))
    cur = peak = 0
    for _, step in events:
        cur += step
        peak = max(peak, cur)
    return peak


def latency_of(data: dict):
    inf = data.get("inference") if isinstance(data.get("inference"), dict) else data
    v = inf.get("latency_s")
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_log(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def log_stats(logs: list[list[dict]]) -> dict:
    spans, latencies, fallbacks = [], [], 0
    for lines in logs:
        ts = [datetime.fromisoformat(e["t"]) for e in lines]
        spans.append((min(ts), max(ts)))
        for e in lines:
            if e["kind"] == "fallback":
                fallbacks += 1
            elif e["kind"] == "message" and (v := latency_of(e["data"])) is not None:
                latencies.append(v)
    start, end = min(a for a, _ in spans), max(b for _, b in spans)
    hours = (end - start).total_seconds() / 3600
    return {"peak_overlap_seasons": peak_overlap(spans), "seasons_per_hour": round(len(logs) / hours, 2),
            "p50_ms": round(percentile(latencies, 0.50) * 1000), "p99_ms": round(percentile(latencies, 0.99) * 1000),
            "seasons": len(logs), "wall_h": round(hours, 3), "first_t": start.isoformat(), "last_t": end.isoformat(),
            "calls": len(latencies), "fallbacks": fallbacks}


def shared_rows() -> list[dict]:
    rows = []
    for config, spec in SHARED_CONFIGS.items():
        ids = eval_dev_ids(config, ROOT / spec["eval"])
        s = log_stats([read_log(ROOT / spec["runs"] / f"{t}.jsonl") for t in ids])
        rows.append({"parallel": s["peak_overlap_seasons"], **s, "prefix_cache_hit_rate": None,
                     "cached_prompt_share": None, "peak_running": None, "max_waiting": None,
                     "setting": SHARED, "config": config, "split": "dev",
                     "note": "parallel = measured peak overlap; other clients on the same vLLM; no /metrics"})
    have = {r["parallel"] for r in rows}
    for p in SHARED_SWEEP:
        if p not in have:
            rows.append({"parallel": p, "seasons_per_hour": None, "p50_ms": None, "p99_ms": None,
                         "prefix_cache_hit_rate": None, **{k: None for k in LANEC_NULL},
                         "setting": SHARED, "split": "dev", "note": "not run on the shared server"})
    return rows


def prom_values(path: Path) -> dict:
    """Sum of each PROM counter over its label sets; a name absent from the file is left out."""
    if not path.is_file():
        return {}
    sums = {}
    for line in path.read_text().splitlines():
        m = re.match(r"^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)", line)
        if m and m.group(1) in PROM.values():
            sums[m.group(1)] = sums.get(m.group(1), 0.0) + float(m.group(3))
    return sums


def prom_model(path: Path):
    m = re.search(r'model_name="([^"]+)"', path.read_text()) if path.is_file() else None
    return m.group(1) if m else None


def ratio(before: dict, after: dict, num: str, den: str):
    n, d = PROM[num], PROM[den]
    if not all(k in before and k in after for k in (n, d)):
        return None
    dd = after[d] - before[d]
    return round((after[n] - before[n]) / dd, 4) if dd > 0 else None


def poll_max(path: Path, col: str):
    if not path.is_file():
        return None
    vals = [float(r[col]) for r in csv.DictReader(path.open()) if r.get(col) not in (None, "")]
    return int(max(vals)) if vals else None


def sweep_rows(sweep: Path) -> tuple[list[dict], list[str], set]:
    rows, missing, models = [], [], set()
    dev = dev_ids()
    for n in SWEEP_LEVELS:
        drv, runs = sweep / "s3" / f"p{n}", sweep / f"p{n}" / "runs"
        ids = json.loads((runs / "index.json").read_text()).get(SWEEP_CONFIG, [])
        logs = []
        for t in sorted(i for i in ids if i in dev):
            lines = read_log(runs / SWEEP_CONFIG / f"{t}.jsonl")
            task = next((e["data"].get("task", {}) for e in lines if "reset" in e.get("data", {})), {})
            if task.get("split") == "dev":
                logs.append(lines)
        s = log_stats(logs)
        before, after = prom_values(drv / "before.prom"), prom_values(drv / "after.prom")
        times = dict(l.split(None, 1) for l in (drv / "times.txt").read_text().splitlines() if " " in l)
        row = {"parallel": n, **s,
               "prefix_cache_hit_rate": ratio(before, after, "hits", "queries"),
               "cached_prompt_share": ratio(before, after, "cached", "prompt"),
               "peak_running": poll_max(drv / "poll.csv", "num_requests_running"),
               "max_waiting": poll_max(drv / "poll.csv", "num_requests_waiting"),
               "vllm_requests": (int(after[PROM["requests"]] - before[PROM["requests"]])
                                 if PROM["requests"] in before and PROM["requests"] in after else None),
               "setting": DEDICATED, "config": SWEEP_CONFIG, "split": "dev",
               "run_start": times.get("start"), "run_end": times.get("end"), "exit": times.get("exit"),
               "note": "vLLM restarted before the level (cold prefix cache); polls every 15 s"}
        missing += [f"parallel {n}: {k}" for k in ("prefix_cache_hit_rate", "cached_prompt_share", "peak_running",
                                                    "max_waiting", "vllm_requests") if row[k] is None]
        models.add(prom_model(drv / "after.prom"))
        rows.append(row)
    return rows, missing, models - {None}


def server_info() -> tuple[str, str]:
    host = json.loads((ROOT / HOST).read_text())
    args = host["server_arguments"]
    m = re.search(r":v?([0-9][^-]*)", host["image"])
    return (m.group(1) if m else host["image"]), args[args.index("--model") + 1]


def build(sweep: Path) -> tuple[dict, list[str]]:
    shared = shared_rows()
    dedicated, missing, models = sweep_rows(sweep)
    version, model = server_info()
    if models - {model}:
        missing.append(f"sweep model {sorted(models)} differs from {HOST} {model}")
    rows = sorted(shared + dedicated, key=lambda r: (r["setting"] != DEDICATED, r["parallel"]))
    return {"vllm_version": version, "model": model, "measured_at": max(r["last_t"] for r in rows if r.get("last_t")),
            "rows": rows,
            "source": f"shared: recorded dev logs ({', '.join(SHARED_CONFIGS)}); dedicated: S3 sweep logs + /metrics "
                      f"({sweep.relative_to(ROOT)}); vllm_version / model from {HOST} (same image digest and model "
                      "on the sweep host)",
            "note": "Dev only. No eval results from the sweep."}, missing


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="results/vllm_metrics.json")
    ap.add_argument("--sweep", default="results/s3_sweep")
    a = ap.parse_args()
    out = ROOT / a.out
    metrics, missing = build(ROOT / a.sweep)
    out.write_text(json.dumps(metrics, indent=1) + "\n")
    print(f"{out.relative_to(ROOT)}: vLLM {metrics['vllm_version']}, {metrics['model']}")
    cols = [("setting", 30), ("parallel", 8), ("seasons_per_hour", 9), ("p50_ms", 7), ("p99_ms", 7),
            ("prefix_cache_hit_rate", 8), ("cached_prompt_share", 8), ("peak_running", 7), ("calls", 6),
            ("fallbacks", 6)]
    print(" ".join(f"{k[:w]:<{w}}" if i == 0 else f"{k[:w]:>{w}}" for i, (k, w) in enumerate(cols)))
    for r in metrics["rows"]:
        cell = lambda k: "null" if r.get(k) is None else str(r[k])
        print(" ".join(f"{cell(k):<{w}}" if i == 0 else f"{cell(k):>{w}}" for i, (k, w) in enumerate(cols)))
    print("missing (null):", ", ".join(missing) if missing else "none")


if __name__ == "__main__":
    main()
