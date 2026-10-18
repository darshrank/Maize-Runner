# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev-check

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d0b_single | 5 | 1069.5 ± 392.6 | 1151.8 ± 326.2 | 8541.2 ± 1873.5 | 243.6 ± 32.4 | 33.7 ± 32.2 | 0.24 | +58% |
| farmer | 5 | 831.7 ± 310.7 | 887.9 ± 289.8 | 6283.9 ± 1597.3 | 160.0 ± 0.0 | 23.0 ± 23.4 | -1.66 | +8% |
| farmer_ufga (farmer practice) | 5 | 1039.7 ± 188.0 | 1091.7 ± 159.5 | 7427.2 ± 826.6 | 116.0 ± 0.0 | 21.3 ± 13.3 | 0.00 | +0% |
| no_n | 5 | 151.0 ± 38.4 | 180.2 ± 27.0 | 933.8 ± 139.8 | 0.0 ± 0.0 | 12.0 ± 11.2 | -7.09 | -44% |
| hindsight (unreachable ceiling) | 5 | 1165.0 ± 189.4 | 1211.9 ± 149.5 | 7860.2 ± 788.9 | 135.2 ± 31.8 | 19.2 ± 21.8 | 1.00 | -10% |

## Split: dev-tune

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d0b_single | 15 | 1395.8 ± 183.0 | 1443.2 ± 178.0 | 9832.3 ± 923.3 | 217.3 ± 10.0 | 19.4 ± 9.6 | 1.41 | -3% |
| farmer | 15 | 1088.2 ± 128.3 | 1122.6 ± 137.2 | 7524.5 ± 653.4 | 160.0 ± 0.0 | 14.1 ± 7.9 | -0.30 | -30% |
| farmer_ufga (farmer practice) | 15 | 1142.4 ± 126.3 | 1191.5 ± 129.1 | 7944.1 ± 669.0 | 116.0 ± 0.0 | 20.1 ± 5.8 | 0.00 | +0% |
| no_n | 15 | 153.1 ± 40.1 | 175.6 ± 39.7 | 909.6 ± 205.7 | 0.0 ± 0.0 | 9.2 ± 4.0 | -5.50 | -54% |
| hindsight (unreachable ceiling) | 15 | 1322.2 ± 139.3 | 1352.9 ± 143.9 | 8664.5 ± 731.2 | 143.2 ± 18.7 | 12.6 ± 5.6 | 1.00 | -37% |

## Split: test

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d0b_single | 15 | 1238.0 ± 180.0 | 1289.8 ± 187.8 | 8965.4 ± 967.8 | 212.1 ± 10.8 | 21.2 ± 10.6 | 0.86 | -8% |
| farmer | 15 | 1096.2 ± 140.0 | 1131.1 ± 142.6 | 7563.6 ± 719.3 | 160.0 ± 0.0 | 14.3 ± 6.8 | 0.12 | -38% |
| farmer_ufga (farmer practice) | 15 | 1074.1 ± 107.7 | 1130.4 ± 114.1 | 7627.4 ± 591.3 | 116.0 ± 0.0 | 23.0 ± 5.6 | 0.00 | +0% |
| no_n | 15 | 198.7 ± 40.4 | 221.3 ± 41.8 | 1146.8 ± 216.8 | 0.0 ± 0.0 | 9.3 ± 3.6 | -4.58 | -60% |
| hindsight (unreachable ceiling) | 15 | 1265.2 ± 137.2 | 1296.7 ± 141.5 | 8250.1 ± 784.3 | 135.7 ± 15.0 | 12.9 ± 4.9 | 1.00 | -44% |
