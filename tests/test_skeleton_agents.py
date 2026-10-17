"""Person B integration with main's actual API, logger, farmer and eval runner."""
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from agents.client import EnvClient
from agents.policies import POLICIES, make_policy
from agents.policies.single import Single
from agents.run import RunLogger, load_config, load_tasks, play_season
from env.server import create_app
from eval.run_eval import COLUMNS, run_job, write_csv, write_summary
from fieldtwin_agents.clients import tool_schema
from fieldtwin_agents.contracts import CONFIGS
from fieldtwin_agents.stub import StubModel


@pytest.fixture()
def shared_env():
    with TestClient(create_app()) as api:
        env = EnvClient()
        env.http.close()
        env.http = httpx.Client(base_url="http://testserver", transport=httpx.MockTransport(
            lambda request: api.request(request.method, str(request.url), content=request.content,
                                        headers={"Content-Type": "application/json"})))
        yield env
        env.close()


@pytest.mark.parametrize("config", CONFIGS)
def test_shared_season_replay_and_stats(config, shared_env, monkeypatch, tmp_path):
    monkeypatch.setenv("FIELDTWIN_MODEL_BACKEND", "stub")
    monkeypatch.setattr("agents.run.RUNS_DIR", tmp_path / "runs")
    log = RunLogger(config, "UFGA-s3")
    policy = make_policy(config)
    final = play_season(policy, load_tasks("dev")[2], shared_env, log)
    path = log.save()
    assert 0 <= final["n_applied"] <= 300
    assert log.llm_calls > 0 and log.fallbacks == 0
    events = [json.loads(line) for line in path.read_text().splitlines()]
    assert len([e for e in events if e["kind"] == "decision"]) == 20
    assert len([e for e in events if e["kind"] == "step_result"]) == 20
    assert len([e for e in events if e["kind"] == "final"]) == 1
    assert all(e["agent"] == "coordinator" for e in events if e["kind"] == "decision")
    assert all(set(e["data"]) == {"n_kg_ha", "irr_mm", "reason"} for e in events if e["kind"] == "decision")
    assert any(e["data"].get("synthetic_model") for e in events if isinstance(e["data"], dict))
    assert json.loads((tmp_path / "runs/index.json").read_text())[config] == ["UFGA-s3"]
    calls = [e["data"]["name"] for e in events if e["kind"] == "tool_call"]
    if config == "multi_no_tools":
        assert not calls
    if config == "multi_no_weather":
        assert "get_weather" not in calls


def test_registry_and_authoritative_schemas():
    assert set(CONFIGS) <= POLICIES.keys()
    schemas = json.loads(open("agents/tools.json", encoding="utf-8").read())
    for schema in schemas:
        assert tool_schema(schema["function"]["name"]) == schema


def test_shared_cap_and_farmer_fallback(shared_env, monkeypatch):
    class Broken(StubModel):
        async def complete(self, messages, tools):
            return {"tool_calls": [{"id": "bad", "function": {"name": "step", "arguments": "{}"}}]}
    monkeypatch.setenv("FIELDTWIN_MODEL_BACKEND", "vllm")
    monkeypatch.setenv("VLLM_BASE_URL", "http://custom-model/v1")
    monkeypatch.setenv("VLLM_MODEL", "nemotron-alias")
    reset = shared_env.reset(load_tasks("dev")[0])
    cfg = load_config()
    cfg["env"]["max_n_kg_ha_per_season"] = 170
    policy = Single(cfg)
    assert policy.model_name == "nemotron-alias" and policy.base_url == "http://custom-model/v1"
    obs = {**reset["obs"], "n_applied_total": 165, "soil_water_frac": .1}
    log = RunLogger("single", "fallback")
    with patch("agents.policies.nemotron.VLLMClient", return_value=Broken()):
        d = policy.decide(reset["episode_id"], 0, obs, shared_env, log)
    assert (d.n_kg_ha, d.irr_mm) == (5, 25)
    assert log.llm_calls == 2 and log.fallbacks == 1


@pytest.mark.parametrize("config", ["single", "multi", "multi_no_tools"])
def test_submit_decision_and_tool_permissions(config, shared_env, monkeypatch):
    class SubmittingModel(StubModel):
        async def complete(self, messages, tools):
            context = json.loads(messages[1]["content"])
            if context["output"] == "action":
                assert "submit_decision" in tools
                return {"tool_calls": [{"id": "decision", "function": {"name": "submit_decision",
                        "arguments": '{"n_kg_ha":999,"irr_mm":999,"reason":"Tool decision."}'}}]}
            return await super().complete(messages, tools)
    monkeypatch.setenv("FIELDTWIN_MODEL_BACKEND", "vllm")
    reset = shared_env.reset(load_tasks("dev")[0])
    policy = make_policy(config)
    log = RunLogger(config, "submit")
    with patch("agents.policies.nemotron.VLLMClient", return_value=SubmittingModel()):
        d = policy.decide(reset["episode_id"], 0, reset["obs"], shared_env, log)
    assert (d.n_kg_ha, d.irr_mm) == (120, 50)
    assert log.fallbacks == 0
    calls = [e["data"]["name"] for e in log.events if e["kind"] == "tool_call"]
    assert "submit_decision" in calls
    if config == "multi_no_tools":
        assert all(name == "submit_decision" for name in calls)


def test_eval_eight_parallel_seasons(shared_env, monkeypatch, tmp_path):
    monkeypatch.setenv("FIELDTWIN_MODEL_BACKEND", "stub")
    monkeypatch.setattr("agents.run.RUNS_DIR", tmp_path / "runs")
    # Shared in-memory HTTP transport exercises the actual API without a listening port.
    class BorrowedEnv:
        def __getattr__(self, key):
            return getattr(shared_env, key)

        def close(self):
            pass
    with patch("agents.run.EnvClient", return_value=BorrowedEnv()):
        tasks = load_tasks("dev")[:8]
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(lambda t: run_job("multi", t, "http://testserver"), tasks))
    assert len(rows) == 8 and all(set(r) == set(COLUMNS) for r in rows)
    assert all(r["llm_calls"] > 0 and r["fallbacks"] == 0 for r in rows)
    write_csv(tmp_path / "eval.csv", rows)
    write_summary(tmp_path / "summary.md", rows, "Synthetic toy/stub integration check.")
    assert "Synthetic" in (tmp_path / "summary.md").read_text()
    index = json.loads((tmp_path / "runs/index.json").read_text())
    assert len(index["multi"]) == 8


def test_prompt_drift_rejected(monkeypatch, tmp_path):
    cfg = load_config()
    manifest = tmp_path / "bad.json"
    manifest.write_text(json.dumps({"prompt_version": "v1", "prompt_hashes": {}}))
    cfg["agents"]["freeze_manifest"] = str(manifest)
    with pytest.raises(ValueError, match="freeze manifest"):
        Single(cfg)


def test_interactive_test_run_rejected_before_network(monkeypatch):
    monkeypatch.setattr("sys.argv", ["agents.run", "--policy", "single", "--task-id", "UFGA-s101", "--split", "test"])
    with patch("agents.run.run_one") as run:
        from agents.run import main
        with pytest.raises(SystemExit):
            main()
        run.assert_not_called()
