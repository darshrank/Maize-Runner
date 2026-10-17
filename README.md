# FieldTwin

FieldTwin is a multi-agent crop advisor for one maize field over one season. Each week it decides
nitrogen (kg/ha) and irrigation (mm), scored on profit minus a nitrate leaching penalty.
The shared simulator is currently a **toy model**. Single-agent and five-agent Nemotron policies are integrated.
BF16 Nemotron serving and a live tool call are verified on the Brev H100; crop-performance validation remains pending.

## Commands

```bash
uv sync                                                        # install (Python 3.11+)
uv run uvicorn env.server:app --port 9000                      # 1. start the env server
uv run python -m agents.run --policy farmer --task-id UFGA-s3  # 2. play a season (writes runs/farmer/UFGA-s3.jsonl)
uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]   # 3. eval -> results/
python -m http.server 8080   # 4. view the UI at http://localhost:8080/ui/ (run from the repo root)
```

Checks: `bash scripts/smoke.sh` (prints PASS/FAIL) and `uv run pytest`.

## Layout

- `env/`: `sim_base.py` (Simulator interface), `toy_sim.py` (toy crop model), `server.py` (HTTP API), simulator factory in `env/__init__.py`.
- `agents/`: `client.py` (env client), `tools.json` (tool schemas), `policies/` (baselines + Nemotron single/multi/ablations), `run.py` (season runner + logger).
- `fieldtwin_agents/`: async agent engine, vLLM client, versioned prompts and dev experiment helpers, reused by the shared policies.
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

- **A**: `env/dssat_sim.py` implementing `Simulator`, register it in `env/__init__.py` (`SIMULATORS`), then set `env.simulator: dssat`; real prices in `config.yaml`; NeMo Gym wrapper.
- **B**: `agents/policies/single.py` and `multi.py` implement the shared Policy interface using the async engine, vLLM (`VLLM_BASE_URL`, `VLLM_MODEL`, see `.env.example`) and `agents/tools.json`. All five configs are registered and included in `eval.configs`; attempted model calls and farmer fallbacks are counted in the shared logger.
- **C**: everything in `ui/`; vLLM metrics script.

## Nemotron policies and local checks

With vLLM running, use the same season runner and evaluator as the baselines:

```bash
uv run python -m agents.run --policy single --task-id UFGA-s3 --split dev
uv run python -m agents.run --policy multi --task-id UFGA-s3 --split dev
uv run python -m eval.run_eval --split dev --configs single,multi,multi_no_critic,multi_no_weather,multi_no_tools
```

For a complete local check without a GPU, run `uv run python scripts/check_skeleton_agents.py`.
It starts the toy HTTP server, runs the baselines and all B policies using an explicitly
synthetic model, and verifies eval output and UI replay logs. It writes the standard
`runs/` and `results/` outputs. `uv run pytest` checks the shared contracts and policy guards.

To use a synthetic model manually, set `FIELDTWIN_MODEL_BACKEND=stub` in the shell
(PowerShell: `$env:FIELDTWIN_MODEL_BACKEND = "stub"`); unset it before real model evaluation.
The default is `vllm`. Exports are used directly; `.env.example` is a reference and is
not loaded automatically. `config.yaml` controls action caps and prompt version. The
fallback matches the shared farmer policy, including irrigation, and logs every use.
Model output can use JSON or the shared `submit_decision` tool. No-tools disables read
tools while retaining the action submission channel. Tool submission never steps the env.

See [PERSON_B.md](PERSON_B.md) for serving and dev experiments, and
[TASKS_PERSON_B.md](TASKS_PERSON_B.md) for completed work and remaining real milestones.
Live B0 evidence: [host configuration](results/b0-host.json) and [parsed tool-call smoke test](results/b0-smoke.json).
