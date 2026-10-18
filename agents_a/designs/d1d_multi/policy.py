"""d1d_multi: d1c_multi with the Planner split into two independent specialists (see README.md).

Week flow:
  Weather (get_weather) + Crop (get_crop_state, get_soil)                    in parallel -> reports
  -> Nitrogen agent (get_budget, get_history)  -> propose_nitrogen           \\ in parallel
  -> Water agent (water_balance, get_soil)     -> propose_irrigation         /
  -> Critic reviews both together (incl. N/water clashes) -> accept | object (target nitrogen/water/both)
  -> the targeted agent(s) revise once
  -> Coordinator: submit_decision + one-line reason
Same sourced agronomy in every role as d1c_multi. Code guard: clamp in code; a failed Nitrogen agent -> this week's
farmer-practice N, a failed Water agent -> the water-balance suggestion (both logged as fallbacks).
"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

from agents.policies.base import Decision, Policy
from agents.policies.farmer_ufga import N_BY_WEEK
from agents_a.common.agent import function_tool, run_role
from agents_a.common.guard import clamp
from agents_a.common.llm import ROOT, LLM
from agents_a.common.season import week_header
from agents_a.common.water import water_balance
from agents_a.designs.d1_multi.policy import CROP_REPORT, WEATHER_REPORT

HERE = Path(__file__).resolve().parent
AGRONOMY = (HERE.parents[1] / "common" / "agronomy.md").read_text()
ROLES = ("weather", "crop", "nitrogen", "water", "critic", "coordinator")

PROPOSE_N = function_tool("propose_nitrogen", "Propose this week's nitrogen.", {
    "n_kg_ha": {"type": "number", "description": "kg N/ha this week (0-120)"}, "reason": {"type": "string"}},
    ["n_kg_ha", "reason"])
PROPOSE_IRR = function_tool("propose_irrigation", "Propose this week's irrigation.", {
    "irr_mm": {"type": "number", "description": "irrigation mm this week (0-50)"}, "reason": {"type": "string"}},
    ["irr_mm", "reason"])
REVIEW = function_tool("review_plan", "Accept both proposals or raise one objection.", {
    "verdict": {"type": "string", "enum": ["accept", "object"]},
    "target": {"type": "string", "enum": ["nitrogen", "water", "both"]},
    "objection": {"type": "string", "description": "the problem and what to change (empty if accept)"}},
    ["verdict"])
WATER_BALANCE = function_tool("water_balance", "Crop water use (last and next 7 days, from temperature and growth "
                              "stage), rain last 7 days and forecast, soil water, and a suggested irrigation with its cost.",
                              {}, [])


def load_prompts() -> dict[str, str]:
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    env, prices = cfg["env"], cfg["prices"]
    fmt = dict(maize=prices["maize_usd_per_kg"], n_price=prices["n_usd_per_kg"], water=prices["water_usd_per_mm_ha"],
               leach=cfg["reward"]["leach_penalty_usd_per_kg"], max_n_week=env["max_n_kg_ha_per_week"],
               max_n_season=env["max_n_kg_ha_per_season"], max_irr=env["max_irr_mm_per_week"])
    context = (HERE / "prompts" / "context.md").read_text().format(**fmt)
    return {r: f"{context}\n{AGRONOMY}\n{(HERE / 'prompts' / f'{r}.md').read_text().format(**fmt)}" for r in ROLES}


class MultiAgentD(Policy):
    name = "a_d1d_multi"

    def __init__(self):
        self.llm = LLM()
        self.prompts = load_prompts()
        tools = {t["function"]["name"]: t for t in json.loads((ROOT / "agents" / "tools.json").read_text())}
        self.read = lambda *names: [tools[n] for n in names]
        self.submit = tools["submit_decision"]
        self.irr_price = yaml.safe_load((ROOT / "config.yaml").read_text())["prices"]["water_usd_per_mm_ha"]

    def decide(self, episode_id, week, obs, env, log):
        header = week_header(week, obs)
        site = log.task_id.split("-")[0]
        role = lambda name, user, read, answer, **kw: run_role(
            self, self.llm, name, self.prompts[name], user, read, answer, episode_id, week, env, log, **kw)

        def balance() -> dict:
            get = lambda n: self.call_tool(n, episode_id, week, env, log, agent="water")
            return water_balance(site, get("get_weather"), get("get_crop_state"), get("get_soil"), self.irr_price)
        water_tools = {"water_balance": (WATER_BALANCE, balance)}

        # 1. Specialists report, in parallel.
        with ThreadPoolExecutor(max_workers=2) as pool:
            w = pool.submit(role, "weather", f"{header}\nReport the weather.", self.read("get_weather"), WEATHER_REPORT)
            c = pool.submit(role, "crop", f"{header}\nReport the crop.", self.read("get_crop_state", "get_soil"), CROP_REPORT)
            weather, crop = w.result(), c.result()
        reports = (f"Weather report: {json.dumps(weather) if weather else 'unavailable'}\n"
                   f"Crop report: {json.dumps(crop) if crop else 'unavailable'}")

        # 2. Nitrogen and Water agents propose, in parallel.
        def nitrogen(extra=""):
            return role("nitrogen", f"{header}\n{reports}\n{extra}Propose week {week}'s nitrogen.",
                        self.read("get_budget", "get_history"), PROPOSE_N)

        def water(extra=""):
            return role("water", f"{header}\n{reports}\n{extra}Propose week {week}'s irrigation.",
                        self.read("get_soil"), PROPOSE_IRR, local_tools=water_tools)
        with ThreadPoolExecutor(max_workers=2) as pool:
            n_fut, w_fut = pool.submit(nitrogen), pool.submit(water)
            n_plan, w_plan = n_fut.result(), w_fut.result()
        if n_plan is None:
            n_plan = {"n_kg_ha": N_BY_WEEK.get(week, 0.0), "reason": "farmer schedule (nitrogen agent failed)"}
            log.event(week, "coordinator", "fallback", {"reason": "nitrogen agent failed", **n_plan})
        if w_plan is None:
            suggestion = balance()["suggested_irrigation_mm"]
            w_plan = {"irr_mm": suggestion, "reason": "water-balance suggestion (water agent failed)"}
            log.event(week, "coordinator", "fallback", {"reason": "water agent failed", **w_plan})

        # 3. Critic reviews both together; 4. targeted agent(s) revise once.
        plans = f"Nitrogen proposal: {json.dumps(n_plan)}\nWater proposal: {json.dumps(w_plan)}"
        review = role("critic", f"{header}\n{reports}\n{plans}\nReview both together.",
                      self.read("get_budget", "get_soil"), REVIEW) or {"verdict": "accept", "objection": "critic unavailable"}
        if review.get("verdict") == "object":
            note = f"Critic objection: {review.get('objection', '')}\nYour previous proposal: "
            target = review.get("target", "both")
            if target in ("nitrogen", "both"):
                n_plan = nitrogen(note + json.dumps(n_plan) + "\nRevise. ") or n_plan
            if target in ("water", "both"):
                w_plan = water(note + json.dumps(w_plan) + "\nRevise. ") or w_plan
            plans = f"Nitrogen proposal: {json.dumps(n_plan)}\nWater proposal: {json.dumps(w_plan)}"

        # 5. Coordinator decides.
        final = role("coordinator", f"{header}\n{reports}\n{plans}\nCritic review: {json.dumps(review)}\n"
                                    "Make the final call.", [], self.submit)
        chosen = final or {"n_kg_ha": n_plan.get("n_kg_ha", 0), "irr_mm": w_plan.get("irr_mm", 0),
                           "reason": f"{n_plan.get('reason', '')} {w_plan.get('reason', '')}".strip()}
        try:
            n, irr = clamp(chosen["n_kg_ha"], chosen["irr_mm"], obs["n_applied_total"])
        except (KeyError, TypeError, ValueError):
            n, irr = clamp(n_plan.get("n_kg_ha", 0), w_plan.get("irr_mm", 0), obs["n_applied_total"])
        return Decision(n, irr, str(chosen.get("reason", ""))[:300])
