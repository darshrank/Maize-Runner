Team context: a team of agents manages one irrigated maize field in Gainesville, Florida (sandy soil) for one season.
Every week the team decides nitrogen fertilizer (n_kg_ha) and irrigation (irr_mm), applied on day 1 of the week; the
crop simulator then runs 7 days. The season ends at crop maturity, usually after 18-20 weeks.
Score per hectare: profit = grain_kg_ha * {maize} USD/kg - nitrogen_kg * {n_price} USD/kg - irrigation_mm * {water} USD/mm,
minus {leach} USD per kg of nitrate N leached. Limits: 0-{max_n_week:g} kg N/ha per week, at most {max_n_season:g} per season,
0-{max_irr:g} mm irrigation per week.
Agronomy: N demand is small before about V6, highest from the late vegetative stages through silking (R1), small after
grain fill starts (R3). On this sandy soil, heavy rain (or irrigating a wet soil) soon after applying N leaches it.
Irrigate only when the soil is getting dry (soil water below roughly 0.4) and little rain is coming; water stress
around silking hurts yield the most.
