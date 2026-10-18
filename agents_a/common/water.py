"""Crop water balance for the Water agent (FAO-56 methods; general physics, not tuned to any season).

  reference ET0 (mm/day): Hargreaves = 0.0023 * Ra * (Tmean + 17.8) * sqrt(Tmax - Tmin), Ra in mm/day equivalent
  crop water use ETc = Kc(stage) * ET0, with FAO-56 maize crop coefficients
  suggestion: next week's crop water use minus effective rain (80% of the forecast), scaled by how dry the soil is
Sources: FAO Irrigation and Drainage Paper 56 (Allen et al. 1998): Hargreaves equation (eq. 52), extraterrestrial
radiation (eq. 21-25), maize Kc ini 0.3 / mid 1.2 / end 0.35-0.6.
"""

import math

from env.weather import SITES, planting_doy

KC_INI, KC_MID, KC_END = 0.3, 1.2, 0.6


def extraterrestrial_mm(lat_deg: float, doy: int) -> float:
    """Ra (FAO-56 eq. 21) converted to mm/day of evaporation equivalent (x 0.408)."""
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    delta = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))
    ra = 24 * 60 / math.pi * 0.0820 * dr * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))
    return 0.408 * ra


def hargreaves_et0(tmax: float, tmin: float, lat_deg: float, doy: int) -> float:
    return max(0.0, 0.0023 * extraterrestrial_mm(lat_deg, doy) * ((tmax + tmin) / 2 + 17.8) * math.sqrt(max(tmax - tmin, 0.0)))


def crop_coefficient(stage: str) -> float:
    """FAO-56 maize Kc by growth stage: initial until ~V6, rising to mid-season by tasseling (~V18), late at R6."""
    if stage.startswith("R"):
        return KC_END if stage == "R6" else KC_MID
    if stage == "VE":
        return KC_INI
    leaves = int(stage[1:]) if stage[1:].isdigit() else 0
    if leaves <= 6:
        return KC_INI
    return min(KC_MID, KC_INI + (KC_MID - KC_INI) * (leaves - 6) / 12)


def water_balance(site: str, weather: dict, crop: dict, soil: dict, irr_price: float) -> dict:
    """Summary for the Water agent from the env's get_weather / get_crop_state / get_soil results."""
    lat, p_doy = SITES[site]["lat"], planting_doy(site)
    doy = lambda day: (p_doy + int(day) - 1) % 365 + 1
    kc = crop_coefficient(crop.get("stage", "VE"))
    et0 = lambda days: [hargreaves_et0(d["tmax"], d["tmin"], lat, doy(d["day"])) for d in days]
    past, nxt = weather.get("history", [])[-7:], weather.get("outlook", [])[:7]
    etc_past = kc * sum(et0(past))
    etc_next = kc * sum(et0(nxt))
    rain_past, rain_next = sum(d["rain_mm"] for d in past), sum(d["rain_mm"] for d in nxt)
    swf = float(soil.get("soil_water_frac", 1.0))
    dryness = 1.0 if swf < 0.5 else 0.5 if swf < 0.7 else 0.0     # how much of the deficit to replace
    suggested = round(min(50.0, max(0.0, dryness * (etc_next - 0.8 * rain_next))), 0)
    return {
        "crop_coefficient": round(kc, 2),
        "crop_water_use_last_7d_mm": round(etc_past, 1), "rain_last_7d_mm": round(rain_past, 1),
        "crop_water_use_next_7d_mm": round(etc_next, 1), "rain_forecast_next_7d_mm": round(rain_next, 1),
        "soil_water_frac": swf,
        "suggested_irrigation_mm": suggested,
        "cost_of_suggestion_usd_ha": round(suggested * irr_price, 2),
        "note": "suggestion = next-7-day crop water use minus 80% of forecast rain, replaced fully when soil water < 0.5, "
                "half when 0.5-0.7, none above 0.7 (capped at 50 mm)",
    }
