"""Abstract simulator interface.

Teammate A reimplements this with gym-DSSAT (env/dssat_sim.py). The server only
talks to this interface, so swapping the simulator never touches env/server.py.

Shapes (frozen, see SKELETON_SPEC.md section 5):
  obs    = {"day", "week", "stage", "soil_water_frac", "soil_n_kg_ha",
            "n_applied_total", "irr_total_mm", "biomass_kg_ha"}
  weekly = {"rain_mm", "n_leached", "n_uptake", "n_gas"}       (this week's sums)
  final  = {"grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas", "irr_mm"}
Weather day = {"day", "tmax", "tmin", "rain_mm"}.
"""

from abc import ABC, abstractmethod


class Simulator(ABC):
    def __init__(self, env_config: dict | None = None):
        # The `env:` section of config.yaml (e.g. outlook_noise), passed by the factory.
        self.env_config = env_config or {}

    @abstractmethod
    def reset(self, site: str, weather_seed: int) -> dict:
        """Start a new season. Returns obs."""

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
