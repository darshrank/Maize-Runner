"""Second farmer baseline: the management that ships with gym-DSSAT's UFGA maize experiment.

UFGA8201 treatment 3 (the one gym-DSSAT's "all" mode runs): fertilizer level 1 and irrigation
level 2, the same schedule as gym-DSSAT's samples/run_env.py default_policy. Dates are days after
planting (DAP; planting PDATE 82057). FieldTwin decides weekly, so each week applies the sum of
that week's events on its day 1 (week = (DAP - 1) // 7). No week exceeds the 50 mm limit.
Fixed calendar, no tool calls: 116 kg N/ha and 264 mm in total.
"""

from agents.policies.base import Decision, Policy

N_BY_DAP = {40: 27.0, 45: 35.0, 80: 54.0}
IRR_BY_DAP = {6: 13.0, 20: 10.0, 37: 10.0, 50: 13.0, 54: 18.0, 65: 25.0, 69: 25.0, 72: 13.0,
              75: 15.0, 77: 19.0, 80: 20.0, 84: 20.0, 91: 15.0, 101: 19.0, 104: 4.0, 105: 25.0}


def _by_week(by_dap: dict[int, float]) -> dict[int, float]:
    weeks: dict[int, float] = {}
    for dap, amount in by_dap.items():
        weeks[(dap - 1) // 7] = weeks.get((dap - 1) // 7, 0.0) + amount
    return weeks


N_BY_WEEK, IRR_BY_WEEK = _by_week(N_BY_DAP), _by_week(IRR_BY_DAP)


class FarmerUFGA(Policy):
    name = "farmer_ufga"

    def decide(self, episode_id, week, obs, env, log):
        n, irr = N_BY_WEEK.get(week, 0.0), IRR_BY_WEEK.get(week, 0.0)
        return Decision(n, irr, f"UFGA experiment schedule (gym-DSSAT treatment 3): {n:g} kg N, {irr:g} mm this week.")
