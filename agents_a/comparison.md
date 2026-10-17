# Agent designs vs baselines

Farmer practice = `farmer_ufga`. Baselines are averaged over the same seasons as each design.

| design | subset | seasons | reward | farmer practice | hindsight | gap closed | wins vs farmer | N kg/ha | irrigation mm | leached kg/ha | fallbacks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d0_single | dev-tune | 15 | 686 | 1142 | 1322 | -2.54 | 2/15 | 270 | 64 | 12.8 | 0 |
| d0_single | dev-check | 5 | 580 | 1040 | 1165 | -3.67 | 0/5 | 295 | 77 | 25.9 | 0 |
| d1_multi | dev-tune | 1 | 1152 | 1181 | 1436 | -0.11 | 0/1 | 145 | 30 | 4.9 | 0 |
| d1b_multi | dev-tune | 1 | 1206 | 1181 | 1436 | 0.10 | 1/1 | 300 | 100 | 15.0 | 0 |
