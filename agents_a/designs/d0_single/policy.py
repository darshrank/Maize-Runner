"""d0_single: ONE Nemotron agent with all tools decides each week (the "one model" baseline).

Each week the agent gets the system prompt plus a short season summary, calls read tools as it
likes, and must end with submit_decision. Code guard: clamp in code; two malformed turns in a row,
no decision within MAX_TURNS, or a model error -> farmer-practice fallback for that week (logged).
"""

import json
from pathlib import Path

import yaml

from agents.policies.base import Decision, Policy
from agents_a.common.guard import clamp, fallback
from agents_a.common.llm import ROOT, LLM
from agents_a.common.season import compact, history_table, week_header

HERE = Path(__file__).resolve().parent
READ_TOOLS = {"get_weather", "get_crop_state", "get_soil", "get_history", "get_budget"}
MAX_TURNS = 8        # model calls per week
MAX_BAD = 2          # malformed turns in a row before falling back


def system_prompt() -> str:
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    env, prices = cfg["env"], cfg["prices"]
    return (HERE / "prompts" / "system.md").read_text().format(
        maize=prices["maize_usd_per_kg"], n_price=prices["n_usd_per_kg"], water=prices["water_usd_per_mm_ha"],
        leach=cfg["reward"]["leach_penalty_usd_per_kg"], max_n_week=env["max_n_kg_ha_per_week"],
        max_n_season=env["max_n_kg_ha_per_season"], max_irr=env["max_irr_mm_per_week"])


class SingleAgent(Policy):
    name = "a_d0_single"

    def __init__(self):
        self.llm = LLM()
        self.system = system_prompt()
        self.tools = json.loads((ROOT / "agents" / "tools.json").read_text())

    def decide(self, episode_id, week, obs, env, log):
        history = self.call_tool("get_history", episode_id, week, env, log)
        messages = [{"role": "system", "content": self.system},
                    {"role": "user", "content": f"{week_header(week, obs)}\nRecent weeks:\n"
                                                f"{history_table(history if isinstance(history, list) else [])}\n"
                                                f"Decide week {week}."}]
        bad = 0
        for _ in range(MAX_TURNS):
            try:
                msg = self.llm.chat(messages, tools=self.tools, log=log, week=week)
            except Exception as e:  # server down, timeout: never crash the season
                return fallback(week, f"model error: {type(e).__name__}", log)
            calls = msg.get("tool_calls") or []
            if not calls:
                bad += 1
                if bad >= MAX_BAD:
                    return fallback(week, "no tool call twice in a row", log)
                messages += [{"role": "assistant", "content": msg.get("content") or ""},
                             {"role": "user", "content": "Call a tool. End with submit_decision(n_kg_ha, irr_mm, reason)."}]
                continue
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for call in calls:
                name, raw = call["function"]["name"], call["function"].get("arguments") or "{}"
                if name == "submit_decision":
                    try:
                        args = json.loads(raw)
                        n, irr = clamp(args["n_kg_ha"], args["irr_mm"], obs["n_applied_total"])
                        return Decision(n, irr, str(args.get("reason", ""))[:300])
                    except (ValueError, KeyError, TypeError):
                        bad += 1
                        result = {"error": "submit_decision needs numbers n_kg_ha and irr_mm and a reason"}
                elif name in READ_TOOLS:
                    result = self.call_tool(name, episode_id, week, env, log)
                    bad = 0
                else:
                    bad += 1
                    result = {"error": f"unknown tool {name}"}
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": compact(result)})
            if bad >= MAX_BAD:
                return fallback(week, "malformed tool calls twice in a row", log)
        return fallback(week, f"no decision within {MAX_TURNS} model calls", log)
