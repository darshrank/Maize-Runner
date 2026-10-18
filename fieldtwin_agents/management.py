"""Management shared by the skeleton policies and isolated dev experiment runner."""
import os
from pathlib import Path

import yaml

from .contracts import Action, number


def shared_config():
    root = Path(__file__).resolve().parent.parent
    path = os.environ.get("FIELDTWIN_CONFIG", root / "config.yaml")
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def environment_limits():
    return shared_config()["env"]


def management_provenance():
    from agents.policies.farmer import DRY_FRAC, IRR_MM, N_SCHEDULE
    config = shared_config()
    return {"env": config["env"], "prices": config["prices"], "reward": config["reward"],
            "farmer": {"n_schedule": N_SCHEDULE, "dry_frac": DRY_FRAC, "irr_mm": IRR_MM}}


def farmer_fallback(week, obs, schedule=None):
    from agents.policies.farmer import DRY_FRAC, IRR_MM, N_SCHEDULE
    if schedule is not None:
        n, irr = schedule.get(week, (0.0, 0.0))
    else:
        n = N_SCHEDULE.get(week, 0.0)
        # Canonical obs is a fraction. Legacy synthetic fixtures expose a bucket in mm.
        moisture = obs.get("soil_water_frac", obs.get("soil_water_mm", 150.0) / 150.0)
        irr = IRR_MM if number(moisture) < DRY_FRAC else 0.0
    return Action(n, irr, "Farmer schedule fallback: policy response unavailable or invalid.")
