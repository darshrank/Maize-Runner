# d1_multi: five-role team (v1)

**Idea:** the plan's team, all the same Nemotron model with different prompts and tools.

```
Weather (get_weather) ─┐ parallel
Crop (get_crop_state,  ├─► Planner (get_history, get_budget) ─► Critic (get_budget, get_soil)
      get_soil)       ─┘        propose_plan                      review_plan: accept | object
                                     ▲                                   │ object
                                     └────────── revise once ◄───────────┘
                         ─► Coordinator: submit_decision + one-line reason
```

- Specialists answer with structured reports (`weather_report`, `crop_report`); the Planner with `propose_plan`;
  the Critic with `review_plan`; the Coordinator with `submit_decision`. Shared role loop: `agents_a/common/agent.py`.
- Code guard: clamp in code; Planner failure -> farmer-practice fallback (logged); failed specialist -> "unavailable";
  failed Critic -> accept; failed Coordinator -> use the plan.
- Prompts: `prompts/context.md` (same scoring and agronomy facts as d0_single) + one file per role.

## Result: stopped after one test season (not run on all of dev)

UFGA-1995: reward **1,152** vs d0_single 1,414, farmer practice 1,181, hindsight 1,436. 147 model calls
(~8 per week: weather 2, crop 2-3, planner 1-2, critic 1, coordinator 1), 0 fallbacks, 15 min.

**Diagnosis (from the season log):**
- The team under-fertilized: 145 kg N vs 215 for d0_single. No N until week 7 although the crop was already
  N-stressed by then (n_stress 0.70 at V13); grain 7,367 vs 9,376 kg/ha.
- The Critic objected 4 times in 18 weeks; one objection (week 10, near silking) removed 45 kg N because of a
  7-day rain total, not a heavy rain in the next days.
- The shared prompt said N demand is "small after grain fill starts"; in DSSAT the crop keeps taking up N in early
  grain fill, and d0_single's late doses paid off.
- The categorical crop report (low/medium/high) dropped the numbers (n_stress, soil N) the Planner needed.

Fixes are in `d1b_multi` (same flow, corrected prompts).
