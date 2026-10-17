# Next steps after A2 integration

Current update, October 17: the local protocol-3 foundation is implemented; see
[LOCAL_MILESTONE.md](LOCAL_MILESTONE.md) and the latest section of handoff.md.
Typed facts, immutable proposal/review IDs, exact numeric final-action verification,
native per-season receipts, telemetry and the synthetic user-run wrapper are done
locally. Live semantic reliability/context sizing, remote artifact attestation,
thinking comparisons and season experiments remain pending. No real new seasons,
training, inference-setting change or Brev deployment occurred.

October 17, 2026. A's `a-env` at `a866f06` is integrated into `person-B`.
This integrates code/results and updates the plan; it does not deploy to Brev,
enable thinking, launch experiments or train weights.

## What changed

- A2 baselines are complete and frozen in `results_baseline/`. Reuse them.
- `farmer_ufga` implements the UFGA experiment schedule: 116 kg N/ha and 264 mm
  irrigation, grouped into weekly actions. A selected it on dev as
  `eval.farmer_practice`. Original `farmer` remains available.
- Hindsight now selects among 56 candidate policies per season, including both
  farmers. It uses outcome knowledge, and is neither deployable nor a mathematical
  upper bound on every possible adaptive policy.
- Merge conflicts were resolved preserving all B registrations and A's farmer
  selection, plus B's report provenance labels and UTF-8 handling. A regression
  test checks the selected-reference arithmetic and provenance together.
- Incoming commits do not change simulator/weather/prices/reward/caps. Original
  farmer matches all 20 archived dev rows on eight compared outcome fields.
- B's fallback remains the original 60/60/40 farmer with moisture-based irrigation.
  Selecting a benchmark reference does not silently change recovery behavior.

## Updated dev position

| Policy | Reward USD/ha | N kg/ha | Water mm | N leached kg/ha |
|---|---:|---:|---:|---:|
| Original farmer | 1024.05 | 160 | 111.25 | 16.34 |
| Selected farmer practice: farmer_ufga | 1116.72 | 116 | 264.00 | 20.43 |
| Single v3 | 593.24 | 249.95 | 456.25 | 81.82 |
| Multi v3 | 878.04 | 300 | 407.95 | 74.99 |
| Hindsight: outcome-selected candidate reference | 1282.90 | 141.20 | 144.05 | 14.24 |

Multi v3 is 238.68 USD/ha (21.37%) below the new selected reference. Its positive
change from v1 remains a descriptive dev improvement, not a farmer win. Historical
results are unchanged. See [dev comparison](results/a2-integration-dev.json).
Only dev rows were analyzed; no held-out agent evaluation or new rollout ran.
Previously published test baseline summaries are not a basis for B's tuning.

## Thinking explained

Nemotron can generate a reasoning phase before its final answer, controlled by
`chat_template_kwargs.enable_thinking`. It uses the same checkpoint at inference;
it does not change weights, acquire new observations or create persistent learning.
NVIDIA documents both modes and temperature 1.0/top-p 0.95.
[Model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16).

Current client: thinking off, max_tokens 2048. The serve script already configures
`--reasoning-parser nemotron_v3`; extraction alone does not override the client's
disabled mode. vLLM separates reasoning from final content. Parse only the final
action/critique or valid tool call; generated reasoning is not verified evidence
for downstream agents. [vLLM reasoning](https://docs.vllm.ai/en/v0.27.1/features/reasoning_outputs/).

Hypothesis: extra inference work could improve planning/review under multiple
constraints. It might instead produce longer wrong explanations, false objections
or delays. Thinking-off can still solve reasoning problems: the toggle controls
generation mode, not a guarantee of correctness.

Weights remain the same, but extra tokens increase generation work and can increase
runtime/context-state pressure. On our hourly rental, measure allocated GPU time
per completed workload, throughput and idle time; there is no fixed cost multiplier.
Do not enable all roles by default.

The normal generation cap includes reasoning. Flipping on with the current 2048
cap could leave insufficient room for valid final JSON. vLLM also documents
`thinking_token_budget`; smoke-test support on our exact checkpoint/parser/container
before relying on it. Record finish reasons, token usage, final-output validity,
tool behavior and latency, with enough total output allowance.
[Thinking budget](https://docs.vllm.ai/en/v0.27.1/features/reasoning_outputs/#thinking-budget-control).

## Ordered pending work

1. Locally complete: typed facts/raw evidence, units/uncertainty/episode/week,
   immutable proposal/review IDs, exact post-guard verification and ablation
   withholding. Next validate live context size and fresh semantic cases; numeric
   verification does not certify agronomic reasoning or coordinator semantics.
2. Locally complete in the native runner: durable per-season receipts, offline
   catalogue and user-run wrapper; local source/data/prompt/inference provenance
   and per-call telemetry. Next attest remote artifacts and measure allocated
   GPU cost; current receipts leave unavailable usage/cost null. The shared sync
   logger is still buffered. Prompt-only checks reject runtime/inference changes.
3. Reconcile N uptake definitions/timing with A; no incoming fix addresses the
   archive finding. This does not block local foundations. A2 is now complete;
   final held-out evaluation follows B's freeze.
4. Prepare fresh role diagnostics and a separately recorded thinking comparison,
   after client instrumentation/parser smoke tests. Start with critic; consider
   planner if useful. Keep specialist roles off initially and evidence/prompts fixed.

   | Comparison | Off arm | On arm | What it measures |
   |---|---|---|---|
   | Fixed total generation allowance | Declared total token cap | Same cap, thinking enabled | Effect of allocating a fixed allowance differently |
   | Practical quality/cost tradeoff | Fixed off configuration | Separately declared larger allowance | Whether extra runtime buys quality; changes mode AND budget |

   Include repeated fresh valid/invalid cases, both critic error rates, repair
   outcomes, failures, tokens and wall time. Choose budgets before observing results.
   Role diagnostics alone do not establish seasonal reward gains.
5. When seasons resume, compare lean planner and staged multi-agent ablations on
   identical dev tasks/evidence/checks/budgets. Join existing frozen baselines by
   task ID; report gap/leaching against farmer_ufga and keep original farmer for
   context. No baseline search rerun or held-out agent tuning.
6. Promote from complete reward/resource/reliability evidence. Freeze code, facts,
   prompts and inference settings before A's test. SFT/RL is a separate later
   decision. Keep negative/partial results in the trend table and call it system
   development, not automatic learning.

Verification after merge: 42 local tests passed, eight DSSAT skips on Windows,
existing Starlette/httpx deprecation warning. No new model or DSSAT experiments.
