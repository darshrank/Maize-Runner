# d0b_single: one agent with the team's full knowledge (fair single-vs-team test)

**Design:** the `d0_single` loop (one Nemotron agent, all tools, same code guard, max 8 model calls per week) with
everything the `d1c_multi` team's prompts contain merged into one prompt (`prompts/system.md`): the same team
context and stage names, the same sourced agronomy (`agents_a/common/agronomy.md`), the Planner's decision rules,
and the Critic's checklist as a self-check before submitting. The only difference from `d1c_multi` is the
architecture: one agent doing everything vs five specialist roles.

## Results (dev, 20 seasons)

| | dev-tune (15) | dev-check (5, never tuned on) | fallbacks | leached tune / check | model calls per season |
|---|---|---|---|---|---|
| **d1c_multi** (team) | **1,403** (gap closed 1.45) | **1,190** (1.20) | **0** | 16.3 / 26.0 | 163 |
| **d0b_single** | 1,396 (1.41) | 1,069 (0.24) | 19 | 19.4 / 33.7 | 54 |
| d0_single (first prompt) | 686 | 580 | 0 | 12.8 / 25.9 | ~59 |
| farmer practice | 1,142 | 1,040 | | | |
| hindsight | 1,322 | 1,165 | | | |

Team minus d0b over all 20 seasons: +35 USD/ha (95% CI +-106), team ahead in 12 of 20.

**Reading:**
- The sourced agronomy explains most of the jump from d0_single (686 -> 1,396 on tune).
- With the same model and knowledge, the single agent ties the team on the seasons the prompts were tuned on, but
  falls well behind on unseen seasons (gap closed 0.24 vs 1.20): the team generalizes better.
- The single agent failed to produce a valid decision 19 times (farmer fallback); the team never did.
- The team leaches less N, at about 3x the model calls.
