"""Real weather (NASA POWER) shared by the simulators. Files come from scripts/fetch_power.py."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEATHER_DIR = ROOT / "data" / "weather"
WTH_DIR = ROOT / "data" / "dssat_wth"

# Sites: weather station code -> planting day of year, field coordinates and elevation (m).
# UFGA: gym-DSSAT's UFGA8201 maize experiment (PDATE 82057 = Feb 26).
# TIFT: Tifton, GA (UGA Tifton campus, Coastal Plain); planted Mar 15, inside UGA Extension's south Georgia
#   window (planting can begin early-mid March; March-April best). It reuses the UFGA soil and hybrid:
#   "the same field and variety in another climate".
# Both simulators plant on the site's day so they play the same window.
SITES = {
    "UFGA": {"planting_doy": 57, "lat": 29.6380, "lon": -82.3689, "elev": 40},
    "TIFT": {"planting_doy": 74, "lat": 31.4700, "lon": -83.5300, "elev": 96},
}
PLANTING_DOY = SITES["UFGA"]["planting_doy"]   # kept for UFGA-only callers


def planting_doy(site: str) -> int:
    if site not in SITES:
        raise ValueError(f"unknown site {site!r}; known: {sorted(SITES)}")
    return SITES[site]["planting_doy"]


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
