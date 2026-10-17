"""Code guard shared by all designs: clamp actions in code (not in the prompt) and fall back
to farmer practice when the model fails. Fallbacks are logged and counted, never hidden."""

from agents.policies.base import Decision
from agents.policies.farmer_ufga import IRR_BY_WEEK, N_BY_WEEK

MAX_N_WEEK, MAX_IRR_WEEK, MAX_N_SEASON = 120.0, 50.0, 300.0


def clamp(n_kg_ha, irr_mm, n_applied_so_far: float) -> tuple[float, float]:
    """Weekly limits and the season N cap (the env clamps too; we do it first so logs show real actions)."""
    n = min(max(float(n_kg_ha), 0.0), MAX_N_WEEK, max(0.0, MAX_N_SEASON - n_applied_so_far))
    irr = min(max(float(irr_mm), 0.0), MAX_IRR_WEEK)
    return round(n, 1), round(irr, 1)


def fallback(week: int, why: str, log, agent: str = "policy") -> Decision:
    """This week's farmer-practice action (farmer_ufga schedule), logged as a fallback."""
    n, irr = N_BY_WEEK.get(week, 0.0), IRR_BY_WEEK.get(week, 0.0)
    log.event(week, agent, "fallback", {"reason": why, "n_kg_ha": n, "irr_mm": irr})
    return Decision(n, irr, f"Fallback to farmer schedule ({why}).")
