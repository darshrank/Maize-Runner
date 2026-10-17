// Boot, view routing, keyboard, playback (UI_SPEC.md section 8). Unit 1: the Season view with one field and
// the timeline; the other views are quiet placeholders until their units.
//
// Week semantics (STATE.md): position k in 0..W-1 shows week k's decision and its outcome (obs at the end of
// week k); k = W is harvest (the final line). Every number on screen comes from data.js; a missing value
// shows "n/a" or "at harvest". Theme: js/theme.js (all colors and sizes).

import { theme, applyCssTheme } from "./theme.js";
import * as data from "./data.js";
import { Stage } from "./scene.js";
import { Field } from "./field3d.js";
import { Timeline } from "./timeline.js";
import { decisionHtml } from "./agents.js";

export { theme };

const $ = (id) => document.getElementById(id);
const VIEWS = ["season", "results", "improve", "serving", "how"];
const VIEW_TITLES = { results: "Results", improve: "Improve", serving: "Serving", how: "How it works" };

const state = {
  index: null, task: null, pair: { left: null, right: null }, shown: null,
  runs: {}, days: null, dayStart: null, week: 0, playing: false, speed: 1, view: "season",
};
let stage, field, timeline;

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

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// ---------------------------------------------------------------- views

function setView(view) {
  if (!VIEWS.includes(view)) return;
  state.view = view;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("season").hidden = view !== "season";
  $("placeholder").hidden = view === "season";
  if (view !== "season") {
    $("placeholder-title").textContent = VIEW_TITLES[view];
    $("placeholder-text").textContent = "Not built yet (UI_SPEC.md section 10, later unit).";
  }
}

// ---------------------------------------------------------------- top bar

function taskLabel(task) {
  const p = data.parseTaskId(task);
  return p ? `${p.year}` : task;
}

function renderTaskPicker() {
  const tasks = data.sortTasks(state.index);
  $("task").innerHTML = tasks.map((t) => `<option value="${esc(t)}" title="${esc(t)}"${t === state.task ? " selected" : ""}>${esc(taskLabel(t))}</option>`).join("");
}

function renderBadges() {
  const runs = Object.values(state.runs).filter(Boolean);
  const splits = [...new Set(runs.map((r) => r.split).filter(Boolean))];
  $("split").textContent = splits.join(" / ");
  $("split").hidden = !splits.length;
  $("fake").hidden = !(data.FAKE || runs.some((r) => r.fake));
}

// Chips come from data only: model and vLLM version from vllm_metrics.json, when it exists.
function renderChips(metrics) {
  const chips = [];
  if (metrics && metrics.model) chips.push(metrics.model);
  if (metrics && metrics.vllm_version) chips.push(`vLLM ${metrics.vllm_version}`);
  $("chips").innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join("");
}

// ---------------------------------------------------------------- season: field picker, HUD, counters

function fieldConfigs() {
  return data.configsFor(state.index, state.task);
}

function renderFieldPick() {
  const configs = fieldConfigs();
  $("field-pick").innerHTML = configs.map((c) => `<button data-config="${esc(c)}" class="${c === state.shown ? "on" : ""}">`
    + `${esc(data.configName(c))}${data.isFakeConfig(c) && !data.FAKE ? '<span class="tag">FAKE</span>' : ""}</button>`).join("")
    || `<span class="label">No runs for this season</span>`;
}

function shownRun() {
  return state.runs[state.shown] || null;
}

function weekState(run, k) {
  const w = run && run.weeks[Math.min(k, run.W)];
  if (!w || !w.obs) return null;
  return { biomass: w.obs.biomass_kg_ha, waterFrac: w.obs.soil_water_frac, leachedCum: w.cum ? w.cum.nLeached : null };
}

function renderHud() {
  const run = shownRun(), k = state.week;
  const W = run ? run.W : maxW();
  const w = run && run.weeks[Math.min(k, run.W)];
  const harvest = k >= W;
  $("week-num").textContent = harvest ? "H" : String(k).padStart(2, "0");
  $("week-of").textContent = harvest ? "harvest" : `of ${W - 1}`;
  const obs = (w && w.obs) || {};
  $("stage-v").textContent = obs.stage || "n/a";
  $("water-v").textContent = has(obs.soil_water_frac) ? obs.soil_water_frac.toFixed(3) : "n/a";
  $("biomass-v").textContent = has(obs.biomass_kg_ha) ? `${fmt(obs.biomass_kg_ha)} kg/ha` : "n/a";
  const rain = w && w.weekly && has(w.weekly.rain_mm) ? w.weekly.rain_mm : null;
  $("rain-v").textContent = rain !== null ? `${fmt(rain, 1)} mm` : "n/a";

  // Storm tag: a week whose logged rain is above theme.stormMm (UI_SPEC.md section 6).
  const storm = rain !== null && rain > theme.stormMm && !harvest;
  $("storm").hidden = !storm;
  if (storm) $("storm-v").textContent = `${fmt(rain, 0)} mm`;

  const card = $("decision");
  card.innerHTML = decisionHtml(run, Math.min(k, run ? run.W : k));
  card.classList.remove("enter");
  void card.offsetWidth;   // restart the fade
  card.classList.add("enter");
}

function renderCounters() {
  const run = shownRun();
  const w = run && run.weeks[Math.min(state.week, run.W)];
  const cum = (w && w.cum) || {};
  const final = w && w.harvest ? run.final : null;
  $("counters-for").textContent = run ? data.configName(run.config) : "No run";
  const src = data.sourceLabel(run);
  $("src").textContent = src || "";
  $("src").hidden = !src;
  $("src").classList.toggle("fake", !!(run && run.fake));
  const set = (key, v, digits, pending) => setNumber(document.querySelector(`.counter[data-k="${key}"] .v`), v, digits, pending);
  set("nApplied", run ? cum.nApplied : null, 0);
  set("nLeached", run ? cum.nLeached : null, 1);
  set("irr", run ? cum.irr : null, 0);
  const atHarvest = run && run.final ? "at harvest" : "n/a";
  set("grain", final ? final.grain_kg_ha : null, 0, atHarvest);
  set("profit", final ? final.profit_usd_ha : null, 0, atHarvest);
  set("reward", final ? final.reward : null, 0, atHarvest);
}

// ---------------------------------------------------------------- timeline model

function maxW() {
  const ws = Object.values(state.runs).filter(Boolean).map((r) => r.W);
  return ws.length ? Math.max(...ws) : 20;
}

function timelineRows() {
  const order = [state.pair.left, state.pair.right, state.shown].filter(Boolean);
  return [...new Set(order)].map((c) => ({ config: c, run: state.runs[c] || null, active: c === state.shown, fake: data.isFakeConfig(c) }));
}

function renderTimeline() {
  const W = maxW();
  const ref = shownRun() || Object.values(state.runs).find(Boolean) || null;
  const weeklyRain = Array.from({ length: W }, (_, k) => {
    const w = ref && ref.weeks[k];
    return w && w.weekly && has(w.weekly.rain_mm) ? w.weekly.rain_mm : null;
  });
  let days = null, rainNote = null;
  if (state.days && state.dayStart !== null) {
    days = state.days.slice(state.dayStart, state.dayStart + 7 * W).map((d) => (has(d.rain_mm) ? d.rain_mm : null));
  } else if (state.days) {
    rainNote = "weather file does not match the log";
  } else if (ref && ref.year) {
    rainNote = "no weather file";
  }
  timeline.setModel({ W, rows: timelineRows(), days, weeklyRain, rainNote });
}

// ---------------------------------------------------------------- loading

async function selectTask(task) {
  state.task = task;
  state.pair = data.defaultPair(state.index, task);
  const configs = fieldConfigs();
  // Never a fake config by default in real mode (defaultPair excludes runs/fake_*); the picker still offers it.
  if (!configs.includes(state.shown)) state.shown = state.pair.left || state.pair.right || null;
  const wanted = [...new Set([state.pair.left, state.pair.right, state.shown].filter(Boolean))];
  const loaded = await Promise.all(wanted.map((c) => data.loadRun(c, task)));
  state.runs = Object.fromEntries(wanted.map((c, i) => [c, loaded[i]]));
  const ref = state.runs[state.shown] || loaded.find(Boolean);
  state.days = ref ? await data.loadWeather(ref.site, ref.year) : null;
  state.dayStart = data.alignSeason(ref, state.days);
  renderTaskPicker();
  renderFieldPick();
  renderBadges();
  renderTimeline();
  setWeek(Math.min(state.week, maxW()));
}

async function showConfig(config) {
  if (!config || config === state.shown) return;
  state.shown = config;
  if (!(config in state.runs)) state.runs[config] = await data.loadRun(config, state.task);
  renderFieldPick();
  renderBadges();
  renderTimeline();
  setWeek(state.week);
}

function setWeek(k) {
  state.week = Math.max(0, Math.min(maxW(), k));
  field.setTarget(weekState(shownRun(), state.week));
  timeline.setWeek(state.week);
  renderHud();
  renderCounters();
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
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("task").onchange = (e) => selectTask(e.target.value);
  $("field-pick").onclick = (e) => { const b = e.target.closest("button[data-config]"); if (b) showConfig(b.dataset.config); };
  $("play").onclick = () => setPlaying(!state.playing);
  $("prev").onclick = () => setWeek(state.week - 1);
  $("next").onclick = () => setWeek(state.week + 1);
  $("reset").onclick = () => { setPlaying(false); setWeek(0); };
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= "5") { setView(VIEWS[+e.key - 1]); return; }
    if (state.view !== "season") return;
    if (e.key === " ") {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      if (!e.repeat) setPlaying(!state.playing);
    } else if (e.key === "ArrowRight") { e.preventDefault(); setWeek(state.week + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setWeek(state.week - 1); }
    else if (e.key === "r" || e.key === "R") { setPlaying(false); setWeek(0); stage.resetCamera(); }
  });
}

// One loop: play clock (wall time, so slow frames do not slow playback) and rendering.
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
    stage.render(Math.min(elapsed, 0.1));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

async function main() {
  applyCssTheme();
  stage = new Stage($("stage"), { lite: data.LITE });
  field = new Field({ lite: data.LITE });
  stage.addField(field, 0);
  timeline = new Timeline($("timeline"), { onSeek: setWeek, onPickRow: showConfig });
  bind();
  loop();
  data.loadVllmMetrics().then(renderChips);
  state.index = await data.loadIndex();
  const task = state.index && data.defaultTask(state.index);
  if (!task) {
    notice(data.FAKE ? "No fake data: run uv run python -m lanec.scripts.fake_logs --ui"
      : "No runs yet: runs/index.json is missing or empty. Play a season, or open with ?fake=1.");
    renderHud();
    renderCounters();
    return;
  }
  await selectTask(task);
}

main();
