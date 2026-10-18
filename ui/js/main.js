// Boot, page routing, keyboard, playback (UI_SPEC.md section 8). R2: pages Season, Agents, Results, Gym,
// Serving, How it works, switched by the dock (dock.js) or keys 1-6; no top bar.
// Season (default): the 3D view (season3d.js), two floating glass-grid field dioramas, always data.SEASON_PAIR
// (LEFT farmer practice, RIGHT the FieldTwin agent team; no config pickers). Each field header is the config's plain
// label, with the model name under it when the log records one. The season picker lists only seasons with both
// logs. Its only numbers: one week label and, at season end, the profit finale for the two fields (season3d.js
// places both from the projected field anchors). Week cards on the left (carousel.js, cube effect): one card per week
// plus harvest, synced with the week both ways; each holds the week's dates, the narrator line (narrator.js) and,
// in Critic objection weeks, the objection in one orange line. Key N toggles the cards. No bottom caption.
// Season with ?view2d=1 (or after a WebGL / shader failure): the R1 2D side view (fieldSvg.js), kept as the
// fallback. Agents: the full weekly chat for one run (agents.js). Results: A's dev baselines
// (results_baseline/summary.md "Split: dev" table, eval.csv dev rows for the season). Gym, Serving: placeholders.
// Real data only, dev seasons only (data.js). Load failures (data.LoadError, after net.js retries) show in one glass
// card (#loadfail) listing each file and why; Season shows that card instead of a half scene when either
// SEASON_PAIR log fails, and Results keeps a failed config's row marked "failed to load".
//
// Week semantics (STATE.md): position k in 0..W-1 shows week k's decision and its outcome (obs at the end of
// week k); k = W is harvest (the final line). Data stays 0-based; every label shows weeks 1-based (weekNo):
// "Week 1 / W" .. "Week W / W", then "Harvest". Every number on screen comes from data.js. Theme: js/theme.js.

import { theme, readCssTheme } from "./theme.js";
import * as data from "./data.js";
import { FieldView } from "./fieldSvg.js";
import { Timeline } from "./timeline.js";
import { weekLines, chatHtml, esc, mdPlain } from "./agents.js";
import { Dock } from "./dock.js";
import { weekLine } from "./narrator.js";
import { Carousel } from "./carousel.js";
import { renderHowItWorks, howStep } from "./howitworks.js";
import { headlineResults, attachBento, introBento } from "./resultsCharts.js";
import { renderServing } from "./serving.js";

export { theme };

const $ = (id) => document.getElementById(id);
// Each placeholder names the data file its page will read. How it works: step-by-step walkthrough of one real dev
// week (howitworks.js; Back / Next, arrow keys).
const PAGES = [
  { id: "season", label: "Season", icon: "sprout" },
  { id: "agents", label: "Agents", icon: "chats" },
  { id: "results", label: "Results", icon: "bars" },
  { id: "gym", label: "Gym", icon: "loop", file: "results/iterations.json" },
  { id: "serving", label: "Serving", icon: "chip" },
  { id: "how", label: "How it works", icon: "flow" },
];
const VIEWS = PAGES.map((p) => p.id);
const params = new URLSearchParams(location.search);
const STORY = params.get("story") === "1";
const VIEW2D = params.get("view2d") === "1";
const REDUCE = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const SIDES = ["left", "right"];
const SPEEDS = [0.5, 1, 2, 4];

const state = {
  index: null, task: null, seasons: [], pair: { ...data.SEASON_PAIR }, runs: { left: null, right: null },
  days: null, dayStart: null, week: 0, playing: false, speed: 1, view: "season", agentSide: "right", cards: true,
  pairFailed: false,   // a SEASON_PAIR log failed to load for this season: no scene, the load card instead
};
const fields = {};       // 2D FieldViews (view2d only)
let s3d = null;          // Season3D (3D only)
let timeline, dock, cards = null;

// ---------------------------------------------------------------- formatting

function has(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fmt(v, digits = 0) {
  if (!has(v)) return "n/a";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 ? `−${s}` : s;
}

// Count a number up (or down) from its last value; eased, under 400 ms. null shows `pending` muted.
function setNumber(el, value, digits = 0, pending = "n/a") {
  cancelAnimationFrame(el._raf);
  if (!has(value)) {
    el._v = undefined;
    el.textContent = pending;
    el.classList.add("pending");
    return;
  }
  el.classList.remove("pending");
  const from = has(el._v) ? el._v : 0;
  el._v = value;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / theme.motion.ms, 1);
    el.textContent = fmt(from + (value - from) * (1 - (1 - p) ** 3), digits);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  step(t0);
}

// 1-based week label for 0-based week k.
function weekNo(k) {
  return k + 1;
}

function money(v) {
  return `${v < 0 ? "−" : ""}$${fmt(Math.abs(v), 0)}`;
}

function signedMoney(v) {
  return `${v < 0 ? "−" : "+"}$${fmt(Math.abs(v), 0)}/ha`;
}

// Gap at harvest (right minus left). Positive: "+$X/ha", counted up in the accent color. Zero or negative
// (the right field earned the same or less): "−$X/ha" or "$0/ha" in quiet text, set at once, no accent, no count.
function gapMoney(v) {
  return Math.round(v) === 0 ? "$0/ha" : signedMoney(v);
}

// Finale count-up from 0 (longer than the 400 ms counters: it is the closing beat). Reduced motion: no count.
function countUp(el, value, format, ms = 1400) {
  cancelAnimationFrame(el._raf);
  if (REDUCE) {
    el.textContent = format(value);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / ms, 1);
    el.textContent = format(value * (1 - (1 - p) ** 3));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  step(t0);
}

// ---------------------------------------------------------------- views

function setView(view) {
  const page = PAGES.find((p) => p.id === view);
  if (!page) return;
  state.view = view;
  if (dock) dock.setActive(view);
  $("season").hidden = view !== "season";
  showScene();
  $("agents").hidden = view !== "agents";
  $("results").hidden = view !== "results";
  $("how").hidden = view !== "how";
  $("serving").hidden = view !== "serving";
  $("placeholder").hidden = !page.file;
  if (page.file) {
    $("placeholder-title").textContent = page.label;
    $("placeholder-file").textContent = `Needs ${page.file}`;
  }
  if (view === "agents") renderAgents();
  if (view === "results") { introNext = true; renderResults(); }
  if (view === "how") renderHowItWorks($("how-body"));
  if (view === "serving") renderServing($("serving-body"));
  showCards();
}

// The Season scene (3D stage, or the 2D fields) is withheld while a SEASON_PAIR log failed to load; the load card
// sits centered in its place.
function showScene() {
  const on = state.view === "season" && !state.pairFailed;
  $("stage3d").hidden = !s3d || !on;
  if (s3d) s3d.setActive(on);
  $("fields").hidden = !!s3d || state.pairFailed;
  document.body.classList.toggle("pair-failed", state.view === "season" && state.pairFailed);
}

// One quiet glass card listing every file that failed to load and why (data.loadFailures()); hidden when none.
function renderLoadCard() {
  const list = data.loadFailures();
  const el = $("loadfail");
  el.hidden = !list.length;
  el.innerHTML = list.length ? `<div class="lf-head">Failed to load</div><ul>${list.map((f) =>
    `<li><span class="mono">${esc(f.url.replace(/^(\.\.\/)+/, ""))}</span><span>${esc(f.reason)}</span></li>`).join("")}</ul>` : "";
}

// ---------------------------------------------------------------- chrome

function renderTaskPicker() {
  const html = state.seasons.map((t) => {
    const p = data.parseTaskId(t), tag = data.tuneTag(t);
    return `<option value="${esc(t)}" title="${esc(t)}"${t === state.task ? " selected" : ""}>`
      + `${esc(p ? p.year : t)}${tag ? ` · ${esc(tag)}` : ""}</option>`;
  }).join("");
  document.querySelectorAll("select.task").forEach((s) => (s.innerHTML = html));
}

// One source label top right: the split from the runs on screen (always dev here).
function renderBadges() {
  const runs = SIDES.map((s) => state.runs[s]).filter(Boolean);
  const label = (runs.find((r) => r.split) || {}).split || null;
  $("src").textContent = label || "";
  $("src").hidden = !label;
  const fin = document.querySelector("#s3-fin-mid .fin-src");
  fin.textContent = label || "";
  fin.hidden = !label;
}

// ---------------------------------------------------------------- season

function maxW() {
  const ws = SIDES.map((s) => state.runs[s]).filter(Boolean).map((r) => r.W);
  return ws.length ? Math.max(...ws) : 20;
}

// Shared scale for both fields: max of each value across both runs for this task.
function taskScale() {
  const sc = { biomass: 0, soilN: 0, dose: 0, uptake: 0, leachWeek: 0, leachCum: 0 };
  for (const run of SIDES.map((s) => state.runs[s]).filter(Boolean)) {
    for (const w of run.weeks) {
      const o = w.obs || {}, wk = w.weekly || {};
      if (has(o.biomass_kg_ha)) sc.biomass = Math.max(sc.biomass, o.biomass_kg_ha);
      if (has(o.soil_n_kg_ha)) sc.soilN = Math.max(sc.soilN, o.soil_n_kg_ha);
      if (w.decision && has(w.decision.n_kg_ha)) sc.dose = Math.max(sc.dose, w.decision.n_kg_ha);
      if (has(wk.n_uptake)) sc.uptake = Math.max(sc.uptake, wk.n_uptake);
      if (has(wk.n_leached)) sc.leachWeek = Math.max(sc.leachWeek, wk.n_leached);
      if (w.cum && has(w.cum.nLeached)) sc.leachCum = Math.max(sc.leachCum, w.cum.nLeached);
    }
  }
  return sc;
}

function snapshot(run, k) {
  const w = run && run.weeks[Math.min(k, run.W)];
  if (!w) return null;
  return { k: Math.min(k, run.W), W: run.W, obs: w.obs, weekly: w.weekly, harvest: w.harvest,
    cumLeached: w.cum ? w.cum.nLeached : null };
}

// Field names in plain words (data.configName).
function fieldName(side) {
  const config = state.pair[side];
  return config ? data.configName(config) : "No run for this season";
}

// Field headers: the SEASON_PAIR config's plain label per side, the model name small under it when the log
// records one, and a quiet "No run for this season" when the side has no log. The same heads serve the 3D
// overlays and the 2D fallback.
function renderFieldHeads() {
  for (const side of SIDES) {
    const config = state.pair[side], run = state.runs[side];
    document.querySelectorAll(`.cfg-name[data-side="${side}"]`).forEach((el) => (el.textContent = fieldName(side)));
    const model = run && run.model ? run.model : "";
    document.querySelectorAll(`.cfg-model[data-side="${side}"]`).forEach((el) => {
      el.textContent = model.split("/").pop();
      el.title = model;
      el.hidden = !model;
    });
    // 2D: the plot itself says "No run for this season".
    document.querySelectorAll(`.cfg-none[data-side="${side}"]`).forEach((el) => (el.hidden = !s3d || !config || !!run));
    if (!s3d) {
      const fb = run ? run.fallbackWeeks.length : 0;
      $(`fb-${side}`).textContent = `${fb} fallback week${fb === 1 ? "" : "s"}`;
      $(`fb-${side}`).hidden = !fb;
    }
  }
}

function renderWeekLabel() {
  const W = maxW(), k = state.week;
  const harvest = k >= W;
  $("week-num").textContent = harvest ? "Harvest" : `Week ${weekNo(k)}`;
  $("week-of").textContent = harvest ? "" : `/ ${W}`;
  const day = state.days && state.dayStart !== null && !harvest ? state.days[state.dayStart + 7 * k] : null;
  const date = day && day.date ? new Date(`${day.date}T00:00:00`) : null;
  $("week-date").textContent = date && !Number.isNaN(+date)
    ? `from ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
}

// 3D: one week label; the finale at harvest.
function render3d() {
  const W = maxW(), k = state.week;
  $("s3-week").textContent = k >= W ? "Harvest" : `Week ${weekNo(k)} / ${W}`;
  renderFinale();
}

// Season end only: each field's profit_usd_ha (final line) counts up, the gap between them sits in the middle
// (right minus left), and N leached sits small under each field. One dev label.
function renderFinale() {
  const finals = {};
  for (const side of SIDES) {
    const run = state.runs[side];
    const w = run && run.weeks[Math.min(state.week, run.W)];
    const final = w && w.harvest ? run.final : null;
    finals[side] = final;
    const prof = document.querySelector(`#s3-fin-${side} .fin-profit`);
    const p = final && has(final.profit_usd_ha) ? final.profit_usd_ha : null;
    if (p !== null && prof._v !== p) countUp(prof.querySelector(".v"), p, money);   // new value (or new config)
    prof._v = p;
    prof.hidden = p === null;
    const leach = document.querySelector(`#s3-fin-${side} .fin-leach`);
    const nl = final && has(final.n_leached) ? final.n_leached : null;
    leach.hidden = nl === null;
    if (nl !== null) leach.innerHTML = `N leached <span class="mono">${fmt(nl, 1)}</span> kg/ha`;
  }
  const box = document.querySelector("#s3-fin-mid .fin-delta");
  const l = finals.left && finals.left.profit_usd_ha, r = finals.right && finals.right.profit_usd_ha;
  const delta = has(l) && has(r) ? r - l : null;
  const ahead = delta !== null && Math.round(delta) > 0;
  if (delta !== null && box._v !== delta) {
    const v = box.querySelector(".v");
    if (ahead) countUp(v, delta, signedMoney);
    else {
      cancelAnimationFrame(v._raf);
      v.textContent = gapMoney(delta);
    }
  }
  box._v = delta;
  box.classList.toggle("behind", delta !== null && !ahead);
  box.hidden = delta === null;
}

// Cut to about max characters at a word boundary, with an ellipsis when cut.
function cut(text, max) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1), sp = head.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

function renderTallies() {
  for (const side of SIDES) {
    const run = state.runs[side];
    const w = run && run.weeks[Math.min(state.week, run.W)];
    setNumber(document.querySelector(`#tally-${side} .live .v`), w && w.cum ? w.cum.nLeached : null, 1);
    const final = w && w.harvest ? run.final : null;
    $(`end-${side}`).hidden = !final;
    if (final) {
      setNumber(document.querySelector(`#end-${side} .profit`), final.profit_usd_ha, 0);
      setNumber(document.querySelector(`#end-${side} .grain`), final.grain_kg_ha, 0);
    }
    const lines = weekLines(run, state.week);
    const obj = $(`obj-${side}`), why = $(`why-${side}`);
    obj.hidden = !lines.objection;
    obj.querySelector(".t").textContent = lines.objection || "";
    obj.title = lines.objection || "";
    why.querySelector(".who").textContent = lines.who || "";
    why.querySelector(".t").textContent = lines.reason || (run && !(w && w.harvest) ? "No reason logged this week." : "");
    why.title = lines.reason || "";
    why.querySelector(".flag").hidden = !lines.fallback;
    why.classList.toggle("enter", false);
    void why.offsetWidth;   // restart the fade
    why.classList.add("enter");
  }
}

// Agents page: config switch (the two runs on Season), week stepper, the chat for that run and week.
function renderAgents() {
  if (state.view !== "agents") return;
  $("cfg").innerHTML = SIDES.map((side) => {
    const config = state.pair[side];
    return `<button data-side="${side}" class="${side === state.agentSide ? "on" : ""}"${config ? "" : " disabled"}>`
      + `${esc(fieldName(side))}</button>`;
  }).join("");
  $("cfg").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.agentSide = b.dataset.side; renderAgents(); }));
  const run = state.runs[state.agentSide];
  const W = run ? run.W : maxW(), k = Math.min(state.week, W);
  $("a-week").textContent = k >= W ? "Harvest" : `Week ${weekNo(k)} / ${W}`;
  const fb = run ? run.fallbackWeeks.length : 0;
  $("a-fb").textContent = `${fb} fallback week${fb === 1 ? "" : "s"}`;
  $("a-fb").hidden = !fb;
  $("agents-body").innerHTML = chatHtml(run, k);
}

// Results page, dev only. First, every config with eval.csv dev rows (results_baseline + agents_a designs): mean
// profit, N leached and grain, and profit wins vs Farmer practice (farmer_ufga) in the same season, split into
// tuned (dev 1990-2004) and not-tuned (dev 2005-2009) seasons; configs on the Season page with no eval rows are
// named. Then A's summary.md "Split: dev" baseline table (config cells in plain labels), then the eval.csv dev rows
// for the selected season with its tuned / not-tuned tag. Hindsight reads "Grid hindsight" (STATE.md data rules).
// A config whose eval.csv failed to load keeps its row in both tables, marked "failed to load" (never dropped).
let summaryDev, evalDev, demoResults, introNext = true;
const REF = "farmer_ufga";

function mean(xs) {
  const v = xs.filter(has);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function configStats(rows) {
  const ref = Object.fromEntries(rows.filter((r) => r.config === REF).map((r) => [r.task_id, r]));
  const configs = data.sortConfigs([...new Set(rows.map((r) => r.config))]);
  return configs.map((c) => {
    const rs = rows.filter((r) => r.config === c);
    const wins = (tag) => {
      const set = rs.filter((r) => data.tuneTag(r.task_id) === tag && ref[r.task_id] && has(r.profit_usd_ha) && has(ref[r.task_id].profit_usd_ha));
      return { n: set.length, won: set.filter((r) => r.profit_usd_ha > ref[r.task_id].profit_usd_ha).length };
    };
    return { config: c, n: rs.length, profit: mean(rs.map((r) => r.profit_usd_ha)), leached: mean(rs.map((r) => r.n_leached)),
      grain: mean(rs.map((r) => r.grain_kg_ha)), tuned: wins("tuned"), notTuned: wins("not tuned") };
  });
}

function plainConfigCell(cell) {
  const config = String(cell).replace(/\s*\(.*\)\s*$/, "").trim();
  return data.configName(config);
}

async function renderResults() {
  if (summaryDev === undefined) {
    [summaryDev, evalDev, demoResults] = await Promise.all([data.loadSummaryDev(), data.loadEval(), data.loadDemoResults()]);
  }
  if (state.view !== "results") return;
  // A row is an array of cells, or {failed: config} for a config whose eval.csv failed to load.
  const failedRow = (head, c) => `<tr class="failed"><td>${esc(data.configName(c))}</td>`
    + `<td colspan="${head.length - 1}" class="quiet">failed to load</td></tr>`;
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => (r.failed ? failedRow(head, r.failed)
      : `<tr>${r.map((c, i) => `<td class="${i ? "mono" : ""}">${esc(c)}</td>`).join("")}</tr>`)).join("")}</tbody></table>`;
  const winCell = (st, w) => (st.config === REF ? "—" : w.n ? `${w.won} / ${w.n}` : "—");
  const evalRows = (evalDev && evalDev.rows) || [];
  const failed = new Set(((evalDev && evalDev.failed) || []).flatMap((f) => f.configs));
  const stats = configStats(evalRows).filter((st) => !failed.has(st.config));
  const statsHead = ["config", "seasons", "mean profit $/ha", "mean N leached kg/ha", "mean grain kg/ha", "profit wins, tuned", "profit wins, not tuned"];
  // Headline charts first (held-out test, second site, resources, team vs single); the dev tables below are collapsed.
  let html = demoResults && !(demoResults instanceof data.LoadError) ? headlineResults(demoResults)
    : `<div class="quiet">Headline results unavailable: agents_a/demo_results.json ${demoResults ? "failed to load" : "is missing"}.</div>`;
  html += `<details class="res-more"><summary>Full results: every config, all dev seasons</summary>`;
  html += `<div class="res-head"><span class="label">All configs vs Farmer practice, dev seasons</span><span class="badge">dev</span></div>`;
  html += stats.length || failed.size ? table(statsHead, data.sortConfigs([...stats.map((st) => st.config), ...failed]).map((c) => {
    const st = stats.find((x) => x.config === c);
    return st ? [data.configName(st.config), String(st.n), fmt(st.profit, 2), fmt(st.leached, 2), fmt(st.grain, 0), winCell(st, st.tuned), winCell(st, st.notTuned)]
      : { failed: c };
  })) : `<div class="quiet">No eval.csv dev rows.</div>`;
  const noRows = Object.keys(state.index || {}).filter((c) => !failed.has(c) && !stats.some((st) => st.config === c));
  html += `<div class="quiet res-note">Means over each config's eval.csv dev rows. A win: profit_usd_ha above Farmer practice in the same season. `
    + `Tuned: dev 1990–2004 (prompts tuned on these). Not tuned: dev 2005–2009.`
    + `${noRows.length ? ` No eval.csv dev rows: ${esc(data.sortConfigs(noRows).map(data.configName).join(", "))}.` : ""}</div>`;
  html += `<div class="res-head"><span class="label">Baselines, all dev seasons</span><span class="badge">dev</span></div>`;
  html += summaryDev instanceof data.LoadError ? `<div class="quiet">No dev summary: results_baseline/summary.md failed to load.</div>`
    : summaryDev ? table(summaryDev.head, summaryDev.rows.map((r) => [plainConfigCell(r[0]), ...r.slice(1)]))
    : `<div class="quiet">No dev summary: results_baseline/summary.md is missing.</div>`;
  html += `</details>`;
  $("results-body").innerHTML = html;
  attachBento($("results-body"));
  introBento($("results-body"), introNext);
  introNext = false;
}

function renderTimeline() {
  const W = maxW();
  const ref = state.runs.left || state.runs.right;
  const weeklyRain = Array.from({ length: W }, (_, k) => {
    const w = ref && ref.weeks[k];
    return w && w.weekly && has(w.weekly.rain_mm) ? w.weekly.rain_mm : null;
  });
  let days = null, rainNote = null;
  if (state.days && state.dayStart !== null) {
    days = Array.from({ length: 7 * W }, (_, i) => {
      const d = state.days[state.dayStart + i];
      return d && has(d.rain_mm) ? d.rain_mm : null;
    });
  } else if (state.days) {
    rainNote = "weather file does not match the log";
  } else if (ref && ref.year) {
    rainNote = "no weather file";
  }
  const fallbackWeeks = [...new Set(SIDES.flatMap((s) => (state.runs[s] ? state.runs[s].fallbackWeeks : [])))];
  timeline.setModel({ W, days, weeklyRain, rainNote, fallbackWeeks });
}

// Week cards (3D Season only): one card per week 0..W-1 plus a harvest card. Each card: "Week N" and its date
// range from the weather file (when aligned), the narrator line for that week (a quiet-week line when nothing
// fired), and in Critic objection weeks one orange line with the objection (agent team first), cut to about
// theme.three.cards.objectionChars characters.
function dateRange(k) {
  if (!state.days || state.dayStart === null) return "";
  const a = state.days[state.dayStart + 7 * k], b = state.days[state.dayStart + 7 * k + 6] || a;
  const d = (x) => (x && x.date ? new Date(`${x.date}T00:00:00`) : null);
  const da = d(a), db = d(b);
  if (!da || Number.isNaN(+da) || !db || Number.isNaN(+db)) return "";
  const md = (x) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return da.getFullYear() === db.getFullYear() ? `${md(da)} – ${md(db)}, ${db.getFullYear()}`
    : `${md(da)}, ${da.getFullYear()} – ${md(db)}, ${db.getFullYear()}`;
}

function cardHtml(k, W, names) {
  const line = weekLine({ task: state.task, k, W, runs: state.runs, names, days: state.days, dayStart: state.dayStart,
    stormMm: theme.stormMm, thirstAt: theme.three.thirst.start });
  let obj = null;
  if (k < W) {
    for (const side of ["right", "left"]) {
      const run = state.runs[side], w = run && k < run.W ? run.weeks[k] : null;
      const m = w && w.chat.find((x) => x.objection);
      if (m) { obj = mdPlain(m.text) || "Objection"; break; }
    }
  }
  const date = k < W ? dateRange(k) : "";
  return `<header class="wc-head"><span class="wc-week">${k >= W ? "Harvest" : `Week ${weekNo(k)}`}</span>`
    + `${date ? `<span class="wc-date mono">${esc(date)}</span>` : ""}</header>`
    + `<p class="wc-text">${esc(line.text)}</p>`
    + `${line.side ? `<p class="wc-side">${esc(names[line.side])}</p>` : ""}`
    + `${obj ? `<p class="wc-obj" title="${esc(obj)}"><span class="who">Critic</span> ${esc(cut(obj, theme.three.cards.objectionChars))}</p>` : ""}`;
}

// Card counter: "Week N / W", 1-based (the same numbering as the Agents page), "Harvest" last.
function cardCounter(i) {
  const W = maxW();
  return i < W ? { cur: `Week ${weekNo(i)}`, tot: String(W) } : { cur: "Harvest", tot: "" };
}

function renderCards() {
  if (!cards) return;
  const W = maxW(), names = Object.fromEntries(SIDES.map((s) => [s, fieldName(s)]));
  const any = SIDES.some((s) => state.runs[s]);
  cards.setItems(any ? Array.from({ length: W + 1 }, (_, k) => cardHtml(k, W, names)) : [], state.week);
  showCards();
}

function showCards() {
  $("weekcards").hidden = !(cards && state.cards && state.view === "season" && SIDES.some((s) => state.runs[s]));
}

// ---------------------------------------------------------------- loading

// Load the logs for the current pair, then rescale and redraw everything. If either log fails to load (LoadError),
// neither field is shown: the load card stands in for the scene (no half scene).
async function loadPair() {
  const task = state.task;
  const loaded = await Promise.all(SIDES.map((s) => (state.pair[s] ? data.loadRun(state.pair[s], task) : null)));
  if (task !== state.task) return;   // the season changed while loading
  state.pairFailed = loaded.some((r) => r instanceof data.LoadError);
  SIDES.forEach((s, i) => (state.runs[s] = state.pairFailed ? null : loaded[i]));
  showScene();
  const ref = state.pairFailed ? null : loaded.find(Boolean);
  const days = ref ? await data.loadWeather(ref.site, ref.year) : null;
  if (task !== state.task) return;
  state.days = days instanceof data.LoadError ? null : days;   // listed on the load card; the rain strip says so
  state.dayStart = data.seasonStart(ref, state.days);
  const scale = taskScale();
  if (s3d) s3d.setRuns(scale);
  else {
    for (const s of SIDES) {
      fields[s].setScale(scale);
      fields[s].motes.clear();
    }
  }
  renderTaskPicker();
  renderBadges();
  renderFieldHeads();
  renderTimeline();
  state.week = Math.min(state.week, maxW());
  renderCards();
  setWeek(state.week, { force: true });
}

// New season: the pair stays SEASON_PAIR.
async function selectTask(task) {
  state.task = task;
  await loadPair();
}

// Week change: fields animate this week's data events (dose, uptake, leaching, storm) when the week moved.
function setWeek(k, { force = false } = {}) {
  const prev = state.week;
  state.week = Math.max(0, Math.min(maxW(), k));
  const moved = state.week !== prev || force;
  const spread = Math.min(1.2, (theme.motion.weekSeconds / state.speed) * 0.7);
  const views = {};
  for (const side of SIDES) {
    const run = state.runs[side];
    const events = moved && run ? data.weekEvents(run, Math.min(state.week, run.W), theme.stormMm) : [];
    views[side] = { snap: run ? snapshot(run, state.week) : null, events };
    if (!s3d) fields[side].show(views[side].snap, events, spread);
  }
  timeline.setWeek(state.week);
  if (s3d) {
    s3d.show(views, { spread, moved });
    render3d();
    if (cards) cards.setIndex(state.week);
  } else {
    renderWeekLabel();
    renderTallies();
  }
  renderAgents();
  if (state.view === "results") renderResults();
}

// ---------------------------------------------------------------- playback and input

function setPlaying(on) {
  state.playing = on;
  if (on && state.week >= maxW()) setWeek(0);
  $("play").textContent = on ? "Pause" : "Play";
  $("play").classList.toggle("on", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
}

function setSpeed(s) {
  state.speed = s;
  document.querySelectorAll(".speed button").forEach((b) => b.classList.toggle("on", +b.dataset.speed === s));
}

// [ and ] step through SPEEDS.
function stepSpeed(dir) {
  const i = SPEEDS.indexOf(state.speed);
  setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + dir))]);
}

function bind() {
  document.querySelectorAll("select.task").forEach((s) => (s.onchange = (e) => selectTask(e.target.value)));
  $("play").onclick = () => setPlaying(!state.playing);
  $("prev").onclick = () => setWeek(state.week - 1);
  $("next").onclick = () => setWeek(state.week + 1);
  $("reset").onclick = () => { setPlaying(false); setWeek(0); };
  $("a-prev").onclick = () => setWeek(state.week - 1);
  $("a-next").onclick = () => setWeek(state.week + 1);
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= String(VIEWS.length)) { setView(VIEWS[+e.key - 1]); return; }
    if (state.view === "how") {
      if (e.key === "ArrowRight") { e.preventDefault(); howStep(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); howStep(-1); }
      return;
    }
    if (state.view === "agents") {
      if (e.key === "ArrowRight") { e.preventDefault(); setWeek(state.week + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setWeek(state.week - 1); }
      return;
    }
    if (state.view !== "season") return;
    if (e.key === " ") {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      if (!e.repeat) setPlaying(!state.playing);
    } else if (e.key === "ArrowRight") { e.preventDefault(); setWeek(state.week + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setWeek(state.week - 1); }
    else if (e.key === "r" || e.key === "R") { setPlaying(false); setWeek(0); }
    else if (e.key === "[" || e.key === "]") stepSpeed(e.key === "]" ? 1 : -1);
    else if (e.key === "n" || e.key === "N") { state.cards = !state.cards; showCards(); }
  });
}

// One loop: play clock (wall time, so slow frames do not slow playback) and the mote canvases.
function loop() {
  let last = performance.now(), clock = 0;
  const frame = (now) => {
    const elapsed = (now - last) / 1000;
    last = now;
    if (state.playing) {
      clock += (elapsed * state.speed) / theme.motion.weekSeconds;
      if (clock >= 1) {
        clock = 0;
        if (state.week >= maxW()) setPlaying(false); else setWeek(state.week + 1);
      }
    }
    if (state.view === "season") {
      if (s3d) s3d.tick(elapsed);
      else for (const s of SIDES) fields[s].tick(elapsed);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

// A WebGL or shader failure hands over to the R1 2D view: same page with ?view2d=1.
function fallback2D(err) {
  console.error("FieldTwin: 3D Season unavailable, falling back to ?view2d=1.", err);
  const url = new URL(location.href);
  url.searchParams.set("view2d", "1");
  location.replace(url.href);
}

// 3D by default (three.js loads only here); ?view2d=1 builds the R1 2D fields instead. Returns false when
// the page is reloading into the 2D fallback.
async function initSeason() {
  if (!VIEW2D) {
    try {
      const { Season3D } = await import("./season3d.js");
      $("stage3d").hidden = false;
      s3d = new Season3D($("stage3d"), { lite: data.LITE, reduceMotion: REDUCE, onFail: fallback2D });
      s3d.setOverlays({
        heads: { left: $("s3-head-left"), right: $("s3-head-right") },
        fins: { left: $("s3-fin-left"), right: $("s3-fin-right") },
        mid: $("s3-fin-mid"),
        floor: $("bottom"),
        side: $("weekcards"),
      });
      cards = new Carousel($("weekcards"), { stiffness: theme.three.cards.stiffness, damping: theme.three.cards.damping,
        reduceMotion: REDUCE, label: "Week cards", onChange: (k) => setWeek(k), counter: cardCounter });
      document.body.classList.add("s3d");
    } catch (err) {
      fallback2D(err);
      return false;
    }
  } else {
    for (const s of SIDES) fields[s] = new FieldView($(`plot-${s}`), { lite: data.LITE, reduceMotion: REDUCE });
  }
  timeline = new Timeline($("timeline"), { onSeek: (k) => setWeek(k), bare: !!s3d });
  return true;
}

function loaded() {
  document.body.classList.remove("not-loaded");
  loop();
}

async function main() {
  readCssTheme();
  if (data.LITE) document.body.classList.add("lite");
  if (STORY) document.body.classList.add("story");   // story mode (later unit) hides the dock
  dock = new Dock($("dock"), PAGES.map((p, i) => ({ id: p.id, label: p.label, icon: p.icon, key: String(i + 1) })),
    { onSelect: setView, reduceMotion: REDUCE });
  dock.setHidden(STORY);
  data.onLoadFailures(renderLoadCard);
  if (!(await initSeason())) return;
  setView(state.view);
  bind();
  state.index = await data.loadIndex();
  const { shown, hidden } = await data.pairSeasons(state.index);
  state.seasons = shown;
  if (hidden.length) console.info(`FieldTwin: seasons without both Season logs (hidden): ${hidden.join(", ")}`);
  const task = shown[0] || null;
  if (state.index instanceof data.LoadError) state.index = null;   // tasks/dev.jsonl failed: the load card says why
  else if (!task) {
    notice(state.index ? `No dev season has both ${Object.values(data.SEASON_PAIR).map(data.configName).join(" and ")} logs.`
      : "No dev seasons: tasks/dev.jsonl is missing or empty.");
  }
  if (!task) {
    renderFieldHeads();
    setWeek(0, { force: true });
    loaded();
    return;
  }
  await selectTask(task);
  loaded();
}

main();
