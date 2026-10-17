# d1b_multi: d1_multi with corrected prompts

**Same flow and code as `d1_multi`** (`policy.py` only points at this folder's prompts). What changed, from the
d1_multi diagnosis on UFGA-1995 (a dev season):

| prompt | change | why |
|---|---|---|
| `context.md` | adds the economics (N shortage costs far more than leaching), says N uptake continues in early grain fill, and that n_stress below ~0.9 means the crop needs N; heavy rain = ~25 mm within 3 days -> delay or split, don't starve | the team skipped N while the crop was already N-stressed |
| `crop.md` | N need from n_stress as well as stage; the summary must carry the numbers (n_stress, water_stress, soil water, soil N) | categorical reports hid the numbers the Planner needed |
| `critic.md` | object to N only for heavy rain within 3 days; never ask to skip N when the crop is short of N; weekly totals alone are no reason | one objection cut 45 kg N before silking over a 7-day total |
| `planner.md` | keep the crop out of N stress from ~V8 through early grain fill with moderate weekly doses, timed around heavy rain | too cautious |

Unchanged: `weather.md`, `coordinator.md`.

Note: these are corrections to the shared facts, so the next single-agent baseline (d0b) gets the same corrected
facts, to keep the single-vs-team comparison fair.

## Results

Test season only (UFGA-1995, a wet year): reward **1,206** vs d1_multi 1,152, farmer practice 1,181, hindsight 1,436
(gap closed 0.10). Grain recovered (9,312 vs 7,367 kg/ha) but N overshot to the 300 kg/ha cap; irrigation 100 mm;
151 model calls, 0 fallbacks, 20 min. Not run on all of dev: d0_single's full dev run showed the shared facts also
miss irrigation amounts in dry years (see d0_single/README.md), so the next version fixes water and N totals first.
