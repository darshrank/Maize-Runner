# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| farmer | 20 | 1024.0 ± 129.1 | 1063.9 ± 130.0 | 7214.4 ± 654.6 | 160.0 ± 0.0 | 16.3 ± 8.2 | -0.56 | -20% |
| farmer_ufga (farmer practice) | 20 | 1116.7 ± 105.2 | 1166.6 ± 104.5 | 7814.9 ± 541.7 | 116.0 ± 0.0 | 20.4 ± 5.3 | 0.00 | +0% |
| no_n | 20 | 152.5 ± 31.1 | 176.7 ± 30.2 | 915.7 ± 156.3 | 0.0 ± 0.0 | 9.9 ± 4.0 | -5.80 | -51% |
| hindsight (unreachable ceiling) | 20 | 1282.9 ± 116.4 | 1317.7 ± 115.6 | 8463.4 ± 593.9 | 141.2 ± 15.8 | 14.2 ± 6.6 | 1.00 | -30% |

## Split: test

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| farmer | 15 | 1096.2 ± 140.0 | 1131.1 ± 142.6 | 7563.6 ± 719.3 | 160.0 ± 0.0 | 14.3 ± 6.8 | 0.12 | -38% |
| farmer_ufga (farmer practice) | 15 | 1074.1 ± 107.7 | 1130.4 ± 114.1 | 7627.4 ± 591.3 | 116.0 ± 0.0 | 23.0 ± 5.6 | 0.00 | +0% |
| no_n | 15 | 198.7 ± 40.4 | 221.3 ± 41.8 | 1146.8 ± 216.8 | 0.0 ± 0.0 | 9.3 ± 3.6 | -4.58 | -60% |
| hindsight (unreachable ceiling) | 15 | 1265.2 ± 137.2 | 1296.7 ± 141.5 | 8250.1 ± 784.3 | 135.7 ± 15.0 | 12.9 ± 4.9 | 1.00 | -44% |
