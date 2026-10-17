// Boot, page routing, keyboard, playback (UI_SPEC.md section 8). R2: pages Season, Agents, Results, Gym,
// Serving, switched by the dock (dock.js) or keys 1-5; no top bar.
// Season (default): the 3D view (season3d.js), two floating field dioramas, LEFT farmer baseline, RIGHT agent
// team (or grid hindsight). Its only numbers: field names, one week label, and at season end the profit finale.
// The Critic objection and Coordinator reason show as one short caption in objection or storm weeks only.
// Season with ?view2d=1 (or after a WebGL / shader failure): the R1 2D side view (fieldSvg.js), kept as the
// fallback. Agents: the full weekly chat for one run (agents.js). Results: A's dev baselines
// (results_baseline/summary.md "Split: dev" table, eval.csv dev rows for the season). Gym, Serving: placeholders.
// Real data only, dev seasons only (data.js).
//
// Week semantics (STATE.md): position k in 0..W-1 shows week k's decision and its outcome (obs at the end of
// week k); k = W is harvest (the final line). Every number on screen comes from data.js. Theme: js/theme.js.

import { theme, applyCssTheme } from "./theme.js";
import * as data from "./data.js";
import { FieldView } from "./fieldSvg.js";
import { Timeline } from "./timeline.js";
import { weekLines, chatHtml, esc } from "./agents.js";
import { Dock } from "./dock.js";

export { theme };

const $ = (id) => document.getElementById(id);
// "How it works" moved to the deck (R2). Each placeholder names the data file its page will read.
const PAGES = [
  { id: "season", label: "Season", icon: "sprout" },
  { id: "agents", label: "Agents", icon: "chats" },
  { id: "results", label: "Results", icon: "bars" },
  { id: "gym", label: "Gym", icon: "loop", file: "results/iterations.json" },
  { id: "serving", label: "Serving", icon: "chip", file: "results/vllm_metrics.json" },
];
const VIEWS = PAGES.map((p) => p.id);
const params = new URLSearchParams(location.search);
const STORY = params.get("story") === "1";
const VIEW2D = params.get("view2d") === "1";
const REDUCE = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const SIDES = ["left", "right"];

const state = {
  index: null, task: null, configs: [], pair: { left: null, right: null }, runs: { left: null, right: null },
  days: null, dayStart: null, week: 0, playing: false, speed: 1, view: "season", agentSide: "right",
};
const fields = {};       // 2D FieldViews (view2d only)
let s3d = null;          // Season3D (3D only)
let timeline, dock, captionTimer = 0;

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

function money(v) {
  return `${v < 0 ? "−" : ""}$${fmt(Math.abs(v), 0)}`;
}

function signedMoney(v) {
  return `${v < 0 ? "−" : "+"}$${fmt(Math.abs(v), 0)}/ha`;
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
  $("stage3d").hidden = !s3d || view !== "season";
  if (s3d) s3d.setActive(view === "season");
  $("agents").hidden = view !== "agents";
  $("results").hidden = view !== "results";
  $("placeholder").hidden = !page.file;
  if (page.file) {
    $("placeholder-title").textContent = page.label;
    $("placeholder-file").textContent = `Needs ${page.file}`;
  }
  if (view === "agents") renderAgents();
  if (view === "results") renderResults();
}

// ---------------------------------------------------------------- chrome

function renderTaskPicker() {
  const tasks = data.seasons();
  const html = tasks.map((t) => {
    const p = data.parseTaskId(t);
    return `<option value="${esc(t)}" title="${esc(t)}"${t === state.task ? " selected" : ""}>${esc(p ? p.year : t)}</option>`;
  }).join("");
  document.querySelectorAll("select.task").forEach((s) => (s.innerHTML = html));
}

// One source label top right: the split from the runs on screen (always dev here).
function renderBadges() {
  const runs = SIDES.map((s) => state.runs[s]).filter(Boolean);
  const label = (runs.find((r) => r.split) || {}).split || null;
  $("src").textContent = label || "";
  $("src").hidden = !label;
  const fin = document.querySelector("#s3-mid .fin-src");
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

// A side with no log for the selected season says so quietly.
function renderFieldHeads() {
  if (s3d) {
    for (const side of SIDES) {
      document.querySelector(`#s3-head-${side} .s3-name`).textContent = fieldName(side);
      document.querySelector(`#s3-head-${side} .s3-none`).hidden = !!state.runs[side] || !state.pair[side];
    }
    return;
  }
  for (const side of SIDES) {
    const config = state.pair[side], run = state.runs[side];
    $(`name-${side}`).textContent = fieldName(side);
    const fb = run ? run.fallbackWeeks.length : 0;
    $(`fb-${side}`).textContent = `${fb} fallback week${fb === 1 ? "" : "s"}`;
    $(`fb-${side}`).hidden = !fb;
  }
}

function renderWeekLabel() {
  const W = maxW(), k = state.week;
  const harvest = k >= W;
  $("week-num").textContent = harvest ? "Harvest" : `Week ${k}`;
  $("week-of").textContent = harvest ? "" : `of ${W - 1}`;
  const day = state.days && state.dayStart !== null && !harvest ? state.days[state.dayStart + 7 * k] : null;
  const date = day && day.date ? new Date(`${day.date}T00:00:00`) : null;
  $("week-date").textContent = date && !Number.isNaN(+date)
    ? `from ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
}

// 3D: one week label; the finale at harvest; the caption when the week moved.
function render3d(moved) {
  const W = maxW(), k = state.week;
  $("s3-week").textContent = k >= W ? "Harvest" : `Week ${k}`;
  renderFinale();
  if (moved) renderCaption();
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
    const prof = document.querySelector(`#s3-head-${side} .fin-profit`);
    const p = final && has(final.profit_usd_ha) ? final.profit_usd_ha : null;
    if (p !== null && prof.hidden) countUp(prof.querySelector(".v"), p, money);
    prof.hidden = p === null;
    const leach = document.querySelector(`#s3-pool-${side} .fin-leach`);
    const nl = final && has(final.n_leached) ? final.n_leached : null;
    leach.hidden = nl === null;
    if (nl !== null) leach.innerHTML = `N leached <span class="mono">${fmt(nl, 1)}</span> kg/ha`;
  }
  const box = document.querySelector("#s3-mid .fin-delta");
  const l = finals.left && finals.left.profit_usd_ha, r = finals.right && finals.right.profit_usd_ha;
  const delta = has(l) && has(r) ? r - l : null;
  if (delta !== null && box.hidden) countUp(box.querySelector(".v"), delta, signedMoney);
  box.hidden = delta === null;
}

// Whole sentences up to max characters; one long first sentence is cut with an ellipsis.
function shorten(text, max = theme.three.caption.maxChars) {
  const parts = String(text).trim().split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break;
    out = out ? `${out} ${p}` : p;
  }
  return out || `${parts[0].slice(0, max - 1)}…`;
}

// RIGHT run (agent team) only, in weeks with a Critic objection or a storm: one caption, then it fades.
function renderCaption() {
  const el = $("s3-caption");
  clearTimeout(captionTimer);
  const run = state.runs.right;
  const w = run && run.hasAgents ? run.weeks[Math.min(state.week, run.W)] : null;
  const obj = w && !w.harvest ? w.chat.find((m) => m.objection) : null;
  const rain = w && !w.harvest && w.weekly && has(w.weekly.rain_mm) ? w.weekly.rain_mm : null;
  const reason = w && !w.harvest && w.decision ? w.decision.reason : null;
  const parts = [];
  if (obj || (rain !== null && rain > theme.stormMm)) {
    if (obj) parts.push(`<span class="who critic">Critic</span><span class="t critic">${esc(shorten(obj.text || "Objection"))}</span>`);
    if (reason) parts.push(`<span class="who coordinator">Coordinator</span><span class="t">${esc(shorten(reason))}</span>`);
  }
  if (!parts.length) {
    el.classList.remove("on");
    return;
  }
  el.innerHTML = parts.join("");
  el.classList.add("on");
  const hold = Math.max(2.5, Math.min(5, (theme.motion.weekSeconds / state.speed) * 2.5));
  captionTimer = setTimeout(() => el.classList.remove("on"), hold * 1000);
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
  $("a-week").textContent = k >= W ? "Harvest" : `Week ${k} of ${W - 1}`;
  const fb = run ? run.fallbackWeeks.length : 0;
  $("a-fb").textContent = `${fb} fallback week${fb === 1 ? "" : "s"}`;
  $("a-fb").hidden = !fb;
  $("agents-body").innerHTML = chatHtml(run, k);
}

// Results page: A's dev baselines only. The summary.md "Split: dev" table (config cells in plain labels), then
// the eval.csv dev rows for the selected season. Hindsight reads "Grid hindsight" (STATE.md data rules).
let summaryDev, evalDev;

function plainConfigCell(cell) {
  const config = String(cell).replace(/\s*\(.*\)\s*$/, "").trim();
  return data.configName(config);
}

async function renderResults() {
  if (summaryDev === undefined) [summaryDev, evalDev] = await Promise.all([data.loadSummaryDev(), data.loadEval()]);
  if (state.view !== "results") return;
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "mono" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  let html = `<div class="res-head"><span class="label">Baselines, all dev seasons</span><span class="badge">dev</span></div>`;
  html += summaryDev ? table(summaryDev.head, summaryDev.rows.map((r) => [plainConfigCell(r[0]), ...r.slice(1)]))
    : `<div class="quiet">No dev summary: results_baseline/summary.md is missing.</div>`;
  const p = data.parseTaskId(state.task);
  const rows = (evalDev || []).filter((r) => r.task_id === state.task);
  html += `<div class="res-head"><span class="label">Season ${esc(p ? p.year : state.task || "")}</span><span class="badge">dev</span></div>`;
  const cols = ["profit_usd_ha", "grain_kg_ha", "n_applied", "n_leached", "irr_mm", "reward"];
  html += rows.length ? table(["config", ...cols], data.sortConfigs(rows.map((r) => r.config))
    .map((c) => rows.find((r) => r.config === c)).map((r) => [data.configName(r.config), ...cols.map((h) => fmt(r[h], h === "profit_usd_ha" || h === "grain_kg_ha" || h === "n_applied" || h === "irr_mm" ? 0 : 1))]))
    : `<div class="quiet">No eval.csv dev rows for this season.</div>`;
  $("results-body").innerHTML = html;
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

// ---------------------------------------------------------------- loading

async function selectTask(task) {
  state.task = task;
  state.configs = await data.availableConfigs(state.index, task);
  state.pair = data.defaultPair(state.configs);
  const loaded = await Promise.all(SIDES.map((s) => (state.pair[s] ? data.loadRun(state.pair[s], task) : null)));
  SIDES.forEach((s, i) => (state.runs[s] = loaded[i]));
  const ref = loaded.find(Boolean);
  state.days = ref ? await data.loadWeather(ref.site, ref.year) : null;
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
  setWeek(Math.min(state.week, maxW()), { force: true });
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
    render3d(moved);
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
    if (e.key >= "1" && e.key <= "5") { setView(VIEWS[+e.key - 1]); return; }
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
      s3d.setOverlays([
        ...SIDES.map((side) => ({ el: $(`s3-head-${side}`), side, kind: "name" })),
        ...SIDES.map((side) => ({ el: $(`s3-pool-${side}`), side, kind: "pool" })),
        { el: $("s3-mid"), side: null, kind: "mid" },
      ]);
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
  applyCssTheme();
  if (data.LITE) document.body.classList.add("lite");
  if (STORY) document.body.classList.add("story");   // story mode (later unit) hides the dock
  dock = new Dock($("dock"), PAGES.map((p, i) => ({ id: p.id, label: p.label, icon: p.icon, key: String(i + 1) })),
    { onSelect: setView, reduceMotion: REDUCE });
  dock.setHidden(STORY);
  if (!(await initSeason())) return;
  setView(state.view);
  bind();
  state.index = await data.loadIndex();
  const task = state.index && data.defaultTask(state.index);
  if (!task) {
    notice("No dev seasons: tasks/dev.jsonl is missing or empty.");
    renderFieldHeads();
    setWeek(0, { force: true });
    loaded();
    return;
  }
  await selectTask(task);
  loaded();
}

main();
