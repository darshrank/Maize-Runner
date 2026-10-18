"""Compare critic prompts on explicit good/bad review cases using live Nemotron.

These synthetic evidence fixtures are diagnostics, not crop-performance evaluation.
Run from any directory; output is reserved exclusively and never overwrites a run.
"""
import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fieldtwin_agents.agents import AGENT_PROTOCOL_VERSION, PROMPT_VERSIONS, AgentTeam, WeekState
from fieldtwin_agents.clients import MODEL, VLLMClient
from fieldtwin_agents.contracts import EventLog, safe_name
from fieldtwin_agents.runner import endpoint_identity, prompt_hashes


class Evidence:
    def __init__(self, tools):
        self.tools = tools

    async def tool(self, name, episode_id):
        return self.tools[name]


def metrics(rows):
    bad = [r for r in rows if not r["expected_accept"]]
    good = [r for r in rows if r["expected_accept"]]
    rejected_bad = sum(r["correct"] for r in bad)
    accepted_good = sum(r["correct"] for r in good)
    return {"cases": len(rows), "correct": sum(r["correct"] for r in rows),
            "bad_plan_rejection_rate": rejected_bad / len(bad),
            "good_plan_acceptance_rate": accepted_good / len(good),
            "balanced_accuracy": (rejected_bad / len(bad) + accepted_good / len(good)) / 2,
            "false_accepts": sum(r.get("actual_accept") is True for r in bad),
            "false_rejects": sum(r.get("actual_accept") is False for r in good),
            "errors": sum("error" in r for r in rows)}


async def run(args):
    fixture = Path(args.cases)
    cases = json.loads(fixture.read_text(encoding="utf-8"))["cases"]
    for case in cases:
        safe_name(case["case_id"])
        if type(case["expected_accept"]) is not bool:
            raise ValueError("Case labels must be JSON booleans")
    if (args.repeats < 1 or args.concurrency < 1 or not cases
            or len({c["case_id"] for c in cases}) != len(cases)
            or {c["expected_accept"] for c in cases} != {True, False}):
        raise ValueError("Unique cases with both outcomes and positive repeats/concurrency required")
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=False)
    model = VLLMClient(args.vllm_url, args.model)
    try:
        r = await model.http.get("models")
        r.raise_for_status()
        if args.model not in [item["id"] for item in r.json()["data"]]:
            raise ValueError("Requested checkpoint is not advertised by server")
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True)
        manifest = {"checked_at": datetime.now(timezone.utc).isoformat(),
                    "scope": "Synthetic review cases with live Nemotron; no DSSAT rollout or training",
                    "model": args.model, "endpoint": endpoint_identity(model),
                    "agent_protocol_version": AGENT_PROTOCOL_VERSION,
                    "prompt_hashes": {v: prompt_hashes(v) for v in args.versions},
                    "case_sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
                    "source_commit": commit.stdout.strip() or None,
                    "source_sha256": {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                        for name in ("scripts/check_critic.py", "fieldtwin_agents/agents.py",
                                     "fieldtwin_agents/clients.py", "fieldtwin_agents/contracts.py")},
                    "repeats": args.repeats, "concurrency": args.concurrency}
        (out/"manifest.json").write_text(json.dumps(manifest, indent=2)+'\n', encoding="utf-8")
        (out/"cases.json").write_bytes(fixture.read_bytes())
        semaphore = asyncio.Semaphore(args.concurrency)

        async def one(version, case, repetition):
            async with semaphore:
                team = AgentTeam(model, Evidence(case["tools"]), "multi", version)
                log = EventLog(out/version/f'{case["case_id"]}-{repetition}.jsonl')
                row = {"version": version, "case_id": case["case_id"],
                       "repetition": repetition, "expected_accept": case["expected_accept"],
                       "correct": False}
                try:
                    decision = await team.ask("critic", case["context"], "fixture", 5,
                                              log, WeekState(), "critique")
                    row.update(actual_accept=decision["accept"], objection=decision["objection"])
                    contract = set(decision) == {"accept", "objection"} and (
                        decision["objection"] == "" if decision["accept"] else bool(decision["objection"].strip()))
                    row["correct"] = contract and decision["accept"] == case["expected_accept"]
                    if not contract:
                        row["error"] = "Critique output contract violation"
                except Exception as exc:
                    row["error"] = f"{type(exc).__name__}: {exc}"
                finally:
                    row["llm_calls"] = team.llm_calls
                    log.close()
                return row

        rows = await asyncio.gather(*(one(v, c, n) for v in args.versions
                                    for c in cases for n in range(args.repeats)))
        report = {"manifest": manifest,
                  "summary": {v: metrics([r for r in rows if r["version"] == v]) for v in args.versions},
                  "reviews": rows}
        (out/"report.json").write_text(json.dumps(report, indent=2)+'\n', encoding="utf-8")
        print(json.dumps(report["summary"], indent=2))
    finally:
        await model.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cases", default=str(ROOT/"fixtures/critic.review-cases.json"))
    p.add_argument("--versions", nargs="+", choices=PROMPT_VERSIONS, default=["v3", "v4"])
    p.add_argument("--repeats", type=int, default=2)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--vllm-url", default=os.environ.get("VLLM_BASE_URL", "http://127.0.0.1:8000/v1"))
    p.add_argument("--model", default=os.environ.get("VLLM_MODEL") or MODEL)
    p.add_argument("--output", required=True)
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
