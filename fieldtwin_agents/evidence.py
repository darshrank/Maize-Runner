"""Versioned local evidence and decision identities; no simulator contract changes."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass

from .contracts import Action, number

FACTS_VERSION = 1


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def identity(kind, value):
    return f"{kind}:{hashlib.sha256(canonical(value).encode()).hexdigest()}"


@dataclass(frozen=True)
class Fact:
    episode_id: str
    week: int
    name: str
    value: float | str | bool
    unit: str
    source: str
    path: str
    uncertainty: str

    def as_dict(self):
        data = asdict(self)
        return {"fact_id": identity("fact", data), **data}


# Only documented fields are interpreted. Unknown fields remain in raw evidence.
UNITS = {
    "soil_water_frac": "fraction", "soil_water_mm": "mm", "soil_n_kg_ha": "kg N/ha",
    "n_applied_total": "kg N/ha", "n_applied": "kg N/ha",
    "n_remaining_season_cap": "kg N/ha", "remaining_n_kg_ha": "kg N/ha",
    "season_cap_kg_ha": "kg N/ha", "applied_n_kg_ha": "kg N/ha",
    "max_n_kg_ha_per_week": "kg N/ha/week", "max_irr_mm_per_week": "mm/week",
    "irr_total_mm": "mm", "irr_mm": "mm", "n_kg_ha": "kg N/ha",
    "biomass_kg_ha": "kg/ha", "spend_usd": "USD/ha", "stage": "stage",
    "n_stress": "contract-specific index", "water_stress": "contract-specific index",
    "rain_mm": "mm", "tmax": "degC", "tmin": "degC", "temp_c": "degC",
    "day": "day", "week": "week", "gdd": "degC day",
}


class WeekEvidence:
    """Append-only raw snapshots and frozen facts, scoped to one episode/week.

    Tool reads are added only after permission checks. A snapshot contains no hidden
    state and no inferred values from specialist prose. Numeric uncertainty is
    unknown unless supplied by a separately versioned contract.
    """

    def __init__(self, episode_id, week, obs, remaining_n, accounting=None):
        if not isinstance(episode_id, str) or not episode_id or type(week) is not int or week < 0:
            raise ValueError("Evidence needs an episode ID and nonnegative integer week")
        self.episode_id, self.week = episode_id, week
        self._raw, self._facts = {}, {}
        self.add("observation", obs)
        runtime = {"remaining_n_kg_ha": number(remaining_n), **(accounting or {})}
        if "season_cap_kg_ha" in runtime and "applied_n_kg_ha" in runtime:
            computed = number(runtime["season_cap_kg_ha"]) - number(runtime["applied_n_kg_ha"])
            if abs(computed - remaining_n) > 1e-8:
                raise ValueError("Runner budget arithmetic disagrees with supplied remaining nitrogen")
            runtime["remaining_n_calculation"] = "season_cap_kg_ha - applied_n_kg_ha"
        self.add("runner", runtime)
        moisture = obs.get("soil_water_frac")
        if moisture is not None:
            from agents.policies.farmer import DRY_FRAC
            self._put("farmer_reference_dry", number(moisture) < DRY_FRAC, "boolean",
                      "derived:original_farmer", f"observation.soil_water_frac < {DRY_FRAC}",
                      "Exact comparison of reported value; reference only, not an agronomic constraint")

    def _put(self, name, value, unit, source, path, uncertainty):
        fact = Fact(self.episode_id, self.week, name, value, unit, source, path, uncertainty)
        self._facts[fact.as_dict()["fact_id"]] = fact

    def add(self, source, raw):
        encoded = canonical(raw)  # detach nested mutable tool results
        if source in self._raw and self._raw[source] != encoded:
            raise ValueError(f"Evidence changed within one week: {source}")
        self._raw[source] = encoded

        def walk(value, path="", forecast=False):
            if isinstance(value, dict):
                for key, item in value.items():
                    location = f"{path}.{key}" if path else key
                    noisy = forecast or key in ("outlook", "outlook_7d")
                    if key in UNITS and not isinstance(item, (dict, list)):
                        if key == "stage":
                            if not isinstance(item, str):
                                raise ValueError("Stage must be text")
                        elif key in ("n_stress", "water_stress") and type(item) is bool:
                            pass  # legacy synthetic semantics differ from DSSAT
                        else:
                            number(item)
                        uncertainty = ("Noisy forecast; error bounds not supplied" if noisy else
                                       "Exact runner accounting" if source == "runner" else
                                       "Reported simulator value; rounding/model error not quantified")
                        self._put(key, item, UNITS[key], source, location, uncertainty)
                    else:
                        walk(item, location, noisy)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    walk(item, f"{path}[{index}]", forecast)
        walk(json.loads(encoded))
        if source == "get_weather" and isinstance(raw, dict):
            for group in ("history", "observed_14d", "outlook", "outlook_7d"):
                days = raw.get(group)
                if not isinstance(days, list) or not days:
                    continue
                rain = [number(day["rain_mm"]) for day in days if isinstance(day, dict) and "rain_mm" in day]
                if len(rain) != len(days):
                    continue  # never present a partial sum as a complete period
                uncertainty = ("Noisy forecast; error bounds not supplied" if group.startswith("outlook") else
                               "Sum of reported history; rounding/model error not quantified")
                self._put(f"{group}_rain_total", sum(rain), "mm", source,
                          f"sum({group}[*].rain_mm); {len(days)} reported days", uncertainty)

    def snapshot(self, sources=None):
        return {"schema_version": FACTS_VERSION, "episode_id": self.episode_id, "week": self.week,
                "facts": [self._facts[key].as_dict() for key in sorted(self._facts)
                          if sources is None or self._facts[key].source in sources
                          or self._facts[key].source.startswith("derived:")],
                "raw_evidence": {key: json.loads(value) for key, value in sorted(self._raw.items())
                                 if sources is None or key in sources}}

    def model_snapshot(self, sources=None):
        """Bound duplication: daily/history rows stay raw in logs/tool responses.

        Current scalar facts and code-computed rain totals travel onward. Their
        full fact IDs still resolve to the complete persisted evidence snapshot.
        """
        snapshot = self.snapshot(sources)
        raw = snapshot.pop("raw_evidence")
        snapshot["raw_source_ids"] = {key: identity("evidence", value) for key, value in raw.items()}
        snapshot["facts"] = [fact for fact in snapshot["facts"]
                             if "[" not in fact["path"] or fact["path"].startswith("sum(")]
        return snapshot


@dataclass(frozen=True)
class Proposal:
    episode_id: str
    week: int
    stage: str
    action: Action
    parent_id: str | None = None

    def as_dict(self):
        data = {"episode_id": self.episode_id, "week": self.week, "stage": self.stage,
                "action": self.action.as_dict(), "parent_id": self.parent_id}
        return {"proposal_id": identity("proposal", data), **data}


@dataclass(frozen=True)
class Review:
    proposal_id: str
    accept: bool
    objection: str

    def as_dict(self):
        data = asdict(self)
        return {"review_id": identity("review", data), **data}


def verify_final(proposal, final, remaining_n, max_n, max_irr, *, reviewed_id=None):
    """Verify exact post-guard action. This does not certify natural-language reasons."""
    remaining_n, max_n, max_irr = map(number, (remaining_n, max_n, max_irr))
    if min(remaining_n, max_n, max_irr) < 0:
        raise ValueError("Negative action budget")
    for value in (final.n_kg_ha, final.irr_mm):
        number(value)
    if final != final.guarded(remaining_n, max_n, max_irr):
        raise ValueError("Final action violates runtime limits")
    data = {"episode_id": proposal.episode_id, "week": proposal.week,
            "source_proposal": proposal.as_dict(), "final_action": final.as_dict(),
            "reviewed_proposal_id": reviewed_id,
            "exact_final_reviewed": reviewed_id == Proposal(proposal.episode_id, proposal.week,
                proposal.stage, final, proposal.parent_id).as_dict()["proposal_id"],
            "checks": {"finite": True, "weekly_n": final.n_kg_ha <= max_n,
                       "season_n": final.n_kg_ha <= remaining_n, "weekly_irrigation": final.irr_mm <= max_irr},
            "remaining_n_before_kg_ha": remaining_n,
            "remaining_n_after_kg_ha": remaining_n - final.n_kg_ha,
            "guard_changed_action": final != proposal.action,
            "semantic_review": "Not certified; critic binds only to its named planner proposal"}
    return {"verification_id": identity("verification", data), **data}
