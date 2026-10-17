// FieldTwin replay UI ("ops console"). Reads runs/index.json and runs/<config>/<task>.jsonl
// (frozen log format, SKELETON_SPEC.md section 8) and replays two runs of the same season:
// ft = FieldTwin (best available run, switchable), farmer = farmer practice baseline.
//
// Week semantics: everything uses the line-level week. Position k in 0..19 shows week k's
// decision and its outcome (state at the end of week k). k = 20 is harvest (the final line).
//
// Every number on screen is read from the logs; a missing field shows "n/a". Colors come from
// tokens.css (the 3D scene reads them with getComputedStyle). Small functions on purpose so the
// look can be restyled without touching data code.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RUNS = "../runs";
const WEEKS = 20;
const GRID = 12;
const BEST_ORDER = ["multi", "single", "hindsight"];   // "best available" for the FieldTwin side
const TWEEN_MS = 250;
const MINUS = "−";
const NA = "n/a";
const SIDES = ["ft", "farmer"];
const AGENT_ORDER = ["weather", "crop", "planner", "critic", "coordinator"];
const AGENT_NAMES = { weather: "Weather", crop: "Crop", planner: "Planner", critic: "Critic", coordinator: "Coordinator" };
const CONFIG_LABELS = { farmer: "Farmer practice", hindsight: "grid hindsight", no_n: "No nitrogen", multi: "FieldTwin", fake_multi: "FieldTwin" };
const AGENT_TOKENS = { coordinator: "--ft" };          // raw events: others use the muted default

const state = {
  index: {}, task: null, week: 0, playing: false, speed: 1, rawOpen: false,
  configs: { ft: null, farmer: null }, runs: { ft: null, farmer: null }, fields: {},
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
    leachedCum += w.step && w.step.weekly ? w.step.weekly.n_leached : 0;
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

function objectionWeekCount(run) {
  return run.weeks.filter((w) => w.objection).length;
}

function harvested(run) {
  return !!(run && run.final && run.finalWeek !== null && state.week >= run.finalWeek);
}

function has(v) {
  return v !== undefined && v !== null && !Number.isNaN(Number(v));
}

// Cumulative values through the current week; the final line is authoritative at harvest.
function cumApplied(run) {
  if (!run) return null;
  if (harvested(run) && has(run.final.n_applied)) return run.final.n_applied;
  const obs = run.weeks[state.week].obs;
  return obs && has(obs.n_applied_total) ? obs.n_applied_total : null;
}

function cumLeached(run) {
  if (!run) return null;
  if (harvested(run) && has(run.final.n_leached)) return run.final.n_leached;
  const w = run.weeks[state.week];
  return w.obs ? w.leachedCum : null;
}

// Yield and profit exist only in the final line.
function finalValue(run, key) {
  return harvested(run) && has(run.final[key]) ? run.final[key] : null;
}

// ---------------------------------------------------------------- 3D field (upgraded in S2 unit 2)

const COLORS = {};

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function initColors() {
  const map = { soil: "--scene-soil", glass: "--scene-glass", core: "--scene-core", water: "--scene-water",
    nitrogen: "--nitrogen", nitrate: "--scene-nitrate", light: "--scene-light" };
  for (const [k, name] of Object.entries(map)) COLORS[k] = new THREE.Color(token(name) || 0x808080);
}

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
    this.scene.add(new THREE.AmbientLight(COLORS.light, 0.3));
    const sun = new THREE.DirectionalLight(COLORS.light, 1.2);
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
      new THREE.MeshStandardMaterial({ color: COLORS.soil, roughness: 0.9, transparent: true, opacity: 0.85 }),
    );
    soil.position.y = -0.08;
    this.scene.add(soil);
  }

  // 12x12 glass shells (shared material) with an emissive core each (own material, for the pulse).
  buildCubes() {
    const shellGeo = new THREE.BoxGeometry(0.82, 1, 0.82).translate(0, 0.5, 0);
    const coreGeo = new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, 0.5, 0);
    const glass = new THREE.MeshPhysicalMaterial({
      color: COLORS.glass, metalness: 0, roughness: 0.15, transmission: 0.2, thickness: 0.3,
      ior: 1.4, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 0.5, depthWrite: false,
    });
    this.cubes = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = i - (GRID - 1) / 2, z = j - (GRID - 1) / 2;
        const shell = new THREE.Mesh(shellGeo, glass);
        const core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({
          color: COLORS.core, emissive: COLORS.water.clone(), emissiveIntensity: 0.5,
        }));
        shell.position.set(x, 0, z);
        core.position.set(x, 0.02, z);
        this.scene.add(shell, core);
        // Small fixed per-cube jitter so the field does not look like a single block.
        this.cubes.push({ shell, core, col: i, jitter: 0.85 + 0.3 * pseudoRandom(i * 31 + j) });
      }
    }
  }

  // Nitrate (leached N) particles dripping below the field.
  buildDrips() {
    this.maxDrips = 300;
    const pos = new Float32Array(this.maxDrips * 3);
    this.dripSpeed = new Float32Array(this.maxDrips);
    for (let k = 0; k < this.maxDrips; k++) this.respawnDrip(pos, k, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    this.drips = new THREE.Points(geo, new THREE.PointsMaterial({ color: COLORS.nitrate, size: 0.28 }));
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
    this.target.water = obs && has(obs.soil_water_frac) ? obs.soil_water_frac : 0.5;
    this.target.height = obs && has(obs.biomass_kg_ha) ? 0.3 + Math.min(obs.biomass_kg_ha / 20000, 1.4) * 1.6 : 0.3;
    const n = weekRec && weekRec.decision && has(weekRec.decision.n_kg_ha) ? weekRec.decision.n_kg_ha : 0;
    this.target.nStrength = Math.min(n / 80, 1.5);
    this.target.leach = weekRec && weekRec.step && weekRec.step.weekly ? weekRec.step.weekly.n_leached || 0 : 0;
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
    // Pulse: a nitrogen wave that sweeps across the columns, repeating every 2.5 s.
    const front = ((this.pulseT % 2.5) / 1.6) * (GRID + 6) - 3;
    for (const c of this.cubes) {
      const h = this.cur.height * c.jitter;
      c.shell.scale.y = h;
      c.core.scale.y = h * 0.9;
      const wave = this.target.nStrength * Math.exp(-((c.col - front) ** 2) / 2.5);
      const m = c.core.material;
      m.emissive.copy(COLORS.water).lerp(COLORS.nitrogen, Math.min(3 * wave, 1));
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
  return has(v) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: digits }) : NA;
}

function fmtFixed(v, digits) {
  return Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtNum(digits, prefix = "") {
  return (v) => `${v < 0 ? MINUS : ""}${prefix}${fmtFixed(v, digits)}`;
}

function fmtSigned(digits, prefix = "") {
  return (v) => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${prefix}${fmtFixed(v, digits)}`;
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
function setNumber(el, value, format, text = NA) {
  cancelAnimationFrame(el._raf);
  if (!has(value)) {
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

// ---------------------------------------------------------------- 1. top strip

function renderStrip() {
  const F = state.runs.ft, B = state.runs.farmer;
  const comparable = F && B && F.config !== B.config;
  $("ft-name").innerHTML = F ? configNameHtml(F.config) : NA;
  $("farmer-name").innerHTML = B ? configNameHtml(B.config) : NA;
  $("strip-caption").textContent = !comparable ? "needs two different runs for this season"
    : state.week >= WEEKS ? "full season" : `cumulative through week ${state.week}`;

  // [FieldTwin value, farmer value, format, delta format, text while pending]
  const metrics = {
    n: [cumApplied(F), cumApplied(B), fmtNum(0), fmtSigned(0), NA],
    leach: [cumLeached(F), cumLeached(B), fmtNum(1), fmtSigned(1), NA],
    grain: [finalValue(F, "grain_kg_ha"), finalValue(B, "grain_kg_ha"), fmtNum(0), fmtSigned(0), "at harvest"],
    profit: [finalValue(F, "profit_usd_ha"), finalValue(B, "profit_usd_ha"), fmtNum(0, "$"), fmtSigned(0, "$"), "at harvest"],
  };
  for (const [m, [a, b, format, dFormat, pending]] of Object.entries(metrics)) {
    const card = document.querySelector(`.metric[data-m="${m}"]`);
    setNumber(card.querySelector(".m-ft"), a, format, F ? pending : NA);
    setNumber(card.querySelector(".m-farmer"), b, format, B ? pending : NA);
    const d = comparable && has(a) && has(b) ? a - b : null;
    const dEl = card.querySelector(".m-delta .v");
    setNumber(dEl, d, dFormat, comparable ? pending : NA);
    dEl.classList.toggle("better", d !== null && d * +card.dataset.better > 1e-9);   // FieldTwin better
  }

  // Fallback weeks: season totals, never hidden.
  const card = document.querySelector('.metric[data-m="fallback"]');
  const fF = F ? fallbackWeekCount(F) : null, fB = B ? fallbackWeekCount(B) : null;
  setNumber(card.querySelector(".m-ft"), fF, fmtNum(0));
  setNumber(card.querySelector(".m-farmer"), fB, fmtNum(0));
  card.querySelector(".m-ft").classList.toggle("warn", fF > 0);
  const obj = F && F.agents ? objectionWeekCount(F) : null;
  setNumber($("objection-count"), obj, fmtNum(0));
  $("objection-count").classList.toggle("warn", obj > 0);
}

// ---------------------------------------------------------------- 2. scene area labels and readouts

function renderBlock(side) {
  const block = $(`block-${side}`);
  const run = state.runs[side];
  block.querySelector(".name").innerHTML = run ? configNameHtml(run.config) : "No run";
  const w = run ? run.weeks[state.week] : null;
  const obs = (w && w.obs) || {};
  const weekly = (w && w.step && w.step.weekly) || {};
  const cell = (k, v, cls = "") => `<div class="cell"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const unit = (v, digits, u) => (has(v) ? `${fmt(v, digits)} ${u}` : NA);
  block.querySelector(".readout").innerHTML = cell("Stage", obs.stage ? escapeHtml(obs.stage) : NA)
    + cell("Soil water (profile)", has(obs.soil_water_frac) ? fmtFixed(obs.soil_water_frac, 3) : NA)
    + cell("Soil N", unit(obs.soil_n_kg_ha, 1, "kg/ha"), "n")
    + cell("Biomass", unit(obs.biomass_kg_ha, 0, "kg/ha"))
    + cell("Rain this week", unit(weekly.rain_mm, 1, "mm"))
    + cell("N leached this week", unit(weekly.n_leached, 1, "kg/ha"), "n");
}

// ---------------------------------------------------------------- 3. agent panel

function messageText(d) {
  return d && (d.text || d.content);
}

function chipsHtml(names, extra = "") {
  if (!names.length && !extra) return "";
  return `<span class="chips">${extra}${names.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join("")}</span>`;
}

// One row per agent: message text, tool names as chips, objection / fallback markers.
function agentRowHtml(agent, events) {
  const mine = events.filter((e) => e.agent === agent);
  const texts = mine.filter((e) => e.kind === "message").map((e) => messageText(e.data)).filter(Boolean);
  const fallbacks = mine.filter((e) => e.kind === "fallback").map((e) => messageText(e.data) || JSON.stringify(e.data));
  const tools = mine.filter((e) => e.kind === "tool_call").map((e) => e.data && e.data.name).filter(Boolean);
  const objection = mine.some(isObjection);
  const text = [...texts, ...fallbacks].join(" · ");
  const marks = (objection ? `<span class="chip warn">Objection</span>` : "")
    + (fallbacks.length ? `<span class="chip warn solid">Fallback</span>` : "");
  const cls = ["msg", objection ? "objection" : "", fallbacks.length ? "fallback" : "", text ? "" : "empty"].join(" ");
  return `<div class="${cls}" data-agent="${agent}"><span class="who">${AGENT_NAMES[agent]}</span><div class="body">`
    + `<span class="text" title="${escapeHtml(text)}">${text ? escapeHtml(text) : "No message this week"}</span>`
    + `${chipsHtml(tools, marks)}</div></div>`;
}

function valHtml(k, v, u, cls = "") {
  return `<div class="val"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="u">${u}</span></div>`;
}

// Decision card ("stamp"): N, irrigation, reason, plus fallback and coordinator notes.
function stampHtml(w, who, mine) {
  const fallbacks = mine.filter((e) => e.kind === "fallback").map((e) => messageText(e.data) || JSON.stringify(e.data));
  const tools = mine.filter((e) => e.kind === "tool_call").map((e) => e.data && e.data.name).filter(Boolean);
  const notes = mine.filter((e) => e.kind === "message").map((e) => messageText(e.data)).filter(Boolean);
  const marks = fallbacks.length ? `<span class="chip warn solid">Fallback</span>` : "";
  const d = w.decision;
  return `<div class="stamp ${fallbacks.length ? "fallback" : ""}">`
    + `<div class="stamp-head"><span class="who">${who}</span><span class="stamp-tag">Decision · ${weekText(state.week)}</span>`
    + `${chipsHtml(tools, marks)}</div>`
    + (d ? `<div class="vals">${valHtml("N", fmt(d.n_kg_ha, 1), "kg/ha", "n")}${valHtml("Irrigation", fmt(d.irr_mm, 1), "mm")}</div>`
      : `<div class="note">No decision this week</div>`)
    + (d && d.reason ? `<div class="reason">${escapeHtml(d.reason)}</div>` : "")
    + fallbacks.map((t) => `<div class="note warn">${escapeHtml(t)}</div>`).join("")
    + notes.map((t) => `<div class="note">${escapeHtml(t)}</div>`).join("")
    + `</div>`;
}

function harvestHtml(run) {
  const f = run.final || {};
  return `<div class="stamp"><div class="stamp-head"><span class="who">Harvest</span><span class="stamp-tag">final line</span></div>`
    + `<div class="vals">${valHtml("Yield", fmt(f.grain_kg_ha), "kg/ha")}${valHtml("Profit", has(f.profit_usd_ha) ? fmtNum(0, "$")(f.profit_usd_ha) : NA, "USD/ha")}</div>`
    + `</div>`;
}

function feedHtml(run) {
  if (!run) return `<div class="feed-empty">No run for this season</div>`;
  if (state.week >= WEEKS) return harvestHtml(run);
  const w = run.weeks[state.week];
  if (!run.agents) return `<div class="feed-empty">Baseline policy, no agents</div>` + stampHtml(w, "Policy", []);
  return AGENT_ORDER.filter((a) => a !== "coordinator").map((a) => agentRowHtml(a, w.events)).join("")
    + stampHtml(w, "Coordinator", w.events.filter((e) => e.agent === "coordinator"));
}

// Farmer side: its policy decision in one line.
function farmerLineHtml(run) {
  const who = `<span class="who">${run ? configNameHtml(run.config) : "Farmer practice"}</span>`;
  if (!run) return `${who}<span class="text">No run for this season</span>`;
  if (state.week >= WEEKS) return `${who}<span class="text">Harvest: yield and profit in the top strip</span>`;
  const d = run.weeks[state.week].decision;
  const text = d ? `N <span class="v n">${fmt(d.n_kg_ha, 1)}</span> kg/ha · irrigation <span class="v">${fmt(d.irr_mm, 1)}</span> mm`
    + (d.reason ? ` · ${escapeHtml(d.reason)}` : "") : "No decision this week";
  return `${who}<span class="text" title="${d && d.reason ? escapeHtml(d.reason) : ""}">${text}</span>`;
}

function renderAgents() {
  const feed = $("feed");
  feed.innerHTML = feedHtml(state.runs.ft);
  feed.classList.remove("enter");
  void feed.offsetWidth;   // restart the enter transition
  feed.classList.add("enter");
  $("farmer-line").innerHTML = farmerLineHtml(state.runs.farmer);
}

// ---------------------------------------------------------------- 5. raw events

function bubble(agent, cls, body) {
  const color = AGENT_TOKENS[agent];
  return `<div class="raw ${cls}" ${color ? `style="--agent:var(${color})"` : ""}><div class="who">${escapeHtml(agent)} · ${cls}</div>${body}</div>`;
}

function json(data) {
  return `<pre>${escapeHtml(JSON.stringify(data, null, 1))}</pre>`;
}

// One raw block per log event; tool calls collapsed.
function eventHtml(e) {
  const d = e.data || {};
  switch (e.kind) {
    case "tool_call":
      return bubble(e.agent, "tool", `<details><summary>call ${escapeHtml(d.name)}</summary>${json(d.args || {})}</details>`);
    case "tool_result":
      return bubble(e.agent, "tool", `<details><summary>${escapeHtml(d.name)} result</summary>${json(d.result)}</details>`);
    case "decision":
      return bubble(e.agent, "decision",
        `<div>N ${fmt(d.n_kg_ha, 1)} kg/ha · irrigation ${fmt(d.irr_mm, 1)} mm</div><div class="reason">${escapeHtml(d.reason || "")}</div>`);
    case "step_result": {
      const wk = d.weekly || {};
      const clamp = d.clamped ? " · <b>clamped</b>" : "";
      return bubble(e.agent, "step",
        `rain ${fmt(wk.rain_mm)} mm · N uptake ${fmt(wk.n_uptake, 1)} · leached ${fmt(wk.n_leached, 1)} kg/ha${clamp}`);
    }
    case "final":
      return bubble(e.agent, "final", `grain ${fmt(d.grain_kg_ha)} kg/ha · profit $${fmt(d.profit_usd_ha)} · reward ${fmt(d.reward)}`);
    case "fallback":
      return bubble(e.agent, "fallback", json(d));
    default: {   // message
      if (d.reset) return bubble(e.agent, "message", `season reset: ${escapeHtml(d.task ? d.task.task_id : "")}`);
      const text = messageText(d);
      return bubble(e.agent, "message", text ? escapeHtml(text) : json(d));
    }
  }
}

function renderLog() {
  if (!state.rawOpen) return;
  for (const side of SIDES) {
    const run = state.runs[side];
    const events = run ? run.weeks[state.week].events : [];
    $(`raw-head-${side}`).innerHTML = `${run ? configNameHtml(run.config) : "No run"} · ${weekText(state.week)}`;
    $(`raw-${side}`).innerHTML = events.length ? events.map(eventHtml).join("") : `<div class="raw">No events.</div>`;
  }
}

function toggleRaw() {
  state.rawOpen = !state.rawOpen;
  $("raw-toggle").setAttribute("aria-expanded", String(state.rawOpen));
  $("raw-body").hidden = !state.rawOpen;
  renderLog();
}

// ---------------------------------------------------------------- 4. timeline

// Build the ticks once per loaded pair; setWeek only toggles classes (so transitions run).
function renderTimeline() {
  const runs = [state.runs.ft, state.runs.farmer].filter(Boolean);
  const rainAt = (k) => {
    const r = runs.find((x) => x.weeks[k].step && x.weeks[k].step.weekly && has(x.weeks[k].step.weekly.rain_mm));
    return r ? r.weeks[k].step.weekly.rain_mm : null;
  };
  const rain = Array.from({ length: WEEKS }, (_, k) => rainAt(k));
  const max = Math.max(1e-9, ...rain.filter((v) => v !== null));
  const ticks = rain.map((mm, k) => {
    const obj = runs.some((r) => r.weeks[k].objection), fb = runs.some((r) => r.weeks[k].fallback);
    const tip = [`Week ${k}`, `rain ${mm !== null ? `${fmt(mm, 1)} mm` : NA}`, obj ? "objection" : "", fb ? "fallback" : ""].filter(Boolean).join(" · ");
    return `<button class="tick" data-week="${k}" title="${tip}">`
      + `<span class="marks">${obj ? `<i class="mark objection"></i>` : ""}${fb ? `<i class="mark fallback"></i>` : ""}</span>`
      + `<span class="rain" style="height:${mm !== null ? (32 * mm) / max : 0}px"></span>`
      + `<span class="base"></span><span class="lbl">${k}</span></button>`;
  }).join("");
  $("ticks").innerHTML = ticks + `<button class="tick harvest" data-week="${WEEKS}" title="Harvest">`
    + `<span class="base"></span><span class="lbl">Harvest</span></button>`;

  const objections = runs.reduce((s, r) => s + objectionWeekCount(r), 0);
  const fallbacks = runs.reduce((s, r) => s + fallbackWeekCount(r), 0);
  const maxText = rain.some((v) => v !== null) ? `${fmt(max, 1)} mm` : NA;
  $("scrub-legend").innerHTML = `<span><i class="mark objection"></i>objection weeks ${objections}</span>`
    + `<span><i class="mark fallback"></i>fallback weeks ${fallbacks}</span>`
    + `<span><i class="rain-key"></i>weekly rain, max ${maxText}</span>`;
}

function updateTimeline() {
  $("week-label").textContent = weekText(state.week);
  $("agents-week").textContent = weekText(state.week);
  $("ticks").querySelectorAll(".tick").forEach((t) => {
    const k = +t.dataset.week;
    t.classList.toggle("past", k < state.week);
    t.classList.toggle("current", k === state.week);
  });
}

// ---------------------------------------------------------------- controls

function fillSelect(sel, values, selected, label = (v) => v) {
  sel.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
}

// FieldTwin-side picker: every run of this season except the farmer baseline.
function renderFtPicker() {
  const options = configsFor(state.task).filter((c) => c !== state.configs.farmer);
  fillSelect($("ft-picker"), options, state.configs.ft, (c) => `${configLabel(c)}${isFake(c) ? " [FAKE]" : ""}`);
  $("ft-pick").hidden = options.length < 2;
}

function renderHeaderTags() {
  const runs = [state.runs.ft, state.runs.farmer].filter(Boolean);
  const splits = [...new Set(runs.map((r) => r.split).filter(Boolean))];
  $("split-tag").textContent = splits.join(" / ");
  $("split-tag").hidden = !splits.length;
  $("fake-tag").hidden = !runs.some((r) => isFake(r.config));
}

function setWeek(k) {
  state.week = Math.max(0, Math.min(WEEKS, k));
  for (const side of SIDES) {
    state.fields[side].setWeek(state.runs[side] ? state.runs[side].weeks[state.week] : null);
    renderBlock(side);
  }
  renderStrip();
  renderAgents();
  updateTimeline();
  renderLog();
}

async function selectTask(task) {
  state.task = task;
  const configs = configsFor(task);
  if (!configs.includes(state.configs.farmer)) {
    state.configs.farmer = configs.includes("farmer") ? "farmer" : firstReal(configs) || configs[0];
  }
  state.configs.ft = bestConfig(task, state.configs.farmer);
  renderFtPicker();
  await loadSides();
}

async function loadSides() {
  [state.runs.ft, state.runs.farmer] = await Promise.all(SIDES.map((s) => loadRun(state.configs[s], state.task)));
  renderHeaderTags();
  renderTimeline();
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
  $("ft-picker").onchange = (e) => { state.configs.ft = e.target.value; loadSides(); };
  $("play-btn").onclick = togglePlay;
  $("prev-btn").onclick = () => setWeek(state.week - 1);
  $("next-btn").onclick = () => setWeek(state.week + 1);
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
  $("ticks").onclick = (e) => { const t = e.target.closest(".tick"); if (t) setWeek(+t.dataset.week); };
  $("raw-toggle").onclick = toggleRaw;
  // Keys: space play/pause, arrows step. Ignored while a select has focus.
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();   // no double toggle on keyup
      if (!e.repeat) togglePlay();
    }
    if (e.key === "ArrowRight") { e.preventDefault(); setWeek(state.week + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setWeek(state.week - 1); }
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
    for (const side of SIDES) state.fields[side].animate(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function main() {
  initColors();
  for (const side of SIDES) state.fields[side] = new Field($(`block-${side}`).querySelector(".field-canvas"));
  bindControls();
  startLoop();
  updateTimeline();
  try {
    state.index = await loadIndex();
  } catch (err) {
    $("feed").innerHTML = `<div class="feed-empty">${escapeHtml(err.message)}</div>`;
    return;
  }
  const tasks = allTasks(state.index);
  const first = tasks.find((t) => (state.index.farmer || []).includes(t)) || tasks[0];
  fillSelect($("task-picker"), tasks, first);
  await selectTask(first);
}

main();
