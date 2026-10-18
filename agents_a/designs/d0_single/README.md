# d0_single: one agent, all tools

**Role in the study:** the "one model" baseline the multi-agent team must beat (Multi-Agent track:
"many small models beating one big one"). Same model, same knowledge in the prompt, same tools.

**Design**
- One Nemotron agent per week. Input: system prompt (`prompts/system.md`: scoring, limits, agronomy facts) +
  a short season summary (week header + last 6 weeks from `get_history`).
- It calls read tools as it likes, then must call `submit_decision(n_kg_ha, irr_mm, reason)`.
- Code guard (`agents_a/common/guard.py`): clamp in code; two malformed turns in a row, no decision within
  8 model calls, or a model error -> that week uses the farmer-practice schedule, logged as `fallback`.
- Temperature 0, up to 4096 tokens per call (Nemotron reasons before answering).

**Hypothesis:** a single agent with weather access already avoids N before heavy rain, but it has no check
on agronomic mistakes (e.g. fertilizing during grain fill, when the crop cannot use N).

**First season (UFGA-1995):** reward 1,414 vs farmer practice 1,181 and hindsight 1,436 (gap closed 0.91);
59 model calls, 0 fallbacks, 4.6 min. Observed weakness: ~75 kg N applied during grain fill (weeks 12-15).

## Results (dev, 20 seasons): much worse than farmer practice

| | mean reward | grain kg/ha | N kg/ha | irrigation mm |
|---|---|---|---|---|
| **d0_single** | **660** | 6,195 | 276 (the 300 cap in 8 seasons) | 30-110 |
| farmer practice (`farmer_ufga`) | 1,117 | 7,815 | 116 | 264 |
| hindsight | 1,283 | 8,463 | 141 | 144 |

Wins against farmer practice in 2 of 20 seasons (1991, 1995: both wet). Gap closed -2.75. 0 fallbacks.
Full table: `results/summary.md`; season logs: `runs/a_d0_single/`.

**Diagnosis (UFGA-2006, a dry year: reward 366 vs 1,198):**
- Under-irrigation around silking: soil water 0.26-0.36 from week 6 to grain fill, irrigation only 10-25 mm per
  week. The prompt said to irrigate "below roughly 0.4" and gave no amounts; a full canopy here uses ~35-40 mm per
  week. Biomass was high (12.6 t/ha) but grain low (4,815 vs 8,072 kg/ha): water stress at silking kills kernels.
- Over-fertilizing: 300 kg N/ha (about $500/ha) in many seasons, versus 116 for farmer practice.
- The first test season (1995) was wet, so it hid the irrigation problem. Lesson: test new designs on a dry, a
  wet and an average season before a full run.
