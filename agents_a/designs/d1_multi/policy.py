"""d1_multi: a team of Nemotron agents (one model, five roles) decides each week.

Week flow (see README.md):
  Weather (get_weather) and Crop (get_crop_state, get_soil) in parallel -> structured reports
  -> Planner (get_history, get_budget) proposes N and irrigation
  -> Critic (get_budget, get_soil) accepts or returns one objection
  -> Planner revises once if objected
  -> Coordinator makes the final call with submit_decision and a one-line reason.
Code guard: clamp in code; Planner failure -> farmer-practice fallback (logged); a failed specialist
report or Critic is reported as "unavailable"/accept; a failed Coordinator uses the plan.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

from agents.policies.base import Decision, Policy
from agents_a.common.agent import function_tool, run_role
from agents_a.common.guard import clamp, fallback
from agents_a.common.llm import ROOT, LLM
from agents_a.common.season import week_header

HERE = Path(__file__).resolve().parent
LEVEL = {"type": "string", "enum": ["low", "medium", "high"]}

WEATHER_REPORT = function_tool("weather_report", "Report the weather outlook to the team.", {
    "rain_next_3d_mm": {"type": "number"}, "rain_next_7d_mm": {"type": "number"},
    "heavy_rain_risk": LEVEL, "heat_stress": {"type": "boolean"}, "summary": {"type": "string"}},
    ["rain_next_3d_mm", "rain_next_7d_mm", "heavy_rain_risk", "summary"])
CROP_REPORT = function_tool("crop_report", "Report the crop and soil state to the team.", {
    "stage": {"type": "string"}, "n_demand": LEVEL,
    "water_status": {"type": "string", "enum": ["dry", "ok", "wet"]}, "summary": {"type": "string"}},
    ["stage", "n_demand", "water_status", "summary"])
PLAN_FIELDS = {"n_kg_ha": {"type": "number", "description": "kg N/ha this week (0-120)"},
               "irr_mm": {"type": "number", "description": "irrigation mm this week (0-50)"},
               "reason": {"type": "string"}}
PROPOSE_PLAN = function_tool("propose_plan", "Propose this week's nitrogen and irrigation.", PLAN_FIELDS,
                             ["n_kg_ha", "irr_mm", "reason"])
REVIEW_PLAN = function_tool("review_plan", "Accept the plan or raise one objection.", {
    "verdict": {"type": "string", "enum": ["accept", "object"]},
    "objection": {"type": "string", "description": "the problem and what to change (empty if accept)"}},
    ["verdict"])


def load_prompts(prompt_dir: Path = HERE / "prompts") -> dict[str, str]:
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    env, prices = cfg["env"], cfg["prices"]
    context = (prompt_dir / "context.md").read_text().format(
        maize=prices["maize_usd_per_kg"], n_price=prices["n_usd_per_kg"], water=prices["water_usd_per_mm_ha"],
        leach=cfg["reward"]["leach_penalty_usd_per_kg"], max_n_week=env["max_n_kg_ha_per_week"],
        max_n_season=env["max_n_kg_ha_per_season"], max_irr=env["max_irr_mm_per_week"])
    return {role: context + "\n\n" + (prompt_dir / f"{role}.md").read_text()
            for role in ("weather", "crop", "planner", "critic", "coordinator")}


class MultiAgent(Policy):
    name = "a_d1_multi"
    prompt_dir = HERE / "prompts"   # later designs reuse this flow with their own prompts

    def __init__(self):
        self.llm = LLM()
        self.prompts = load_prompts(self.prompt_dir)
        tools = {t["function"]["name"]: t for t in json.loads((ROOT / "agents" / "tools.json").read_text())}
        self.read = lambda *names: [tools[n] for n in names]
        self.submit = tools["submit_decision"]

    def decide(self, episode_id, week, obs, env, log):
        header = week_header(week, obs)
        role = lambda name, user, read, answer, **kw: run_role(
            self, self.llm, name, self.prompts[name], user, read, answer, episode_id, week, env, log, **kw)

        # 1. Specialists in parallel.
        with ThreadPoolExecutor(max_workers=2) as pool:
            w = pool.submit(role, "weather", f"{header}\nReport the weather.", self.read("get_weather"), WEATHER_REPORT)
            c = pool.submit(role, "crop", f"{header}\nReport the crop.", self.read("get_crop_state", "get_soil"), CROP_REPORT)
            weather, crop = w.result(), c.result()
        reports = (f"Weather report: {json.dumps(weather) if weather else 'unavailable'}\n"
                   f"Crop report: {json.dumps(crop) if crop else 'unavailable'}")

        # 2. Planner proposes.
        planner_tools = self.read("get_history", "get_budget")
        plan = role("planner", f"{header}\n{reports}\nPropose week {week}.", planner_tools, PROPOSE_PLAN)
        if plan is None:
            return fallback(week, "planner failed", log, agent="coordinator")

        # 3. Critic reviews; 4. Planner revises once.
        review = role("critic", f"{header}\n{reports}\nPlanner proposal: {json.dumps(plan)}\nReview it.",
                      self.read("get_budget", "get_soil"), REVIEW_PLAN) or {"verdict": "accept", "objection": "critic unavailable"}
        if review.get("verdict") == "object":
            revised = role("planner", f"{header}\n{reports}\nYour proposal: {json.dumps(plan)}\n"
                                      f"Critic objection: {review.get('objection', '')}\nRevise and propose again.",
                           planner_tools, PROPOSE_PLAN)
            plan = revised or plan

        # 5. Coordinator decides.
        final = role("coordinator", f"{header}\n{reports}\nPlanner's final plan: {json.dumps(plan)}\n"
                                    f"Critic review: {json.dumps(review)}\nMake the final call.", [], self.submit)
        chosen = final or plan
        try:
            n, irr = clamp(chosen["n_kg_ha"], chosen["irr_mm"], obs["n_applied_total"])
        except (KeyError, TypeError, ValueError):
            return fallback(week, "no valid final decision", log, agent="coordinator")
        return Decision(n, irr, str(chosen.get("reason", ""))[:300])
