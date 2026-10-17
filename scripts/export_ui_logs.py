"""Derive UI-format replay logs from a completed native run without touching it.

Writes runs/<config>/<task_id>.jsonl, runs/index.json and runs/export-manifest.json.
Transformations (display only; decisions, results and order are unchanged):
- critic verdict messages gain {"text", "objection": bool} beside the raw content;
- tool_call args become an object (raw string kept as args_raw if not an object);
- the reset line's task gains "split" from the dev task file.
Source logs keep their receipt/audit SHA-256 hashes; the manifest records them.

    python scripts/export_ui_logs.py RUN_DIR --configs multi [--output runs]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fieldtwin_agents.agents import critic_log_fields, tool_args_fields
from fieldtwin_agents.contracts import load_dev_tasks


def transform(event, splits):
    data, agent, kind = event["data"], event.get("agent"), event["kind"]
    if kind == "tool_call" and isinstance(data.get("args"), str):
        data = {**data, **tool_args_fields(data["args"])}
    elif agent == "critic" and kind == "message" and set(data) == {"content"}:
        try:
            verdict = json.loads(data["content"])
        except ValueError:
            verdict = None
        if isinstance(verdict, dict) and type(verdict.get("accept")) is bool:
            data = {**data, **critic_log_fields(verdict)}
    elif kind == "message" and "reset" in data and "task" in data and "split" not in data["task"]:
        data = {**data, "task": {**data["task"], "split": splits[data["task"]["task_id"]]}}
    return {**event, "data": data}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--configs", nargs="+", default=["multi"])
    ap.add_argument("--output", default="runs")
    ap.add_argument("--tasks", default="tasks/dev.jsonl")
    args = ap.parse_args(argv)
    run, out = Path(args.run_dir), Path(args.output)
    splits = {t.task_id: t.split for t in load_dev_tasks(Path(args.tasks))}
    source_index = json.loads((run / "runs/index.json").read_text(encoding="utf-8"))
    index, sources = {}, {}
    for config in args.configs:
        (out / config).mkdir(parents=True, exist_ok=True)
        index[config] = []
        for task_id in source_index[config]:
            src = run / "runs" / config / f"{task_id}.jsonl"
            raw = src.read_bytes()
            events = [transform(json.loads(line), splits) for line in raw.decode("utf-8").splitlines() if line.strip()]
            dest = out / config / f"{task_id}.jsonl"
            dest.write_bytes("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events).encode("utf-8"))
            index[config].append(task_id)
            sources[f"{config}/{task_id}"] = {"source_sha256": hashlib.sha256(raw).hexdigest(),
                                              "export_sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}
    (out / "index.json").write_bytes((json.dumps(index, indent=2) + "\n").encode("utf-8"))
    manifest = {"exported_at": datetime.now(timezone.utc).isoformat(), "source_run": str(run),
                "derived": True, "configs": args.configs, "logs": sources,
                "transformations": ["critic verdict: add text and boolean objection beside raw content",
                                    "tool_call args: JSON string to object; args_raw kept if not an object",
                                    "reset task: add split from dev task file"],
                "note": "Display copy for the UI. Audits and receipts refer to the source logs."}
    (out / "export-manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({"configs": {k: len(v) for k, v in index.items()}, "output": str(out)}))


if __name__ == "__main__":
    main()
