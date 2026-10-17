"""Durable receipts, reproducibility metadata and an offline experiment catalogue."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, data):
    """Flush data before atomic replacement; directory metadata durability is OS dependent."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as out:
            json.dump(data, out, indent=2, allow_nan=False)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def source_provenance(tasks):
    def git(*args):
        result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    files = [p for folder in ("fieldtwin_agents", "agents", "env", "eval")
             for p in (ROOT / folder).rglob("*.py")]
    files += [ROOT / "config.yaml", ROOT / "agents/tools.json", ROOT / "uv.lock",
              ROOT / "pyproject.toml", ROOT / "scripts/run_local_milestone.py"]
    runtime = {p.relative_to(ROOT).as_posix(): sha256(p) for p in sorted(files) if p.exists()}
    data = {}
    for task in tasks:
        if task.year is None:
            continue
        for path in (ROOT / f"data/weather/{task.site}_{task.year}.json",
                     ROOT / f"data/dssat_wth/{task.site}{task.year % 100:02}01.WTH"):
            data[path.relative_to(ROOT).as_posix()] = sha256(path) if path.exists() else None
    try:
        commit, dirty = git("rev-parse", "HEAD"), git("diff", "HEAD", "--name-only").splitlines()
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = None, None
    return {"commit": commit, "tracked_dirty_paths": dirty, "runtime_sha256": runtime,
            "data_sha256": data, "python": sys.version, "platform": platform.platform(),
            "local_files_only": True,
            "remote_artifacts": "Model revision, server image and DSSAT binary require external attestation"}


def season_telemetry(log_path):
    events = [json.loads(line) for line in Path(log_path).read_text(encoding="utf-8").splitlines()]
    calls = [e["data"]["inference"] for e in events if "inference" in e["data"]]
    tokens = {}
    for call in calls:
        for key, value in (call.get("usage") or {}).items():
            if type(value) in (int, float):
                tokens[key] = tokens.get(key, 0) + value
    return {"model_calls": len(calls), "usage_reported_calls": sum(c.get("usage") is not None for c in calls),
            "tokens": tokens or None, "request_latency_s": sum(c["latency_s"] for c in calls),
            "finish_reasons": [c.get("finish_reason") for c in calls],
            "validation_errors": [e["data"] for e in events if "validation_error" in e["data"]],
            "errors": [c for c in calls if "error_type" in c],
            "allocated_gpu_seconds": None, "cost_usd": None,
            "cost_note": "Not measured; request latency is not allocated GPU time"}


def catalogue(root, output):
    """Rebuild from durable files. Never reset an episode or retry an uncertain step."""
    root = Path(root)
    entries = []
    for manifest_path in sorted(root.rglob("manifest.json")):
        folder = manifest_path.parent
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if "configs" not in manifest or "task_ids" not in manifest:
            continue
        seasons = []
        for config in manifest["configs"]:
            for task in manifest["task_ids"]:
                receipt = folder / "receipts" / config / f"{task}.json"
                started = folder / "receipts" / config / f"{task}.started.json"
                if receipt.exists():
                    record = json.loads(receipt.read_text(encoding="utf-8"))
                    seasons.append({"config": config, "task_id": task, **record})
                else:
                    seasons.append({"config": config, "task_id": task,
                                    "status": "interrupted_or_running" if started.exists() else
                                              "legacy_receipt_unavailable" if manifest.get("agent_protocol_version", 1) < 3 else "not_started",
                                    "step_outcome_unknown": started.exists()})
        entries.append({"run": str(folder), "manifest_sha256": sha256(manifest_path),
                        "experiment_kind": manifest.get("experiment_kind", "historical_unclassified"),
                        "synthetic": manifest.get("synthetic"), "seasons": seasons})
    result = {"schema_version": 1, "updated_at": now(), "experiments": entries,
              "recovery": "Read completed receipts; interrupted/running steps must not be replayed automatically"}
    atomic_json(output, result)
    return result
