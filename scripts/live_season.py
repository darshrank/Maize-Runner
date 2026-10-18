"""Play one season live with the FieldTwin team, printing every agent step as it happens.

  uv run python scripts/live_season.py [--task-id UFGA-2026] [--design d1c_multi] [--weeks N]

Real calls only: each role asks Nemotron on vLLM, each week runs in gym-DSSAT on the season's NASA POWER weather.
UFGA-2026 (the latest completed season) is outside every tune/check/test split. The log is also written week by
week to runs/live/<config>/<task_id>.jsonl. Needs the env server (port 9000) and the vLLM tunnel (.env).
"""

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents.client import EnvClient  # noqa: E402
from agents.policies import make_policy  # noqa: E402
from agents.run import RunLogger, find_task, load_config, play_season  # noqa: E402
from agents_a.designs import register_all  # noqa: E402
from agents_a.run_design import preflight  # noqa: E402

C = {"weather": "\033[38;5;117m", "crop": "\033[38;5;112m", "planner": "\033[38;5;221m", "critic": "\033[38;5;209m",
     "coordinator": "\033[38;5;255m", "nitrogen": "\033[38;5;112m", "water": "\033[38;5;81m", "env": "\033[38;5;245m",
     "dim": "\033[2m", "bold": "\033[1m", "green": "\033[38;5;112m", "red": "\033[38;5;203m", "off": "\033[0m"}
LABEL = {"weather": "Weather", "crop": "Crop", "planner": "Planner", "critic": "Critic", "coordinator": "Coordinator",
         "nitrogen": "Nitrogen", "water": "Water"}


def say(text: str = "") -> None:
    print(text, flush=True)


class LiveLogger(RunLogger):
    """RunLogger that prints each event as it happens and appends it to the live log at once (the UI follows it)."""

    def __init__(self, config: str, task_id: str, weeks_limit: int | None):
        super().__init__(config, task_id)
        self.weeks_limit = weeks_limit
        self.path = ROOT / "runs" / "live" / config / f"{task_id}.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("")          # start empty: nothing from an earlier run is ever shown

    def event(self, week, agent, kind, data):
        super().event(week, agent, kind, data)
        with open(self.path, "a") as f:   # one line per event, written immediately
            f.write(json.dumps(self.events[-1]) + "\n")
        if kind == "message":
            for call in data.get("tool_calls", []):
                self.answer(agent, call["name"], call.get("arguments") or "{}")
        elif kind == "tool_call":
            say(f"    {C['dim']}{LABEL.get(agent, agent)} reads {data['name']}{C['off']}")
        elif kind == "fallback":
            say(f"  {C['red']}fallback: {data.get('reason')}{C['off']}")
        elif kind == "step_result":
            w, o = data["weekly"], data["obs"]
            say(f"  {C['env']}gym-DSSAT ran the week: rain {w['rain_mm']:.0f} mm, N uptake {w['n_uptake']:.1f}, "
                f"leached {w['n_leached']:.1f} kg/ha -> stage {o['stage']}, biomass {o['biomass_kg_ha']:.0f} kg/ha{C['off']}")
            if self.weeks_limit and data["week"] >= self.weeks_limit and not data["done"]:
                raise SystemExit(f"\n(stopped after {self.weeks_limit} weeks; the full log so far is in {self.path})")

    def answer(self, agent: str, name: str, raw: str) -> None:
        try:
            a = json.loads(raw)
        except json.JSONDecodeError:
            return
        tag = f"  {C.get(agent, '')}{C['bold']}{LABEL.get(agent, agent):<11}{C['off']}"
        if name == "weather_report":
            say(f"{tag} rain next 3 days {a.get('rain_next_3d_mm', 0):.0f} mm, next 7 days {a.get('rain_next_7d_mm', 0):.0f} mm, "
                f"heavy-rain risk {a.get('heavy_rain_risk')}. {a.get('summary', '')}")
        elif name == "crop_report":
            say(f"{tag} stage {a.get('stage')}, N need {a.get('n_demand')}, soil {a.get('water_status')}. {a.get('summary', '')}")
        elif name in ("propose_plan", "propose_nitrogen", "propose_irrigation"):
            parts = [f"N {a['n_kg_ha']:g} kg/ha" if "n_kg_ha" in a else "", f"water {a['irr_mm']:g} mm" if "irr_mm" in a else ""]
            say(f"{tag} proposes {', '.join(p for p in parts if p)}: {a.get('reason', '')}")
        elif name == "review_plan":
            if a.get("verdict") == "object":
                say(f"{tag} {C['red']}objects{C['off']}: {a.get('objection', '')}")
            else:
                say(f"{tag} {C['green']}accepts{C['off']} the plan")
        elif name == "submit_decision":
            say(f"{tag} {C['bold']}decides N {a.get('n_kg_ha', 0):g} kg/ha, water {a.get('irr_mm', 0):g} mm{C['off']}: "
                f"{a.get('reason', '')}")


class LivePolicy:
    """Wraps the team policy to print a header before each week."""

    def __init__(self, inner, task):
        self.inner, self.task = inner, task

    def decide(self, episode_id, week, obs, env, log):
        say(f"\n{C['bold']}Week {week + 1}{C['off']}  {C['dim']}day {obs['day']} after planting · stage {obs['stage']} · "
            f"soil water {obs['soil_water_frac']:.2f} · N so far {obs['n_applied_total']:.0f} kg/ha · "
            f"water so far {obs['irr_total_mm']:.0f} mm{C['off']}")
        t0 = time.time()
        d = self.inner.decide(episode_id, week, obs, env, log)
        say(f"  {C['dim']}({time.time() - t0:.0f}s, {log.llm_calls} model calls so far){C['off']}")
        return d


def main() -> None:
    ap = argparse.ArgumentParser(description="Play one season live with the FieldTwin team.")
    ap.add_argument("--task-id", default="UFGA-2026")
    ap.add_argument("--design", default="d1c_multi")
    ap.add_argument("--weeks", type=int, default=None, help="stop after N weeks (for a short demo)")
    args = ap.parse_args()
    cfg = load_config()
    preflight(cfg["env"]["url"])
    register_all()
    task = find_task(args.task_id, "live") if args.task_id in ("UFGA-2025", "UFGA-2026") else find_task(args.task_id)
    env = EnvClient(cfg["env"]["url"])

    config = f"a_{args.design}"
    log = LiveLogger(config, task["task_id"], args.weeks)     # clears the team's live log first
    farmer_log = RunLogger("farmer_ufga", task["task_id"])
    farmer = play_season(make_policy("farmer_ufga"), task, env, farmer_log)   # fixed schedule, ~2 s, no model calls
    farmer_path = ROOT / "runs" / "live" / "farmer_ufga" / f"{task['task_id']}.jsonl"
    farmer_path.parent.mkdir(parents=True, exist_ok=True)
    farmer_path.write_text("".join(json.dumps(e) + "\n" for e in farmer_log.events))
    say(f"{C['bold']}FieldTwin live season: {task['task_id']}{C['off']} (Gainesville, FL; planted Feb 26; real NASA POWER "
        f"weather; gym-DSSAT; five Nemotron agents on vLLM)")
    say(f"{C['dim']}Farmer practice on this season: ${farmer['reward']:,.0f}/ha, grain {farmer['grain_kg_ha']:,.0f} kg/ha, "
        f"water {farmer['irr_mm']:.0f} mm{C['off']}")

    final = play_season(LivePolicy(make_policy(config), task), task, env, log)
    gain = final["reward"] - farmer["reward"]
    say(f"\n{C['bold']}Season done.{C['off']} FieldTwin team ${final['reward']:,.0f}/ha "
        f"({C['green'] if gain >= 0 else C['red']}{gain:+,.0f} vs farmer practice{C['off']}), grain {final['grain_kg_ha']:,.0f} kg/ha, "
        f"N {final['n_applied']:.0f} kg/ha, water {final['irr_mm']:.0f} mm (farmer {farmer['irr_mm']:.0f}), "
        f"leached {final['n_leached']:.1f} kg/ha, {log.llm_calls} model calls, {log.fallbacks} fallbacks.")


if __name__ == "__main__":
    main()
