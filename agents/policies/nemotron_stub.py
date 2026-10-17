"""Placeholder for teammate B (Nemotron agents via vLLM + agents/tools.json)."""

from agents.policies.base import Policy


class NemotronStub(Policy):
    name = "nemotron_stub"

    def decide(self, episode_id, week, obs, env, log):
        raise NotImplementedError("B: implement Nemotron agents here; see agents/tools.json")
