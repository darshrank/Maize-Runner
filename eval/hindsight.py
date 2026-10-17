"""Hindsight ceiling: grid-search the best fixed schedule per season, via the API.

Grid: N doses {0, 40, 80} at weeks {0, 5, 9} (27 combos) x irrigation
{never, 25 mm when soil_water_frac < 0.35} = 54 seasons per task. The best
run (by reward) is saved as a normal run log under runs/hindsight/.
It knows the future, so it is an unreachable ceiling, not a real policy.
"""

import itertools
import time

from agents.client import EnvClient
from agents.policies.base import Decision, Policy
from agents.run import RunLogger, play_season

N_DOSES = [0.0, 40.0, 80.0]
N_WEEKS = [0, 5, 9]
DRY_FRAC, IRR_MM = 0.35, 25.0


class SchedulePolicy(Policy):
    """Replays one fixed schedule from the grid (uses obs, no tool calls)."""

    name = "hindsight"

    def __init__(self, doses: tuple[float, ...], irrigate: bool):
        self.schedule = dict(zip(N_WEEKS, doses))
        self.irrigate = irrigate

    def decide(self, episode_id, week, obs, env, log):
        n = self.schedule.get(week, 0.0)
        irr = IRR_MM if self.irrigate and obs["soil_water_frac"] < DRY_FRAC else 0.0
        doses = "/".join(f"{d:.0f}" for d in self.schedule.values())
        return Decision(n, irr, f"hindsight best schedule: N {doses} kg/ha at weeks 0/5/9, "
                                f"irrigation {'when dry' if self.irrigate else 'never'}.")


def run_hindsight(task: dict, env_url: str) -> tuple[dict, dict]:
    """Search the grid for one task, save the best log. Returns (final, stats) like agents.run.run_one."""
    t0 = time.time()
    env = EnvClient(env_url)
    best = None  # (reward, final, log)
    try:
        for doses in itertools.product(N_DOSES, repeat=len(N_WEEKS)):
            for irrigate in (False, True):
                log = RunLogger("hindsight", task["task_id"])
                final = play_season(SchedulePolicy(doses, irrigate), task, env, log)
                if best is None or final["reward"] > best[0]:
                    best = (final["reward"], final, log)
    finally:
        env.close()
    _, final, log = best
    log.save()
    return final, {"llm_calls": 0, "fallbacks": 0, "wall_s": round(time.time() - t0, 2)}
