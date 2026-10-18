"""Build results/vllm_metrics.json from recorded dev run logs (no network, no Brev).

  uv run python -m lanec.scripts.vllm_metrics [--out results/vllm_metrics.json]

Shape: STATE.md contract {vllm_version, model, measured_at, rows: [{parallel, seasons_per_hour, p50_ms, p99_ms,
prefix_cache_hit_rate}]} (same keys as ui/fake/results/vllm_metrics.json), plus labels per row.

Per config (CONFIGS):
- Dev task ids come from the split column of the config's eval.csv (rows with split != "dev" are dropped before
  any other cell is read) and must also be in tasks/dev.jsonl. Only those logs are opened.
- seasons_per_hour = dev seasons / hours from the first to the last event t over all of its logs.
- p50_ms / p99_ms = percentiles (linear interpolation between closest ranks) of data.latency_s (or
  data.inference.latency_s) on message events, x 1000.
- parallel = peak number of overlapping season spans (first to last event t of each log).
- llm_calls = message events with a latency; fallbacks = fallback events.
The run shared its vLLM server with other clients, so every row is labelled "shared server, not a controlled run".
Prefix-cache hit rate and the 1 / 32 parallel rows need vLLM's /metrics: they stay null, never estimated.
vllm_version / model come from B's host record (results/b0-host.json); A's logs record neither.
"""

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIGS = {
    "a_d1c_multi": {"eval": "agents_a/designs/d1c_multi/results/eval.csv",
                    "runs": "agents_a/designs/d1c_multi/runs/a_d1c_multi"},
}
HOST = "results/b0-host.json"
SWEEP = (1, 8, 32)
SHARED = "shared server, not a controlled run"
NEEDS = "needs vLLM /metrics"


def dev_task_ids(config: str, eval_path: Path) -> list[str]:
    """Task ids of the config's dev rows. Non-dev rows are dropped on the split cell alone."""
    dev_jsonl = {json.loads(l)["task_id"] for l in (ROOT / "tasks/dev.jsonl").read_text().splitlines() if l.strip()}
    with eval_path.open(newline="") as f:
        rows = csv.reader(f)
        header = next(rows)
        split, cfg, task = header.index("split"), header.index("config"), header.index("task_id")
        ids = [r[task] for r in rows if r[split] == "dev" and r[cfg] == config]
    return sorted(t for t in ids if t in dev_jsonl)


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


def measure(config: str, spec: dict) -> dict:
    ids = dev_task_ids(config, ROOT / spec["eval"])
    spans, latencies, fallbacks = [], [], 0
    for task_id in ids:
        lines = [json.loads(l) for l in (ROOT / spec["runs"] / f"{task_id}.jsonl").read_text().splitlines() if l.strip()]
        ts = [datetime.fromisoformat(e["t"]) for e in lines]
        spans.append((min(ts), max(ts)))
        for e in lines:
            if e["kind"] == "fallback":
                fallbacks += 1
            elif e["kind"] == "message" and (v := latency_of(e["data"])) is not None:
                latencies.append(v)
    start, end = min(a for a, _ in spans), max(b for _, b in spans)
    hours = (end - start).total_seconds() / 3600
    return {"parallel": peak_overlap(spans), "seasons_per_hour": round(len(ids) / hours, 2),
            "p50_ms": round(percentile(latencies, 0.50) * 1000), "p99_ms": round(percentile(latencies, 0.99) * 1000),
            "prefix_cache_hit_rate": None, "config": config, "split": "dev", "seasons": len(ids),
            "wall_h": round(hours, 3), "first_t": start.isoformat(), "last_t": end.isoformat(),
            "llm_calls": len(latencies), "fallbacks": fallbacks, "note": f"{SHARED}; prefix_cache_hit_rate {NEEDS}"}


def server_info() -> tuple[str, str]:
    host = json.loads((ROOT / HOST).read_text())
    args = host["server_arguments"]
    m = re.search(r":v?([0-9][^-]*)", host["image"])
    return (m.group(1) if m else host["image"]), args[args.index("--model") + 1]


def build() -> dict:
    measured = [measure(c, spec) for c, spec in CONFIGS.items()]
    have = {r["parallel"] for r in measured}
    missing = [{"parallel": p, "seasons_per_hour": None, "p50_ms": None, "p99_ms": None,
                "prefix_cache_hit_rate": None, "split": "dev", "note": NEEDS} for p in SWEEP if p not in have]
    version, model = server_info()
    return {"vllm_version": version, "model": model, "measured_at": max(r["last_t"] for r in measured),
            "rows": sorted(measured + missing, key=lambda r: r["parallel"]),
            "source": f"recorded dev logs ({', '.join(CONFIGS)}); vllm_version / model from {HOST}",
            "note": f"Dev only. {SHARED.capitalize()}. Not a vLLM benchmark."}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="results/vllm_metrics.json")
    out = ROOT / ap.parse_args().out
    metrics = build()
    out.write_text(json.dumps(metrics, indent=1) + "\n")
    print(f"{out.relative_to(ROOT)}: vLLM {metrics['vllm_version']}, {metrics['model']}")
    print(f"{'parallel':>8} {'config':<12} {'seasons/h':>9} {'p50_ms':>7} {'p99_ms':>7} {'cache_hit':>9} "
          f"{'calls':>6} {'fallbk':>6}  note")
    for r in metrics["rows"]:
        cell = lambda k: "null" if r.get(k) is None else str(r[k])
        print(f"{r['parallel']:>8} {r.get('config', '-'):<12} {cell('seasons_per_hour'):>9} {cell('p50_ms'):>7} "
              f"{cell('p99_ms'):>7} {cell('prefix_cache_hit_rate'):>9} {cell('llm_calls'):>6} "
              f"{cell('fallbacks'):>6}  {r['note']}")


if __name__ == "__main__":
    main()
