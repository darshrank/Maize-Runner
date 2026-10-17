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
- [ ] Obtain Person A's port-9000 server, authoritative 20-dev task manifest, seasonal N cap and farmer fallback schedule.
- [ ] Run single and multi on the real simulator and validate its observation/tool payloads (B1/B2).
- [ ] Evaluate both on all 20 dev seasons with Nemotron; inspect worst three logs, change one thing, rerun and record actual gain (B3).
- [ ] Freeze chosen prompt hashes after real dev evidence (B4); give A the config names and inference entry point.
- [ ] A alone runs held-out test once. B must never run or tune on test.
- [ ] Merge this branch with A/C later; do not push or merge as part of this local task.

No crop-performance, live-GPU, or bounty milestone is complete based on a synthetic run.
