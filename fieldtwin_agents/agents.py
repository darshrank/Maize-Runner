from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

from .contracts import Action, ROLE_TOOLS

PROMPT_ROOT = Path(__file__).parent / "prompts"
AGENT_PROTOCOL_VERSION = 2


class PolicyFailure(Exception):
    """A bounded policy failure causes a visible weekly farmer fallback."""


@dataclass
class WeekState:
    malformed: int = 0

    def bad(self):
        self.malformed += 1
        if self.malformed >= 2:
            raise PolicyFailure("two consecutive malformed tool calls or responses")


class AgentTeam:
    def __init__(self, model, env, config="multi", prompt_version="v1"):
        self.model, self.env, self.config = model, env, config
        folder = PROMPT_ROOT / prompt_version
        if prompt_version not in ("v1", "v2"):
            raise ValueError("Unknown prompt version")
        self.prompts = {r: (folder / f"{r}.txt").read_text(encoding="utf-8") for r in ROLE_TOOLS}
        self.llm_calls = 0

    def tools_for(self, role):
        if self.config == "multi_no_tools":
            return ()
        tools = ROLE_TOOLS[role]
        if self.config == "multi_no_weather":
            tools = tuple(t for t in tools if t != "get_weather")
        return tools

    async def ask(self, role, context, episode_id, week, log, state, output="message"):
        tools = self.tools_for(role)
        # submit_decision is an output channel, not a read tool or environment step.
        model_tools = (*tools, "submit_decision") if output == "action" else tools
        # System prefix is byte-identical for a given role/version across all seasons.
        if output == "action":
            output_guide = 'Return only {"n_kg_ha":number,"irr_mm":number,"reason":"one line"}, or call submit_decision. No prose or Markdown outside JSON.'
        elif output == "critique":
            output_guide = 'Judge the supplied proposal. Return only {"accept":true,"objection":""} or {"accept":false,"objection":"one concrete objection"}. No tool summary, prose or Markdown outside JSON.'
        else:
            output_guide = "Return the requested short specialist report using the available evidence."
        messages = [{"role": "system", "content": self.prompts[role]},
                    {"role": "user", "content": json.dumps({**context, "output": output,
                     "allowed_read_tools": tools, "output_instructions": output_guide}, allow_nan=False)}]
        read = set()
        for turn in range(6):
            # Readings cannot change within a week; once all assigned reads are
            # present, finish the role instead of allowing another reading cycle.
            request_tools = model_tools
            if read.issuperset(tools):
                request_tools = ("submit_decision",) if output == "action" else ()
            if turn == 5:
                request_tools = ()
                messages.append({"role": "user", "content": "The tool budget is exhausted. Finish now using existing evidence. " + output_guide.replace(", or call submit_decision", "")})
            self.llm_calls += 1
            msg = await self.model.complete(messages, request_tools)
            if not isinstance(msg, dict):
                raise PolicyFailure("model message is not an object")
            calls = msg.get("tool_calls")
            if calls:
                try:
                    if not isinstance(calls, list) or len(calls) > 6:
                        raise ValueError("Expected at most six tool calls")
                    parsed = []
                    ids = set()
                    for call in calls:
                        fn = call["function"]
                        name, call_id = fn["name"], call["id"]
                        log.emit(week, role, "tool_call", {"name": name, "args": fn["arguments"]})
                        if name not in request_tools:
                            raise ValueError(f"Tool {name!r} is not permitted for {role}")
                        if not isinstance(call_id, str) or not call_id or call_id in ids:
                            raise ValueError("Tool call IDs must be unique nonempty strings")
                        ids.add(call_id)
                        args = json.loads(fn["arguments"])
                        if name == "submit_decision":
                            if len(calls) != 1:
                                raise ValueError("submit_decision must be the only call in its batch")
                            action = Action.parse(args)
                            state.malformed = 0
                            log.emit(week, role, "tool_result", {"name": name, "result": action.as_dict()})
                            log.emit(week, role, "message", {"content": json.dumps(action.as_dict())})
                            return action
                        if args != {}:
                            raise ValueError("Read tools take no model arguments; episode is bound by the runner")
                        parsed.append((name, call_id))
                except (ValueError, KeyError, TypeError) as exc:
                    log.emit(week, role, "message", {"validation_error": str(exc)})
                    state.bad()
                    # Invalid batches never execute, and never enter an invalid chat transcript.
                    messages.append({"role": "user", "content": f"Malformed tool call. Available read tools: {tools}; use {{}} arguments and unique IDs. " + output_guide})
                    continue
                state.malformed = 0
                messages.append({"role": "assistant", "content": msg.get("content"), "tool_calls": calls})
                for name, call_id in parsed:
                    result = await self.env.tool(name, episode_id)
                    read.add(name)
                    log.emit(week, role, "tool_result", {"name": name, "result": result})
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(result, allow_nan=False)})
                messages.append({"role": "user", "content": "Use the tool results to complete this role; do not merely summarize the tools. " + output_guide})
                continue
            try:
                content = msg.get("content")
                if not isinstance(content, str) or not content.strip():
                    raise ValueError("Empty model message")
                if output == "action":
                    answer = Action.parse(json.loads(content))
                elif output == "critique":
                    answer = json.loads(content)
                    if not isinstance(answer, dict) or type(answer.get("accept")) is not bool:
                        raise ValueError("Critic must return boolean accept")
                    if not isinstance(answer.get("objection"), str):
                        raise ValueError("Critic must return an objection string")
                    if not answer["accept"] and not answer["objection"].strip():
                        raise ValueError("Rejected plans require one objection")
                else:
                    answer = content
            except (ValueError, TypeError) as exc:
                log.emit(week, role, "message", {"validation_error": str(exc), "content": msg.get("content")})
                state.bad()
                if isinstance(msg.get("content"), str):
                    messages.append({"role": "assistant", "content": msg["content"]})
                messages.append({"role": "user", "content": "Invalid response. " + output_guide})
                continue
            state.malformed = 0
            log.emit(week, role, "message", {"content": content})
            return answer
        raise PolicyFailure(f"{role} exceeded six model turns")

    async def decide(self, obs, episode_id, week, remaining_n, log):
        context = {"week": week, "obs": obs, "remaining_n_kg_ha": remaining_n}
        state = WeekState()
        if self.config == "single":
            return await self.ask("coordinator", context, episode_id, week, log, state, "action")
        roles = ["crop"] if self.config == "multi_no_weather" else ["weather", "crop"]
        # Wait for both even if one fails: no orphan calls writing into next week's log.
        reports = await asyncio.gather(*(self.ask(r, context, episode_id, week, log, state) for r in roles),
                                       return_exceptions=True)
        for result in reports:
            if isinstance(result, BaseException):
                raise result
        context["reports"] = dict(zip(roles, reports))
        proposal = await self.ask("planner", context, episode_id, week, log, state, "action")
        context["proposal"] = proposal.as_dict()
        if self.config != "multi_no_critic":
            critique = await self.ask("critic", context, episode_id, week, log, state, "critique")
            context["critique"] = critique
            if not critique["accept"]:
                proposal = await self.ask("planner", context, episode_id, week, log, state, "action")
                context["proposal"] = proposal.as_dict()
                context["revision_used"] = True
        return await self.ask("coordinator", context, episode_id, week, log, state, "action")
