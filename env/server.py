"""FastAPI env server implementing the FROZEN HTTP contract (SKELETON_SPEC.md section 7).

Run:  uv run uvicorn env.server:app --port 9000

Episodes live in an in-memory dict. A global lock guards the dict and each
episode has its own lock, which is plenty for 8 to 32 parallel episodes.
"""

import os
import threading
import uuid
from pathlib import Path

import numpy as np
import yaml
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from env import make_simulator

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ["get_weather", "get_crop_state", "get_soil", "get_history", "get_budget"]


def load_config(path: str | os.PathLike | None = None) -> dict:
    path = path or os.environ.get("FIELDTWIN_CONFIG", ROOT / "config.yaml")
    with open(path) as f:
        cfg = yaml.safe_load(f)
    # Lets machines without gym-DSSAT run the toy simulator: FIELDTWIN_SIMULATOR=toy
    if os.environ.get("FIELDTWIN_SIMULATOR"):
        cfg["env"]["simulator"] = os.environ["FIELDTWIN_SIMULATOR"]
    return cfg


class ResetRequest(BaseModel):
    task_id: str
    site: str
    weather_seed: int


class StepRequest(BaseModel):
    episode_id: str
    n_kg_ha: float
    irr_mm: float
    reason: str = ""


class Episode:
    def __init__(self, req: ResetRequest, sim):
        self.task_id = req.task_id
        self.weather_seed = req.weather_seed
        self.sim = sim
        self.week = 0
        self.done = False
        self.n_applied = 0.0            # kg/ha applied so far (after clamping)
        self.irr_total = 0.0            # mm irrigated so far
        self.history: list[dict] = []   # one row per played week (get_history)
        self.final: dict | None = None
        self.lock = threading.Lock()


def error(status: int, msg: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": msg})


def create_app(config: dict | None = None) -> FastAPI:
    cfg = config or load_config()
    env_cfg, prices, reward_cfg = cfg["env"], cfg["prices"], cfg["reward"]
    max_n_week = float(env_cfg["max_n_kg_ha_per_week"])
    max_irr_week = float(env_cfg["max_irr_mm_per_week"])
    max_n_season = float(env_cfg["max_n_kg_ha_per_season"])

    app = FastAPI(title="FieldTwin env")
    episodes: dict[str, Episode] = {}
    episodes_lock = threading.Lock()

    def get_episode(episode_id: str) -> Episode | None:
        with episodes_lock:
            return episodes.get(episode_id)

    def unknown_episode(episode_id: str) -> JSONResponse:
        return error(404, f"unknown episode_id {episode_id!r}. Call POST /reset first and "
                          "use the episode_id it returns.")

    def spend(ep: Episode) -> float:
        return round(ep.n_applied * prices["n_usd_per_kg"]
                     + ep.irr_total * prices["water_usd_per_mm_ha"], 2)

    def add_money(final: dict) -> dict:
        profit = (final["grain_kg_ha"] * prices["maize_usd_per_kg"]
                  - final["n_applied"] * prices["n_usd_per_kg"]
                  - final["irr_mm"] * prices["water_usd_per_mm_ha"])
        reward = profit - reward_cfg["leach_penalty_usd_per_kg"] * final["n_leached"]
        return {**final, "profit_usd_ha": round(profit, 2), "reward": round(reward, 2)}

    @app.get("/health")
    def health():
        return {"ok": True, "simulator": env_cfg["simulator"]}

    @app.post("/reset")
    def reset(req: ResetRequest):
        sim = make_simulator(env_cfg["simulator"], env_cfg)
        obs = sim.reset(req.site, req.weather_seed)
        episode_id = uuid.uuid4().hex
        with episodes_lock:
            episodes[episode_id] = Episode(req, sim)
        return {"episode_id": episode_id, "obs": obs, "week": 0}

    @app.post("/step")
    def step(req: StepRequest):
        ep = get_episode(req.episode_id)
        if ep is None:
            return unknown_episode(req.episode_id)
        with ep.lock:
            if ep.done:
                return error(409, "this episode is done (all weeks played). Call POST /reset "
                                  "to start a new season.")
            # Clamp instead of erroring: weekly limits, then the season N cap.
            n_left = max(0.0, max_n_season - ep.n_applied)
            n = min(max(req.n_kg_ha, 0.0), max_n_week, n_left)
            irr = min(max(req.irr_mm, 0.0), max_irr_week)
            clamped = (n != req.n_kg_ha) or (irr != req.irr_mm)

            result = ep.sim.step_week(n, irr)
            ep.n_applied += n
            ep.irr_total += irr
            weekly = result["weekly"]
            ep.history.append({"week": ep.week, "n_kg_ha": n, "irr_mm": irr,
                               "rain_mm": weekly["rain_mm"], "n_leached": weekly["n_leached"],
                               "n_uptake": weekly["n_uptake"]})
            ep.week += 1
            ep.done = bool(result["done"]) or ep.week >= env_cfg["weeks_per_season"]
            resp = {"obs": result["obs"], "week": ep.week, "done": ep.done,
                    "weekly": weekly, "clamped": clamped}
            if ep.done:
                ep.final = add_money(ep.sim.final())
                resp["final"] = ep.final
            return resp

    @app.get("/tool/{name}")
    def tool(name: str, episode_id: str = ""):
        if name not in TOOLS:
            return error(404, f"unknown tool {name!r}. Valid tools: {', '.join(TOOLS)}. "
                              f"Call GET /tool/<name>?episode_id=<id>.")
        ep = get_episode(episode_id)
        if ep is None:
            return unknown_episode(episode_id)
        with ep.lock:
            sim = ep.sim
            if name == "get_weather":
                # Same seed per (task, week), so every policy sees the same outlook.
                rng = np.random.default_rng(ep.weather_seed * 1000 + ep.week)
                return {"history": sim.weather_history(14), "outlook": sim.weather_outlook(7, rng)}
            if name == "get_crop_state":
                return sim.crop_state()
            if name == "get_soil":
                return sim.soil_state()
            if name == "get_history":
                return list(ep.history)
            # get_budget
            return {"n_applied_total": round(ep.n_applied, 2),
                    "n_remaining_season_cap": round(max(0.0, max_n_season - ep.n_applied), 2),
                    "irr_total_mm": round(ep.irr_total, 2),
                    "spend_usd": spend(ep)}

    return app


app = create_app()
