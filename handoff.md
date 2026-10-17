# FieldTwin / Person B session handoff

Last checked: **October 17, 2026, 3:20 PM America/New_York**.
This is the current checkpoint; earlier chat status messages and intermediate
snapshots described runs that have since finished.

### Later critic follow-up (same day)

The user paused new season experiments to discuss proper agent information and
recording, then explicitly requested an independent, effective critic. New v4/v5
prompt candidates change only critic.txt relative to v3; existing measured prompts
and the shared v1 default remain unchanged. No new DSSAT season or training ran.

`scripts/check_critic.py` ran ten constructed synthetic proposal cases twice per
version with live Nemotron. Existing v3: reject bad 12/14, accept valid 1/6;
v4: 14/14 and 0/6; v5: 14/14 and 2/6. v4 was an overly rejecting failure; v5 is
still unreliable and unpromoted. See `results/critic-review-summary.json`,
`results/critic-review-logs.zip`, and the diagnostic entry in `results/iterations.md`.
These development cases were inspected during revision; they are not independent
accuracy or crop-performance evidence. All 41 local tests pass (eight DSSAT skips).

Important flow limitation: the critic reviews the planner before the coordinator,
so it cannot catch a new mistake introduced in the coordinator's final action.
The next architecture discussion should address verified facts, false objections
and final-decision checks. Do not solve this by making the critic reject more:
the completed v3 multi run already had 240 objections in 377 weeks.

## User request and working agreement

- Work on **`person-B`** (case matters) in `https://github.com/darshrank/FieldTwin`.
  GitHub reports that the former `darshrank/NightShift` URL has moved here; the
  local Windows workspace is still named NightShift.
- Implement Person B's FieldTwin tasks; maintain a clear done/pending checklist.
- A's `a-env` branch was merged into this branch. Continue from the merged code.
- The user explicitly authorized pushing `person-B` and requested this handoff.
  Earlier notes saying not to push are superseded. Merging back into `main` is
  still for the team later.
- No held-out evaluation by B. A owns the final test run.
- The user discussed supervised fine-tuning and RL, but no training was started
  or agreed as the next implementation step. Current agents use prompting only.
- Local untracked `fieldtwin.pdf` and `friction-log.txt` are user files; leave them
  untouched and do not accidentally stage them. The PDF is not in the pushed repo.

## First things to read

1. This file and [TASKS_PERSON_B.md](TASKS_PERSON_B.md): current state and next work.
2. [README.md](README.md): A's real environment, task years, prices and contracts.
3. [PERSON_B.md](PERSON_B.md): B architecture, serving and experiment commands.
4. [Latest machine-readable status](results/status-person-b.json).
5. [Paired iteration record](results/b3-iterations.md) and the two archived runs.

Some older passages in PERSON_B.md describe the experiment as in progress. The
completed checkpoint here and TASKS_PERSON_B.md supersedes those passages.
SKELETON_SPEC.md also contains the original seed-based contract; README.md describes
the current real-year contract.

## Current state: both experiments completed

**No experiment is currently queued/running.** The background continuation job
finished with `phase: candidate_complete_selection_pending` at 3:19:40 PM New York.
The GPU model server and DSSAT HTTP server remain running.

- B0: real H100/vLLM deployment and parsed tool-call smoke complete.
- B1/B2: single, five-agent loop, one critic revision, guards, visible fallback,
  logging and eight concurrent seasons implemented and verified.
- A integration: gym-DSSAT, NASA POWER real weather, real-year dev tasks, fixed
  prices/reward, and NeMo Gym wrapper are merged.
- Baseline `v1`: single + multi, 20 dev years each; all 40 seasons audited.
- Candidate `v3`: same 40 task/config pairs; all 40 seasons audited and compared.
- B3: a diagnosed one-role prompt change produced positive mean dev reward deltas.
  This has not yet delivered farmer-level efficiency or held-out evidence.
- B4: final selection/freeze and real-model ablation validation remain pending.
- **The shared default remains `v1`**, with its provisional freeze manifest.
  Do not assume v3 was promoted or selected as final.

Useful commits before this handoff:

- `912847c`: live-model B1/B2 toy verification and protocol reliability fix.
- `cd7bea5`: merge of B and A (`64b38f9` from `origin/a-env`).
- `4151bf6`: v3 candidate and automatic paired experiment script.
- `7b79046`: baseline archive and interim candidate outcomes.

## Actual results and interpretation

Every row below uses **the same 20 dev years, UFGA 1990-2009**, the same DSSAT
environment, fixed prices/reward, and original action limits. Reward is simulated
profit minus the nitrate-leaching penalty; it is not measured farm profit.

| Policy | Mean reward, USD/ha | Grain, kg/ha | N applied, kg/ha | N leached, kg/ha | Irrigation, mm | Model calls, all 20 seasons | Fallbacks |
|---|---:|---:|---:|---:|---:|---:|---:|
| Farmer rule | 1024.05 | 7214.37 | 160.00 | 16.34 | 111.25 | 0 | 0 |
| Single v1 | 343.00 | 4804.81 | 296.75 | 26.91 | 46.13 | 1065 | 0 |
| Multi v1 | 600.88 | 6298.88 | 298.00 | 26.86 | 96.60 | 3625 | 0 |
| Single v3 | 593.24 | 7593.61 | 249.95 | 81.82 | 456.25 | 746 | 1 |
| Multi v3 | 878.04 | 9272.05 | 300.00 | 74.99 | 407.95 | 3551 | 0 |

Paired v3-minus-v1 mean reward: **+250.234 single (+73%)**, **+277.158 multi (+46%)**.
Single improved in 13/20 years, multi in 14/20. These are one stochastic rollout
per policy/year/version; they do not isolate model sampling variation. There is
no independent held-out result and no inference-cost-saving claim.

Multi v3 is still about 14% below farmer reward, with 87.5% more nitrogen,
approximately 4.6 times the nitrate leaching and 3.7 times the irrigation. Higher
yield alone is not sufficient to call it a successful crop advisor.

### Diagnosed failures

1. **v1 misses necessary irrigation.** Reasons sometimes treat exhausted nitrogen
   as a ban on watering, or call low moisture adequate. Worst single years:
   UFGA-2001, UFGA-2000, UFGA-2003. Worst multi: UFGA-1998, UFGA-2000, UFGA-1990.
   Those three multi runs all applied 300 kg N and omitted irrigation in five,
   two and two dry-soil weeks respectively.
2. **v3 often reverses the watering condition.** It is the v1 prompt set with only
   `coordinator.txt` changed: explain that N exhaustion does not prohibit water,
   and use farmer's 25 mm watering rule when soil_water_frac < 0.35.
   Yet multi UFGA-1990 week 0 sees moisture 0.93 and applies 25 mm, explicitly
   saying that being ABOVE 0.35 triggers watering. This is a concrete reasoning
   error in the logged output, not evidence that RL has failed.
3. In v3, positive irrigation occurred at moisture >= 0.35 in 335/377 single
   decisions and 282/377 multi decisions. These counts flag a pattern; they do
   not establish that every such action was agronomically wrong.
4. Nitrogen spending remains excessive. The 300 kg season cap is a ceiling, not
   an application target. Farmer uses 160 kg with better net reward.

Worst v3 single years: UFGA-2004 (-325.08), UFGA-1991 (-265.34), UFGA-2008 (-64.69).
Worst v3 multi: UFGA-2005 (-24.24), UFGA-1998 (120.39), UFGA-2009 (240.37).
The next session should inspect their full role/tool traces, not only finals.

## Prioritized pending work

1. Review the completed v3 worst-three traces and the exact irrigation comparison
   errors. Preserve these completed experiments; do not rerun into their folders.
2. Design one targeted next experiment. Options to assess include explicit
   wet/dry examples in the coordinator prompt, or a computed eligibility fact from
   code. A runtime/guard change must be labelled separately from a prompt-only
   change and use a new protocol version if behavior changes. Do not claim a
   one-prompt experiment while also changing code, caps, prices or reward.
3. Address nitrogen efficiency in a separate diagnosed experiment if needed.
   Keep A's prices, reward and management caps fixed.
4. Evaluate complete paired dev sets; report reward, yield, water, N, leaching,
   model-call counts and visible fallbacks. Do not compare different partial sets.
5. Choose prompts from evidence, create the final freeze manifest, and update
   `config.yaml` prompt_version and freeze_manifest together. Current v1/v3
   manifests are provisional/candidate snapshots, not a final selection.
6. Verify `multi_no_critic`, `multi_no_weather`, `multi_no_tools` with the chosen
   real-model setup. They are registered and software-tested; DSSAT/live-model
   ablation evaluation has not been performed yet. Give A/C config names,
   reproducible entry points, CSVs and representative DSSAT replays.
7. A owns A2's broader baseline work and A4's held-out test. B ran the farmer on
   dev only to make the current comparisons. Do not execute test seasons.

Fine-tuning/RL discussion: role names currently share one model and different
prompts; weights never update during evaluation. First establish reliable behavior
and baseline value. If training is later requested, use validated demonstrations
and a separate validation plan; preserve A's held-out years. Do not start expensive
training simply because the user asked a conceptual question about it.

## Artifacts available after cloning

- `results/dssat-dev-v1-logs.zip`: all baseline logs, manifest, eval.csv, audit,
  diagnostics; also `dssat-farmer-dev.csv`.
- `results/dssat-dev-v3-logs.zip`: all candidate logs, manifest, eval.csv, audit,
  diagnostics; also `b3-iterations.md`.
- `results/b3-iterations.md`: completed paired prompt comparison.
- `results/status-person-b.json`: complete means, counters and phase at handoff.
- `results/dssat-dev-experiment-plan.json`: hypothesis, source commits and links to
  the completed evidence; final prompt selection remains pending.
- `results/b0-{host,smoke}.json`: deployed host/model and actual parsed tool smoke.
- `results/b1-b2-live.json`, `results/b1-b2-live-logs.zip`: earlier **toy-environment**
  reliability verification with real Nemotron; do not mix these with DSSAT results.
- `fixtures/replay.nemotron-toy.{single,multi}.jsonl`: real-model/toy replay samples.

Run directories and ordinary `runs/` outputs are gitignored. Local root `runs/`
can contain old toy/stub checks, so use experiment manifests and archives as the
authoritative evidence. No live web progress dashboard was deployed.

To inspect/audit on a fresh clone (choose a fresh extraction/output folder):

```bash
uv sync --frozen
python -m zipfile -e results/dssat-dev-v1-logs.zip tmp/handoff-review
python -m zipfile -e results/dssat-dev-v3-logs.zip tmp/handoff-review
uv run python -m fieldtwin_agents.validation tmp/handoff-review/dssat-dev-v1 tmp/handoff-review/dssat-dev-v3 --output tmp/handoff-review/rechecked.json
```

Archive CRCs were verified locally and both embedded audits contain 40 seasons.
Each experiment has 377 weekly decisions per policy (754 total); DSSAT matures
in 18-20 weeks here. Never require exactly 20 decisions for every season.

## Live Brev environment and exact resume commands

Local workspace: `C:\Users\anand\Development\NightShift`, PowerShell.
Ubuntu WSL2 is installed. Official Brev CLI is installed at
`/home/anand/.local/bin/brev`, already authenticated. SSH alias: `fieldtwin-b0`.
Credentials/private keys stay outside git and chat; use existing authentication.

From a WSL terminal:

```bash
brev shell fieldtwin-b0
cd /ephemeral/fieldtwin/app-a-env
cat results/b3-progress.json
cat results/b3-iterations.md
tail -n 40 /ephemeral/fieldtwin/b3-candidate.log
curl -fsS http://127.0.0.1:9001/health
curl -fsS http://127.0.0.1:8000/health
```

Expected phase: `candidate_complete_selection_pending`. Do not relaunch the
continuation script unless intentionally starting a new experiment with new paths.
`scripts/run_b3_candidate.sh` used a nohup job; its PID file is
`/ephemeral/fieldtwin/b3-candidate.pid`. It should have exited after completion.

For automated commands from Windows, a reliable quoting pattern is:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'ssh -T -o BatchMode=yes -o ConnectTimeout=20 fieldtwin-b0 bash -s < /mnt/c/Users/anand/Development/NightShift/tmp/your-script.sh'
```

Create that local Bash script with LF newlines. Avoid nested PowerShell/Bash
quoting or text-mode subprocess input that silently introduces CRLF.

Host facts:

- Hyperstack H100 PCIe 80 GB, 180 GB system RAM; quoted $3/hour, no stop/start.
- App path above is **a copied source snapshot, not a git checkout**. Pushing this
  branch does not deploy changes there. Transfer reviewed files deliberately.
- Official container `fieldtwin-vllm`, image `vllm/vllm-openai:v0.27.1-cu129`;
  CUDA compatibility enabled for host driver 570.195.03. Do not restart casually.
- Model: `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`, BF16, context 16384,
  prefix cache, automatic tool calling with qwen3_coder parser. All roles share it.
- Model URL on host: `http://127.0.0.1:8000/v1` (localhost only).
- DSSAT URL on host: `http://127.0.0.1:9001`; health must report simulator `dssat`.
- DSSAT log/PID: `/ephemeral/fieldtwin/dssat-server.{log,pid}`.
- Remote app Python: `.venv/bin/python` (3.12). gym-DSSAT has its own Python 3.10
  at `/opt/gym_dssat_pdi/bin/python`, installed via A's installer.
- Model/cache data: `/ephemeral/fieldtwin/{huggingface,vllm-cache}`. The root disk
  is much smaller than `/ephemeral`; keep weights/data on the latter.
- Local port 9000 may still serve an older toy process. Do not use it for real
  evaluation without checking health/config. Run experiments on Brev to avoid
  tunnel variability; local URLs require deliberate SSH forwarding.
- GPU and HTTP services remain running and incurring the quoted compute charge.
  Back up any new outputs before eventual instance deletion.

## Code map and contracts worth preserving

- `agents/policies/nemotron.py`: synchronous shared Policy adapter and call counts.
- `fieldtwin_agents/agents.py`: role orchestration; protocol **2**; supported prompt
  versions v1/v2/v3 plus unpromoted critic candidates v4/v5; strict outputs,
  permissions, six-turn bound, one revision.
- `fieldtwin_agents/clients.py`: vLLM and env HTTP. Never retry `/step` automatically.
- `fieldtwin_agents/contracts.py`: year-based Task with legacy seed compatibility,
  action/JSONL/CSV contracts; dev-only loader rejects test/unlabelled tasks.
- `fieldtwin_agents/runner.py`: exclusive output directories, native async eight
  seasons, provenance, separate synthetic-model/environment flags and terminal logs.
- `fieldtwin_agents/{validation,evaluation}.py`: full-run audits, worst-three
  diagnostics and paired comparison. Comparison requires same management/model/task
  definitions/protocol and exactly one changed role prompt.
- `fieldtwin_agents/prompts/v1`: baseline; `v2`: earlier unvalidated critic rain
  hypothesis (not this experiment); `v3`: coordinator-only watering change.
- `agents/tools.json`: authoritative five read schemas plus submit_decision.
  Submitting a decision does not itself step the environment.
- `env/dssat_sim.py`, `dssat_worker.py`: A's real simulator bridge. Keep its worker
  PYTHONPATH isolation; embedded Python can otherwise load incompatible numpy.
- `gym_env/`: A's NeMo Gym adapter. Using Gym for evaluation is not RL training.

Current limits: N 120 kg/ha/week, irrigation 50 mm/week, N 300 kg/ha/season.
Farmer/fallback: N 60/60/40 at weeks 0/5/9; 25 mm if soil moisture <0.35.
Current tasks: dev UFGA 1990-2009 (20); held-out 2010-2024 (15), A only.

Last verification: 40 local tests passed, eight DSSAT tests skipped on Windows;
all 15 environment contract tests passed on Brev including real DSSAT, using a
dev year. Shared toy HTTP smoke passed all eight configs x three dev years (24
rows). Candidate version support also passed 40 synthetic CLI seasons. Existing
Starlette/httpx TestClient deprecation warning remains. No implementation changes
were made after these except handoff/status/artifact documentation.

The prior toy parallel check had two model connection-disconnect fallbacks. Their
root cause was not proven. The colocated real runs observed no HTTP fallbacks;
the only v3 fallback was a visible malformed-response fallback in single.
