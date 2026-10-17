# Local decision-pipeline milestone

October 17, 2026. Implemented locally on `person-B`, agent protocol **3**, facts
schema **1**. This is a runtime/context/instrumentation change. Historical protocol
2 results and prompt candidates remain unchanged; they are not measurements of
this implementation. Thinking stays disabled, with the existing 2048-token cap.
No model training, live inference, new DSSAT seasons, deployment or held-out
evaluation was performed for this milestone.

## Implemented

- [x] Frozen typed facts with units, source paths, uncertainty labels, content IDs
  and episode/week identity. Preserve raw observation/tool evidence. Interpret
  documented fields only; unknown fields remain raw. Simulator error/rounding is
  unquantified, forecasts are explicitly noisy, and no confidence interval is
  invented. Synthetic stress booleans retain their distinct contract semantics.
- [x] Compute the original farmer's literal dry comparison from the reported
  fraction. Equality at 0.35 is false. This is a reference, not a requirement to
  irrigate. Never convert legacy bucket mm into an assumed root-zone fraction.
- [x] Preserve exact season cap, prior applied N, subtraction and weekly limits
  from runner accounting. Tool budget readings retain their own provenance and
  can differ from the runtime ledger; they do not replace it.
- [x] Send verified evidence snapshots onward with specialist reports. Reports
  remain unverified prose. Tool permissions and no-weather/no-tools withholding
  still apply. Parallel specialists cannot acquire a peer's newly completed
  readings through scheduling. Each role invocation owns its malformed streak.
  Model views carry current scalar facts and exact reported-period rain totals;
  full daily/history facts and raw snapshots persist in logs. Tool responses carry
  raw results once, avoiding repeated daily fact/raw copies in every role context.
- [x] Content-addressed frozen planner/revision/coordinator proposals and reviews.
  Reviews bind to the exact original proposal ID. Revisions and coordinator
  outputs receive new IDs/parent links; acceptance is never transferred to them.
- [x] Verify finite values and weekly/season limits on the **post-guard final
  action**, with before/after N accounting and a verification ID, immediately
  before stepping. Audit checks identity, order, episode/week and equality to the
  decision sent. Coordinator changes and guard changes remain visible.
- [x] Native async batch runner saves started markers and atomic, flushed terminal
  receipts per season, before waiting for the batch. Save successes, failures,
  exception types, logs/hashes and unavailable/available telemetry. Verification,
  decision, step and final events are flushed to disk. `/step` is never retried.
- [x] Offline catalogue rebuild reads receipts and classifies unfinished seasons
  as `interrupted_or_running`; it performs no environment/model calls. Completed
  results survive a missing batch CSV. Failures retain uncertain step outcomes.
- [x] Record local code/data hashes, source commit/dirty paths, prompts, model name,
  inference settings, selected reference (`farmer_ufga`) separately from fallback
  (original farmer), and the frozen dev-reference checkpoint hash. Prompt-only
  comparisons reject changed runtime/data hashes or inference settings.
- [x] Record per-response usage, finish reason, reported model/fingerprint and
  request latency without shared mutable telemetry. Receipts sum reported tokens
  and retain validation failures. Missing tokens/cost remain unknown, not zero.

## Reproduce without network or GPU

From the repository root, choose a new output path:

```powershell
uv sync --frozen
uv run python scripts/run_local_milestone.py --output runs/local-milestone-001
uv run python scripts/run_local_milestone.py --catalogue-only --output runs/local-milestone-001
uv run pytest -q
```

The script runs **two synthetic weeks**, all five configs on dev years 1990 and
2009 (10 short fixtures), audits them, then injects one failure after a synthetic
step applies. That failure is expected and retained. It does not use DSSAT or the
GPU model. The catalogue includes the successful and failed experiment; results
are plumbing evidence only. It refuses to overwrite an existing experiment.
The catalogue command only reads records and rewrites its catalogue file.

Native CLI runs also accept `--experiment-kind` (`runtime`, `prompt_only`,
`thinking_mode`, `synthetic_plumbing`). This label is descriptive; paired
comparison also checks hashes/settings. No thinking toggle has been introduced.
Keep future runtime and inference experiments separate from prompt-only work.

## Limits and next work

- [ ] Fresh live role diagnostics and context/output-budget checks before any new
  full seasons. The richer context has not been tested against the served model's
  16K context window. Bound/measure its size before promoting the runtime.
- [ ] Validate semantic claims and critic accuracy on fresh cases. Final numeric
  constraints and exact identity are verified; agronomic optimality and free-text
  reasons are not certified. The critic still reviews the planner only, so the
  final record explicitly states that the coordinator has no semantic review.
- [ ] Thinking-mode configuration, parser smoke, controlled off/on comparisons
  and final-output headroom remain pending. No current inference change.
- [ ] Attest the remote model revision, container and DSSAT binary/data versions
  before a live run. Local hashes cannot attest an HTTP server or Brev snapshot.
  Allocated GPU time and dollar cost require separate measurement; request latency
  is not a substitute. Current receipts leave these values null.
- [ ] Coordinate N-uptake definitions and end-reason/tail metadata with Person A.
  No simulator/weather/prices/reward/cap contract changes were made here.
- [ ] Freeze/select prompts/runtime from full evidence later; shared default stays
  v1. Person A alone owns held-out years 2010–2024.

Durable receipts/catalogue belong to `fieldtwin_agents.runner.run_batch`. The
shared synchronous Policy adapter also uses facts/IDs/final verification, but
its existing `RunLogger` still buffers in memory; that path has not gained the
native runner's receipt lifecycle. Direct `run_season` calls retain durable event
logs but obtain receipts when invoked through `run_batch`. Atomic replacement
and file fsync protect normal process crashes; directory-entry persistence after
power loss depends on the OS/filesystem. An unfinished marker cannot tell whether
a process is alive or a timed-out step applied. Inspect it; never replay a step
automatically. This push does not deploy to the copied Brev snapshot.
