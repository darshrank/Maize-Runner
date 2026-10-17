"""Write a FAKE multi-agent run log for UI work: runs/fake_multi/<task_id>.jsonl.

  uv run python -m lanec.scripts.fake_logs [--task-id UFGA-s1] [--seed 0] [--env-url URL]

The agents are scripted (no LLM), but every env line and tool result is real: the season is
played through agents.run.play_season against the toy sim (in-process by default, or a running
env server with --env-url), and logged with the repo's RunLogger, which also updates
runs/index.json through update_index().

Each week, weather, crop, planner, critic and coordinator each emit at least one event; the
coordinator emits the decision. The critic objects on exactly 2 N weeks (the coordinator
then changes the planner's numbers), and exactly 1 week is a fallback week.

message / fallback data: {"text": ...}; critic messages {"text": ..., "objection": bool}.
SKELETON_SPEC.md section 8 defines no shape for these (proposal; B to confirm).

Deterministic per --seed: timestamps and the episode_id are rewritten from the seed.
Dev tasks only.
"""

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from agents.client import EnvClient
from agents.policies.base import Decision, Policy
from agents.run import RunLogger, find_task, load_config, play_season

CONFIG = "fake_multi"
BASE_N_PLAN = {0: 50, 4: 50, 8: 50, 11: 30}   # week -> planned kg N/ha before jitter
DRY_FRAC = 0.40
IRR_MM = 25.0
FALLBACK_DRY_FRAC = 0.35                      # fallback uses the farmer rule
STORM_MM = 40.0


def r5(x: float) -> float:
    return float(max(0, 5 * round(x / 5)))


class FakeMulti(Policy):
    """Scripted five-agent team; reads real tool results so the story matches the season."""

    name = CONFIG

    def __init__(self, seed: int, weeks: int):
        rng = np.random.default_rng(seed)
        self.n_plan = {w: r5(n + rng.integers(-10, 11)) for w, n in BASE_N_PLAN.items()}
        self.objection_weeks = {int(w) for w in rng.choice(sorted(self.n_plan), 2, replace=False)}
        blocked = set(self.n_plan) | {w + 1 for w in self.n_plan} | {0, weeks - 1}
        self.fallback_week = int(rng.choice([w for w in range(weeks) if w not in blocked]))
        self.carry = 0.0   # N the coordinator deferred to next week

    def say(self, log, week, agent, text, **extra):
        log.event(week, agent, "message", {"text": text, **extra})

    def decide(self, episode_id, week, obs, env, log):
        self.say(log, week, "coordinator", f"Week {week}: collecting weather, crop and budget before planning.")

        wx = self.call_tool("get_weather", episode_id, week, env, log, agent="weather")
        rain7 = sum(d["rain_mm"] for d in wx["outlook"])
        storm = max((d["rain_mm"] for d in wx["outlook"]), default=0.0)
        self.say(log, week, "weather", f"Next 7 days: {rain7:.0f} mm rain forecast"
                 + (f", storm day up to {storm:.0f} mm." if storm >= STORM_MM else ", no storm day."))

        crop = self.call_tool("get_crop_state", episode_id, week, env, log, agent="crop")
        self.say(log, week, "crop", f"Stage {crop['stage']}, biomass {crop['biomass_kg_ha']:.0f} kg/ha, "
                 f"N stress {crop['n_stress']:.2f}, water stress {crop['water_stress']:.2f}.")

        soil = self.call_tool("get_soil", episode_id, week, env, log, agent="planner")
        budget = self.call_tool("get_budget", episode_id, week, env, log, agent="planner")
        dry = soil["soil_water_frac"] < DRY_FRAC and rain7 < 15

        if week == self.fallback_week:
            return self.fallback(log, week, soil)

        n = min(self.n_plan.get(week, 0.0) + self.carry, budget["n_remaining_season_cap"])
        self.carry = 0.0
        irr = IRR_MM if dry else 0.0
        self.say(log, week, "planner", f"Proposal: {n:.0f} kg N/ha, {irr:.0f} mm irrigation "
                 f"(soil water {soil['soil_water_frac']:.2f}, soil N {soil['soil_n_kg_ha']:.0f} kg/ha).")

        if week in self.objection_weeks and n > 0:
            why = (f"{rain7:.0f} mm rain forecast, leaching risk" if rain7 >= 25
                   else f"{n:.0f} kg is more than {crop['stage']} can take up in a week")
            self.say(log, week, "critic", f"Object: {why}. Split the dose: half now, half next week.",
                     objection=True)
            new_n = r5(n / 2)
            self.carry = n - new_n
            reason = (f"Planner proposed {n:.0f} kg N/ha; critic objected ({why}). "
                      f"Applying {new_n:.0f} kg now and {self.carry:.0f} kg next week; irrigation {irr:.0f} mm.")
            n = new_n
        else:
            self.say(log, week, "critic", "No objection: dose and irrigation fit the forecast and stage.",
                     objection=False)
            reason = f"Accepted planner proposal: {n:.0f} kg N/ha, {irr:.0f} mm irrigation."

        log.event(week, "coordinator", "decision", {"n_kg_ha": n, "irr_mm": irr, "reason": reason})
        return Decision(n, irr, reason)

    def fallback(self, log, week, soil):
        self.say(log, week, "planner", "(reply truncated: no decision JSON returned)")
        irr = IRR_MM if soil["soil_water_frac"] < FALLBACK_DRY_FRAC else 0.0
        log.event(week, "coordinator", "fallback",
                  {"text": "Planner reply failed the decision schema after 1 retry; using the farmer rule "
                           f"(0 kg N, irrigate {IRR_MM:.0f} mm if soil water < {FALLBACK_DRY_FRAC})."})
        self.say(log, week, "critic", "Fallback rule is conservative; no objection.", objection=False)
        reason = f"Fallback: farmer rule, 0 kg N/ha, {irr:.0f} mm irrigation."
        log.event(week, "coordinator", "decision", {"n_kg_ha": 0.0, "irr_mm": irr, "reason": reason})
        return Decision(0.0, irr, reason)


def make_deterministic(log: RunLogger, seed: int) -> None:
    """Rewrite wall-clock timestamps and the random episode_id from the seed."""
    rng = np.random.default_rng(seed + 1)
    fake_id = hashlib.md5(f"{CONFIG}:{seed}:{log.task_id}".encode()).hexdigest()
    real_id = log.events[0]["data"]["reset"]["episode_id"]
    t = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
    for e in log.events:
        llm_like = e["kind"] in ("message", "decision", "fallback") and e["agent"] != "env"
        t += timedelta(milliseconds=int(rng.integers(400, 2500) if llm_like else rng.integers(5, 60)))
        e["t"] = t.isoformat()
        e["data"] = json.loads(json.dumps(e["data"]).replace(real_id, fake_id))


def main() -> None:
    ap = argparse.ArgumentParser(description="Write a FAKE multi-agent log to runs/fake_multi/.")
    ap.add_argument("--task-id", default="UFGA-s1")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--env-url", default=None, help="running env server (default: in-process toy sim)")
    args = ap.parse_args()

    task = find_task(args.task_id, "dev")   # dev only; exits if not a dev task
    weeks = int(load_config()["env"]["weeks_per_season"])
    env = EnvClient(args.env_url) if args.env_url else EnvClient()
    if not args.env_url:
        from env.server import app       # read-only import of the real server
        env.http.close()
        env.http = TestClient(app)
    policy = FakeMulti(args.seed, weeks)
    try:
        log = RunLogger(CONFIG, task["task_id"])
        play_season(policy, task, env, log)
    finally:
        env.close()
    make_deterministic(log, args.seed)
    path = log.save()
    print(f"FAKE log: {path} ({len(log.events)} events; critic objects in weeks "
          f"{sorted(policy.objection_weeks)}; fallback week {policy.fallback_week})")


if __name__ == "__main__":
    main()
