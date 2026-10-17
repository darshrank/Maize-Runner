"""Play one season with a policy and write the run log.

  uv run python -m agents.run --policy farmer --task-id UFGA-s3 [--split dev]

Log (FROZEN): runs/<config>/<task_id>.jsonl, one JSON object per line:
  {"t": iso_time, "week": int, "agent": "...", "kind": "...", "data": {...}}
Also updates runs/index.json: {"<config>": ["<task_id>", ...]} for the UI.
"""

import argparse
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

from agents.client import EnvClient
from agents.policies import Policy, make_policy

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "runs"
_index_lock = threading.Lock()


def load_config() -> dict:
    with open(os.environ.get("FIELDTWIN_CONFIG", ROOT / "config.yaml")) as f:
        return yaml.safe_load(f)


def load_tasks(split: str) -> list[dict]:
    with open(ROOT / "tasks" / f"{split}.jsonl") as f:
        return [json.loads(line) for line in f if line.strip()]


def find_task(task_id: str, split: str | None = None) -> dict:
    for s in [split] if split else ["dev", "test"]:
        for task in load_tasks(s):
            if task["task_id"] == task_id:
                return task
    raise SystemExit(f"task {task_id!r} not found in split {split or 'dev/test'}")


class RunLogger:
    """Collects log events in memory; save() writes runs/<config>/<task_id>.jsonl.

    Buffering lets eval/hindsight.py play many candidate seasons and keep only the best log.
    LLM policies should bump `llm_calls` per model call; `fallback` events are counted automatically.
    """

    def __init__(self, config: str, task_id: str):
        self.config, self.task_id = config, task_id
        self.events: list[dict] = []
        self.llm_calls = 0
        self.fallbacks = 0

    def event(self, week: int, agent: str, kind: str, data) -> None:
        if kind == "fallback":
            self.fallbacks += 1
        self.events.append({"t": datetime.now(timezone.utc).isoformat(), "week": int(week),
                            "agent": agent, "kind": kind, "data": data})

    def save(self) -> Path:
        path = RUNS_DIR / self.config / f"{self.task_id}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            for e in self.events:
                f.write(json.dumps(e) + "\n")
        update_index(self.config, self.task_id)
        return path


def update_index(config: str, task_id: str) -> None:
    """Add (config, task_id) to runs/index.json (thread-safe, atomic replace)."""
    path = RUNS_DIR / "index.json"
    with _index_lock:
        index = json.loads(path.read_text()) if path.exists() else {}
        tasks = set(index.get(config, []))
        tasks.add(task_id)
        index[config] = sorted(tasks, key=lambda t: (len(t), t))
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(index, indent=1, sort_keys=True))
        tmp.replace(path)


def play_season(policy: Policy, task: dict, env: EnvClient, log: RunLogger) -> dict:
    """Reset, ask the policy each week, step until done. Returns the final dict."""
    reset = env.reset(task)
    log.event(0, "env", "message", {"reset": reset, "task": task})
    episode_id, obs, week = reset["episode_id"], reset["obs"], reset["week"]
    while True:
        d = policy.decide(episode_id, week, obs, env, log)
        log.event(week, getattr(policy, "decision_agent", "policy"), "decision",
                  {"n_kg_ha": d.n_kg_ha, "irr_mm": d.irr_mm, "reason": d.reason})
        resp = env.step(episode_id, d.n_kg_ha, d.irr_mm, d.reason)
        log.event(week, "env", "step_result", resp)
        obs, week = resp["obs"], resp["week"]
        if resp["done"]:
            log.event(week, "env", "final", resp["final"])
            return resp["final"]


def run_one(config: str, task: dict, env_url: str) -> tuple[dict, dict]:
    """Play and save one season. Returns (final, stats) with stats = llm_calls, fallbacks, wall_s."""
    t0 = time.time()
    env = EnvClient(env_url)
    log = RunLogger(config, task["task_id"])
    try:
        final = play_season(make_policy(config), task, env, log)
    finally:
        env.close()
        if log.events:
            log.save()
    return final, {"llm_calls": log.llm_calls, "fallbacks": log.fallbacks,
                   "wall_s": round(time.time() - t0, 2)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Play one FieldTwin season with a policy.")
    ap.add_argument("--policy", required=True)
    ap.add_argument("--task-id", required=True)
    ap.add_argument("--split", default=None, help="dev or test (default: search both)")
    args = ap.parse_args()
    cfg = load_config()
    task = find_task(args.task_id, args.split)
    from fieldtwin_agents.contracts import CONFIGS
    if args.policy in CONFIGS and task["split"] != "dev":
        ap.error("Interactive Nemotron runs are dev-only; Person A owns held-out evaluation via eval.run_eval")
    final, _ = run_one(args.policy, task, cfg["env"]["url"])
    print(json.dumps(final, indent=2))


if __name__ == "__main__":
    main()
