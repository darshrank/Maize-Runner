"""Policy interface. A policy makes one decision per week.

Policies may call env.tool(name, episode_id) and must log every tool call and
its result through `log` (see RunLogger in agents/run.py and the frozen log
format in SKELETON_SPEC.md section 8).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents.client import EnvClient
    from agents.run import RunLogger


@dataclass
class Decision:
    n_kg_ha: float
    irr_mm: float
    reason: str


class Policy(ABC):
    name: str

    @abstractmethod
    def decide(self, episode_id: str, week: int, obs: dict, env: "EnvClient", log: "RunLogger") -> Decision: ...

    def call_tool(self, name: str, episode_id: str, week: int, env: "EnvClient", log: "RunLogger",
                  agent: str = "policy"):
        """Helper: call a read tool and log both the call and the result."""
        log.event(week, agent, "tool_call", {"name": name, "args": {"episode_id": episode_id}})
        result = env.tool(name, episode_id)
        log.event(week, agent, "tool_result", {"name": name, "result": result})
        return result
