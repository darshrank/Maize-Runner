// FieldTwin replay UI ("mission control"). Reads runs/index.json and runs/<config>/<task>.jsonl
// (frozen log format, SKELETON_SPEC.md section 8) and replays two runs side by side:
// left = farmer practice, right = FieldTwin (best available run), plus the impact of right minus left.
//
// Week semantics: everything uses the line-level week. Position k in 0..19 shows week k's
// decision and its outcome (state at the end of week k). k = 20 is harvest (the final line).
//
// Every number on screen is read from the logs. Small functions on purpose so the look can be
// restyled without touching data code.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RUNS = "../runs";
const WEEKS = 20;
const GRID = 12;
const BEST_ORDER = ["multi", "single", "hindsight"];   // "best available" for the right field
const STORM_MM = 60;                                    // weekly rain shown as a storm week
const TWEEN_MS = 250;
const MINUS = "−";
const AGENT_ORDER = ["weather", "crop", "planner", "critic", "coordinator"];
const AGENT_NAMES = { weather: "Weather", crop: "Crop", planner: "Planner", critic: "Critic", coordinator: "Coordinator" };
const CONFIG_LABELS = { farmer: "Farmer practice", hindsight: "grid hindsight", no_n: "No nitrogen", multi: "FieldTwin", fake_multi: "FieldTwin" };
const AGENT_COLORS = { coordinator: "#76b900" };       // raw events: others use the muted default

const state = {
  index: {}, task: null, week: 0, playing: false, speed: 1, rawOpen: false,
  configs: { left: null, right: null }, runs: { left: null, right: null }, fields: {},
};
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- data

async function loadIndex() {
  const r = await fetch(`${RUNS}/index.json`, { cache: "no-store" });
  if (!r.ok) throw new Error("runs/index.json not found: play a season first");
  return r.json();
}

async function loadRun(config, task) {
  if (!config || !(state.index[config] || []).includes(task)) return null;
  const r = await fetch(`${RUNS}/${config}/${task}.jsonl`, { cache: "no-store" });
  if (!r.ok) return null;
  const events = (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return buildRun(config, events);
}

// Turn the flat event list into one record per line-level week (0..20).
function buildRun(config, events) {
  const weeks = Array.from({ length: WEEKS + 1 }, () => ({ events: [], decision: null, step: null }));
  let final = null, finalWeek = null, split = null;
  let leachedCum = 0;
  for (const e of events) {
    const w = weeks[Math.min(Math.max(e.week, 0), WEEKS)];
    w.events.push(e);
    if (e.kind === "step_result") w.step = e.data;
    if (e.kind === "final") { final = e.data; finalWeek = Math.min(Math.max(e.week, 0), WEEKS); }
    if (e.kind === "message" && e.data && e.data.task && e.data.task.split) split = e.data.task.split;
  }
  let lastObs = null;
  weeks.forEach((w) => {
    w.decision = pickDecision(w.events);
    w.objection = w.events.some(isObjection);
    w.fallback = w.events.some((e) => e.kind === "fallback");
    if (w.step) lastObs = w.step.obs;
    w.obs = w.step ? w.step.obs : lastObs;        // harvest keeps the last observed state
    leachedCum += w.step ? w.step.weekly.n_leached : 0;
    w.leachedCum = leachedCum;
  });
  const run = { config, weeks, final, finalWeek, split };
  run.agents = hasAgents(run);
  return run;
}

function allTasks(index) {
  const tasks = new Set(Object.values(index).flat());
  return [...tasks].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function configsFor(task) {
  return Object.keys(state.index).filter((c) => state.index[c].includes(task)).sort();
}

function bestConfig(task, exclude) {
  const avail = configsFor(task).filter((c) => c !== exclude);
  return BEST_ORDER.find((c) => avail.includes(c)) || firstReal(avail) || avail[0] || exclude;
}

// Fake logs (runs/fake_*) are for UI testing only: never a default when a real run exists.
function isFake(config) {
  return typeof config === "string" && config.startsWith("fake_");
}

function firstReal(configs) {
  return configs.find((c) => !isFake(c));
}

// Coordinator decision wins over the runner's policy/decision line; baselines only have the latter.
function pickDecision(events) {
  const decisions = events.filter((e) => e.kind === "decision");
  const chosen = decisions.find((e) => e.agent === "coordinator")
    || decisions.find((e) => e.agent === "policy") || decisions[decisions.length - 1];
  return chosen ? chosen.data : null;
}

function isObjection(e) {
  return e.agent === "critic" && e.kind === "message" && !!e.data && e.data.objection === true;
}

function hasAgents(run) {
  return run.weeks.some((w) => w.events.some((e) => AGENT_ORDER.includes(e.agent)));
}

function fallbackWeekCount(run) {
  return run.weeks.filter((w) => w.fallback).length;
}

function harvested(run) {
  return !!(run && run.final && run.finalWeek !== null && state.week >= run.finalWeek);
}

// ---------------------------------------------------------------- 3D field

const WATER_COLOR = new THREE.Color("#c6ef8a");   // core glow = soil water
const N_COLOR = new THREE.Color("#22d3ee");       // cyan is reserved for nitrogen

class Field {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 13, 21);
    this.camera.lookAt(0, -1.2, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.buildSoil();
    this.buildCubes();
    this.buildDrips();
    // Smoothed display values and their targets.
    this.cur = { water: 0.6, height: 0.3 };
    this.target = { water: 0.6, height: 0.3, nStrength: 0, leach: 0 };
    this.pulseT = 0;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildSoil() {
    const soil = new THREE.Mesh(
      new THREE.BoxGeometry(GRID + 0.6, 0.15, GRID + 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.9, transparent: true, opacity: 0.85 }),
    );
    soil.position.y = -0.08;
    this.scene.add(soil);
  }

  // 12x12 glass shells (shared material) with an emissive core each (own material, for the pulse).
  buildCubes() {
    const shellGeo = new THREE.BoxGeometry(0.82, 1, 0.82).translate(0, 0.5, 0);
    const coreGeo = new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, 0.5, 0);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x8fa6bf, metalness: 0, roughness: 0.15, transmission: 0.2, thickness: 0.3,
      ior: 1.4, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 0.5, depthWrite: false,
    });
    this.cubes = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = i - (GRID - 1) / 2, z = j - (GRID - 1) / 2;
        const shell = new THREE.Mesh(shellGeo, glass);
        const core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({
          color: 0x050505, emissive: WATER_COLOR.clone(), emissiveIntensity: 0.5,
        }));
        shell.position.set(x, 0, z);
        core.position.set(x, 0.02, z);
        this.scene.add(shell, core);
        // Small fixed per-cube jitter so the field does not look like a single block.
        this.cubes.push({ shell, core, col: i, jitter: 0.85 + 0.3 * pseudoRandom(i * 31 + j) });
      }
    }
  }

  // Red leaching particles dripping below the field.
  buildDrips() {
    this.maxDrips = 300;
    const pos = new Float32Array(this.maxDrips * 3);
    this.dripSpeed = new Float32Array(this.maxDrips);
    for (let k = 0; k < this.maxDrips; k++) this.respawnDrip(pos, k, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    this.drips = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff4d4d, size: 0.28 }));
    this.scene.add(this.drips);
  }

  respawnDrip(pos, k, randomY) {
    pos[k * 3] = (Math.random() - 0.5) * GRID;
    pos[k * 3 + 1] = randomY ? -0.2 - Math.random() * 4 : -0.2;
    pos[k * 3 + 2] = (Math.random() - 0.5) * GRID;
    this.dripSpeed[k] = 1.2 + Math.random() * 1.5;
  }

  // Set targets from one week of a run (or null = no run for this task).
  setWeek(weekRec) {
    const obs = weekRec && weekRec.obs;
    this.target.water = obs ? obs.soil_water_frac : 0.5;
    this.target.height = obs ? 0.3 + Math.min(obs.biomass_kg_ha / 20000, 1.4) * 1.6 : 0.3;
    const n = weekRec && weekRec.decision ? weekRec.decision.n_kg_ha : 0;
    this.target.nStrength = Math.min(n / 80, 1.5);
    this.target.leach = weekRec && weekRec.step ? weekRec.step.weekly.n_leached : 0;
    this.pulseT = 0;   // restart the N pulse wave
  }

  animate(dt) {
    const k = 1 - Math.exp(-dt * 4);
    this.cur.water += (this.target.water - this.cur.water) * k;
    this.cur.height += (this.target.height - this.cur.height) * k;
    this.pulseT += dt;
    this.updateCubes();
    this.updateDrips(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCubes() {
    // Pulse: a cyan wave that sweeps across the columns, repeating every 2.5 s.
    const front = ((this.pulseT % 2.5) / 1.6) * (GRID + 6) - 3;
    for (const c of this.cubes) {
      const h = this.cur.height * c.jitter;
      c.shell.scale.y = h;
      c.core.scale.y = h * 0.9;
      const wave = this.target.nStrength * Math.exp(-((c.col - front) ** 2) / 2.5);
      const m = c.core.material;
      m.emissive.copy(WATER_COLOR).lerp(N_COLOR, Math.min(3 * wave, 1));
      m.emissiveIntensity = 0.03 + 1.6 * this.cur.water ** 2 + 0.8 * wave;   // brightness = soil water
    }
  }

  updateDrips(dt) {
    const count = Math.min(this.maxDrips, Math.round(this.target.leach * 12));   // count by kg leached
    this.drips.geometry.setDrawRange(0, count);
    const pos = this.drips.geometry.attributes.position.array;
    for (let k = 0; k < count; k++) {
      pos[k * 3 + 1] -= this.dripSpeed[k] * dt;
      if (pos[k * 3 + 1] < -4.5) this.respawnDrip(pos, k, false);
    }
    this.drips.geometry.attributes.position.needsUpdate = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------- formatting

function fmt(v, digits = 0) {
  return v === undefined || v === null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtFixed(v, digits) {
  return Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtSigned(v, digits, prefix = "") {
  const sign = v > 0 ? "+" : v < 0 ? MINUS : "";
  return `${sign}${prefix}${fmtFixed(v, digits)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function configLabel(config) {
  return CONFIG_LABELS[config] || `FieldTwin · ${config}`;
}

function fakeBadge(config) {
  return isFake(config) ? ` <span class="fake-badge" title="Fake log for UI testing, not a real run">FAKE</span>` : "";
}

function configNameHtml(config) {
  return escapeHtml(configLabel(config)) + fakeBadge(config);
}

function weekText(k) {
  return k >= WEEKS ? "Harvest" : `Week ${k}`;
}

// Tween a number in place over TWEEN_MS; value null shows `text` muted (e.g. "at harvest").
function setNumber(el, value, format, text = "—") {
  cancelAnimationFrame(el._raf);
  if (value === null || value === undefined || Number.isNaN(value)) {
    el._v = undefined;
    el.textContent = text;
    el.classList.add("pending");
    return;
  }
  el.classList.remove("pending");
  const from = typeof el._v === "number" ? el._v : value;
  el._v = value;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / TWEEN_MS, 1);
    el.textContent = format(from + (value - from) * (1 - (1 - p) ** 3));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  step(t0);
}

// ---------------------------------------------------------------- impact bar

// green when the right run is better, red when worse; `better` = +1 if higher is better, -1 if lower.
function setTone(card, delta, better) {
  const good = delta !== null && delta * better > 1e-9;
  const bad = delta !== null && delta * better < -1e-9;
  card.classList.toggle("good", good);
  card.classList.toggle("bad", bad);
}

function renderImpact() {
  const L = state.runs.left, R = state.runs.right;
  const cards = { leach: $("impact-leach"), n: $("impact-n"), profit: $("impact-profit") };
  const ready = L && R && L !== R && L.config !== R.config;
  $("impact-caption").innerHTML = ready
    ? `${configNameHtml(R.config)} minus ${configNameHtml(L.config)} · ${state.week >= WEEKS ? "full season" : `through week ${state.week}`}`
    : "Needs two different runs for this season";
  const lw = ready ? L.weeks[state.week] : null, rw = ready ? R.weeks[state.week] : null;

  const kept = ready ? lw.leachedCum - rw.leachedCum : null;              // farmer leached minus FieldTwin leached
  setNumber(cards.leach.querySelector(".v"), kept, (v) => (v < 0 ? MINUS : "") + fmtFixed(v, 1));
  setTone(cards.leach, kept, +1);

  const nL = lw && lw.obs ? lw.obs.n_applied_total : null, nR = rw && rw.obs ? rw.obs.n_applied_total : null;
  const dn = nL !== null && nR !== null ? nR - nL : null;
  setNumber(cards.n.querySelector(".v"), dn, (v) => fmtSigned(v, 0));
  setTone(cards.n, dn, -1);

  const dp = ready && harvested(L) && harvested(R) ? R.final.profit_usd_ha - L.final.profit_usd_ha : null;
  setNumber(cards.profit.querySelector(".v"), dp, (v) => fmtSigned(v, 0, "$"), ready ? "at harvest" : "—");
  setTone(cards.profit, dp, +1);
}

// ---------------------------------------------------------------- fields and counters

function renderCounters(side) {
  const panel = $(`field-${side}`);
  const run = state.runs[side];
  const w = run ? run.weeks[state.week] : null;
  const obs = (w && w.obs) || {};
  const done = harvested(run);
  const v = (k) => panel.querySelector(`.v[data-k="${k}"]`);
  setNumber(v("n"), run ? obs.n_applied_total : null, (x) => `${fmt(x)} kg/ha`);
  setNumber(v("leach"), w ? w.leachedCum : null, (x) => `${fmtFixed(x, 1)} kg/ha`);
  setNumber(v("grain"), done ? run.final.grain_kg_ha : null, (x) => `${fmt(x)} kg/ha`, run ? "at harvest" : "—");
  setNumber(v("profit"), done ? run.final.profit_usd_ha : null, (x) => `${x < 0 ? MINUS : ""}$${fmt(Math.abs(x))}/ha`, run ? "at harvest" : "—");
}

// Right field title: the picker doubles as the label (no repeated name), plain label if only one choice.
function renderRightPicker() {
  const sel = $("right-picker");
  const options = configsFor(state.task).filter((c) => c !== state.configs.left);
  sel.innerHTML = options.map((c) => `<option value="${escapeHtml(c)}" ${c === state.configs.right ? "selected" : ""}>`
    + `${escapeHtml(configLabel(c))}${isFake(c) ? " [FAKE]" : ""}</option>`).join("");
  sel.hidden = options.length < 2;
}

// Field titles from the loaded configs; with a visible right picker, the label only carries the FAKE badge.
function renderFieldLabels() {
  for (const side of ["left", "right"]) {
    const run = state.runs[side];
    const label = $(`field-${side}`).querySelector(".field-label");
    if (!run) label.textContent = "No run";
    else if (side === "right" && !$("right-picker").hidden) label.innerHTML = fakeBadge(run.config).trim();
    else label.innerHTML = configNameHtml(run.config);
  }
}

function renderHeaderTags() {
  const runs = [state.runs.left, state.runs.right].filter(Boolean);
  const splits = [...new Set(runs.map((r) => r.split).filter(Boolean))];
  $("split-tag").textContent = splits.join(" / ");
  $("split-tag").hidden = !splits.length;
  $("fake-tag").hidden = !runs.some((r) => isFake(r.config));
}

// ---------------------------------------------------------------- agent feed

function messageText(d) {
  return d && (d.text || d.content);
}

function chipsHtml(names, extra = "") {
  return `<span class="chips">${extra}${names.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join("")}</span>`;
}

function decisionSummary(d) {
  return `<span class="n">N ${fmt(d.n_kg_ha, 1)} kg/ha</span> · irrigation ${fmt(d.irr_mm, 1)} mm`;
}

// One line per agent: message text, tool names as chips, objection / fallback markers.
function agentBubbleHtml(agent, events) {
  const mine = events.filter((e) => e.agent === agent);
  if (!mine.length) return "";
  const texts = mine.filter((e) => e.kind === "message").map((e) => messageText(e.data)).filter(Boolean);
  const fallbacks = mine.filter((e) => e.kind === "fallback").map((e) => messageText(e.data) || JSON.stringify(e.data));
  const tools = mine.filter((e) => e.kind === "tool_call").map((e) => e.data && e.data.name).filter(Boolean);
  const objection = mine.some(isObjection);
  const text = [...texts, ...fallbacks].join(" · ");
  const marks = (objection ? `<span class="chip objection">Objection</span>` : "")
    + (fallbacks.length ? `<span class="chip fallback">Fallback</span>` : "");
  const cls = ["bubble", objection ? "objection" : "", fallbacks.length ? "fallback" : ""].join(" ");
  return `<div class="${cls}" title="${escapeHtml(text)}"><span class="who">${AGENT_NAMES[agent]}</span>`
    + `<span class="text">${escapeHtml(text)}</span>${chipsHtml(tools, marks)}</div>`;
}

// Coordinator: final bubble with the (deduped) decision and its reason.
function coordinatorBubbleHtml(w) {
  const mine = w.events.filter((e) => e.agent === "coordinator");
  if (!mine.length && !w.decision) return "";
  const fallbacks = mine.filter((e) => e.kind === "fallback").map((e) => messageText(e.data) || JSON.stringify(e.data));
  const tools = mine.filter((e) => e.kind === "tool_call").map((e) => e.data && e.data.name).filter(Boolean);
  const notes = [...mine.filter((e) => e.kind === "message").map((e) => messageText(e.data)), ...fallbacks].filter(Boolean);
  const marks = fallbacks.length ? `<span class="chip fallback">Fallback</span>` : "";
  const d = w.decision;
  return `<div class="bubble coordinator ${fallbacks.length ? "fallback" : ""}" title="${escapeHtml(notes.join(" · "))}">`
    + `<div class="row"><span class="who">Coordinator</span>`
    + `<span class="decision">${d ? decisionSummary(d) : "no decision"}</span>${chipsHtml(tools, marks)}</div>`
    + (d && d.reason ? `<div class="reason">${escapeHtml(d.reason)}</div>` : "") + `</div>`;
}

function feedHtml(run) {
  if (!run) return `<div class="bubble muted">No run for this season</div>`;
  const w = run.weeks[state.week];
  if (!run.agents) {
    const d = w.decision;
    return `<div class="bubble baseline"><span class="text">Baseline policy, no agents${d ? ` · ${decisionSummary(d)}` : ""}</span></div>`;
  }
  const html = AGENT_ORDER.filter((a) => a !== "coordinator").map((a) => agentBubbleHtml(a, w.events)).join("")
    + coordinatorBubbleHtml(w);
  return html || `<div class="bubble muted">${state.week >= WEEKS ? "Season complete" : "No agent activity this week"}</div>`;
}

function renderAgents() {
  for (const side of ["left", "right"]) {
    const col = $(`feed-${side}`);
    col.innerHTML = feedHtml(state.runs[side]);
    col.classList.remove("enter");
    void col.offsetWidth;   // restart the enter transition
    col.classList.add("enter");
  }
}

// ---------------------------------------------------------------- raw events

function bubble(agent, cls, body) {
  const color = AGENT_COLORS[agent] || "";
  return `<div class="raw ${cls}" ${color ? `style="--agent:${color}"` : ""}><div class="who">${escapeHtml(agent)} · ${cls}</div>${body}</div>`;
}

function json(data) {
  return `<pre>${escapeHtml(JSON.stringify(data, null, 1))}</pre>`;
}

// One raw block per log event; tool calls collapsed.
function eventHtml(e) {
  const d = e.data;
  switch (e.kind) {
    case "tool_call":
      return bubble(e.agent, "tool", `<details><summary>call ${escapeHtml(d.name)}</summary>${json(d.args || {})}</details>`);
    case "tool_result":
      return bubble(e.agent, "tool", `<details><summary>${escapeHtml(d.name)} result</summary>${json(d.result)}</details>`);
    case "decision":
      return bubble(e.agent, "decision",
        `<div>N ${fmt(d.n_kg_ha, 1)} kg/ha · irrigation ${fmt(d.irr_mm, 1)} mm</div><div class="reason">${escapeHtml(d.reason)}</div>`);
    case "step_result": {
      const wk = d.weekly;
      const clamp = d.clamped ? " · <b>clamped</b>" : "";
      return bubble(e.agent, "step",
        `rain ${fmt(wk.rain_mm)} mm · N uptake ${fmt(wk.n_uptake, 1)} · leached ${fmt(wk.n_leached, 1)} kg/ha${clamp}`);
    }
    case "final":
      return bubble(e.agent, "final", `grain ${fmt(d.grain_kg_ha)} kg/ha · profit $${fmt(d.profit_usd_ha)} · reward ${fmt(d.reward)}`);
    case "fallback":
      return bubble(e.agent, "fallback", json(d));
    default: {   // message
      if (d && d.reset) return bubble(e.agent, "message", `season reset: ${escapeHtml(d.task ? d.task.task_id : "")}`);
      const text = messageText(d);
      return bubble(e.agent, "message", text ? escapeHtml(text) : json(d));
    }
  }
}

function renderLog() {
  if (!state.rawOpen) return;
  for (const side of ["left", "right"]) {
    const run = state.runs[side];
    const events = run ? run.weeks[state.week].events : [];
    $(`raw-${side}`).innerHTML = events.length ? events.map(eventHtml).join("") : `<div class="raw">No events.</div>`;
  }
}

function toggleRaw() {
  state.rawOpen = !state.rawOpen;
  $("raw-toggle").setAttribute("aria-expanded", String(state.rawOpen));
  $("raw-body").hidden = !state.rawOpen;
  renderLog();
}

// ---------------------------------------------------------------- timeline scrubber

// Build the ticks once per loaded pair; setWeek only toggles classes (so transitions run).
function renderWeather() {
  const runs = [state.runs.left, state.runs.right].filter(Boolean);
  const rainAt = (k) => {
    const r = runs.find((x) => x.weeks[k].step);
    return r ? r.weeks[k].step.weekly.rain_mm : null;
  };
  const rain = Array.from({ length: WEEKS }, (_, k) => rainAt(k));
  const max = Math.max(1e-9, ...rain.filter((v) => v !== null));
  const ticks = rain.map((mm, k) => {
    const obj = runs.some((r) => r.weeks[k].objection), fb = runs.some((r) => r.weeks[k].fallback);
    const tip = [`Week ${k}`, mm !== null ? `rain ${fmt(mm)} mm` : "", obj ? "objection" : "", fb ? "fallback" : ""].filter(Boolean).join(" · ");
    return `<button class="tick ${mm !== null && mm >= STORM_MM ? "storm" : ""}" data-week="${k}" title="${tip}">`
      + `<span class="dots">${obj ? `<i class="dot objection"></i>` : ""}${fb ? `<i class="dot fallback"></i>` : ""}</span>`
      + `<span class="rain" style="height:${mm !== null ? (28 * mm) / max : 0}px"></span>`
      + `<span class="base"></span><span class="lbl">${k}</span></button>`;
  }).join("");
  $("ticks").innerHTML = ticks + `<button class="tick harvest" data-week="${WEEKS}" title="Harvest">`
    + `<span class="base"></span><span class="lbl">Harvest</span></button>`;

  const objections = runs.reduce((s, r) => s + r.weeks.filter((w) => w.objection).length, 0);
  const fallbacks = runs.reduce((s, r) => s + fallbackWeekCount(r), 0);
  $("scrub-legend").innerHTML = `<span><i class="dot objection"></i>Objection weeks ${objections}</span>`
    + `<span><i class="dot fallback"></i>Fallback weeks ${fallbacks}</span>`;
}

function updateScrubber() {
  $("week-label").textContent = weekText(state.week);
  $("ticks").querySelectorAll(".tick").forEach((t) => {
    const k = +t.dataset.week;
    t.classList.toggle("past", k < state.week);
    t.classList.toggle("current", k === state.week);
  });
}

// ---------------------------------------------------------------- controls

function fillSelect(sel, values, selected) {
  sel.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");
}

function setWeek(k) {
  state.week = Math.max(0, Math.min(WEEKS, k));
  for (const side of ["left", "right"]) {
    state.fields[side].setWeek(state.runs[side] ? state.runs[side].weeks[state.week] : null);
    renderCounters(side);
  }
  renderImpact();
  renderAgents();
  updateScrubber();
  renderLog();
}

async function selectTask(task) {
  state.task = task;
  const configs = configsFor(task);
  if (!configs.includes(state.configs.left)) {
    state.configs.left = configs.includes("farmer") ? "farmer" : firstReal(configs) || configs[0];
  }
  state.configs.right = bestConfig(task, state.configs.left);
  renderRightPicker();
  await loadSides();
}

async function loadSides() {
  [state.runs.left, state.runs.right] = await Promise.all(
    ["left", "right"].map((s) => loadRun(state.configs[s], state.task)));
  renderHeaderTags();
  renderFieldLabels();
  renderWeather();
  setWeek(state.week);
}

function togglePlay() {
  state.playing = !state.playing;
  if (state.playing && state.week >= WEEKS) setWeek(0);
  $("play-btn").textContent = state.playing ? "Pause" : "Play";
  $("play-btn").setAttribute("aria-label", state.playing ? "Pause" : "Play");
}

function setSpeed(speed) {
  state.speed = speed;
  document.querySelectorAll(".speed button").forEach((b) => b.classList.toggle("on", +b.dataset.speed === speed));
}

function bindControls() {
  $("task-picker").onchange = (e) => selectTask(e.target.value);
  $("right-picker").onchange = (e) => { state.configs.right = e.target.value; loadSides(); };
  $("play-btn").onclick = togglePlay;
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
  $("ticks").onclick = (e) => { const t = e.target.closest(".tick"); if (t) setWeek(+t.dataset.week); };
  $("raw-toggle").onclick = toggleRaw;
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select")) return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    if (e.key === "ArrowRight") setWeek(state.week + 1);
    if (e.key === "ArrowLeft") setWeek(state.week - 1);
  });
}

// One animation loop drives both fields and the play clock (1 week per second at 1x).
function startLoop() {
  let last = performance.now(), weekClock = 0;
  function frame(now) {
    const elapsed = (now - last) / 1000;
    const dt = Math.min(elapsed, 0.1);   // capped for animation smoothing only
    last = now;
    if (state.playing) {
      weekClock += elapsed * state.speed;   // wall-clock time, so slow frames do not slow playback
      if (weekClock >= 1) {
        weekClock = 0;
        if (state.week >= WEEKS) togglePlay(); else setWeek(state.week + 1);
      }
    }
    state.fields.left.animate(dt);
    state.fields.right.animate(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function main() {
  state.fields.left = new Field($("field-left").querySelector(".field-canvas"));
  state.fields.right = new Field($("field-right").querySelector(".field-canvas"));
  bindControls();
  startLoop();
  updateScrubber();
  try {
    state.index = await loadIndex();
  } catch (err) {
    $("feed-left").innerHTML = `<div class="bubble muted">${escapeHtml(err.message)}</div>`;
    return;
  }
  const tasks = allTasks(state.index);
  const first = tasks.find((t) => (state.index.farmer || []).includes(t)) || tasks[0];
  fillSelect($("task-picker"), tasks, first);
  await selectTask(first);
}

main();
