"""Fetch real daily weather from NASA POWER and convert it for FieldTwin.

  uv run python scripts/fetch_power.py [--sites UFGA,RALE] [--start 1990] [--end 2024]

Outputs per (site, year):
  data/power/raw/<SITE>_<YEAR>.json   raw API response (cache: not refetched if present)
  data/weather/<SITE>_<YEAR>.json     list of days {date, doy, tmax_c, tmin_c, rain_mm, srad_mj_m2, rh_pct, wind_m_s}
  data/dssat_wth/<SITE><YY>01.WTH     DSSAT weather file (same layout as /opt/dssat_pdi/Weather/UFGA8201.WTH)

Values are rounded to 0.1 so the JSON and the .WTH file hold identical numbers.
POWER's missing-value marker (-999) is filled by linear interpolation.
"""

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API = "https://power.larc.nasa.gov/api/temporal/daily/point"
# POWER parameter -> our field name
PARAMS = {
    "T2M_MAX": "tmax_c",
    "T2M_MIN": "tmin_c",
    "PRECTOTCORR": "rain_mm",
    "ALLSKY_SFC_SW_DWN": "srad_mj_m2",
    "RH2M": "rh_pct",
    "WS2M": "wind_m_s",
}
SITES = {
    "UFGA": {"name": "Gainesville, FL, USA", "lat": 29.63, "lon": -82.37},
    "RALE": {"name": "Raleigh, NC, USA", "lat": 35.78, "lon": -78.64},
}
REFHT, WNDHT = 2.0, 2.0   # POWER T2M/RH2M are at 2 m, WS2M wind at 2 m


def fetch_raw(site: str, year: int) -> dict:
    """Download one site-year (cached). One request at a time, 3 retries with backoff."""
    path = DATA / "power" / "raw" / f"{site}_{year}.json"
    if path.exists():
        return json.loads(path.read_text())
    s = SITES[site]
    params = {"parameters": ",".join(PARAMS), "community": "AG", "latitude": s["lat"],
              "longitude": s["lon"], "start": f"{year}0101", "end": f"{year}1231", "format": "JSON"}
    for attempt in range(1, 4):
        try:
            r = httpx.get(API, params=params, timeout=120)
            r.raise_for_status()
            data = r.json()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
            return data
        except (httpx.HTTPError, ValueError) as e:
            if attempt == 3:
                raise
            wait = 5 * 2 ** (attempt - 1)
            print(f"  {site} {year}: {e}; retry {attempt}/3 in {wait}s", file=sys.stderr)
            time.sleep(wait)


def fill_missing(values: list[float], fill_value: float) -> tuple[list[float], int]:
    """Linear interpolation over POWER's missing marker; returns (values, number filled)."""
    a = np.array(values, dtype=float)
    bad = (a == fill_value) | ~np.isfinite(a)
    if bad.all():
        raise ValueError("all values missing")
    if bad.any():
        idx = np.arange(len(a))
        a[bad] = np.interp(idx[bad], idx[~bad], a[~bad])   # ends take the nearest valid value
    return a.tolist(), int(bad.sum())


def convert(raw: dict, year: int) -> tuple[list[dict], int]:
    fill_value = raw.get("header", {}).get("fill_value", -999)
    series = raw["properties"]["parameter"]
    n_days = (date(year, 12, 31) - date(year, 1, 1)).days + 1
    keys = [(date(year, 1, 1) + timedelta(d)).strftime("%Y%m%d") for d in range(n_days)]
    cols, filled = {}, 0
    for p, name in PARAMS.items():
        cols[name], n = fill_missing([series[p].get(k, fill_value) for k in keys], fill_value)
        filled += n
    days = []
    for i, k in enumerate(keys):
        day = {"date": f"{k[:4]}-{k[4:6]}-{k[6:]}", "doy": i + 1}
        day.update({name: round(cols[name][i], 1) for name in PARAMS.values()})
        day["rain_mm"] = max(day["rain_mm"], 0.0)
        day["srad_mj_m2"] = max(day["srad_mj_m2"], 0.0)
        days.append(day)
    return days, filled


def tav_amp(days: list[dict]) -> tuple[float, float]:
    """TAV = annual mean temperature; AMP = max minus min of the monthly mean temperatures
    (matches the shipped UFGA files, e.g. AMP 13.0 in UFGA8201.WTH)."""
    tmean = np.array([(d["tmax_c"] + d["tmin_c"]) / 2 for d in days])
    months = np.array([int(d["date"][5:7]) for d in days])
    monthly = [tmean[months == m].mean() for m in range(1, 13)]
    return float(tmean.mean()), float(max(monthly) - min(monthly))


def write_wth(site: str, year: int, days: list[dict], elev: float) -> Path:
    s = SITES[site]
    tav, amp = tav_amp(days)
    lines = [
        f"*WEATHER DATA : {s['name']} (NASA POWER {year})",
        "",
        "@ INSI      LAT     LONG  ELEV   TAV   AMP REFHT WNDHT",
        f"  {site:<4s} {s['lat']:8.3f} {s['lon']:8.3f} {round(elev):5d} {tav:5.1f} {amp:5.1f} {REFHT:5.2f} {WNDHT:5.2f}",
        "@DATE  SRAD  TMAX  TMIN  RAIN",
    ]
    for d in days:
        lines.append(f"{year % 100:02d}{d['doy']:03d}{d['srad_mj_m2']:6.1f}{d['tmax_c']:6.1f}"
                     f"{d['tmin_c']:6.1f}{d['rain_mm']:6.1f}")
    path = DATA / "dssat_wth" / f"{site}{year % 100:02d}01.WTH"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch NASA POWER daily weather for FieldTwin sites.")
    ap.add_argument("--sites", default="UFGA")
    ap.add_argument("--start", type=int, default=1990)
    ap.add_argument("--end", type=int, default=2024)
    args = ap.parse_args()
    for site in args.sites.split(","):
        for year in range(args.start, args.end + 1):
            raw = fetch_raw(site, year)
            days, filled = convert(raw, year)
            elev = raw["geometry"]["coordinates"][2]
            out = DATA / "weather" / f"{site}_{year}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(days))
            wth = write_wth(site, year, days, elev)
            rain = sum(d["rain_mm"] for d in days)
            print(f"{site} {year}: {len(days)} days, rain {rain:.0f} mm, filled {filled} missing values -> {wth.name}")


if __name__ == "__main__":
    main()
