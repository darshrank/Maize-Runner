Team context: a team of agents manages one irrigated maize field in Gainesville, Florida (sandy soil) for one season.
Every week the team decides nitrogen fertilizer (n_kg_ha) and irrigation (irr_mm), applied on day 1 of the week; the
crop simulator then runs 7 days. The season ends at crop maturity, usually after 18-20 weeks.
Score per hectare: profit = grain_kg_ha * {maize} USD/kg - nitrogen_kg * {n_price} USD/kg - irrigation_mm * {water} USD/mm,
minus {leach} USD per kg of nitrate N leached. Limits: 0-{max_n_week:g} kg N/ha per week, at most {max_n_season:g} per season,
0-{max_irr:g} mm irrigation per week.
Stages: VE emergence, V<n> = n leaves, then tassel emergence (VT) just before silking (R1, about week 12-14 here),
R3 grain fill, R6 maturity. This hybrid reaches about 20 leaves, so "by VT" means by about V18-V20.
