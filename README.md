# FieldTwin

FieldTwin is a multi-agent crop advisor for one maize field over one season. Each week it decides
nitrogen (kg/ha) and irrigation (mm), scored on profit minus a nitrate leaching penalty.
This repo is a **walking skeleton**: every part runs end to end, and most parts are simple fakes that teammates replace.

## Commands

```bash
uv sync                                                        # install (Python 3.11+)
bash scripts/install_gym_dssat.sh                              # once per machine: gym-DSSAT (Ubuntu 22.04/20.04, Debian 12; needs sudo)
uv run uvicorn env.server:app --port 9000                      # 1. start the env server
uv run python -m agents.run --policy farmer --task-id UFGA-s3  # 2. play a season (writes runs/farmer/UFGA-s3.jsonl)
uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]   # 3. eval -> results/
python -m http.server 8080   # 4. view the UI at http://localhost:8080/ui/ (run from the repo root)
```

Checks: `bash scripts/smoke.sh` (prints PASS/FAIL) and `uv run pytest`.

The simulator is gym-DSSAT (`env.simulator: dssat`). On a machine without it, run anything with
`FIELDTWIN_SIMULATOR=toy` to use the toy crop model instead (same contracts).

## Layout

- `env/`: `sim_base.py` (Simulator interface), `dssat_sim.py` + `dssat_worker.py` (gym-DSSAT), `toy_sim.py` (toy crop model), `server.py` (HTTP API), simulator factory in `env/__init__.py`.
- `agents/`: `client.py` (env client), `tools.json` (OpenAI tool schemas), `policies/` (registry + `no_n`, `farmer`, `nemotron_stub`), `run.py` (season runner + logger).
- `eval/`: `hindsight.py` (grid-search ceiling), `run_eval.py` (eval.csv + summary.md).
- `ui/`: static Three.js replay of two runs side by side.
- `tasks/`: `dev.jsonl` (seeds 1-20) and `test.jsonl` (seeds 101-120, held out).

## Frozen contracts

The full text is in `SKELETON_SPEC.md`. Do not change these without telling the team.

**HTTP (env server, port 9000)**, spec section 7
- `POST /reset` `{task_id, site, weather_seed}` → `{episode_id, obs, week: 0}`
- `POST /step` `{episode_id, n_kg_ha, irr_mm, reason}` → `{obs, week, done, weekly, clamped}` plus `final` when done.
  Out-of-range values are clamped (N 0..120/week, irrigation 0..50/week, N 300/season), not rejected.
- `GET /tool/{get_weather|get_crop_state|get_soil|get_history|get_budget}?episode_id=...`
- `GET /health` → `{ok: true, simulator}`. Unknown tool or episode → 404 `{error: "..."}`.
- `obs` = `{day, week, stage, soil_water_frac, soil_n_kg_ha, n_applied_total, irr_total_mm, biomass_kg_ha}`
- `weekly` = `{rain_mm, n_leached, n_uptake, n_gas}`
- `final` = `{grain_kg_ha, n_applied, n_uptake, n_leached, n_gas, irr_mm, profit_usd_ha, reward}` where
  `profit = grain*maize_price - n_applied*n_price - irr_mm*water_price` and `reward = profit - leach_penalty*n_leached`.

**Simulator interface** (`env/sim_base.py`), spec section 5: `reset`, `step_week`, `weather_history`, `weather_outlook`, `crop_state`, `soil_state`, `final`.

**Policy interface** (`agents/policies/base.py`), spec section 8: `Policy.decide(episode_id, week, obs, env, log) -> Decision(n_kg_ha, irr_mm, reason)`.
Log every tool call and result through `log`.

**Agent log** `runs/<config>/<task_id>.jsonl`, one object per line:
`{"t": iso_time, "week": int, "agent": "weather|crop|planner|critic|coordinator|policy|env", "kind": "...", "data": {...}}`
with kinds `tool_call`, `tool_result`, `message`, `decision` (`{n_kg_ha, irr_mm, reason}`), `fallback`, `step_result` (the /step response), `final`.
`runs/index.json` = `{"<config>": ["<task_id>", ...]}`.

**eval.csv columns**: `config, task_id, split, grain_kg_ha, n_applied, n_uptake, n_leached, n_gas, irr_mm, profit_usd_ha, reward, llm_calls, wall_s, fallbacks`.

## Who replaces what

- **A**: ~~`env/dssat_sim.py` implementing `Simulator`, `env.simulator: dssat`~~ (done; mapping notes in the `env/dssat_sim.py` docstring); real prices in `config.yaml`; NeMo Gym wrapper.
- **B**: `agents/policies/single.py` and `multi.py` using vLLM (`VLLM_BASE_URL`, `VLLM_MODEL`, see `.env.example`) + `agents/tools.json`; register them in `agents/policies/__init__.py` and add configs to `eval.configs`. Bump `log.llm_calls` per model call and log `fallback` events.
- **C**: everything in `ui/`; vLLM metrics script.
