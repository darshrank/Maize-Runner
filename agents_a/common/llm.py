"""Minimal OpenAI-compatible chat client for the vLLM server (Nemotron on Brev).

Endpoint and model come from the environment or the repo's .env file:
  VLLM_BASE_URL (default http://localhost:8000/v1), VLLM_MODEL.
Every call is counted in the run log (log.llm_calls) and, with reasoning text cut short,
logged as a `message` event so the UI can show what the agent thought.
"""

import json
import os
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def load_env_file(path: Path = ROOT / ".env") -> None:
    """Read KEY=VALUE lines from .env into os.environ (existing variables win)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


class LLM:
    def __init__(self, temperature: float = 0.0, max_tokens: int = 4096, timeout: float = 180.0):
        load_env_file()
        self.base_url = os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1").rstrip("/")
        self.model = os.environ.get("VLLM_MODEL", "")
        if not self.model:
            raise RuntimeError("VLLM_MODEL is not set (put it in .env, see .env.example)")
        self.temperature, self.max_tokens = temperature, max_tokens
        self.http = httpx.Client(timeout=timeout)

    def chat(self, messages: list[dict], tools: list[dict] | None = None, log=None, week: int = 0,
             agent: str = "policy", tool_choice: str = "auto") -> dict:
        """One chat completion. Returns the assistant message dict (content, tool_calls, reasoning)."""
        body = {"model": self.model, "messages": messages, "temperature": self.temperature,
                "max_tokens": self.max_tokens}
        if tools:
            body["tools"], body["tool_choice"] = tools, tool_choice
        t0 = time.time()
        for attempt in range(3):
            try:
                r = self.http.post(f"{self.base_url}/chat/completions", json=body)
                r.raise_for_status()
                break
            except (httpx.TransportError, httpx.HTTPStatusError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        data = r.json()
        msg = data["choices"][0]["message"]
        if log is not None:
            log.llm_calls += 1
            reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
            log.event(week, agent, "message", {
                "text": msg.get("content") or "",
                "reasoning": reasoning[:600],
                "tool_calls": [{"name": c["function"]["name"], "arguments": c["function"]["arguments"]}
                               for c in msg.get("tool_calls") or []],
                "latency_s": round(time.time() - t0, 2),
                "usage": data.get("usage"),
            })
        return msg

    def close(self) -> None:
        self.http.close()


def parse_json_object(text: str) -> dict | None:
    """First {...} object in a model's text (tolerates code fences and extra words)."""
    if not text:
        return None
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                        return obj if isinstance(obj, dict) else None
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None
