from __future__ import annotations

import os
import json
from functools import lru_cache
from pathlib import Path
import httpx

from .contracts import TOOLS

MODEL = "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"
INFERENCE_SETTINGS = {"temperature": 1.0, "top_p": 0.95, "max_tokens": 2048,
                      "chat_template_kwargs": {"enable_thinking": False, "force_nonempty_content": True}}


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


def inference_settings(enable_thinking=False, max_tokens=None):
    """Thinking output counts against max_tokens, so thinking runs need a declared larger cap."""
    settings = json.loads(json.dumps(INFERENCE_SETTINGS))
    settings["chat_template_kwargs"]["enable_thinking"] = bool(enable_thinking)
    if max_tokens is not None:
        if int(max_tokens) <= 0:
            raise ValueError("max_tokens must be positive")
        settings["max_tokens"] = int(max_tokens)
    return settings


class VLLMClient:
    synthetic = False
    inference_settings = INFERENCE_SETTINGS

    def __init__(self, base_url, model=MODEL, *, transport=None, settings=None):
        if settings is not None:
            self.inference_settings = settings
        self.model = model
        key = os.environ.get("VLLM_API_KEY")
        thinking = self.inference_settings["chat_template_kwargs"]["enable_thinking"]
        # max_tokens bounds healthy generation; the timeout only catches hung connections.
        self.request_timeout_s = 1800 if thinking else 180
        self.http = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/", timeout=self.request_timeout_s,
                                      headers={"Authorization": f"Bearer {key}"} if key else {},
                                      transport=transport)

    async def complete(self, messages, tools):
        payload = {"model": self.model, "messages": messages, **self.inference_settings}
        if tools:
            payload.update(tools=[tool_schema(t) for t in tools], tool_choice="auto")
        r = await self.http.post("chat/completions", json=payload)
        r.raise_for_status()
        try:
            envelope = r.json()
            choice = envelope["choices"][0]
            message = choice["message"]
            if not isinstance(message, dict):
                return {"content": ""}
            reasoning = message.get("reasoning") or message.get("reasoning_content")
            telemetry = {"usage": envelope.get("usage"), "finish_reason": choice.get("finish_reason"),
                         "response_model": envelope.get("model"), "system_fingerprint": envelope.get("system_fingerprint")}
            if reasoning:
                telemetry["reasoning"] = reasoning
            # Reasoning is recorded for audit only; it is never sent onward as evidence.
            return {k: v for k, v in message.items() if k not in ("reasoning", "reasoning_content")} | {"_telemetry": telemetry}
        except (ValueError, KeyError, IndexError, TypeError):
            # Route malformed API envelopes through the same two-attempt policy guard.
            return {"content": ""}

    async def close(self):
        await self.http.aclose()
