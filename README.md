# FieldTwin

FieldTwin is a multi-agent crop advisor for one maize field in Gainesville, Florida, over one season.
Every week it decides how much nitrogen (kg N/ha) and irrigation (mm) to apply, and it is scored on profit
minus a nitrate-leaching penalty. The crop is simulated by **gym-DSSAT** (the DSSAT CERES-Maize model) on
**real NASA POWER weather**, one real year per task. The agents are Nemotron on vLLM (person B).

## What is real today

| Part | Status | Owner |
|---|---|---|
| Crop simulator | **real**: gym-DSSAT, UFGA maize experiment moved to each task's year (`env/dssat_sim.py`). Toy fallback: `env/toy_sim.py` | A |
| Weather | **real**: NASA POWER daily data, UFGA 1990-2024 (`data/`, see `data/README.md`) | A |
| Prices and reward | **real**, each value cited in `config.yaml` | A |
| Env server (HTTP, port 9000) | **real**, frozen contract below | A |
| Baselines | **done** for all 35 seasons, frozen in `results_baseline/`: `no_n`, `farmer` (60/60/40 split), `farmer_ufga` (UF experiment schedule = farmer practice), `hindsight` (ceiling) | A |
| NeMo Gym environment | **real**: `gym_env/` (tasks, tools, verifier = final reward), see `gym_env/README.md` | A |
| Agents | stub: `agents/policies/nemotron_stub.py` | **B** |
| UI | working replay viewer (`ui/`), to be restyled | C |

## Quick start

```bash
uv sync                                          # Python 3.11+ (uv picks it)
bash scripts/install_gym_dssat.sh                # once per machine, needs sudo; Ubuntu 22.04/20.04 or Debian 12

uv run uvicorn env.server:app --port 9000        # 1. env server (leave running)
uv run python -m agents.run --policy farmer --task-id UFGA-1995      # 2. play one season -> runs/farmer/UFGA-1995.jsonl
uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]   # 3. eval -> results/
python -m http.server 8080                       # 4. UI at http://localhost:8080/ui/ (from the repo root)
```

Checks: `uv run pytest` (contract tests on both simulators) and `bash scripts/smoke.sh` (prints PASS/FAIL).

### No gym-DSSAT on your machine?

Prefix any command with `FIELDTWIN_SIMULATOR=toy`, e.g. `FIELDTWIN_SIMULATOR=toy uv run uvicorn env.server:app --port 9000`.
The toy crop model has the same HTTP contract, tools, tasks and real weather; only the crop model is simpler.
It is fine for building and debugging agents. **Report numbers from gym-DSSAT only.**

### gym-DSSAT install notes

- `scripts/install_gym_dssat.sh` follows the official package install and puts gym-DSSAT in `/opt/gym_dssat_pdi`
  (its own Python 3.10). The project does not import it directly: `env/dssat_sim.py` starts one worker process per
  episode with that Python (`env/dssat_worker.py`).
- DSSAT embeds Python and would pick up a user-installed numpy 2.x from `~/.local`, which makes it hang.
  `dssat_sim.py` sets `PYTHONPATH` for the worker, so nothing to do; just don't remove that.
- One season takes about 2 s. Each episode holds one DSSAT process until the season ends.

## Tasks (seasons)

A task is a real (site, year): `tasks/dev.jsonl` = UFGA 1990-2009 (20 seasons), `tasks/test.jsonl` = UFGA 2010-2024
(15 seasons). Line format: `{"task_id": "UFGA-2015", "site": "UFGA", "year": 2015, "split": "test"}`.

**Never tune on `test`.** Tune on `dev`; `test` is run once at the end by A (milestone A4).

## A season, as the agent sees it

- Planting is Feb 26 (day of year 57, same as gym-DSSAT's UFGA experiment). Week 0 starts the day after planting.
  Each `/step` applies the action on day 1 of the week, then simulates 7 days.
- **On gym-DSSAT the season ends at crop maturity, usually week 18-20.** Stop when `/step` returns `done: true`;
  do not assume exactly 20 weeks. The toy simulator always runs 20 weeks.
- Limits: N 0-120 kg/ha per week and 300 kg/ha per season; irrigation 0-50 mm per week. Values outside are
  **clamped**, not rejected, and `/step` returns `"clamped": true`.

| Field | Meaning on gym-DSSAT |
|---|---|
| `stage` | `VE` emergence, `V<n>` vegetative with n leaves (V1-V21), `R1` silking (~week 13), `R3` grain fill, `R6` maturity |
| `soil_water_frac` | plant-available water in the root zone: 0 = wilting point, 1 = field capacity |
| `soil_n_kg_ha` | **estimate** of soil mineral N (mass balance; this DSSAT build does not export soil nitrate) |
| `n_stress`, `water_stress` (`get_crop_state`) | 1 = no stress, 0 = severe stress |
| `gdd` | cumulative thermal time since planting (°C-days) |
| `biomass_kg_ha` | above-ground dry matter |
| `weekly.n_gas` / `final.n_gas` | denitrification + ammonia volatilization |
| `final.*` totals | counted from week 0 (pre-planting losses excluded), so they equal the sum of the weekly values |
| `get_weather` | `history` = last 14 observed days; `outlook` = the real next 7 days plus noise (rain ±40%, temperature ±2 °C), seeded `year * 1000 + week` so every policy sees the same outlook |

## Reward and prices (fixed; do not tune)

`profit_usd_ha = grain_kg_ha * maize_price - n_applied * n_price - irr_mm * water_price`,
`reward = profit_usd_ha - leach_penalty * n_leached` (all per hectare). Values in `config.yaml`, each with its source:

| | value | source |
|---|---|---|
| maize | $0.193 per kg **dry** grain | USDA WASDE Apr 2026, 2025/26 season average $4.15/bu (15.5% moisture), converted to dry matter because DSSAT grain is dry |
| nitrogen | $1.66 per kg N | DTN retail, Sep 2026, UAN32 $483/short ton |
| irrigation | $0.565 per mm per ha | USDA NASS 2023 Irrigation and Water Management Survey, Florida pumping energy ($5.81/acre-inch) |
| leaching penalty | $2.44 per kg N leached | Sobota et al. 2015 (Environ. Res. Lett. 10:025006), Table 1, groundwater damage costs (2008 USD) |

Baselines on gym-DSSAT, mean reward (USD/ha), frozen in `results_baseline/`:

| config | dev (20 seasons) | test (15 seasons) |
|---|---|---|
| `no_n` | 153 | 199 |
| `farmer` (60/60/40 kg N split + 25 mm when dry) | 1,024 | 1,096 |
| `farmer_ufga` = **farmer practice** (UF 1982 experiment schedule: 116 kg N, 264 mm) | 1,117 | 1,074 |
| `hindsight` (best of 56 fixed plans with the weather known; unreachable ceiling) | 1,283 | 1,265 |

Farmer practice is set in `config.yaml` (`eval.farmer_practice`); it was chosen on dev only.

## For person B: building the agents

1. **Get a simulator running.** Either your own env server from this repo (Quick start; toy if you cannot install
   gym-DSSAT) or the shared one on Brev. Point `config.yaml` `env.url` at it (default `http://localhost:9000`).
2. **Model endpoint.** Copy `.env.example` to `.env` and set `VLLM_BASE_URL` (default `http://localhost:8000/v1`) and
   `VLLM_MODEL`. `config.yaml` `agents.base_url_env` / `agents.model_env` name these variables.
3. **Write a policy.** Start from `agents/policies/nemotron_stub.py`; the interface is in `agents/policies/base.py`:
   ```python
   class Policy(ABC):
       name: str
       def decide(self, episode_id, week, obs, env, log) -> Decision(n_kg_ha, irr_mm, reason): ...
   ```
   - Read tools with `self.call_tool(name, episode_id, week, env, log, agent="weather")`: it calls
     `GET /tool/<name>` and logs both the `tool_call` and `tool_result`. Tool schemas for the model (OpenAI format)
     are in `agents/tools.json`; `submit_decision` is the decision itself, so map the model's call to a `Decision`.
   - Log everything else with `log.event(week, agent, kind, data)`: `agent` in `weather|crop|planner|critic|coordinator`,
     `kind` in `message|fallback` (the runner logs `decision`, `step_result` and `final` for you).
   - Add 1 to `log.llm_calls` for every model call. Log a `fallback` event whenever you fall back (e.g. two malformed
     tool calls in a row -> farmer schedule for that week); fallbacks are counted and reported, never hidden.
   - Clamp in code, not in the prompt (the env also clamps and reports `clamped`).
4. **Register it** in `agents/policies/__init__.py` (`POLICIES = {"single": Single, "multi": Multi, ...}`) and add
   the names to `eval.configs` in `config.yaml`. Planned configs: `single`, `multi`, `multi_no_critic`,
   `multi_no_weather`, `multi_no_tools`.
5. **Run it**: one season with `uv run python -m agents.run --policy single --task-id UFGA-1995`, then
   `uv run python -m eval.run_eval --split dev --configs farmer,single --limit 5`. `results/summary.md` reports
   reward with 95% CI, **gap closed** = (reward - farmer practice) / (hindsight - farmer practice), and leaching vs
   farmer practice. Baseline rows to compare against are in `results_baseline/eval.csv` (no need to rerun them).
   Eval runs `eval.parallel` seasons at once (8): each is one DSSAT process plus your model calls.
6. **Optional: score through NeMo Gym** with the real model instead of the dummy policy: `gym_env/README.md`
   (`--model-type vllm_model --model-url <vLLM>`).

## Frozen contracts

Do not change these without telling the team. Original text: `SKELETON_SPEC.md` (the reset body has since moved
from `weather_seed` to `year`).

**HTTP (env server, port 9000)**
- `POST /reset` `{task_id, site, year}` → `{episode_id, obs, week: 0}`. Unknown year → 400 `{error}`. The old
  `weather_seed` is still accepted (deprecated: maps to year 1990 + (seed - 1) mod 35); `year` wins when both are sent.
- `POST /step` `{episode_id, n_kg_ha, irr_mm, reason}` → `{obs, week, done, weekly, clamped}`, plus `final` when done.
- `GET /tool/{get_weather|get_crop_state|get_soil|get_history|get_budget}?episode_id=...`
- `GET /health` → `{ok: true, simulator}`. Unknown tool or episode → 404 `{error: "..."}` (written so an LLM can fix its call).
- `obs` = `{day, week, stage, soil_water_frac, soil_n_kg_ha, n_applied_total, irr_total_mm, biomass_kg_ha}`
- `weekly` = `{rain_mm, n_leached, n_uptake, n_gas}`
- `final` = `{grain_kg_ha, n_applied, n_uptake, n_leached, n_gas, irr_mm, profit_usd_ha, reward}`

**Policy interface**: `agents/policies/base.py` (above).

**Agent log** `runs/<config>/<task_id>.jsonl`, one object per line:
`{"t": iso_time, "week": int, "agent": "weather|crop|planner|critic|coordinator|policy|env", "kind": "...", "data": {...}}`.
Kinds: `tool_call`, `tool_result`, `message`, `decision` (`{n_kg_ha, irr_mm, reason}`), `fallback`, `step_result`
(the /step response), `final`. `runs/index.json` = `{"<config>": ["<task_id>", ...]}` lists runs for the UI.

**eval.csv columns**: `config, task_id, split, grain_kg_ha, n_applied, n_uptake, n_leached, n_gas, irr_mm, profit_usd_ha, reward, llm_calls, wall_s, fallbacks`.

**Simulator interface** (`env/sim_base.py`, for adding simulators): `reset(site, year)`, `step_week`, `weather_history`,
`weather_outlook`, `crop_state`, `soil_state`, `final`, optional `close`; register in `env/__init__.py`.

## Layout

- `env/`: `server.py` (HTTP API), `dssat_sim.py` + `dssat_worker.py` (gym-DSSAT), `toy_sim.py`, `weather.py` (NASA data loader), `sim_base.py`, simulator registry in `__init__.py`.
- `agents/`: `client.py` (env client), `tools.json` (tool schemas), `policies/` (registry, `no_n`, `farmer`, `nemotron_stub`), `run.py` (season runner + logger).
- `eval/`: `hindsight.py` (grid-search ceiling), `run_eval.py` (`results/eval.csv` + `results/summary.md`).
- `gym_env/`: NeMo Gym environment, see `gym_env/README.md`.
- `ui/`: static Three.js replay of two runs side by side.
- `results_baseline/`: frozen baseline results and season logs (A2).
- `tasks/`: dev/test seasons. `data/`: NASA POWER weather (`scripts/fetch_power.py` regenerates it; see `data/README.md`).
- `scripts/`: `smoke.sh`, `install_gym_dssat.sh`, `fetch_power.py`, `validate_dssat_years.py` (checks DSSAT plays the right year).

## Who owns what

- **A** (simulator, eval): done: gym-DSSAT, real weather, prices, NeMo Gym, baselines (A2). Next: A4 final test run
  once B freezes the agents.
- **B** (agents): `single` and `multi` policies on Nemotron/vLLM, the improvement loop on `dev`, frozen prompts and ablations.
- **C** (UI, demo): restyle `ui/`, vLLM metrics script, deck and video.

## Known limitations

- An episode abandoned mid-season keeps its DSSAT process until the env server restarts.
- Only the UFGA site is set up (Raleigh is defined in `scripts/fetch_power.py` but not fetched), hence 15 test seasons, not 20.
- `soil_n_kg_ha` on gym-DSSAT is a mass-balance estimate (see above); the reward does not use it.
