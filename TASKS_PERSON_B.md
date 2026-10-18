# Person B: current done and pending

Last updated: October 17, 2026 (America/New_York), local protocol-3 milestone.
Branch: `person-B`. Read [handoff.md](handoff.md) first in a new session.
Latest follow-up: implemented local facts/identities/final checks, native durable
season receipts/catalogue and reproducible synthetic script. See LOCAL_MILESTONE.md.
Full new season experiments remain paused at the user's request.
Latest integration: A2 at `a866f06`; see [NEXT_STEPS.md](NEXT_STEPS.md).
Selected farmer practice is now `farmer_ufga` (1116.72 dev reward); fallback
remains original farmer. Merge verification: 42 passed, eight DSSAT skips,
existing TestClient deprecation warning.
This current checklist supersedes the earlier in-progress snapshots in chat/docs.
The user authorized pushing person-B with the handoff; main/a-env stay unchanged.

## Done

- [x] Protocol 3: typed field facts with units/source/uncertainty/episode/week, raw evidence, exact budgets and labelled farmer comparison; preserve ablation withholding.
- [x] Immutable proposal/revision/coordinator/review IDs; verify and audit the exact post-guard action, including coordinator changes. Agronomic semantics remain unverified.
- [x] Native runner saves per-season success/failure receipts before batch completion; offline catalogue classifies uncertain interrupted steps without replay.
- [x] Reproducible scripts/run_local_milestone.py runs all configs for two synthetic weeks on dev years 1990 and 2009 plus one injected post-step failure. Preserve every named run and failure.
- [x] Add local runtime/data provenance, per-call token/finish-reason/latency telemetry and prompt-only confound checks. Isolate malformed counters per role invocation. Thinking remains off.
- [x] Final local verification: **60 passed, eight DSSAT skips**, existing Starlette/httpx warning. All three named synthetic script runs are archived: 30 successful short fixtures and three expected post-step failures total. Archive CRC verified; no live rollout or performance claim.

- [x] Create person-B and implement Person B's agents from the FieldTwin PDF.
- [x] Integrate main's walking skeleton and later merge A's a-env at 64b38f9 (merge cd7bea5).
- [x] B0: deploy the real Nemotron BF16 checkpoint on the Brev H100; verify model discovery and a parsed get_weather({}) call.
- [x] B1: single-agent policy, allowed read tools, strict decisions, complete season logs and shared Policy integration.
- [x] B2: five-agent flow, one planner revision after critic objection, code guards, visible farmer fallback, eight concurrent seasons.
- [x] Register single, multi and three ablations; honor shared tools, caps, farmer schedule and exact JSONL/CSV contracts.
- [x] Implement dev-only experiments, provenance, worst-three diagnostics, paired comparison, versioned prompts and freeze checks.
- [x] Verify software with 40 local tests, 15 real-environment contract tests on Brev, and the shared toy HTTP smoke (24 config/task rows). Eight DSSAT tests skip on Windows; an existing TestClient deprecation warning remains.
- [x] Install A's gym-DSSAT on Brev; adapt B to year-based tasks and variable maturity; reject an unlabelled toy endpoint for real CLI runs.
- [x] Complete and audit v1 single + multi on all 20 dev years (40 seasons, 754 weekly steps), zero fallbacks.
- [x] Review the v1 worst three logs for each policy; diagnose missed irrigation, false budget restrictions and excessive nitrogen spending.
- [x] B3 iteration: change only coordinator.txt in v3, run all 40 paired seasons, audit all results, and record actual positive dev reward deltas in results/b3-iterations.md.
- [x] Back up both complete real-run archives, the farmer dev CSV, manifests, audits, diagnostics and current status in the repository.
- [x] Create handoff.md with evidence, diagnosis, current services, commands and next tasks.
- [x] Document current weekly flow, high-level architecture, communication/cache boundaries and proposed improvements in ARCHITECTURE.md.
- [x] Research architecture failure modes using primary sources; record component rationale, mitigation and retention checks in ARCHITECTURE_REVIEW.md. Correct the HLD's 20-week control-horizon description. No new runtime change or experiment.
- [x] Read-only audit all 80 archived seasons: 16 reach decision week 20, all at R6 before day 140; no evidence of forced horizon truncation in these logs. Final/weekly leaching and gas agree within 0.03 kg/ha. Record full audit in results/architecture-horizon-audit.json.
- [x] Integrate A2's frozen baselines, farmer_ufga reference and 56-candidate hindsight. Resolve config/report conflicts preserving B policies and provenance. Check original farmer matches all 20 archived dev rows; save results/a2-integration-dev.json.

## Completed real dev results

All rows use UFGA 1990-2009 (20 years), fixed DSSAT/weather/prices/reward/caps.
Reward is simulated profit minus nitrate-leaching penalty, not a real farm result.

| Policy | Mean reward USD/ha | N kg/ha | N leached kg/ha | Water mm | Fallbacks |
|---|---:|---:|---:|---:|---:|
| Original farmer | 1024.05 | 160.00 | 16.34 | 111.25 | 0 |
| Selected farmer practice: farmer_ufga | 1116.72 | 116.00 | 20.43 | 264.00 | 0 |
| Single v1 | 343.00 | 296.75 | 26.91 | 46.13 | 0 |
| Multi v1 | 600.88 | 298.00 | 26.86 | 96.60 | 0 |
| Single v3 | 593.24 | 249.95 | 81.82 | 456.25 | 1 |
| Multi v3 | 878.04 | 300.00 | 74.99 | 407.95 | 0 |

Paired mean reward gains: single +250.234 (+73%), multi +277.158 (+46%).
One stochastic rollout per year/version: dev improvement does not establish
independent generalization or an inference-cost advantage. v3 still trails farmer
and has excessive water/leaching. It is not selected as final.
Against A2's selected farmer practice, multi v3 is 238.68 USD/ha (21.37%) lower.

## Live protocol-3 runtime experiment (October 17)

See results/runtime-p3-v1-dev.md.

- [x] Deploy afffb23 to a fresh isolated Brev checkout; verify services, model identity, context limit and served env code.
- [x] Live smoke (one failure recorded, 9/10 diagnostic) and UFGA-1990 pilot audited, inspected and archived.
- [x] Full v1 single + multi on all 20 dev years: 40/40 completed and audited; single 379.25, multi 646.35 vs farmer_ufga 1116.72 (negative result). Archive and comparison committed.
- [x] v3 prompt-only run on protocol 3: multi 905.96 (best so far), single 97.14 (collapsed). Archived.
- [x] Protocol 4 code checks and configurable thinking implemented locally; 73 tests pass; live thinking parser diagnostic passed.
- [ ] Combined run: thinking on + protocol 4 + v3 prompts, after vLLM 32K-context restart once the other client is idle; pilot first.

## Pending, in priority order

- [ ] Follow NEXT_STEPS.md: fresh live diagnostics/context sizing, remote artifact attestation/cost measurement, then matched-budget dev ablations versus frozen farmer_ufga. Baselines need no rerun.
- [ ] Instrument configurable thinking diagnostics with inference settings, token/latency usage and finish reasons. Smoke-test parser/tools and final-output headroom; keep thinking off by default until evidence supports promotion.
- [ ] Reconcile final-versus-weekly N uptake definitions/timing with A (differences up to 10.39 kg/ha in v1, 6.23 in v3). Add explicit end-reason/tail metadata in a separately versioned environment change; uptake is not a direct reward term. Preserve historical results.
- [x] Implement typed weekly facts, provenance/uncertainty, immutable proposal/review IDs, exact numeric final-action checks and existing bounded recovery. Compare lean/five-role arms later.
- [x] Add native durable season receipts/catalogue/user-run wrapper; verify receipt survival before batch end and no uncertain-step replay. Fix parallel malformed counters; record available tokens/latency with cost explicitly unmeasured.
- [ ] Fix critic false objections using structured verifiable facts and assess how to verify the final coordinator decision. Critic wording alone remains insufficient; do not promote v4/v5 based on rejection frequency.
- [ ] Inspect complete v3 worst-three role/tool traces. A concrete logged error reverses the irrigation comparison: moisture 0.93 is interpreted as triggering the below-0.35 rule.
- [ ] Design and test one targeted next change for watering-condition reliability. Clearly distinguish prompt-only changes from code/protocol changes.
- [ ] Diagnose and separately improve nitrogen efficiency if still needed; 300 kg is a cap, not a spending target. Keep A's prices/reward/caps fixed.
- [ ] Select prompts from complete evidence; avoid promoting v3 based only on yield or positive deltas relative to a weak v1.
- [ ] B4: create final freeze and update config.yaml prompt_version/freeze_manifest together. Current default is v1; v3.candidate is only a snapshot.
- [ ] Validate multi_no_critic, multi_no_weather and multi_no_tools with the selected real model/DSSAT setup; give A/C reproducible configs, CSVs and DSSAT replay samples.
- [ ] If the user later requests training, make a data/validation plan before supervised fine-tuning or RL. No model training has happened so far.
- [ ] A alone performs the held-out test (2010-2024) once. B must not execute/tune on it.
- [ ] Team merges person-B back into main later.

## Resume locations and services

Background phase: `candidate_complete_selection_pending`, finished at 3:19:40 PM
New York. No experiment remains queued/running. The GPU/model and env servers
remain running on fieldtwin-b0, quoted $3/hour with no stop/start.

Remote app: `/ephemeral/fieldtwin/app-a-env` (copied snapshot, not a git checkout).
Model: `http://127.0.0.1:8000/v1`; real DSSAT: `http://127.0.0.1:9001`.
Progress: `results/b3-progress.json`; job log:
`/ephemeral/fieldtwin/b3-candidate.log`. Do not relaunch into existing output dirs.

Evidence: `results/dssat-dev-v1-logs.zip`, `results/dssat-dev-v3-logs.zip`,
`results/b3-iterations.md`, `results/status-person-b.json`.
Earlier live/toy checks remain in results/b1-b2-live* and are labelled separately.

The earlier toy/tunnel path had two HTTP fallbacks; its root cause is unconfirmed.
The colocated real runs had no HTTP fallbacks. The only candidate fallback was a
visible malformed-response fallback in single. No cost-saving claim is established.

## Critic wording follow-up

- [x] Inspect actual objections: the v3 critic rejected 240/377 weekly proposals, each followed by one planner revision. It was not accepting everything.
- [x] Preserve v1/v3 measured prompts and create v4/v5 critic-only candidates. Instructions demand independent evidence, literal checks, one actionable correction and acceptance when no material defect exists.
- [x] Create scripts/check_critic.py and ten synthetic role-review cases, including expected acceptances and rejections. Record prompts, inputs, hashes, calls and outcomes.
- [x] Run 60 live role reviews: v3 rejected 12/14 bad proposals and accepted 1/6 valid ones; v4 14/14 and 0/6; v5 14/14 and 2/6. v4's reject-everything behavior and v5's remaining false objections are recorded, not hidden.
- [x] Pass 41 local tests (eight DSSAT skips), including a diagnostic-scoring check that both always-accept and always-reject get only 50% balanced accuracy.
- [x] Archive all review logs in results/critic-review-logs.zip and save results/critic-review-summary.json. Current shared default stays v1; neither candidate is selected for full seasons.
- [ ] Validate future critic changes on fresh cases as well as development failures; these small constructed cases are not independent crop or general-accuracy evidence.
- [x] Bind review to the original planner proposal and verify the exact final coordinator/guard action numerically. Final coordinator semantic review remains pending and explicitly unclaimed.
