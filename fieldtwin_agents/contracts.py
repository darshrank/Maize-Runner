from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

CONFIGS = ("single", "multi", "multi_no_critic", "multi_no_weather", "multi_no_tools")
TOOLS = ("get_weather", "get_crop_state", "get_soil", "get_history", "get_budget")
ROLE_TOOLS = {
    "weather": ("get_weather",),
    "crop": ("get_crop_state",),
    "planner": ("get_soil", "get_history"),
    "critic": ("get_budget", "get_soil"),
    "coordinator": TOOLS,
}
FINAL_FIELDS = ("grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas",
                "irr_mm", "profit_usd_ha", "reward")
CSV_FIELDS = ("config", "task_id", "split", *FINAL_FIELDS, "llm_calls", "wall_s", "fallbacks")


def safe_name(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value):
        raise ValueError(f"Unsafe identifier: {value!r}")
    return value


def number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Expected a finite JSON number")
    return float(value)


@dataclass(frozen=True)
class Task:
    task_id: str
    site: str
    weather_seed: int | None = None
    split: str = "dev"
    year: int | None = None

    def __post_init__(self):
        safe_name(self.task_id)
        if self.split not in ("dev", "test"):
            raise ValueError("Task split must be dev or test")
        if not self.site or (self.year is None and self.weather_seed is None):
            raise ValueError("Task needs a site and integer year or legacy weather_seed")
        for value in (self.year, self.weather_seed):
            if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
                raise ValueError("year and weather_seed must be integers")

    def reset_body(self):
        weather = {"year": self.year} if self.year is not None else {"weather_seed": self.weather_seed}
        return {"task_id": self.task_id, "site": self.site, **weather}


def load_dev_tasks(path: Path) -> list[Task]:
    # Validate the whole manifest before any network request; never silently filter test.
    data = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if any(not isinstance(row, dict) or row.get("split") != "dev" for row in data):
        raise ValueError("Each task must explicitly declare split=dev")
    tasks = [Task(**row) for row in data]
    for task in tasks:
        require_dev_task(task)
    if not tasks or any(t.split != "dev" for t in tasks):
        raise ValueError("Person B runs dev tasks only; test evaluation belongs to Person A")
    if len({t.task_id for t in tasks}) != len(tasks):
        raise ValueError("Duplicate task IDs")
    return tasks


def require_dev_task(task):
    if task.split != "dev" or (task.year is not None and not 1990 <= task.year <= 2009):
        raise ValueError("Person B runs dev years 1990-2009 only")


@dataclass(frozen=True)
class Action:
    n_kg_ha: float
    irr_mm: float
    reason: str

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict) or not {"n_kg_ha", "irr_mm", "reason"} <= data.keys():
            raise ValueError("Action needs n_kg_ha, irr_mm, reason")
        reason = data["reason"]
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Action reason must be nonempty text")
        return cls(number(data["n_kg_ha"]), number(data["irr_mm"]), " ".join(reason.split())[:300])

    def guarded(self, remaining_n: float, max_n=120.0, max_irr=50.0):
        return Action(max(0, min(max_n, remaining_n, self.n_kg_ha)),
                      max(0, min(max_irr, self.irr_mm)), self.reason)

    def as_dict(self):
        return {"n_kg_ha": self.n_kg_ha, "irr_mm": self.irr_mm, "reason": self.reason}


class EventLog:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents concatenating unrelated episodes on reruns.
        self.file = path.open("x", encoding="utf-8")

    def emit(self, week: int, agent: str, kind: str, data: dict):
        if agent not in (*ROLE_TOOLS, "policy", "env") or kind not in (
                "tool_call", "tool_result", "message", "decision", "fallback", "step_result", "final"):
            raise ValueError("Invalid event")
        event = {"t": datetime.now(timezone.utc).isoformat(), "week": week,
                 "agent": agent, "kind": kind, "data": data}
        self.file.write(json.dumps(event, allow_nan=False) + "\n")
        self.file.flush()
        if kind in ("decision", "step_result", "final") or "final_verification" in data:
            os.fsync(self.file.fileno())

    def close(self):
        self.file.close()
