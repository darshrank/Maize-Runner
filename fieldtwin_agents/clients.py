from __future__ import annotations

import os
import json
from functools import lru_cache
from pathlib import Path
import httpx

from .contracts import TOOLS

MODEL = "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"


@lru_cache(maxsize=1)
def tool_schemas():
    """One authoritative schema file shared with the walking skeleton."""
    path = Path(__file__).resolve().parent.parent / "agents" / "tools.json"
    schemas = json.loads(path.read_text(encoding="utf-8"))
    return {schema["function"]["name"]: schema for schema in schemas}


def tool_schema(name):
    return tool_schemas()[name]


class EnvironmentClient:
    """No automatic retries: /step is not specified to be idempotent."""

    synthetic = False

    def __init__(self, base_url, *, transport=None, synthetic=False):
        self.synthetic = synthetic
        self.http = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/", timeout=120, transport=transport)

    async def reset(self, task):
        r = await self.http.post("reset", json=task.reset_body())
        r.raise_for_status()
        return r.json()

    async def tool(self, name, episode_id):
        if name not in TOOLS:
            raise ValueError("Unknown environment tool")
        r = await self.http.get(f"tool/{name}", params={"episode_id": episode_id})
        r.raise_for_status()
        return r.json()

    async def step(self, episode_id, action):
        r = await self.http.post("step", json={"episode_id": episode_id, **action.as_dict()})
        r.raise_for_status()
        return r.json()

    async def close(self):
        await self.http.aclose()


class VLLMClient:
    synthetic = False

    def __init__(self, base_url, model=MODEL, *, transport=None):
        self.model = model
        key = os.environ.get("VLLM_API_KEY")
        self.http = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/", timeout=180,
                                      headers={"Authorization": f"Bearer {key}"} if key else {},
                                      transport=transport)

    async def complete(self, messages, tools):
        payload = {"model": self.model, "messages": messages, "temperature": 1.0,
                   "top_p": 0.95, "max_tokens": 2048,
                   "chat_template_kwargs": {"enable_thinking": False, "force_nonempty_content": True}}
        if tools:
            payload.update(tools=[tool_schema(t) for t in tools], tool_choice="auto")
        r = await self.http.post("chat/completions", json=payload)
        r.raise_for_status()
        try:
            message = r.json()["choices"][0]["message"]
            return message if isinstance(message, dict) else {"content": ""}
        except (ValueError, KeyError, IndexError, TypeError):
            # Route malformed API envelopes through the same two-attempt policy guard.
            return {"content": ""}

    async def close(self):
        await self.http.aclose()
