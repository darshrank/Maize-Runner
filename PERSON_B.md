# Person B: agents, serving and dev experiments

The shared [README](README.md) is the primary run guide. The maintained
[done/pending checklist](TASKS_PERSON_B.md) records what is complete locally and what
still requires dev evaluation. A's gym-DSSAT environment, real-year tasks and fixed
prices are integrated from `a-env` (64b38f9). Synthetic results are software
checks, not crop-performance evidence.

## Architecture and contracts

`agents/policies/single.py` and `multi.py` implement main's synchronous `Policy.decide`
interface through `nemotron.py`. The adapter runs the existing async engine for one
week, so Weather and Crop run concurrently and eval's eight season threads can batch
model requests on one vLLM server. Each week closes its async client before its event
loop ends. System prompts stay identical per role across seasons for prefix caching.

The flow is Weather + Crop -> Planner -> Critic -> at most one Planner revision ->
Coordinator. All roles use the same Nemotron checkpoint. Roles receive only their
assigned read tools. Both JSON actions and `submit_decision` calls are supported;
submitting a decision never calls `/step` inside the model tool loop.

`agents/tools.json` is the authoritative schema file, including units, the 0 = severe
stress / 1 = no stress convention and `history` / `outlook` weather fields. Config
limits come from `config.yaml`: 120 kg N/ha/week, 50 mm/week and 300 kg N/ha/season.
The final code guard also protects fallback weeks. Two consecutive malformed model
responses/tool batches cause a farmer fallback; HTTP model failures also fall back.
Every role is bounded to six model completions. Fallback uses the same 60/60/40 kg N
split at weeks 0/5/9 as `Farmer`, with 25 mm irrigation below soil_water_frac 0.35.

The adapter forwards every tool event/message to `RunLogger` and counts attempted
model calls in `log.llm_calls`. The shared season runner writes the coordinator's
decision, `step_result`, `final`, and `runs/index.json`. CSV columns and UI contracts
are unchanged. Partial failed season logs are saved for diagnosis; environment steps
are never automatically retried because an uncertain response could double apply N.

| Config | Behavior |
| --- | --- |
| `single` | Coordinator alone with all five read tools |
| `multi` | Full five-agent team with one critic revision |
| `multi_no_critic` | Omit critic and revision |
| `multi_no_weather` | Omit Weather and disable get_weather for every role |
| `multi_no_tools` | Disable all model read tools; retain action submission |

Every config retains current observations and identical guards/fallbacks. B's
interactive runner and isolated experiment CLI reject held-out tasks. A can evaluate
the same registered policies using the shared `eval.run_eval --split test` workflow;
B does not run test.

## GPU serving (B0 verified)

B0 passed on 2026-10-17 using the Hyperstack `fieldtwin-b0` H100 PCIe instance.
[Host evidence](results/b0-host.json) records the actual image digest, model snapshot,
GPU, launch arguments, mounts and local-only port binding; [smoke evidence](results/b0-smoke.json)
records the live advertised model and valid parsed `get_weather({})` call.
The current local endpoint is `http://127.0.0.1:8000/v1` through the SSH tunnel.

On a Brev Linux H100 80 GB host with Docker and NVIDIA Container Toolkit, first run
`bash scripts/check_b0_host.sh` to inspect GPU memory, Docker, disk, active GPU
processes and port 8000. Then run `bash scripts/serve_vllm.sh`. It pins the official
`v0.27.1-cu129` image, the BF16 30B Nemotron 3.5
Lightning checkpoint, 64 concurrent sequences, prefix caching, `qwen3_coder` tool
parser and `nemotron_v3` reasoning parser. The recipe follows the
[NVIDIA BF16 model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16#vllm)
(verified 2026-10-17). A100 compatibility and throughput still need host validation.
The 16K context setting leaves room for batching. No second LLM or LLM judge is used.
The Hyperstack host has NVIDIA driver 570.195.03, so the launch script enables vLLM's
documented CUDA compatibility libraries. `VLLM_IMAGE` can override the image variant.
Set `HF_HOME=/ephemeral/fieldtwin/huggingface` and
`VLLM_CACHE_DIR=/ephemeral/fieldtwin/vllm-cache` on this host to use the large data disk;
the OS disk is only 100 GB. `VLLM_DETACH=1` starts a detached container named
`fieldtwin-vllm`; inspect it with `docker logs fieldtwin-vllm` and
`docker inspect fieldtwin-vllm`. The default foreground mode removes the container
on exit; detached mode retains it for diagnosis.

The service binds to localhost; use `ssh -L 8000:127.0.0.1:8000 <brev-host>` from the
local machine. Export `VLLM_BASE_URL` and optionally `VLLM_MODEL` for the checkpoint's
serving alias. `.env.example` is a reference; no automatic dotenv loading is assumed.
Set `VLLM_API_KEY` only if the server requires it; never put tokens in source or git.

```bash
uv run python -m fieldtwin_agents smoke --output results/b0-smoke.json
uv run python -m agents.run --policy multi --task-id UFGA-s3 --split dev
```

After A's real-weather merge, use task IDs such as `UFGA-1992` and reset payloads
with `year`. The legacy seed form remains supported for older synthetic fixtures.
The async runner stops at `done: true`; its audit accepts crop maturity before week
20. Real runs check `/health` against the configured simulator before starting;
an unlabelled toy server is rejected. On this Brev host the DSSAT server binds to
`127.0.0.1:9001`, separate from vLLM on port 8000.

`smoke` requires one real automatically parsed `get_weather({})` call and checks its
JSON arguments after checking the advertised model ID, then saves successful evidence
when `--output` is supplied. Existing evidence files are not overwritten; choose a
new output filename when repeating verification. GPU serving is verified; crop-policy
quality and throughput still require dev evaluation. No OpenAI API key
or OpenAI service is used. `FIELDTWIN_MODEL_BACKEND=stub` explicitly selects a
deterministic synthetic model for shared policies; the default is `vllm`.

## Dev diagnostics and prompt freeze

Use the shared runner/evaluator for UI and team output. For isolated, paired B3
experiments, the async helper CLI reserves a fresh directory and produces the same
CSV/log fields plus provenance, prompt hashes and a run manifest. It also uses the
shared config limits and farmer fallback. While the server is the toy simulator,
keep `--synthetic-env` so the run cannot be mistaken for a crop evaluation.

```bash
uv run python -m fieldtwin_agents run --tasks tasks/dev.jsonl --env-url http://localhost:9000 --synthetic-env --configs single multi --output results/local-dev-v1 --prompt-version v1 --freeze-manifest config/prompts-v1.freeze.json
uv run python -m fieldtwin_agents analyze results/local-dev-v1
# Read diagnostics.json and the worst three logs; change ONE diagnosed role prompt.
uv run python -m fieldtwin_agents run --tasks tasks/dev.jsonl --env-url http://localhost:9000 --synthetic-env --configs single multi --output results/local-dev-v2 --prompt-version v2
uv run python -m fieldtwin_agents compare results/local-dev-v1 results/local-dev-v2 --change "Describe the one diagnosed change" --output results/iterations.md
uv run python -m fieldtwin_agents freeze --prompt-version v2 --output config/prompts-final.freeze.json
```

`v2` differs only in the critic's unvalidated rain-deferral hypothesis. Real dev
evidence must decide whether to keep it. Comparison requires complete paired tasks,
the same environment/model/management and exactly one changed role prompt. It records
zero or negative deltas as well as gains. Prompts in `config/prompts-v1.freeze.json`
are a provisional snapshot aligned with the skeleton. Shared policies verify
`agents.freeze_manifest`; after final dev selection, update that path and the selected
prompt version in config together. Prices, reward and real simulator validation belong
to A. C owns metrics scraping and the UI.

## Verification and replay fixtures

```bash
uv sync --frozen
uv run pytest
uv run python scripts/check_skeleton_agents.py
```

The cross-platform smoke starts the shared toy server, runs farmer/single/multi
seasons, evaluates all eight configs on three dev tasks and verifies the replay index.
Its normal outputs are available to the UI. Summaries explicitly label toy/stub
results as synthetic. Original isolated fixtures remain available through
`uv run python scripts/check_stub_http.py` and `fixtures/dev.stub.jsonl`.
`fixtures/replay.stub.jsonl` is a complete synthetic shared-runner log for C.

## Live B1/B2 integration check (2026-10-17)

Real Nemotron completed 20-week single-agent and five-agent seasons against the
shared toy server. The shared synchronous single Policy also completed a season.
The audit and eight-season concurrency results are in
`results/b1-b2-live.json`; complete source logs, manifests and CSVs are preserved in
`results/b1-b2-live-logs.zip`. Extract that archive into `results/` to audit again:

```bash
uv run python -m fieldtwin_agents.validation results/local-live-protocol-v2 results/local-live-b2-eight-v2 --output results/rechecked-live.json
```

`fixtures/replay.nemotron-toy.single.jsonl` and
`fixtures/replay.nemotron-toy.multi.jsonl` are complete real-model replay samples
for C. They use the toy environment and provisional prices. The maintained task
checklist records exact fallback counts and the remaining work with A.
The concurrent batch completed all 160 weeks with 1,581 model calls and two visible
farmer fallbacks after HTTP connection disconnects. The GPU/container remained
healthy; the transport cause is unconfirmed. Three invalid responses were corrected
within the bounded loop. Both isolated corrected seasons had zero fallbacks. All
36 automated tests pass. These are completion/reliability checks, not a controlled
throughput or cost benchmark.

The first live runs exposed tool summaries returned instead of decisions/critiques.
Agent protocol 2 repeats the required format after tool results, retires completed
read tools, preserves invalid content for correction and reserves the sixth turn for
the final answer. Role system prompts and their existing freeze hashes are unchanged.
Run manifests record the protocol version and distinguish synthetic environments
from synthetic models. Paired prompt comparisons reject differing protocol versions.
This is an integration reliability correction, not a measured crop-quality gain.
