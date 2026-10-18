from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import Path

from .contracts import Action, ROLE_TOOLS
from .evidence import Proposal, Review, WeekEvidence, check_proposal

PROMPT_ROOT = Path(__file__).parent / "prompts"
AGENT_PROTOCOL_VERSION = 4


def critic_log_fields(verdict):
    """UI fields for a parsed critic verdict: display text and a boolean objection flag."""
    objection = not verdict["accept"]
    return {"text": verdict.get("objection") if objection else "Accepted: no objection.", "objection": objection}


def tool_args_fields(arguments):
    """Log tool arguments as an object; keep the raw text when it is not a JSON object."""
    if isinstance(arguments, dict):
        return {"args": arguments}
    try:
        value = json.loads(arguments)
    except (TypeError, ValueError):
        value = None
    return {"args": value} if isinstance(value, dict) else {"args": {}, "args_raw": arguments}


def trailing_json(content):
    """Return (object, prose prefix) when content ends with exactly one JSON object."""
    content = content.strip()
    decoder = json.JSONDecoder()
    start = content.rfind("{")
    while start >= 0:
        try:
            value, end = decoder.raw_decode(content, start)
            if not content[end:].strip():
                return value, content[:start].strip()
        except ValueError:
            pass
        start = content.rfind("{", 0, start)
    return None
PROMPT_VERSIONS = ("v1", "v2", "v3", "v4", "v5")


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
        if prompt_version not in PROMPT_VERSIONS:
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
        evidence = getattr(self, "evidence", None)
        evidence_sources = None
        if evidence is not None:
            # Freeze this invocation's starting sources. Parallel specialists cannot
            # accidentally see a peer's newly completed reads due to scheduling.
            evidence_sources = set(evidence.snapshot()["raw_evidence"]) | set(self.tools_for(role))
            if role in ("weather", "crop"):
                evidence_sources = {"observation", "runner", *self.tools_for(role)}
            context = {**context, "field_facts": evidence.model_snapshot(evidence_sources)}
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
            started = time.perf_counter()
            try:
                msg = await self.model.complete(messages, request_tools)
            except Exception as exc:
                log.emit(week, role, "message", {"inference": {"latency_s": time.perf_counter() - started,
                         "error_type": type(exc).__name__, "error": str(exc)}})
                raise
            log.emit(week, role, "message", {"inference": {
                "latency_s": time.perf_counter() - started,
                **(msg.get("_telemetry", {}) if isinstance(msg, dict) else {})}})
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
                        log.emit(week, role, "tool_call", {"name": name, **tool_args_fields(fn["arguments"])})
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
                    if evidence is not None:
                        try:
                            evidence.add(name, result)
                        except ValueError as exc:
                            raise PolicyFailure(f"Invalid weekly evidence: {exc}") from exc
                    content = result if evidence is None else {"raw_result": result,
                        "field_facts": evidence.model_snapshot({name})}
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(content, allow_nan=False)})
                messages.append({"role": "user", "content": "Use the tool results to complete this role; do not merely summarize the tools. " + output_guide})
                continue
            try:
                content = msg.get("content")
                if not isinstance(content, str) or not content.strip():
                    raise ValueError("Empty model message")
                if output in ("action", "critique"):
                    try:
                        parsed_json = json.loads(content)
                    except ValueError:
                        extracted = trailing_json(content)
                        if extracted is None or not extracted[1]:
                            raise
                        parsed_json, prefix = extracted
                        log.emit(week, role, "message", {"lenient_json_extracted": True, "discarded_prefix": prefix})
                if output == "action":
                    answer = Action.parse(parsed_json)
                elif output == "critique":
                    answer = parsed_json
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
            log.emit(week, role, "message", {"content": content,
                     **(critic_log_fields(answer) if output == "critique" else {})})
            return answer
        raise PolicyFailure(f"{role} exceeded six model turns")

    async def decide(self, obs, episode_id, week, remaining_n, log, *, accounting=None):
        self.evidence = WeekEvidence(episode_id, week, obs, remaining_n, accounting)
        self.final_proposal = None
        self.reviewed_proposal_id = None
        context = {"episode_id": episode_id, "week": week, "obs": obs, "remaining_n_kg_ha": remaining_n}
        if accounting is not None:
            context["max_n_this_week_kg_ha"] = min(accounting["max_n_kg_ha_per_week"], remaining_n)

        def checked(action):
            if accounting is not None:
                context["proposal_check"] = check_proposal(action, accounting, obs)

        async def ask(role, output="message"):
            # Malformed-response streaks belong to a role invocation, never parallel peers.
            return await self.ask(role, context, episode_id, week, log, WeekState(), output)

        def record(action, stage, parent_id=None):
            proposal = Proposal(episode_id, week, stage, action, parent_id)
            log.emit(week, stage.split(":")[0], "message", {"proposal_record": proposal.as_dict()})
            return proposal

        if self.config == "single":
            action = await ask("coordinator", "action")
            self.final_proposal = record(action, "coordinator")
            return action
        roles = ["crop"] if self.config == "multi_no_weather" else ["weather", "crop"]
        # Wait for both even if one fails: no orphan calls writing into next week's log.
        reports = await asyncio.gather(*(ask(r) for r in roles),
                                       return_exceptions=True)
        for result in reports:
            if isinstance(result, BaseException):
                raise result
        context["reports"] = dict(zip(roles, reports))
        proposal = await ask("planner", "action")
        record_proposal = record(proposal, "planner")
        context["proposal"] = proposal.as_dict()
        context["proposal_record"] = record_proposal.as_dict()
        checked(proposal)
        if self.config != "multi_no_critic":
            critique = await ask("critic", "critique")
            review = Review(record_proposal.as_dict()["proposal_id"], critique["accept"], critique["objection"])
            log.emit(week, "critic", "message", {"review_record": review.as_dict()})
            context["review_record"] = review.as_dict()
            self.reviewed_proposal_id = review.proposal_id
            context["critique"] = critique
            if not critique["accept"]:
                proposal = await ask("planner", "action")
                record_proposal = record(proposal, "planner:revision", record_proposal.as_dict()["proposal_id"])
                context["proposal"] = proposal.as_dict()
                context["proposal_record"] = record_proposal.as_dict()
                checked(proposal)
                context["revision_used"] = True
        context["current_proposal_has_review"] = self.reviewed_proposal_id == record_proposal.as_dict()["proposal_id"]
        action = await ask("coordinator", "action")
        self.final_proposal = record(action, "coordinator", record_proposal.as_dict()["proposal_id"])
        return action
