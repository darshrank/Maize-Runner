"""Scripted stand-in for the vLLM server, so NeMo Gym can score a policy end to end without a GPU.

  uv run python gym_env/dummy_policy.py          # OpenAI-compatible endpoint on http://localhost:8001/v1

It answers /v1/chat/completions like vLLM does (tool calls, no text), playing the farmer
baseline: each week call get_soil, then submit_decision with 60/60/40 kg N/ha at weeks
0/5/9 and 25 mm irrigation when soil_water_frac < 0.35. NeMo Gym's `vllm_model` talks to it
exactly as it would to the real Nemotron server; only --model-url changes.
"""

import json
import time
import uuid

import uvicorn
from fastapi import FastAPI

MODEL = "fieldtwin-farmer-script"
N_SCHEDULE = {0: 60.0, 5: 60.0, 9: 40.0}
DRY_FRAC, IRR_MM = 0.35, 25.0

app = FastAPI(title="FieldTwin scripted policy (fake vLLM)")


def decide(messages: list[dict]) -> tuple[str, dict]:
    """Next tool call from the conversation so far: (name, arguments)."""
    call_names = {}       # tool_call id -> function name
    week = 0              # submit_decision calls so far = current week
    for m in messages:
        for tc in m.get("tool_calls") or []:
            call_names[tc["id"]] = tc["function"]["name"]
            week += tc["function"]["name"] == "submit_decision"
    last = messages[-1] if messages else {}
    if last.get("role") == "tool" and call_names.get(last.get("tool_call_id")) == "get_soil":
        try:
            soil = json.loads(last["content"] if isinstance(last["content"], str) else last["content"][0]["text"])
            dry = soil["soil_water_frac"] < DRY_FRAC
        except (KeyError, IndexError, TypeError, ValueError):
            dry = False
        n = N_SCHEDULE.get(week, 0.0)
        irr = IRR_MM if dry else 0.0
        return "submit_decision", {"n_kg_ha": n, "irr_mm": irr,
                                   "reason": f"farmer schedule week {week}: {n:g} kg N, {irr:g} mm"}
    return "get_soil", {}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "fieldtwin"}]}


@app.post("/v1/chat/completions")
def chat_completions(body: dict):
    name, args = decide(body.get("messages", []))
    call = {"id": f"call_{uuid.uuid4().hex[:12]}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}}
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.get("model", MODEL),
        "choices": [{"index": 0, "finish_reason": "tool_calls",
                     "message": {"role": "assistant", "content": None, "tool_calls": [call]}}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")
