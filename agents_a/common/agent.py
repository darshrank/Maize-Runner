"""One role-agent turn: a Nemotron call loop with that role's tools, ending in its answer tool.

Each role gets its own system prompt, its own read tools (executed against the env server and
logged under the role's name), and one "answer" tool whose arguments are the role's structured
output (e.g. weather_report, propose_plan). Returns the answer arguments, or None if the model
fails (no tool call twice in a row, bad arguments, too many calls, or a model error); the caller
decides the fallback.
"""

import json

from agents_a.common.season import compact

READ_TOOLS = {"get_weather", "get_crop_state", "get_soil", "get_history", "get_budget"}


def function_tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required}}}


def run_role(policy, llm, role: str, system: str, user: str, read_tools: list[dict], answer_tool: dict,
             episode_id: str, week: int, env, log, max_turns: int = 6, max_bad: int = 2) -> dict | None:
    answer_name = answer_tool["function"]["name"]
    tools = read_tools + [answer_tool]
    allowed = {t["function"]["name"] for t in read_tools}
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    bad = 0
    for _ in range(max_turns):
        try:
            msg = llm.chat(messages, tools=tools, log=log, week=week, agent=role)
        except Exception as e:
            log.event(week, role, "message", {"text": f"model error: {type(e).__name__}"})
            return None
        calls = msg.get("tool_calls") or []
        if not calls:
            bad += 1
            if bad >= max_bad:
                return None
            messages += [{"role": "assistant", "content": msg.get("content") or ""},
                         {"role": "user", "content": f"Answer by calling {answer_name}."}]
            continue
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            name, raw = call["function"]["name"], call["function"].get("arguments") or "{}"
            if name == answer_name:
                try:
                    args = json.loads(raw)
                    missing = [k for k in answer_tool["function"]["parameters"]["required"] if k not in args]
                    if not missing:
                        return args
                    result = {"error": f"missing fields: {missing}"}
                except json.JSONDecodeError:
                    result = {"error": "arguments are not valid JSON"}
                bad += 1
            elif name in allowed and name in READ_TOOLS:
                result = policy.call_tool(name, episode_id, week, env, log, agent=role)
                bad = 0
            else:
                bad += 1
                result = {"error": f"tool {name} is not available to the {role} agent"}
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": compact(result)})
        if bad >= max_bad:
            return None
    return None
