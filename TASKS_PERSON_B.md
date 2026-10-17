# Person B handoff

Branch: `person-B` (the user requested this name). Scope: FieldTwin PDF pp. 2, 4-5.
Last updated: 2026-10-17. This checklist distinguishes local implementation from measured remote milestones.

## Done

- [x] Create the branch and inspect the PDF and empty repository.
- [x] Confirm Nemotron BF16 checkpoint, vLLM 0.27.1 and tool parser against NVIDIA's model card.
- [x] Define Python package, HTTP environment/model clients and strict JSONL event contract.

## Local implementation done

- [x] B0: Pinned GPU launch recipe and runnable live tool-call smoke-test command (actual GPU test pending below).
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

- [ ] Obtain Brev H100/A100 80 GB access and launch the BF16 checkpoint; record successful tool smoke test (B0).
- [x] Pull the shared port-9000 toy server, 20-dev task manifest, 300 kg/ha season cap and farmer schedule from main.
- [ ] Replace the toy simulator with Person A's validated crop simulator before claiming crop-performance results.
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

No crop-performance, live-GPU, or bounty milestone is complete based on a synthetic run.

## B0 deployment session

- [x] Inspect local access: SSH is installed; alias `dev` exists. No Brev CLI, Docker, NVIDIA runtime or VLLM endpoint is configured locally.
- [x] Prepare a read-only GPU/Docker/disk/port preflight and a smoke command that checks model discovery and saves successful verification evidence.
- [x] Pass 32 automated tests, including successful smoke evidence capture and rejection of a mismatched served model before inference. These are mocked checks, not live B0 verification.
- [ ] Identify the intended GPU host (asked user whether to use `dev`, another existing host, or a new Brev instance).
- [ ] Run host preflight, launch vLLM with the pinned serving flags, and establish the local tunnel.
- [ ] Run the live smoke command; save its output and host configuration evidence before marking B0 complete.
