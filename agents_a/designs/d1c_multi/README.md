# d1c_multi: five-role team + sourced agronomy

Full architecture (flow, agents, guards, measured cost): [ARCHITECTURE.md](ARCHITECTURE.md).

**Same flow and code as `d1_multi`** (Weather + Crop in parallel -> Planner -> Critic -> revise once -> Coordinator).
What changed: every role now gets the sourced agronomy (`agents_a/common/agronomy.md`: UF/IFAS corn N rate and
splitting, seasonal and peak water use), and the role prompts follow it:

| prompt | change vs d1b_multi |
|---|---|
| `context.md` | scoring and limits only; stage names explained ("by VT" = about V18-V20 for this hybrid) |
| (all roles) | + `common/agronomy.md`, inserted between the team context and the role instructions |
| `crop.md` | N need is "none" from VT on; soil "dry" below 0.5 (was 0.4); summary includes N applied so far |
| `planner.md` | season N total ~220-230 kg/ha in small doses, none after VT; irrigation sized to crop water use (35-50 mm at peak minus expected rain) when soil water < 0.5 from late vegetative stages through grain fill |
| `critic.md` | objects to N after VT or above ~230 kg/ha total, >60 kg in one week, N before heavy rain (split/delay, never starve), **under-irrigation**, irrigating a wet soil or before rain |

Unchanged: `weather.md`, `coordinator.md`. All agronomy numbers come from published guidance, not from our
dev results (see the generalization rules in `agents_a/README.md`).

## Smoke test: 3 contrasting tune seasons

| season | d1c_multi | d0_single | farmer practice | hindsight |
|---|---|---|---|---|
| UFGA-1998 (driest, 303 mm in-season rain) | 361 (N 220, irr 280) | -273 | 377 | 432 |
| UFGA-1999 (median, 449 mm) | **1,802** (N 207, irr 140) | 898 | 1,293 | 1,517 |
| UFGA-1991 (wettest, 829 mm) | 1,437 (N 200, irr 20) | 1,535 | 1,104 | 1,533 |
| mean | **1,200** | 720 | 925 | 1,161 |

0 fallbacks; ~160 model calls and ~20 min per season (GPU shared with B). Above hindsight on average: hindsight
picks one fixed plan per season, while the team adapts week by week. Weak spot: 44.6 kg N/ha leached in wet 1991.

## Results (dev-tune, 15 seasons): beats farmer practice and the fixed-plan ceiling

| | mean reward | gap closed | wins vs farmer practice | N kg/ha | irrigation mm | leached kg/ha | fallbacks |
|---|---|---|---|---|---|---|---|
| **d1c_multi** | **1,403** | **1.45** | 13/15 | 206 | 166 | 16.3 | 0 |
| d0_single (first prompt) | 686 | -2.54 | 2/15 | 270 | 64 | 12.8 | 0 |
| farmer practice (`farmer_ufga`) | 1,142 | 0.00 | | 116 | 264 | | |
| hindsight (best fixed plan) | 1,322 | 1.00 | | | | | |

Losses vs farmer practice: 1990 (1,222 vs 1,296) and 1998 (361 vs 377, the driest season). ~37% less water than
farmer practice. Weak spot: leaching in wet seasons (1991: 44.6, 1996: 43.0 kg N/ha).
Note: d0_single used the first prompt; the fair single-agent comparison (same sourced agronomy) is d0b_single.

## Results (dev-check, 5 seasons, not used for tuning): generalizes

| season | d1c_multi | d0_single | farmer practice | hindsight |
|---|---|---|---|---|
| 2005 | 703 (leached 55.8, irr 35) | 500 | 886 | 914 |
| 2006 | **1,468** | 366 | 1,198 | 1,198 |
| 2007 | **1,643** | 748 | 1,264 | 1,446 |
| 2008 | **1,330** | 643 | 1,098 | 1,278 |
| 2009 | **805** | 642 | 754 | 990 |
| **mean** | **1,190** | 580 | 1,040 | 1,165 |

Gap closed 1.20 (tune: 1.45), 4/5 wins, N 220, irrigation 170 mm, 0 fallbacks. Slightly lower than on tune, as
expected for unseen seasons, still above farmer practice and the fixed-plan ceiling. The loss (2005) is the known
weak spot: leaching in wet seasons (55.8 kg N/ha).

## Final result: held-out test (2010-2024, 15 seasons, run once; frozen at commit 48343d5)

| | mean reward | gap closed | wins vs farmer practice | N kg/ha | irrigation mm | leached kg/ha | fallbacks |
|---|---|---|---|---|---|---|---|
| **d1c_multi** | **1,306** | **1.21** | **12/15** | 204 | 170 | 19.7 | 0 |
| farmer practice (`farmer_ufga`) | 1,074 | 0.00 | | 116 | 264 | 23.0 | |
| farmer split (`farmer`) | 1,096 | | | 160 | | | |
| hindsight (best fixed plan) | 1,265 | 1.00 | | | 124 | 12.9 | |

Paired difference vs farmer practice: **+232 USD/ha, 95% CI +-117**. 36% less water and 14% less N leached than
farmer practice. Losses: 2010 (902 vs 1,177, under-irrigated), 2016 (1,093 vs 1,115), 2019 (947 vs 965).
Test (gap closed 1.21) matches dev-check (1.20): the design generalizes. Per-season rows: `results/eval.csv`.

## Second site: Tifton, GA (15 seasons 2010-2024, never used for tuning)

Frozen d1c_multi (same prompts as the A4 run) at Tifton: NASA POWER weather, planted Mar 15 (UGA Extension window),
same UFGA soil and hybrid ("the same field in another climate").

| | mean reward | gap closed | N kg/ha | irrigation mm | leached kg/ha | fallbacks |
|---|---|---|---|---|---|---|
| **d1c_multi** | **1,297** | **1.13** | 206 | 157 | 17.9 | 0 |
| farmer practice (`farmer_ufga`) | 1,063 | 0.00 | 116 | 264 | 21.8 | |
| farmer split (`farmer`, better locally) | 1,137 | | 160 | 98 | 15.4 | |
| hindsight (best fixed plan) | 1,271 | 1.00 | | 140 | 14.0 | |

vs farmer practice: +234 USD/ha (95% CI +-114), 12/15 wins; vs the 60/60/40 split: +160 USD/ha (+-120), 11/15 wins.
Losses vs farmer practice: 2019, 2022, 2024. Nearly the same margin as the Gainesville test (+232): the design
transfers to a new climate and planting date without retuning.
