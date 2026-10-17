"""Bridge the async Nemotron team to the shared synchronous Policy interface."""
from __future__ import annotations

import asyncio
import os

import httpx

from agents.policies.base import Decision, Policy
from fieldtwin_agents.agents import AGENT_PROTOCOL_VERSION, AgentTeam, PolicyFailure
from fieldtwin_agents.clients import MODEL, VLLMClient
from fieldtwin_agents.contracts import number
from fieldtwin_agents.runner import prompt_hashes
from fieldtwin_agents.stub import StubModel
from fieldtwin_agents.management import farmer_fallback


class AsyncTools:
    """httpx.Client is shared by a season; offload blocking read calls concurrently."""

    def __init__(self, env):
        self.env = env

    async def tool(self, name, episode_id):
        return await asyncio.to_thread(self.env.tool, name, episode_id)


class LogAdapter:
    def __init__(self, log):
        self.log = log

    def emit(self, week, agent, kind, data):
        self.log.event(week, agent, kind, data)


class CountedModel:
    def __init__(self, model, log):
        self.model, self.log = model, log

    async def complete(self, messages, tools):
        self.log.llm_calls += 1
        return await self.model.complete(messages, tools)


class NemotronPolicy(Policy):
    """Each instance is owned by one season, including in eval's thread pool."""

    decision_agent = "coordinator"

    def __init__(self, config=None):
        if config is None:
            from agents.run import load_config
            config = load_config()
        self.config = config
        settings = config.get("agents", {})
        self.backend = os.environ.get("FIELDTWIN_MODEL_BACKEND", settings.get("backend", "vllm"))
        if self.backend not in ("vllm", "stub"):
            raise ValueError("agents.backend must be vllm or stub")
        self.base_url = os.environ.get(settings.get("base_url_env", "VLLM_BASE_URL")) or "http://localhost:8000/v1"
        self.model_name = os.environ.get(settings.get("model_env", "VLLM_MODEL")) or MODEL
        self.prompt_version = settings.get("prompt_version", "v1")
        self.hashes = prompt_hashes(self.prompt_version)
        self.n_cap = number(config["env"]["max_n_kg_ha_per_season"])
        self.max_n = number(config["env"]["max_n_kg_ha_per_week"])
        self.max_irr = number(config["env"]["max_irr_mm_per_week"])
        if min(self.n_cap, self.max_n, self.max_irr) < 0:
            raise ValueError("Action limits must be nonnegative")
        frozen_path = settings.get("freeze_manifest")
        if frozen_path:
            import json
            from agents.run import ROOT
            frozen = json.loads((ROOT / frozen_path).read_text(encoding="utf-8"))
            if frozen["prompt_hashes"] != self.hashes or frozen["prompt_version"] != self.prompt_version:
                raise ValueError("Prompts differ from freeze manifest")

    async def _decide(self, episode_id, week, obs, env, log, remaining):
        # New client per synchronous invocation avoids sharing an AsyncClient across
        # event loops. Within a week all parallel roles share the same client.
        model = StubModel() if self.backend == "stub" else VLLMClient(self.base_url, self.model_name)
        try:
            team = AgentTeam(CountedModel(model, log), AsyncTools(env), self.name, self.prompt_version)
            return await team.decide(obs, episode_id, week, remaining, LogAdapter(log))
        finally:
            await model.close()

    def decide(self, episode_id, week, obs, env, log):
        applied = number(obs["n_applied_total"])
        remaining = max(0.0, self.n_cap - applied)
        if week == 0:
            log.event(week, "coordinator", "message", {
                "agent_protocol_version": AGENT_PROTOCOL_VERSION,
                "model_backend": self.backend, "model": self.model_name if self.backend == "vllm" else "StubModel",
                "synthetic_model": self.backend == "stub", "simulator": self.config["env"]["simulator"],
                "prompt_version": self.prompt_version, "prompt_hashes": self.hashes,
                "n_cap": self.n_cap,
            })
        try:
            action = asyncio.run(self._decide(episode_id, week, obs, env, log, remaining))
        except (PolicyFailure, httpx.HTTPError) as exc:
            # Same management as the shared farmer policy, including adaptive irrigation.
            # Current obs contains the same soil-water fraction without an extra model tool.
            action = farmer_fallback(week, obs)
            log.event(week, "coordinator", "fallback", {"cause": str(exc), "schedule_action": action.as_dict()})
        guarded = action.guarded(remaining, self.max_n, self.max_irr)
        if guarded != action:
            log.event(week, "coordinator", "message", {"guarded": True, "proposed": action.as_dict(), "applied": guarded.as_dict()})
        return Decision(guarded.n_kg_ha, guarded.irr_mm, guarded.reason)
