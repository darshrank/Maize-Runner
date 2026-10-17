"""Audit recorded live-model seasons without running inference or touching test tasks."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .clients import MODEL
from .contracts import Action, FINAL_FIELDS, ROLE_TOOLS, number
from .evaluation import read_run


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit_run(folder, *, require_live=True):
    folder = Path(folder)
    manifest, rows = read_run(folder)
    require(not require_live or manifest["model"] == MODEL, "Expected the live Nemotron checkpoint")
    require(not require_live or not manifest.get("synthetic_model", False), "Synthetic model is not live verification")
    limits = manifest["management"]["env"]
    weeks = limits["weeks_per_season"]
    reports, intervals = [], []
    index = json.loads((folder / "runs/index.json").read_text(encoding="utf-8"))
    for row in rows:
        config, task = row["config"], row["task_id"]
        path = folder / "runs" / config / f"{task}.jsonl"
        events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        label = f"{config}/{task}"
        require(all(set(e) == {"t", "week", "agent", "kind", "data"} for e in events), f"{label}: event contract mismatch")
        require(all(e["agent"] in (*ROLE_TOOLS, "env", "policy") for e in events), f"{label}: unknown actor")
        decisions = [e for e in events if e["kind"] == "decision"]
        steps = [e for e in events if e["kind"] == "step_result"]
        finals = [e for e in events if e["kind"] == "final"]
        require([e["week"] for e in decisions] == list(range(weeks)), f"{label}: missing/duplicate weekly decision")
        require([e["week"] for e in steps] == list(range(weeks)), f"{label}: missing/duplicate weekly step")
        require(len(finals) == 1 and finals[0]["week"] == weeks, f"{label}: missing terminal event")
        applied = 0.0
        for d, step in zip(decisions, steps):
            require(set(d["data"]) == {"n_kg_ha", "irr_mm", "reason"}, f"{label}: decision contract mismatch")
            action = Action.parse(d["data"])
            guarded = action.guarded(manifest["n_cap"] - applied,
                                     limits["max_n_kg_ha_per_week"], limits["max_irr_mm_per_week"])
            require(action == guarded, f"{label}: action exceeds a code guard")
            require("\n" not in d["data"]["reason"], f"{label}: multiline decision reason")
            applied += action.n_kg_ha
            result = step["data"]
            require(result["week"] == step["week"] + 1, f"{label}: step progression mismatch")
            require(result["done"] is (result["week"] == weeks), f"{label}: incorrect terminal week")
            require(not result.get("clamped", False), f"{label}: server had to clamp the action")
        final = finals[0]["data"]
        require(final == steps[-1]["data"]["final"], f"{label}: final/step mismatch")
        require(abs(number(final["n_applied"]) - applied) < .05, f"{label}: applied nitrogen mismatch")
        for name in FINAL_FIELDS:
            require(abs(number(final[name]) - float(row[name])) < .0001, f"{label}: CSV {name} mismatch")
        fallbacks = [e for e in events if e["kind"] == "fallback"]
        require(len(fallbacks) == int(row["fallbacks"]), f"{label}: hidden/miscounted fallback")
        require(int(row["llm_calls"]) > 0, f"{label}: no model calls")
        require(task in index.get(config, []), f"{label}: absent from replay index")
        permissions = {role: set(names) for role, names in ROLE_TOOLS.items()}
        if config == "multi_no_tools":
            permissions = {role: set() for role in permissions}
        if config == "multi_no_weather":
            for names in permissions.values():
                names.discard("get_weather")
        for role in ("planner", "coordinator"):
            permissions[role].add("submit_decision")
        results = [e for e in events if e["kind"] == "tool_result"]
        require(all(e["data"]["name"] in permissions[e["agent"]] for e in results), f"{label}: executed a forbidden tool")
        fallback_weeks = {e["week"] for e in fallbacks}
        needed = {"coordinator"} if config == "single" else {"weather", "crop", "planner", "critic", "coordinator"}
        if config == "multi_no_weather":
            needed.discard("weather")
        if config == "multi_no_critic":
            needed.discard("critic")
        objections, revisions = 0, 0
        for week in range(weeks):
            messages = [e for e in events if e["week"] == week and e["kind"] == "message"
                        and "content" in e["data"] and "validation_error" not in e["data"]]
            if week not in fallback_weeks:
                require(needed <= {e["agent"] for e in messages}, f"{label}: missing role in week {week}")
            planner_messages = [e for e in messages if e["agent"] == "planner"]
            require(len(planner_messages) <= 2, f"{label}: more than one planner revision")
            critiques = [json.loads(e["data"]["content"]) for e in messages if e["agent"] == "critic"]
            if critiques and not critiques[0]["accept"]:
                objections += 1
                if week not in fallback_weeks:
                    require(len(planner_messages) == 2, f"{label}: objection did not get one revision")
                    revisions += 1
        start, end = (datetime.fromisoformat(e["t"]).timestamp() for e in (events[0], events[-1]))
        intervals.extend([(start, 1), (end, -1)])
        reports.append({"config": config, "task_id": task, "weeks": len(steps),
            "llm_calls": int(row["llm_calls"]), "wall_s": float(row["wall_s"]), "fallbacks": len(fallbacks),
            "fallback_causes": [e["data"]["cause"] for e in fallbacks],
            "validation_errors": sum("validation_error" in e["data"] for e in events),
            "guarded_actions": sum(e["data"].get("guarded") is True for e in events),
            "critic_objections": objections, "completed_revisions": revisions,
            "tool_results_by_agent": dict(Counter(e["agent"] for e in results)),
            "log": str(path), "log_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "final": final})
    active = peak = 0
    for _, delta in sorted(intervals):
        active += delta
        peak = max(peak, active)
    return {"run": str(folder), "model": manifest["model"],
            "agent_protocol_version": manifest.get("agent_protocol_version", 1),
            "synthetic_environment": manifest.get("synthetic_environment", manifest["synthetic"]),
            "synthetic_model": manifest.get("synthetic_model", manifest["model"] == "StubModel"),
            "configured_concurrency": manifest["concurrency"], "peak_overlapping_seasons": peak,
            "checks_passed": ["dev-only complete tasks", "weekly JSONL/decision/step/final contract",
                "weekly/season action guards", "no server-side clamping", "CSV matches final logs",
                "fallback counts visible", "role tool permissions", "one critic revision maximum", "replay index"],
            "seasons": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", nargs="+")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "runs": [audit_run(p) for p in args.runs],
              "scope": "Live Nemotron inference; synthetic crop environment. No real crop-performance claim."}
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(json.dumps({"audit": "passed", "output": str(path), "seasons": sum(len(r["seasons"]) for r in report["runs"])}))


if __name__ == "__main__":
    main()
