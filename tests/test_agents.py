import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import httpx

from fieldtwin_agents.agents import AgentTeam
from fieldtwin_agents.clients import EnvironmentClient, VLLMClient
from fieldtwin_agents.contracts import Action, CSV_FIELDS, Task, load_dev_tasks
from fieldtwin_agents.evaluation import analyze, record_iteration
from fieldtwin_agents.runner import run_batch, run_season
from fieldtwin_agents.stub import StubEnvironment, StubModel


class BrokenModel(StubModel):
    async def complete(self, messages, tools):
        return {"tool_calls": [{"id": "bad", "function": {"name": "step", "arguments": "{}"}}]}


class RevisionModel(StubModel):
    def __init__(self):
        self.revisions = 0

    async def complete(self, messages, tools):
        context = json.loads(messages[1]["content"])
        if context["output"] == "critique":
            return {"content": '{"accept":false,"objection":"Defer nitrogen before rain."}'}
        if "Planner" in messages[0]["content"] and context.get("critique"):
            self.revisions += 1
            return {"content": '{"n_kg_ha":0,"irr_mm":0,"reason":"Deferred after critique."}'}
        return await super().complete(messages, tools)


class GuardModel(StubModel):
    async def complete(self, messages, tools):
        return {"content": '{"n_kg_ha":999,"irr_mm":999,"reason":"  test\\nreason "}'}


class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_configs_eight_parallel_and_log_contract(self):
        from fieldtwin_agents.contracts import CONFIGS
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "run"
            tasks = [Task(f"dev-{i}", "STUB", i) for i in range(8)]
            rows = await run_batch(tasks, CONFIGS, StubEnvironment(weeks=2), StubModel(), output, concurrency=8)
            self.assertEqual(len(rows), 40)
            self.assertEqual(set(rows[0]), set(CSV_FIELDS))
            for config in CONFIGS:
                path = output / "runs" / config / "dev-0.jsonl"
                events = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertTrue(all(set(e) == {"t", "week", "agent", "kind", "data"} for e in events))
                self.assertEqual(len([e for e in events if e["kind"] == "decision"]), 2)
                calls = [e["data"]["name"] for e in events if e["kind"] == "tool_call"]
                if config == "multi_no_tools":
                    self.assertEqual(calls, [])
                if config == "multi_no_weather":
                    self.assertNotIn("get_weather", calls)
                    self.assertFalse(any(e["agent"] == "weather" for e in events))
                if config == "multi_no_critic":
                    self.assertFalse(any(e["agent"] == "critic" for e in events))
            self.assertTrue(analyze(output)["synthetic"])

    async def test_two_bad_calls_fallback_and_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = await run_season(Task("bad", "STUB", 1), "single", StubEnvironment(2), BrokenModel(), tmp,
                                   n_cap=25, schedule={0: (80, 90), 1: (80, 90)})
            self.assertEqual(row["fallbacks"], 2)
            self.assertEqual(row["llm_calls"], 4)
            self.assertEqual(row["n_applied"], 25)
            self.assertEqual(row["irr_mm"], 100)
            events = [json.loads(l) for l in (Path(tmp)/"single/bad.jsonl").read_text().splitlines()]
            self.assertEqual(sum(e["kind"] == "fallback" for e in events), 2)

    async def test_clamp_without_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = await run_season(Task("guard", "STUB", 1), "single", StubEnvironment(3), GuardModel(), tmp, n_cap=140)
            self.assertEqual(row["n_applied"], 140)
            self.assertEqual(row["irr_mm"], 150)
            self.assertEqual(row["fallbacks"], 0)

    async def test_exactly_one_revision_per_week(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = RevisionModel()
            row = await run_season(Task("revision", "STUB", 1), "multi", StubEnvironment(3), model, tmp)
            self.assertEqual(model.revisions, 3)
            self.assertEqual(row["n_applied"], 0)

    async def test_weather_crop_are_parallel(self):
        class BarrierModel(StubModel):
            def __init__(self):
                self.started = set()
                self.both = asyncio.Event()

            async def complete(self, messages, tools):
                role = "weather" if "Weather agent" in messages[0]["content"] else "crop" if "Crop agent" in messages[0]["content"] else None
                if role:
                    self.started.add(role)
                    if len(self.started) == 2:
                        self.both.set()
                    await asyncio.wait_for(self.both.wait(), 1)
                return await super().complete(messages, tools)
        with tempfile.TemporaryDirectory() as tmp:
            await run_season(Task("parallel", "STUB", 1), "multi", StubEnvironment(1), BarrierModel(), tmp)

    async def test_held_out_rejected_before_reset(self):
        env = StubEnvironment()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                await run_batch([Task("test-1", "STUB", 0, "test")], ["single"], env, StubModel(), Path(tmp)/"run")
            self.assertFalse(env.episodes)
            path = Path(tmp)/"tasks.jsonl"
            path.write_text('{"task_id":"test-1","site":"X","weather_seed":0,"split":"test"}')
            with self.assertRaises(ValueError):
                load_dev_tasks(path)
            path.write_text('{"task_id":"unlabeled","site":"X","weather_seed":0}')
            with self.assertRaises(ValueError):
                load_dev_tasks(path)

    async def test_season_concurrency_is_bounded_at_eight(self):
        class CountingEnv(StubEnvironment):
            def __init__(self):
                super().__init__(1)
                self.active = self.peak = 0

            async def reset(self, task):
                self.active += 1
                self.peak = max(self.peak, self.active)
                return await super().reset(task)

            async def step(self, episode_id, action):
                result = await super().step(episode_id, action)
                self.active -= 1
                return result
        env = CountingEnv()
        with tempfile.TemporaryDirectory() as tmp:
            await run_batch([Task(f"dev-{i}", "STUB", i) for i in range(20)], ["multi"], env, StubModel(),
                            Path(tmp)/"run", concurrency=8)
            self.assertEqual(env.peak, 8)
            self.assertEqual(env.active, 0)

    async def test_partial_batch_preserves_success_and_refuses_overwrite(self):
        class FailingEnv(StubEnvironment):
            async def reset(self, task):
                if task.weather_seed == 1:
                    raise httpx.ConnectError("environment unavailable")
                return await super().reset(task)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/"run"
            tasks = [Task(f"dev-{i}", "STUB", i) for i in range(2)]
            with self.assertRaises(RuntimeError):
                await run_batch(tasks, ["single"], FailingEnv(1), StubModel(), output)
            self.assertTrue((output/"errors.json").exists())
            self.assertEqual(len((output/"eval.csv").read_text().splitlines()), 2)
            with self.assertRaises(ValueError):
                analyze(output)
            with self.assertRaises(FileExistsError):
                await run_batch(tasks, ["single"], StubEnvironment(1), StubModel(), output)

    async def test_iteration_paired_and_partial_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp)/"a", Path(tmp)/"b"
            tasks = [Task("dev-1", "STUB", 1)]
            for path, version in ((a, "v1"), (b, "v2")):
                await run_batch(tasks, ["multi"], StubEnvironment(1), StubModel(), path, prompt_version=version)
            result = record_iteration(a, b, "one critic hypothesis", Path(tmp)/"iterations.md")
            self.assertIn("SYNTHETIC", result)
            self.assertIn("0.000000", result)
            (b/"eval.csv").write_text(",".join(CSV_FIELDS) + "\n")
            with self.assertRaises(ValueError):
                analyze(b)

    async def test_http_contract_and_no_step_retry(self):
        requests = []
        def handler(request):
            requests.append(request)
            if request.url.path == "/reset":
                self.assertEqual(json.loads(request.content), {"task_id":"dev-1","site":"UFGA","weather_seed":3})
                return httpx.Response(200, json={"episode_id":"e", "obs":{}, "week":0})
            if request.url.path == "/tool/get_soil":
                self.assertEqual(request.url.params["episode_id"], "e")
                return httpx.Response(200, json={"n": 20})
            raise httpx.ReadTimeout("uncertain step outcome")
        env = EnvironmentClient("http://env", transport=httpx.MockTransport(handler))
        try:
            await env.reset(Task("dev-1", "UFGA", 3))
            self.assertEqual(await env.tool("get_soil", "e"), {"n":20})
            with self.assertRaises(httpx.ReadTimeout):
                await env.step("e", Action(0, 0, "test"))
            self.assertEqual(len(requests), 3)
        finally:
            await env.close()

    async def test_vllm_payload_and_malformed_envelope(self):
        def handler(request):
            payload = json.loads(request.content)
            self.assertEqual(request.url.path, "/v1/chat/completions")
            self.assertEqual(payload["tool_choice"], "auto")
            self.assertTrue(payload["chat_template_kwargs"]["force_nonempty_content"])
            return httpx.Response(200, json={"choices": []})
        model = VLLMClient("http://model/v1", transport=httpx.MockTransport(handler))
        try:
            self.assertEqual(await model.complete([], ["get_weather"]), {"content":""})
        finally:
            await model.close()


class ContractTests(unittest.TestCase):
    def test_strict_action_numbers_and_paths(self):
        for bad in (True, "10", float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                Action.parse({"n_kg_ha":bad, "irr_mm":0, "reason":"test"})
        with self.assertRaises(ValueError):
            Task("../escape", "STUB", 1)


if __name__ == "__main__":
    unittest.main()
