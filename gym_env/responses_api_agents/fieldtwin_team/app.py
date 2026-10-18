"""NeMo Gym agent server for the FieldTwin multi-agent team (the d1c_multi design).

Runs the five-role team inside NeMo Gym, so `gym eval run` scores it against the same
FieldTwin environment and verifier as any other agent:
  - every role (Weather, Crop, Planner, Critic, Coordinator) calls the policy model through
    NeMo Gym's model server (/v1/responses);
  - every simulator tool call and the weekly submit_decision go through the fieldtwin resources
    server's /step, whose final reward is the score.
Prompts, answer schemas and the farmer-practice fallback are imported from the repo
(agents_a/designs/d1c_multi, d1_multi), so this is the same team as the evaluated design.

Week flow: Weather + Crop in parallel -> Planner -> Critic -> (revise once if objected) -> Coordinator
-> code guard (clamp) -> submit_decision. Planner failure -> farmer-practice action (counted as a fallback).
"""

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))  # FieldTwin repo root: prompts, schemas, fallback schedule

import yaml  # noqa: E402
from fastapi import Body, Request, Response  # noqa: E402
from pydantic import ConfigDict, Field  # noqa: E402

from nemo_gym.base_resources_server import BaseRunRequest  # noqa: E402
from nemo_gym.base_responses_api_agent import BaseResponsesAPIAgentConfig, SimpleResponsesAPIAgent  # noqa: E402
from nemo_gym.config_types import ModelServerRef, ResourcesServerRef  # noqa: E402
from nemo_gym.openai_utils import NeMoGymResponse, NeMoGymResponseCreateParamsNonStreaming  # noqa: E402
from nemo_gym.server_utils import get_response_json, raise_for_status  # noqa: E402
from responses_api_agents.gymnasium_agent.app import GymnasiumRunResponse  # noqa: E402

from agents.policies.farmer_ufga import IRR_BY_WEEK, N_BY_WEEK  # noqa: E402
from agents_a.common.season import week_header  # noqa: E402
from agents_a.designs.d1_multi.policy import (  # noqa: E402
    CROP_REPORT, PROPOSE_PLAN, REVIEW_PLAN, WEATHER_REPORT, load_prompts)
from agents_a.designs.d1c_multi.policy import AGRONOMY  # noqa: E402

PROMPT_DIR = REPO / "agents_a" / "designs" / "d1c_multi" / "prompts"
READ_TOOLS = {"get_weather", "get_crop_state", "get_soil", "get_history", "get_budget"}


def responses_tool(chat_tool: dict) -> dict:
    """Chat Completions tool schema -> Responses API schema."""
    return {"type": "function", **chat_tool["function"], "strict": False}


def team_prompts() -> dict[str, str]:
    """d1c_multi's prompts: team context + sourced agronomy + role instructions (as in MultiAgentC)."""
    return {role: text.replace("\n\nYou are", f"\n{AGRONOMY}\nYou are", 1)
            for role, text in load_prompts(PROMPT_DIR).items()}


class FieldTwinTeamAgentConfig(BaseResponsesAPIAgentConfig):
    resources_server: ResourcesServerRef
    model_server: ModelServerRef
    max_weeks: int = Field(30, ge=1)
    max_turns_per_role: int = Field(6, ge=1)


class FieldTwinTeamRunRequest(BaseRunRequest):
    model_config = ConfigDict(extra="allow")


class _Rollout:
    """Per-rollout state: env session cookies, the dataset row, counters, last model response."""

    def __init__(self, row: dict, env_cookies: dict):
        self.row, self.env_cookies, self.model_cookies = row, env_cookies, None
        self.llm_calls, self.fallbacks = 0, 0
        self.last_response: Optional[NeMoGymResponse] = None


class FieldTwinTeamAgent(SimpleResponsesAPIAgent):
    config: FieldTwinTeamAgentConfig

    def model_post_init(self, context: Any) -> None:
        super().model_post_init(context)
        self._prompts = team_prompts()
        tools = json.loads((REPO / "agents" / "tools.json").read_text())
        self._tools = {t["function"]["name"]: responses_tool(t) for t in tools}
        cfg = yaml.safe_load((REPO / "config.yaml").read_text())["env"]
        self._limits = (cfg["max_n_kg_ha_per_week"], cfg["max_irr_mm_per_week"], cfg["max_n_kg_ha_per_season"])

    async def responses(self, request: Request, response: Response,
                        body: NeMoGymResponseCreateParamsNonStreaming = Body()) -> NeMoGymResponse:
        r = await self.server_client.post(server_name=self.config.model_server.name, url_path="/v1/responses",
                                          json=body, cookies=request.cookies)
        await raise_for_status(r)
        return NeMoGymResponse.model_validate(await get_response_json(r))

    # ---- model and env calls ----------------------------------------------
    async def _model(self, ro: _Rollout, inputs: list, tools: list[dict]) -> NeMoGymResponse:
        body = {"input": inputs, "tools": tools, "parallel_tool_calls": False, "temperature": 0.0,
                "max_output_tokens": 4096}
        r = await self.server_client.post(server_name=self.config.model_server.name, url_path="/v1/responses",
                                          json=body, cookies=ro.model_cookies)
        await raise_for_status(r)
        ro.model_cookies = r.cookies
        ro.llm_calls += 1
        resp = NeMoGymResponse.model_validate(await get_response_json(r))
        ro.last_response = resp
        return resp

    async def _env_step(self, ro: _Rollout, calls: list[dict]) -> dict:
        """Send function calls to the fieldtwin resources server; returns its step response."""
        response = {"id": f"resp_{uuid.uuid4().hex[:12]}", "created_at": 0, "model": "fieldtwin-team",
                    "object": "response", "output": [{"type": "function_call", **c} for c in calls],
                    "parallel_tool_calls": False, "tool_choice": "auto", "tools": []}
        r = await self.server_client.post(server_name=self.config.resources_server.name, url_path="/step",
                                          json=ro.row | {"response": response}, cookies=ro.env_cookies)
        await raise_for_status(r)
        if r.cookies:
            ro.env_cookies.update(r.cookies)
        return await get_response_json(r)

    # ---- one role: tool loop ending in its answer tool -----------------------
    async def _role(self, ro: _Rollout, name: str, user: str, read: list[str], answer: dict) -> Optional[dict]:
        answer = responses_tool(answer)
        tools = [self._tools[n] for n in read] + [answer]
        required = answer["parameters"]["required"]
        inputs: list = [{"role": "system", "content": self._prompts[name]}, {"role": "user", "content": user}]
        bad = 0
        for _ in range(self.config.max_turns_per_role):
            try:
                resp = await self._model(ro, inputs, tools)
            except Exception:
                return None
            inputs += [item.model_dump(exclude_none=True) for item in resp.output]
            calls = [o for o in resp.output if o.type == "function_call"]
            if not calls:
                bad += 1
                if bad >= 2:
                    return None
                inputs.append({"role": "user", "content": f"Answer by calling {answer['name']}."})
                continue
            env_calls, outputs = [], []
            for c in calls:
                if c.name == answer["name"]:
                    try:
                        args = json.loads(c.arguments or "{}")
                        if all(k in args for k in required):
                            return args
                        outputs.append((c.call_id, {"error": f"missing fields: {[k for k in required if k not in args]}"}))
                    except json.JSONDecodeError:
                        outputs.append((c.call_id, {"error": "arguments are not valid JSON"}))
                    bad += 1
                elif c.name in read:
                    env_calls.append({"call_id": c.call_id, "name": c.name, "arguments": c.arguments or "{}"})
                    bad = 0
                else:
                    outputs.append((c.call_id, {"error": f"tool {c.name} is not available to the {name} agent"}))
                    bad += 1
            if env_calls:
                step = await self._env_step(ro, env_calls)
                inputs += [{"type": "function_call_output", "call_id": o["call_id"], "output": o["output"]}
                           for o in step.get("info", {}).get("tool_outputs", [])]
            inputs += [{"type": "function_call_output", "call_id": cid, "output": json.dumps(out)} for cid, out in outputs]
            if bad >= 2:
                return None
        return None

    # ---- one rollout = one season --------------------------------------------
    async def run(self, request: Request, body: FieldTwinTeamRunRequest) -> GymnasiumRunResponse:
        env_cookies = dict(request.cookies)
        reset = await self.server_client.post(server_name=self.config.resources_server.name, url_path="/reset",
                                              json=body.model_dump(), cookies=env_cookies)
        await raise_for_status(reset)
        if reset.cookies:
            env_cookies.update(reset.cookies)
        observation = (await get_response_json(reset)).get("observation") or ""
        obs = json.loads(observation.split(":", 1)[1])          # "Week 0 observation: {...}"
        ro = _Rollout(body.model_dump(), env_cookies)
        max_n_week, max_irr, max_n_season = self._limits
        week, total, step = 0, 0.0, {"terminated": False, "truncated": True, "info": {}}

        while week < self.config.max_weeks:
            header = week_header(week, obs)
            weather, crop = await asyncio.gather(
                self._role(ro, "weather", f"{header}\nReport the weather.", ["get_weather"], WEATHER_REPORT),
                self._role(ro, "crop", f"{header}\nReport the crop.", ["get_crop_state", "get_soil"], CROP_REPORT))
            reports = (f"Weather report: {json.dumps(weather) if weather else 'unavailable'}\n"
                       f"Crop report: {json.dumps(crop) if crop else 'unavailable'}")
            plan = await self._role(ro, "planner", f"{header}\n{reports}\nPropose week {week}.",
                                    ["get_history", "get_budget"], PROPOSE_PLAN)
            if plan is None:   # fallback: farmer-practice action for this week
                ro.fallbacks += 1
                chosen = {"n_kg_ha": N_BY_WEEK.get(week, 0.0), "irr_mm": IRR_BY_WEEK.get(week, 0.0),
                          "reason": "Fallback to farmer schedule (planner failed)."}
            else:
                review = await self._role(ro, "critic", f"{header}\n{reports}\nPlanner proposal: {json.dumps(plan)}\n"
                                          "Review it.", ["get_budget", "get_soil"], REVIEW_PLAN) \
                    or {"verdict": "accept", "objection": "critic unavailable"}
                if review.get("verdict") == "object":
                    plan = await self._role(ro, "planner", f"{header}\n{reports}\nYour proposal: {json.dumps(plan)}\n"
                                            f"Critic objection: {review.get('objection', '')}\nRevise and propose again.",
                                            ["get_history", "get_budget"], PROPOSE_PLAN) or plan
                final = await self._role(ro, "coordinator", f"{header}\n{reports}\nPlanner's final plan: "
                                         f"{json.dumps(plan)}\nCritic review: {json.dumps(review)}\nMake the final call.",
                                         [], self._submit_schema())
                chosen = final or plan
            # Code guard: clamp in code (weekly limits and the season N cap).
            try:
                n = min(max(float(chosen["n_kg_ha"]), 0.0), max_n_week, max(0.0, max_n_season - obs["n_applied_total"]))
                irr = min(max(float(chosen["irr_mm"]), 0.0), max_irr)
            except (KeyError, TypeError, ValueError):
                ro.fallbacks += 1
                n, irr = N_BY_WEEK.get(week, 0.0), IRR_BY_WEEK.get(week, 0.0)
            args = {"n_kg_ha": round(n, 1), "irr_mm": round(irr, 1), "reason": str(chosen.get("reason", ""))[:300]}
            step = await self._env_step(ro, [{"call_id": f"call_{uuid.uuid4().hex[:12]}", "name": "submit_decision",
                                              "arguments": json.dumps(args)}])
            total += float(step.get("reward", 0.0))
            if step.get("terminated") or step.get("truncated"):
                break
            result = json.loads(step["info"]["tool_outputs"][0]["output"])
            obs, week = result["obs"], result["week"]

        info = dict(step.get("info") or {})
        info.pop("tool_outputs", None)
        info.update({"llm_calls": ro.llm_calls, "fallbacks": ro.fallbacks, "agent": "fieldtwin_team (d1c_multi)"})
        return GymnasiumRunResponse(responses_create_params=body.responses_create_params, response=ro.last_response,
                                    reward=total, terminated=bool(step.get("terminated")),
                                    truncated=not step.get("terminated"), info=info)

    def _submit_schema(self) -> dict:
        """submit_decision in Chat Completions shape (responses_tool converts it)."""
        tool = self._tools["submit_decision"]
        return {"type": "function", "function": {k: v for k, v in tool.items() if k not in ("type", "strict")}}


if __name__ == "__main__":
    FieldTwinTeamAgent.run_webserver()
