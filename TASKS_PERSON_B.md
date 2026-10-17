# Person B handoff

Branch: `person-B` (the user requested this name). Scope: FieldTwin PDF pp. 2, 4-5.
Last updated: 2026-10-17. This checklist distinguishes local implementation from measured remote milestones.

## Done

- [x] Create the branch and inspect the PDF and empty repository.
- [x] Confirm Nemotron BF16 checkpoint, vLLM 0.27.1 and tool parser against NVIDIA's model card.
- [x] Define Python package, HTTP environment/model clients and strict JSONL event contract.

## Local implementation done

- [x] B0: Pinned GPU launch recipe and successful live Nemotron tool-call smoke test on the Brev H100.
- [x] B1: Single-agent season, bounded tool execution, log validation.
- [x] B2: Five-agent loop, one critic revision, action guards, visible fallback, eight parallel seasons.
- [x] B3: Dev-only runner, worst-three diagnostics and paired iteration recording (real gain pending below).
- [x] B4: Versioned prompts, provisional freeze manifest with drift checks, and three ablations.
- [x] Synthetic stub environment/model and 12 automated checks.
- [x] 20 synthetic seasons per config for all five configs, on both prompt versions (200 total); explicitly zero synthetic gain.
- [x] Full synthetic replay log for C, exact CSV columns for A, and integration/run documentation.
- [x] Editable package installs successfully; Python compilation checks pass.

## Final local verification

- [x] Complete the HTTP stub/CLI round-trip smoke check: 40 full synthetic seasons passed with eight parallel seasons and prompt drift verification.
- [x] Commit only Person B's implementation, fixtures and handoff files so the branch can be merged later.

## Pending external dependencies / real milestones

- [x] Obtain Brev H100 80 GB access, launch the BF16 checkpoint, and record a successful real tool smoke test (B0): results/b0-host.json and results/b0-smoke.json.
- [x] Pull the shared port-9000 toy server, 20-dev task manifest, 300 kg/ha season cap and farmer schedule from main.
- [x] Integrate Person A's gym-DSSAT simulator, real weather years and fixed prices from origin/a-env (64b38f9).
- [ ] Run single and multi on the real simulator and validate its observation/tool payloads (B1/B2).
- [ ] Evaluate both on all 20 dev seasons with Nemotron; inspect worst three logs, change one thing, rerun and record actual gain (B3).
- [ ] Freeze chosen prompt hashes after real dev evidence (B4); give A the config names and inference entry point.
- [ ] A alone runs held-out test once. B must never run or tune on test.
- [x] Fetch and integrate origin/main's walking skeleton (`79b4306`) into person-B at the user's request.
- [ ] Merge person-B back into main with the team later; do not push as part of this local task.

## Walking skeleton integration

- [x] Resolve README, package metadata and ignore rules, retaining main's uv workflow and lock file.
- [x] Register single, multi and all three ablations under agents/policies; use agents/tools.json.
- [x] Honor config.yaml caps, shared farmer fallback, VLLM_BASE_URL and VLLM_MODEL.
- [x] Support submit_decision tool calls and preserve tool permissions and the ablations.
- [x] Emit skeleton-compatible replay events and accurate llm_calls/fallback stats.
- [x] Verify every policy against the shared toy HTTP server, evaluator and runs/index.json without a live GPU: all eight configs on three dev tasks, 24 output rows.
- [x] Pass all 30 combined tests and 200 isolated synthetic seasons across five configs/two prompt versions.
- [x] Fix Windows UTF-8 summary output found by the HTTP smoke check; refresh C's synthetic replay fixture.
- [x] Update README/PERSON_B.md, save results/person-b-integration.json and commit the merge and integration.

B0 is verified on a live GPU. Crop-performance and remaining milestones are still pending;
synthetic runs support only software verification.

## B0 deployment session

- [x] Inspect local access: SSH is installed; alias `dev` exists. No Brev CLI, Docker, NVIDIA runtime or VLLM endpoint is configured locally.
- [x] Prepare a read-only GPU/Docker/disk/port preflight and a smoke command that checks model discovery and saves successful verification evidence.
- [x] Pass 32 automated tests, including successful smoke evidence capture and rejection of a mismatched served model before inference. These are mocked checks, not live B0 verification.
- [x] Select one Hyperstack H100 80 GB instance with 180 GB system RAM and included 850 GB SSD at the screenshot's quoted $3/hour; no stop/start support.
- [x] Receive the instance name and connection instructions: `fieldtwin-b0`, accessed through the Brev CLI. The existing `dev` SSH alias is not the selected target.
- [x] Confirm local Ubuntu WSL 2 is installed and install the official Brev CLI (v0.6.337) under `/home/anand/.local/bin/brev`.
- [x] Validate Bash syntax of both host-preflight and serving scripts using WSL.
- [x] Complete Brev account login and refresh SSH configuration. Private keys/tokens stay outside the repository and chat.
- [x] Connect to `fieldtwin-b0`: verify idle H100 PCIe (81,559 MiB), Docker 29.1.3, NVIDIA driver 570.195.03, free port 8000 and the large `/ephemeral` disk.
- [x] Select official vLLM v0.27.1 CUDA 12.9 image with documented compatibility mode for the host driver; place model/compile caches on `/ephemeral`.
- [x] Pull the official serving image and download the public BF16 model weights; snapshot a9904d24bcc1d289a1950fa9d2b978c47cf903b9.
- [x] Run host preflight, launch vLLM with the pinned serving flags, and establish a dedicated local SSH tunnel at http://127.0.0.1:8000/v1.
- [x] Verify live health HTTP 200, advertised model identity, prefix caching enabled, automatic tool calling enabled, max_num_seqs=64, and a real parsed get_weather({}) call.
- [x] Save results/b0-host.json and results/b0-smoke.json. B0 completed 2026-10-17 at approximately 2:26 PM America/New_York.

The cloud instance/container remains running for subsequent dev work. The selected
provider has no stop/start; the quoted compute rate is $3/hour. Preserve code and
results before eventually deleting the instance. No GPU cost saving or crop-quality
claim has been measured yet.

## B1/B2 live-model validation on the shared toy server

- [x] Verify the existing vLLM endpoint and start the local shared toy server on port 9000.
- [x] Complete and audit a single-agent 20-week dev season with real Nemotron: 40 model calls, zero fallbacks after the protocol correction.
- [x] Verify the shared synchronous Policy/runner integration with real Nemotron: 61 model calls, zero fallbacks over 20 weeks.
- [x] Complete and audit a five-agent 20-week dev season: 201 calls, zero fallbacks, 13 critic objections and 13 completed planner revisions.
- [x] Complete eight concurrent dev seasons (UFGA-s1 through UFGA-s8): all 160 weeks audited; peak overlap eight, 1,581 model calls, two visible HTTP connection fallbacks and three recovered validation errors.
- [x] Fix observed prose tool summaries/exhausted tool loops with agent protocol 2; preserve invalid content for correction. Verify the action guard and pass all 36 tests, including protocol-comparison rejection.
- [x] Save results/b1-b2-live.json and results/b1-b2-live-logs.zip (13 complete season records including initial diagnostic runs and shared Policy verification), plus two complete real-model replay fixtures for C.
- [x] Verify every audited action stays within weekly/season caps without server clamping; confirm role tool permissions, one planner revision maximum, final CSV/log agreement and replay index entries.
- [ ] Investigate intermittent inference connection disconnects before controlled performance benchmarking: two of 160 batch decisions used the farmer fallback. The GPU/container stayed healthy and all seasons completed; the underlying transport cause is unconfirmed.

These checks use real Nemotron inference but a synthetic crop environment. They do
not establish real crop performance or complete B3's real-simulator improvement requirement.

A's simulator and prices are now available from a-env. Verify its real tool payloads
with single/multi, run all 20 dev tasks, inspect
the worst three, make one diagnosed prompt change, rerun, and freeze the chosen
prompts. A owns the held-out test. Keep person-B local for the team's later merge.

## A environment integration and real dev evaluation

- [x] Fetch origin/a-env at 64b38f9; inspect A's DSSAT, NASA weather, fixed prices and NeMo Gym implementation.
- [x] Resolve README/ignore conflicts while retaining B policies and A's simulator/prices.
- [x] Adapt B's Task loader to real years and its auditor to terminal maturity rather than exactly 20 weeks; preserve legacy fixtures.
- [x] Install gym-DSSAT on the existing Brev host (Ubuntu 22.04); keep vLLM running.
- [x] Pass merged checks: 40 local tests, eight local DSSAT skips; all 15 environment contract tests pass on Brev including DSSAT. Shared toy HTTP smoke verifies all eight configs on three dev years (24 rows).
- [x] Commit the merge into person-B; do not push or change main/a-env.
- [ ] Complete real-model, DSSAT single/multi evaluation on all 20 dev seasons and inspect the worst three logs.
- [ ] Make one diagnosed role-prompt change, rerun the paired dev experiment, record measured results including negative changes.
- [ ] Select/freeze prompts from that evidence, verify ablations and give A/C reproducible handoff artifacts.
- [ ] A runs held-out test once; B does not execute test seasons.

Current run checkpoint (2026-10-17): all 20 single/v1 DSSAT dev seasons have
terminal logs; multi/v1 is running. Baseline output is on `fieldtwin-b0` under
`/ephemeral/fieldtwin/app-a-env/results/dssat-dev-v1`. The baseline command audits
and analyzes all 40 seasons when finished. A durable background job then runs the
40-season v3 candidate, audits it, and records paired deltas. Its progress is
`results/b3-progress.json` on that host, with log
`/ephemeral/fieldtwin/b3-candidate.log`. Do not relaunch into existing directories.

- [x] Inspect the completed single baseline's worst three logs: UFGA-2001, UFGA-2000, UFGA-2003. Identify missed dry-week irrigation and false water-budget restrictions.
- [x] Prepare v3 with only coordinator.txt changed; keep v1 and the earlier unvalidated v2 critic variant unchanged. Verify a candidate freeze and 40 synthetic CLI seasons.
- [ ] Review baseline multi's worst three complete logs and the queued v3 paired results. The candidate is not yet selected or frozen for final use.

The exact hypothesis and resume locations are recorded in
`results/dssat-dev-experiment-plan.json`. Model/simulator execution is colocated
on Brev; no HTTP disconnect fallback has been observed in the baseline so far.
This does not establish the cause of the earlier tunnel-path disconnects.

## Status snapshot: 2026-10-17, 3:00 PM America/New_York

- [x] Verify current remote progress: single/v1 20 of 20 complete; multi/v1 15 of 20 complete (all 20 started). No fallback events observed across 680 completed weekly steps so far.
- [x] Save a matched 15-year comparison in results/status-person-b.json: mean simulated reward single 344.82, multi 688.88, farmer 1088.18 USD/ha. Mean N single 295.67, multi 297.33, farmer 160.00 kg/ha.
- [ ] Finish/audit baseline, then automatically run/audit the queued 40-season v3 comparison. The candidate job is still waiting for baseline audit; no v3 quality result exists yet.
- [ ] Review whether v3 repairs dry-week irrigation without increasing harmful/costly inputs. Compare against farmer, single, nitrate leaching and model-call cost.
- [ ] If results still trail farmer, diagnose nitrogen overspending (the 300 kg cap is an upper bound) and test a separate targeted prompt change before final selection/freeze.

Assessment: multi's provisional matched reward is about twice single's, but about
37% below farmer's and uses about 86% more nitrogen. Reliability is encouraging;
current dev policy quality does not yet justify a performance or cost-saving claim.
The multi comparison is incomplete, uses one stochastic rollout per dev year and
does not establish that the team architecture causes the observed difference.
