# FieldTwin

Person B session pickup: [handoff.md](handoff.md), with current done/pending work,
completed DSSAT results and the exact Brev resume commands.
System diagrams: [flowchart and high-level design](ARCHITECTURE.md), including
current implementation and clearly marked proposed improvements.

FieldTwin is a multi-agent crop advisor for one maize field in Gainesville, Florida, over one season.
Every week it decides how much nitrogen (kg N/ha) and irrigation (mm) to apply, and it is scored on profit
minus a nitrate-leaching penalty. The crop is simulated by **gym-DSSAT** (the DSSAT CERES-Maize model) on
**real NASA POWER weather**, one real year per task. The agents are Nemotron on vLLM (person B).

**Demo video:** https://www.youtube.com/watch?v=gxpolRO2nEU

## Team

| Name | Role | GitHub |
|---|---|---|
| Darsh Rank | Simulator, env server, NeMo Gym environment, baselines, evaluation | [darshrank](https://github.com/darshrank) |
| Anandteertha Rao | Nemotron on vLLM, agent team, prompts, ablations | [anandteertha](https://github.com/anandteertha) |
| Sakhi Patel | UI, vLLM serving metrics, demo and submission | [sakhi20](https://github.com/sakhi20) |

## What is real today

| Part | Status | Owner |
|---|---|---|
| Crop simulator | **real**: gym-DSSAT, UFGA maize experiment moved to each task's year (`env/dssat_sim.py`). Toy fallback: `env/toy_sim.py` | A |
| Weather | **real**: NASA POWER daily data, UFGA 1990-2024 (`data/`, see `data/README.md`) | A |
| Prices and reward | **real**, each value cited in `config.yaml` | A |
| Env server (HTTP, port 9000) | **real**, frozen contract below | A |
| Baselines | **done** for all 35 seasons, frozen in `results_baseline/`: `no_n`, `farmer` (60/60/40 split), `farmer_ufga` (UF experiment schedule = farmer practice), `hindsight` (grid hindsight: best fixed plan per season, weather known; not an upper bound) | A |
| NeMo Gym environment | **real**: `gym_env/` (tasks, tools, verifier = final reward), see `gym_env/README.md` | A |
| Agents | **done**: five-agent team (d1c_multi) evaluated on dev, test and tift_test; results below | B |
| UI | **done**: Season (3D replay and the live 2026 season), How it works, Results, Serving, Agents, Gym (`ui/`) | C |

## Tech stack

| Layer | What we use |
|---|---|
| Model | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`, one checkpoint shared by all five roles |
| Serving | vLLM 0.27.1, OpenAI-compatible API, automatic tool calling, prefix caching (`scripts/serve_vllm.sh`) |
| Agents | Python: Weather, Crop, Planner, Critic, Coordinator (`agents_a/designs/d1c_multi/`), code guard on every action |
| Crop simulator | gym-DSSAT (DSSAT CERES-Maize), UFGA8201 maize experiment, behind a FastAPI env server (`env/server.py`) |
| Weather | NASA POWER daily data (`data/`) |
| RL environment | NVIDIA NeMo Gym wrapper around the env server (`gym_env/`) |
| UI | Plain JavaScript + three.js (vendored), served by `scripts/demo_server.py` (FastAPI / uvicorn) |
| Tooling | uv, pytest |

Weekly decision flow (from [ARCHITECTURE.md](ARCHITECTURE.md), section 1):

```mermaid
flowchart TD
    START["Load one dev task: site and year"] --> RESET["Runner resets a DSSAT episode"]
    RESET --> OBS["Current weekly observation and remaining N"]
    OBS --> W["Weather agent: weather report"]
    OBS --> C["Crop agent: crop report"]
    W --> P["Planner: propose nitrogen and irrigation"]
    C --> P
    P --> K["Critic: review proposal and evidence"]
    K --> OK{"Accept proposal?"}
    OK -->|Yes| CO["Coordinator: produce final action"]
    OK -->|No| REV["Planner: one revision using the objection"]
    REV --> CO
    CO --> GUARD["Code guard: weekly and seasonal limits"]
    FAIL["A role invocation fails or exhausts its response budget"] --> FB["Visible farmer fallback"]
    FB --> GUARD
    GUARD --> STEP["Runner calls DSSAT /step once"]
    STEP --> LOG["Record decision, step result and metrics"]
    LOG --> DONE{"DSSAT done or 20-week control limit?"}
    DONE -->|No| OBS
    DONE -->|Yes| FINAL["Finalize with zero further inputs if needed; record result"]
```

## Quick start

```bash
uv sync                                          # Python 3.11+ (uv picks it)
bash scripts/install_gym_dssat.sh                # once per machine, needs sudo; Ubuntu 22.04/20.04 or Debian 12

uv run uvicorn env.server:app --port 9000        # 1. env server (leave running)
uv run python -m agents.run --policy farmer --task-id UFGA-1995      # 2. play one season -> runs/farmer/UFGA-1995.jsonl
uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]   # 3. eval -> results/
python -m http.server 8080                       # 4. UI at http://localhost:8080/ui/ (from the repo root)
```

Run the final agent team (needs the env server above and a Nemotron endpoint):

```bash
bash scripts/serve_vllm.sh                                   # on the GPU host: vLLM + Nemotron on port 8000
cp .env.example .env                                         # then set VLLM_MODEL (and VLLM_BASE_URL if not local)
uv run python -m agents_a.run_design --design d1c_multi --split dev --limit 1   # one dev season
```

`run_design` writes into `agents_a/designs/d1c_multi/runs/` and `.../results/{eval.csv,summary.md}`, which hold the
committed results. Run it in a fresh clone, or discard the changes afterwards (`git checkout -- agents_a/designs/`).

Live demo (plays the 2026 season live in the UI):

```bash
uv run python scripts/demo_server.py      # serves the UI at http://localhost:8080/ui/ and starts live runs
```

Open the Season page, pick 2026 and press Play. It needs the env server (port 9000) and vLLM (port 8000, or a
tunnel to it) running. Plain `python -m http.server` only replays recorded seasons and shows "Live server offline".
For the Brev GPU setup used by the team, see [RUN_ON_BREV.md](RUN_ON_BREV.md).

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

- `tasks/tift_test.jsonl`: Tifton, GA 2010-2024 (15 seasons, split `tift_test`), a second site never used for tuning.
- `tasks/live.jsonl`: UFGA-2025 and UFGA-2026 (split `live`), played only live in the demo.
- `data/dssat_wth/*.WTH`: the DSSAT weather files built from NASA POWER, one per site and year (72 files, UFGA and TIFT),
  written by `scripts/fetch_power.py`.
- Forecast noise (agents' `get_weather` outlook only; the simulator uses the observed weather): rain x (1 + e) with
  e ~ Normal(0, sd 0.4), floored at 0; daily max and min temperature + Normal(0, sd 2.0 °C); seeded per season and
  week so every policy sees the same outlook (`env/sim_base.py` `noisy_outlook`, `config.yaml` `env.outlook_noise`).

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
| `get_weather` | `history` = last 14 observed days; `outlook` = the real next 7 days plus noise (rain x (1 + Normal(0, sd 0.4)), temperature + Normal(0, sd 2.0 °C)), seeded `year * 1000 + week` so every policy sees the same outlook |

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
| `hindsight` = **grid hindsight** (best of 56 fixed plans with the weather known; not an upper bound) | 1,283 | 1,265 |

Grid hindsight picks the best of 56 fixed calendars with the weather known, but it cannot change a plan during the
season. The team adapts each week's nitrogen and water to the crop it observes and the forecast, so it can beat the
best fixed plan: on test it does in 10 of 15 seasons.

Farmer practice is set in `config.yaml` (`eval.farmer_practice`); it was chosen on dev only.

## Results

Score (reward) = profit minus a per-kg penalty for nitrate leached, in USD/ha per season (formula and prices
above). Higher is better. One saved run per policy and season; intervals are paired 95% normal intervals.

**Held-out test, Gainesville FL (split test, 15 seasons, 2010-2024), final design d1c_multi**

| | Farmer practice | Grid hindsight | Single agent | Five-agent team |
|---|---:|---:|---:|---:|
| Reward (USD/ha) | 1,074.14 | 1,265.22 | 1,237.97 | **1,306.27** |
| Irrigation (mm) | 264.00 | 124.27 | 156.60 | 170.20 |
| Nitrogen applied (kg/ha) | 116.00 | 135.73 | 212.07 | 204.07 |
| Nitrogen leached (kg/ha) | 23.043 | 12.917 | 21.245 | 19.689 |
| Fallback weeks | n/a | n/a | 11 | **0** |

- Team vs farmer practice (test): **+$232.13/ha**, 95% interval [$115.36, $348.89], 12/15 seasons won.
  Reward +21.61%, irrigation 35.53% lower, nitrogen leached 14.55% lower.
- Team vs grid hindsight (test): the team scores higher in 10 of 15 seasons (mean 1,306.27 vs 1,265.22).

**New site, never used for tuning (split tift_test: Tifton GA, 15 seasons, 2010-2024)**

| | Farmer practice | Grid hindsight | Five-agent team |
|---|---:|---:|---:|
| Reward (USD/ha) | 1,062.94 | 1,270.78 | **1,297.29** |
| Irrigation (mm) | 264.00 | 140.40 | 157.13 |
| Nitrogen leached (kg/ha) | 21.81 | 14.05 | 17.95 |
| Fallback weeks | n/a | n/a | **0** |

- Team vs farmer practice (tift_test): **+$234.35/ha**, 95% interval [$120.18, $348.52], 12/15 seasons won.

**Team vs single agent (same model, same agronomy), two ways**

| Seasons | Gain (USD/ha) | 95% interval | Seasons won | Fallback weeks (team / single) |
|---|---:|---:|---:|---:|
| test only (15) | +68.30 | [-6.10, 142.69] | 11/15 | 0 / 11 |
| dev-check 2005-2009 + test (20; neither design was tuned on them; shown in the UI) | +81.33 | [20.50, 142.16] | 15/20 | 0 / 15 |

The team makes about 3.01x as many model calls as the single agent (test).
Sources: `agents_a/designs/{d0b_single,d1c_multi}/results/eval.csv`, `results_baseline/eval.csv`.

## For person B: building the agents

1. **Get a simulator running.** Either your own env server from this repo (Quick start; toy if you cannot install
   gym-DSSAT) or the shared one on Brev. Point `config.yaml` `env.url` at it (default `http://localhost:9000`).
2. **Model endpoint.** Set `VLLM_BASE_URL` (default `http://localhost:8000/v1`) and `VLLM_MODEL` in `.env` (copy `.env.example`). The final team (`agents_a/`, including `run_design` and the live demo) loads `.env` automatically, and exported shell variables win. The older `agents/` and `fieldtwin_agents/` policies read only exported shell variables.
   `config.yaml` `agents.base_url_env` / `agents.model_env` name these variables.
3. **Policies are implemented** in `agents/policies/single.py`, `multi.py` and the shared `nemotron.py` adapter. The interface is in `agents/policies/base.py`:
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
- `eval/`: `hindsight.py` (grid hindsight: best fixed plan per season), `run_eval.py` (`results/eval.csv` + `results/summary.md`).
- `gym_env/`: NeMo Gym environment, see `gym_env/README.md`.
- `ui/`: static Three.js replay of two runs side by side.
- `results_baseline/`: frozen baseline results and season logs (A2).
- `tasks/`: dev/test seasons. `data/`: NASA POWER weather (`scripts/fetch_power.py` regenerates it; see `data/README.md`).
- `scripts/`: `smoke.sh`, `install_gym_dssat.sh`, `fetch_power.py`, `validate_dssat_years.py` (checks DSSAT plays the right year).

## Who owns what

- **A** (simulator, eval): done: gym-DSSAT, real weather, prices, NeMo Gym, baselines (A2).
- **B** (agents): `single` and `multi` policies on Nemotron/vLLM, the improvement loop on `dev`, frozen prompts and ablations.
- **C** (UI, demo): restyle `ui/`, vLLM metrics script, deck and video.

## Known limitations

- An episode abandoned mid-season keeps its DSSAT process until the env server restarts.
- `soil_n_kg_ha` on gym-DSSAT is a mass-balance estimate (see above); the reward does not use it.
- 2026 is one live run (split `live`): it is played once during the demo, and no 2026 result is stored or averaged.
- DSSAT reads two-digit years, so it simulates 2026 on stand-in year 2025 with the real 2026 weather
  (`env/dssat_sim.py` `dssat_year_for`); only the label and DSSAT's stored CO2 differ.
- Grid hindsight is not an upper bound: it is the best of 56 fixed plans, and the adaptive team beats it in 10 of 15
  test seasons.
- No RL training: the model weights are unchanged. Gains come from prompt and multi-agent design changes, scored by the
  direct runner; NeMo Gym wraps the same env server for evaluation.
- One saved run per policy and season; intervals do not include sampling noise across repeated runs.

## Person B implementation and evidence

See [PERSON_B.md](PERSON_B.md) for serving, inference and dev experiments, and
[TASKS_PERSON_B.md](TASKS_PERSON_B.md) for the maintained done/pending list.
B0 is verified on the Brev H100: [host](results/b0-host.json), [tool smoke](results/b0-smoke.json).
B1/B2 live-model toy checks: [audit](results/b1-b2-live.json), [logs](results/b1-b2-live-logs.zip).
`fixtures/replay.nemotron-toy.{single,multi}.jsonl` are complete replay samples.
Five configs are registered: `single`, `multi`, `multi_no_critic`, `multi_no_weather`, `multi_no_tools`.
Default model backend is vLLM; set `FIELDTWIN_MODEL_BACKEND=stub` explicitly for software checks.
The runtime enforces action caps, role tool permissions, at most one planner revision,
and a visible shared-farmer fallback after malformed outputs or model HTTP failures.
