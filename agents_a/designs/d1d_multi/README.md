# d1d_multi: independent Nitrogen and Water agents

**One change vs `d1c_multi`:** the single Planner is split into two independent specialists that work in parallel,
and the Water agent gets a physics-based water-balance tool. Everything else (Weather, Crop, Coordinator prompts,
the shared sourced agronomy, code guard) is the same as d1c_multi.

```
Weather (get_weather) ─┐ parallel                ┌─► Nitrogen agent (get_budget, get_history) ─► propose_nitrogen ─┐
Crop (crop, soil) ─────┴─► reports ─► parallel ──┤                                                                  ├─► Critic (both together,
                                                 └─► Water agent (water_balance, get_soil) ───► propose_irrigation ─┘   incl. N/water clashes)
                                                                                                                         │ object: target nitrogen/water/both
                                                                     targeted agent(s) revise once ◄─────────────────────┘
                                                     ─► Coordinator: submit_decision + one-line reason
```

| role | tools | answer | job |
|---|---|---|---|
| Nitrogen | `get_budget`, `get_history` | `propose_nitrogen(n_kg_ha, reason)` | season N budget (~220-230 kg/ha), small doses timed to demand and dry windows, nothing after VT |
| Water | `water_balance` (agent-side), `get_soil` | `propose_irrigation(irr_mm, reason)` | weighs each mm's cost against yield risk, starting from the water balance |
| Critic | `get_budget`, `get_soil` | `review_plan(verdict, target, objection)` | checks both plans together; new: flags a big irrigation in the same week as a big N dose on moist soil |

**Water-balance tool** (`agents_a/common/water.py`, FAO-56): Hargreaves reference evapotranspiration from daily
max/min temperature and extraterrestrial radiation (site latitude, day of year), times the FAO-56 maize crop
coefficient for the stage (0.3 initial, rising to 1.2 by tasseling, 0.6 at maturity); suggestion = next-7-day crop
water use minus 80% of forecast rain, fully replaced when soil water < 0.5, half when 0.5-0.7; with its cost.
Sanity check: mid-June Gainesville ET0 5.8 mm/day, so ~49 mm/week at full canopy (UF/IFAS peak use 35-50 mm/week).

**Fallbacks:** failed Nitrogen agent -> farmer-practice N for the week; failed Water agent -> the water-balance
suggestion; failed Critic -> accept; failed Coordinator -> the two proposals combined. All logged.

**Hypothesis:** dedicated specialists fix the two weak spots of d1c_multi: leaching in wet seasons (N timing owned
by one agent) and under-irrigation in some seasons (water sized from crop water use and cost).

## Results

Smoke test (3 contrasting tune seasons):

| season | d1d_multi | d1c_multi | d0b_single | farmer practice | hindsight |
|---|---|---|---|---|---|
| 1998 (driest) | **511** (N 217, irr 323) | 361 (irr 280) | 435 | 377 | 432 |
| 1999 (median) | 1,717 (N 221, irr 151) | **1,802** | 1,728 | 1,293 | 1,517 |
| 1991 (wettest) | **1,448** (N 205, irr 7, leached 41.0) | 1,437 (leached 44.6) | 935 | 1,104 | 1,533 |
| mean | **1,225** | 1,200 | 1,032 | 925 | 1,161 |

0 fallbacks, ~200 model calls per season, ~12 min per season (GPU not shared). The Water agent irrigated more in
the driest season and beat hindsight there; wet-season leaching is barely changed.

## Held-out test (2010-2024, 15 seasons): ablation run; d1c_multi stays the final design

Decided before running: d1c_multi (frozen before any test run) remains the final design; d1d_multi is reported as an
ablation, so the test set is not used to choose between designs.

| | mean reward | vs farmer practice | fallbacks | irrigation mm | leached kg/ha |
|---|---|---|---|---|---|
| **d1d_multi** | **1,368** | +294 | 0 | 173 | 18.4 |
| d1c_multi (final) | 1,306 | +232 | 0 | 170 | 19.7 |
| d0b_single | 1,238 | +164 | 11 | 157 | 21.2 |
| farmer practice | 1,074 | | | 264 | 23.0 |
| hindsight | 1,265 | | | 124 | 12.9 |

d1d minus d1c: +62 USD/ha (95% CI +-81), d1d ahead in 11/15: splitting the Planner into independent Nitrogen and
Water agents (with the water-balance tool) points to a further gain, not yet statistically certain. Not run on dev.
