# Runtime experiment: protocol 3, v1 prompts, dev 1990-2009

Classification: **runtime** experiment (protocol-3 facts, immutable IDs, exact
final-action verification, durable receipts). Prompts fixed at v1
(`config/prompts-v1.freeze.json`), thinking off, max_tokens 2048, temperature 1.0,
top-p 0.95. Not a prompt-only or thinking-mode experiment. No training. Dev years
only; held-out 2010-2024 belong to Person A. Simulator, weather, prices, reward and
caps unchanged. Frozen baselines in `results_baseline/` are reused, not regenerated.

Every attempt, failure and negative result is recorded below, in order.

## Deployment, October 17, 2026 (UTC)

- Remote state inspected first: no earlier person-B checkout or bundle existed,
  no FieldTwin season process was running. Env health `{"ok":true,"simulator":"dssat"}`;
  vLLM 0.27.1 serving `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`,
  `max_model_len` 16384, image digest `sha256:07913e94...de0a`, HF snapshot
  `a9904d24bcc1d289a1950fa9d2b978c47cf903b9`, gym-dssat-pdi 0.0.5, H100 PCIe,
  driver 570.195.03. Full record: `attestation.txt` in the pilot archive.
- **Concurrent foreign load:** vLLM already had 9-11 running requests from an SSH
  port-forward opened at 20:15 UTC under the user's Brev certificate (not a DSSAT
  client; origin not identified). It continued through the pilot and was present
  at full-run start. Correctness is unaffected; latency/throughput telemetry is
  confounded and must not be read as uncontended performance.
- Commit `afffb23` bundled and cloned to
  `/ephemeral/fieldtwin/person-b-20261017T203747Z` (clean, imports resolve there).
  Reused app-a-env Python 3.12.15. 39 targeted tests passed on Brev.
- The running DSSAT server is served from the copied `app-a-env` snapshot.
  `env/server.py`, `env/dssat_sim.py`, `env/dssat_worker.py` and `tasks/dev.jsonl`
  are byte-identical to the checkout. `config.yaml` differs only by CRLF line
  endings and A2's `farmer_ufga` eval entries; env/prices/reward/caps identical.

## Smoke

1. **Failed:** `fieldtwin_agents smoke` raised "Tool-call smoke test failed". The
   CLI saves output only on success, so this response was not preserved.
2. Diagnostic (identical payload, model-only, no env calls; `smoke-diagnostic.json`):
   **9/10 valid**. The invalid trial had the right tool name but arguments
   `{"": "{}"}`. Payload is unchanged from the historical passing B0 smoke, so this
   is sampling variation at temperature 1.0 with the qwen3_coder parser, not a
   protocol-3 regression. The agent loop rejects such read calls without executing
   them, re-prompts once and falls back visibly after two consecutive failures.

## Pilot: UFGA-1990, single and multi, concurrency 1

Output `results/live-check-20261017T203747Z/pilot`; archive
`results/runtime-p3-pilot-20261017T203747Z.tar.gz`. Audit (`audit_run`,
require_live) passed: protocol 3, non-synthetic env and model.

| Policy | Reward | Profit | Grain kg/ha | N kg/ha | Irr mm | N leached | Fallbacks |
|---|---:|---:|---:|---:|---:|---:|---:|
| single | 453.56 | 460.98 | 5246.9 | 300 | 95 | 3.04 | 0 |
| multi | 749.68 | 757.81 | 6881.5 | 300 | 128 | 3.33 | 0 |
| farmer_ufga (frozen) | 1296.33 | 1326.53 | 8643.8 | 116 | 264 | 12.38 | 0 |
| farmer (frozen) | 999.80 | 1005.53 | 7025.3 | 160 | 150 | 2.35 | 0 |

One stochastic season per policy; not evidence across years.

Record checks (`scripts/inspect_live_run.py`, `pilot-inspection.json`): 18 decided
weeks each; every review binds a same-week planner proposal; all parents exist;
every verification passes numeric checks and equals the decision sent; guard
changed no action. Multi: 18 reviews, 12 rejections.

Context/output: largest prompt 9,431 tokens (critic), minimum headroom 6,890 of
16,384 including completion. All usage fields present. Finish reasons were
`stop`/`tool_calls` except **one critic `length` finish** (2,048 completion tokens,
36 s): with thinking off the critic deliberated inside its JSON objection string
("Actually 130 + 80 = 210 <= 300, so cap is fine... Need another objection...")
until truncated. The invalid JSON was rejected, the critic re-prompted once and
returned a valid short objection; no fallback. 1/31 critic calls. Treated as
measured v1 model behavior, not a plumbing defect; no runtime change was made
before the baseline so the baseline remains v1.

Semantic failures observed (exact facts were present in context):

- Single misstates the budget: week 8 "season total exhausted at 120 applied"
  with 180 kg remaining; week 10 "no nitrogen remaining in season cap". Dry weeks
  7-13 (moisture 0.23-0.33) received only 0-20 mm. 100 kg N applied at R3 (week 15).
- Multi critic arithmetic errors: weeks 9-10 object that 30 kg would "exceed the
  remaining 130 kg"; week 15 objects to applying zero N when the budget is zero.
  Week 7 (moisture 0.198) ended with no irrigation after a leaching objection.
  Week 6 rejects 40 kg merely for "no contingency" with 220 kg remaining.
- Numeric verification certifies limits and identity only; these errors pass it.

Decision: user chose to run the unchanged v1 baseline first, then test agent
fixes as a separate, labelled experiment on the same dev years.

## Full dev run

Started 2026-10-17T20:50:16Z, PID 52681, concurrency 8, 40 seasons (single and
multi x 20 dev years). Output `results/runtime-p3-v1-dev-20261017T205016Z` in the
checkout above; last receipt 21:14:17Z (**24.0 min wall clock**). Archive:
`results/runtime-p3-v1-dev-20261017T205016Z.tar.gz` (logs, receipts, eval.csv,
audit, diagnostics, inspection, farmer comparison). Comparison JSON also at
`results/runtime-p3-v1-dev-comparison.json`.

**Completion:** 40/40 receipts `completed`, eval.csv complete, `audit_run`
(require_live) passed; peak overlap 8 seasons. 754 decided weeks (377 per policy).
Zero fallbacks. Zero binding problems: every review binds a same-week planner
proposal, every verification passes numeric checks and equals the decision sent.
Guards changed 2 single and 9 multi actions (visible in records).

### Against matched frozen farmer_ufga dev rows

| Policy | Reward | Profit | Grain kg/ha | N kg/ha | Irr mm | N leached | Years > farmer_ufga |
|---|---:|---:|---:|---:|---:|---:|---:|
| farmer_ufga (frozen) | 1116.72 | 1166.56 | 7814.90 | 116.00 | 264.00 | 20.43 | - |
| farmer original (frozen) | 1024.05 | 1063.92 | 7214.37 | 160.00 | 111.25 | 16.34 | - |
| single p3 v1 | 379.25 | 423.09 | 4512.17 | 251.00 | 55.05 | 17.97 | 2/20 |
| multi p3 v1 | 646.35 | 700.54 | 6454.46 | 293.50 | 102.58 | 22.21 | 2/20 |

Mean reward delta vs farmer_ufga: single **-737.47** (median -668.55), multi
**-470.37** (median -398.99). Both use far more N (+135, +177.5 kg/ha) and far
less water (-209, -161 mm). Single beats farmer_ufga in 1991 and 1995; multi in
1991 and 1996. Negative-reward seasons: single 1990, 1998, 2000, 2001, 2002, 2006;
multi 1998, 2006. **Negative result: protocol 3 with v1 prompts remains far
below the selected farmer practice.**

Context only (not a controlled comparison): archived protocol-2 v1 means were
single 343.00 / multi 600.88 reward, 296.75 / 298.00 kg N, 26.91 / 26.86 kg
leached, 46.13 / 96.60 mm, 1065 / 3625 model calls. Protocol-3 differences
(+36.25 / +45.47 reward, less N and leaching in single, +42% single calls) are
one stochastic rollout per year under a different protocol and a shared GPU;
they do not isolate the effect of facts/verification.

### Reliability and telemetry

- Model calls: single 1,515, multi 3,724 (all with reported usage).
- Tokens: single 9,652,493 prompt / 40,195 completion; multi 21,030,707 prompt /
  375,501 completion. Summed request latency: 0.50 h single, 3.14 h multi
  (overlapping requests; not GPU time).
- Largest prompts: coordinator 13,036 tokens (headroom 3,348 before completion;
  with the 2,048 cap, ~1,300 spare), planner 9,122, critic 8,296. The coordinator
  context is the tightest and must be watched if evidence grows.
- Finish reasons: one `length` (multi coordinator, 2,048 tokens); all others
  `stop`/`tool_calls`.
- 22 recovered validation errors, no fallbacks: 18 multi coordinator replies put
  prose before the JSON ("The critic objects that ... I must apply nitrogen.
  {...}") and were rejected by the strict parser, then re-prompted; 3 single
  coordinator and 1 planner errors were invalid control characters/unterminated
  strings in JSON.
- Multi critic: 228 rejections in 377 reviews (60%), similar to v3's 240/377.
- Concurrent foreign vLLM client present at start (9-11 requests) and essentially
  gone at finish (2 running at 21:15:27Z including any residue); latency is confounded.
- GPU cost and allocated GPU time are not measured; they are unknown, not zero.

### Next (separate experiment, same dev years)

Diagnosed targets for a labelled agent-fix experiment: budget misstatements and
critic arithmetic despite exact facts; critic objections that block irrigation on
dry soil; N spent late or to the cap; coordinator prose-before-JSON. Keep each
change classified (prompt-only vs runtime) and compare against this run.
