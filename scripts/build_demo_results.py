"""Headline numbers for the Results page and the demo, computed from the committed eval.csv files.

  uv run python scripts/build_demo_results.py      -> agents_a/demo_results.json

Score = the env's reward (profit minus the leaching penalty, USD/ha). Paired comparisons are per season;
CI = 95% normal approximation of the mean paired difference. Final design: d1c_multi (frozen before any test run).
"""

import csv
import json
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGNS = ROOT / "agents_a" / "designs"
FINAL, SINGLE, ABLATION, FARMER = "a_d1c_multi", "a_d0b_single", "a_d1d_multi", "farmer_ufga"


def rows(path: Path) -> list[dict]:
    return list(csv.DictReader(open(path))) if path.exists() else []


ALL = rows(ROOT / "results_baseline" / "eval.csv")
for d in ("d1c_multi", "d0b_single", "d1d_multi"):
    ALL += rows(DESIGNS / d / "results" / "eval.csv")


def scores(config: str, split: str) -> dict[str, dict]:
    return {r["task_id"]: r for r in ALL if r["config"] == config and r["split"] == split}


def mean(rs: dict, key: str = "reward") -> float:
    return round(st.mean(float(r[key]) for r in rs.values()), 1)


def paired(a: dict, b: dict) -> dict:
    """a minus b over the seasons both have."""
    ids = sorted(set(a) & set(b))
    d = [float(a[i]["reward"]) - float(b[i]["reward"]) for i in ids]
    return {"seasons": len(ids), "mean_diff": round(st.mean(d), 1),
            "ci95": round(1.96 * st.stdev(d) / len(d) ** 0.5, 1), "wins": sum(x > 0 for x in d)}


def site_block(split: str, label: str) -> dict:
    team, farmer, hind = scores(FINAL, split), scores(FARMER, split), scores("hindsight", split)
    out = {"label": label, "seasons": len(team), "farmer": mean(farmer), "team": mean(team), "hindsight": mean(hind),
           "team_vs_farmer": paired(team, farmer),
           "water_mm": {"farmer": mean(farmer, "irr_mm"), "team": mean(team, "irr_mm")},
           "leached_kg_ha": {"farmer": mean(farmer, "n_leached"), "team": mean(team, "n_leached")},
           "fallbacks": {"team": sum(int(r["fallbacks"]) for r in team.values())}}
    for name, config in (("single", SINGLE), ("ablation_d1d", ABLATION), ("farmer_split", "farmer")):
        s = scores(config, split)
        if len(s) == len(team):
            out[name] = mean(s)
    return out


def main() -> None:
    unseen = {**{k: v for k, v in scores(FINAL, "dev").items() if int(k[-4:]) >= 2005}, **scores(FINAL, "test")}
    single = {**{k: v for k, v in scores(SINGLE, "dev").items() if int(k[-4:]) >= 2005}, **scores(SINGLE, "test")}
    per_season = sorted(({"task_id": t, "diff": round(float(unseen[t]["reward"]) - float(single[t]["reward"]), 1)}
                         for t in sorted(set(unseen) & set(single))), key=lambda x: -x["diff"])
    fallbacks = lambda c: sum(int(r["fallbacks"]) for r in ALL if r["config"] == c and r["split"] in ("dev", "test"))
    out = {
        "score": "reward = profit minus 2.44 USD per kg N leached, USD/ha per season",
        "final_design": "d1c_multi (five-role Nemotron team), frozen before any test run",
        "test": site_block("test", "Gainesville, FL: held-out test 2010-2024"),
        "tifton": site_block("tift_test", "Tifton, GA: new site, never tuned on, 2010-2024"),
        "team_vs_single": {"note": "same model, same knowledge; seasons neither design was tuned on (dev 2005-2009 + test)",
                           **paired(unseen, single), "per_season": per_season,
                           "team_mean": mean({t: unseen[t] for t in single}), "single_mean": mean({t: single[t] for t in unseen}),
                           "fallbacks": {"team": fallbacks(FINAL), "single": fallbacks(SINGLE)}},
    }
    path = ROOT / "agents_a" / "demo_results.json"
    path.write_text(json.dumps(out, indent=1))
    print(json.dumps({k: (v if k != "team_vs_single" else {x: v[x] for x in v if x != "per_season"}) for k, v in out.items()}, indent=1))


if __name__ == "__main__":
    main()
