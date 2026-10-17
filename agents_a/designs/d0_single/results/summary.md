# FieldTwin eval summary

Mean ± 95% CI (normal approx). Farmer practice = `farmer_ufga` (config.yaml eval.farmer_practice). gap closed = (reward - farmer practice) / (hindsight - farmer practice). Hindsight knows the future: it is an unreachable ceiling.

## Split: dev

| config | n | reward | profit_usd_ha | grain_kg_ha | n_applied | n_leached | gap closed | leaching vs farmer |
|---|---|---|---|---|---|---|---|---|
| a_d0_single | 20 | 659.8 ± 178.5 | 698.9 ± 180.5 | 6194.9 ± 850.4 | 276.2 ± 12.8 | 16.0 ± 9.2 | -2.75 | -22% |
| farmer | 20 | 1024.0 ± 129.1 | 1063.9 ± 130.0 | 7214.4 ± 654.6 | 160.0 ± 0.0 | 16.3 ± 8.2 | -0.56 | -20% |
| farmer_ufga (farmer practice) | 20 | 1116.7 ± 105.2 | 1166.6 ± 104.5 | 7814.9 ± 541.7 | 116.0 ± 0.0 | 20.4 ± 5.3 | 0.00 | +0% |
| no_n | 20 | 152.5 ± 31.1 | 176.7 ± 30.2 | 915.7 ± 156.3 | 0.0 ± 0.0 | 9.9 ± 4.0 | -5.80 | -51% |
| hindsight (unreachable ceiling) | 20 | 1282.9 ± 116.4 | 1317.7 ± 115.6 | 8463.4 ± 593.9 | 141.2 ± 15.8 | 14.2 ± 6.6 | 1.00 | -30% |
