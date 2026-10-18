# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev-tune

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1d_multi | 3 | 1225.1 ± 716.5 | 1274.2 ± 738.4 | 8915.1 ± 3412.7 | 214.3 ± 9.4 | 20.1 ± 20.6 | 1.27 | -18% |
| farmer | 3 | 916.0 ± 499.8 | 968.4 ± 537.5 | 6686.7 ± 2424.7 | 160.0 ± 0.0 | 21.5 ± 26.7 | -0.04 | -12% |
| farmer_ufga (farmer practice) | 3 | 924.8 ± 547.1 | 984.4 ± 582.0 | 6871.2 ± 3015.8 | 116.0 ± 0.0 | 24.4 ± 21.6 | 0.00 | +0% |
| no_n | 3 | 188.4 ± 138.3 | 215.8 ± 152.5 | 1118.0 ± 790.4 | 0.0 ± 0.0 | 11.2 ± 10.9 | -3.12 | -54% |
| hindsight (unreachable ceiling) | 3 | 1160.7 ± 713.9 | 1194.9 ± 730.7 | 7704.0 ± 3539.4 | 133.3 ± 26.1 | 14.0 ± 11.6 | 1.00 | -43% |

## Split: test

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1d_multi | 15 | 1367.8 ± 175.7 | 1412.7 ± 181.5 | 9643.3 ± 918.6 | 211.2 ± 8.1 | 18.4 ± 7.7 | 1.54 | -20% |
| farmer | 15 | 1096.2 ± 140.0 | 1131.1 ± 142.6 | 7563.6 ± 719.3 | 160.0 ± 0.0 | 14.3 ± 6.8 | 0.12 | -38% |
| farmer_ufga (farmer practice) | 15 | 1074.1 ± 107.7 | 1130.4 ± 114.1 | 7627.4 ± 591.3 | 116.0 ± 0.0 | 23.0 ± 5.6 | 0.00 | +0% |
| no_n | 15 | 198.7 ± 40.4 | 221.3 ± 41.8 | 1146.8 ± 216.8 | 0.0 ± 0.0 | 9.3 ± 3.6 | -4.58 | -60% |
| hindsight (unreachable ceiling) | 15 | 1265.2 ± 137.2 | 1296.7 ± 141.5 | 8250.1 ± 784.3 | 135.7 ± 15.0 | 12.9 ± 4.9 | 1.00 | -44% |
