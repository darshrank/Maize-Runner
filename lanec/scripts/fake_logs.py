"""Write FAKE data for UI work.

  uv run python -m lanec.scripts.fake_logs [--task-id UFGA-s1] [--seed 0] [--env-url URL]
      one FAKE multi-agent run log: runs/fake_multi/<task_id>.jsonl (toy sim, described below)
  uv run python -m lanec.scripts.fake_logs --ui [--seed 0]
      the whole ui/fake/ tree the UI reads with ?fake=1 (UI_SPEC.md section 4; see write_ui_fake)

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
import calendar
import csv
import hashlib
import json
import math
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

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


# ---------------------------------------------------------------- --ui: the ui/fake/ tree (UI_SPEC.md section 4)
#
# Writes, under ui/fake/, the same files the UI reads from the repo root (UI_SPEC.md section 3):
#   runs/index.json, runs/{farmer,multi}/UFGA-<year>.jsonl (3 logged seasons), data/weather/UFGA_<year>.json,
#   results/eval.csv (every config, 20 dev + 15 test years), results/iterations.json (5 versions),
#   results/vllm_metrics.json (STATE.md contract shape), README.md.
# Every season comes from FakeSeason below, a tiny daily bucket model (not the toy sim, not DSSAT), tuned only to
# look plausible on screen. Its numbers mean nothing. Each file carries a FAKE marker where its shape allows one:
# log reset line data.fake, weather days "fake": true, eval.csv first line "# FAKE ...", iterations items
# "fake": true, vllm_metrics "fake": true. index.json has no room for one; its folder is ui/fake/.
# Log lines use the frozen format and the line order of agents.run.play_season.

UI_FAKE_DIR = Path(__file__).resolve().parents[2] / "ui" / "fake"
FAKE_NOTE = "FAKE placeholder data from lanec.scripts.fake_logs --ui, for UI work only. Not a result."
UI_SITE = "UFGA"
UI_DEV_YEARS = tuple(range(1990, 2010))    # same year split as the real tasks on a-env (data/README.md)
UI_TEST_YEARS = tuple(range(2010, 2025))   # 15 held-out years
UI_LOG_YEARS = (1994, 2001, 2005)          # dev years that also get logs and weather files
UI_LOG_CONFIGS = ("farmer", "multi")
UI_CONFIGS = ("no_n", "farmer", "hindsight", "single", "multi", "multi_no_critic", "multi_no_weather", "multi_no_tools")
SEASON_START_DOY = 58      # week 0 starts the day after planting (PLANTING_DOY 57 in env/weather.py on a-env)
# Scripted storms in the logged seasons, season day -> mm. Each lands 1-3 days after a farmer N week
# (0, 5, 9), so the calendar leaches and the team, which sees the outlook, defers.
UI_STORMS = {1994: {37: 61.0, 38: 22.0}, 2001: {2: 58.0, 3: 21.0}, 2005: {36: 57.0, 37: 18.0, 92: 38.0}}
UI_FALLBACK = {2001: 14}   # year -> week: the one fallback week in the logged multi seasons
TEAM_PLAN = {0: 30.0, 5: 50.0, 8: 40.0, 11: 30.0}   # week -> kg N/ha the planner starts from
FARMER_N = {0: 60.0, 5: 60.0, 9: 40.0}               # agents/policies/farmer.py
STAGES = (("VE", 0.1), ("V6", 0.25), ("V10", 0.4), ("VT", 0.55), ("R1", 0.65), ("R3", 0.85), ("R6", 1.01))
SOIL_MM = 200.0            # bucket size; soil_water_frac = water / SOIL_MM


def fake_weather(year: int, seed: int) -> list[dict]:
    """One calendar year of FAKE daily weather in the data/weather/<SITE>_<YEAR>.json shape."""
    rng = random.Random(f"weather:{seed}:{year}")
    n_days = 366 if calendar.isleap(year) else 365
    storms = UI_STORMS.get(year)
    if storms is None:   # eval-only years: 0-2 random storm days in the season window
        storms = {rng.randrange(7, 140): round(rng.uniform(45, 85), 1) for _ in range(rng.choice((0, 1, 1, 2)))}
    days = []
    for i in range(n_days):
        doy = i + 1
        warm = math.sin(math.pi * (doy - 20) / 365)
        tmax = 18 + 15 * warm + rng.gauss(0, 2)
        rain = min(rng.expovariate(1 / 6), 24.0) if rng.random() < 0.26 else 0.0
        rain = storms.get(doy - SEASON_START_DOY, rain)
        days.append({"date": (date(year, 1, 1) + timedelta(i)).isoformat(), "doy": doy,
                     "tmax_c": round(tmax, 1), "tmin_c": round(tmax - 8 - 4 * rng.random(), 1),
                     "rain_mm": round(rain, 1),
                     "srad_mj_m2": round(max(4.0, 12 + 10 * warm - 0.35 * rain + rng.gauss(0, 2)), 1),
                     "rh_pct": round(min(99.0, 70 + 0.8 * rain + rng.gauss(0, 6)), 1),
                     "wind_m_s": round(abs(rng.gauss(2.2, 0.8)), 1), "fake": True})
    return days


class FakeSeason:
    """Daily bucket model: soil water (mm), mineral N pool (kg/ha), biomass. FAKE, tuned only to look plausible.

    Tool results and the /step response use the toy sim's shapes (env/toy_sim.py, env/server.py)."""

    def __init__(self, weather: list[dict], weeks: int, prices: dict, year: int):
        start = SEASON_START_DOY - 1
        self.days, self.weeks, self.prices, self.year = weather[start:start + 7 * weeks], weeks, prices, year
        self.week = self.day = 0
        self.water, self.soil_n, self.biomass = 128.0, 30.0, 0.0
        self.n_applied = self.irr_total = 0.0
        self.tot = {"n_uptake": 0.0, "n_leached": 0.0, "n_gas": 0.0}
        self.n_fac, self.late_n_fac = 1.0, []

    def frac(self) -> float:
        return self.water / SOIL_MM

    def stage(self, week: int | None = None) -> str:
        x = (self.week if week is None else week) / self.weeks
        return next(name for name, upper in STAGES if x < upper)

    def demand(self, week: int) -> float:   # kg N/ha/day the crop can take up
        return 4.0 * math.exp(-(((week + 0.5) / self.weeks - 0.42) / 0.2) ** 2)

    def growth(self, week: int) -> float:   # kg/ha/day biomass at no stress
        x = (week + 0.5) / self.weeks
        return 300 * math.sin(math.pi * min(x / 0.9, 1.0)) ** 1.5

    def step_week(self, n_kg_ha: float, irr_mm: float) -> dict:
        n = min(max(n_kg_ha, 0.0), 120.0, 300.0 - self.n_applied)
        irr = min(max(irr_mm, 0.0), 50.0)
        clamped = (n, irr) != (n_kg_ha, irr_mm)
        self.soil_n += n
        self.n_applied += n
        self.irr_total += irr
        weekly = {"rain_mm": 0.0, "n_leached": 0.0, "n_uptake": 0.0, "n_gas": 0.0}
        for i in range(7):
            d = self.days[self.day]
            self.water += d["rain_mm"] + (irr if i == 0 else 0.0)
            et = (1.0 + 2.8 * min(1.0, self.biomass / 9000)) * max(0.4, d["tmax_c"] / 30)
            self.water = max(30.0, self.water - et)
            drain = max(0.0, self.water - 148) * 0.7
            self.water -= drain
            leach = self.soil_n * min(0.8, drain / 70)
            self.soil_n -= leach
            dem, w_fac = self.demand(self.week), min(1.0, self.frac() / 0.4)
            up = min(0.5 * self.soil_n, dem * min(1.0, self.soil_n / 35) * w_fac)
            self.soil_n -= up
            gas = 0.004 * self.soil_n * self.frac()
            self.soil_n += 0.3 - gas   # + mineralization
            self.n_fac = 0.8 * self.n_fac + 0.2 * (up / dem if dem > 0.05 else 1.0)
            if self.week >= 0.45 * self.weeks:
                self.late_n_fac.append(self.n_fac)
            self.biomass += self.growth(self.week) * (0.3 + 0.7 * self.n_fac) * w_fac
            for k, v in (("rain_mm", d["rain_mm"]), ("n_leached", leach), ("n_uptake", up), ("n_gas", gas)):
                weekly[k] += v
            self.day += 1
        for k in ("n_leached", "n_uptake", "n_gas"):
            self.tot[k] += weekly[k]
        self.week += 1
        resp = {"obs": self.obs(), "week": self.week, "done": self.week >= self.weeks,
                "weekly": {k: round(v, 2) for k, v in weekly.items()}, "clamped": clamped}
        if resp["done"]:
            resp["final"] = self.final()
        return resp

    def obs(self) -> dict:
        return {"day": self.day, "week": self.week, "stage": self.stage(min(self.week, self.weeks - 1)),
                "soil_water_frac": round(self.frac(), 3), "soil_n_kg_ha": round(self.soil_n, 2),
                "n_applied_total": round(self.n_applied, 2), "irr_total_mm": round(self.irr_total, 2),
                "biomass_kg_ha": round(self.biomass, 1)}

    def final(self) -> dict:
        late = sum(self.late_n_fac) / len(self.late_n_fac) if self.late_n_fac else self.n_fac
        grain = min(max(self.biomass * 0.5 * (0.45 + 0.55 * late), 2500.0), 13000.0)
        p = self.prices
        profit = grain * p["maize_usd_per_kg"] - self.n_applied * p["n_usd_per_kg"] \
            - self.irr_total * p["water_usd_per_mm_ha"]
        return {"grain_kg_ha": round(grain, 1), "n_applied": round(self.n_applied, 2),
                "n_uptake": round(self.tot["n_uptake"], 2), "n_leached": round(self.tot["n_leached"], 2),
                "n_gas": round(self.tot["n_gas"], 2), "irr_mm": round(self.irr_total, 2),
                "profit_usd_ha": round(profit, 2), "reward": round(profit - p["leach_penalty"] * self.tot["n_leached"], 2)}

    # Read tools, same shapes as env/server.py. The outlook noise is seeded per (year, week), so every
    # policy sees the same forecast, like the real server.
    def tool(self, name: str):
        if name == "get_weather":
            rng = random.Random(f"outlook:{self.year}:{self.week}")
            row = lambda d, i: {"day": i, "tmax": d["tmax_c"], "tmin": d["tmin_c"], "rain_mm": d["rain_mm"]}
            hist = [row(self.days[i], i) for i in range(max(0, self.day - 14), self.day)]
            out = [dict(row(self.days[i], i), rain_mm=round(self.days[i]["rain_mm"] * max(0.0, 1 + rng.gauss(0, 0.2)), 1),
                        tmax=round(self.days[i]["tmax_c"] + rng.gauss(0, 1.5), 1))
                   for i in range(self.day, min(self.day + 7, len(self.days)))]
            return {"history": hist, "outlook": out}
        if name == "get_crop_state":
            return {"stage": self.stage(), "gdd": round(11.5 * self.day, 1), "biomass_kg_ha": round(self.biomass, 1),
                    "n_stress": round(self.n_fac, 3), "water_stress": round(min(1.0, self.frac() / 0.4), 3)}
        if name == "get_soil":
            return {"soil_water_frac": round(self.frac(), 3), "soil_n_kg_ha": round(self.soil_n, 2)}
        if name == "get_budget":
            p = self.prices
            return {"n_applied_total": round(self.n_applied, 2), "n_remaining_season_cap": round(300.0 - self.n_applied, 2),
                    "irr_total_mm": round(self.irr_total, 2),
                    "spend_usd": round(self.n_applied * p["n_usd_per_kg"] + self.irr_total * p["water_usd_per_mm_ha"], 2)}
        raise KeyError(name)

    def weekday(self, outlook_day: int) -> str:
        return date.fromisoformat(self.days[outlook_day]["date"]).strftime("%A")


class FakeLog:
    """RunLogger-like buffer with deterministic timestamps; write=False only counts model calls."""

    def __init__(self, key: str, write: bool = True):
        self.events, self.write, self.llm_calls, self.fallbacks = [], write, 0, 0
        self.rng = random.Random(f"log:{key}")
        self.t = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)

    def event(self, week: int, agent: str, kind: str, data) -> None:
        llm = kind in ("message", "decision", "fallback") and agent not in ("env", "policy")
        self.llm_calls += llm and kind != "fallback"
        self.fallbacks += kind == "fallback"
        if not self.write:
            return
        self.t += timedelta(milliseconds=self.rng.randint(500, 2600) if llm else self.rng.randint(4, 40))
        self.events.append({"t": self.t.isoformat(), "week": int(week), "agent": agent, "kind": kind, "data": data})

    def tool(self, sim: FakeSeason, week: int, agent: str, name: str, args: dict):
        self.event(week, agent, "tool_call", {"name": name, "args": args})
        result = sim.tool(name)
        self.event(week, agent, "tool_result", {"name": name, "result": result})
        return result


class FakeSchedule:
    """Non-LLM baselines: fixed N weeks, optional farmer irrigation rule (25 mm when soil water < 0.35)."""

    def __init__(self, n_by_week: dict, irrigate: bool, label: str):
        self.n_by_week, self.irrigate, self.label = n_by_week, irrigate, label

    def decide(self, sim, week, log, args):
        n = self.n_by_week.get(week, 0.0)
        irr = 0.0
        if self.irrigate:
            soil = log.tool(sim, week, "policy", "get_soil", args)
            irr = 25.0 if soil["soil_water_frac"] < 0.35 else 0.0
        if self.label == "farmer":   # same reason text as agents/policies/farmer.py
            parts = [f"split schedule: {n:.0f} kg N/ha this week" if n else "no N scheduled this week"]
            if irr:
                parts.append(f"soil water {soil['soil_water_frac']:.2f} < 0.35, irrigate 25 mm")
            return n, irr, "; ".join(parts) + "."
        return n, irr, f"{self.label}: {n:.0f} kg N/ha, {irr:.0f} mm irrigation."


class FakeTeam:
    """Scripted stand-in for the LLM configs. Flags switch agents off for the ablations; `single` is one agent
    that only reacts to very large forecasts. Messages read real (fake-model) tool results."""

    def __init__(self, config: str, year: int, critic=True, split=True, weather=True, tools=True,
                 irr_outlook=True, single=False):
        self.critic, self.split, self.weather, self.tools = critic, split, weather, tools
        self.irr_outlook, self.single = irr_outlook, single
        self.fallback_week = UI_FALLBACK.get(year) if config == "multi" else None
        self.carry: dict[int, float] = {}
        self.calendar_irr = random.Random(f"irr:{config}:{year}").randrange(2, 5)

    def decide(self, sim, week, log, args):
        a = "planner" if self.single else None   # single agent speaks as one voice
        rain7 = storm_mm = storm_day = None
        if self.weather:
            wx = log.tool(sim, week, a or "weather", "get_weather", args)
            out = wx["outlook"]
            rain7 = sum(d["rain_mm"] for d in out)
            top = max(out, key=lambda d: d["rain_mm"], default=None)
            storm_mm, storm_day = (top["rain_mm"], top["day"]) if top else (0.0, None)
            past = sum(d["rain_mm"] for d in wx["history"])
            when = f", {storm_mm:.0f} mm on {sim.weekday(storm_day)}" if storm_mm and storm_mm >= 15 else ""
            log.event(week, a or "weather", "message",
                      {"text": f"Last 14 days {past:.0f} mm. Next 7 days {rain7:.0f} mm{when}."})
        if self.tools:
            crop = log.tool(sim, week, a or "crop", "get_crop_state", args)
            soil = log.tool(sim, week, a or "planner", "get_soil", args)
            budget = log.tool(sim, week, a or "planner", "get_budget", args)
            if not self.single:
                log.event(week, "crop", "message", {"text": (
                    f"Stage {crop['stage']}, biomass {crop['biomass_kg_ha']:,.0f} kg/ha. "
                    f"N sufficiency {crop['n_stress']:.2f}, water sufficiency {crop['water_stress']:.2f} (1 = no stress).")})
        else:
            soil = {"soil_water_frac": None, "soil_n_kg_ha": None}
            budget = {"n_remaining_season_cap": 300.0 - sim.n_applied}

        if week == self.fallback_week:
            return self.fallback(sim, week, log, args)

        n = min(TEAM_PLAN.get(week, 0.0) + self.carry.pop(week, 0.0), budget["n_remaining_season_cap"])
        if self.tools:
            dry = soil["soil_water_frac"] < 0.38 and (not self.irr_outlook or rain7 is None or rain7 < 15)
            irr = 20.0 if dry else 0.0
            why = f"soil water {soil['soil_water_frac']:.2f}, soil N {soil['soil_n_kg_ha']:.0f} kg/ha"
        else:   # no tools: irrigate on a guessed calendar
            irr = 20.0 if week % self.calendar_irr == 0 and 3 <= week <= 15 else 0.0
            why = "no soil reading"
        log.event(week, "planner", "message", {"text": f"Proposal: {n:.0f} kg N/ha, {irr:.0f} mm water ({why})."})

        wet = rain7 is not None and (rain7 >= 45 or storm_mm >= 35)
        if self.single:
            wet = rain7 is not None and rain7 >= 90
        objects = self.critic and not self.single and n > 0 and wet
        if self.critic and not self.single:
            text = (f"Object: {rain7:.0f} mm forecast, {storm_mm:.0f} mm on {sim.weekday(storm_day)}. "
                    f"{n:.0f} kg now would leach below the roots. Apply it after the rain." if objects
                    else "No objection: dose and water fit the forecast and the stage.")
            log.event(week, "critic", "message", {"text": text, "objection": objects})
        if objects or (self.single and n > 0 and wet):
            day = sim.weekday(storm_day)
            if self.split:
                first = 5 * round(n / 10)
                self.carry[week + 1] = self.carry.get(week + 1, 0.0) + first
                self.carry[week + 2] = self.carry.get(week + 2, 0.0) + n - first
                log.event(week, "planner", "message", {"text": (
                    f"Revised: 0 kg N now; {first:.0f} kg in week {week + 1} and {n - first:.0f} kg in week {week + 2}, "
                    f"after the rain.")})
                reason = f"Storm {day}: hold the {n:.0f} kg dose, split it over weeks {week + 1} and {week + 2}."
            else:
                reason = f"Storm {day}: skip this week's {n:.0f} kg dose."
            n = 0.0
        elif n > 0:
            reason = f"Planner's {n:.0f} kg dose fits stage {sim.stage()} and the forecast."
        else:
            reason = "No N planned this week" + (f"; soil is dry, irrigate {irr:.0f} mm." if irr else ".")
        reason = f"Apply {n:.0f} kg N, {irr:.0f} mm water. {reason}"
        log.event(week, "coordinator", "decision", {"n_kg_ha": n, "irr_mm": irr, "reason": reason})
        return n, irr, reason

    def fallback(self, sim, week, log, args):
        log.event(week, "planner", "message", {"text": "(reply truncated: no decision JSON returned)"})
        irr = 25.0 if sim.frac() < 0.35 else 0.0
        log.event(week, "coordinator", "fallback", {"why": (
            "Planner reply failed the decision schema after 1 retry; using the farmer rule "
            "(0 kg N, 25 mm if soil water < 0.35).")})
        log.event(week, "critic", "message", {"text": "Fallback rule is conservative; no objection.", "objection": False})
        reason = f"Fallback: farmer rule, 0 kg N, {irr:.0f} mm water."
        log.event(week, "coordinator", "decision", {"n_kg_ha": 0.0, "irr_mm": irr, "reason": reason})
        return 0.0, irr, reason


def make_fake_policy(config: str, year: int, hindsight_best: dict | None = None):
    team = {"multi": {}, "multi_no_critic": {"critic": False}, "multi_no_weather": {"weather": False},
            "multi_no_tools": {"tools": False}, "single": {"single": True, "critic": False, "split": False},
            # Improve loop versions (iterations.json), dev years only
            "v3_skip": {"split": False}, "v4_no_irr_outlook": {"irr_outlook": False}}
    if config in team:
        return FakeTeam(config, year, **team[config])
    if config == "farmer":
        return FakeSchedule(FARMER_N, True, "farmer")
    if config == "no_n":
        return FakeSchedule({}, False, "no_n")
    if config == "hindsight":
        return hindsight_best
    raise KeyError(config)


def play_fake(policy, task: dict, weather: list[dict], weeks: int, prices: dict, log: FakeLog) -> dict:
    """agents.run.play_season, line for line, against FakeSeason."""
    sim = FakeSeason(weather, weeks, prices, task["year"])
    eid = hashlib.md5(f"fake-ui:{task['task_id']}:{log.rng.random()}".encode()).hexdigest()
    args = {"episode_id": eid}
    log.event(0, "env", "message", {"reset": {"episode_id": eid, "obs": sim.obs(), "week": 0}, "task": task,
                                    "fake": FAKE_NOTE})
    week = 0
    while True:
        n, irr, reason = policy.decide(sim, week, log, args)
        log.event(week, "policy", "decision", {"n_kg_ha": n, "irr_mm": irr, "reason": reason})
        resp = sim.step_week(n, irr)
        log.event(week, "env", "step_result", resp)
        week = resp["week"]
        if resp["done"]:
            log.event(week, "env", "final", resp["final"])
            return resp["final"]


def fake_hindsight(task, weather, weeks, prices) -> FakeSchedule:
    """eval/hindsight.py's grid: N {0, 40, 80} at weeks {0, 5, 9} x irrigation {never, farmer rule}; best reward."""
    best = None
    for a in (0, 40, 80):
        for b in (0, 40, 80):
            for c in (0, 40, 80):
                for irrigate in (False, True):
                    pol = FakeSchedule({0: a, 5: b, 9: c}, irrigate, "grid hindsight schedule")
                    r = play_fake(pol, task, weather, weeks, prices, FakeLog("h", write=False))["reward"]
                    if best is None or r > best[0]:
                        best = (r, pol)
    return best[1]


def write_ui_fake(seed: int) -> None:
    from eval.run_eval import COLUMNS   # frozen eval.csv header
    cfg = load_config()
    weeks = int(cfg["env"]["weeks_per_season"])
    prices = dict(cfg["prices"], leach_penalty=cfg["reward"]["leach_penalty_usd_per_kg"])
    out = UI_FAKE_DIR
    rows, index, dev_means = [], {}, {}
    for split, years in (("dev", UI_DEV_YEARS), ("test", UI_TEST_YEARS)):
        for year in years:
            task = {"task_id": f"{UI_SITE}-{year}", "site": UI_SITE, "year": year, "split": split}
            weather = fake_weather(year, seed)
            best = fake_hindsight(task, weather, weeks, prices)
            configs = UI_CONFIGS + (("v3_skip", "v4_no_irr_outlook") if split == "dev" else ())
            logged = year in UI_LOG_YEARS
            for config in configs:
                write = logged and config in UI_LOG_CONFIGS
                log = FakeLog(f"{seed}:{config}:{year}", write=write)
                final = play_fake(make_fake_policy(config, year, best), task, weather, weeks, prices, log)
                if split == "dev":
                    dev_means.setdefault(config, []).append(final)
                if write:
                    path = out / "runs" / config / f"{task['task_id']}.jsonl"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("".join(json.dumps(e) + "\n" for e in log.events))
                    index.setdefault(config, []).append(task["task_id"])
                if config in UI_CONFIGS:
                    wall = log.llm_calls * random.Random(f"wall:{config}:{year}").uniform(1.1, 1.7) + 2.5
                    rows.append({**task, "config": config, **final, "llm_calls": log.llm_calls,
                                 "wall_s": round(wall, 2), "fallbacks": log.fallbacks})
            if logged:
                path = out / "data" / "weather" / f"{UI_SITE}_{year}.json"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(weather))

    # runs/index.json in update_index()'s format
    (out / "runs" / "index.json").write_text(json.dumps(
        {c: sorted(set(t), key=lambda x: (len(x), x)) for c, t in index.items()}, indent=1, sort_keys=True))

    (out / "results").mkdir(parents=True, exist_ok=True)
    with open(out / "results" / "eval.csv", "w", newline="") as f:
        f.write(f"# {FAKE_NOTE}\n")
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    # iterations.json (UI_SPEC.md section 3 shape; a pending ask to B): each version is a fake-model variant.
    mean = lambda c, k: sum(f[k] for f in dev_means[c]) / len(dev_means[c])
    farmer, hind = mean("farmer", "reward"), mean("hindsight", "reward")
    versions = [("v1", "single agent, one prompt", "single"), ("v2", "five agents, no critic", "multi_no_critic"),
                ("v3", "added critic (objection skips the dose)", "v3_skip"),
                ("v4", "critic splits the dose after the rain", "v4_no_irr_outlook"),
                ("v5", "irrigation waits for forecast rain", "multi")]
    iterations = [{"version": v, "change": change, "dev_reward_mean": round(mean(c, "reward"), 1),
                   "dev_gap_closed": round((mean(c, "reward") - farmer) / (hind - farmer), 3),
                   "dev_leached_mean": round(mean(c, "n_leached"), 1), "fake": True} for v, change, c in versions]
    (out / "results" / "iterations.json").write_text(json.dumps(iterations, indent=1))

    # vllm_metrics.json, STATE.md contract shape. No model size claim on purpose.
    rng = random.Random(f"vllm:{seed}")
    metrics = {"vllm_version": "FAKE", "model": "FAKE placeholder model", "measured_at": "2026-10-17T12:00:00+00:00",
               "rows": [{"parallel": p, "seasons_per_hour": round(sph * rng.uniform(0.9, 1.1), 1),
                         "p50_ms": round(p50 * rng.uniform(0.9, 1.1)), "p99_ms": round(p50 * rng.uniform(2.4, 3.2)),
                         "prefix_cache_hit_rate": round(hit, 3)}
                        for p, sph, p50, hit in ((1, 14, 420, 0.62), (8, 92, 610, 0.81), (32, 240, 1150, 0.88))],
               "fake": True, "note": FAKE_NOTE}
    (out / "results" / "vllm_metrics.json").write_text(json.dumps(metrics, indent=1))

    (out / "README.md").write_text(
        f"# ui/fake/: FAKE data\n\n{FAKE_NOTE}\n\nRegenerate: `uv run python -m lanec.scripts.fake_logs --ui`.\n"
        "Open the UI with `?fake=1` to read this tree instead of the repo's runs/, data/ and results/.\n")
    print(f"FAKE ui tree: {out} ({len(rows)} eval rows; logs {sorted(index)} x {list(UI_LOG_YEARS)})")
    for year in UI_LOG_YEARS:
        got = {r["config"]: r for r in rows if r["year"] == year}
        print(f"  {year}: " + "  ".join(f"{c} reward {got[c]['reward']:.0f} leached {got[c]['n_leached']:.1f}"
                                         for c in ("farmer", "multi", "hindsight")))



def main() -> None:
    ap = argparse.ArgumentParser(description="Write FAKE logs for UI work (runs/fake_multi/ or, with --ui, ui/fake/).")
    ap.add_argument("--task-id", default="UFGA-s1")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--env-url", default=None, help="running env server (default: in-process toy sim)")
    ap.add_argument("--ui", action="store_true", help="write the FAKE ui/fake/ tree instead (UI_SPEC.md section 4)")
    args = ap.parse_args()
    if args.ui:
        write_ui_fake(args.seed)
        return

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
