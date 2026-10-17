"""Check that gym-DSSAT plays the chosen real year (step 4 of the NASA POWER task).

  uv run python scripts/validate_dssat_years.py [1990 2005 2015]   (needs gym-DSSAT)

For each year: play the farmer schedule (60/60/40 kg N at weeks 0/5/9, 25 mm when
soil_water_frac < 0.35), then compare every day DSSAT reported (tmax, tmin, rain)
with data/weather/UFGA_<year>.json for the same date. 1990 is a good test: DSSAT
ships its own (different) UFGA9001.WTH, so a match proves our file is the one read.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # repo root, for `env`

from env.dssat_sim import DssatSimulator
from env.weather import PLANTING_DOY, load_year

N_SCHEDULE = {0: 60.0, 5: 60.0, 9: 40.0}


def check_year(year: int) -> dict:
    sim = DssatSimulator({})
    sim.reset("UFGA", year)
    for week in range(20):
        irr = 25.0 if sim.soil_state()["soil_water_frac"] < 0.35 else 0.0
        if sim.step_week(N_SCHEDULE.get(week, 0.0), irr)["done"]:
            break
    days = load_year("UFGA", year)
    end_doy = sim.state["yrdoy"] % 1000 - 1      # DSSAT's yrdoy is the next day; weather is the day before
    mismatches = 0
    for i, w in enumerate(sim.observed):
        d = days[end_doy - (sim.sim_day - i) - 1]
        if (round(w["tmax"], 1), round(w["tmin"], 1), round(w["rain_mm"], 1)) != (d["tmax_c"], d["tmin_c"], d["rain_mm"]):
            mismatches += 1
    final = sim.final()
    season_rain = sum(d["rain_mm"] for d in days[PLANTING_DOY - 1:PLANTING_DOY - 1 + 140])
    return {"year": year, "days_checked": len(sim.observed), "weather_mismatches": mismatches,
            "dssat_mean_tmax": round(sum(w["tmax"] for w in sim.observed) / len(sim.observed), 2),
            "season_rain_mm": round(season_rain), "grain_kg_ha": final["grain_kg_ha"],
            "n_leached": final["n_leached"], "irr_mm": final["irr_mm"], "maturity_yrdoy": sim.state["yrdoy"]}


def main() -> None:
    years = [int(y) for y in sys.argv[1:]] or [1990, 2005, 2015]
    rows = [check_year(y) for y in years]
    cols = list(rows[0])
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for r in rows:
        print("| " + " | ".join(str(r[c]) for c in cols) + " |")
    ok = all(r["weather_mismatches"] == 0 for r in rows) and all(3000 <= r["grain_kg_ha"] <= 13000 for r in rows)
    ok = ok and len({r["grain_kg_ha"] for r in rows}) == len(rows)
    print("OK" if ok else "CHECK FAILED")


if __name__ == "__main__":
    main()
