// Loaders and the log -> weeks model (UI_SPEC.md section 3). Everything else in the UI reads these structures.
//
// Real sources only, dev seasons only (task ids from tasks/dev.jsonl, UFGA-1990..2009):
//   B (agent runs)   runs/<config>/<task_id>.jsonl, listed in runs/index.json (fake_* configs ignored)
//   A (baselines)    results_baseline/runs/<config>/<task_id>.jsonl for BASELINE_CONFIGS, dev task ids only
//   A (results)      results_baseline/eval.csv rows with split = dev; results_baseline/summary.md "Split: dev" table
//   A (agent designs) agents_a/designs/<design>/runs/<config>/<task_id>.jsonl, listed in that design's
//                    runs/index.json (dev ids only), and agents_a/designs/<design>/results/eval.csv rows with split = dev
// tasks/test.jsonl, test-year logs and test rows are never fetched or parsed: every run path is built from a dev
// task id, and eval.csv / summary.md are cut to their dev rows before any value is read. results_baseline's
// runs/index.json is never read (it lists test years). Fake mode is retired: ui/fake/ and
// lanec/scripts/fake_logs.py stay on disk, unused.
// Every request goes through net.js (at most 4 in flight, network errors / resets retried). A missing file (HTTP
// 404) or an empty one returns null and callers show a quiet placeholder; any other failure returns a LoadError
// (re-exported here), which is listed in loadFailures() for the UI's load-failure card.
//
// Parsing rules (STATE.md): the line-level week is the decision week (0..W-1); the final line sits at week W
// (harvest). A coordinator decision wins over the runner's policy/decision line. Critic messages are
// {text, objection: bool}; other messages {text} or {content}; messages with neither (inference records,
// proposal records) are not chat. A's design logs keep message text empty and put the content in
// data.tool_calls[{name, arguments: JSON string}]: report tools become chat (see A_REPORT_TOOLS); a review_plan
// verdict other than "accept" is a Critic objection. Fallbacks {why} (UI_SPEC) or {text}.

import { request, fail, LoadError, loadFailures, onLoadFailures } from "./net.js";

export { LoadError, loadFailures, onLoadFailures };

const params = new URLSearchParams(location.search);
export const LITE = params.get("lite") === "1";

// Baseline configs A froze in results_baseline/ (README.md, config.yaml eval.configs). These always load from
// results_baseline/runs/, never from runs/ (runs/farmer holds local toy-sim runs).
const BASELINE_CONFIGS = ["farmer_ufga", "farmer", "hindsight", "no_n"];
// A's agent designs (agents_a/designs/<design>/, committed by A). Each design's runs/index.json names its configs;
// loadIndex() maps each config to its design folder here.
const A_DESIGNS = ["d0_single", "d1_multi", "d1b_multi", "d1c_multi"];
const aDesignOf = {};
const aRoot = (design) => `../agents_a/designs/${design}`;
function runRoot(config) {
  if (aDesignOf[config]) return `${aRoot(aDesignOf[config])}/runs`;
  return BASELINE_CONFIGS.includes(config) ? "../results_baseline/runs" : "../runs";
}
export const paths = {
  index: "../runs/index.json",
  aIndex: (design) => `${aRoot(design)}/runs/index.json`,
  aEval: (design) => `${aRoot(design)}/results/eval.csv`,
  run: (config, task) => `${runRoot(config)}/${config}/${task}.jsonl`,
  devTasks: "../tasks/dev.jsonl",
  weather: (site, year) => `../data/weather/${site}_${year}.json`,
  eval: "../results_baseline/eval.csv",
  summary: "../results_baseline/summary.md",
  iterations: "../results/iterations.json",
  vllm: "../results/vllm_metrics.json",
};

export const AGENTS = ["weather", "crop", "planner", "critic", "coordinator"];
export const AGENT_NAMES = { weather: "Weather", crop: "Crop", planner: "Planner", critic: "Critic", coordinator: "Coordinator",
  policy: "Agent" };
// Plain labels, in table order. Unknown configs show their raw name. The (D1c) / (B) / (D0) labels hold until
// the team confirms the official config.
const CONFIG_NAMES = {
  farmer_ufga: "Farmer practice", farmer: "Fixed split schedule", no_n: "No fertilizer", hindsight: "Grid hindsight",
  a_d1c_multi: "FieldTwin agent team (D1c)", multi: "FieldTwin agent team (B)", a_d0_single: "Single agent (D0)",
  single: "Single agent", multi_no_critic: "Team without Critic",
  multi_no_weather: "Team without Weather", multi_no_tools: "Team without tools",
};
const CONFIG_ORDER = Object.keys(CONFIG_NAMES);
// The Season page shows this pair and nothing else (R7 pivot, STATE.md); every other config appears on Results only.
export const SEASON_PAIR = { left: "farmer_ufga", right: "a_d1c_multi" };

// ---------------------------------------------------------------- fetch helpers

// Text, null (404), or a LoadError.
function fetchText(url) {
  return request(url);
}

// Parsed JSON, null (404), or a LoadError (fetch failure, or a file that does not parse).
async function fetchJson(url) {
  const text = await fetchText(url);
  if (text === null || text instanceof LoadError) return text;
  try {
    return JSON.parse(text);
  } catch {
    return fail(url, "not valid JSON");
  }
}

// ---------------------------------------------------------------- configs and tasks

export function configName(config) {
  return CONFIG_NAMES[config] || config;
}

export function parseTaskId(id) {
  const m = /^([A-Za-z0-9]+)-(\d{4})$/.exec(id || "");
  return m ? { site: m[1], year: +m[2] } : null;
}

// Known configs first (CONFIG_ORDER), then unknown ones by name.
export function sortConfigs(configs) {
  const rank = (c) => (CONFIG_ORDER.includes(c) ? CONFIG_ORDER.indexOf(c) : CONFIG_ORDER.length);
  return [...configs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Dev seasons from tasks/dev.jsonl ({task_id, site, year, split}), in file order. Nothing else is a season here.
// Returns the count, or a LoadError when the file failed to load.
const devTasks = [];

async function loadDevTasks() {
  if (devTasks.length) return devTasks.length;
  const text = await fetchText(paths.devTasks);
  if (text === null || text instanceof LoadError) return text || 0;
  for (const line of text.split("\n")) {
    try {
      const t = JSON.parse(line);
      if (t && typeof t.task_id === "string" && (t.split || "dev") === "dev") devTasks.push(t.task_id);
    } catch { /* blank or broken line */ }
  }
  return devTasks.length;
}

export function seasons() {
  return [...devTasks];
}

export function isDev(task) {
  return devTasks.includes(task);
}

// Dev sub-split (agents_a/common/splits.py): prompts were tuned on dev 1990-2004 ("tuned"); dev 2005-2009 is the
// check set they were not tuned on ("not tuned"). null for anything else.
export function tuneTag(task) {
  const p = parseTaskId(task);
  if (!p || !isDev(task)) return null;
  return p.year >= 1990 && p.year <= 2004 ? "tuned" : p.year >= 2005 && p.year <= 2009 ? "not tuned" : null;
}

// {config: [dev task ids]}: A's baseline configs for every dev season, B's runs/index.json and each A design's
// runs/index.json, cut to dev seasons. fake_* configs and A's baseline configs listed in runs/index.json (local
// toy runs) are skipped. A config listed by an A design reads its logs from that design's folder. null when
// tasks/dev.jsonl is missing or empty, a LoadError when it failed to load; an index.json that fails is skipped
// (and listed in loadFailures()).
export async function loadIndex() {
  const count = await loadDevTasks();
  if (count instanceof LoadError) return count;
  if (!count) return null;
  const index = Object.fromEntries(BASELINE_CONFIGS.map((c) => [c, seasons()]));
  const add = (obj, design = null) => {
    if (!obj || obj instanceof LoadError || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [c, ids] of Object.entries(obj)) {
      if (c.startsWith("fake_") || BASELINE_CONFIGS.includes(c) || !Array.isArray(ids)) continue;
      const dev = ids.filter(isDev);
      if (!dev.length) continue;
      index[c] = dev;
      if (design) aDesignOf[c] = design;
    }
  };
  add(await fetchJson(paths.index));
  const designs = await Promise.all(A_DESIGNS.map((d) => fetchJson(paths.aIndex(d))));
  A_DESIGNS.forEach((d, i) => add(designs[i], d));
  return index;
}

// Does the log file exist? HEAD request, cached: true, false (404), or a LoadError (not cached, so a later call
// asks again). Dev seasons only.
const logExists = new Map();

export function hasLog(config, task) {
  if (!isDev(task)) return Promise.resolve(false);
  const key = `${config}/${task}`;
  if (!logExists.has(key)) {
    const p = request(paths.run(config, task), { method: "HEAD" }).then((r) => {
      if (r instanceof LoadError) logExists.delete(key);
      return r instanceof LoadError ? r : r === true;
    });
    logExists.set(key, p);
  }
  return logExists.get(key);
}

// Season picker: dev seasons where the index lists both SEASON_PAIR configs and both logs exist (dev order).
// hidden: the dev seasons left out. One season at a time: 40 HEAD requests at once make the local http.server reset
// connections, and the next fetch (e.g. an eval.csv) then fails. A HEAD that fails after its retries (LoadError)
// keeps the season: only a 404 hides it, and loading that season shows the load-failure card if the log fails too.
export async function pairSeasons(index) {
  const pair = Object.values(SEASON_PAIR), shown = [], hidden = [];
  for (const t of devTasks) {
    const ok = pair.every((c) => ((index && index[c]) || []).includes(t))
      && (await Promise.all(pair.map((c) => hasLog(c, t)))).every((r) => r !== false);
    (ok ? shown : hidden).push(t);
  }
  return { shown, hidden };
}

// ---------------------------------------------------------------- run log -> weeks model

// The run model, null (missing or empty log), or a LoadError.
export async function loadRun(config, task) {
  if (!isDev(task)) return null;   // never open a non-dev log
  const text = await fetchText(paths.run(config, task));
  if (text === null || text instanceof LoadError) return text;
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

// A's design logs: report tool calls inside a message (data.tool_calls[{name, arguments}], arguments a JSON
// string) carry the agent's words. Returns {text, objection} or null for retrieval calls (get_weather, ...).
const A_REPORT_TOOLS = {
  weather_report: (a) => a.summary,
  crop_report: (a) => a.summary,
  propose_plan: (a) => planText(a),
  review_plan: (a) => (a.verdict === "accept" ? "Accept." : a.objection || `Verdict: ${a.verdict}`),
  submit_decision: (a) => planText(a),
};

function planText(a) {
  const n = num(a.n_kg_ha), irr = num(a.irr_mm);
  const head = n !== null && irr !== null ? `**${n} kg N/ha, ${irr} mm water.** ` : "";
  return `${head}${typeof a.reason === "string" ? a.reason : ""}`.trim();
}

function aToolChat(call) {
  const f = call && A_REPORT_TOOLS[call.name];
  if (!f) return null;
  let args;
  try {
    args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
  } catch {
    return null;
  }
  if (!args || typeof args !== "object") return null;
  const text = f(args);
  if (typeof text !== "string" || !text.trim()) return null;
  return { text, objection: call.name === "review_plan" && args.verdict !== "accept" };
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
        if (d.reset || !(AGENTS.includes(e.agent) || e.agent === "policy")) break;
        {
          const push = (text, objection) => {
            const msg = { agent: e.agent, text, objection: e.agent === "critic" && objection, t: e.t };
            w.chat.push(msg);
            (w.messages[e.agent] = w.messages[e.agent] || []).push(msg);
          };
          const text = typeof d.text === "string" && d.text ? d.text : typeof d.content === "string" ? d.content : "";
          if (text.trim() && e.agent !== "policy") push(text, d.objection === true);
          // A's shape: the words are in report tool calls (a single agent's only report is submit_decision).
          for (const call of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
            const c = aToolChat(call);
            if (c) push(c.text, c.objection);
          }
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

  // Model name, when a line records one (B: data.inference.response_model).
  let model = null;
  for (const e of events) {
    const d = e.data || {};
    const m = (d.inference && d.inference.response_model) || d.model;
    if (typeof m === "string" && m) { model = m; break; }
  }

  const parsed = parseTaskId(task);
  return {
    config, task, W, weeks, final,
    site: meta.site || (parsed && parsed.site) || null,
    year: num(meta.year) || (parsed && parsed.year) || null,
    split: meta.split || (isDev(task) ? "dev" : null),
    model,
    hasAgents: weeks.some((w) => w.chat.length > 0),
    fallbackWeeks: weeks.filter((w) => w.fallback).map((w) => w.week),
    objectionWeeks: weeks.filter((w) => w.objection).map((w) => w.week),
  };
}

// Data events for one week, in beat order, for the field motes (fieldSvg.js show()):
//   storm: weekly.rain_mm above stormMm; n: the chosen decision's n_kg_ha > 0; leach: weekly.n_leached > 0.05;
//   uptake: weekly.n_uptake > 0.5
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
  const uptake = w.weekly ? num(w.weekly.n_uptake) : null;
  if (uptake !== null && uptake > 0.5) events.push({ kind: "uptake", amount: uptake });
  return events;
}

// ---------------------------------------------------------------- weather

// Weather days, null, or a LoadError.
export async function loadWeather(site, year) {
  if (!site || !year) return null;
  const days = await fetchJson(paths.weather(site, year));
  if (days instanceof LoadError) return days;
  return Array.isArray(days) && days.length ? days : null;
}

// Index of week 0 in the weather days: the day field (relative to week 0, negative before it) when the file
// has one, else rain matching (alignSeason). Returns a day index or null.
export function seasonStart(run, days) {
  if (!days) return null;
  if (days.some((d) => typeof d.day === "number")) {
    const i = days.findIndex((d) => d.day === 0);
    return i >= 0 ? i : null;
  }
  return alignSeason(run, days);
}

// Fallback: find where week 0 starts in the weather file by matching the log's weekly rain to 7-day sums, so the
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

// results_baseline/eval.csv, dev rows only: a row whose split cell is not "dev" is dropped before any other cell
// is read. Leading "# ..." lines are comments. Numeric cells become numbers.
export function parseDevCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!lines.length) return [];
  const cut = (l) => l.split(",").map((c) => c.trim());
  const head = cut(lines[0]);
  const si = head.indexOf("split");
  if (si < 0) return [];
  const rows = [];
  for (const l of lines.slice(1)) {
    const cells = cut(l);
    if (cells[si] !== "dev") continue;
    const row = {};
    head.forEach((h, i) => {
      const v = cells[i];
      row[h] = v !== undefined && v !== "" && !Number.isNaN(Number(v)) && !["config", "task_id", "split"].includes(h) ? Number(v) : v;
    });
    rows.push(row);
  }
  return rows;
}

// results_baseline/eval.csv plus each A design's results/eval.csv, dev rows only: {rows, failed}. failed lists
// each file that failed to load (LoadError, not 404) with the configs it holds, so Results keeps their rows:
// BASELINE_CONFIGS for results_baseline, the configs the design's runs/index.json maps to it for a design (the
// design folder name when its index did not load either). null when every file is missing.
export async function loadEval() {
  const sources = [{ url: paths.eval, configs: BASELINE_CONFIGS }, ...A_DESIGNS.map((d) => {
    const configs = Object.keys(aDesignOf).filter((c) => aDesignOf[c] === d);
    return { url: paths.aEval(d), configs: configs.length ? configs : [`${d} (agents_a)`] };
  })];
  const texts = await Promise.all(sources.map((s) => fetchText(s.url)));
  if (texts.every((t) => t === null)) return null;
  const failed = sources.filter((s, i) => texts[i] instanceof LoadError).map((s) => ({ url: s.url, configs: [...s.configs] }));
  return { rows: texts.filter((t) => typeof t === "string").flatMap(parseDevCsv), failed };
}

// results_baseline/summary.md, the "## Split: dev" table only: {head: [...], rows: [[...]]} or null. The text is
// cut at the next "## " heading before the table is read. A LoadError when the file failed to load.
// A's headline numbers (agents_a/demo_results.json, built by scripts/build_demo_results.py). null if missing.
export async function loadDemoResults() {
  return fetchJson("../agents_a/demo_results.json");
}

export async function loadSummaryDev() {
  const text = await fetchText(paths.summary);
  if (text === null || text instanceof LoadError) return text;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+Split:\s*dev\s*$/i.test(l.trim()));
  if (at < 0) return null;
  const section = [];
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l)) break;
    section.push(l);
  }
  const table = section.filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  if (table.length < 2) return null;
  return { head: table[0], rows: table.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c))) };
}

// Pending ask to B (STATE.md): absent until B writes it.
export async function loadIterations() {
  const items = await fetchJson(paths.iterations);
  if (items instanceof LoadError) return items;
  return Array.isArray(items) ? items : null;
}

// STATE.md contract: {vllm_version, model, measured_at, rows: [...]}.
export async function loadVllmMetrics() {
  const m = await fetchJson(paths.vllm);
  if (m instanceof LoadError) return m;
  return m && typeof m === "object" && !Array.isArray(m) ? m : null;
}
