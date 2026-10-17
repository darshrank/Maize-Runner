from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .clients import MODEL, EnvironmentClient, VLLMClient
from .agents import PROMPT_VERSIONS
from .contracts import CONFIGS, load_dev_tasks
from .evaluation import analyze, record_iteration
from .runner import endpoint_identity, load_schedule, prompt_hashes, run_batch
from .stub import StubEnvironment, StubModel, serve_stub


async def smoke(args):
    client = VLLMClient(args.vllm_url, args.model)
    try:
        response = await client.http.get("models")
        response.raise_for_status()
        advertised = [item["id"] for item in response.json()["data"]]
        if args.model not in advertised:
            raise ValueError(f"Requested model is not advertised by /v1/models: {advertised}")
        # Use auto choice so this tests the deployed parser, not forced JSON generation.
        msg = await client.complete([
            {"role": "system", "content": "Call get_weather exactly once with {} arguments. Do not answer in text."},
            {"role": "user", "content": "Check the field weather."}], ["get_weather"])
        calls = msg.get("tool_calls", [])
        if len(calls) != 1 or calls[0]["function"]["name"] != "get_weather" or json.loads(calls[0]["function"]["arguments"]) != {}:
            raise ValueError("Tool-call smoke test failed")
        result = {"checked_at": datetime.now(timezone.utc).isoformat(), "tool_call_valid": True,
                  "model": args.model, "advertised_models": advertised,
                  "endpoint": endpoint_identity(client), "message": msg}
        if args.output:
            path = Path(args.output)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as out:
                json.dump(result, out, indent=2)
                out.write("\n")
        print(json.dumps(result, indent=2))
    finally:
        await client.close()


async def run(args):
    tasks = load_dev_tasks(Path(args.tasks))
    hashes = prompt_hashes(args.prompt_version)
    if args.freeze_manifest:
        frozen = json.loads(Path(args.freeze_manifest).read_text(encoding="utf-8"))
        if frozen["prompt_hashes"] != hashes or frozen["prompt_version"] != args.prompt_version:
            raise ValueError("Prompts differ from freeze manifest")
    if not (args.stub or args.stub_env) and not args.env_url:
        raise ValueError("Real runs require --env-url (Person A); use --stub for local fixtures")
    env = StubEnvironment() if args.stub or args.stub_env else EnvironmentClient(args.env_url, synthetic=args.synthetic_env)
    model = StubModel() if args.stub_model or args.stub else VLLMClient(args.vllm_url, args.model)
    try:
        if not env.synthetic:
            response = await env.http.get("health")
            response.raise_for_status()
            env.health_snapshot = response.json()
            from .management import environment_limits
            if env.health_snapshot != {"ok": True, "simulator": environment_limits()["simulator"]} or env.health_snapshot["simulator"] == "toy":
                raise ValueError("Environment health must match the configured real simulator; use --synthetic-env for toy")
        rows = await run_batch(tasks, args.configs, env, model, Path(args.output),
            concurrency=args.concurrency, n_cap=args.n_cap, schedule=load_schedule(args.farmer_schedule),
            prompt_version=args.prompt_version, experiment_kind=args.experiment_kind)
        print(json.dumps({"seasons_completed": len(rows), "synthetic": bool(env.synthetic or model.synthetic), "output": args.output}))
    finally:
        await env.close()
        await model.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="FieldTwin Person B agents (dev only)")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--tasks", required=True, help="A's dev-only JSONL, or fixtures/dev.stub.jsonl")
    r.add_argument("--configs", nargs="+", choices=CONFIGS, default=["single", "multi"])
    r.add_argument("--output", required=True, help="New run directory; never overwrites")
    r.add_argument("--stub", action="store_true", help="Synthetic environment AND deterministic model")
    r.add_argument("--stub-env", action="store_true", help="Synthetic in-process environment with real vLLM model")
    r.add_argument("--synthetic-env", action="store_true", help="Mark an external HTTP environment as synthetic")
    r.add_argument("--stub-model", action="store_true", help="Synthetic model against an HTTP environment")
    r.add_argument("--env-url", default=os.environ.get("FIELDTWIN_ENV_URL"))
    r.add_argument("--concurrency", type=int, default=8)
    r.add_argument("--n-cap", type=float, default=None, help="Defaults to config.yaml season cap")
    r.add_argument("--farmer-schedule", help="JSON map of week to n_kg_ha and irr_mm; default is provisional")
    r.add_argument("--prompt-version", choices=PROMPT_VERSIONS, default="v1")
    r.add_argument("--freeze-manifest")
    r.add_argument("--experiment-kind", choices=("runtime", "prompt_only", "thinking_mode", "synthetic_plumbing"),
                   default="runtime", help="Record the experiment category; comparisons also check actual hashes/settings")
    s = sub.add_parser("smoke", help="Actual vLLM automatic tool-call smoke test")
    s.add_argument("--output", help="Save successful live verification evidence to a new JSON file")
    for cmd in (r, s):
        cmd.add_argument("--vllm-url", default=os.environ.get("VLLM_BASE_URL", "http://127.0.0.1:8000/v1"))
        cmd.add_argument("--model", default=os.environ.get("VLLM_MODEL") or MODEL)
    stub = sub.add_parser("stub-server")
    stub.add_argument("--host", default="127.0.0.1")
    stub.add_argument("--port", type=int, default=9000)
    a = sub.add_parser("analyze")
    a.add_argument("run_dir")
    c = sub.add_parser("compare")
    c.add_argument("before")
    c.add_argument("after")
    c.add_argument("--change", required=True)
    c.add_argument("--output", default="results/iterations.md")
    f = sub.add_parser("freeze")
    f.add_argument("--prompt-version", choices=PROMPT_VERSIONS, default="v1")
    f.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "run":
        asyncio.run(run(args))
    elif args.command == "smoke":
        asyncio.run(smoke(args))
    elif args.command == "stub-server":
        serve_stub(args.host, args.port)
    elif args.command == "analyze":
        result = analyze(args.run_dir)
        print(json.dumps({"synthetic": result["synthetic"], "diagnostics": str(Path(args.run_dir) / "diagnostics.json")}, indent=2))
    elif args.command == "compare":
        print(record_iteration(args.before, args.after, args.change, args.output))
    elif args.command == "freeze":
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as out:
            json.dump({"prompt_version": args.prompt_version, "prompt_hashes": prompt_hashes(args.prompt_version),
                       "configs": list(CONFIGS), "status": "snapshot; real-dev selection pending"}, out, indent=2)
            out.write("\n")
        print(f"Prompt snapshot written to {path}")


if __name__ == "__main__":
    main()
