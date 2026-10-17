"""Failure-oriented checks for the local foundation; all seasons are synthetic."""
import asyncio
import json
from dataclasses import FrozenInstanceError

import httpx
import pytest

from fieldtwin_agents.clients import VLLMClient
from fieldtwin_agents.contracts import Action, Task
from fieldtwin_agents.evidence import Proposal, Review, WeekEvidence, verify_final
from fieldtwin_agents.evaluation import record_iteration
from fieldtwin_agents.experiments import catalogue
from fieldtwin_agents.runner import run_batch, run_season
from fieldtwin_agents.stub import StubEnvironment, StubModel
from fieldtwin_agents.validation import audit_run


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def events(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


@pytest.mark.parametrize("moisture,expected", [(0.93, False), (0.35, False), (0.349, True)])
def test_literal_reference_comparison_and_uncertainty(moisture, expected):
    evidence = WeekEvidence("episode", 3, {"soil_water_frac": moisture, "unknown": {"x": 7}}, 17.25)
    evidence.add("get_weather", {"outlook": [{"rain_mm": 8}], "history": [{"rain_mm": 2}]})
    snapshot = evidence.snapshot()
    facts = snapshot["facts"]
    assert next(f for f in facts if f["name"] == "farmer_reference_dry")["value"] is expected
    budget = next(f for f in facts if f["source"] == "runner")
    assert budget["value"] == 17.25 and budget["unit"] == "kg N/ha"
    assert all(f["episode_id"] == "episode" and f["week"] == 3 for f in facts)
    assert "not supplied" in next(f for f in facts if f["path"] == "outlook[0].rain_mm")["uncertainty"]
    assert snapshot["raw_evidence"]["observation"]["unknown"] == {"x": 7}
    assert not any(f["name"] == "unknown" for f in facts)


def test_evidence_detaches_mutation_and_rejects_changed_or_nonfinite_read():
    raw = {"soil_n_kg_ha": 20}
    evidence = WeekEvidence("one", 0, raw, 300)
    raw["soil_n_kg_ha"] = 500
    assert evidence.snapshot()["raw_evidence"]["observation"]["soil_n_kg_ha"] == 20
    with pytest.raises(ValueError, match="changed"):
        evidence.add("observation", raw)
    with pytest.raises(ValueError):
        evidence.add("get_soil", {"soil_n_kg_ha": float("nan")})


def test_model_evidence_avoids_daily_row_duplication_but_retains_typed_totals():
    evidence = WeekEvidence("one", 19, {"soil_water_frac": .93}, 123)
    weather = {"outlook": [{"rain_mm": 3, "tmax": 30, "tmin": 20} for _ in range(7)],
               "history": [{"rain_mm": 2, "tmax": 31, "tmin": 21} for _ in range(14)]}
    evidence.add("get_weather", weather)
    compact = evidence.model_snapshot()
    assert "raw_evidence" not in compact and "get_weather" in compact["raw_source_ids"]
    assert next(f for f in compact["facts"] if f["name"] == "outlook_rain_total")["value"] == 21
    assert next(f for f in compact["facts"] if f["name"] == "history_rain_total")["value"] == 28
    assert len(compact["facts"]) < 10
    assert evidence.snapshot()["raw_evidence"]["get_weather"] == weather


def test_revision_and_coordinator_cannot_inherit_earlier_review_identity():
    action = Action(10, 0, "Reference moisture is adequate")
    original = Proposal("one", 0, "planner", action)
    review = Review(original.as_dict()["proposal_id"], True, "")
    revised = Proposal("one", 0, "planner:revision", action, review.proposal_id)
    coordinator = Proposal("one", 0, "coordinator", Action(999, 999, "Changed"), revised.as_dict()["proposal_id"])
    with pytest.raises(FrozenInstanceError):
        original.week = 1
    assert len({p.as_dict()["proposal_id"] for p in (original, revised, coordinator,
                Proposal("two", 0, "planner", action), Proposal("one", 1, "planner", action))}) == 5
    final = coordinator.action.guarded(7)
    verification = verify_final(coordinator, final, 7, 120, 50, reviewed_id=review.proposal_id)
    assert not verification["exact_final_reviewed"]
    assert verification["guard_changed_action"] and verification["remaining_n_after_kg_ha"] == 0
    assert verification["final_action"] == Action(7, 50, "Changed").as_dict()
    with pytest.raises(ValueError, match="runtime limits"):
        verify_final(coordinator, coordinator.action, 7, 120, 50)


@pytest.mark.parametrize("config", ["multi_no_tools", "multi_no_weather"])
def test_facts_do_not_restore_withheld_evidence(tmp_path, config):
    async def run():
        await run_season(Task("dev", "STUB", 1), config, StubEnvironment(1), StubModel(), tmp_path)
    asyncio.run(run())
    trace = events(tmp_path / config / "dev.jsonl")
    snapshot = next(e["data"]["field_facts"] for e in trace if "field_facts" in e["data"])
    assert "get_weather" not in snapshot["raw_evidence"]
    if config == "multi_no_tools":
        assert set(snapshot["raw_evidence"]) == {"observation", "runner"}


def test_final_coordinator_change_is_checked_and_audit_detects_changed_action(tmp_path):
    class ChangingModel(StubModel):
        async def complete(self, messages, tools):
            context = json.loads(messages[1]["content"])
            if context["output"] == "action" and "Coordinator" in messages[0]["content"]:
                return {"content": '{"n_kg_ha":999,"irr_mm":999,"reason":"Coordinator changed planner"}'}
            return await super().complete(messages, tools)

    output = tmp_path / "run"
    asyncio.run(run_batch([Task("dev", "STUB", 1)], ["multi"], StubEnvironment(1), ChangingModel(), output))
    audit_run(output, require_live=False)
    path = output / "runs/multi/dev.jsonl"
    trace = events(path)
    review = next(e["data"]["review_record"] for e in trace if "review_record" in e["data"])
    verification = next(e["data"]["final_verification"] for e in trace if "final_verification" in e["data"])
    assert verification["reviewed_proposal_id"] == review["proposal_id"]
    assert verification["final_action"]["n_kg_ha"] == 120
    assert not verification["exact_final_reviewed"]
    assert read(output / "receipts/multi/dev.json")["status"] == "completed"
    next(e for e in trace if e["kind"] == "decision")["data"]["irr_mm"] = 49
    path.write_text("".join(json.dumps(e) + "\n" for e in trace), encoding="utf-8")
    with pytest.raises(ValueError, match="exact final action mismatch"):
        audit_run(output, require_live=False)


def test_parallel_roles_have_independent_malformed_streaks(tmp_path):
    class OnceMalformed(StubModel):
        def __init__(self):
            self.started, self.retried = set(), set()
            self.start_gate, self.retry_gate = asyncio.Event(), asyncio.Event()

        async def complete(self, messages, tools):
            prompt = messages[0]["content"]
            role = "weather" if "Weather agent" in prompt else "crop" if "Crop agent" in prompt else None
            if role and role not in self.started:
                self.started.add(role)
                if len(self.started) == 2:
                    self.start_gate.set()
                await self.start_gate.wait()
                return {"content": ""}
            if role and role not in self.retried:
                self.retried.add(role)
                if len(self.retried) == 2:
                    self.retry_gate.set()
                await asyncio.wait_for(self.retry_gate.wait(), 2)
            return await super().complete(messages, tools)

    async def run():
        return await run_season(Task("dev", "STUB", 1), "multi", StubEnvironment(1), OnceMalformed(), tmp_path)
    assert asyncio.run(run())["fallbacks"] == 0


def test_receipt_is_durable_while_another_season_is_still_running(tmp_path):
    async def run():
        release, blocked = asyncio.Event(), asyncio.Event()

        class SlowEnvironment(StubEnvironment):
            async def reset(self, task):
                if task.task_id == "slow":
                    blocked.set()
                    await release.wait()
                return await super().reset(task)

        output = tmp_path / "run"
        job = asyncio.create_task(run_batch([Task("fast", "STUB", 1), Task("slow", "STUB", 2)],
            ["single"], SlowEnvironment(1), StubModel(), output))
        try:
            await blocked.wait()
            receipt = output / "receipts/single/fast.json"
            async with asyncio.timeout(5):
                while not receipt.exists():
                    await asyncio.sleep(.01)
            assert not job.done() and not (output / "eval.csv").exists()
            assert read(receipt)["status"] == "completed"
            result = catalogue(output, output / "catalogue.json")
            statuses = {s["task_id"]: s["status"] for s in result["experiments"][0]["seasons"]}
            assert statuses == {"fast": "completed", "slow": "interrupted_or_running"}
        finally:
            release.set()
            await job
    asyncio.run(run())


def test_uncertain_step_is_never_retried_and_failure_is_catalogued(tmp_path):
    class FailedAfterApply(StubEnvironment):
        attempts = 0

        async def step(self, episode_id, action):
            self.attempts += 1
            await super().step(episode_id, action)
            raise httpx.ReadTimeout("Applied, response lost")

    env = FailedAfterApply(2)
    output = tmp_path / "failed"
    with pytest.raises(RuntimeError, match="seasons failed"):
        asyncio.run(run_batch([Task("dev", "STUB", 1)], ["single"], env, StubModel(), output))
    assert env.attempts == 1
    receipt = read(output / "receipts/single/dev.json")
    assert receipt["status"] == "failed" and receipt["step_outcome_unknown"]
    assert receipt["error_type"] == "ReadTimeout"
    catalogue(tmp_path, tmp_path / "catalogue.json")
    assert env.attempts == 1


def test_cancelled_batch_can_be_catalogued_without_replaying_a_step(tmp_path):
    async def run():
        applied = asyncio.Event()

        class PendingStep(StubEnvironment):
            async def step(self, episode_id, action):
                await super().step(episode_id, action)
                applied.set()
                await asyncio.Event().wait()

        output = tmp_path / "interrupted"
        env = PendingStep(2)
        job = asyncio.create_task(run_batch([Task("dev", "STUB", 1)], ["single"], env, StubModel(), output))
        await asyncio.wait_for(applied.wait(), 5)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job
        record = catalogue(output, output / "catalogue.json")["experiments"][0]["seasons"][0]
        assert record["status"] == "interrupted" and record["step_outcome_unknown"]
        assert next(iter(env.episodes.values()))["week"] == 1
        assert not (output / "eval.csv").exists()
    asyncio.run(run())


@pytest.mark.parametrize("year", [1989, 2010, 2024])
def test_mislabelled_heldout_year_is_rejected_before_reset(tmp_path, year):
    env = StubEnvironment(1)
    with pytest.raises(ValueError, match="1990-2009"):
        asyncio.run(run_batch([Task("bad", "UFGA", year=year)], ["single"], env, StubModel(), tmp_path / "run"))
    assert not env.episodes and not (tmp_path / "run").exists()


def test_prompt_only_comparison_rejects_runtime_and_inference_changes(tmp_path):
    for name, version in (("before", "v1"), ("after", "v2")):
        asyncio.run(run_batch([Task("dev", "STUB", 1)], ["multi"], StubEnvironment(1), StubModel(),
                             tmp_path / name, prompt_version=version))
    before, after = tmp_path / "before", tmp_path / "after"
    path = after / "manifest.json"
    original = read(path)
    for field, value in (("inference_settings", {"enable_thinking": True}),
                         ("concurrency", 1), ("max_weeks", 19),
                         ("source", {**original["source"], "runtime_sha256": {"changed": "hash"}})):
        path.write_text(json.dumps({**original, field: value}), encoding="utf-8")
        with pytest.raises(ValueError, match="Prompt-only"):
            record_iteration(before, after, "confounded", tmp_path / "iterations.md")


def test_vllm_telemetry_is_returned_per_response_and_thinking_stays_off():
    def handler(request):
        payload = json.loads(request.content)
        assert payload["chat_template_kwargs"]["enable_thinking"] is False
        assert payload["max_tokens"] == 2048
        return httpx.Response(200, json={"model": "served-revision", "system_fingerprint": "fp",
            "usage": {"prompt_tokens": 100, "completion_tokens": 12, "total_tokens": 112},
            "choices": [{"finish_reason": "stop", "message": {"content": "final", "reasoning": "ignored"}}]})

    async def run():
        client = VLLMClient("http://model/v1", transport=httpx.MockTransport(handler))
        try:
            msg = await client.complete([], [])
            assert msg["_telemetry"]["usage"]["total_tokens"] == 112
            assert msg["_telemetry"]["finish_reason"] == "stop"
            assert msg["content"] == "final"
        finally:
            await client.close()
    asyncio.run(run())
