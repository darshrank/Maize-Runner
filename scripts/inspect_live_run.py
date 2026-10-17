"""Read-only inspection of a native run directory's season traces.

Reports context headroom, finish reasons, validation errors, fallbacks, critic
verdicts, proposal/review binding and final-action verification per season.
Makes no model or environment calls. Agreement of objections with facts is
left for human review: the weekly table prints each objection beside the
observation the roles saw.

    python scripts/inspect_live_run.py RUN_DIR [--context-limit 16384] [--output report.json] [--weeks]
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def load(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def inspect_season(path: Path, context_limit: int, weeks: bool):
    events = load(path)
    roles = defaultdict(lambda: {"calls": 0, "prompt_max": 0, "completion_max": 0, "total_max": 0,
                                 "prompt_sum": 0, "completion_sum": 0, "usage_missing": 0,
                                 "finish": Counter(), "latency_sum": 0.0, "errors": 0})
    validation, fallbacks, problems = [], [], []
    proposals, reviews, verifications, decisions = {}, [], [], {}
    obs_by_week, step_weeks = {}, []
    for e in events:
        d, week, role = e["data"], e.get("week"), e.get("agent")
        if e["kind"] == "message" and "obs" in d and "agent_protocol_version" in d:
            obs_by_week[0] = d["obs"]
        if e["kind"] == "step_result":
            step_weeks.append(week)
            if not d.get("done"):
                obs_by_week[d.get("week", week + 1)] = d.get("obs")
        if e["kind"] == "fallback":
            fallbacks.append(e)
        if "validation_error" in d:
            validation.append({"week": week, "role": role, "error": d["validation_error"],
                               "content": (d.get("content") or "")[:300]})
        inf = d.get("inference")
        if inf is not None:
            r = roles[role]
            r["calls"] += 1
            r["latency_sum"] += inf.get("latency_s") or 0.0
            if "error_type" in inf:
                r["errors"] += 1
            r["finish"][str(inf.get("finish_reason"))] += 1
            usage = inf.get("usage")
            if usage:
                p, c = usage.get("prompt_tokens") or 0, usage.get("completion_tokens") or 0
                r["prompt_max"], r["completion_max"] = max(r["prompt_max"], p), max(r["completion_max"], c)
                r["total_max"] = max(r["total_max"], p + c)
                r["prompt_sum"] += p
                r["completion_sum"] += c
            else:
                r["usage_missing"] += 1
        if "proposal_record" in d:
            rec = d["proposal_record"]
            proposals[rec["proposal_id"]] = rec
        if "review_record" in d:
            reviews.append({"week": week, **d["review_record"]})
        if "final_verification" in d:
            verifications.append(d["final_verification"])
        if e["kind"] == "decision":
            decisions[week] = d

    for rv in reviews:
        target = proposals.get(rv["proposal_id"])
        if target is None:
            problems.append(f"week {rv['week']}: review {rv['review_id']} binds unknown proposal")
        elif target["stage"] != "planner" or target["week"] != rv["week"]:
            problems.append(f"week {rv['week']}: review binds {target['stage']} proposal of week {target['week']}")
    for pid, rec in proposals.items():
        if rec["parent_id"] and rec["parent_id"] not in proposals:
            problems.append(f"week {rec['week']}: proposal {pid} has unknown parent")
    for v in verifications:
        w = v["week"]
        if not all(v["checks"].values()):
            problems.append(f"week {w}: failed numeric checks {v['checks']}")
        dec = decisions.get(w)
        if dec is None:
            problems.append(f"week {w}: verification without decision")
        elif (float(dec["n_kg_ha"]), float(dec["irr_mm"])) != (float(v["final_action"]["n_kg_ha"]),
                                                               float(v["final_action"]["irr_mm"])):
            problems.append(f"week {w}: decision differs from verified final action")
        if v["source_proposal"]["stage"] != "fallback" and v["source_proposal"]["proposal_id"] not in proposals:
            problems.append(f"week {w}: verified source proposal not recorded")
    if len(verifications) != len(decisions):
        problems.append(f"{len(verifications)} verifications for {len(decisions)} decisions")

    for r in roles.values():
        r["finish"] = dict(r["finish"])
        r["min_headroom_tokens"] = context_limit - r["total_max"] if r["total_max"] else None
        r["latency_mean_s"] = round(r["latency_sum"] / r["calls"], 3) if r["calls"] else None
        del r["latency_sum"]
    final = next((e["data"] for e in events if e["kind"] == "final"), None)
    rejects = [rv for rv in reviews if not rv["accept"]]
    weekly = []
    if weeks:
        by_week_reviews = defaultdict(list)
        for rv in reviews:
            by_week_reviews[rv["week"]].append(rv)
        for w in sorted(decisions):
            obs = obs_by_week.get(w) or {}
            planner = [p for p in proposals.values() if p["week"] == w and p["stage"] == "planner"]
            weekly.append({"week": w, "obs": {k: obs.get(k) for k in ("soil_water_frac", "soil_n_kg_ha", "growth_stage",
                                                                       "rain_last_7d_mm", "day") if k in obs},
                           "planner": [p["action"] for p in planner],
                           "reviews": [{"accept": rv["accept"], "objection": rv["objection"]} for rv in by_week_reviews[w]],
                           "decision": decisions[w]})
    return {"log": str(path), "weeks_decided": len(decisions), "final": final,
            "roles": dict(roles), "validation_errors": validation, "fallbacks": [f["data"] for f in fallbacks],
            "reviews": len(reviews), "rejections": len(rejects),
            "exact_final_reviewed": sum(bool(v.get("exact_final_reviewed")) for v in verifications),
            "guard_changed": sum(bool(v.get("guard_changed_action")) for v in verifications),
            "coordinator_changed": sum(1 for v in verifications if v["source_proposal"]["stage"] == "coordinator"
                                       and v.get("reviewed_proposal_id")
                                       and proposals.get(v["reviewed_proposal_id"], {}).get("action", {}).get("n_kg_ha")
                                       != v["final_action"]["n_kg_ha"]),
            "binding_problems": problems, "weekly": weekly}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--context-limit", type=int, default=16384)
    ap.add_argument("--output")
    ap.add_argument("--weeks", action="store_true", help="Include week-by-week observation/review/decision table")
    args = ap.parse_args(argv)
    seasons = [inspect_season(p, args.context_limit, args.weeks)
               for p in sorted(Path(args.run_dir, "runs").glob("*/*.jsonl"))]
    report = {"run_dir": args.run_dir, "context_limit": args.context_limit,
              "scope": "Record consistency and telemetry only; not semantic or agronomic accuracy",
              "seasons": seasons}
    if args.output:
        with open(args.output, "x", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    for s in seasons:
        print(f"== {s['log']} weeks={s['weeks_decided']} fallbacks={len(s['fallbacks'])} "
              f"validation_errors={len(s['validation_errors'])} reviews={s['reviews']} rejections={s['rejections']} "
              f"guard_changed={s['guard_changed']} binding_problems={len(s['binding_problems'])}")
        for role, r in sorted(s["roles"].items()):
            print(f"   {role:12} calls={r['calls']:4} prompt_max={r['prompt_max']:6} completion_max={r['completion_max']:5} "
                  f"headroom_min={r['min_headroom_tokens']} finish={r['finish']} usage_missing={r['usage_missing']} "
                  f"errors={r['errors']} latency_mean={r['latency_mean_s']}")
        for p in s["binding_problems"]:
            print("   PROBLEM", p)
        print("   final", json.dumps(s["final"]))


if __name__ == "__main__":
    main()
