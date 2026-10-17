# FieldTwin as a NeMo Gym environment

FieldTwin wrapped for [NeMo Gym](https://github.com/NVIDIA-NeMo/Gym) (tested with `nemo-gym==0.7.0`):

| NeMo Gym piece | FieldTwin |
|---|---|
| Dataset | 35 real seasons as JSONL, one row per (site, year): `dev` 20 (UFGA 1990-2009), `test` 15 (UFGA 2010-2024, held out) |
| Resources server | `resources_servers/fieldtwin/app.py` (`GymnasiumServer`): a thin adapter over the FieldTwin env server on port 9000 |
| Tools | the env server's 5 read tools + `submit_decision` (schemas from `agents/tools.json`) |
| Verifier | the env's final `reward` (profit minus 2 USD/kg nitrate leached, USD/ha) when the season ends; 0 on every other step |
| Agent | NeMo Gym's built-in `gymnasium_agent` (`max_steps: 300`) |

One rollout = one season: the model calls read tools and `submit_decision` once per week until the crop matures
(18-20 weeks). A response without a tool call gets a reminder; a season that hits `max_steps` is truncated with reward 0.

**`test` is held out.** Tune on `dev` only; `test` is run once, at the end (milestone A4).

## Setup (once)

```bash
uv venv gym_env/.venv --python 3.13          # NeMo Gym needs Python >= 3.13.14; kept out of the project deps
VIRTUAL_ENV=gym_env/.venv uv pip install nemo-gym==0.7.0
uv run python gym_env/prepare.py             # builds environments/fieldtwin/data/{dev,test,example}.jsonl
```

Re-run `prepare.py` after changing prices or limits in `config.yaml` (the system prompt quotes them).
The first `gym env start` builds one venv per server under `gym_env/` (a few minutes; gitignored).

## Run scoring

Three terminals, all from the repo root unless noted:

```bash
# 1. FieldTwin env server (gym-DSSAT; add FIELDTWIN_SIMULATOR=toy on a machine without it)
uv run uvicorn env.server:app --port 9000

# 2. NeMo Gym servers (from gym_env/). Real policy: Nemotron on vLLM
cd gym_env && .venv/bin/gym env start --environment fieldtwin --search-dir . \
    --model-type vllm_model --model <served model name> --model-url http://localhost:8000/v1 --model-api-key dummy
# wait for "All 4 / 4 servers ready!"

# 3. Collect rollouts and score (from gym_env/)
cd gym_env && .venv/bin/gym eval run --no-serve --agent fieldtwin_gymnasium_agent \
    --input environments/fieldtwin/data/dev.jsonl --output results/dev_rollouts.jsonl
```

`gym eval run` prints the key metrics (`mean/reward`, `mean/terminated`, `mean/truncated`, tokens) and writes
`results/<name>_rollouts.jsonl` (one season per line; `info.final` holds grain, N applied, leaching, profit, reward)
and `results/<name>_rollouts_aggregate_metrics.json`.

## Dummy policy (no GPU)

`dummy_policy.py` is a scripted stand-in for the vLLM server: it answers `/v1/chat/completions` with tool calls and
plays the farmer baseline (each week `get_soil`, then 60/60/40 kg N at weeks 0/5/9, 25 mm when soil water < 0.35).
NeMo Gym's `vllm_model` talks to it exactly as to Nemotron; only the URL changes.

```bash
uv run python gym_env/dummy_policy.py        # http://localhost:8001/v1, instead of vLLM in step 2:
cd gym_env && .venv/bin/gym env start --environment fieldtwin --search-dir . \
    --model-type vllm_model --model fieldtwin-farmer-script --model-url http://localhost:8001/v1 --model-api-key dummy
cd gym_env && .venv/bin/gym eval run --no-serve --agent fieldtwin_gymnasium_agent \
    --input environments/fieldtwin/data/example.jsonl --output results/example_rollouts.jsonl
```

Checked results on the 3 example seasons (UFGA 1990-1992), all terminated, none truncated:

| simulator | rewards (1990, 1991, 1992) | mean/reward | same as our own runner? |
|---|---|---|---|
| toy | 1057.86, 524.94, 1079.07 | 887.29 | yes, identical to `agents.run --policy farmer` |
| gym-DSSAT | 970.60, 1152.69, 1218.89 | 1114.06 | yes, equals the farmer mean in `scripts/smoke.sh` on DSSAT (1114.1) |

## Notes

- The resources server keeps no simulator state of its own; it forwards to the env server, so NeMo Gym and
  `eval/run_eval.py` always score the same thing. Set `env_url` in `environments/fieldtwin/config.yaml` if the
  env server is elsewhere.
- `domain: agent` because NeMo Gym's domain list has no agriculture entry.
- Dataset licenses are `TBD` in `config.yaml` (NeMo Gym requires one for train/validation sets); pick one before publishing.
- Running with `--split` instead of `--no-serve --input` (NeMo Gym's prepared-data mode) is not set up.
