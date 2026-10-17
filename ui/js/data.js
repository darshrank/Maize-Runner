// Loaders and the log -> weeks model (UI_SPEC.md section 3). Everything else in the UI reads these structures.
//
// ?fake=1 reads ui/fake/ (written by `uv run python -m lanec.scripts.fake_logs --ui`); otherwise the repo root:
// runs/, data/weather/, results/. A missing or broken file returns null; callers show a quiet placeholder.
//
// Parsing rules (STATE.md): the line-level week is the decision week (0..W-1); the final line sits at week W
// (harvest). A coordinator decision wins over the runner's policy/decision line. Critic messages are
// {text, objection}; other messages {text}; fallbacks {why} (UI_SPEC) or {text} (our earlier proposal).

const params = new URLSearchParams(location.search);
export const FAKE = params.get("fake") === "1";
export const LITE = params.get("lite") === "1";

const ROOT = FAKE ? "fake/" : "../";
export const paths = {
  index: `${ROOT}runs/index.json`,
  run: (config, task) => `${ROOT}runs/${config}/${task}.jsonl`,
  weather: (site, year) => `${ROOT}data/weather/${site}_${year}.json`,
  eval: `${ROOT}results/eval.csv`,
  iterations: `${ROOT}results/iterations.json`,
  vllm: `${ROOT}results/vllm_metrics.json`,
};

export const AGENTS = ["weather", "crop", "planner", "critic", "coordinator"];
export const AGENT_NAMES = { weather: "Weather", crop: "Crop", planner: "Planner", critic: "Critic", coordinator: "Coordinator" };
const CONFIG_NAMES = {
  farmer: "Farmer calendar", multi: "FieldTwin agent team", single: "Single agent", no_n: "No nitrogen",
  hindsight: "grid hindsight", multi_no_critic: "Team, no critic", multi_no_weather: "Team, no weather",
  multi_no_tools: "Team, no tools", fake_multi: "FieldTwin agent team",
};
const RIGHT_ORDER = ["multi", "single", "hindsight"];   // default for the right-hand (agent) side

// ---------------------------------------------------------------- fetch helpers

async function fetchText(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- configs and tasks

// Fake data never becomes a default real run: in real mode only runs/fake_* configs are fake.
export function isFakeConfig(config) {
  return FAKE || (typeof config === "string" && config.startsWith("fake_"));
}

export function configName(config) {
  return CONFIG_NAMES[config] || config;
}

export function parseTaskId(id) {
  const m = /^([A-Za-z0-9]+)-(\d{4})$/.exec(id || "");
  return m ? { site: m[1], year: +m[2] } : null;
}

export function sortTasks(index) {
  const tasks = [...new Set(Object.values(index || {}).flat())];
  return tasks.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

export function configsFor(index, task) {
  return Object.keys(index || {}).filter((c) => (index[c] || []).includes(task)).sort();
}

// Default pair for a task: LEFT farmer, RIGHT best agent run. In real mode fake_* configs are never defaults.
export function defaultPair(index, task) {
  const all = configsFor(index, task);
  const real = all.filter((c) => !c.startsWith("fake_"));
  const pool = FAKE ? all : real;
  const left = pool.includes("farmer") ? "farmer" : pool[0] || null;
  const rest = pool.filter((c) => c !== left);
  const right = RIGHT_ORDER.find((c) => rest.includes(c)) || rest[0] || null;
  return { left, right };
}

// First task that has both default sides, else the first task.
export function defaultTask(index) {
  const tasks = sortTasks(index);
  return tasks.find((t) => { const p = defaultPair(index, t); return p.left && p.right; }) || tasks[0] || null;
}

export async function loadIndex() {
  const index = await fetchJson(paths.index);
  return index && typeof index === "object" && !Array.isArray(index) ? index : null;
}

// ---------------------------------------------------------------- run log -> weeks model

export async function loadRun(config, task) {
  const text = await fetchText(paths.run(config, task));
  if (text === null) return null;
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch { /* skip a broken line; the validator reports it */ }
  }
  return events.length ? buildRun(config, task, events) : null;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function emptyWeek(week) {
  return { week, events: [], decision: null, policyDecision: null, chat: [], messages: {}, tools: [],
    fallbacks: [], objection: false, fallback: false, step: null, obs: null, weekly: null, clamped: false,
    cum: null, harvest: false };
}

export function buildRun(config, task, events) {
  const reset = events.find((e) => e.kind === "message" && e.data && e.data.reset);
  const meta = (reset && reset.data.task) || {};
  const finalEvent = events.find((e) => e.kind === "final");
  const maxWeek = Math.max(0, ...events.map((e) => (Number.isInteger(e.week) ? e.week : 0)));
  const W = finalEvent ? finalEvent.week : maxWeek + 1;   // decision weeks 0..W-1, harvest at W
  const weeks = Array.from({ length: W + 1 }, (_, k) => emptyWeek(k));
  const pending = {};   // tool_call by agent+name, waiting for its result

  for (const e of events) {
    if (!Number.isInteger(e.week) || e.week < 0 || e.week > W) continue;
    const w = weeks[e.week];
    const d = e.data || {};
    w.events.push(e);
    switch (e.kind) {
      case "step_result": w.step = d; break;
      case "decision":
        if (e.agent === "policy") w.policyDecision = d;
        else if (e.agent === "coordinator" || !w.decision) w.decision = d;
        break;
      case "fallback": w.fallbacks.push({ agent: e.agent, why: d.why || d.text || JSON.stringify(d) }); break;
      case "tool_call": {
        const call = { agent: e.agent, name: d.name, args: d.args, result: undefined };
        w.tools.push(call);
        pending[`${e.agent}:${d.name}`] = call;
        break;
      }
      case "tool_result": {
        const call = pending[`${e.agent}:${d.name}`];
        if (call) { call.result = d.result; delete pending[`${e.agent}:${d.name}`]; }
        else w.tools.push({ agent: e.agent, name: d.name, args: undefined, result: d.result });
        break;
      }
      case "message":
        if (d.reset || !AGENTS.includes(e.agent)) break;
        {
          const msg = { agent: e.agent, text: d.text || d.content || "", objection: e.agent === "critic" && d.objection === true, t: e.t };
          w.chat.push(msg);
          (w.messages[e.agent] = w.messages[e.agent] || []).push(msg);
        }
        break;
      default: break;
    }
  }

  // Cumulative values through each week. obs (end of the week) comes from step_result; harvest keeps the
  // last observed state and switches to the final line, which is authoritative.
  const final = finalEvent ? finalEvent.data : null;
  let last = null, leached = 0, rain = 0, uptake = 0;
  for (const w of weeks) {
    w.decision = w.decision || w.policyDecision;
    w.objection = w.chat.some((m) => m.objection);
    w.fallback = w.fallbacks.length > 0;
    if (w.step) {
      last = w.step.obs || last;
      w.weekly = w.step.weekly || null;
      w.clamped = w.step.clamped === true;
      leached += (w.weekly && num(w.weekly.n_leached)) || 0;
      rain += (w.weekly && num(w.weekly.rain_mm)) || 0;
      uptake += (w.weekly && num(w.weekly.n_uptake)) || 0;
    }
    w.obs = last;
    w.harvest = w.week === W && !!final;
    w.cum = last ? {
      nApplied: num(last.n_applied_total), irr: num(last.irr_total_mm), nLeached: leached, rain, nUptake: uptake,
    } : null;
    if (w.harvest) {
      w.cum = { nApplied: num(final.n_applied), irr: num(final.irr_mm), nLeached: num(final.n_leached),
        rain, nUptake: num(final.n_uptake) };
    }
  }

  const parsed = parseTaskId(task);
  return {
    config, task, W, weeks, final,
    site: meta.site || (parsed && parsed.site) || null,
    year: num(meta.year) || (parsed && parsed.year) || null,
    split: meta.split || null,
    fake: isFakeConfig(config),
    hasAgents: weeks.some((w) => w.chat.length > 0),
    fallbackWeeks: weeks.filter((w) => w.fallback).map((w) => w.week),
    objectionWeeks: weeks.filter((w) => w.objection).map((w) => w.week),
  };
}

// Data events for one week, in beat order, for the field ripples (field3d.js trigger()):
//   storm: weekly.rain_mm above stormMm; n: the chosen decision's n_kg_ha > 0; leach: weekly.n_leached > 0.05
// Amounts are the logged values. Harvest and missing weeks have no events.
export function weekEvents(run, k, stormMm) {
  const w = run && run.weeks[k];
  if (!w || w.harvest) return [];
  const events = [];
  const rain = w.weekly ? num(w.weekly.rain_mm) : null;
  const n = w.decision ? num(w.decision.n_kg_ha) : null;
  const leached = w.weekly ? num(w.weekly.n_leached) : null;
  if (rain !== null && rain > stormMm) events.push({ kind: "storm", amount: rain });
  if (n !== null && n > 0) events.push({ kind: "n", amount: n });
  if (leached !== null && leached > 0.05) events.push({ kind: "leach", amount: leached });
  return events;
}

// ---------------------------------------------------------------- weather

export async function loadWeather(site, year) {
  if (!site || !year) return null;
  const days = await fetchJson(paths.weather(site, year));
  return Array.isArray(days) && days.length ? days : null;
}

// Find where week 0 starts in the weather file by matching the log's weekly rain to 7-day sums, so the
// daily rain bars line up without assuming a planting date. The last week is skipped (the final step may
// run on to maturity). Same rule as lanec/scripts/validate_logs.py check_rain. Returns a day index or null.
export function alignSeason(run, days, tolMm = 0.5) {
  if (!run || !days) return null;
  const weekly = run.weeks.slice(0, run.W - 1).map((w) => (w.weekly ? num(w.weekly.rain_mm) : null));
  if (!weekly.length || weekly.some((v) => v === null)) return null;
  const rain = days.map((d) => num(d.rain_mm) || 0);
  for (let s = 0; s + 7 * weekly.length <= rain.length; s++) {
    let ok = true;
    for (let k = 0; ok && k < weekly.length; k++) {
      let sum = 0;
      for (let i = 0; i < 7; i++) sum += rain[s + 7 * k + i];
      ok = Math.abs(sum - weekly[k]) <= tolMm;
    }
    if (ok) return s;
  }
  return null;
}

// ---------------------------------------------------------------- results files

// eval.csv: leading "# ..." lines are comments (the FAKE marker). Numeric cells become numbers.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!lines.length) return [];
  const split = (l) => l.split(",").map((c) => c.trim());
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l), row = {};
    head.forEach((h, i) => {
      const v = cells[i];
      row[h] = v !== undefined && v !== "" && !Number.isNaN(Number(v)) && !["config", "task_id", "split"].includes(h) ? Number(v) : v;
    });
    return row;
  });
}

export async function loadEval() {
  const text = await fetchText(paths.eval);
  return text === null ? null : parseCsv(text);
}

// Pending ask to B (STATE.md): absent until B writes it.
export async function loadIterations() {
  const items = await fetchJson(paths.iterations);
  return Array.isArray(items) ? items : null;
}

// STATE.md contract: {vllm_version, model, measured_at, rows: [...]}.
export async function loadVllmMetrics() {
  const m = await fetchJson(paths.vllm);
  return m && typeof m === "object" && !Array.isArray(m) ? m : null;
}

// Source label for every number: FAKE wins, else the split from the log.
export function sourceLabel(run) {
  if (!run) return null;
  return run.fake ? (run.split ? `FAKE · ${run.split}` : "FAKE") : run.split;
}
