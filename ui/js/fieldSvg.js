// One field as a 2D neon side-view cross-section (R1). Reusable: main.js makes one per side.
//
//   sky       black; storm weeks (weekly.rain_mm > theme.stormMm) get rain streaks and a "Storm N mm" tag
//   crop row  theme.field.plants maize plants as line art: stalk height ~ obs.biomass_kg_ha over the task's max
//             across both fields; leaves added from obs.stage (V-number), by week when the stage is unknown;
//             a tassel only when obs.stage is VT or R1..R6
//   ground    one thin neon line
//   soil      cyan fill rising from the bottom with obs.soil_water_frac (one whole-profile fraction)
//   motes     motes.js canvas: topsoil N (obs.soil_n_kg_ha), dose, uptake, leaching drips
//   groundwater  line whose red glow builds with cumulative N leached over the task's max across both fields
//
// Plants: CSS transitions on the path `d` property (grow), stroke-dashoffset (leaf unfurl, staggered) and a
// CSS sway; all paths keep the same command list so `d` interpolates. Glow: the shared #glow filter (class
// .glow, removed by ?lite=1 in style.css). Every value comes from the week snapshot main.js passes in.

import { theme } from "./theme.js";
import { Motes } from "./motes.js";

const NS = "http://www.w3.org/2000/svg";
const F = theme.field;
let uid = 0;

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

// Deterministic jitter in [0, 1) per plant, so the row looks organic and stays put between weeks.
function jitter(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Leaves shown for a stage: VE 1, Vn about n/3, VT and R stages all; unknown stage: by season progress.
export function leafCount(stage, k, W) {
  const s = typeof stage === "string" ? stage.trim().toUpperCase() : "";
  if (s === "VE") return 1;
  const v = /^V(\d+)$/.exec(s);
  if (v) return clamp(Math.ceil(+v[1] / 3), 1, F.leavesMax);
  if (s === "VT" || /^R[1-6]$/.test(s)) return F.leavesMax;
  return W > 0 ? clamp(Math.round(F.leavesMax * Math.min(1, k / (0.55 * W))), 1, F.leavesMax) : 1;
}

export function hasTassel(stage) {
  const s = typeof stage === "string" ? stage.trim().toUpperCase() : "";
  return s === "VT" || /^R[1-6]$/.test(s);
}

// Path strings for one plant of stalk height H (local coords: base at 0,0, up is -y).
function plantPaths(H, bend, flip, shown) {
  const stalk = `M 0 0 Q ${r1(bend)} ${r1(-H / 2)} 0 ${r1(-H)}`;
  const leaves = [];
  for (let j = 0; j < F.leavesMax; j++) {
    // Visible leaves spread over the stalk, lowest first; hidden ones wait near the top to unfurl there.
    const t = j < shown ? 0.2 + 0.68 * (shown > 1 ? j / (shown - 1) : 0.5) : 0.9;
    const sx = 2 * t * (1 - t) * bend, sy = -t * H;
    const side = (j % 2 ? 1 : -1) * flip;
    const L = Math.min(74, 10 + 0.34 * H) * (1 - 0.35 * t);
    leaves.push(`M ${r1(sx)} ${r1(sy)} Q ${r1(sx + side * L * 0.5)} ${r1(sy - L * 0.45)} ${r1(sx + side * L)} ${r1(sy + L * 0.12)}`);
  }
  const y = -H;
  const tassel = `M 0 ${r1(y)} L -7 ${r1(y - 13)} M 0 ${r1(y)} L -2.5 ${r1(y - 18)} `
    + `M 0 ${r1(y)} L 2.5 ${r1(y - 18)} M 0 ${r1(y)} L 7 ${r1(y - 13)}`;
  return { stalk, leaves, tassel };
}

function setD(path, d) {
  path.setAttribute("d", d);
  path.style.d = `path("${d}")`;
}

export class FieldView {
  constructor(plot, { lite = false, reduceMotion = false } = {}) {
    this.id = ++uid;
    this.plot = plot;
    this.reduce = reduceMotion;
    this.scale = null;
    this.build();
    this.motes = new Motes(this.canvas, { lite, reduceMotion });
    this.motes.setPlants(this.plants.map((p) => ({ x: p.x, h: p.h })));
    this.setWater(0);
    this.setGroundwater(0);
    this.setStorm(null);
    new ResizeObserver(() => this.resize()).observe(plot);
    this.resize();
  }

  build() {
    const svg = (this.svg = el("svg", { viewBox: `0 0 ${F.w} ${F.h}`, preserveAspectRatio: "xMidYMid meet",
      class: "field-svg", role: "img" }));
    const defs = el("defs", {}, svg);
    const stem = `stem-${this.id}`, water = `water-${this.id}`, gw = `gw-${this.id}`;
    // Stems fade to transparent at the base (user space of each plant: base at y 0).
    const g1 = el("linearGradient", { id: stem, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 0, y2: -48 }, defs);
    el("stop", { offset: 0, "stop-color": theme.color.plant, "stop-opacity": 0 }, g1);
    el("stop", { offset: 1, "stop-color": theme.color.plant, "stop-opacity": 1 }, g1);
    const g2 = el("linearGradient", { id: water, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": theme.color.water, "stop-opacity": 0 }, g2);
    el("stop", { offset: 0.18, "stop-color": theme.color.water, "stop-opacity": 0.26 }, g2);
    el("stop", { offset: 1, "stop-color": theme.color.water, "stop-opacity": 0.14 }, g2);
    const g3 = el("linearGradient", { id: gw, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": theme.color.leach, "stop-opacity": 0.55 }, g3);
    el("stop", { offset: 1, "stop-color": theme.color.leach, "stop-opacity": 0 }, g3);

    // Soil water: full-height rect scaled from the bottom; a thin surface line rides on top of it.
    const soilH = F.soilBottom - F.ground;
    this.water = el("rect", { class: "water", x: 0, y: F.ground, width: F.w, height: soilH, fill: `url(#${water})` }, svg);
    this.waterLine = el("line", { class: "water-line glow", x1: 0, x2: F.w, y1: F.soilBottom, y2: F.soilBottom }, svg);
    el("line", { class: "soil-floor", x1: 0, x2: F.w, y1: F.soilBottom, y2: F.soilBottom }, svg);

    // Groundwater: faint base line, red glow line and band whose opacity builds with cumulative leaching.
    this.gwBand = el("rect", { class: "gw-band", x: 0, y: F.groundwater, width: F.w, height: F.h - F.groundwater,
      fill: `url(#${gw})` }, svg);
    el("line", { class: "gw-base", x1: 0, x2: F.w, y1: F.groundwater, y2: F.groundwater }, svg);
    this.gwLine = el("line", { class: "gw-line glow", x1: 0, x2: F.w, y1: F.groundwater, y2: F.groundwater }, svg);

    // Ground line and the crop row.
    el("line", { class: "ground glow", x1: 0, x2: F.w, y1: F.ground, y2: F.ground }, svg);
    const row = el("g", { class: "row glow" }, svg);
    const margin = 52, gap = (F.w - 2 * margin) / (F.plants - 1);
    this.plants = [];
    for (let i = 0; i < F.plants; i++) {
      const x = margin + i * gap + (jitter(i, 1) - 0.5) * gap * 0.3;
      const pos = el("g", { transform: `translate(${r1(x)} ${F.ground})` }, row);
      const sway = el("g", { class: "sway" }, pos);
      sway.style.animationDelay = `${-(jitter(i, 2) * 4).toFixed(2)}s`;
      const delay = Math.round(i * 45 + jitter(i, 3) * 90);
      const p = {
        x, delay,
        size: 0.88 + 0.18 * jitter(i, 4),
        bend: (jitter(i, 5) - 0.5) * 20,
        flip: jitter(i, 6) > 0.5 ? 1 : -1,
        stalk: el("path", { class: "stalk", stroke: `url(#${stem})` }, sway),
        leaves: [],
        tassel: null,
      };
      for (let j = 0; j < F.leavesMax; j++) {
        const leaf = el("path", { class: "leaf", pathLength: 1 }, sway);
        leaf.style.transitionDelay = `${delay + j * 90}ms`;
        p.leaves.push(leaf);
      }
      p.tassel = el("path", { class: "tassel" }, sway);
      p.stalk.style.transitionDelay = `${delay}ms`;
      p.tassel.style.transitionDelay = `${delay}ms`;
      this.plants.push(p);
    }

    // Storm tag (text from the data).
    this.storm = el("g", { class: "storm-tag" }, svg);
    this.stormText = el("text", { x: 18, y: 32 }, this.storm);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "motes";
    this.empty = document.createElement("div");
    this.empty.className = "plot-empty quiet";
    this.empty.hidden = true;
    this.plot.append(svg, this.canvas, this.empty);
    this.drawPlants(0, 1, false);
  }

  resize() {
    const w = this.plot.clientWidth, h = this.plot.clientHeight;
    if (!w || !h) return;
    const s = Math.min(w / F.w, h / F.h);
    this.motes.resize(w, h, { s, ox: (w - F.w * s) / 2, oy: (h - F.h * s) / 2 });
  }

  // Max values across both fields for this task (main.js), so the two fields share one scale.
  setScale(scale) {
    this.scale = scale;
  }

  drawPlants(frac, leaves, tassel) {
    this.plants.forEach((p) => {
      const H = F.sprout + (F.stalkMax - F.sprout) * clamp(frac, 0, 1) * p.size;
      const d = plantPaths(H, p.bend, p.flip, leaves);
      setD(p.stalk, d.stalk);
      p.leaves.forEach((leaf, j) => {
        setD(leaf, d.leaves[j]);
        leaf.classList.toggle("on", j < leaves);
      });
      setD(p.tassel, d.tassel);
      p.tassel.classList.toggle("on", tassel);
      p.h = H;
    });
    if (this.motes) this.motes.setPlants(this.plants.map((p) => ({ x: p.x, h: p.h })));
  }

  // snap: {k, W, obs, weekly, cumLeached, harvest} or null (no log). events: data.weekEvents() plus uptake,
  // only when the week changed (ripple). spread: seconds over which this week's motes start.
  show(snap, events = [], spread = 1) {
    const sc = this.scale || {};
    const share = (v, max) => (typeof v === "number" && max > 0 ? clamp(v / max, 0, 1) : 0);
    this.empty.hidden = !!snap;
    if (!snap) {
      this.empty.textContent = "No run for this season";
      this.drawPlants(0, 1, false);
      this.setWater(0);
      this.setGroundwater(0);
      this.setStorm(null);
      this.motes.clear();
      return;
    }
    const obs = snap.obs || {};
    this.drawPlants(share(obs.biomass_kg_ha, sc.biomass), leafCount(obs.stage, snap.k, snap.W), hasTassel(obs.stage));
    this.setWater(typeof obs.soil_water_frac === "number" ? obs.soil_water_frac : 0);
    this.setGroundwater(share(snap.cumLeached, sc.leachCum));

    const rain = !snap.harvest && snap.weekly && typeof snap.weekly.rain_mm === "number" ? snap.weekly.rain_mm : null;
    const storm = rain !== null && rain > theme.stormMm ? rain : null;
    this.setStorm(storm);
    this.motes.setRain(storm ? theme.motes.rain * Math.min(1, storm / 100) : 0);

    for (const e of events) {
      if (e.kind === "n") this.motes.dose(Math.max(4, Math.round(theme.motes.dose * share(e.amount, sc.dose))), spread * 0.6);
      else if (e.kind === "uptake") this.motes.uptake(Math.max(2, Math.round(theme.motes.uptake * share(e.amount, sc.uptake))), spread);
      else if (e.kind === "leach") {
        const s = share(e.amount, sc.leachWeek);
        this.motes.leach(Math.max(3, Math.round(theme.motes.leach * s)), spread, s);
        this.pulseGroundwater(s);
      }
    }
    // After the dose spawns its falling motes, so they settle into the topsoil count instead of doubling it.
    this.motes.setSoil(theme.motes.soil * share(obs.soil_n_kg_ha, sc.soilN));
  }

  setWater(frac) {
    const f = clamp(frac, 0, 1), soilH = F.soilBottom - F.ground;
    this.water.style.transform = `scaleY(${f.toFixed(3)})`;
    this.waterLine.style.transform = `translateY(${(-f * soilH).toFixed(1)}px)`;
    this.waterLine.style.opacity = f > 0 ? "" : "0";
  }

  setGroundwater(level) {
    this.gwLevel = level;
    this.gwLine.style.opacity = (0.12 + 0.88 * level).toFixed(3);
    this.gwLine.style.strokeWidth = `${(1.4 + 2.2 * level).toFixed(2)}px`;
    this.gwBand.style.opacity = (0.9 * level).toFixed(3);
  }

  // Flash scaled by this week's leaching over the task's worst week: the worst week flashes brightest.
  pulseGroundwater(s) {
    if (this.reduce || s <= 0) return;
    const base = 0.12 + 0.88 * (this.gwLevel || 0);
    const peak = Math.min(1, base + 0.2 + 0.8 * s);
    const opts = { duration: 900 + 900 * s, delay: 450, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
    this.gwLine.animate([{ opacity: base }, { opacity: peak, offset: 0.25 }, { opacity: base }], opts);
    this.gwBand.animate([{ opacity: 0.9 * (this.gwLevel || 0) }, { opacity: Math.min(1, 0.9 * (this.gwLevel || 0) + s), offset: 0.25 },
      { opacity: 0.9 * (this.gwLevel || 0) }], opts);
  }

  setStorm(mm) {
    this.storm.style.opacity = mm ? "1" : "0";
    if (mm) this.stormText.textContent = `Storm ${Math.round(mm)} mm`;
  }

  tick(dt) {
    this.motes.tick(dt);
  }
}
