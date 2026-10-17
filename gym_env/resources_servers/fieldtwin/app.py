"""FieldTwin as a NeMo Gym environment (gymnasium style, for gymnasium_agent).

A thin adapter over the FieldTwin env server (env/server.py, HTTP on port 9000),
so NeMo Gym scores exactly what our own eval scores:
  reset()  -> POST /reset with the row's task_id, site, year
  step()   -> each function call the model makes:
                get_weather / get_crop_state / get_soil / get_history / get_budget -> GET /tool/<name>
                submit_decision(n_kg_ha, irr_mm, reason)                        -> POST /step
  verifier -> when the season ends, the step reward is the env's final `reward`
              (profit minus the leaching penalty, USD/ha); every other step is 0.
A response with no tool call gets a reminder; the agent's max_steps truncates a
season that never finishes (reward 0).

Runs inside NeMo Gym's per-server venv, launched by `gym env start` / `gym eval run`.
"""

import json
from typing import Optional

import httpx

from nemo_gym.openai_utils import NeMoGymResponse
from resources_servers.gymnasium import GymnasiumServer

READ_TOOLS = {"get_weather", "get_crop_state", "get_soil", "get_history", "get_budget"}
REMINDER = ("Call a tool: read with get_weather, get_crop_state, get_soil, get_history or get_budget, "
            "then call submit_decision(n_kg_ha, irr_mm, reason) once for this week.")


class FieldTwinEnv(GymnasiumServer):
    env_url: str = "http://localhost:9000"
    timeout_s: float = 300.0

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.env_url, timeout=self.timeout_s)

    async def reset(self, metadata: dict, session_id: Optional[str] = None) -> tuple[Optional[str], dict]:
        body = {"task_id": metadata["task_id"], "site": metadata["site"], "year": int(metadata["year"])}
        async with self._client() as client:
            r = await client.post("/reset", json=body)
            r.raise_for_status()
            reset = r.json()
        self.session_state[session_id] = {"episode_id": reset["episode_id"], "week": 0, "tool_calls": 0}
        return f"Week 0 observation: {json.dumps(reset['obs'])}", {}

    async def step(
        self, action: NeMoGymResponse, metadata: dict, session_id: Optional[str] = None
    ) -> tuple[Optional[str], float, bool, bool, dict]:
        state = self.session_state[session_id]
        calls = [o for o in action.output if o.type == "function_call"]
        if not calls:
            return REMINDER, 0.0, False, False, {}

        outputs = []
        async with self._client() as client:
            for call in calls:
                state["tool_calls"] += 1
                result, final = await self._run_call(client, state, call)
                outputs.append(self.tool_output(call, result))
                if final is not None:   # season over: the verifier's reward is the env's final reward
                    info = {"tool_outputs": outputs, "final": final, "task_id": metadata.get("task_id"),
                            "year": metadata.get("year"), "weeks": state["week"], "tool_calls": state["tool_calls"]}
                    return None, float(final["reward"]), True, False, info
        return None, 0.0, False, False, {"tool_outputs": outputs}

    async def _run_call(self, client: httpx.AsyncClient, state: dict, call) -> tuple[object, Optional[dict]]:
        """Run one function call against the env server. Returns (tool result, final dict or None)."""
        try:
            args = json.loads(call.arguments or "{}")
        except json.JSONDecodeError as e:
            return {"error": f"arguments are not valid JSON: {e}"}, None

        if call.name in READ_TOOLS:
            r = await client.get(f"/tool/{call.name}", params={"episode_id": state["episode_id"]})
            return r.json(), None
        if call.name == "submit_decision":
            try:
                n, irr = float(args["n_kg_ha"]), float(args["irr_mm"])
            except (KeyError, TypeError, ValueError):
                return {"error": "submit_decision needs numbers n_kg_ha and irr_mm (and a short reason)"}, None
            body = {"episode_id": state["episode_id"], "n_kg_ha": n, "irr_mm": irr, "reason": str(args.get("reason", ""))}
            r = await client.post("/step", json=body)
            if r.status_code != 200:
                return r.json(), None
            step = r.json()
            state["week"] = step["week"]
            return step, step.get("final") if step["done"] else None
        return {"error": f"unknown tool {call.name!r}; valid: {sorted(READ_TOOLS | {'submit_decision'})}"}, None


if __name__ == "__main__":
    FieldTwinEnv.run_webserver()
