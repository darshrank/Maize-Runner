"""Typical farmer: fixed split N schedule, irrigate when the soil gets dry."""

from agents.policies.base import Decision, Policy

N_SCHEDULE = {0: 60.0, 5: 60.0, 9: 40.0}   # week -> kg N/ha (planting, ~V6, ~V10)
DRY_FRAC = 0.35
IRR_MM = 25.0


class Farmer(Policy):
    name = "farmer"

    def decide(self, episode_id, week, obs, env, log):
        soil = self.call_tool("get_soil", episode_id, week, env, log)
        n = N_SCHEDULE.get(week, 0.0)
        irr = IRR_MM if soil["soil_water_frac"] < DRY_FRAC else 0.0
        parts = [f"split schedule: {n:.0f} kg N/ha this week" if n else "no N scheduled this week"]
        if irr:
            parts.append(f"soil water {soil['soil_water_frac']:.2f} < {DRY_FRAC}, irrigate {IRR_MM:.0f} mm")
        return Decision(n, irr, "; ".join(parts) + ".")
