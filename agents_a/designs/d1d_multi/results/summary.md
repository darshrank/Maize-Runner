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
