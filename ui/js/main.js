// Boot, page routing, keyboard, playback (UI_SPEC.md section 8).
// Demo flow (STATE.md): Season plays a past Gainesville test season, the presenter starts 2026 live (about 20 s a
// week), moves to How it works, Results and Serving while it runs, and ends on the 2026 season-end result. Tabs follow
// that order: 1 Season, 2 How it works, 3 Results, 4 Serving, 5 Agents, 6 Gym (the dock at the bottom, dock.js, with
// each tab's key on its icon; keys 1-6). The top bar holds the wordmark, the live chip during a live run (click: back
// to Season) and the split badge of the current tab. Each tab has one headline saying what it proves.
//
// Season (default): the 3D view (season3d.js), two floating glass-grid field dioramas, always data.SEASON_PAIR (LEFT
// farmer practice, RIGHT the Maize Runner team). Under each field: running counters (nitrogen, water, leaching) and, at
// harvest, the profit. Week cards on the left (carousel.js): one card per week, the team's decision in plain words,
// the Critic's verdict pill (Objection, Accept, No verdict) and the Coordinator's one-line reason. The scrubber marks
// objection and fallback weeks. Picker: live seasons first ("<year> live"), then Gainesville seasons by year; a
// "Georgia" toggle swaps in the Tifton seasons. Default: Gainesville 2024.
// Live season (data.LIVE_TASKS): before Play the field sits at planting with the season's observed weather and one
// "Start live season" button; while it runs, weeks fill in as they finish and the headline line shows week N of the
// season's weeks, elapsed time (log timestamps), the agent working now and the next week's estimated arrival; when it
// ends, one season-end card (live logs' final lines only, "not in log" when a value is missing). Offline or stopped:
// one clear line, the page stays usable.
// Season with ?view2d=1 (or after a WebGL / shader failure): the R1 2D side view (fieldSvg.js), kept as the fallback.
// Load failures (data.LoadError, after net.js retries) show in one glass card (#loadfail).
//
// Week semantics (STATE.md): position k in 0..W-1 shows week k's decision and its outcome (obs at the end of
// week k); k = W is harvest (the final line). Data stays 0-based; every label shows weeks 1-based (weekNo).
// Every number on screen comes from data.js / the data files. Theme: js/theme.js.

import { theme, readCssTheme } from "./theme.js";
import * as data from "./data.js";
import { FieldView } from "./fieldSvg.js";
import { Timeline } from "./timeline.js";
import { weekLines, esc, mdPlain, mdHtml } from "./agents.js";
import { Carousel } from "./carousel.js";
import { Dock } from "./dock.js";
import { renderHowItWorks, howStep, setLiveTask, liveStarted } from "./howitworks.js";
import { resultsPage } from "./resultsCharts.js";
import { renderServing } from "./serving.js";

export { theme };

const $ = (id) => document.getElementById(id);
const PAGES = [
  { id: "season", label: "Season", icon: "sprout" },
  { id: "how", label: "How it works", icon: "flow" },
  { id: "results", label: "Results", icon: "bars" },
  { id: "serving", label: "Serving", icon: "chip" },
  { id: "agents", label: "Agents", icon: "chats" },
  { id: "gym", label: "Gym", icon: "loop" },
];
const VIEWS = PAGES.map((p) => p.id);
const params = new URLSearchParams(location.search);
const STORY = params.get("story") === "1";
const VIEW2D = params.get("view2d") === "1";
const REDUCE = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const SIDES = ["left", "right"];
const SPEEDS = [0.5, 1, 2, 4];
const SITE_NAMES = data.SITE_NAMES;
const SITE_SHORT = { UFGA: "Gainesville", TIFT: "Tifton" };
const DEFAULT_SITE = "UFGA", DEFAULT_YEAR = 2024;

const state = {
  index: null, task: null, seasons: [], pair: { ...data.SEASON_PAIR }, runs: { left: null, right: null },
  days: null, dayStart: null, week: 0, playing: false, speed: 1, view: "season", cards: true, site: DEFAULT_SITE,
  facts: { weeksPerSeason: null, plantingDoy: {} },
  pairFailed: false,   // a SEASON_PAIR log failed to load for this season: no scene, the load card instead
};
const fields = {};       // 2D FieldViews (view2d only)
let s3d = null;          // Season3D (3D only)
let timeline, dock, cards = null;
// Live season (data.LIVE_TASKS): Play asks the demo server (scripts/demo_server.py) to start
// scripts/live_season.py, then the page follows its log, always on the latest finished week. 1x only: the weeks
// arrive as fast as the model answers. Logs from an earlier run are never shown: nothing loads before Play.
// phase: idle (before Play), starting (Play sent, no team week yet), running, done, stopped (the run exited early),
// offline (no demo server). msg: the one line shown for stopped / offline.
const LIVE_POLL_MS = 1500;
const live = { started: null, timer: null, sig: "", phase: "idle", msg: "", tick: null };
const missingLogged = new Set();

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
  if (REDUCE) { el.textContent = fmt(value, digits); return; }
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

// m:ss (h:mm:ss past an hour) from milliseconds.
function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
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

// Cut to about max characters at a word boundary, with an ellipsis when cut.
function cut(text, max) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1), sp = head.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

// First sentence of a logged text (shortens, never rewrites).
function firstSentence(s) {
  if (!s) return "";
  const m = String(s).match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

// Split label from a task file / eval.csv split: test and tift_test read "test"; live and dev stay.
function splitWord(split) {
  if (!split) return null;
  return /test/.test(split) ? "test" : split;
}

function season() {
  return state.seasons.find((s) => s.task === state.task) || null;
}

function isLiveTask() {
  return !!state.task && data.isLive(state.task);
}

function liveActive() {
  return !!live.started && live.started === state.task;
}

// ---------------------------------------------------------------- views and top bar

// Page dock (dock.js, restored from before 2dd426a): tabs in the demo order, key i + 1 on each icon. ?story=1 hides it.
function buildDock() {
  dock = new Dock($("dock"), PAGES.map((p, i) => ({ id: p.id, label: p.label, icon: p.icon, key: String(i + 1) })),
    { onSelect: setView, reduceMotion: REDUCE });
  dock.setHidden(STORY);
}

function setView(view) {
  const page = PAGES.find((p) => p.id === view);
  if (!page) return;
  const changed = view !== state.view;
  state.view = view;
  if (dock) dock.setActive(view);
  for (const id of VIEWS) {
    const el = $(id);
    const on = id === view;
    if (on && (el.hidden || changed)) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    el.hidden = !on;
  }
  $("season-head").hidden = view !== "season";
  if (view === "season" && changed) { const h = $("season-head"); h.classList.remove("enter"); void h.offsetWidth; h.classList.add("enter"); }
  showScene();
  renderBadges();
  if (view === "agents") renderAgents();
  if (view === "results") renderResults();
  if (view === "how") renderHowItWorks($("how-body"));
  if (view === "serving") renderServing($("serving-body"), liveRun());
  if (view === "gym") renderGym();
  showCards();
  renderLivePanels();
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

// Picker: live seasons first ("<year> live", Gainesville only), then the current site's seasons by year, newest
// first. The site toggle (Gainesville / Georgia) picks which recorded seasons are listed.
function renderTaskPicker() {
  const list = state.seasons.filter((s) => (s.live ? state.site === "UFGA" || s.task === state.task : s.site === state.site))
    .sort((a, b) => (b.live - a.live) || (b.year - a.year));
  const html = list.map((s) => {
    const label = s.live ? `${s.year} live` : `${s.year}${s.available ? "" : " · unavailable"}`;
    return `<option value="${esc(s.task)}"${s.task === state.task ? " selected" : ""}${s.available ? "" : " disabled"}>${esc(label)}</option>`;
  }).join("");
  $("task").innerHTML = html;
  document.querySelectorAll("#site button").forEach((b) => b.classList.toggle("on", b.dataset.site === state.site));
}

// Split badge of the current tab (top bar): Season / Agents = the season's split, How it works = dev (live in live
// mode), Results = test (its headline; each tile names its own), Serving = dev (the measured seasons). Gym: none.
function renderBadges() {
  const s = season(), sw = s ? splitWord(s.split) : null;
  const label = {
    season: sw || (s ? "split unknown" : null), agents: sw || (s ? "split unknown" : null),
    how: isLiveTask() ? "live" : "dev", results: "test", serving: "dev", gym: null,
  }[state.view];
  $("src").textContent = label || "";
  $("src").hidden = !label;
  const fin = document.querySelector("#s3-fin-mid .fin-src");
  fin.textContent = sw || "";
  fin.hidden = !sw;
}

// ---------------------------------------------------------------- season

function maxW() {
  const ws = SIDES.map((s) => state.runs[s]).filter(Boolean).map((r) => r.W);
  if (isLiveTask() && liveActive() && state.runs.right && !state.runs.right.final) {
    return Math.max(state.facts.weeksPerSeason || 0, ...ws);
  }
  return ws.length ? Math.max(...ws) : (state.facts.weeksPerSeason || 20);
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

// Field headers: the SEASON_PAIR config's plain label per side, and a quiet "No run for this season" when a recorded
// season has no log for that side (a live season before Play shows the names only).
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
    document.querySelectorAll(`.cfg-none[data-side="${side}"]`).forEach((el) => (el.hidden = !s3d || !config || !!run || isLiveTask()));
    if (!s3d) {
      const fb = run ? run.fallbackWeeks.length : 0;
      $(`fb-${side}`).textContent = `Fallback · ${fb} week${fb === 1 ? "" : "s"}`;
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

// Season headline: what the tab proves, then the season in plain words; for a live season, its status line.
function renderSeasonHead() {
  const s = season();
  const site = s && s.site ? SITE_NAMES[s.site] || s.site : "";
  if (!s) {
    $("season-h1").textContent = "Maize Runner vs farmer, same weather";
    $("season-sub").textContent = "";
    return;
  }
  if (!s.live) {
    $("season-h1").textContent = "Maize Runner vs farmer, same weather";
    const what = splitWord(s.split) === "test" ? (s.site === "UFGA" ? "held-out test season" : "test season at a new site")
      : s.split ? `${s.split} season` : "split unknown";
    $("season-sub").textContent = `${site} · ${s.year} · ${what}`;
    return;
  }
  $("season-h1").textContent = `${s.year} season, decided live`;
  $("season-sub").innerHTML = liveActive() ? liveStatusHtml() : `${esc(site)} · live run, outside every training and test split`;
}

// 3D: one week label (screen readers); the finale and counters under the fields.
function render3d() {
  const W = maxW(), k = state.week;
  $("s3-week").textContent = k >= W ? "Harvest" : `Week ${weekNo(k)} / ${W}`;
  renderFinale();
}

// Under each field: nitrogen applied, water applied and N leached so far (end of the shown week; the final line at
// harvest), and at season end the profit (final.profit_usd_ha) counting up, with the gap between the fields in the
// middle (right minus left) and the season's split label. A finished live season shows its season-end card instead.
function renderFinale() {
  const finals = {};
  const endCard = isLiveTask() && liveActive() && live.phase === "done";
  for (const side of SIDES) {
    const run = state.runs[side];
    const w = run && run.weeks[Math.min(state.week, run.W)];
    const final = w && w.harvest ? run.final : null;
    finals[side] = final;
    const prof = document.querySelector(`#s3-fin-${side} .fin-profit`);
    const p = final && has(final.profit_usd_ha) ? final.profit_usd_ha : null;
    if (p !== null && prof._v !== p) countUp(prof.querySelector(".v"), p, money);   // new value (or new config)
    prof._v = p;
    prof.hidden = p === null || endCard;
    const ctr = document.querySelector(`.ctr[data-side="${side}"]`);
    ctr.hidden = !run || endCard;
    const cum = w && w.cum;
    setNumber(ctr.querySelector('[data-k="n"]'), cum ? cum.nApplied : null, 0, "—");
    setNumber(ctr.querySelector('[data-k="w"]'), cum ? cum.irr : null, 0, "—");
    setNumber(ctr.querySelector('[data-k="l"]'), cum ? cum.nLeached : null, 1, "—");
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
  box.hidden = delta === null || endCard;
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

// The Critic's verdict as a pill: Objection (white outline), Accept (accent outline), No verdict (muted, dashed).
function verdictPill(v) {
  return v === "object" ? `<span class="flag-pill">Objection</span>`
    : v === "accept" ? `<span class="verdict-pill accept">Accept</span>` : `<span class="verdict-pill none">No verdict</span>`;
}

// "40 kg N · 15 mm water" from a decision (the applied amounts), or "".
function decisionHtml(d) {
  if (!d || !has(d.n_kg_ha) || !has(d.irr_mm)) return "";
  return `${fmt(d.n_kg_ha)} <span class="u">kg N</span> · ${fmt(d.irr_mm)} <span class="u">mm water</span>`;
}

// ---------------------------------------------------------------- Agents page

// One week of the Maize Runner team: the decision with the Critic's verdict and the Coordinator's reason on top, then one
// card per agent with its tool calls and its messages (Planner: proposal and, after an objection, the revision;
// Critic: verdict and objection; Coordinator: decision and reason, plus any fallback). The week is Season's week; at
// harvest the last decision week. Click a card to read its full text.
function renderAgents() {
  if (state.view !== "agents") return;
  const run = state.runs.right, s = season();
  $("a-sub").textContent = s ? [SITE_NAMES[s.site] || s.site, s.live ? `${s.year} live` : String(s.year),
    data.configName(state.pair.right)].filter(Boolean).join(" · ") : "";
  if (!run) {
    $("a-week").textContent = "Week —";
    $("agents-body").innerHTML = `<div class="ag-empty card" style="padding:24px">${isLiveTask()
      ? "The team's messages appear here week by week once the live season starts."
      : "No Maize Runner team run for this season."}</div>`;
    return;
  }
  const last = Math.max(0, run.W - 1);
  const k = Math.min(state.week, isLiveTask() && liveActive() && !run.final ? liveWeek() : last);
  const w = run.weeks[k];
  const total = isLiveTask() && !run.final && state.facts.weeksPerSeason ? state.facts.weeksPerSeason : run.W;
  $("a-week").textContent = `Week ${weekNo(k)} of ${total}`;
  const verdict = data.weekVerdict(run, k);
  const reason = w.fallback ? (w.fallbacks[0] && w.fallbacks[0].why) : w.decision && w.decision.reason;
  const hero = `<section class="ag-hero card"><div class="ag-dec">${decisionHtml(w.decision) || "No decision logged"}</div>`
    + `<div class="ag-verdict">${verdictPill(verdict)}${w.fallback ? '<span class="flag-pill">Fallback</span>' : ""}</div>`
    + `<div class="ag-reason">${reason ? `<span class="who">${w.fallback ? "Fallback" : "Coordinator"}</span>${esc(firstSentence(mdPlain(reason)))}` : ""}</div></section>`;
  const toolsOf = (agent) => {
    const counts = {};
    for (const t of w.tools) if (t.agent === agent && t.name) counts[t.name] = (counts[t.name] || 0) + 1;
    return Object.entries(counts).map(([n, c]) => `<span>${esc(n)}${c > 1 ? ` ×${c}` : ""}</span>`).join("");
  };
  const msgs = (agent) => w.messages[agent] || [];
  const card = (agent, body, cls = "") => {
    const tools = toolsOf(agent);
    return `<article class="ag-card card ${agent} ${cls}" tabindex="0"><div class="ag-name">${esc(data.AGENT_NAMES[agent])}`
      + `${agent === "critic" ? verdictPill(verdict) : ""}</div>${tools ? `<div class="ag-tools">${tools}</div>` : ""}`
      + `${body || '<div class="ag-empty">No message this week.</div>'}</article>`;
  };
  const block = (m, tag = "") => `<div class="ag-msg">${tag ? `<span class="tag">${esc(tag)}</span>` : ""}${mdHtml(m.text)}</div>`;
  const plans = msgs("planner");
  const plannerBody = plans.map((m, i) => block(m, plans.length > 1 ? (i === 0 ? "Proposed" : "Revised after the objection") : "Proposed")).join("");
  const criticBody = msgs("critic").map((m) => block(m, m.objection ? "Objection" : "")).join("");
  const coordBody = msgs("coordinator").map((m) => block(m, "Decision")).join("")
    + w.fallbacks.map((f) => `<div class="ag-msg"><span class="flag-pill">Fallback</span> ${esc(f.why)}</div>`).join("");
  $("agents-body").innerHTML = hero + `<section class="ag-grid">`
    + card("weather", msgs("weather").map((m) => block(m)).join(""))
    + card("crop", msgs("crop").map((m) => block(m)).join(""))
    + card("planner", plannerBody)
    + card("critic", criticBody, verdict === "object" ? "objecting" : "")
    + card("coordinator", coordBody)
    + `</section>`;
  $("agents-body").querySelectorAll(".ag-card").forEach((c) => {
    c.onclick = () => c.classList.toggle("open");
    c.onkeydown = (e) => { if (e.key === "Enter") c.classList.toggle("open"); };
  });
}

// ---------------------------------------------------------------- Results page

// Headline, hero and tiles from agents_a/demo_results.json (resultsCharts.resultsPage); the dev tables stay collapsed
// below. Built once (the page does not depend on the season or week).
let summaryDev, evalDev, demoResults, resultsBuilt = false;
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
  if (resultsBuilt) return;
  if (summaryDev === undefined) {
    if (!$("results-body").innerHTML) $("results-body").innerHTML = `<header class="page-head"><div class="head"><h1>Team beats farmer on unseen seasons</h1>`
      + `<p class="sub">Loading agents_a/demo_results.json…</p></div></header>`;
    [summaryDev, evalDev, demoResults] = await Promise.all([data.loadSummaryDev(), data.loadEval(), data.loadDemoResults()]);
  }
  if (state.view !== "results") return;
  resultsBuilt = true;
  const failedRow = (head, c) => `<tr class="failed"><td>${esc(data.configName(c))}</td>`
    + `<td colspan="${head.length - 1}" class="quiet">failed to load</td></tr>`;
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => (r.failed ? failedRow(head, r.failed)
      : `<tr>${r.map((c, i) => `<td class="${i ? "mono" : ""}">${esc(c)}</td>`).join("")}</tr>`)).join("")}</tbody></table>`;
  const winCell = (st, w) => (st.config === REF ? "—" : w.n ? `${w.won} / ${w.n}` : "—");
  const evalRows = (evalDev && evalDev.rows) || [];
  const failed = new Set(((evalDev && evalDev.failed) || []).flatMap((f) => f.configs));
  const stats = configStats(evalRows).filter((st) => !failed.has(st.config));
  const statsHead = ["Config", "Seasons", "Mean profit ($/ha)", "Mean N leached (kg/ha)", "Mean grain (kg/ha)", "Profit wins, tuned", "Profit wins, not tuned"];
  const ok = demoResults && !(demoResults instanceof data.LoadError);
  let html = ok ? resultsPage(demoResults)
    : `<header class="page-head"><div class="head"><h1>Team beats farmer on unseen seasons</h1><p class="sub">Headline results unavailable: agents_a/demo_results.json ${demoResults ? "failed to load" : "is missing"}.</p></div></header>`;
  html += `<details class="res-more card"><summary>Full results: every config, all dev seasons</summary>`;
  if (ok && has(demoResults.test.ablation_d1d)) {
    html += `<div class="res-note" style="margin-top:10px">Next design (ablation, not the submitted one): independent Nitrogen and Water agents score `
      + `$${demoResults.test.ablation_d1d.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} on the same test seasons. `
      + `Final design: ${esc(demoResults.final_design || "")}.</div>`;
  }
  html += `<div class="res-head"><span class="label">All configs vs Farmer practice, dev seasons</span><span class="badge split">dev</span></div>`;
  html += stats.length || failed.size ? table(statsHead, data.sortConfigs([...stats.map((st) => st.config), ...failed]).map((c) => {
    const st = stats.find((x) => x.config === c);
    return st ? [data.configName(st.config), String(st.n), fmt(st.profit, 2), fmt(st.leached, 2), fmt(st.grain, 0), winCell(st, st.tuned), winCell(st, st.notTuned)]
      : { failed: c };
  })) : `<div class="quiet">No eval.csv dev rows.</div>`;
  const noRows = Object.keys(state.index || {}).filter((c) => !failed.has(c) && !stats.some((st) => st.config === c));
  html += `<div class="res-note">Means over each config's eval.csv dev rows. A win: profit above Farmer practice in the same season. `
    + `Tuned: dev 1990–2004 (prompts tuned on these). Not tuned: dev 2005–2009.`
    + `${noRows.length ? ` No eval.csv dev rows: ${esc(data.sortConfigs(noRows).map(data.configName).join(", "))}.` : ""}</div>`;
  html += `<div class="res-head"><span class="label">Baselines, all dev seasons</span><span class="badge split">dev</span></div>`;
  html += summaryDev instanceof data.LoadError ? `<div class="quiet">No dev summary: results_baseline/summary.md failed to load.</div>`
    : summaryDev ? table(summaryDev.head, summaryDev.rows.map((r) => [plainConfigCell(r[0]), ...r.slice(1)]))
    : `<div class="quiet">No dev summary: results_baseline/summary.md is missing.</div>`;
  html += `</details>`;
  $("results-body").innerHTML = html;
}

// ---------------------------------------------------------------- Gym page

// Maize Runner packaged as a NeMo Gym environment. Facts only from gym_env/ (cited per line); the dataset counts are
// counted from the dataset files themselves.
let gymBuilt = false;
async function renderGym() {
  if (gymBuilt) return;
  gymBuilt = true;
  const el = $("gym-body");
  el.innerHTML = `<header class="page-head"><div class="head"><h1>Packaged as a NeMo Gym environment</h1>`
    + `<p class="sub">Counting the dataset rows…</p></div></header>`;
  const [dev, test] = await Promise.all([data.countGymRows("dev"), data.countGymRows("test")]);
  const n = (v) => (v === null ? "not found" : String(v));
  el.innerHTML = `<header class="page-head"><div class="head"><h1>Packaged as a NeMo Gym environment</h1>`
    // gym_env/README.md:3 "FieldTwin wrapped for NeMo Gym (tested with nemo-gym==0.7.0)"
    + `<p class="sub">Maize Runner wrapped for NVIDIA NeMo Gym, tested with nemo-gym 0.7.0 · the same verifier scores the team and a single agent</p></div></header>`
    + `<section class="gym-grid">`
    + `<div class="gym-hero card"><div><div class="v big-num">${n(dev)}</div><div class="k">dev seasons <span class="badge split">dev</span></div></div>`
    + `<div><div class="v big-num">${n(test)}</div><div class="k">held-out test seasons <span class="badge split">test</span></div></div>`
    // gym_env/README.md:9 Dataset row; counts from gym_env/environments/fieldtwin/data/{dev,test}.jsonl
    + `<p class="gym-hero-text">Real Gainesville seasons as a NeMo Gym dataset, one row per season. One rollout = one season: `
    + `the model calls read tools and submits one decision per week until the crop matures.</p></div>`
    // gym_env/README.md:10 Resources server
    + `<div class="gym-card card"><h2>Resources server</h2><p>A thin adapter over the Maize Runner env server on port 9000.</p><p class="quiet">resources_servers/fieldtwin/app.py</p></div>`
    // gym_env/README.md:11 Tools
    + `<div class="gym-card card"><h2>Tools</h2><p>The env server's read tools plus submit_decision, one schema file for both.</p><p class="quiet">agents/tools.json</p></div>`
    // gym_env/README.md:12 Verifier
    + `<div class="gym-card card"><h2>Verifier</h2><p>The season's final reward: profit minus a penalty per kg of nitrate leached. Zero on every other step.</p><p class="quiet">prices in config.yaml</p></div>`
    // gym_env/README.md:13 Agents; README "The multi-agent team as a NeMo Gym agent"
    + `<div class="gym-card card"><h2>Our team as a NeMo Gym agent</h2><p>Weather, Crop, Planner, Critic and Coordinator run as a native agent server; every role calls the same Nemotron through NeMo Gym's model server.</p><p class="quiet">responses_api_agents/fieldtwin_team</p></div>`
    // gym_env/README.md:13 fieldtwin_gymnasium_agent
    + `<div class="gym-card card"><h2>Single-agent baseline</h2><p>NeMo Gym's built-in gymnasium agent: one model with all tools, scored by the same verifier.</p><p class="quiet">fieldtwin_gymnasium_agent</p></div>`
    // gym_env/README.md "The multi-agent team" bullets: prompts and schemas imported from agents_a/
    + `<div class="gym-card card"><h2>No drift</h2><p>Prompts, answer schemas and the fallback schedule are imported from the evaluated design, so the Gym team and the scored team match.</p><p class="quiet">agents_a/designs/d1c_multi</p></div>`
    + `</section>`;
}

// ---------------------------------------------------------------- timeline and week cards

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
  const objectionWeeks = state.runs.right ? state.runs.right.objectionWeeks : [];
  const cap = isLiveTask() && liveActive() && state.runs.right && !state.runs.right.final ? liveWeek() : null;
  timeline.setModel({ W, days, weeklyRain, rainNote, fallbackWeeks, objectionWeeks, cap });
}

// Week date range from the weather file (when aligned).
function dateRange(k) {
  if (!state.days || state.dayStart === null) return "";
  const a = state.days[state.dayStart + 7 * k], b = state.days[state.dayStart + 7 * k + 6] || a;
  const d = (x) => (x && x.date ? new Date(`${x.date}T00:00:00`) : null);
  const da = d(a), db = d(b);
  if (!da || Number.isNaN(+da) || !db || Number.isNaN(+db)) return "";
  const md = (x) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${md(da)} – ${md(db)}`;
}

// One week card: "Week N" and its dates, the team's decision ("40 kg N · 15 mm water", the applied amounts), the
// Critic's verdict pill (and the Fallback pill in a fallback week), and the Coordinator's one-line reason (the
// fallback's reason in a fallback week). Harvest: both fields' profit from the final lines.
function cardHtml(k, W) {
  const run = state.runs.right;
  if (k >= W) {
    const l = state.runs.left && state.runs.left.final, r = run && run.final;
    const line = l && r && has(l.profit_usd_ha) && has(r.profit_usd_ha)
      ? `Maize Runner ${money(r.profit_usd_ha)} vs farmer ${money(l.profit_usd_ha)} profit per hectare.` : "Season over.";
    return `<header class="wc-head"><span class="wc-week">Harvest</span></header><p class="wc-dec">Season done</p><p class="wc-text">${esc(line)}</p>`;
  }
  const w = run && k < run.W ? run.weeks[k] : null;
  const date = dateRange(k);
  const head = `<header class="wc-head"><span class="wc-week">Week ${weekNo(k)}</span>${date ? `<span class="wc-date mono">${esc(date)}</span>` : ""}</header>`;
  if (!w) return `${head}<p class="wc-text quiet">No Maize Runner decision this week.</p>`;
  const verdict = data.weekVerdict(run, k);
  const reason = w.fallback ? (w.fallbacks[0] && w.fallbacks[0].why) : w.decision && w.decision.reason;
  return head
    + `<p class="wc-dec">${decisionHtml(w.decision) || "No decision logged"}</p>`
    + `<div class="wc-verdict"><span>Critic</span>${verdictPill(verdict)}${w.fallback ? '<span class="flag-pill">Fallback</span>' : ""}</div>`
    + (reason ? `<p class="wc-reason"><span class="who">${w.fallback ? "Fallback" : "Coordinator"}</span> ${esc(cut(firstSentence(mdPlain(reason)), 180))}</p>` : "");
}

// Card counter: "Week N / W", 1-based (the same numbering as the Agents page), "Harvest" last.
function cardCounter(i) {
  const W = maxW();
  return i < W ? { cur: `Week ${weekNo(i)}`, tot: String(W) } : { cur: "Harvest", tot: "" };
}

function renderCards() {
  if (!cards) return;
  const W = maxW();
  const any = SIDES.some((s) => state.runs[s]);
  // Live: only the weeks the team has finished (plus the harvest once the season is done).
  const n = !any ? 0 : isLiveTask() && liveActive() && !(state.runs.right && state.runs.right.final)
    ? (state.runs.right ? liveWeek() + 1 : 0) : W + 1;
  cards.setItems(Array.from({ length: n }, (_, k) => cardHtml(k, W)), state.week);
  showCards();
}

function showCards() {
  $("weekcards").hidden = !(cards && state.cards && state.view === "season" && state.runs.right
    && !(isLiveTask() && live.phase === "done" && liveActive()));
}

// ---------------------------------------------------------------- loading

// Week 0 of a season in its weather file. Recorded seasons: data.seasonStart (day field or rain matching against the
// log). Live seasons (no log before Play): the day after the site's planting day (env/weather.py planting_doy), which
// is where the recorded Gainesville logs' week 0 starts (STATE.md real-log check: week 0 starts doy 58, planting 57).
function liveDayStart(site, days) {
  const doy = state.facts.plantingDoy[site];
  if (!days || !has(doy)) return null;
  const i = days.findIndex((d) => d.doy === doy + 1);
  return i >= 0 ? i : null;
}

// Load the logs for the current pair, then rescale and redraw everything. If either log fails to load (LoadError),
// neither field is shown: the load card stands in for the scene (no half scene).
async function loadPair() {
  const task = state.task;
  const isLive = data.isLive(task);
  const skip = isLive && live.started !== task;
  const loaded = await Promise.all(SIDES.map((s) => (state.pair[s] && !skip ? data.loadRun(state.pair[s], task) : null)));
  if (task !== state.task) return;   // the season changed while loading
  state.pairFailed = loaded.some((r) => r instanceof data.LoadError);
  SIDES.forEach((s, i) => (state.runs[s] = state.pairFailed ? null : loaded[i]));
  showScene();
  const ref = state.pairFailed ? null : loaded.find(Boolean);
  const p = data.parseTaskId(task) || {};
  const site = ref ? ref.site : isLive ? p.site : null, year = ref ? ref.year : isLive ? p.year : null;
  const days = site && year ? await data.loadWeather(site, year) : null;
  if (task !== state.task) return;
  state.days = days instanceof data.LoadError ? null : days;   // listed on the load card; the rain strip says so
  state.dayStart = isLive ? (data.seasonStart(ref, state.days) ?? liveDayStart(site, state.days)) : data.seasonStart(ref, state.days);
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
  state.week = isLive && live.started === task ? liveWeek() : Math.min(state.week, maxW());
  renderCards();
  setWeek(state.week, { force: true });
  renderLivePanels();
  if (state.view === "serving") renderServing($("serving-body"), liveRun());
}

// New season: the pair stays SEASON_PAIR.
async function selectTask(task) {
  setPlaying(false);
  state.task = task;
  live.started = null;   // coming back to the live season means a fresh run on Play
  live.phase = "idle";
  live.msg = "";
  stopLiveTick();
  const isLive = data.isLive(task);
  const s = season();
  if (s && s.site && !s.live) state.site = s.site;
  setLiveTask(isLive ? task : null);   // How it works follows the live season too
  document.querySelectorAll(".speed button").forEach((b) => (b.disabled = isLive && +b.dataset.speed !== 1));
  if (isLive) setSpeed(1);
  state.week = 0;
  renderSeasonHead();
  renderLivePanels();
  await loadPair();
}

// ---------------------------------------------------------------- live season

// The team's latest finished week (its step_result is in), or the harvest once the season is done.
function liveWeek() {
  const run = state.runs.right;
  if (!run) return 0;
  if (run.final) return run.W;
  let k = 0;
  run.weeks.forEach((w, i) => { if (w.step) k = i; });
  return k;
}

// The Maize Runner team's live run for the Serving page's "This run" panel, or null.
function liveRun() {
  return isLiveTask() && liveActive() ? state.runs.right : null;
}

// Who is working on the week in progress, from that week's log lines so far (the team's order: Weather and Crop in
// parallel, Planner, Critic, Planner again after an objection, Coordinator, then gym-DSSAT steps the week).
function workingNow(run) {
  const done = run.weeks.filter((w) => w.step).length;
  const w = run.weeks[done];
  if (!w || !w.events.length) return "Weather and Crop";
  const answered = (agent, name) => w.events.some((e) => e.agent === agent && e.kind === "message" && e.data
    && Array.isArray(e.data.tool_calls) && e.data.tool_calls.some((c) => c && c.name === name));
  if (w.policyDecision || answered("coordinator", "submit_decision")) return "gym-DSSAT";
  const plans = (w.messages.planner || []).length, verdict = data.weekVerdict(run, done);
  if (verdict === "object" && plans < 2) return "Planner";
  if (verdict) return "Coordinator";
  if (plans) return "Critic";
  if (answered("weather", "weather_report") && answered("crop", "crop_report")) return "Planner";
  return "Weather and Crop";
}

// Live numbers from the team's log timestamps: elapsed (first event to now; first event to the final line once done),
// finished weeks, and the next week's estimated arrival (mean week time so far after the last finished week).
function liveNumbers() {
  const run = state.runs.right;
  if (!run || !has(run.t0)) return null;
  const doneWeeks = run.weeks.filter((w) => w.step).length;
  const now = Date.now();
  const elapsed = run.final && has(run.tFinal) ? run.tFinal - run.t0 : Math.max(now - run.t0, (run.tLast || run.t0) - run.t0);
  const steps = run.stepT.filter(has);
  const lastStep = steps.length ? Math.max(...steps) : null;
  const meanWeek = steps.length ? (lastStep - run.t0) / steps.length : null;
  const eta = meanWeek !== null ? lastStep + meanWeek - now : null;
  return { run, doneWeeks, elapsed, eta, total: state.facts.weeksPerSeason };
}

function liveStatusHtml() {
  if (live.phase === "starting" || !state.runs.right) return `<b>Starting the live run…</b> the farmer's season first, then the team's week 1`;
  const L = liveNumbers();
  if (!L) return `<b>Starting the live run…</b>`;
  if (L.run.final) return `<b>Season complete</b> · ${L.doneWeeks} weeks in <b class="mono">${clock(L.elapsed)}</b>`;
  const wk = Math.min(L.doneWeeks + 1, L.total || Infinity);
  const eta = L.eta === null ? "first week in progress" : L.eta > 0 ? `next week in ~${Math.round(L.eta / 1000)} s` : "next week due now";
  return `<b>Week ${wk}${L.total ? ` of ${L.total}` : ""}</b> · <span class="mono">${clock(L.elapsed)}</span> elapsed · `
    + `<span class="live-now">${esc(workingNow(L.run))} working</span> · ${eta}`;
}

// Top-bar chip on every tab while a live season runs (and after it is done): "2026 live · week N of 20 · m:ss elapsed".
function renderLiveChip() {
  const on = !!live.started && ["starting", "running", "done"].includes(live.phase) && data.isLive(live.started);
  $("livechip").hidden = !on;
  if (!on) return;
  const year = (data.parseTaskId(live.started) || {}).year || live.started;
  const L = live.started === state.task ? liveNumbers() : null;
  let t = `${year} live · starting`;
  if (L && L.run.final) t = `${year} live · done · ${clock(L.elapsed)}`;
  else if (L) t = `${year} live · week ${Math.min(L.doneWeeks + 1, L.total || Infinity)}${L.total ? ` of ${L.total}` : ""} · ${clock(L.elapsed)} elapsed`;
  $("livechip").querySelector(".t").textContent = t;
}

// Before Play: the start panel (facts line, button, and the offline / stopped line when there is one). Done: the
// season-end card. Both only on the Season tab.
function renderLivePanels() {
  const onSeason = state.view === "season" && isLiveTask();
  const before = onSeason && (!liveActive() || ["idle", "offline", "stopped"].includes(live.phase));
  $("livepanel").hidden = !before;
  if (before) {
    const s = season(), days = state.days;
    const doy = s ? state.facts.plantingDoy[s.site] : null;
    const planted = s && has(doy) ? new Date(s.year, 0, doy).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
    const lastDay = days && days.length ? days[days.length - 1].date : null;
    const last = lastDay ? new Date(`${lastDay}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
    $("livefacts").textContent = [s ? SITE_SHORT[s.site] || s.site : null, planted ? `planted ${planted}` : null,
      last ? `weather observed to ${last}` : null].filter(Boolean).join(" · ");
    $("livemsg").hidden = !live.msg;
    $("livemsg").textContent = live.msg;
    $("livestart").textContent = live.phase === "stopped" || live.phase === "offline" ? "Try again" : "Start live season";
  }
  const done = onSeason && liveActive() && live.phase === "done";
  $("seasonend").hidden = !done;
  if (done) renderSeasonEnd();
  renderLiveChip();
  renderSeasonHead();
}

// Season-end card: Farmer vs Maize Runner from the live logs' final lines (profit, water, nitrogen, leaching) and the
// team's run time from its log timestamps. A value the logs do not hold reads "not in log" (and is reported once in
// the console); nothing is computed in its place.
function renderSeasonEnd() {
  const fl = state.runs.left && state.runs.left.final, fr = state.runs.right && state.runs.right.final;
  const rows = [["Profit ($/ha)", "profit_usd_ha", 0, ""], ["Water (mm)", "irr_mm", 0, ""], ["Nitrogen (kg/ha)", "n_applied", 0, ""],
    ["Leaching (kg/ha)", "n_leached", 1, "leach"]];
  const cell = (f, key, d, cls, side) => {
    const v = f && has(f[key]) ? f[key] : null;
    if (v === null) {
      const tag = `${side} final.${key}`;
      if (!missingLogged.has(tag)) { missingLogged.add(tag); console.info(`Season end: not in log: ${tag}`); }
      return `<span class="v na">not in log</span>`;
    }
    return `<span class="v ${side === "farmer" ? "farmer" : ""} ${cls}">${key === "profit_usd_ha" ? money(v) : fmt(v, d)}</span>`;
  };
  const L = liveNumbers();
  const runTime = L && state.runs.right && state.runs.right.final && has(state.runs.right.tFinal) ? clock(L.elapsed) : null;
  if (!runTime && !missingLogged.has("runtime")) { missingLogged.add("runtime"); console.info("Season end: not in log: team run timestamps"); }
  const s = season();
  const delta = fl && fr && has(fl.profit_usd_ha) && has(fr.profit_usd_ha) ? fr.profit_usd_ha - fl.profit_usd_ha : null;
  $("seasonend").innerHTML = `<div class="se-head"><h2>${s ? s.year : ""} season result</h2><span class="badge split">${s ? s.year : ""} live · one run</span></div>`
    + `<div class="se-grid"><span></span><span class="col farmer">Farmer practice</span><span class="col team">Maize Runner team</span>`
    + rows.map(([label, key, d, cls]) => `<span class="k">${label}</span>${cell(fl, key, d, cls, "farmer")}${cell(fr, key, d, cls, "team")}`).join("")
    + `</div><div class="se-foot"><span>Total run time <b class="mono">${runTime || "not in log"}</b></span>`
    + `${delta !== null ? `<span>Maize Runner vs farmer <b class="mono">${gapMoney(delta)}</b> profit</span>` : ""}`
    + `<span>Gainesville weather, gym-DSSAT, five Nemotron agents</span></div>`;
}

function startLiveTick() {
  if (live.tick) return;
  live.tick = setInterval(() => {
    renderLiveChip();
    if (state.view === "season" && isLiveTask()) renderSeasonHead();
  }, 1000);
}

function stopLiveTick() {
  clearInterval(live.tick);
  live.tick = null;
}

// The first Play on this page starts a fresh season (stopping any run left from before); Play after Pause
// picks the same run up again.
async function startLive() {
  const task = state.task;
  if (live.started === task && ["starting", "running"].includes(live.phase)) {
    clearInterval(live.timer); live.timer = setInterval(followLive, LIVE_POLL_MS); followLive(); return;
  }
  let res;
  try {
    res = await fetch(`/api/live/start?task=${encodeURIComponent(task)}&restart=1`, { method: "POST" });
  } catch { res = null; }
  if (task !== state.task) return;
  if (!res || !res.ok) {
    setPlaying(false);
    live.phase = "offline";
    live.msg = "Live server offline. Start it with: uv run python scripts/demo_server.py";
    renderLivePanels();
    return;
  }
  live.sig = "";
  live.started = task;
  live.phase = "starting";
  live.msg = "";
  liveStarted();
  startLiveTick();
  renderBadges();
  renderLivePanels();
  clearInterval(live.timer);
  live.timer = setInterval(followLive, LIVE_POLL_MS);
  followLive();
}

// Reload only when the team's log grew (a new week or the harvest), so the fields do not replay a week twice.
async function followLive() {
  const task = state.task;
  if (!state.playing || !data.isLive(task)) { clearInterval(live.timer); live.timer = null; return; }
  const run = await data.loadRun(state.pair.right, task);
  if (task !== state.task) return;
  if (!(run && run.final)) {   // the run stopped before the harvest: say why (e.g. the model tunnel is down)
    const st = await fetch("/api/live/status").then((r) => r.json()).catch(() => null);
    if (task !== state.task) return;
    if (st && !st.running && st.returncode !== null) {
      setPlaying(false);
      live.phase = "stopped";
      live.msg = `The live run stopped: ${(st.tail || []).slice(-1)[0] || "see runs/live/console.txt"}`;
      stopLiveTick();
      renderLivePanels();
      return;
    }
  }
  if (!run || run instanceof data.LoadError) return;
  let k = 0;
  run.weeks.forEach((w, i) => { if (w.step) k = i; });
  const sig = `${k}:${!!run.final}:${run.weeks.some((w) => w.step)}`;
  if (run.weeks.some((w) => w.step) && live.phase === "starting") live.phase = "running";
  if (sig === live.sig && state.runs.right) { renderSeasonHead(); return; }
  live.sig = sig;
  if (run.final) live.phase = "done";
  await loadPair();
  if (run.final) { setPlaying(false); stopLiveTick(); renderLivePanels(); }
}

// Week change: fields animate this week's data events (dose, uptake, leaching, storm) when the week moved.
function setWeek(k, { force = false } = {}) {
  const prev = state.week;
  // Live: the farmer's season is done in seconds, so stop at the team's latest finished week.
  const cap = isLiveTask() ? (liveActive() && state.runs.right ? liveWeek() : 0) : maxW();
  state.week = Math.max(0, Math.min(cap, k));
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
}

// ---------------------------------------------------------------- playback and input

function setPlaying(on) {
  state.playing = on;
  if (on && isLiveTask()) startLive();
  else if (on && state.week >= maxW()) setWeek(0);
  $("play").textContent = on ? "Pause" : "Play";
  $("play").classList.toggle("on", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
}

function setSpeed(s) {
  if (isLiveTask() && s !== 1) return;   // live: the weeks come as fast as the team decides
  state.speed = s;
  document.querySelectorAll(".speed button").forEach((b) => b.classList.toggle("on", +b.dataset.speed === s));
}

// [ and ] step through SPEEDS.
function stepSpeed(dir) {
  const i = SPEEDS.indexOf(state.speed);
  setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + dir))]);
}

// Site toggle: list that site's seasons and open its default (2024, else the newest available).
function setSite(site) {
  if (site === state.site) return;
  state.site = site;
  renderTaskPicker();
  const pick = state.seasons.filter((s) => !s.live && s.site === site && s.available)
    .sort((a, b) => (a.year === DEFAULT_YEAR ? -1 : b.year === DEFAULT_YEAR ? 1 : b.year - a.year))[0];
  if (pick) selectTask(pick.task);
}

function bind() {
  $("task").onchange = (e) => selectTask(e.target.value);
  document.querySelectorAll("#site button").forEach((b) => (b.onclick = () => setSite(b.dataset.site)));
  $("play").onclick = () => setPlaying(!state.playing);
  $("livestart").onclick = () => setPlaying(true);
  $("livechip").onclick = () => setView("season");
  $("prev").onclick = () => setWeek(state.week - 1);
  $("next").onclick = () => setWeek(state.week + 1);
  $("reset").onclick = () => { setPlaying(false); setWeek(0); };
  $("a-prev").onclick = () => setWeek(Math.min(state.week, Math.max(0, (state.runs.right ? state.runs.right.W : 1) - 1)) - 1);
  $("a-next").onclick = () => setWeek(state.week + 1);
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= String(VIEWS.length)) { setView(VIEWS[+e.key - 1]); return; }
    if (state.view === "how") {
      if (e.key === "ArrowRight") { e.preventDefault(); howStep(1); }   // no-op in live mode (howitworks.js)
      else if (e.key === "ArrowLeft") { e.preventDefault(); howStep(-1); }
      return;
    }
    if (state.view === "agents") {
      if (e.key === "ArrowRight") { e.preventDefault(); $("a-next").click(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); $("a-prev").click(); }
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
  let last = performance.now(), clk = 0;
  const frame = (now) => {
    const elapsed = (now - last) / 1000;
    last = now;
    if (state.playing && !isLiveTask()) {
      clk += (elapsed * state.speed) / theme.motion.weekSeconds;
      if (clk >= 1) {
        clk = 0;
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
  console.error("Maize Runner: 3D Season unavailable, falling back to ?view2d=1.", err);
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
  timeline = new Timeline($("timeline"), { onSeek: (k) => setWeek(k) });
  return true;
}

function loaded() {
  document.body.classList.remove("not-loaded");
  loop();
}

async function main() {
  readCssTheme();
  if (data.LITE) document.body.classList.add("lite");
  if (STORY) document.body.classList.add("story");
  buildDock();
  data.onLoadFailures(renderLoadCard);
  if (!(await initSeason())) return;
  setView(state.view);
  bind();
  renderSeasonHead();
  const [index, facts] = await Promise.all([data.loadIndex(), data.loadSeasonFacts()]);
  state.index = index;
  state.facts = facts;
  const liveSeasons = data.LIVE_TASKS.map((t) => {
    const p = data.parseTaskId(t) || {};
    return { task: t, site: p.site || null, year: p.year || null, split: "live", available: true, live: true };
  });
  state.seasons = [...liveSeasons, ...(await data.seasonList(await data.loadSeasonSplits()))];
  const unavailable = state.seasons.filter((s) => !s.available).map((s) => s.task);
  if (unavailable.length) console.info(`Maize Runner: seasons missing a Season log (unavailable): ${unavailable.join(", ")}`);
  // Default: Gainesville 2024, else the newest available Gainesville season, else any available recorded season.
  const rec = state.seasons.filter((s) => s.available && !s.live);
  const first = rec.find((s) => s.site === DEFAULT_SITE && s.year === DEFAULT_YEAR)
    || rec.filter((s) => s.site === DEFAULT_SITE).sort((a, b) => b.year - a.year)[0] || rec[0];
  const task = first ? first.task : null;
  if (state.index instanceof data.LoadError) state.index = null;   // tasks/dev.jsonl failed: the load card says why
  if (!task) {
    notice(state.seasons.length
      ? `No season from ${data.SEASON_MIN_YEAR} on has both ${Object.values(data.SEASON_PAIR).map(data.configName).join(" and ")} logs.`
      : `No seasons from ${data.SEASON_MIN_YEAR} on in the task files.`);
    renderFieldHeads();
    setWeek(0, { force: true });
    loaded();
    return;
  }
  await selectTask(task);
  loaded();
}

main();
