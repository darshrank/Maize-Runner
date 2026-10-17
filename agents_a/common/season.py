"""Compact season summary given to every agent each week, so prompts stay small
(the vLLM server allows 16K tokens per request) instead of replaying the whole season."""

import json


def week_header(week: int, obs: dict) -> str:
    return (f"Week {week} (day {obs['day']} after planting). Stage {obs['stage']}. "
            f"Soil water {obs['soil_water_frac']:.2f} (0 wilting point, 1 field capacity), "
            f"soil N about {obs['soil_n_kg_ha']:.0f} kg/ha. Season so far: {obs['n_applied_total']:.0f} kg N/ha, "
            f"{obs['irr_total_mm']:.0f} mm irrigation, biomass {obs['biomass_kg_ha']:.0f} kg/ha.")


def history_table(history: list[dict], last: int = 6) -> str:
    """Last few weeks from get_history as short lines."""
    if not history:
        return "No weeks played yet."
    rows = [f"wk{h['week']}: N {h['n_kg_ha']:g}, irr {h['irr_mm']:g} mm, rain {h['rain_mm']:.0f} mm, "
            f"leached {h['n_leached']:.1f}, uptake {h['n_uptake']:.1f} kg/ha" for h in history[-last:]]
    return "\n".join(rows)


def compact(obj, limit: int = 1500) -> str:
    """JSON for a tool result, cut to a size that keeps prompts small."""
    text = json.dumps(obj, separators=(",", ":"))
    return text if len(text) <= limit else text[:limit] + "...(truncated)"
