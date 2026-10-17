# FieldTwin / Person B session handoff

Handoff updated: **October 17, 2026** (America/New_York).
Branch: **person-B**. Continued from verified checkpoint **300cbe8**, with A2
already merged from **a866f06**. The implementation commit containing this update
adds the local protocol-3 foundation below. This document supersedes earlier
progress snapshots; cloud services were not contacted or deployed to this session.

## Start here in the next session

The **local decision pipeline and reproducible script are implemented**, with
the scope/limits in [LOCAL_MILESTONE.md](LOCAL_MILESTONE.md). Configurable thinking,
live role validation and full-season comparisons remain pending. The architecture
review's larger research proposals are not implemented by this milestone.
User-run transfer, pilot, full dev, audit and backup commands are in
[RUN_ON_BREV.md](RUN_ON_BREV.md); writing this guide did not launch remote jobs.
Read [NEXT_STEPS.md](NEXT_STEPS.md) before changing behavior.

1. Run/inspect the local script and protocol-3 facts, identities, exact final-action
   records and durable native-runner receipts. Do not equate numeric verification
   with semantic review or agronomic correctness.
2. Run fresh diagnostics and measure context/output headroom before seasons.
   Compare critic thinking off/on only after
   instrumentation and parser/output-budget checks; consider planner afterward.
3. Attest remote model/simulator versions and allocated cost before live work.
   Local code/data hashes do not attest the remote copied snapshot.
4. When seasons resume, compare a lean planner with staged multi-agent additions
   using identical evidence/checks and declared compute budgets. Reuse A's frozen
   dev baselines; selected farmer practice is farmer_ufga (1116.72 USD/ha).

No new real seasons, live inference, training or deployment followed integration. Full-season
experiments remain paused while the local foundation is prepared. Thinking stays
off; shared prompt default stays v1; v3/v4/v5 are not final selections. N uptake
reconciliation with A remains pending but does not block local foundation work.

### Latest: Brev deployment, live pilot and full dev run (in progress)

Full record: [results/runtime-p3-v1-dev.md](results/runtime-p3-v1-dev.md).
Runtime experiment only (protocol 3, v1 prompts, thinking off); no training,
no held-out years, no simulator/price/reward/cap change.

- [x] Verified person-B = origin/person-B at afffb23; A's a-env unchanged at a866f06.
- [x] Inspected Brev before acting: services healthy, exact model, 16384 context.
  A foreign SSH-tunnelled client was already running 9-11 vLLM requests (origin
  unidentified, user's Brev cert); latency telemetry is confounded by it.
- [x] Deployed afffb23 to fresh checkout `/ephemeral/fieldtwin/person-b-20261017T203747Z`
  (path also in `/ephemeral/fieldtwin/person-b-latest.txt`); 39 tests passed; served
  env code/tasks byte-identical; attestation recorded.
- [x] CLI smoke failed once (malformed `{"": "{}"}` args); diagnostic 9/10 valid.
- [x] Pilot UFGA-1990 audited: single 453.56, multi 749.68 vs farmer_ufga 1296.33.
  Records consistent, no fallbacks, headroom >= 6,890 tokens, one critic `length`
  truncation recovered by re-prompt. Budget-arithmetic and dry-soil errors persist.
- [ ] Full run `results/runtime-p3-v1-dev-20261017T205016Z` (PID 52681, started
  20:50:16Z, 40 seasons, concurrency 8): monitor, audit all seasons, compare with
  matched farmer_ufga dev rows (RUN_ON_BREV.md section 7), back up archive locally.
- [ ] Then a separate, labelled agent-fix experiment on the same dev years
  (budget statements, critic arithmetic, dry-soil irrigation, critic verbosity).

Read-only helper: `scripts/inspect_live_run.py RUN_DIR --weeks` (copy on Brev at
`/ephemeral/fieldtwin/tools/`, outside the checkout).

### Earlier: local protocol-3 implementation

- [x] Verify `person-B` at 300cbe8 against freshly fetched origin; no incoming B/A
  updates. Only user-owned fieldtwin.pdf and friction-log.txt were untracked at start.
- [x] Typed facts with raw evidence, units, provenance, uncertainty, episode/week,
  exact N arithmetic and labelled literal farmer comparison; no-tools/no-weather
  withholding and parallel specialist isolation preserved.
- [x] Frozen proposal/revision/coordinator and review IDs with parent/binding
  links. Runtime verifies the exact post-guard action before `/step`; audit checks
  hashes, episode/week, ordering and decision equality. Free-text reasons and
  final agronomic semantics are not certified; critic still reviews planner only.
- [x] Native batch per-season started/terminal receipts, successful and failed
  outcomes, offline catalogue/recovery inspection and local provenance. Per-call
  tokens/finish reasons/latency are captured when supplied; GPU cost remains null.
- [x] Reproducible user command: `uv run python scripts/run_local_milestone.py
  --output runs/local-milestone-001` (one line). Two synthetic weeks, ten short
  fixtures, one preserved injected post-step failure; no network/GPU/DSSAT.
- [x] Isolate parallel roles' malformed-response counters. Prompt-only comparison
  now rejects runtime/data/inference confounds; prompt files are unchanged.
- [ ] Fresh live diagnostics, context-size checks, thinking comparison, semantic
  review effectiveness, full dev comparisons and final freeze remain pending.

See results/local-milestone-summary.json and results/local-milestone-logs.zip for
all named synthetic runs and expected failures. Final local verification:
**60 passed, eight DSSAT skips**, existing Starlette/httpx warning; final wrapper
and offline rebuild pass. All three named runs total 30 successful two-week synthetic
fixtures and three expected failures. Archive CRC verified. Older architecture and experiment
sections below describe historical checkpoints. Shared synchronous Policy uses
facts/IDs/verification but still has its existing buffered logger; durable
receipts belong to native `run_batch`. No simulator-contract change was made;
N-uptake/end-reason coordination with A is still pending. Git push is not Brev
deployment. No remote service-health claim is made.

### Latest: A2 integration and thinking plan (same day)

Integrated A's origin/a-env at `a866f06` (two new commits). Read
[NEXT_STEPS.md](NEXT_STEPS.md) for the revised plan and thinking explanation.
A2 baseline outputs are frozen in results_baseline/. Selected farmer practice is
farmer_ufga: dev reward 1116.7175 versus original farmer 1024.0455. Multi v3 is
878.0415, now 21.37% below the selected reference. Hindsight selects among 56
candidates (including both farmers), not every possible adaptive policy.

Only dev baseline rows were analyzed. Original farmer matches all 20 archived dev
rows on eight outcome fields; details/hashes: results/a2-integration-dev.json.
Config/report conflicts preserve all B policies, A's selection, provenance labels
and UTF-8. Regression verification: 42 passed, eight DSSAT skips, existing warning.
Fallback remains original farmer. Incoming commits do not change simulator,
prices/reward/caps or resolve N uptake definitions. No new rollout, test evaluation
or deployment to the copied Brev snapshot occurred.

Thinking remains off (enable_thinking=False, max_tokens=2048); serving already has
nemotron_v3 extraction. Future diagnostics need separate versioning, bounded
reasoning/final-output headroom and token/finish-reason/latency records. Facts and
checks come first; do not blindly toggle every role or call this training.

### Later architecture research review (same day)

Read [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) for source-backed failure
modes, each component's rationale/retention test, and staged next experiments.
This was research/documentation only; new season experiments remain paused.
The five-role system is an experimental arm, not yet a justified optimum. Proposed
next foundation: typed code-computed facts, immutable proposal/review identities,
verification of the exact final action, durable season results, and a lean planner
comparison using the same evidence/checks/budget. Critic and coordinator must earn
their extra cost. Thinking mode is currently disabled; any comparison is a separate
inference-setting experiment, not training.

Correction to earlier maturity-only HLD: `env/server.py` ends control on DSSAT done
OR 20 weeks; `DssatSimulator.final()` then advances toward maturity with zero
inputs, bounded by 400 days. Read-only audit of all 80 archived seasons is saved
in results/architecture-horizon-audit.json: all 16 week-20 endings are at R6 before
day 140, supporting natural completion; final/weekly leaching and gas differ by at
most 0.03 kg/ha. No evidence here of changed reward rankings from the horizon.
N uptake final-versus-weekly differences reach 10.39 kg/ha (v1), 6.23 (v3): ask A
to reconcile final wtnup delta versus summed daily trnu definitions/timing. Uptake
is not a direct reward term. Preserve old results and investigate before any env
change. No automatic step retries; IDs alone do not solve external-process crashes.

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
accuracy or crop-performance evidence. At that checkpoint, 41 local tests passed;
after A2 integration, the latest total is 42 (eight DSSAT skips).

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

System flow and HLD: [ARCHITECTURE.md](ARCHITECTURE.md) distinguishes implemented
message routing, model/cache sharing and the proposed verified-facts/final-check layer.

1. This file and [TASKS_PERSON_B.md](TASKS_PERSON_B.md): current state and next work.
2. [README.md](README.md): A's real environment, task years, prices and contracts.
3. [PERSON_B.md](PERSON_B.md): B architecture, serving and experiment commands.
4. [Historical experiment status](results/status-person-b.json): completed-season
   checkpoint, not the latest integration/plan. Read NEXT_STEPS.md and
   [A2 dev comparison](results/a2-integration-dev.json) for the current reference.
5. [Paired iteration record](results/b3-iterations.md) and the two archived runs.

Some older passages in PERSON_B.md describe the experiment as in progress. The
completed checkpoint here and TASKS_PERSON_B.md supersedes those passages.
SKELETON_SPEC.md also contains the original seed-based contract; README.md describes
the current real-year contract.

## Current state: both experiments completed

**No experiment is currently queued/running.** The background continuation job
finished with `phase: candidate_complete_selection_pending` at 3:19:40 PM New York.
The GPU model server and DSSAT HTTP server were last left running; recheck health
before using them. No remote process/health check was made for this handoff edit.

- B0: real H100/vLLM deployment and parsed tool-call smoke complete.
- B1/B2: single, five-agent loop, one critic revision, guards, visible fallback,
  logging and eight concurrent seasons implemented and verified.
- A integration: gym-DSSAT, NASA POWER real weather, real-year dev tasks, fixed
  prices/reward, and NeMo Gym wrapper are merged. A2 is now complete and merged:
  frozen baselines, farmer_ufga selection and 56-candidate hindsight.
- Baseline `v1`: single + multi, 20 dev years each; all 40 seasons audited.
- Candidate `v3`: same 40 task/config pairs; all 40 seasons audited and compared.
- B3: a diagnosed one-role prompt change produced positive mean dev reward deltas.
  This has not yet delivered farmer-level efficiency or held-out evidence.
- B4: final selection/freeze and real-model ablation validation remain pending.
- **The shared default remains `v1`**, with its provisional freeze manifest.
  Do not assume v3 was promoted or selected as final.

Useful commits before this handoff:

- `ce84ffe`: latest A2 merge, report/config compatibility, dev baseline comparison,
  regression test and revised next steps/thinking plan.
- `7a3569d`: research-backed architecture review and read-only 80-season audit.
- `d7c5cad`: critic candidates and recorded live role diagnostics.
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
| Original farmer rule | 1024.05 | 7214.37 | 160.00 | 16.34 | 111.25 | 0 | 0 |
| Selected farmer practice: farmer_ufga | 1116.72 | 7814.90 | 116.00 | 20.43 | 264.00 | 0 | 0 |
| Single v1 | 343.00 | 4804.81 | 296.75 | 26.91 | 46.13 | 1065 | 0 |
| Multi v1 | 600.88 | 6298.88 | 298.00 | 26.86 | 96.60 | 3625 | 0 |
| Single v3 | 593.24 | 7593.61 | 249.95 | 81.82 | 456.25 | 746 | 1 |
| Multi v3 | 878.04 | 9272.05 | 300.00 | 74.99 | 407.95 | 3551 | 0 |

Paired v3-minus-v1 mean reward: **+250.234 single (+73%)**, **+277.158 multi (+46%)**.
Single improved in 13/20 years, multi in 14/20. These are one stochastic rollout
per policy/year/version; they do not isolate model sampling variation. There is
no independent held-out result and no inference-cost-saving claim.

Multi v3 is **21.37% below selected farmer practice** (238.68 USD/ha lower),
using about 2.59 times the nitrogen, 3.67 times the nitrate leaching and 1.55 times
the irrigation. The earlier 14% reward gap refers to original farmer only. Higher
yield alone is not sufficient to call it a successful crop advisor. Current
fallback is still original farmer; benchmark selection did not change recovery.

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
   an application target. Original farmer uses 160 kg; selected farmer_ufga uses
   116 kg, both with better net reward.

Worst v3 single years: UFGA-2004 (-325.08), UFGA-1991 (-265.34), UFGA-2008 (-64.69).
Worst v3 multi: UFGA-2005 (-24.24), UFGA-1998 (120.39), UFGA-2009 (240.37).
The next session should inspect their full role/tool traces, not only finals.

## Prioritized pending work

1. Implement the local facts/final-check foundation described at the top, informed
   by full v3 worst-case traces. Prefer general evidence handling over increasingly
   specific prompt patches. Preserve completed experiment directories.
2. Add durable season results, catalogue/user-run wrapper and inference telemetry.
   Review shared parallel malformed-response counters. Record all failures and
   negative changes; a code/context/guard change is not a prompt-only iteration.
3. Reconcile final-versus-weekly N uptake definitions/timing with A. Keep simulator,
   prices, reward and caps fixed during comparisons; separately version any fix.
4. Verify fresh valid/invalid diagnostic cases, then test critic thinking off/on
   with the same evidence/prompts and predeclared budgets. Track false objections
   as well as missed errors, final JSON validity, tokens, latency and finish reasons.
   Check tool/parser compatibility and reserve final-output headroom. Thinking
   remains disabled until a version is deliberately selected from evidence.
5. Resume full dev seasons only after focused checks. Compare the lean baseline
   and staged role additions, including the registered ablations, on matched
   tasks/evidence/checks/budgets. Reuse frozen farmer_ufga rows by task ID; retain
   original farmer for context. Address nitrogen efficiency in a separate diagnosed
   change. Include reward, yield, N, water, leaching, cost and visible fallbacks.
6. Choose code/facts/prompts/inference settings from complete evidence, freeze
   together, and update config.yaml prompt_version/freeze_manifest consistently.
   Hand A/C reproducible configs, CSVs and representative DSSAT replays.
7. A2 is completed. A owns A4's held-out evaluation after B freezes. B uses only
   UFGA dev years 1990-2009 and must not run/tune agents on 2010-2024.

Fine-tuning/RL discussion: role names currently share one model and different
prompts; weights never update during evaluation. First establish reliable behavior
and baseline value. If training is later requested, use validated demonstrations
and a separate validation plan; preserve A's held-out years. Do not start expensive
training simply because the user asked a conceptual question about it.

## Artifacts available after cloning

- `NEXT_STEPS.md`: current staged plan and thinking-mode experiment design.
- `ARCHITECTURE.md`, `ARCHITECTURE_REVIEW.md`: implemented/proposed flow and
  researched component rationale, failure modes and retention checks.
- `results_baseline/`: A2's immutable farmer/farmer_ufga/no_n/hindsight outputs.
  B's comparisons use dev rows only; do not regenerate these baselines.
- `results/a2-integration-dev.json`: selected reference, archive compatibility,
  dev comparison and source hash.
- `results/architecture-horizon-audit.json`: all 80 archived seasons, horizon and
  final/weekly accounting review, including unresolved N uptake discrepancy.
- `results/critic-review-summary.json`, `results/critic-review-logs.zip`: all 60
  focused reviews, including failed critic candidates; no candidate promoted.
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
- GPU and HTTP services were last left running; if still active, the quoted
  compute charge continues. Recheck health/state before resuming and back up new
  outputs before eventual instance deletion.

## Code map and contracts worth preserving

- `agents/policies/nemotron.py`: synchronous shared Policy adapter and call counts.
- `fieldtwin_agents/agents.py`: role orchestration; local protocol **3** (archived
  real runs used **2**); supported prompt
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

Historical merge verification at ce84ffe: **42 tests passed**, eight DSSAT tests
skipped on Windows, existing TestClient deprecation warning. This includes a merge
regression checking selected farmer-reference arithmetic and provenance together.
No new model/DSSAT rollout was needed for integration. Earlier remote verification:
all 15 environment contract tests passed on Brev including real DSSAT, using a
dev year. Shared toy HTTP smoke passed all eight configs x three dev years (24
rows). Candidate version support also passed 40 synthetic CLI seasons. Subsequent
local checks cover the critic follow-up and A2 integration above; neither update
was deployed to the cloud snapshot.

The prior toy parallel check had two model connection-disconnect fallbacks. Their
root cause was not proven. The colocated real runs observed no HTTP fallbacks;
the only v3 fallback was a visible malformed-response fallback in single.
