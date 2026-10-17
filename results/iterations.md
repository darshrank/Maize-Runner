# Person B dev iterations

No real simulator or Nemotron dev results exist yet. B3 remains pending.

The first synthetic entry predates main's walking skeleton (commit `7ce7e4b`).
The skeleton integration rechecks the process with shared config limits, farmer
fallback, tool schemas and replay events. Neither entry is a real model improvement.

## Prepared hypothesis

`v1` is the initial prompt set. `v2` changes only `critic.txt`: when the Weather report
indicates at least 30 mm of rain in the next seven days, object to positive nitrogen
unless severe crop nitrogen stress is explicit. The threshold is an unvalidated
dev hypothesis. Do not claim an improvement or choose it for test without evidence.

Run `single` and `multi` on A's 20 dev seasons with v1; run `analyze` and read the
worst three seasons' logs. Select one diagnosed change, rerun the identical dev
manifest, model and simulator, and use `compare --change ...` to append actual paired
reward deltas here. The comparison refuses incomplete runs, different task definitions,
different nitrogen caps/fallback schedules, and more than one changed role prompt.

Local synthetic runs verify this process only. They use a deterministic model, so
the v2 prompt is expected to produce zero gain. Synthetic deltas are labeled explicitly.

## SYNTHETIC plumbing only iteration

Change: Add one unvalidated rain-deferral critic hypothesis; synthetic model ignores prompts

Changed prompt: critic.txt

Before: `results/local-validation-v1`; after: `results/local-validation-v2`.

- single: 20 paired dev seasons; mean reward delta 0.000000.

- multi: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_critic: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_weather: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_tools: 20 paired dev seasons; mean reward delta 0.000000.


No real crop-performance claim is supported by synthetic fixtures.

## Live-model integration correction (2026-10-17)

Scope: actual Nemotron BF16 inference on the Brev H100, shared toy crop simulator,
UFGA-s1 dev task. Protocol 1 sometimes returned prose tool summaries instead of the
required decision/critique; single had one fallback and multi had two over 20 weeks.
Protocol 2 reinforces output instructions after reads, retires exhausted read tools
and reserves the last model turn for a final response. The single/multi rerun had
zero fallbacks each; multi exercised 13 critic objections and 13 planner revisions.

This changes the runtime protocol, leaves role prompt files unchanged and is a
stochastic integration check. It is not B3's controlled one-prompt experiment or a
crop-performance gain. The eight-season audit and all fallback causes are recorded
in `results/b1-b2-live.json`, with original logs archived alongside it.

## SYNTHETIC plumbing only iteration

Change: Skeleton-aligned prompts; v2 differs only in the unvalidated critic rain rule

Changed prompt: critic.txt

Before: `results/local-skeleton-v1`; after: `results/local-skeleton-v2`.

- single: 20 paired dev seasons; mean reward delta 0.000000.

- multi: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_critic: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_weather: 20 paired dev seasons; mean reward delta 0.000000.

- multi_no_tools: 20 paired dev seasons; mean reward delta 0.000000.


No real crop-performance claim is supported by synthetic fixtures.

## Critic-role diagnostic (2026-10-17)

Live Nemotron, ten constructed synthetic proposals (seven defective, three expected-acceptable), each repeated twice. No DSSAT season, policy-quality gain or model training is measured. The v3 critic already objected in 240/377 weeks of the completed real multi run; objection quality is the issue, not a missing rejection quota.

| Critic version | Bad proposals rejected | Valid proposals accepted | Balanced accuracy |
|---|---:|---:|---:|
| v3 existing | 12/14 | 1/6 | 51.2% |
| v4 detailed independent audit | 14/14 | 0/6 | 50.0% |
| v5 balanced evidence/burden of proof | 14/14 | 2/6 | 66.7% |

v4 caught errors but rejected everything. v5 reduced this bias but remains unreliable on expected-acceptable plans; neither is promoted. Both change only critic.txt relative to v3. These are development diagnostics; v5 was revised after inspecting v4 results on the same cases. See critic-review-summary.json and critic-review-logs.zip for complete decisions, inputs, prompt hashes and source hashes.

Next: structured verifiable facts and final coordinator decision verification. The present critic reviews only the planner; it cannot catch new errors introduced by the coordinator. Full new season experiments remain paused.
