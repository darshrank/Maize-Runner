"""Toy maize model implementing Simulator.

Deterministic given weather_seed. Not realistic, only plausible enough that
policies differ: too little N means low yield, and N applied right before a
storm leaches. Teammate A replaces this with gym-DSSAT.
"""

import numpy as np

from env.sim_base import Simulator

DAYS = 140                  # 20 weeks
BUCKET_MM = 150.0           # soil water capacity
START_WATER_MM = 100.0
START_SOIL_N = 30.0         # kg/ha nitrate

# Stage thresholds on cumulative GDD (upper bounds); after R3 the crop is R6 (mature).
STAGES = [("VE", 100), ("V6", 450), ("V10", 750), ("VT", 1150), ("R1", 1350), ("R3", 1700)]
ET_FACTOR = {"VE": 0.4, "V6": 0.7, "V10": 1.0, "VT": 1.2, "R1": 1.2, "R3": 1.2, "R6": 0.6}
N_DEMAND = {"VE": 0.3, "V6": 2.5, "V10": 4.0, "VT": 3.0, "R1": 2.0, "R3": 1.0, "R6": 0.0}
GROWTH = {"VE": 0.2, "V6": 1.0, "V10": 1.0, "VT": 1.0, "R1": 1.0, "R3": 1.0, "R6": 0.0}
BIOMASS_PER_DAY = 160.0     # kg/ha/day at full growth (tuned so grain lands in ~3-13 t/ha)
AFTER_VT = {"VT", "R1", "R3", "R6"}


def stage_from_gdd(gdd: float) -> str:
    for name, upper in STAGES:
        if gdd < upper:
            return name
    return "R6"


def make_weather(seed: int) -> list[dict]:
    """Precompute the whole season's daily weather."""
    rng = np.random.default_rng(seed)
    tmax = 30.0 + rng.normal(0, 2, DAYS)
    tmin = 19.0 + rng.normal(0, 2, DAYS)
    rain = np.where(rng.random(DAYS) < 0.3, rng.exponential(12.0, DAYS), 0.0)
    n_storms = int(rng.integers(2, 4))                        # 2 or 3 storms
    storm_days = rng.choice(np.arange(7, DAYS - 7), size=n_storms, replace=False)
    rain[storm_days] = rng.uniform(50, 90, n_storms)
    return [
        {"day": d, "tmax": round(float(tmax[d]), 1), "tmin": round(float(tmin[d]), 1),
         "rain_mm": round(float(rain[d]), 1)}
        for d in range(DAYS)
    ]


class ToySimulator(Simulator):
    def reset(self, site: str, weather_seed: int) -> dict:
        self.site = site
        self.weather = make_weather(weather_seed)
        self.day = 0                    # next day to simulate
        self.gdd = 0.0
        self.water = START_WATER_MM
        self.soil_n = START_SOIL_N
        self.biomass = 0.0
        self.n_applied = 0.0
        self.irr_total = 0.0
        self.n_uptake_total = 0.0
        self.n_leached_total = 0.0
        self.n_gas_total = 0.0
        self.demand_total = 0.0         # potential N demand so far (for N stress)
        self.n_stress_after_vt = []     # daily N stress from VT on (drives grain)
        return self._obs()

    # ---- stresses -------------------------------------------------------
    def _stage(self) -> str:
        return stage_from_gdd(self.gdd)

    def _water_frac(self) -> float:
        return self.water / BUCKET_MM

    def _water_stress(self) -> float:
        return float(np.clip(self._water_frac() / 0.4, 0, 1))

    def _n_stress(self) -> float:
        if self.demand_total <= 0:
            return 1.0
        return float(np.clip(self.n_uptake_total / (0.8 * self.demand_total), 0, 1))

    # ---- main loop -------------------------------------------------------
    def step_week(self, n_kg_ha: float, irr_mm: float) -> dict:
        weekly = {"rain_mm": 0.0, "n_leached": 0.0, "n_uptake": 0.0, "n_gas": 0.0}
        # Action on day 1 of the week.
        self.soil_n += n_kg_ha
        self.n_applied += n_kg_ha
        self.irr_total += irr_mm
        for i in range(7):
            if self.day >= DAYS:
                break
            self._run_day(irr_mm if i == 0 else 0.0, weekly)
        done = self.day >= DAYS
        weekly = {k: round(v, 2) for k, v in weekly.items()}
        return {"obs": self._obs(), "weekly": weekly, "done": done}

    def _run_day(self, irr_mm: float, weekly: dict) -> None:
        w = self.weather[self.day]
        self.gdd += max(0.0, (w["tmax"] + w["tmin"]) / 2 - 10)
        stage = self._stage()

        # Water bucket: rain + irrigation - ET; overflow above capacity drains.
        self.water += w["rain_mm"] + irr_mm - 4.0 * ET_FACTOR[stage]
        self.water = max(self.water, 0.0)
        drainage = max(0.0, self.water - BUCKET_MM)
        self.water = min(self.water, BUCKET_MM)

        # Nitrate losses: leaching with drainage, gas loss when waterlogged.
        leached = self.soil_n * min(0.6, drainage / 150.0)
        self.soil_n -= leached
        gas = 0.005 * self.soil_n if self._water_frac() > 0.85 else 0.0
        self.soil_n -= gas

        # Uptake and growth.
        water_stress = self._water_stress()
        demand = N_DEMAND[stage]
        uptake = min(self.soil_n, demand * water_stress)
        self.soil_n -= uptake
        self.demand_total += demand
        self.n_uptake_total += uptake
        n_stress = self._n_stress()
        self.biomass += BIOMASS_PER_DAY * GROWTH[stage] * water_stress * n_stress
        if stage in AFTER_VT:
            self.n_stress_after_vt.append(n_stress)

        self.n_leached_total += leached
        self.n_gas_total += gas
        weekly["rain_mm"] += w["rain_mm"]
        weekly["n_leached"] += leached
        weekly["n_uptake"] += uptake
        weekly["n_gas"] += gas
        self.day += 1

    # ---- observations ----------------------------------------------------
    def _obs(self) -> dict:
        return {
            "day": self.day,
            "week": self.day // 7,
            "stage": self._stage(),
            "soil_water_frac": round(self._water_frac(), 3),
            "soil_n_kg_ha": round(self.soil_n, 2),
            "n_applied_total": round(self.n_applied, 2),
            "irr_total_mm": round(self.irr_total, 2),
            "biomass_kg_ha": round(self.biomass, 1),
        }

    def weather_history(self, days: int) -> list[dict]:
        return [dict(w) for w in self.weather[max(0, self.day - days):self.day]]

    def weather_outlook(self, days: int, rng) -> list[dict]:
        noise = self.env_config.get("outlook_noise", {})
        rain_frac, temp_c = noise.get("rain_frac", 0.4), noise.get("temp_c", 2.0)
        out = []
        for w in self.weather[self.day:self.day + days]:
            rain = w["rain_mm"] * max(0.0, 1 + rng.normal(0, rain_frac))
            out.append({
                "day": w["day"],
                "tmax": round(w["tmax"] + rng.normal(0, temp_c), 1),
                "tmin": round(w["tmin"] + rng.normal(0, temp_c), 1),
                "rain_mm": round(float(rain), 1),
            })
        return out

    def crop_state(self) -> dict:
        return {
            "stage": self._stage(),
            "gdd": round(self.gdd, 1),
            "biomass_kg_ha": round(self.biomass, 1),
            "n_stress": round(self._n_stress(), 3),
            "water_stress": round(self._water_stress(), 3),
        }

    def soil_state(self) -> dict:
        return {"soil_water_frac": round(self._water_frac(), 3), "soil_n_kg_ha": round(self.soil_n, 2)}

    def final(self) -> dict:
        stress = float(np.mean(self.n_stress_after_vt)) if self.n_stress_after_vt else self._n_stress()
        grain = float(np.clip(self.biomass * 0.5 * stress, 3000, 13000))
        return {
            "grain_kg_ha": round(grain, 1),
            "n_applied": round(self.n_applied, 2),
            "n_uptake": round(self.n_uptake_total, 2),
            "n_leached": round(self.n_leached_total, 2),
            "n_gas": round(self.n_gas_total, 2),
            "irr_mm": round(self.irr_total, 2),
        }
