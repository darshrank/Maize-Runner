"""Abstract simulator interface.

Teammate A reimplements this with gym-DSSAT (env/dssat_sim.py). The server only
talks to this interface, so swapping the simulator never touches env/server.py.

Shapes (frozen, see SKELETON_SPEC.md section 5):
  obs    = {"day", "week", "stage", "soil_water_frac", "soil_n_kg_ha",
            "n_applied_total", "irr_total_mm", "biomass_kg_ha"}
  weekly = {"rain_mm", "n_leached", "n_uptake", "n_gas"}       (this week's sums)
  final  = {"grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas", "irr_mm"}
Weather day = {"day", "tmax", "tmin", "rain_mm"}; day is relative to week 0 (negative before it).
Seasons use real NASA POWER weather (env/weather.py, data/weather/).
"""

from abc import ABC, abstractmethod


class Simulator(ABC):
    def __init__(self, env_config: dict | None = None):
        # The `env:` section of config.yaml (e.g. outlook_noise), passed by the factory.
        self.env_config = env_config or {}

    @abstractmethod
    def reset(self, site: str, year: int) -> dict:
        """Start a new season at `site` with the real weather of `year`. Returns obs."""

    @abstractmethod
    def step_week(self, n_kg_ha: float, irr_mm: float) -> dict:
        """Apply the action on day 1 of the week, run 7 days.

        Returns {"obs": obs, "weekly": weekly, "done": bool}.
        """

    @abstractmethod
    def weather_history(self, days: int) -> list[dict]:
        """The last `days` observed (past) weather days."""

    @abstractmethod
    def weather_outlook(self, days: int, rng) -> list[dict]:
        """The NEXT `days` days of true weather plus noise drawn from `rng`."""

    @abstractmethod
    def crop_state(self) -> dict:
        """{"stage", "gdd", "biomass_kg_ha", "n_stress", "water_stress"}"""

    @abstractmethod
    def soil_state(self) -> dict:
        """{"soil_water_frac", "soil_n_kg_ha"}"""

    @abstractmethod
    def final(self) -> dict:
        """End-of-season totals (no money; the server adds profit and reward)."""

    def close(self) -> None:
        """Release external resources (processes, files). The server calls it when an episode ends.
        After close(), crop_state/soil_state/weather_history/final must still answer from cached state."""

    def noisy_outlook(self, true_days: list[dict], rng) -> list[dict]:
        """Shared outlook noise: rain x (1 + N(0, rain_frac)) floored at 0, temperatures + N(0, temp_c).
        Settings come from config.yaml env.outlook_noise."""
        noise = self.env_config.get("outlook_noise", {})
        rain_frac, temp_c = noise.get("rain_frac", 0.4), noise.get("temp_c", 2.0)
        out = []
        for w in true_days:
            rain = w["rain_mm"] * max(0.0, 1 + rng.normal(0, rain_frac))
            out.append({
                "day": w["day"],
                "tmax": round(w["tmax"] + rng.normal(0, temp_c), 1),
                "tmin": round(w["tmin"] + rng.normal(0, temp_c), 1),
                "rain_mm": round(float(rain), 1),
            })
        return out
