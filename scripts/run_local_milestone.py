"""Reproduce the local milestone without GPU, network, training or DSSAT.

uv run python scripts/run_local_milestone.py --output runs/local-milestone-001
uv run python scripts/run_local_milestone.py --catalogue-only --output runs
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fieldtwin_agents.contracts import CONFIGS, Task
from fieldtwin_agents.experiments import atomic_json, catalogue
from fieldtwin_agents.runner import run_batch
from fieldtwin_agents.stub import StubEnvironment, StubModel
from fieldtwin_agents.validation import audit_run


class UncertainStep(StubEnvironment):
    async def step(self, episode_id, action):
        # Simulate a server applying the action before a transport failure.
        await super().step(episode_id, action)
        raise TimeoutError("Injected failure after step application; never retry")


async def reproduce(output):
    output.mkdir(parents=True, exist_ok=False)
    tasks = [Task("UFGA-1990", "UFGA", year=1990), Task("UFGA-2009", "UFGA", year=2009)]
    completed = output / "completed"
    await run_batch(tasks, CONFIGS, StubEnvironment(2), StubModel(), completed,
                    experiment_kind="synthetic_plumbing")
    audit = audit_run(completed, require_live=False)
    atomic_json(output / "audit.json", audit)
    failed = output / "injected-failure"
    try:
        await run_batch(tasks[:1], ["single"], UncertainStep(2), StubModel(), failed,
                        experiment_kind="synthetic_plumbing")
    except RuntimeError:
        receipt = json.loads((failed / "receipts/single/UFGA-1990.json").read_text(encoding="utf-8"))
        if receipt["status"] != "failed" or not receipt["step_outcome_unknown"]:
            raise AssertionError("Injected failure was not preserved")
    else:
        raise AssertionError("Expected injected post-step failure")
    result = catalogue(output, output / "catalogue.json")
    print(json.dumps({"scope": "Synthetic plumbing only; no crop-performance evidence",
                      "completed_seasons": len(audit["seasons"]), "expected_failed_seasons": 1,
                      "experiments": len(result["experiments"]), "output": str(output)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New directory, or root to catalogue")
    parser.add_argument("--catalogue-only", action="store_true", help="Read receipts only; never run/retry steps")
    args = parser.parse_args()
    if args.catalogue_only:
        result = catalogue(args.output, args.output / "catalogue.json")
        print(json.dumps({"experiments": len(result["experiments"])}))
    else:
        asyncio.run(reproduce(args.output))


if __name__ == "__main__":
    main()
