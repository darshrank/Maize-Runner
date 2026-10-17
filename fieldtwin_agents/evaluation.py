from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path


def read_run(folder):
    folder = Path(folder)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    with (folder / "eval.csv").open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows or any(r["split"] != "dev" for r in rows) or manifest["split"] != "dev":
        raise ValueError("Nonempty dev results required")
    expected = {(c, t) for c in manifest["configs"] for t in manifest["task_ids"]}
    if len(rows) != len(expected) or {(r["config"], r["task_id"]) for r in rows} != expected:
        raise ValueError("Run is partial or has duplicate results; do not report it as complete")
    return manifest, rows


def analyze(folder):
    manifest, rows = read_run(folder)
    summary = {"synthetic": manifest["synthetic"], "configs": {}}
    for config in manifest["configs"]:
        selected = [r for r in rows if r["config"] == config]
        worst = sorted(selected, key=lambda r: float(r["reward"]))[:3]
        diagnostics = []
        for row in worst:
            log_path = Path(folder) / "runs" / config / f"{row['task_id']}.jsonl"
            events = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
            diagnostics.append({"task_id": row["task_id"], "reward": float(row["reward"]),
                                "log": str(log_path),
                                "fallbacks": [e for e in events if e["kind"] == "fallback"],
                                "critic_messages": [e for e in events if e["agent"] == "critic" and e["kind"] == "message"]})
        summary["configs"][config] = {"seasons": len(selected),
            "mean_reward": statistics.mean(float(r["reward"]) for r in selected),
            "fallbacks": sum(int(r["fallbacks"]) for r in selected), "worst_three": diagnostics}
    path = Path(folder) / "diagnostics.json"
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def record_iteration(before, after, change, output):
    old, old_rows = read_run(before)
    new, new_rows = read_run(after)
    if old.get("agent_protocol_version", 1) != new.get("agent_protocol_version", 1):
        raise ValueError("Paired comparison requires matching agent protocol versions")
    for key in ("synthetic", "configs", "task_ids", "n_cap", "fallback_schedule", "management"):
        if old[key] != new[key]:
            raise ValueError(f"Paired comparison requires matching {key}")
    if old["task_specs"] != new["task_specs"] or old["model"] != new["model"] or old["environment"] != new["environment"]:
        raise ValueError("Task definitions, model and environment must match")
    changed = [name for name in old["prompt_hashes"] if old["prompt_hashes"][name] != new["prompt_hashes"].get(name)]
    if len(changed) != 1:
        raise ValueError("Iteration comparison requires exactly one changed role prompt")
    indexed = {(r["config"], r["task_id"]): float(r["reward"]) for r in old_rows}
    sections = [f"\n## {'SYNTHETIC plumbing only' if new['synthetic'] else 'Real dev'} iteration\n",
                f"Change: {change.strip()}\n", f"Changed prompt: {changed[0]}\n",
                f"Before: `{before}`; after: `{after}`.\n"]
    for config in new["configs"]:
        selected = [r for r in new_rows if r["config"] == config]
        deltas = [float(r["reward"]) - indexed[(config, r["task_id"])] for r in selected]
        sections.append(f"- {config}: {len(deltas)} paired dev seasons; mean reward delta {statistics.mean(deltas):.6f}.\n")
    sections.append("\nNo real crop-performance claim is supported by synthetic fixtures.\n" if new["synthetic"] else "\nScores are dev only; test remains held out.\n")
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(sections))
    return "\n".join(sections)
