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
        return None  # Use the shared adaptive farmer policy.
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    result = {}
    for week, action in data.items():
        if not week.isdigit():
            raise ValueError("Schedule keys must be nonnegative week numbers")
        parsed = Action.parse({**action, "reason": "farmer fallback"})
        result[int(week)] = (parsed.n_kg_ha, parsed.irr_mm)
    return result


async def run_season(task, config, env, model, run_dir, *, n_cap=None,
                     schedule=None, prompt_version="v1", max_weeks=60):
    if config not in CONFIGS:
        raise ValueError("Unknown config")
    if task.split != "dev":
        raise ValueError("Person B never runs test tasks")
    from .management import environment_limits, farmer_fallback
    limits = environment_limits()
    n_cap = limits["max_n_kg_ha_per_season"] if n_cap is None else n_cap
    if number(n_cap) < 0 or max_weeks <= 0:
        raise ValueError("Invalid nitrogen cap or season bound")
    agent = AgentTeam(model, env, config, prompt_version)
    log = EventLog(Path(run_dir) / config / f"{safe_name(task.task_id)}.jsonl")
    start, applied, fallbacks = time.perf_counter(), 0.0, 0
    try:
        reset = await env.reset(task)
        episode_id, obs, week = reset["episode_id"], reset["obs"], reset["week"]
        if week != 0:
            raise ValueError("Reset must start at week 0")
        log.emit(0, "env", "message", {"reset": reset, "task": task.reset_body()})
        log.emit(0, "coordinator", "message", {"episode_id": episode_id, "obs": obs,
                 "synthetic": bool(env.synthetic or model.synthetic), "prompt_version": prompt_version,
                 "prompt_hashes": prompt_hashes(prompt_version), "n_cap": n_cap})
        for _ in range(max_weeks):
            try:
                action = await agent.decide(obs, episode_id, week, n_cap - applied, log)
            except (PolicyFailure, httpx.HTTPError) as exc:
                fallbacks += 1
                action = farmer_fallback(week, obs, schedule)
                log.emit(week, "coordinator", "fallback", {"cause": str(exc), "fallbacks": fallbacks,
                         "schedule_action": action.as_dict()})
            guarded = action.guarded(n_cap - applied, limits["max_n_kg_ha_per_week"], limits["max_irr_mm_per_week"])
            if action != guarded:
                log.emit(week, "coordinator", "message", {"guarded": True, "proposed": action.as_dict()})
            log.emit(week, "coordinator", "decision", guarded.as_dict())
            # Environment errors propagate. Retrying a timed-out step could double apply N.
            step = await env.step(episode_id, guarded)
            if type(step.get("done")) is not bool or step.get("week") != week + 1:
                raise ValueError("Step must advance exactly one week and return boolean done")
            applied += guarded.n_kg_ha
            log.emit(week, "env", "step_result", step)
            obs, week = step["obs"], step["week"]
            if step["done"]:
                final = step["final"]
                for name in FINAL_FIELDS:
                    number(final[name])
                log.emit(week, "env", "final", final)
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
    from .management import environment_limits, management_provenance
    if kwargs.get("n_cap") is None:
        kwargs["n_cap"] = environment_limits()["max_n_kg_ha_per_season"]
    version = kwargs.get("prompt_version", "v1")
    metadata = {"synthetic": bool(env.synthetic or model.synthetic), "configs": configs,
                "task_ids": [t.task_id for t in tasks], "split": "dev", "concurrency": concurrency,
                "task_specs": [t.reset_body() for t in tasks],
                "model": getattr(model, "model", type(model).__name__), "environment": endpoint_identity(env),
                "prompt_version": version, "prompt_hashes": prompt_hashes(version),
                "n_cap": kwargs["n_cap"], "fallback_schedule": kwargs.get("schedule"),
                "management": management_provenance()}
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
    index = {c: [r["task_id"] for r in rows if r["config"] == c] for c in configs}
    (output / "runs").mkdir(exist_ok=True)
    (output / "runs" / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    if errors:
        (output / "errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
        raise RuntimeError(f"{len(errors)} seasons failed; partial results and errors saved under {output}")
    return rows
