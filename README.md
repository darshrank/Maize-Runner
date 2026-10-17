# FieldTwin — Person B

Nemotron serving configuration, single-agent and five-agent crop policies, weekly
JSONL logs, bounded action guards, parallel dev evaluation and ablations.
See [TASKS_PERSON_B.md](TASKS_PERSON_B.md) for the maintained done/pending handoff.

The repository started empty. Everything here runs locally with synthetic fixtures;
real GPU serving and simulator-based improvement remain pending. The stub is neither
DSSAT nor an agronomic benchmark. It must never supply submission performance numbers.

## Local quick start (Python 3.11+)

```powershell
python -m pip install -e .
python -m unittest discover -s tests -v
python scripts/check_stub_http.py
python -m fieldtwin_agents run --stub --tasks fixtures/dev.stub.jsonl --configs single multi multi_no_critic multi_no_weather multi_no_tools --output results/local-demo --concurrency 8
python -m fieldtwin_agents analyze results/local-demo
```

Each run reserves a new output directory. Reusing it fails instead of overwriting or
concatenating seasons. Completed seasons survive batch failures in `eval.csv`;
`errors.json` records failures and the command exits unsuccessfully. Never treat a
partial evaluation as complete. Generated runs are ignored by git.

## Serving Nemotron (B0)

Run `bash scripts/serve_vllm.sh` on a Brev Linux H100 80 GB host with Docker and NVIDIA
Container Toolkit installed. This pins vLLM `v0.27.1`, the BF16 30B checkpoint,
`qwen3_coder` tool parser, `nemotron_v3` reasoning parser, prefix caching and 64
concurrent sequences. The 16K context setting leaves room for batching. The flags
follow the [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16#vllm)
(checked 2026-10-17); performance and A100 compatibility must be verified on the host.
The recipe uses one checkpoint for every role, with no other LLM or LLM judge.
Its 3B active parameters make repeated seasonal agent calls practical; actual latency
and throughput need measurement by C.

The service binds to localhost. Use an SSH tunnel from this machine:

```text
ssh -L 8000:127.0.0.1:8000 <brev-host>
```

```powershell
python -m fieldtwin_agents smoke --vllm-url http://127.0.0.1:8000/v1
```

`smoke` requires one real automatically parsed `get_weather({})` call and validates
the returned arguments as JSON. It fails on text-only answers. This has not been run
against a GPU here. Use `VLLM_API_KEY` only if the externally hosted service requires
authentication; never put credentials in source, CLI arguments or git. No OpenAI API
or OpenAI key is used. An optional `--model` is for the same checkpoint's serving alias.

Once the model is available, use `run --stub-env ...` to play against the local
synthetic environment with real Nemotron calls. Unlike `--stub`, this does not replace
the model. For an external HTTP stub, add `--synthetic-env` to preserve provenance.

## Person A integration (B1/B2)

Provide A's dev-only JSONL with explicit split labels:

```json
{"task_id":"fl-2009-s3","site":"UFGA","weather_seed":3,"split":"dev"}
```

Both file loading and policy runners reject `test`. Missing split labels are rejected
before network requests. `fixtures/dev.stub.jsonl` is 20 *synthetic* tasks, not A's
authoritative task list. A owns the held-out evaluator and can integrate the policy
using `AgentTeam.decide(obs, episode_id, week, remaining_n, log)`; this policy does not
select or inspect task splits. B's CLI never exposes a test override.

```powershell
python -m fieldtwin_agents run --tasks tasks/dev.jsonl --env-url http://127.0.0.1:9000 --vllm-url http://127.0.0.1:8000/v1 --configs single multi --output results/dev-v1 --concurrency 8 --n-cap 240 --farmer-schedule config/farmer.json
```

The HTTP client implements the PDF contract exactly: `POST /reset`, `POST /step`,
and `GET /tool/{name}?episode_id=...`. Read-tool arguments are `{}`; the runner binds
the current episode, preventing a model from selecting another field. A's arbitrary
JSON tool payloads are forwarded to the model without imposing an invented schema.
Reset must return week 0; a step advances one week and returns `obs`, `done`, `weekly`,
and at termination all eight final metrics from the PDF.

The provisional season cap is 240 kg/ha. The default fallback applies 40 kg/ha at
weeks 0, 5 and 9 and zero irrigation. **Agree both with A before real evaluation.**
A's schedule file is a JSON map, for example:

```json
{"0":{"n_kg_ha":40,"irr_mm":0},"5":{"n_kg_ha":40,"irr_mm":0},"9":{"n_kg_ha":40,"irr_mm":0}}
```

Weekly N is clamped to 0–120 kg/ha, irrigation to 0–50 mm, and N to the remaining
season cap, including fallback weeks. Nonfinite values, booleans and numeric strings
are rejected. Two consecutive invalid responses/tool batches cause a logged farmer
fallback. A successful valid response resets the malformed streak. Every role has a
six-completion bound. HTTP policy failures also fall back visibly. Environment step
errors stop that episode without retrying an action of uncertain outcome.

The team runs Weather and Crop concurrently, then Planner → Critic → at most one
Planner revision → Coordinator. The Coordinator returns an action; only Python calls
`/step`. The final guard applies even if every agent proposes an invalid amount.
Each role has only the read tools assigned in the PDF. Season concurrency defaults
to eight; shared role prompts stay identical across seasons for prefix caching.

Run a synthetic HTTP environment separately to test another component's client:

```powershell
python -m fieldtwin_agents stub-server --port 9000
python -m fieldtwin_agents run --stub-model --tasks fixtures/dev.stub.jsonl --env-url http://127.0.0.1:9000 --configs single --output results/local-http
```

## Logs and C's replay

Within each run directory, logs are `runs/<config>/<task_id>.jsonl`. Every line has
`t`, `week`, `agent`, `kind`, `data`. Agent names and kinds match the PDF. A `decision`
event includes the final guarded `n_kg_ha`, `irr_mm`, and one-line `reason` for the UI.
`fallback` events carry cause and cumulative count. `tool_call` / `tool_result` include
tool name and data. A coordinator `tool_result` named `step` includes `weekly`, current
observations and final metrics for replay counters. The first coordinator message
records episode, initial observation, prompt hashes and `synthetic` provenance.
`fixtures/replay.stub.jsonl` is a complete synthetic team season for C's UI integration.

Each run's `eval.csv` has the PDF's exact columns. It lives in a run directory so B
does not overwrite A's `results/eval.csv`. `manifest.json` records config, tasks,
prompt hashes, model, simulator endpoint, cap, fallback schedule and synthetic status.
It omits credentials. A can import completed CSV rows after checking provenance.

## Dev improvement and freeze (B3/B4)

```powershell
python -m fieldtwin_agents analyze results/dev-v1
# Read diagnostics.json and the worst three logs; change ONE diagnosed role prompt.
python -m fieldtwin_agents run --tasks tasks/dev.jsonl --env-url http://127.0.0.1:9000 --configs single multi --output results/dev-v2 --prompt-version v2 --farmer-schedule config/farmer.json
python -m fieldtwin_agents compare results/dev-v1 results/dev-v2 --change "Describe the diagnosed single prompt change" --output results/iterations.md
python -m fieldtwin_agents freeze --prompt-version v2 --output config/prompts-final.freeze.json
```

`v2` currently supplies one **unvalidated** rain-related critic hypothesis; it is not
an improvement claim. [results/iterations.md](results/iterations.md) records the
remaining real-dev work. Comparison checks paired complete tasks, equal environment,
model, cap and fallback schedule and exactly one changed role prompt. It records mean
reward delta, including zero or negative values. Freeze writes SHA-256 hashes; pass
`--freeze-manifest config/prompts-final.freeze.json` on subsequent runs to reject drift.
The committed v1 snapshot is provisional; choosing the final version requires real dev.

| Config | Behavior |
| --- | --- |
| `single` | Coordinator alone, all five read tools |
| `multi` | Full five-agent team, one critic revision |
| `multi_no_critic` | Omit critic and revision |
| `multi_no_weather` | Omit Weather role and disable get_weather for every role |
| `multi_no_tools` | Keep five roles; disable every model read tool |

All ablations retain the same current `obs`, action guard and fallback schedule.
No-tools still receives current observations from reset/step; it cannot call read tools.
Real baseline scores, held-out evaluation, crop simulation, reward pricing, NeMo Gym
server, metrics scraping and UI are owned by A/C and are not fabricated here.
