# Agent designs (person A)

A's agent experiments, kept separate from B's `agents/policies/` so both teams can work in parallel;
the best design is kept. Same model for every agent (Nemotron 3.5 Lightning 30B on vLLM; the hackathon's
33B total-parameter limit allows only one model), same simulator, same tasks, same scoring.

```
agents_a/
  common/           shared: llm.py (vLLM client, logs every call), agent.py (one role's tool loop), guard.py (clamp +
                    farmer fallback), season.py (compact weekly summary), splits.py (tune/check), agronomy.md (sourced facts)
  designs/
    __init__.py     registry: design name -> policy class (registered as config "a_<design>" at run time)
    <design>/
      README.md     hypothesis, what changed, results
      policy.py     the design
      prompts/      one prompt file per role
      runs/         season logs (frozen agent-log format, replayable in the UI)
      results/      eval.csv + summary.md vs the frozen baselines (results_baseline/), run logs
  run_design.py     run a design on a split, write into its folder
  compare.py        all designs vs baselines per subset -> comparison.md
```

## Run a design

Needs the env server and the model endpoint:

```bash
uv run uvicorn env.server:app --port 9000                  # simulator (gym-DSSAT)
brev port-forward fieldtwin-b0 -p 8000:8000                 # vLLM on Brev -> localhost:8000 (.env has the model name)
uv run python -m agents_a.run_design --design d0_single --split dev [--subset tune|check] [--task-id UFGA-1995]
uv run python -m agents_a.compare                           # comparison table -> agents_a/comparison.md
```

## Rules (generalization)

- **Splits:** tune on `dev-tune` (1990-2004, 15 seasons); confirm on `dev-check` (2005-2009, 5 seasons) before
  keeping a change; `test` (2010-2024) is sealed and run once at the end (A4).
- **Prompts hold general principles, never season-specific answers.** Agronomy numbers come from published
  guidance: `common/agronomy.md` (UF/IFAS corn recommendations and extension sources), shared by all new designs.
- **Judge on all seasons of a subset, never on one season.** Before a full run, smoke-test a new design on three
  contrasting tune seasons: UFGA-1998 (driest, 303 mm in-season rain), UFGA-1999 (median, 449 mm), UFGA-1991 (wettest, 829 mm).
- **One change per design** and a README entry with the result, so every gain can be attributed (NeMo Gym bounty).

## Designs

| design | idea | dev reward | gap closed | status |
|---|---|---|---|---|
| baseline: farmer practice (`farmer_ufga`) | UF experiment schedule | 1,117 | 0.00 | frozen |
| baseline: hindsight | best fixed plan, weather known | 1,283 | 1.00 | frozen |
| `d0_single` | one agent, all tools, first prompt | 660 (tune 686, check 580) | -2.75 | done: fails in dry years (under-irrigation), over-fertilizes |
| `d1_multi` | 5-role team, first prompt | 1 season only | | stopped: under-fertilized |
| `d1b_multi` | d1 + N-economics prompt fixes | 1 season only | | stopped: N overshoot; water not fixed |
| `d0b_single` | one agent with all of d1c's knowledge (fair test) | tune 1,396, check 1,069; test 1,238 | tune 1.41, check 0.24; test 0.86 | ties the team on tuned seasons; on the 20 unseen seasons the team is +81 USD/ha (+-61), 15/20 wins; 30 fallbacks vs 0 |
| **`d1c_multi`** | 5-role team + sourced agronomy (UF/IFAS) | **tune 1,403, check 1,190; test 1,306** | **tune 1.45, check 1.20; test 1.21** | **final (A4 done)**; weak spot: leaching in wet seasons |

Live table: `comparison.md` (`uv run python -m agents_a.compare`).
