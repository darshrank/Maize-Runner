// Boot, page routing, keyboard, playback (UI_SPEC.md section 8). R2: pages Season, Agents, Results, Gym,
// Serving, switched by the dock (dock.js) or keys 1-5; no top bar. Season: two 2D neon fields side by side
// (fieldSvg.js), LEFT farmer baseline, RIGHT agent team, plus the rain strip and week scrubber. Agents: the
// full weekly chat for one run (agents.js). Results, Gym, Serving: quiet placeholders until their units.
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
  { id: "results", label: "Results", icon: "bars", file: "results/eval.csv" },
  { id: "gym", label: "Gym", icon: "loop", file: "results/iterations.json" },
  { id: "serving", label: "Serving", icon: "chip", file: "results/vllm_metrics.json" },
];
const VIEWS = PAGES.map((p) => p.id);
const STORY = new URLSearchParams(location.search).get("story") === "1";
const SIDES = ["left", "right"];

const state = {
  index: null, task: null, pair: { left: null, right: null }, runs: { left: null, right: null },
  days: null, dayStart: null, week: 0, playing: false, speed: 1, view: "season", agentSide: "right",
};
const fields = {};
let timeline, dock;

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

// ---------------------------------------------------------------- views

function setView(view) {
  const page = PAGES.find((p) => p.id === view);
  if (!page) return;
  state.view = view;
  if (dock) dock.setActive(view);
  $("season").hidden = view !== "season";
  $("agents").hidden = view !== "agents";
  $("placeholder").hidden = !page.file;
  if (page.file) {
    $("placeholder-title").textContent = page.label;
    $("placeholder-file").textContent = `Needs ${page.file}`;
  }
  if (view === "agents") renderAgents();
}

// ---------------------------------------------------------------- chrome

function renderTaskPicker() {
  const tasks = data.sortTasks(state.index);
  const html = tasks.map((t) => {
    const p = data.parseTaskId(t);
    return `<option value="${esc(t)}" title="${esc(t)}"${t === state.task ? " selected" : ""}>${esc(p ? p.year : t)}</option>`;
  }).join("");
  document.querySelectorAll("select.task").forEach((s) => (s.innerHTML = html));
}

// One source label top right: dev, test or FAKE (FAKE wins), from the runs on screen.
function renderBadges() {
  const runs = SIDES.map((s) => state.runs[s]).filter(Boolean);
  const fake = data.FAKE || runs.some((r) => r.fake);
  const split = (runs.find((r) => r.split) || {}).split || null;
  const label = fake ? (split ? `FAKE · ${split}` : "FAKE") : split;
  $("src").textContent = label || "";
  $("src").hidden = !label;
  $("src").classList.toggle("fake", fake);
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

function renderFieldHeads() {
  const others = data.configsFor(state.index, state.task);
  for (const side of SIDES) {
    const config = state.pair[side], run = state.runs[side];
    $(`name-${side}`).textContent = config ? data.fieldLabel(config, others) : "No run";
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
  const others = data.configsFor(state.index, state.task);
  $("cfg").innerHTML = SIDES.map((side) => {
    const config = state.pair[side];
    return `<button data-side="${side}" class="${side === state.agentSide ? "on" : ""}"${config ? "" : " disabled"}>`
      + `${esc(config ? data.fieldLabel(config, others) : "No run")}</button>`;
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
  timeline.setModel({ W, days, weeklyRain, rainNote });
}

// ---------------------------------------------------------------- loading

async function selectTask(task) {
  state.task = task;
  state.pair = data.defaultPair(state.index, task);
  const loaded = await Promise.all(SIDES.map((s) => (state.pair[s] ? data.loadRun(state.pair[s], task) : null)));
  SIDES.forEach((s, i) => (state.runs[s] = loaded[i]));
  const ref = loaded.find(Boolean);
  state.days = ref ? await data.loadWeather(ref.site, ref.year) : null;
  state.dayStart = data.seasonStart(ref, state.days);
  const scale = taskScale();
  for (const s of SIDES) {
    fields[s].setScale(scale);
    fields[s].motes.clear();
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
  for (const side of SIDES) {
    const run = state.runs[side];
    const events = moved && run ? data.weekEvents(run, Math.min(state.week, run.W), theme.stormMm) : [];
    fields[side].show(run ? snapshot(run, state.week) : null, events, spread);
  }
  timeline.setWeek(state.week);
  renderWeekLabel();
  renderTallies();
  renderAgents();
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
    if (state.view === "season") for (const s of SIDES) fields[s].tick(elapsed);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

function loaded() {
  document.body.classList.remove("not-loaded");
  loop();
}

async function main() {
  applyCssTheme();
  if (data.LITE) document.body.classList.add("lite");
  if (STORY) document.body.classList.add("story");   // story mode (later unit) hides the dock
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  dock = new Dock($("dock"), PAGES.map((p, i) => ({ id: p.id, label: p.label, icon: p.icon, key: String(i + 1) })),
    { onSelect: setView, reduceMotion });
  dock.setHidden(STORY);
  setView(state.view);
  for (const s of SIDES) fields[s] = new FieldView($(`plot-${s}`), { lite: data.LITE, reduceMotion });
  timeline = new Timeline($("timeline"), { onSeek: (k) => setWeek(k) });
  bind();
  state.index = await data.loadIndex();
  const task = state.index && data.defaultTask(state.index);
  if (!task) {
    notice(data.FAKE ? "No fake data: run uv run python -m lanec.scripts.fake_logs --ui"
      : "No runs yet: runs/index.json is missing or lists no task from tasks/. Play a season, or open with ?fake=1.");
    renderFieldHeads();
    setWeek(0, { force: true });
    loaded();
    return;
  }
  await selectTask(task);
  loaded();
}

main();
