# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d1b_multi | 1 | 1206.0 ± 0.0 | 1242.7 ± 0.0 | 9311.8 ± 0.0 | 300.0 ± 0.0 | 15.0 ± 0.0 | 0.10 | -31% |
| farmer | 1 | 1359.2 ± 0.0 | 1384.5 ± 0.0 | 8842.3 ± 0.0 | 160.0 ± 0.0 | 10.3 ± 0.0 | 0.70 | -52% |
| farmer_ufga (farmer practice) | 1 | 1180.6 ± 0.0 | 1233.5 ± 0.0 | 8161.6 ± 0.0 | 116.0 ± 0.0 | 21.7 ± 0.0 | 0.00 | +0% |
| no_n | 1 | 219.6 ± 0.0 | 235.6 ± 0.0 | 1220.7 ± 0.0 | 0.0 ± 0.0 | 6.5 ± 0.0 | -3.76 | -70% |
| hindsight (unreachable ceiling) | 1 | 1436.2 ± 0.0 | 1469.2 ± 0.0 | 9969.5 ± 0.0 | 240.0 ± 0.0 | 13.5 ± 0.0 | 1.00 | -38% |
