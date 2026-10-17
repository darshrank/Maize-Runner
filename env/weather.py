"""Real weather (NASA POWER) shared by the simulators. Files come from scripts/fetch_power.py."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEATHER_DIR = ROOT / "data" / "weather"
WTH_DIR = ROOT / "data" / "dssat_wth"

# Planting day of year of gym-DSSAT's UFGA8201 maize experiment (PDATE 82057 = Feb 26).
# The toy simulator plants on the same day so both simulators play the same window.
PLANTING_DOY = 57


def available_years(site: str) -> list[int]:
    return sorted(int(p.stem.split("_")[1]) for p in WEATHER_DIR.glob(f"{site}_*.json"))


def load_year(site: str, year: int) -> list[dict]:
    """Days of one calendar year: {date, doy, tmax_c, tmin_c, rain_mm, srad_mj_m2, rh_pct, wind_m_s}."""
    path = WEATHER_DIR / f"{site}_{year}.json"
    if not path.exists():
        years = available_years(site)
        have = f"{years[0]}-{years[-1]}" if years else "none (run scripts/fetch_power.py)"
        raise FileNotFoundError(f"no weather for site {site!r} year {year}; available years: {have}")
    return json.loads(path.read_text())


def wth_path(site: str, year: int) -> Path:
    """DSSAT weather file for one site-year (DSSAT naming: <WSTA><YY>01.WTH)."""
    path = WTH_DIR / f"{site}{year % 100:02d}01.WTH"
    if not path.exists():
        raise FileNotFoundError(f"no DSSAT weather file {path.name}; run scripts/fetch_power.py")
    return path


def legacy_seed_to_year(weather_seed: int) -> int:
    """Deprecated weather_seed requests map to year 1990 + (seed - 1) mod 35 (seeds 1-20 -> dev years)."""
    return 1990 + (int(weather_seed) - 1) % 35
