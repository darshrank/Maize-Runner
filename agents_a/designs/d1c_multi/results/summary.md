# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev-tune

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1c_multi | 15 | 1402.9 ± 172.4 | 1442.6 ± 179.8 | 9732.2 ± 877.1 | 205.8 ± 11.9 | 16.3 ± 7.1 | 1.45 | -19% |
| farmer | 15 | 1088.2 ± 128.3 | 1122.6 ± 137.2 | 7524.5 ± 653.4 | 160.0 ± 0.0 | 14.1 ± 7.9 | -0.30 | -30% |
| farmer_ufga (farmer practice) | 15 | 1142.4 ± 126.3 | 1191.5 ± 129.1 | 7944.1 ± 669.0 | 116.0 ± 0.0 | 20.1 ± 5.8 | 0.00 | +0% |
| no_n | 15 | 153.1 ± 40.1 | 175.6 ± 39.7 | 909.6 ± 205.7 | 0.0 ± 0.0 | 9.2 ± 4.0 | -5.50 | -54% |
| hindsight (unreachable ceiling) | 15 | 1322.2 ± 139.3 | 1352.9 ± 143.9 | 8664.5 ± 731.2 | 143.2 ± 18.7 | 12.6 ± 5.6 | 1.00 | -37% |
