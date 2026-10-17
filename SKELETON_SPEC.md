# FieldTwin walking skeleton: build spec for Claude Code

Build a small repo where every part exists and runs end to end, but most parts are simple fakes.
Three teammates will later replace the fakes in parallel:
A replaces the toy simulator with gym-DSSAT, B replaces the farmer policy with Nemotron agents,
C makes the UI beautiful. **The contracts below are frozen: implement them exactly.**

Time budget: about 40 minutes. Keep it simple, readable, and well commented. No over-engineering.

---

## 0. Project facts (context only)

- Project: FieldTwin, a multi-agent crop advisor. One maize field, one season, one decision per week:
  nitrogen (kg/ha) and irrigation (mm). Scored on profit minus a nitrate leaching penalty.
- Later: the real simulator is gym-DSSAT (Linux, Fortran DSSAT). The real agents are Nemotron 3.5 Lightning
  served by vLLM (OpenAI-compatible API at `http://localhost:8000/v1`), with tool calling.
- Ports: env server 9000, UI static server 8080, vLLM 8000 (not part of the skeleton).

## 1. Stack

- Python 3.11+ managed with `uv` (`pyproject.toml`). Dependencies: `fastapi`, `uvicorn`, `httpx`, `pyyaml`, `numpy`, `pytest`.
- UI: one static `ui/index.html` + `ui/app.js` + `ui/style.css`, Three.js `0.160.0` via an import map from a CDN. No build step.
- No secrets in the repo. Add `.env.example` with `VLLM_BASE_URL=http://localhost:8000/v1` and `VLLM_MODEL=`.

## 2. Repo layout

```
fieldtwin/
  README.md
  pyproject.toml
  config.yaml
  .gitignore              # .venv, __pycache__, .env, runs/*, results/* (keep .gitkeep files)
  .env.example
  tasks/dev.jsonl         # 20 seasons
  tasks/test.jsonl        # 20 different seasons (held out)
  env/
    __init__.py
    sim_base.py           # abstract Simulator interface (what A reimplements with gym-DSSAT)
    toy_sim.py            # toy crop model implementing Simulator
    server.py             # FastAPI server implementing the HTTP contract
  agents/
    __init__.py
    client.py             # small httpx client for the env API
    tools.json            # OpenAI-format tool schemas for the read tools (B uses these)
    policies/
      __init__.py         # registry: name -> policy class
      base.py             # Policy interface
      no_n.py             # never applies nitrogen or water
      farmer.py           # fixed split schedule
      nemotron_stub.py    # placeholder for B: raises NotImplementedError with a clear message
    run.py                # CLI: play one season with a policy, write the JSONL log
  eval/
    __init__.py
    hindsight.py          # grid search best schedule per season (the ceiling)
    run_eval.py           # run configs over a task split, write results/eval.csv + summary.md
  ui/
    index.html, app.js, style.css
  runs/.gitkeep
  results/.gitkeep
  scripts/smoke.sh        # end-to-end check (see section 9)
  tests/test_contract.py  # contract tests against the server
```

## 3. config.yaml

```yaml
env:
  url: http://localhost:9000
  simulator: toy            # later: dssat
  weeks_per_season: 20
  max_n_kg_ha_per_week: 120
  max_irr_mm_per_week: 50
  max_n_kg_ha_per_season: 300
  outlook_noise: {rain_frac: 0.4, temp_c: 2.0}
prices:                     # PLACEHOLDERS: A replaces with cited values
  maize_usd_per_kg: 0.17
  n_usd_per_kg: 0.90
  water_usd_per_mm_ha: 0.50
reward:
  leach_penalty_usd_per_kg: 2.0
eval:
  configs: [no_n, farmer, hindsight]   # B adds: single, multi, multi_no_critic, multi_no_weather, multi_no_tools
  parallel: 8
agents:
  base_url_env: VLLM_BASE_URL
  model_env: VLLM_MODEL
```

## 4. Tasks

`tasks/dev.jsonl` and `tasks/test.jsonl`, one JSON object per line:
`{"task_id": "UFGA-s3", "site": "UFGA", "weather_seed": 3, "split": "dev"}`.
Dev seeds 1 to 20, test seeds 101 to 120. Generate them with a tiny script or write them by hand.

## 5. Simulator interface (env/sim_base.py)

```python
class Simulator(ABC):
    def reset(self, site: str, weather_seed: int) -> dict: ...        # returns obs
    def step_week(self, n_kg_ha: float, irr_mm: float) -> dict: ...  # applies action on day 1, runs 7 days, returns {"obs", "weekly", "done"}
    def weather_history(self, days: int) -> list[dict]: ...           # observed past days
    def weather_outlook(self, days: int, rng) -> list[dict]: ...      # NEXT days' true weather + noise (rng seeded per task)
    def crop_state(self) -> dict: ...
    def soil_state(self) -> dict: ...
    def final(self) -> dict: ...                                       # end-of-season totals (no money; server adds money)
```

**obs** (returned by reset and each step):
`{"day", "week", "stage", "soil_water_frac", "soil_n_kg_ha", "n_applied_total", "irr_total_mm", "biomass_kg_ha"}`
**weekly**: `{"rain_mm", "n_leached", "n_uptake", "n_gas"}` (this week's sums)
**final** from simulator: `{"grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas", "irr_mm"}`

## 6. Toy crop model (env/toy_sim.py)

Deterministic given `weather_seed`. Daily loop, 140 days (20 weeks). Use `numpy.random.default_rng(weather_seed)`.
Goal: behave plausibly so policies differ (too little N = low yield, too much or badly timed N before heavy rain = leaching). Exact realism does not matter.

- Weather per day: `tmax` around 30 C, `tmin` around 19 C (noise sd 2). Rain: 30% chance per day, amount exponential with mean 12 mm, plus 2 to 3 random storm days of 50 to 90 mm. Precompute the whole season at reset.
- Growing degree days: `gdd = max(0, (tmax + tmin)/2 - 10)`, cumulative.
- Stage from cumulative GDD: `VE` < 100, `V6` < 450, `V10` < 750, `VT` < 1150, `R1` < 1350, `R3` < 1700, else `R6` (mature).
- Soil water bucket (mm): capacity 150, start 100. Each day: `+ rain + irrigation(day 1 of week) - ET`, ET = `4 mm * stage_factor` (0.4 at VE rising to 1.2 at VT to R3, 0.6 at R6). Overflow above 150 is drainage.
- Soil nitrate (kg/ha): start 30. Fertilizer is added on day 1 of the week. Leaching each day = `soil_n * min(0.6, drainage_mm / 150)`. Gas loss = `0.5% of soil_n per day` if `soil_water_frac > 0.85`, else 0.
- N uptake per day = `min(soil_n, demand)`, demand by stage: VE 0.3, V6 2.5, V10 4.0, VT 3.0, R1 2.0, R3 1.0, R6 0 (kg/ha/day), times water stress factor.
- Water stress factor = `clip(soil_water_frac / 0.4, 0, 1)`. N stress factor = `clip(n_uptake_so_far / (0.8 * demand_so_far), 0, 1)`.
- Biomass gain per day = `120 * stage_growth * water_stress * n_stress` (stage_growth 0.2 at VE, 1.0 V6 to R3, 0 at R6).
- Grain at end = `biomass * 0.5 * n_stress_avg_after_VT` (clip to a sane range, roughly 3,000 to 13,000 kg/ha).
- Tune constants lightly so that: `no_n` < `farmer` < `hindsight` on most seeds, and heavy N right before a storm leaches visibly.

## 7. HTTP contract (env/server.py), FROZEN

- `POST /reset` body `{"task_id", "site", "weather_seed"}` returns `{"episode_id", "obs", "week": 0}`.
- `POST /step` body `{"episode_id", "n_kg_ha", "irr_mm", "reason"}`: validate ranges from config (`n_kg_ha` 0..120, `irr_mm` 0..50, season N cap 300; clamp and report `{"clamped": true}` instead of erroring). Returns `{"obs", "week", "done", "weekly", "clamped"}`; when `done`, also `"final"`.
- `GET /tool/{name}?episode_id=...` for read tools:
  - `get_weather`: `{"history": last 14 days [{day, tmax, tmin, rain_mm}], "outlook": next 7 days with noise}`. Noise rng = `default_rng(weather_seed * 1000 + week)` so every policy sees the same outlook.
  - `get_crop_state`: `{"stage", "gdd", "biomass_kg_ha", "n_stress", "water_stress"}`
  - `get_soil`: `{"soil_water_frac", "soil_n_kg_ha"}`
  - `get_history`: list of past weeks `{week, n_kg_ha, irr_mm, rain_mm, n_leached, n_uptake}`
  - `get_budget`: `{"n_applied_total", "n_remaining_season_cap", "irr_total_mm", "spend_usd"}`
- **final** (on done): simulator final plus `profit_usd_ha = grain * maize_price - n_applied * n_price - irr_mm * water_price` and `reward = profit_usd_ha - leach_penalty * n_leached`.
- Unknown tool or episode: HTTP 404 with `{"error": "..."}` written so an LLM could fix its call.
- `GET /health` returns `{"ok": true, "simulator": "toy"}`.
- Episodes stored in memory (dict). Thread-safe enough for 8 to 32 parallel episodes.
- The server picks the simulator class from `config.yaml env.simulator` through a small factory, so A can add `dssat` without touching the server.

## 8. Agent side

**agents/policies/base.py**
```python
@dataclass
class Decision:
    n_kg_ha: float
    irr_mm: float
    reason: str

class Policy(ABC):
    name: str
    def decide(self, episode_id: str, week: int, obs: dict, env: "EnvClient", log: "RunLogger") -> Decision: ...
```
Policies may call `env.tool(name, episode_id)` and must log every tool call and result through `log`.

- `no_n`: always 0, 0.
- `farmer`: 60 kg N at week 0, 60 at week 5 (about V6), 40 at week 9 (about V10); irrigate 25 mm when `soil_water_frac < 0.35` (calls `get_soil` and logs it).
- `nemotron_stub`: raises `NotImplementedError("B: implement Nemotron agents here; see agents/tools.json")`.

**agents/tools.json**: OpenAI tool schemas (`{"type": "function", "function": {name, description, parameters}}`) for the 5 read tools plus `submit_decision(n_kg_ha, irr_mm, reason)`. Good descriptions with units.

**Agent log, FROZEN**: `runs/<config>/<task_id>.jsonl`, one JSON object per line:
`{"t": iso_time, "week": int, "agent": "weather|crop|planner|critic|coordinator|policy|env", "kind": "...", "data": {...}}`
Kinds: `tool_call`, `tool_result`, `message`, `decision`, `fallback`, plus `step_result` (data = the /step response) and `final` (data = final dict). The `decision` data is `{"n_kg_ha", "irr_mm", "reason"}`.

**agents/run.py** CLI:
`uv run python -m agents.run --policy farmer --task-id UFGA-s3 [--split dev]` resets, loops weeks until done, writes the log, prints the final dict.
Also write/update `runs/index.json`: `{"<config>": ["<task_id>", ...]}` so the UI can list runs.

## 9. Eval

**eval/hindsight.py**: for a task, try every schedule in a grid: N doses {0, 40, 80} at weeks {0, 5, 9} (27 combos) times irrigation {never, 25 mm when soil_water_frac < 0.35} = 54 runs via the API. Keep the best `reward`. Log the best run as a normal run log under `runs/hindsight/`. Label as "hindsight (unreachable ceiling)" in the summary.

**eval/run_eval.py**:
`uv run python -m eval.run_eval --split dev --configs no_n,farmer,hindsight [--limit 3]`
- Runs each config on each task in the split with a thread pool (`eval.parallel`).
- Writes `results/eval.csv` (append or replace rows for the same config + task), columns FROZEN:
  `config, task_id, split, grain_kg_ha, n_applied, n_uptake, n_leached, n_gas, irr_mm, profit_usd_ha, reward, llm_calls, wall_s, fallbacks`
  (`llm_calls` and `fallbacks` are 0 for non-LLM policies).
- Writes `results/summary.md`: one table per split, one row per config, mean and 95% CI (normal approx) of reward, profit, grain, n_applied, n_leached; plus **gap closed** = `(mean_reward - farmer) / (hindsight - farmer)` and **leaching vs farmer** in percent.

## 10. UI (ui/)

Static page served with `python -m http.server 8080` from the repo root, opened at `http://localhost:8080/ui/`.
Reads `runs/index.json`, then `runs/<config>/<task>.jsonl`.

- NVIDIA look: black background, green `#76b900` accents, clean sans font.
- Top bar: task picker, LEFT config picker (default `farmer`), RIGHT config picker (default best available), play/pause, week slider (0 to 20), speed.
- Two fields side by side, same season. Each field = 12 x 12 grid of small glass-like cubes (Three.js `MeshPhysicalMaterial`, slight transmission) with an emissive core:
  - core brightness = `soil_water_frac` for that week
  - a green pulse wave across the field in a week with N applied (strength by kg)
  - small red particles dripping below the field in weeks with leaching (count by kg)
  - cubes grow slightly taller with biomass
- Under each field: live counters (N applied, N leached, irrigation, biomass, then final grain, profit, reward at the end).
- Right panel: the selected field's log for the current week, as chat bubbles by agent (tool calls collapsed), and the decision reason in bold.
- Weather strip along the bottom: rain bars per week, highlight storms.
- Must work with only the farmer and no_n logs present. Keep the code split into small functions so C can restyle it.

## 11. Smoke test and README

**scripts/smoke.sh**: start the env server in the background, wait for `/health`, run `agents.run` with `farmer` on one task, run `eval.run_eval --split dev --limit 3 --configs no_n,farmer,hindsight`, check that `results/eval.csv` and `results/summary.md` exist and that farmer reward > no_n reward on average, kill the server, print PASS or FAIL.

**tests/test_contract.py**: start the app with FastAPI's TestClient; reset, call every tool, step to done, check every frozen field name is present, check clamping and the 404 message.

**README.md**: what FieldTwin is (3 lines), the 4 commands (start env, play a season, eval, view UI), the frozen contracts (link to sections above or copy them), and "who replaces what":
- A: `env/dssat_sim.py` implementing `Simulator`, then `env.simulator: dssat`; real prices in `config.yaml`; NeMo Gym wrapper.
- B: `agents/policies/single.py` and `multi.py` using vLLM + `agents/tools.json`; add configs to `eval.configs`.
- C: everything in `ui/`; vLLM metrics script.

## 12. Done when

1. `bash scripts/smoke.sh` prints PASS.
2. `uv run pytest` passes.
3. The UI replays a farmer season next to a no_n season, with the cubes reacting to water, N and leaching.
4. Then: `git init`, first commit "walking skeleton", and stop. Do not build anything beyond this spec.
