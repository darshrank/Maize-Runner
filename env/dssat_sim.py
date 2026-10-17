"""gym-DSSAT simulator implementing Simulator (select with config.yaml env.simulator: dssat).

gym-DSSAT only runs under its own Python (3.10, gym 0.21, numpy 1.x), so each
DssatSimulator drives one worker process (env/dssat_worker.py) launched with
that interpreter. One worker = one DSSAT season at a time.

Setup (once per machine): bash scripts/install_gym_dssat.sh

Season: gym-DSSAT's UFGA8201 maize experiment (Gainesville, FL) moved to a real
year: reset(site, year) writes a copy of the experiment (X file) with every
1982 date shifted to `year` (same day of year), turns the weather generator off
(WTHER=M) and hands DSSAT our NASA POWER file data/dssat_wth/UFGA<YY>01.WTH,
copied into the run directory (searched before DSSAT's own Weather folder).
DSSAT starts ~27 days before planting; reset() skips those days, so week 0
starts the day after planting. Steps are daily in DSSAT; step_week applies the
action on day 1 and runs 7 days.

Mapping notes (DSSAT has no direct output for some contract fields):
  - soil_water_frac: plant-available water in the root zone (max(rtdep, 30 cm)),
    (sw - ll) / (dul - ll) weighted by layer thickness, clipped to [0, 1].
  - soil_n_kg_ha: ESTIMATE by mineral-N mass balance (this DSSAT build does not
    export soil nitrate): initial 15 kg/ha + 0.3 kg/ha/day mineralization
    + fertilizer - uptake - leaching - denitrification - volatilization, floor 0.
  - n_gas: denitrification (cnox/tnoxd) + ammonia volatilization (totaml).
  - Season totals in final() count from week 0 (pre-planting losses excluded),
    so they equal the sum of the weekly values.
  - outlook: the next days of data/weather/<SITE>_<YEAR>.json (the same values as
    the .WTH file DSSAT reads), plus the shared noise.
"""

import atexit
import json
import os
import re
import select
import subprocess
import time
import uuid
import weakref
from pathlib import Path

from env.sim_base import Simulator
from env.weather import load_year, wth_path

ROOT = Path(__file__).resolve().parent.parent
WORKER = Path(__file__).resolve().parent / "dssat_worker.py"
DEFAULTS = {
    "python": "/opt/gym_dssat_pdi/bin/python",
    "run_dssat": "/opt/dssat_pdi/run_dssat",
    "xfile_dir": ".cache/dssat_x",      # per-year copies of the experiment file
    "timeout_s": 120,
}
SITES = {"UFGA"}                 # the maize experiment shipped with gym-DSSAT
BASE_YEAR = 1982                 # the experiment's original year (UFGA8201)
XFILE = "gym_dssat_pdi/envs/configs/maize/UFGA8201.jinja2"
SOIL_N_INIT = 15.0               # kg/ha mineral N at simulation start (UFGA8201 initial conditions)
MINERALIZATION = 0.3             # kg/ha/day, calibrated so a zero-N season ends near 0
MAX_DAYS = 400                   # safety cap when finishing a season

# CERES-Maize istage is the phase IN PROGRESS: 7 sowing, 8 germination, 9 emergence,
# 1 juvenile, 2 to floral initiation, 3 to silking (all vegetative: named V<leaf count>),
# 4 silking to effective grain fill, 5 effective grain fill, 6 physiological maturity.
REPRO_STAGES = {4: "R1", 5: "R3", 6: "R6"}

_live = weakref.WeakSet()        # for atexit cleanup of worker processes


@atexit.register
def _close_all():
    for sim in list(_live):
        sim.close()


class DssatError(RuntimeError):
    pass


class DssatSimulator(Simulator):
    def __init__(self, env_config: dict | None = None):
        super().__init__(env_config)
        self.cfg = {**DEFAULTS, **self.env_config.get("dssat", {})}
        self.proc = None
        self._buf = b""
        _live.add(self)

    # ---- worker process -------------------------------------------------
    def _start_worker(self) -> None:
        self.close()
        python = Path(self.cfg["python"])
        if not python.exists():
            raise DssatError(f"gym-DSSAT Python not found at {python}; run scripts/install_gym_dssat.sh")
        venv = python.parent.parent
        site = next(venv.glob("lib/python3*/site-packages"))
        env = os.environ.copy()
        # DSSAT embeds Python; without this it can load a user-site numpy 2.x and hang.
        env["PYTHONPATH"] = str(site)
        env["PATH"] = f"{venv / 'bin'}:{env.get('PATH', '')}"
        env["FIELDTWIN_RUN_DSSAT"] = self.cfg["run_dssat"]
        self.proc = subprocess.Popen([str(python), str(WORKER)], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        self._buf = b""

    def _request(self, msg: dict) -> dict:
        if self.proc is None or self.proc.poll() is not None:
            raise DssatError("DSSAT worker is not running")
        self.proc.stdin.write((json.dumps(msg) + "\n").encode())
        self.proc.stdin.flush()
        deadline = time.monotonic() + self.cfg["timeout_s"]
        fd = self.proc.stdout.fileno()
        while b"\n" not in self._buf:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([fd], [], [], remaining)[0]:
                self.close()
                raise DssatError(f"DSSAT worker timed out on {msg.get('cmd')}")
            chunk = os.read(fd, 1 << 16)
            if not chunk:
                self.close()
                raise DssatError("DSSAT worker exited unexpectedly")
            self._buf += chunk
        line, self._buf = self._buf.split(b"\n", 1)
        resp = json.loads(line)
        if "error" in resp:
            raise DssatError(f"DSSAT worker error: {resp['error']}")
        return resp

    def close(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.stdin.write(b'{"cmd": "close"}\n')
            proc.stdin.flush()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
            proc.wait()

    def __del__(self):
        self.close()

    # ---- experiment file for a real year -----------------------------------
    def _xfile_for_year(self, year: int) -> Path:
        """Copy of gym-DSSAT's X-file template with every 1982/1983 YYDDD date moved to year/year+1.
        The jinja placeholders ({{ wther }} etc.) stay; gym-DSSAT fills them."""
        venv = Path(self.cfg["python"]).parent.parent
        base = next(venv.glob(f"lib/python3*/site-packages/{XFILE}")).read_text()
        shift = {BASE_YEAR % 100: year % 100, (BASE_YEAR + 1) % 100: (year + 1) % 100}
        text = re.sub(r"\b(8[23])(\d{3})\b", lambda m: f"{shift[int(m.group(1))]:02d}{m.group(2)}", base)
        out_dir = Path(self.cfg["xfile_dir"])
        out_dir = out_dir if out_dir.is_absolute() else ROOT / out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"UFGA{year}.jinja2"
        tmp = path.with_suffix(f".{uuid.uuid4().hex}.tmp")   # unique: the server resets in parallel threads
        tmp.write_text(text)
        tmp.replace(path)
        return path

    # ---- Simulator interface --------------------------------------------
    def reset(self, site: str, year: int) -> dict:
        if site not in SITES:
            raise ValueError(f"dssat simulator supports sites {sorted(SITES)}, got {site!r}")
        self.year_weather = load_year(site, year)   # also validates that the year exists
        wth = wth_path(site, year)
        self._start_worker()
        resp = self._request({"cmd": "start", "xfile_template": str(self._xfile_for_year(year)),
                              "wth": str(wth)})
        self.planting_index = None
        self.state = resp["state"]
        if self.state["yrdoy"] // 1000 != year:     # e.g. a two-digit-year mix-up in DSSAT
            self.close()
            raise DssatError(f"DSSAT simulated year {self.state['yrdoy'] // 1000}, expected {year}")
        self.sim_day = 0                     # simulation-day index of self.state
        self.done = False
        self.observed = [self._weather_day(self.state)]
        # Skip the pre-planting days with no action.
        while self.state["dap"] < 1 and not self.done:
            self._advance(0.0, 0.0)
        self.planting_index = self.sim_day
        for i, w in enumerate(self.observed):   # renumber history relative to week 0
            w["day"] = i - self.planting_index
        self.day = 0                         # days since week 0 started
        self.gdd = 0.0
        self.base = {"cleach": self.state["cleach"], "wtnup": self.state["wtnup"],
                     "gas": self.state["cnox"] + self.state["totaml"]}
        return self._obs()

    def _advance(self, anfer: float, amir: float) -> dict | None:
        """One DSSAT day. Returns the new state, or None when the season ended."""
        resp = self._request({"cmd": "step", "anfer": anfer, "amir": amir})
        if resp["done"] or resp["state"] is None:
            self.done = True
            return None
        prev, self.state = self.state, resp["state"]
        self.sim_day += 1
        self.observed.append(self._weather_day(self.state))
        return prev

    def step_week(self, n_kg_ha: float, irr_mm: float) -> dict:
        weekly = {"rain_mm": 0.0, "n_leached": 0.0, "n_uptake": 0.0, "n_gas": 0.0}
        for i in range(7):
            if self.done:
                break
            prev = self._advance(n_kg_ha if i == 0 else 0.0, irr_mm if i == 0 else 0.0)
            if prev is None:
                break
            s = self.state
            self.day += 1
            self.gdd += s["dtt"]
            weekly["rain_mm"] += s["rain"]
            weekly["n_leached"] += s["tleachd"]
            weekly["n_uptake"] += s["trnu"]
            weekly["n_gas"] += s["tnoxd"] + (s["totaml"] - prev["totaml"])
        weekly = {k: round(v, 2) for k, v in weekly.items()}
        if self.done:
            self.close()
        return {"obs": self._obs(), "weekly": weekly, "done": self.done}

    def weather_history(self, days: int) -> list[dict]:
        return [dict(w) for w in self.observed[-days:]] if days > 0 else []

    def weather_outlook(self, days: int, rng) -> list[dict]:
        # DSSAT's yrdoy is already the NEXT day: the weather in a state with yrdoy D is day D-1's.
        last_seen = self.state["yrdoy"] % 1000 - 2  # 0-based index of the latest observed day
        upcoming = self.year_weather[last_seen + 1:last_seen + 1 + days]
        true_days = [{"day": self.sim_day + 1 + k - self.planting_index, "tmax": d["tmax_c"],
                      "tmin": d["tmin_c"], "rain_mm": d["rain_mm"]} for k, d in enumerate(upcoming)]
        return self.noisy_outlook(true_days, rng)

    def crop_state(self) -> dict:
        s = self.state
        return {
            "stage": self._stage(),
            "gdd": round(self.gdd, 1),
            "biomass_kg_ha": round(s["topwt"], 1),
            # gym-DSSAT reports 1 - NSTRES and 1 - SWFAC (0 = no stress); the contract uses 1 = no stress.
            "n_stress": round(1.0 - float(s["nstres"]), 3),
            "water_stress": round(1.0 - float(s["swfac"]), 3),
        }

    def soil_state(self) -> dict:
        return {"soil_water_frac": round(self._water_frac(), 3), "soil_n_kg_ha": round(self._soil_n(), 2)}

    def final(self) -> dict:
        # The server may end the season at weeks_per_season; finish to maturity with no action.
        days = 0
        while not self.done and days < MAX_DAYS:
            self._advance(0.0, 0.0)
            days += 1
        self.close()
        s = self.state
        return {
            "grain_kg_ha": round(s["grnwt"], 1),
            "n_applied": round(s["cumsumfert"], 2),
            "n_uptake": round(s["wtnup"] - self.base["wtnup"], 2),
            "n_leached": round(s["cleach"] - self.base["cleach"], 2),
            "n_gas": round(s["cnox"] + s["totaml"] - self.base["gas"], 2),
            "irr_mm": round(s["totir"], 2),
        }

    # ---- mapping helpers -------------------------------------------------
    def _weather_day(self, s: dict, sim_day: int | None = None) -> dict:
        sim_day = self.sim_day if sim_day is None else sim_day
        planting = getattr(self, "planting_index", None)   # None until reset() finds planting
        # day is relative to week 0 (negative before planting) once planting is known.
        day = sim_day - planting if planting is not None else sim_day
        return {"day": day, "tmax": round(s["tmax"], 1), "tmin": round(s["tmin"], 1),
                "rain_mm": round(s["rain"], 1)}

    def _obs(self) -> dict:
        s = self.state
        return {
            "day": self.day,
            "week": self.day // 7,
            "stage": self._stage(),
            "soil_water_frac": round(self._water_frac(), 3),
            "soil_n_kg_ha": round(self._soil_n(), 2),
            "n_applied_total": round(s["cumsumfert"], 2),
            "irr_total_mm": round(s["totir"], 2),
            "biomass_kg_ha": round(s["topwt"], 1),
        }

    def _stage(self) -> str:
        istage = int(self.state["istage"])
        if istage in REPRO_STAGES:
            return REPRO_STAGES[istage]
        if istage in (1, 2, 3):
            return f"V{max(1, round(self.state['vstage']))}"
        return "VE"   # 7 sowing, 8 germination, 9 emergence

    def _water_frac(self) -> float:
        s = self.state
        zone = max(float(s["rtdep"]), 30.0)
        top = avail = cap = 0.0
        for thick, ll, dul, sw in zip(s["dlayr"], s["ll"], s["dul"], s["sw"]):
            overlap = min(max(zone - top, 0.0), thick)
            avail += (sw - ll) * overlap
            cap += (dul - ll) * overlap
            top += thick
        return min(max(avail / cap, 0.0), 1.0) if cap > 0 else 0.0

    def _soil_n(self) -> float:
        s = self.state
        balance = (SOIL_N_INIT + MINERALIZATION * self.sim_day + s["cumsumfert"]
                   - s["wtnup"] - s["cleach"] - s["cnox"] - s["totaml"])
        return max(balance, 0.0)
