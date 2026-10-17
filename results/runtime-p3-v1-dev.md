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
checkout above. Foreign vLLM load recorded at start. Results pending.

GPU cost and per-workload allocated time are not measured; they are unknown, not zero.
