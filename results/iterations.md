# Person B dev iterations

No real simulator or Nemotron dev results exist yet. B3 remains pending.

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
