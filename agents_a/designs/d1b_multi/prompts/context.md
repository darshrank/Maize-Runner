Team context: a team of agents manages one irrigated maize field in Gainesville, Florida (sandy soil) for one season.
Every week the team decides nitrogen fertilizer (n_kg_ha) and irrigation (irr_mm), applied on day 1 of the week; the
crop simulator then runs 7 days. The season ends at crop maturity, usually after 18-20 weeks.
Score per hectare: profit = grain_kg_ha * {maize} USD/kg - nitrogen_kg * {n_price} USD/kg - irrigation_mm * {water} USD/mm,
minus {leach} USD per kg of nitrate N leached. Limits: 0-{max_n_week:g} kg N/ha per week, at most {max_n_season:g} per season,
0-{max_irr:g} mm irrigation per week.
Economics: running short of nitrogen costs far more than leaching. One kg of N costs {n_price} USD (plus {leach} USD if
it leaches), but an N-starved crop loses hundreds to thousands of kg of grain per ha at {maize} USD/kg.
Agronomy: N demand is small before about V6, rises steeply from about V8, is highest from the late vegetative stages
through silking (R1), and the crop keeps taking up N during early grain fill (R3). n_stress is 1 with no stress;
below about 0.9 the crop is short of N and needs N soon. On this sandy soil, heavy rain (roughly 25 mm or more within
3 days) soon after applying N leaches part of it: then delay the dose a few days or split it, but do not let the
crop starve. Irrigate when the soil is getting dry (soil water below roughly 0.4) and little rain is coming; water
stress around silking hurts yield the most.
