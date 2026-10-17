"""Validate run logs, runs/index.json and results/eval.csv against the frozen contracts.

  uv run python -m lanec.scripts.validate_logs <path>...

Each path may be a .jsonl agent log, a folder of them (searched recursively),
an index.json, or an eval.csv. Every mismatch prints as `file:line: problem`.
Exit 0 when clean, 1 on any mismatch.

Rule sources:
- Agent log line, kinds, agents, decision/step_result/final data: SKELETON_SPEC.md sections 5, 7, 8.
- tool_call/tool_result data ({name, args} / {name, result}): Policy.call_tool in agents/policies/base.py
  (the spec only says data is an object).
- index.json: update_index() in agents/run.py.
- eval.csv columns: COLUMNS imported from eval.run_eval.
"""

import csv
import json
import sys
from datetime import datetime
from pathlib import Path

from agents.run import load_config
from eval.run_eval import COLUMNS

# SKELETON_SPEC.md section 8.
LINE_KEYS = {"t", "week", "agent", "kind", "data"}
AGENTS = {"weather", "crop", "planner", "critic", "coordinator", "policy", "env"}
KINDS = {"tool_call", "tool_result", "message", "decision", "fallback", "step_result", "final"}

NUM, INT, STR, BOOL, OBJ, ANY = "number", "int", "str", "bool", "object", "any"

# SKELETON_SPEC.md section 5 (obs, weekly, simulator final) and section 7 (/step response, money).
OBS = {"day": INT, "week": INT, "stage": STR, "soil_water_frac": NUM, "soil_n_kg_ha": NUM,
       "n_applied_total": NUM, "irr_total_mm": NUM, "biomass_kg_ha": NUM}
WEEKLY = {"rain_mm": NUM, "n_leached": NUM, "n_uptake": NUM, "n_gas": NUM}
FINAL = {"grain_kg_ha": NUM, "n_applied": NUM, "n_uptake": NUM, "n_leached": NUM, "n_gas": NUM,
         "irr_mm": NUM, "profit_usd_ha": NUM, "reward": NUM}
STEP = {"obs": OBS, "week": INT, "done": BOOL, "weekly": WEEKLY, "clamped": BOOL}
DECISION = {"n_kg_ha": NUM, "irr_mm": NUM, "reason": STR}
# agents/policies/base.py Policy.call_tool.
TOOL_CALL = {"name": STR, "args": OBJ}
TOOL_RESULT = {"name": STR, "result": ANY}

DATA_RULES = {"decision": DECISION, "step_result": STEP, "final": FINAL,
              "tool_call": TOOL_CALL, "tool_result": TOOL_RESULT}

# eval.csv: columns that must parse as numbers / integers (spec section 9).
CSV_TEXT = {"config", "task_id", "split"}
CSV_INT = {"llm_calls", "fallbacks"}


def type_ok(value, kind: str) -> bool:
    if kind == ANY:
        return True
    if kind == BOOL:
        return isinstance(value, bool)
    if kind == INT:
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == NUM:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == STR:
        return isinstance(value, str)
    if kind == OBJ:
        return isinstance(value, dict)
    raise ValueError(kind)


def check_fields(obj, rules: dict, where: str) -> list[str]:
    """Required keys and types; nested dict rules recurse. Extra keys are allowed."""
    if not isinstance(obj, dict):
        return [f"{where} must be an object, got {type(obj).__name__}"]
    problems = []
    for key, rule in rules.items():
        if key not in obj:
            problems.append(f"{where} missing key {key!r}")
        elif isinstance(rule, dict):
            problems += check_fields(obj[key], rule, f"{where}.{key}")
        elif not type_ok(obj[key], rule):
            problems.append(f"{where}.{key} must be {rule}, got {type(obj[key]).__name__} {obj[key]!r}")
    return problems


def check_log_line(e, max_week: int) -> list[str]:
    if not isinstance(e, dict):
        return [f"line must be a JSON object, got {type(e).__name__}"]
    problems = []
    missing, extra = LINE_KEYS - e.keys(), e.keys() - LINE_KEYS
    if missing:
        problems.append(f"missing keys {sorted(missing)}")
    if extra:
        problems.append(f"unexpected keys {sorted(extra)} (contract is exactly {sorted(LINE_KEYS)})")

    if "t" in e:
        if not isinstance(e["t"], str):
            problems.append(f"t must be an ISO time string, got {type(e['t']).__name__}")
        else:
            try:
                datetime.fromisoformat(e["t"])
            except ValueError:
                problems.append(f"t is not ISO 8601: {e['t']!r}")
    if "week" in e:
        if not type_ok(e["week"], INT):
            problems.append(f"week must be int, got {type(e['week']).__name__} {e['week']!r}")
        elif not 0 <= e["week"] <= max_week:
            problems.append(f"week {e['week']} outside 0..{max_week} (config env.weeks_per_season)")
    if "agent" in e and e["agent"] not in AGENTS:
        problems.append(f"agent {e['agent']!r} not in {sorted(AGENTS)}")
    if "kind" in e and e["kind"] not in KINDS:
        problems.append(f"kind {e['kind']!r} not in {sorted(KINDS)}")

    if "data" in e:
        kind, data = e.get("kind"), e["data"]
        if kind in DATA_RULES:
            problems += check_fields(data, DATA_RULES[kind], "data")
        elif not isinstance(data, dict):
            problems.append(f"data must be an object, got {type(data).__name__}")
        # Line week = the decision week; data.week = the week after the step (agents/run.py play_season).
        if kind == "step_result" and isinstance(data, dict):
            if data.get("done") is True:
                if "final" not in data:
                    problems.append("data.done is true but data.final is missing")
                else:
                    problems += check_fields(data["final"], FINAL, "data.final")
    return problems


def validate_jsonl(path: Path, max_week: int) -> list[str]:
    out = []
    with open(path) as f:
        lines = f.readlines()
    if not lines:
        return [f"{path}:0: empty log"]
    for n, raw in enumerate(lines, 1):
        if not raw.strip():
            out.append(f"{path}:{n}: blank line")
            continue
        try:
            e = json.loads(raw)
        except json.JSONDecodeError as err:
            out.append(f"{path}:{n}: invalid JSON: {err.msg}")
            continue
        out += [f"{path}:{n}: {p}" for p in check_log_line(e, max_week)]
    return out


def line_of(text: str, needle: str) -> int:
    for n, line in enumerate(text.splitlines(), 1):
        if needle in line:
            return n
    return 1


def validate_index(path: Path) -> list[str]:
    """Format written by update_index(): {config: sorted unique task_ids}, sort key (len, id)."""
    text = path.read_text()
    try:
        index = json.loads(text)
    except json.JSONDecodeError as err:
        return [f"{path}:{err.lineno}: invalid JSON: {err.msg}"]
    if not isinstance(index, dict):
        return [f"{path}:1: top level must be an object {{config: [task_id, ...]}}"]
    out = []
    for config, tasks in index.items():
        n = line_of(text, json.dumps(config))
        if not isinstance(tasks, list) or not all(isinstance(t, str) for t in tasks):
            out.append(f"{path}:{n}: {config!r} must map to a list of task_id strings")
            continue
        if len(set(tasks)) != len(tasks):
            out.append(f"{path}:{n}: {config!r} has duplicate task_ids")
        if tasks != sorted(set(tasks), key=lambda t: (len(t), t)):
            out.append(f"{path}:{n}: {config!r} task_ids not sorted by (len, id) as update_index() writes")
        for t in tasks:
            log = path.parent / config / f"{t}.jsonl"
            if not log.exists():
                out.append(f"{path}:{line_of(text, json.dumps(t))}: {config}/{t} listed but {log} is missing")
    return out


def validate_csv(path: Path) -> list[str]:
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return [f"{path}:0: empty file"]
    out = []
    if rows[0] != COLUMNS:
        out.append(f"{path}:1: header {rows[0]} != eval.run_eval.COLUMNS {COLUMNS}")
    seen = set()
    for n, row in enumerate(rows[1:], 2):
        if len(row) != len(COLUMNS):
            out.append(f"{path}:{n}: {len(row)} cells, expected {len(COLUMNS)}")
            continue
        r = dict(zip(COLUMNS, row))
        for col in COLUMNS:
            if col in CSV_TEXT:
                if not r[col]:
                    out.append(f"{path}:{n}: {col} is empty")
                continue
            try:
                v = float(r[col])
            except ValueError:
                out.append(f"{path}:{n}: {col} not a number: {r[col]!r}")
                continue
            if col in CSV_INT and v != int(v):
                out.append(f"{path}:{n}: {col} must be an integer: {r[col]!r}")
        key = (r["config"], r["task_id"])
        if key in seen:
            out.append(f"{path}:{n}: duplicate row for config {key[0]!r} task {key[1]!r}")
        seen.add(key)
    return out


def validate_path(path: Path, max_week: int) -> list[str]:
    if not path.exists():
        return [f"{path}:0: path does not exist"]
    if path.is_dir():
        logs = sorted(path.rglob("*.jsonl"))
        if not logs:
            return [f"{path}:0: no .jsonl files in folder"]
        return [p for log in logs for p in validate_jsonl(log, max_week)]
    if path.name == "index.json":
        return validate_index(path)
    if path.suffix == ".csv":
        return validate_csv(path)
    if path.suffix == ".jsonl":
        return validate_jsonl(path, max_week)
    return [f"{path}:0: unknown file type (expected .jsonl, folder, index.json or .csv)"]


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 1
    max_week = int(load_config()["env"]["weeks_per_season"])
    problems = [p for arg in argv for p in validate_path(Path(arg), max_week)]
    for p in problems:
        print(p)
    print(f"{'FAIL' if problems else 'OK'}: {len(problems)} mismatch(es) in {len(argv)} path(s)",
          file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
