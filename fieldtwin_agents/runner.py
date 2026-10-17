from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .agents import AgentTeam, PolicyFailure, PROMPT_ROOT
from .contracts import Action, CONFIGS, CSV_FIELDS, FINAL_FIELDS, EventLog, number, safe_name


def prompt_hashes(version):
    if version not in ("v1", "v2"):
        raise ValueError("Unknown prompt version")
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((PROMPT_ROOT / version).glob("*.txt"))}


def endpoint_identity(client):
    if not hasattr(client, "http"):
        return type(client).__name__
    url = urlsplit(str(client.http.base_url))
    return f"{url.scheme}://{url.hostname}:{url.port or (443 if url.scheme == 'https' else 80)}{url.path}"


def load_schedule(path=None):
    if path is None:
        # Temporary split schedule, explicitly pending A's authoritative farmer schedule.
        return {0: (40.0, 0.0), 5: (40.0, 0.0), 9: (40.0, 0.0)}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    result = {}
    for week, action in data.items():
        if not week.isdigit():
            raise ValueError("Schedule keys must be nonnegative week numbers")
        parsed = Action.parse({**action, "reason": "farmer fallback"})
        result[int(week)] = (parsed.n_kg_ha, parsed.irr_mm)
    return result


async def run_season(task, config, env, model, run_dir, *, n_cap=240.0,
                     schedule=None, prompt_version="v1", max_weeks=60):
    if config not in CONFIGS:
        raise ValueError("Unknown config")
    if task.split != "dev":
        raise ValueError("Person B never runs test tasks")
    if number(n_cap) < 0 or max_weeks <= 0:
        raise ValueError("Invalid nitrogen cap or season bound")
    schedule = load_schedule() if schedule is None else schedule
    agent = AgentTeam(model, env, config, prompt_version)
    log = EventLog(Path(run_dir) / config / f"{safe_name(task.task_id)}.jsonl")
    start, applied, fallbacks = time.perf_counter(), 0.0, 0
    try:
        reset = await env.reset(task)
        episode_id, obs, week = reset["episode_id"], reset["obs"], reset["week"]
        if week != 0:
            raise ValueError("Reset must start at week 0")
        log.emit(0, "coordinator", "message", {"episode_id": episode_id, "obs": obs,
                 "synthetic": bool(env.synthetic or model.synthetic), "prompt_version": prompt_version,
                 "prompt_hashes": prompt_hashes(prompt_version), "n_cap": n_cap})
        for _ in range(max_weeks):
            try:
                action = await agent.decide(obs, episode_id, week, n_cap - applied, log)
            except (PolicyFailure, httpx.HTTPError) as exc:
                fallbacks += 1
                n, irr = schedule.get(week, (0.0, 0.0))
                action = Action(n, irr, "Farmer schedule fallback: policy response unavailable or invalid.")
                log.emit(week, "coordinator", "fallback", {"cause": str(exc), "fallbacks": fallbacks,
                         "schedule_action": action.as_dict()})
            guarded = action.guarded(n_cap - applied)
            log.emit(week, "coordinator", "decision", {**guarded.as_dict(),
                     "guarded": action != guarded, "proposed": action.as_dict()})
            # Environment errors propagate. Retrying a timed-out step could double apply N.
            step = await env.step(episode_id, guarded)
            if type(step.get("done")) is not bool or step.get("week") != week + 1:
                raise ValueError("Step must advance exactly one week and return boolean done")
            applied += guarded.n_kg_ha
            log.emit(week, "coordinator", "tool_result", {"name": "step", "result": step})
            obs, week = step["obs"], step["week"]
            if step["done"]:
                final = step["final"]
                for name in FINAL_FIELDS:
                    number(final[name])
                return {"config": config, "task_id": task.task_id, "split": task.split,
                        **{k: final[k] for k in FINAL_FIELDS}, "llm_calls": agent.llm_calls,
                        "wall_s": round(time.perf_counter() - start, 4), "fallbacks": fallbacks}
        raise RuntimeError(f"Episode exceeded {max_weeks} weeks")
    finally:
        log.close()


async def run_batch(tasks, configs, env, model, output, *, concurrency=8, **kwargs):
    tasks, configs = list(tasks), list(configs)
    if not tasks or any(t.split != "dev" for t in tasks):
        raise ValueError("Dev-only nonempty tasks required")
    if not configs or any(c not in CONFIGS for c in configs) or len(set(configs)) != len(configs):
        raise ValueError("Unique valid configs required")
    if len({t.task_id for t in tasks}) != len(tasks) or concurrency <= 0:
        raise ValueError("Unique tasks and positive concurrency required")
    output = Path(output)
    # Reserve an entire run directory, preventing partial overwrites or mixed evaluations.
    output.mkdir(parents=True, exist_ok=False)
    version = kwargs.get("prompt_version", "v1")
    metadata = {"synthetic": bool(env.synthetic or model.synthetic), "configs": configs,
                "task_ids": [t.task_id for t in tasks], "split": "dev", "concurrency": concurrency,
                "task_specs": [t.reset_body() for t in tasks],
                "model": getattr(model, "model", type(model).__name__), "environment": endpoint_identity(env),
                "prompt_version": version, "prompt_hashes": prompt_hashes(version),
                "n_cap": kwargs.get("n_cap", 240.0), "fallback_schedule": kwargs.get("schedule", load_schedule())}
    (output / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    semaphore = asyncio.Semaphore(concurrency)
    async def one(task, config):
        async with semaphore:
            return await run_season(task, config, env, model, output / "runs", **kwargs)
    results = await asyncio.gather(*(one(t, c) for c in configs for t in tasks), return_exceptions=True)
    rows = [r for r in results if isinstance(r, dict)]
    with (output / "eval.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    errors = [str(r) for r in results if isinstance(r, BaseException)]
    if errors:
        (output / "errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
        raise RuntimeError(f"{len(errors)} seasons failed; partial results and errors saved under {output}")
    return rows
