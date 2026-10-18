# Baseline results (A2), frozen

Baselines on gym-DSSAT for all 35 seasons (dev UFGA 1990-2009, test UFGA 2010-2024), produced Oct 17, 2026
with the prices in `config.yaml` at commit time. Do not edit; regenerate only if the simulator, weather, prices or
reward change (`uv run python -m eval.run_eval --split dev|test --configs no_n,farmer,farmer_ufga,hindsight`,
about 25 minutes on 8 cores).

- `eval.csv`, `summary.md`: same format as `results/` (frozen eval.csv columns).
- `runs/<config>/<task_id>.jsonl`: the season logs (frozen agent-log format), usable by the UI
  (serve the repo root and point the UI at `../results_baseline/runs`, or copy them into `runs/`).

Configs: `no_n` (no N, no water); `farmer` (60/60/40 kg N split + 25 mm when dry); `farmer_ufga` (the UF 1982
experiment's schedule shipped with gym-DSSAT: 116 kg N, 264 mm) = **farmer practice** (better on dev);
`hindsight` = best of 56 fixed plans per season with the weather known in advance (54-plan grid + both farmer
schedules), an unreachable ceiling.

To compare an agent: run it with `eval.run_eval` (rows land in `results/eval.csv`), then copy these baseline rows
into the same file or read both; gap closed = (reward - farmer_ufga) / (hindsight - farmer_ufga) per split.

## Second site: Tifton, GA (added Oct 17, 2026)

`tift_test` = Tifton 2010-2024 (15 seasons), planted Mar 15 (UGA Extension window), same UFGA soil and hybrid in
Tifton's NASA POWER weather. Never used for tuning. Mean reward: no_n 174, farmer (60/60/40) 1,137,
farmer_ufga 1,063, hindsight 1,271. Farmer practice stays `farmer_ufga` (chosen beforehand on Gainesville dev),
although the 60/60/40 split does better at Tifton; both are reported.
