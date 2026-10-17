// FieldTwin replay UI. Reads runs/index.json and runs/<config>/<task>.jsonl
// (frozen log format, SKELETON_SPEC.md section 8) and replays two runs side by side.
//
// Week semantics: slider position k in 0..19 shows week k's decision and its
// outcome (state at the end of week k). k = 20 shows the end of the season.
//
// Small functions on purpose so the look can be restyled without touching data code.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RUNS = "../runs";
const WEEKS = 20;
const GRID = 12;
const BEST_ORDER = ["multi", "single", "hindsight"];   // "best available" for the right picker
const STORM_MM = 60;                                    // weekly rain counted as a storm week
const AGENT_COLORS = {
  weather: "#4fa8ff", crop: "#76b900", planner: "#ffb74d", critic: "#ff6b6b",
  coordinator: "#c38bff", policy: "#9e9e9e", env: "#5c5c5c",
};

const state = {
  index: {}, task: null, week: 0, playing: false, speed: 1, selected: "left",
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

// Turn the flat event list into one record per week (0..20).
function buildRun(config, events) {
  const weeks = Array.from({ length: WEEKS + 1 }, () => ({ events: [], decision: null, step: null }));
  let final = null;
  let leachedCum = 0;
  for (const e of events) {
    const w = weeks[Math.min(Math.max(e.week, 0), WEEKS)];
    w.events.push(e);
    if (e.kind === "decision") w.decision = e.data;
    if (e.kind === "step_result") w.step = e.data;
    if (e.kind === "final") final = e.data;
  }
  let lastObs = null;
  weeks.forEach((w) => {
    if (w.step) lastObs = w.step.obs;
    w.obs = w.step ? w.step.obs : lastObs;        // week 20 keeps the last observed state
    leachedCum += w.step ? w.step.weekly.n_leached : 0;
    w.leachedCum = leachedCum;
  });
  return { config, weeks, final };
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
  return BEST_ORDER.find((c) => avail.includes(c)) || avail[0] || exclude;
}

// ---------------------------------------------------------------- 3D field

const WATER_COLOR = new THREE.Color("#7fd6ff");
const N_COLOR = new THREE.Color("#76b900");

class Field {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000);
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
    this.drips = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff3b3b, size: 0.28 }));
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
    // Pulse: a green wave that sweeps across the columns, repeating every 2.5 s.
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

// ---------------------------------------------------------------- panels

function fmt(v, digits = 0) {
  return v === undefined || v === null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function counterHtml(key, value, cls = "") {
  return `<div class="counter ${cls}"><div class="k">${key}</div><div class="v">${value}</div></div>`;
}

function renderCounters(side) {
  const panel = $(`field-${side}`);
  const run = state.runs[side];
  panel.querySelector(".config-name").textContent = run ? run.config : "(no run)";
  const w = run ? run.weeks[state.week] : null;
  const obs = (w && w.obs) || {};
  const end = state.week === WEEKS && run && run.final;
  panel.querySelector(".counters").innerHTML = [
    counterHtml("N applied kg/ha", fmt(obs.n_applied_total)),
    counterHtml("N leached kg/ha", w ? fmt(w.leachedCum, 1) : "—", "leach"),
    counterHtml("Irrigation mm", fmt(obs.irr_total_mm)),
    counterHtml("Biomass kg/ha", fmt(obs.biomass_kg_ha)),
    counterHtml("Grain kg/ha", end ? fmt(run.final.grain_kg_ha) : "—", "final"),
    counterHtml("Profit $/ha", end ? fmt(run.final.profit_usd_ha) : "—", "final"),
    counterHtml("Reward", end ? fmt(run.final.reward) : "—", "final"),
    counterHtml("Stage", obs.stage || "—"),
  ].join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function bubble(agent, cls, body) {
  const color = AGENT_COLORS[agent] || "#888";
  return `<div class="bubble ${cls}" style="--agent:${color}"><div class="who">${escapeHtml(agent)}</div>${body}</div>`;
}

function json(data) {
  return `<pre>${escapeHtml(JSON.stringify(data, null, 1))}</pre>`;
}

// One chat bubble per log event; tool calls are collapsed.
function eventHtml(e) {
  const d = e.data;
  switch (e.kind) {
    case "tool_call":
      return bubble(e.agent, "tool", `<details><summary>call ${escapeHtml(d.name)}</summary>${json(d.args || {})}</details>`);
    case "tool_result":
      return bubble(e.agent, "tool", `<details><summary>${escapeHtml(d.name)} result</summary>${json(d.result)}</details>`);
    case "decision":
      return bubble(e.agent, "decision",
        `<div>N ${fmt(d.n_kg_ha)} kg/ha · irrigation ${fmt(d.irr_mm)} mm</div><div class="reason">${escapeHtml(d.reason)}</div>`);
    case "step_result": {
      const wk = d.weekly;
      const clamp = d.clamped ? " · <b>clamped</b>" : "";
      return bubble(e.agent, "step",
        `rain ${fmt(wk.rain_mm)} mm · N uptake ${fmt(wk.n_uptake, 1)} · leached ${fmt(wk.n_leached, 1)} kg/ha${clamp}`);
    }
    case "final":
      return bubble(e.agent, "final", `<b>Season done.</b> grain ${fmt(d.grain_kg_ha)} kg/ha · profit $${fmt(d.profit_usd_ha)} · reward ${fmt(d.reward)}`);
    case "fallback":
      return bubble(e.agent, "fallback", `<b>fallback</b>${json(d)}`);
    default: {   // message
      if (d && d.reset) return bubble(e.agent, "message", `season reset: ${escapeHtml(d.task ? d.task.task_id : "")}`);
      const text = d && (d.text || d.content);
      return bubble(e.agent, "message", text ? escapeHtml(text) : json(d));
    }
  }
}

function renderLog() {
  const run = state.runs[state.selected];
  $("log-title").textContent = `${state.selected} · ${run ? run.config : "no run"} · week ${state.week}`;
  const events = run ? run.weeks[state.week].events : [];
  $("log").innerHTML = events.length ? events.map(eventHtml).join("") : `<div class="bubble">No events.</div>`;
  document.querySelectorAll(".field-panel").forEach((p) => p.classList.toggle("selected", p.dataset.side === state.selected));
}

// Rain per week from whichever run is loaded (both sides share the season's weather).
function renderWeather() {
  const run = state.runs.left || state.runs.right;
  const rain = Array.from({ length: WEEKS }, (_, k) => (run && run.weeks[k].step ? run.weeks[k].step.weekly.rain_mm : 0));
  const max = Math.max(60, ...rain);
  $("weather-strip").innerHTML = rain.map((mm, k) => `
    <div class="rain-bar ${mm >= STORM_MM ? "storm" : ""} ${k === state.week ? "current" : ""}" data-week="${k}"
         title="week ${k}: ${fmt(mm)} mm${mm >= STORM_MM ? " (storm)" : ""}">
      <div class="fill" style="height:${(100 * mm) / max}%"></div>
      <div class="mm">${mm >= STORM_MM ? fmt(mm) : ""}</div>
      <div class="lbl">${k}</div>
    </div>`).join("");
  $("weather-strip").querySelectorAll(".rain-bar").forEach((b) => (b.onclick = () => setWeek(+b.dataset.week)));
}

// ---------------------------------------------------------------- controls

function fillSelect(sel, values, selected) {
  sel.innerHTML = values.map((v) => `<option value="${v}" ${v === selected ? "selected" : ""}>${v}</option>`).join("");
}

function setWeek(k) {
  state.week = Math.max(0, Math.min(WEEKS, k));
  $("week-slider").value = state.week;
  $("week-label").textContent = state.week === WEEKS ? "end" : `${state.week} / ${WEEKS - 1}`;
  for (const side of ["left", "right"]) {
    state.fields[side].setWeek(state.runs[side] ? state.runs[side].weeks[state.week] : null);
    renderCounters(side);
  }
  renderLog();
  renderWeather();
}

async function selectTask(task) {
  state.task = task;
  const configs = configsFor(task);
  if (!configs.includes(state.configs.left)) state.configs.left = configs.includes("farmer") ? "farmer" : configs[0];
  state.configs.right = bestConfig(task, state.configs.left);
  fillSelect($("left-picker"), configs, state.configs.left);
  fillSelect($("right-picker"), configs, state.configs.right);
  await loadSides();
}

async function loadSides() {
  [state.runs.left, state.runs.right] = await Promise.all(
    ["left", "right"].map((s) => loadRun(state.configs[s], state.task)));
  setWeek(state.week);
}

function togglePlay() {
  state.playing = !state.playing;
  if (state.playing && state.week >= WEEKS) setWeek(0);
  $("play-btn").textContent = state.playing ? "❚❚" : "▶";
}

function bindControls() {
  $("task-picker").onchange = (e) => selectTask(e.target.value);
  $("left-picker").onchange = (e) => { state.configs.left = e.target.value; loadSides(); };
  $("right-picker").onchange = (e) => { state.configs.right = e.target.value; loadSides(); };
  $("week-slider").oninput = (e) => setWeek(+e.target.value);
  $("speed-picker").onchange = (e) => (state.speed = +e.target.value);
  $("play-btn").onclick = togglePlay;
  document.querySelectorAll(".field-panel").forEach((p) => (p.onclick = () => { state.selected = p.dataset.side; renderLog(); }));
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
  try {
    state.index = await loadIndex();
  } catch (err) {
    $("log").innerHTML = `<div class="bubble">${escapeHtml(err.message)}</div>`;
    return;
  }
  const tasks = allTasks(state.index);
  const first = tasks.find((t) => (state.index.farmer || []).includes(t)) || tasks[0];
  fillSelect($("task-picker"), tasks, first);
  await selectTask(first);
}

main();
