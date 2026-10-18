# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev-check

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1c_multi | 5 | 1189.9 ± 363.6 | 1253.5 ± 311.6 | 8887.4 ± 1814.1 | 220.4 ± 5.1 | 26.0 ± 22.9 | 1.20 | +22% |
| farmer | 5 | 831.7 ± 310.7 | 887.9 ± 289.8 | 6283.9 ± 1597.3 | 160.0 ± 0.0 | 23.0 ± 23.4 | -1.66 | +8% |
| farmer_ufga (farmer practice) | 5 | 1039.7 ± 188.0 | 1091.7 ± 159.5 | 7427.2 ± 826.6 | 116.0 ± 0.0 | 21.3 ± 13.3 | 0.00 | +0% |
| no_n | 5 | 151.0 ± 38.4 | 180.2 ± 27.0 | 933.8 ± 139.8 | 0.0 ± 0.0 | 12.0 ± 11.2 | -7.09 | -44% |
| hindsight (unreachable ceiling) | 5 | 1165.0 ± 189.4 | 1211.9 ± 149.5 | 7860.2 ± 788.9 | 135.2 ± 31.8 | 19.2 ± 21.8 | 1.00 | -10% |

## Split: dev-tune

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1c_multi | 15 | 1402.9 ± 172.4 | 1442.6 ± 179.8 | 9732.2 ± 877.1 | 205.8 ± 11.9 | 16.3 ± 7.1 | 1.45 | -19% |
| farmer | 15 | 1088.2 ± 128.3 | 1122.6 ± 137.2 | 7524.5 ± 653.4 | 160.0 ± 0.0 | 14.1 ± 7.9 | -0.30 | -30% |
| farmer_ufga (farmer practice) | 15 | 1142.4 ± 126.3 | 1191.5 ± 129.1 | 7944.1 ± 669.0 | 116.0 ± 0.0 | 20.1 ± 5.8 | 0.00 | +0% |
| no_n | 15 | 153.1 ± 40.1 | 175.6 ± 39.7 | 909.6 ± 205.7 | 0.0 ± 0.0 | 9.2 ± 4.0 | -5.50 | -54% |
| hindsight (unreachable ceiling) | 15 | 1322.2 ± 139.3 | 1352.9 ± 143.9 | 8664.5 ± 731.2 | 143.2 ± 18.7 | 12.6 ± 5.6 | 1.00 | -37% |

## Split: test

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1c_multi | 15 | 1306.3 ± 186.5 | 1354.3 ± 191.1 | 9270.6 ± 942.5 | 204.1 ± 10.3 | 19.7 ± 8.2 | 1.21 | -15% |
| farmer | 15 | 1096.2 ± 140.0 | 1131.1 ± 142.6 | 7563.6 ± 719.3 | 160.0 ± 0.0 | 14.3 ± 6.8 | 0.12 | -38% |
| farmer_ufga (farmer practice) | 15 | 1074.1 ± 107.7 | 1130.4 ± 114.1 | 7627.4 ± 591.3 | 116.0 ± 0.0 | 23.0 ± 5.6 | 0.00 | +0% |
| no_n | 15 | 198.7 ± 40.4 | 221.3 ± 41.8 | 1146.8 ± 216.8 | 0.0 ± 0.0 | 9.3 ± 3.6 | -4.58 | -60% |
| hindsight (unreachable ceiling) | 15 | 1265.2 ± 137.2 | 1296.7 ± 141.5 | 8250.1 ± 784.3 | 135.7 ± 15.0 | 12.9 ± 4.9 | 1.00 | -44% |

## Split: tift_test

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1c_multi | 15 | 1297.3 ± 187.8 | 1341.1 ± 192.8 | 9181.6 ± 958.1 | 206.1 ± 8.3 | 17.9 ± 6.2 | 1.13 | -18% |
| farmer | 15 | 1137.2 ± 170.6 | 1174.9 ± 169.4 | 7751.6 ± 834.3 | 160.0 ± 0.0 | 15.4 ± 7.2 | 0.36 | -29% |
| farmer_ufga (farmer practice) | 15 | 1062.9 ± 92.4 | 1116.2 ± 96.5 | 7553.8 ± 499.9 | 116.0 ± 0.0 | 21.8 ± 4.1 | 0.00 | +0% |
| no_n | 15 | 173.6 ± 28.6 | 193.5 ± 28.5 | 1002.8 ± 147.5 | 0.0 ± 0.0 | 8.2 ± 2.9 | -4.28 | -63% |
| hindsight (unreachable ceiling) | 15 | 1270.8 ± 153.2 | 1305.1 ± 154.1 | 8471.2 ± 799.1 | 150.9 ± 16.3 | 14.0 ± 4.8 | 1.00 | -36% |
