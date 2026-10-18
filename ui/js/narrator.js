// Narrator: one deadpan line per week for the Season view (main.js puts it on that week's card in the week-card
// carousel, carousel.js; key N toggles the cards). The sarcasm targets weather, corn and nitrogen, never people.
//
// Every value in a line comes from the two runs on screen (data.js weeks model) or the weather file; a trigger
// fires only when its data is there. One trigger per week, first match in this order:
//   harvest     the final week, both runs have final.profit_usd_ha: compare the two fields. The pool follows the
//               sign of right minus left (rounded to whole dollars): harvestRight when the right field earned more,
//               harvestLeft when it earned less, harvestTie when equal. No line assumes which side wins.
//   fallback    a run logged a fallback this week
//   doseRain    a run applied N this week (decision.n_kg_ha > 0) and a day of this week has >= HEAVY_MM of rain
//               (weather file aligned to week 0); {when} counts days from the week's start, when the decision
//               applies
//   leach       weekly.n_leached >= LEACH_KG in a run (the larger one)
//   storm       weekly.rain_mm > theme.stormMm
//   dry         the weather file shows DRY_DAYS or more consecutive days under DRY_MM ending this week
//   lowWater    obs.soil_water_frac under theme.three.thirst.start in a run (the lower one)
//   objection   the Critic objected this week (critic message objection: true)
//   quiet       no N applied in either run and weekly rain under QUIET_MM ({week} is 1-based: week index + 1)
// The line is picked deterministically from task_id + week: (FNV-1a(task_id) + week) mod the template count, so a
// replay is reproducible and back-to-back weeks with the same trigger never repeat a line. Templates whose
// placeholders have no value are skipped. Week cards need a line every week: weekLine() falls back to a quiet-week
// line from LINES.quietAny (no claims about rain or nitrogen) when no trigger fires.

const LEACH_KG = 3.0;
const HEAVY_MM = 25;
const DRY_MM = 1.0;
const DRY_DAYS = 10;
const QUIET_MM = 5;

export const LINES = {
  quiet: [
    "Week {week}. Nothing happened. The corn appreciates the quiet.",
    "Week {week}. No nitrogen, {rain} mm of rain. The corn is doing its best impression of a lawn.",
    "No fertilizer this week. The nitrogen is enjoying its time off.",
    "{rain} mm of rain all week. The clouds are pacing themselves.",
    "A quiet week. The corn kept its thoughts to itself.",
    "Week {week}. The weather took the week off. So did the nitrogen.",
    "Nothing to report. The soil is fine with that.",
  ],
  dry: [
    "{days} days without rain. The sky has left us on read.",
    "Day {days} of no rain. The clouds are clearly busy elsewhere.",
    "{days} dry days in a row. The forecast has stopped pretending.",
    "{days} days since the last real rain. The corn has started a support group.",
    "{days} days, no rain. The soil is learning patience the hard way.",
    "Still dry. {days} days and counting. The sky is committed to the bit.",
  ],
  lowWater: [
    "Soil water down to {swf}%. The corn would like a word with the sky.",
    "{swf}% soil water. The roots are reaching for anything.",
    "Soil water at {swf}%. The corn is reconsidering its life choices.",
    "{swf}% soil water. The corn is rationing. Nobody told the sun.",
    "The soil is at {swf}% water. The ground is technically still ground.",
    "{swf}% soil water. Thirsty corn, indifferent sky.",
  ],
  storm: [
    "{rain} mm of rain this week. The sky is making up for lost time.",
    "{rain} mm in one week. The clouds did not read the forecast.",
    "Storm week. {rain} mm of rain, all of it with opinions.",
    "{rain} mm of rain. The corn is holding on and pretending this is fine.",
    "{rain} mm fell this week. Subtlety is not the weather's strength.",
    "A {rain} mm week. The soil is full. The rain keeps going anyway.",
  ],
  doseRain: [
    "{n} kg of nitrogen, {when} {rain} mm of rain. The groundwater says thanks.",
    "{n} kg of nitrogen went down {when} {rain} mm of rain. Bold timing.",
    "{n} kg of nitrogen, {when} {rain} mm of rain. The nitrogen packed for a trip.",
    "{n} kg of nitrogen, {when} {rain} mm of rain. The aquifer appreciates the gesture.",
    "{n} kg of nitrogen, {when} {rain} mm of rain. The rain had other plans for it.",
    "{n} kg of nitrogen, {when} {rain} mm of rain. Nitrogen, meet drainage.",
  ],
  leach: [
    "{leached} kg of nitrogen left through the bottom this week. It did not say goodbye.",
    "{leached} kg of nitrogen headed for the groundwater. Fully committed.",
    "{leached} kg of nitrogen leached this week. The groundwater is collecting a set.",
    "{leached} kg of nitrogen leached. {total} kg so far. The aquifer is keeping score.",
    "{leached} kg of nitrogen took the stairs down. The corn never saw it.",
    "The soil lost {leached} kg of nitrogen this week. The roots were right there.",
  ],
  objection: [
    "The Critic objected. The nitrogen waited for a verdict.",
    "Objection from the Critic. The corn did not take sides.",
    "The Critic pushed back this week. The weather did not care either way.",
    "An objection. The plan got a second look. The soil just wants an answer.",
    "The Critic objected. Final call: {n} kg of nitrogen. The corn shrugged.",
    "The Critic raised a flag. The rain made no comment.",
  ],
  fallback: [
    "Fallback week. The corn did not notice.",
    "A fallback this week. The weather carried on regardless.",
    "Fallback this week. Plan B, same corn.",
    "Fallback week. The nitrogen followed the backup without complaint.",
    "Fallback engaged. The soil is unbothered.",
    "Fallback week. The corn has no opinion on the matter.",
  ],
  // Right field earned more.
  harvestRight: [
    "Harvest. {right} made {diff}/ha more than {left}. The corn is unmoved.",
    "Season over. {right} comes out {diff}/ha ahead. The weather takes no credit.",
    "Harvest. {lp} for {left}, {rp} for {right}. The corn has stopped growing to listen.",
    "That is the season. {right} ends {diff}/ha ahead. The nitrogen has no further comment.",
    "Harvest is in. {right} by {diff}/ha. The rain claims it was all part of the plan.",
    "Done. {right} leads by {diff}/ha. The soil would like a nap.",
  ],
  // Right field earned less.
  harvestLeft: [
    "Harvest. {right} made {diff}/ha less than {left}. The corn is unmoved.",
    "Season over. {left} comes out {diff}/ha ahead. The weather takes no credit.",
    "Harvest. {lp} for {left}, {rp} for {right}. The corn has stopped growing to listen.",
    "That is the season. {right} ends {diff}/ha behind. The nitrogen has no further comment.",
    "Harvest is in. {left} by {diff}/ha. The rain claims it was all part of the plan.",
    "Done. {left} leads by {diff}/ha. The soil would like a nap.",
  ],
  quietAny: [
    "Week {week}. Nothing worth a headline. The corn approves.",
    "A quiet week. The corn kept its thoughts to itself.",
    "Nothing to report. The soil is fine with that.",
    "Week {week}. The field minded its own business.",
    "Week {week}. No drama. The corn is working on it.",
    "An ordinary week. The corn took it in stride.",
  ],
  harvestTie: [
    "Harvest. Both fields at {lp}/ha. The corn refuses to pick a favorite.",
    "Season over. {lp}/ha each. The weather treated everyone the same, for once.",
    "Harvest. A dead heat at {lp}/ha. The nitrogen is unsure what it was for.",
  ],
};

const WORDS = ["the same day as", "one day before", "two days before", "three days before", "four days before",
  "five days before", "six days before"];

const has = (v) => typeof v === "number" && Number.isFinite(v);

// FNV-1a, 32 bit.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function amount(v) {
  const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return r.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function money(v) {
  return `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
}

function usable(template, vars) {
  return [...template.matchAll(/\{(\w+)\}/g)].every((m) => vars[m[1]] !== undefined && vars[m[1]] !== null);
}

// One line for this trigger, picked by task_id + week.
function pick(trigger, vars, task, k) {
  const pool = LINES[trigger].filter((t) => usable(t, vars));
  return pool.length ? fill(pool[(hash(task) + k) % pool.length], vars) : null;
}

// ctx: {task, k, W (harvest week), runs: {left, right}, names: {left, right}, days, dayStart, stormMm, thirstAt}
// Returns {trigger, text, side} (side: the field the line is about, or null) or null for no line.
export function narrate(ctx) {
  const { task, k, W, runs, names, days, dayStart, stormMm, thirstAt } = ctx;
  const sides = ["left", "right"].filter((s) => runs[s]);
  if (!sides.length) return null;
  const week = (s) => (k < runs[s].W ? runs[s].weeks[k] : null);
  const line = (trigger, vars, side = null) => {
    const text = pick(trigger, vars, task, k);
    return text ? { trigger, text, side } : null;
  };

  if (k >= W) {
    const l = runs.left && runs.left.final, r = runs.right && runs.right.final;
    if (!l || !r || !has(l.profit_usd_ha) || !has(r.profit_usd_ha)) return null;
    const lp = l.profit_usd_ha, rp = r.profit_usd_ha, gap = Math.round(rp - lp);
    const vars = { left: names.left, right: names.right, lp: money(lp), rp: money(rp), diff: money(Math.abs(rp - lp)) };
    return line(gap === 0 ? "harvestTie" : gap > 0 ? "harvestRight" : "harvestLeft", vars);
  }

  const weeks = Object.fromEntries(sides.map((s) => [s, week(s)]));
  const live = sides.filter((s) => weeks[s]);
  if (!live.length) return null;
  const nOf = (s) => (weeks[s] && weeks[s].decision && has(weeks[s].decision.n_kg_ha) ? weeks[s].decision.n_kg_ha : null);
  const wk = (s, key) => (weeks[s] && weeks[s].weekly && has(weeks[s].weekly[key]) ? weeks[s].weekly[key] : null);
  const most = (list, f) => list.filter((s) => f(s) !== null).sort((a, b) => f(b) - f(a))[0] || null;

  const fb = live.find((s) => weeks[s].fallback);
  if (fb) return line("fallback", { count: weeks[fb].fallbacks.length }, fb);

  const aligned = days && dayStart !== null && dayStart !== undefined;
  const d0 = aligned ? dayStart + 7 * k : null;
  if (aligned) {
    let heavy = null;
    for (let i = 0; i < 7; i++) {
      const d = days[d0 + i];
      if (d && has(d.rain_mm) && d.rain_mm >= HEAVY_MM) { heavy = { gap: i, rain: d.rain_mm }; break; }
    }
    const dside = most(live, (s) => (nOf(s) > 0 ? nOf(s) : null));
    if (heavy && dside) {
      return line("doseRain", { n: amount(nOf(dside)), rain: amount(heavy.rain), when: WORDS[heavy.gap] }, dside);
    }
  }

  const lside = most(live, (s) => wk(s, "n_leached"));
  if (lside && wk(lside, "n_leached") >= LEACH_KG) {
    const total = weeks[lside].cum && has(weeks[lside].cum.nLeached) ? amount(weeks[lside].cum.nLeached) : null;
    return line("leach", { leached: amount(wk(lside, "n_leached")), total }, lside);
  }

  const rain = live.map((s) => wk(s, "rain_mm")).find((v) => v !== null) ?? null;
  if (rain !== null && rain > stormMm) return line("storm", { rain: amount(rain) });

  if (aligned && days[d0 + 6]) {
    let streak = 0;
    for (let i = d0 + 6; i >= 0 && days[i] && has(days[i].rain_mm) && days[i].rain_mm < DRY_MM; i--) streak++;
    if (streak >= DRY_DAYS) return line("dry", { days: streak });
  }

  const swf = (s) => (weeks[s].obs && has(weeks[s].obs.soil_water_frac) ? -weeks[s].obs.soil_water_frac : null);
  const wside = most(live, swf);
  if (wside && -swf(wside) < thirstAt) return line("lowWater", { swf: Math.round(-swf(wside) * 100) }, wside);

  const oside = live.find((s) => weeks[s].objection);
  if (oside) return line("objection", { n: nOf(oside) !== null ? amount(nOf(oside)) : null }, oside);

  if (rain !== null && rain < QUIET_MM && live.every((s) => !(nOf(s) > 0))) return line("quiet", { week: k + 1, rain: amount(rain) });
  return null;
}

// Always a line: the trigger's line, else a quiet-week line (harvest without both finals included).
export function weekLine(ctx) {
  return narrate(ctx) || { trigger: "quiet", text: pick("quietAny", { week: ctx.k < ctx.W ? ctx.k + 1 : null }, ctx.task, ctx.k), side: null };
}
