from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .agents import AGENT_PROTOCOL_VERSION, AgentTeam, PolicyFailure, PROMPT_ROOT, PROMPT_VERSIONS
from .contracts import Action, CONFIGS, CSV_FIELDS, FINAL_FIELDS, EventLog, number, safe_name, require_dev_task
from .evidence import FACTS_VERSION, Proposal, verify_final
from .experiments import atomic_json, catalogue, now, season_telemetry, sha256, source_provenance


def prompt_hashes(version):
    if version not in PROMPT_VERSIONS:
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
    require_dev_task(task)
    if not env.synthetic and task.year is None:
        raise ValueError("Real environment runs require explicit dev years, not legacy seeds")
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
                 "agent_protocol_version": AGENT_PROTOCOL_VERSION,
                 "synthetic_environment": bool(env.synthetic), "synthetic_model": bool(model.synthetic),
                 "synthetic": bool(env.synthetic or model.synthetic), "prompt_version": prompt_version,
                 "prompt_hashes": prompt_hashes(prompt_version), "n_cap": n_cap})
        for _ in range(max_weeks):
            source = None
            try:
                action = await agent.decide(obs, episode_id, week, n_cap - applied, log, accounting={
                    "season_cap_kg_ha": n_cap, "applied_n_kg_ha": applied,
                    "max_n_kg_ha_per_week": limits["max_n_kg_ha_per_week"],
                    "max_irr_mm_per_week": limits["max_irr_mm_per_week"]})
                source = agent.final_proposal
            except (PolicyFailure, httpx.HTTPError) as exc:
                fallbacks += 1
                action = farmer_fallback(week, obs, schedule)
                log.emit(week, "coordinator", "fallback", {"cause": str(exc), "fallbacks": fallbacks,
                         "schedule_action": action.as_dict()})
            guarded = action.guarded(n_cap - applied, limits["max_n_kg_ha_per_week"], limits["max_irr_mm_per_week"])
            if action != guarded:
                log.emit(week, "coordinator", "message", {"guarded": True, "proposed": action.as_dict()})
            source = source or Proposal(episode_id, week, "fallback", action)
            verification = verify_final(source, guarded, n_cap - applied,
                limits["max_n_kg_ha_per_week"], limits["max_irr_mm_per_week"],
                reviewed_id=agent.reviewed_proposal_id)
            log.emit(week, "coordinator", "message", {"final_verification": verification,
                     "field_facts": agent.evidence.snapshot()})
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


async def run_batch(tasks, configs, env, model, output, *, concurrency=8,
                    experiment_kind="runtime", **kwargs):
    tasks, configs = list(tasks), list(configs)
    if not tasks or any(t.split != "dev" for t in tasks):
        raise ValueError("Dev-only nonempty tasks required")
    for task in tasks:
        require_dev_task(task)
        if not env.synthetic and task.year is None:
            raise ValueError("Real environment runs require explicit dev years")
    if experiment_kind not in ("runtime", "prompt_only", "thinking_mode", "synthetic_plumbing"):
        raise ValueError("Unknown experiment kind")
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
                "created_at": now(), "experiment_kind": experiment_kind,
                "facts_version": FACTS_VERSION, "source": source_provenance(tasks),
                "inference_settings": getattr(model, "inference_settings", {"synthetic": bool(model.synthetic)}),
                "selected_reference": "farmer_ufga", "fallback_policy": "original_farmer" if kwargs.get("schedule") is None else "custom_schedule",
                "agent_protocol_version": AGENT_PROTOCOL_VERSION,
                "synthetic_environment": bool(env.synthetic), "synthetic_model": bool(model.synthetic),
                "task_ids": [t.task_id for t in tasks], "split": "dev", "concurrency": concurrency,
                "task_specs": [t.reset_body() for t in tasks],
                "max_weeks": kwargs.get("max_weeks", 60),
                "model": getattr(model, "model", type(model).__name__), "environment": endpoint_identity(env),
                "environment_health": getattr(env, "health_snapshot", None),
                "prompt_version": version, "prompt_hashes": prompt_hashes(version),
                "n_cap": kwargs["n_cap"], "fallback_schedule": kwargs.get("schedule"),
                "management": management_provenance()}
    dev_reference = Path(__file__).resolve().parent.parent / "results/a2-integration-dev.json"
    metadata["reference_provenance"] = {"path": "results/a2-integration-dev.json",
                                        "sha256": sha256(dev_reference) if dev_reference.exists() else None}
    atomic_json(output / "manifest.json", metadata)
    semaphore = asyncio.Semaphore(concurrency)
    async def one(task, config):
        async with semaphore:
            receipt = output / "receipts" / config / f"{task.task_id}.json"
            atomic_json(receipt.with_suffix(".started.json"), {"started_at": now(), "config": config,
                        "task_id": task.task_id, "manifest_sha256": sha256(output / "manifest.json")})
            path = output / "runs" / config / f"{task.task_id}.jsonl"
            try:
                row = await run_season(task, config, env, model, output / "runs", **kwargs)
            except BaseException as exc:
                atomic_json(receipt, {"status": "failed" if isinstance(exc, Exception) else "interrupted",
                    "finished_at": now(), "error_type": type(exc).__name__, "error": str(exc),
                    "step_outcome_unknown": True, "log_sha256": sha256(path) if path.exists() else None,
                    "telemetry": season_telemetry(path) if path.exists() else None})
                raise
            atomic_json(receipt, {"status": "completed", "finished_at": now(), "result": row,
                "step_outcome_unknown": False, "log_sha256": sha256(path), "telemetry": season_telemetry(path)})
            return row
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
        catalogue(output, output / "catalogue.json")
        raise RuntimeError(f"{len(errors)} seasons failed; partial results and errors saved under {output}")
    catalogue(output, output / "catalogue.json")
    return rows
