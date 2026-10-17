// One floating field diorama for the 3D Season view (R4). season3d.js makes two, side by side.
//
//   grid     a glass cube grid under the field: theme.three.grid cols x rows columns, `layers` deep, small gaps.
//            Frosted glass (MeshPhysicalMaterial transmission) with thin bright edge lines (one merged
//            LineSegments). Every cube carries a faint brown tint (emissive): the soil.
//   water    an inner cyan box per cube fills the grid from the bottom layer up with obs.soil_water_frac; the top
//            water cube fills partially by fraction
//   plants   R2 neon maize (maize3d.js), one plant on the center of each top cube: height ~ obs.biomass_kg_ha over
//            the task's max across both fields, leaves from obs.stage, tassel at VT / R, spring growth with a
//            stagger, sway, thirst droop (soil_water_frac), storm lean
//   N        small green emissive cores inside the top-layer cubes, count ~ obs.soil_n_kg_ha. A dose drops cores in
//            from above (decision.n_kg_ha); uptake sends cores up into the plant above and fades them
//            (weekly.n_uptake)
//   leach    red cores drop out of the bottom layer (weekly.n_leached) into a flat glass groundwater slab whose red
//            tint builds with cumulative N leached; each splash adds to a pulse
//
// Bloom (season3d.js, selective, BLOOM_LAYER): plants, water fill, cores and the groundwater fluid. Glass and edge
// lines are hidden in the bloom pass. Every value comes from the week snapshot main.js passes in; amounts scale by
// the max across both fields. ?lite=1: plain translucent glass (no transmission), half the dose and leach cores.

import * as THREE from "three";
import { theme } from "./theme.js";
import { maizeMaterial, maizeGeometry, SHARED_GLSL, LEAVES } from "./maize3d.js";
import { leafCount, hasTassel } from "./fieldSvg.js";

export const BLOOM_LAYER = 1;

const T = theme.three, G = T.grid, GL = T.glass, P = T.plants, K = T.cores;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const has = (v) => typeof v === "number" && Number.isFinite(v);

// Deterministic jitter in [0, 1) per cube, plant or slot, so the field stays put between weeks.
function jitter(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Damped spring (mass 1), fixed substeps.
class Spring {
  constructor(x = 0, k = 55, c = 10.5) {
    this.x = this.target = x;
    this.v = 0;
    this.k = k;
    this.c = c;
  }

  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (this.target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }

  snap() {
    this.x = this.target;
    this.v = 0;
  }
}

// ---------------------------------------------------------------- emissive cube material (water, cores, fluid)

const VOXEL_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aEmit;
varying vec3 vColor;
varying vec3 vEmit;
varying vec3 vNormalW;
varying float vViewZ;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vNormalW = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
  vColor = aColor;
  vEmit = aEmit;
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const VOXEL_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform float uEmit;
uniform float uGlow;
uniform float uBlack;
varying vec3 vColor;
varying vec3 vEmit;
varying vec3 vNormalW;
varying float vViewZ;
void main() {
  vec3 col = vColor * matte(vNormalW) + vEmit * uEmit;
  col += uFlash * (0.5 * vColor + vec3(0.08, 0.09, 0.1));
  col *= mix(1.0, uGlow, uBloomPass);
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)) * (1.0 - uBlack), 1.0);
  #include <colorspace_fragment>
}
`;

// One instanced cube kind: per-instance base color (lit, matte) and emissive color (unlit, times uEmit). Opaque,
// so the glass transmission sees it.
function voxels(count, U, { emit = 1, glow = 1, color = null, emitColor = null } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const em = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  for (let i = 0; i < count; i++) {
    if (color) col.setXYZ(i, color.r, color.g, color.b);
    if (emitColor) em.setXYZ(i, emitColor.r, emitColor.g, emitColor.b);
  }
  geo.setAttribute("aColor", col);
  geo.setAttribute("aEmit", em);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VOXEL_VERTEX, fragmentShader: VOXEL_FRAGMENT,
    uniforms: { uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uBloomPass: U.uBloomPass,
      uEmit: { value: emit }, uGlow: { value: glow }, uBlack: { value: 0 } },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.layers.enable(BLOOM_LAYER);
  return { mesh, mat };
}

// Frosted glass. ?lite=1: no transmission, plain translucent.
function glassMaterial(lite) {
  return new THREE.MeshPhysicalMaterial({
    color: GL.tint, emissive: GL.soil, emissiveIntensity: GL.soilGlow,
    roughness: GL.roughness, metalness: 0, ior: GL.ior, envMapIntensity: GL.env,
    transmission: lite ? 0 : GL.transmission, thickness: lite ? 0 : GL.thickness,
    transparent: lite, opacity: lite ? GL.liteOpacity : 1, depthWrite: !lite,
  });
}

// The 12 edges of each box {x, y, z, sx, sy, sz}, merged into one position buffer.
function edgeGeometry(boxes) {
  const pos = [];
  for (const b of boxes) {
    const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
    const c = [];
    for (const dx of [-hx, hx]) for (const dy of [-hy, hy]) for (const dz of [-hz, hz]) c.push([b.x + dx, b.y + dy, b.z + dz]);
    // Corner index = 4 * ix + 2 * iy + iz; edges join corners that differ in one bit.
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) if (!(i & bit)) pos.push(...c[i], ...c[i | bit]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------- diorama

export class Diorama {
  // shared: scene-wide uniform objects {uTime, uFlash, uFogOn, uFogNear, uFogFar, uPx, uBloomPass}
  constructor({ x, shared, lite = false, reduceMotion = false }) {
    this.reduce = reduceMotion;
    this.lite = lite;
    this.shared = shared;
    this.scale = {};
    this.group = new THREE.Group();
    this.group.position.x = x;
    this.pitch = G.pitch;
    this.s = G.pitch * (1 - G.gap);                        // cube size
    this.W = G.cols * G.pitch - G.gap * G.pitch;           // outer width (x)
    this.D = G.rows * G.pitch - G.gap * G.pitch;           // outer depth (z)
    this.depth = (G.layers - 1) * G.pitch + this.s;        // grid height; the top face sits at y = 0
    this.slabTop = -this.depth - G.slabGap;
    this.slabBottom = this.slabTop - G.slabH;
    this.target = { grow: 0, leaves: 1, tassel: 0 };
    this.since = 0;
    this.water = new Spring(0, 30, 10);
    this.droop = new Spring(0, 30, 10);
    this.lean = new Spring(0, 18, 6);
    this.wind = new Spring(T.wind, 18, 8);
    this.level = new Spring(0, 20, 9);
    this.pulse = 0;
    this.waterDrawn = -1;
    this.motes = [];
    this.soilTarget = 0;
    this.m4 = new THREE.Matrix4();
    this.build();
  }

  // Cube centers: column (ix, iz), layer 0 at the top.
  cx(ix) { return (ix - (G.cols - 1) / 2) * this.pitch; }
  cz(iz) { return (iz - (G.rows - 1) / 2) * this.pitch; }
  cy(layer) { return -this.s / 2 - layer * this.pitch; }

  build() {
    const c = theme.color, g = this.group, U = this.shared, m = this.m4, s = this.s;
    const col = (hex) => new THREE.Color(hex);

    // Glass cubes, layer 0 (top) to layers - 1; the slight per-cube tint jitter keeps the grid from looking flat.
    this.cubes = [];
    for (let layer = 0; layer < G.layers; layer++) {
      for (let ix = 0; ix < G.cols; ix++) {
        for (let iz = 0; iz < G.rows; iz++) this.cubes.push({ ix, iz, layer, x: this.cx(ix), y: this.cy(layer), z: this.cz(iz) });
      }
    }
    this.glassMat = glassMaterial(this.lite);
    this.glass = new THREE.InstancedMesh(new THREE.BoxGeometry(s, s, s), this.glassMat, this.cubes.length);
    const tint = new THREE.Color();
    this.cubes.forEach((q, i) => {
      this.glass.setMatrixAt(i, m.makeTranslation(q.x, q.y, q.z));
      this.glass.setColorAt(i, tint.setScalar(0.9 + 0.1 * jitter(i, 11)));
    });
    this.glass.renderOrder = 2;
    g.add(this.glass);

    // Groundwater slab: a flat glass box under the grid, a red fluid inside (its glow builds with leaching).
    this.slabMat = glassMaterial(this.lite);
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(this.W, G.slabH, this.D), this.slabMat);
    this.slab.position.y = (this.slabTop + this.slabBottom) / 2;
    this.slab.renderOrder = 2;
    g.add(this.slab);
    this.red = col(c.leach);
    this.soilColor = col(GL.soil);
    this.fluid = voxels(1, U, { emit: 0.06, glow: T.glow.pool, color: col("#1a0606"), emitColor: this.red });
    this.fluid.mesh.setMatrixAt(0, m.makeScale(this.W - 0.08, G.slabH * 0.5, this.D - 0.08).setPosition(0, this.slab.position.y, 0));
    g.add(this.fluid.mesh);

    // Edge lines: every cube and the slab, one draw call.
    const boxes = this.cubes.map((q) => ({ x: q.x, y: q.y, z: q.z, sx: s, sy: s, sz: s }));
    boxes.push({ x: 0, y: this.slab.position.y, z: 0, sx: this.W, sy: G.slabH, sz: this.D });
    this.edgeMat = new THREE.LineBasicMaterial({ color: GL.edge, transparent: true, opacity: GL.edgeOpacity, depthWrite: false });
    this.edges = new THREE.LineSegments(edgeGeometry(boxes), this.edgeMat);
    this.edges.renderOrder = 3;
    g.add(this.edges);

    // Water: one inner box per cube, scaled by its fill (0 = hidden).
    this.waterBox = voxels(this.cubes.length, U, { emit: T.water.emit, glow: T.glow.water, color: col(T.water.color), emitColor: col(c.water) });
    this.waterBox.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(this.waterBox.mesh);

    // Plants: one on the center of each top cube.
    this.plants = this.cubes.filter((q) => q.layer === 0).map((q, k) => ({
      x: q.x, z: q.z, ix: q.ix, iz: q.iz, yaw: jitter(k, 3) * Math.PI * 2,
      seed: [jitter(k, 4) * 6.28, 0.86 + 0.2 * jitter(k, 5), jitter(k, 6)],
      lag: 0.35 * ((q.ix + 0.5) / G.cols) + 0.12 * jitter(k, 7),
      grow: new Spring(0), leaves: new Spring(1), tassel: new Spring(0, 40, 12), h: P.sprout,
    }));
    this.plantAt = new Map(this.plants.map((p) => [`${p.ix},${p.iz}`, p]));
    this.maizeMat = maizeMaterial({ uTime: U.uTime, uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear,
      uFogFar: U.uFogFar, uBloomPass: U.uBloomPass },
    { maxH: P.maxH, sprout: P.sprout, colors: { plant: c.plant, ...T.maize }, glow: T.glow });
    const geo = maizeGeometry();
    const seeds = new Float32Array(this.plants.length * 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(this.plants.length * 3), 3);
    this.state.setUsage(THREE.DynamicDrawUsage);
    this.plants.forEach((p, i) => seeds.set(p.seed, i * 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 3));
    geo.setAttribute("aState", this.state);
    this.maize = new THREE.InstancedMesh(geo, this.maizeMat, this.plants.length);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    this.plants.forEach((p, i) => this.maize.setMatrixAt(i, m.compose(at.set(p.x, 0, p.z), q.setFromAxisAngle(up, p.yaw), one)));
    this.maize.frustumCulled = false;
    this.maize.layers.enable(BLOOM_LAYER);
    g.add(this.maize);

    // N core slots: perCube per top cube, inside the inner part of the cube. Fill order: one core per cube (in a
    // shuffled cube order) before the second, so the grid fills evenly.
    const tops = this.cubes.filter((cb) => cb.layer === 0);
    const h = s / 2 - K.size;
    this.slots = [];
    for (let j = 0; j < K.perCube; j++) {
      const order = tops.map((cb, i) => ({ cb, r: jitter(i, 20 + j) })).sort((a, b) => a.r - b.r);
      for (const { cb } of order) {
        const n = this.slots.length;
        this.slots.push({ x: cb.x + (jitter(n, 21) - 0.5) * 1.3 * h, y: cb.y + (jitter(n, 22) - 0.5) * 1.3 * h,
          z: cb.z + (jitter(n, 23) - 0.5) * 1.3 * h, ix: cb.ix, iz: cb.iz });
      }
    }
    this.used = new Set();

    // Cores: green N, red leaching.
    this.capN = K.capN;
    this.capLeach = this.lite ? Math.round(K.capLeach / 2) : K.capLeach;
    const green = col(c.nitrogen);
    this.nCubes = voxels(this.capN, U, { glow: T.glow.core, color: green.clone().multiplyScalar(0.3), emitColor: green.clone().multiplyScalar(0.9) });
    this.leachCubes = voxels(this.capLeach, U, { glow: T.glow.core, color: this.red.clone().multiplyScalar(0.3), emitColor: this.red.clone().multiplyScalar(1.6) });
    for (const k of [this.nCubes, this.leachCubes]) {
      k.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      k.mesh.count = 0;
      g.add(k.mesh);
    }
  }

  materials() {
    return [this.glassMat, this.slabMat, this.edgeMat, this.fluid.mat, this.waterBox.mat, this.maizeMat, this.nCubes.mat, this.leachCubes.mat];
  }

  // World-space points for the HTML overlays (season3d.js): the label anchor above the field, the field center,
  // and the slab's front-bottom corners (the lowest part of the field on screen).
  anchors() {
    const x = this.group.position.x;
    return {
      head: new THREE.Vector3(x, T.labelY, 0),
      center: new THREE.Vector3(x, -this.depth / 2, 0),
      bottom: [-1, 1].map((sx) => new THREE.Vector3(x + sx * this.W / 2, this.slabBottom, this.D / 2)),
    };
  }

  setScale(scale) {
    this.scale = scale || {};
  }

  clear() {
    this.motes = [];
    this.used.clear();
    this.pulse = 0;
    this.soilTarget = 0;
  }

  // snap: {k, W, obs, weekly, cumLeached, harvest} or null (no log). events: data.weekEvents(), only when the
  // week changed. spread: seconds over which this week's cores start.
  show(snap, events = [], spread = 1) {
    const sc = this.scale;
    const share = (v, max) => (has(v) && max > 0 ? clamp(v / max, 0, 1) : 0);
    this.maize.visible = !!snap;   // no log for this season: bare grid
    if (!snap) {
      Object.assign(this.target, { grow: 0, leaves: 0, tassel: 0 });
      this.since = 0;
      this.water.target = 0;
      this.droop.target = 0;
      this.lean.target = 0;
      this.level.target = 0;
      this.clear();
      return;
    }
    const obs = snap.obs || {};
    const next = { grow: share(obs.biomass_kg_ha, sc.biomass), leaves: leafCount(obs.stage, snap.k, snap.W),
      tassel: hasTassel(obs.stage) ? 1 : 0 };
    if (next.grow !== this.target.grow || next.leaves !== this.target.leaves || next.tassel !== this.target.tassel) {
      this.target = next;
      this.since = 0;
    }
    const swf = has(obs.soil_water_frac) ? clamp(obs.soil_water_frac, 0, 1) : null;
    this.water.target = swf ?? 0;
    this.droop.target = swf === null ? 0 : clamp((T.thirst.start - swf) / (T.thirst.start - T.thirst.full), 0, 1);
    this.level.target = share(snap.cumLeached, sc.leachCum);
    const rain = !snap.harvest && snap.weekly && has(snap.weekly.rain_mm) ? snap.weekly.rain_mm : null;
    const storm = rain !== null && rain > theme.stormMm;
    this.lean.target = storm ? T.stormLean : 0;
    this.wind.target = storm ? T.stormWind : T.wind;

    const half = this.lite ? 0.5 : 1;
    for (const e of events) {
      if (e.kind === "n") this.dose(Math.max(3, Math.round(K.dose * half * share(e.amount, sc.dose))), spread * 0.6);
      else if (e.kind === "uptake") this.uptake(Math.max(2, Math.round(K.uptake * share(e.amount, sc.uptake))), spread);
      else if (e.kind === "leach") {
        const s = share(e.amount, sc.leachWeek);
        this.leach(Math.max(3, Math.round(K.leach * half * s)), spread, s);
      }
    }
    // After the dose and uptake, so falling cores settle into the soil count instead of doubling it.
    this.setSoil(this.slots.length * share(obs.soil_n_kg_ha, sc.soilN));
    if (this.reduce) this.settle();
  }

  // Reduced motion: jump every spring to its target.
  settle() {
    for (const p of this.plants) {
      p.grow.target = this.target.grow;
      p.leaves.target = this.target.leaves;
      p.tassel.target = this.target.tassel;
      p.grow.snap(); p.leaves.snap(); p.tassel.snap();
    }
    for (const s of [this.water, this.droop, this.lean, this.level]) s.snap();
  }

  // ------------------------------------------------------------ cores

  freeSlot() {
    for (let i = 0; i < this.slots.length; i++) if (!this.used.has(i)) return i;
    return -1;
  }

  soilCore(slot, fadeIn = true) {
    this.used.add(slot);
    const p = this.slots[slot];
    return { kind: "soil", slot, x: p.x, y: p.y, z: p.z, a: fadeIn ? 0 : 1, to: 1, size: K.size * rand(0.85, 1.05), ph: rand(0, 6.28) };
  }

  setSoil(target) {
    this.soilTarget = Math.max(0, Math.min(this.slots.length, Math.round(target)));
    const alive = this.motes.filter((m) => m.kind === "soil" && m.to > 0);
    const pending = this.motes.filter((m) => m.kind === "fall").length;
    for (const m of alive.slice(this.soilTarget)) {
      m.to = 0;
      this.used.delete(m.slot);
    }
    const deficit = this.soilTarget - alive.length - pending;
    for (let i = 0; i < deficit; i++) {
      const slot = this.freeSlot();
      if (slot < 0) break;
      this.motes.push(this.soilCore(slot, !this.reduce));
    }
  }

  // Dose: cores drop in from above into free slots of the top cubes.
  dose(count, spread) {
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      let slot = this.freeSlot();
      if (slot >= 0) this.used.add(slot);
      else slot = Math.floor(Math.random() * this.slots.length);
      const p = this.slots[slot];
      this.motes.push({ kind: "fall", slot, x: p.x, y: rand(2.8, 3.8), z: p.z, vy: -rand(0.8, 1.8), delay: rand(0, spread),
        land: p.y, size: K.size });
    }
  }

  // Uptake: resting cores rise into the plant standing on their cube and fade on the way up.
  uptake(count, spread) {
    if (this.reduce || !this.plants.length) return;
    const alive = this.motes.filter((m) => m.kind === "soil" && m.to > 0 && m.a > 0.5).sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const from = alive[i];
      const slot = from ? from.slot : Math.floor(Math.random() * this.slots.length);
      if (from) {
        from.kind = "gone";
        this.used.delete(slot);
      }
      const s = this.slots[slot], p = this.plantAt.get(`${s.ix},${s.iz}`);
      this.motes.push({ kind: "rise", x0: s.x, y0: s.y, z0: s.z, px: p.x, pz: p.z, x: s.x, y: s.y, z: s.z,
        y1: Math.max(0.15, p.h * rand(0.35, 0.85)), t: 0, life: rand(1.2, 1.8), delay: rand(0, spread), a: 1, size: K.size * 0.85 });
    }
  }

  // share = this week's leaching over the task's worst week (0..1): bigger, brighter cores for the worst week.
  leach(count, spread, share) {
    this.pulse = Math.min(1.6, this.pulse + 0.15 * share);
    if (this.reduce) return;
    const bottom = this.cy(G.layers - 1);
    for (let i = 0; i < count; i++) {
      const ix = Math.floor(Math.random() * G.cols), iz = Math.floor(Math.random() * G.rows), h = this.s * 0.3;
      this.motes.push({ kind: "leach", x: this.cx(ix) + rand(-h, h), y: bottom + rand(-h, h), z: this.cz(iz) + rand(-h, h),
        vy: -rand(0.2, 0.6), delay: 0.25 + spread * 0.3 + rand(0, spread * 1.2), size: K.size * (0.8 + 0.5 * share), share, trail: [] });
    }
  }

  tickMotes(dt) {
    const keep = [];
    let soilAlive = this.motes.filter((m) => m.kind === "soil" && m.to > 0).length;
    for (const m of this.motes) {
      if (m.delay > 0) { m.delay -= dt; keep.push(m); continue; }
      switch (m.kind) {
        case "soil":
          if (!this.reduce) m.ph += dt * 1.4;
          m.a += Math.sign(m.to - m.a) * Math.min(Math.abs(m.to - m.a), dt * 2.5);
          if (m.to > 0 || m.a > 0.01) keep.push(m);
          break;
        case "fall":
          m.vy -= 6 * dt; m.y += m.vy * dt;
          if (m.y <= m.land) {
            const stay = soilAlive < this.soilTarget;
            if (stay) soilAlive++;
            else this.used.delete(m.slot);
            keep.push({ kind: "soil", slot: m.slot, x: m.x, y: m.land, z: m.z, a: 1, to: stay ? 1 : 0, size: m.size, ph: rand(0, 6.28) });
          } else keep.push(m);
          break;
        case "rise": {
          m.t += dt;
          const p = m.t / m.life;
          if (p >= 1) break;
          const toStalk = Math.min(1, p / 0.3), e = 1 - (1 - toStalk) ** 2;
          m.x = m.x0 + (m.px - m.x0) * e;
          m.z = m.z0 + (m.pz - m.z0) * e;
          m.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - p) ** 2);
          m.a = p > 0.6 ? (1 - p) / 0.4 : 1;
          keep.push(m);
          break;
        }
        case "leach":
          m.trail.unshift(m.y);
          if (m.trail.length > 4) m.trail.pop();
          m.vy -= 5 * dt; m.y += m.vy * dt;
          if (m.y <= this.slabTop) {
            keep.push({ kind: "splash", x: m.x, y: this.slabTop, z: m.z, t: 0, life: 0.6, size: m.size });
            this.pulse = Math.min(1.6, this.pulse + 0.03 * (0.6 + m.share));
          } else keep.push(m);
          break;
        case "splash":
          m.t += dt;
          if (m.t < m.life) keep.push(m);
          break;
        default: break;   // "gone": a soil core that turned into an uptake riser
      }
    }
    this.motes = keep;
    this.writeMotes();
  }

  // Cube scale stands in for alpha: fading cores shrink.
  writeMotes() {
    const m4 = this.m4, N = this.nCubes, L = this.leachCubes;
    let nn = 0, nl = 0;
    const put = (k, x, y, z, s) => {
      if (s <= 0.004) return;
      if (k === N ? nn >= this.capN : nl >= this.capLeach) return;
      k.mesh.setMatrixAt(k === N ? nn++ : nl++, m4.makeScale(s, s, s).setPosition(x, y, z));
    };
    for (const m of this.motes) {
      if (m.delay > 0) continue;
      if (m.kind === "soil") put(N, m.x, m.y, m.z, m.size * m.a * (this.reduce ? 1 : 0.92 + 0.08 * Math.sin(m.ph)));
      else if (m.kind === "fall") put(N, m.x, m.y, m.z, m.size);
      else if (m.kind === "rise") put(N, m.x, m.y, m.z, m.size * m.a);
      else if (m.kind === "leach") {
        put(L, m.x, m.y, m.z, m.size);
        m.trail.forEach((ty, i) => put(L, m.x, ty, m.z, m.size * 0.6 * (1 - (i + 1) / (m.trail.length + 1))));
      } else if (m.kind === "splash") {
        const p = m.t / m.life;
        put(L, m.x, m.y, m.z, m.size * (1 + 1.5 * p) * (1 - p));
      }
    }
    N.mesh.count = nn;
    L.mesh.count = nl;
    N.mesh.instanceMatrix.needsUpdate = true;
    L.mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ water

  // wf = soil_water_frac (0..1 of the grid height): layers fill from the bottom; the top wet cube fills by fraction.
  drawWater(wf) {
    if (Math.abs(wf - this.waterDrawn) < 0.002) return;
    this.waterDrawn = wf;
    const level = wf * G.layers, inner = this.s * T.water.fill, pad = (this.s - inner) / 2, m4 = this.m4;
    this.cubes.forEach((q, i) => {
      const b = G.layers - 1 - q.layer;   // 0 = bottom layer
      const t = clamp(level - b, 0, 1);
      const h = inner * t;
      if (h < 0.004) m4.makeScale(0, 0, 0);
      else m4.makeScale(inner, h, inner).setPosition(q.x, q.y - this.s / 2 + pad + h / 2, q.z);
      this.waterBox.mesh.setMatrixAt(i, m4);
    });
    this.waterBox.mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ frame

  update(dt) {
    this.since += dt;
    const step = (s) => (this.reduce ? s.snap() : s.step(dt));
    const arr = this.state.array;
    this.plants.forEach((p, i) => {
      if (this.since >= p.lag || this.reduce) {
        p.grow.target = this.target.grow;
        p.leaves.target = this.target.leaves;
        p.tassel.target = this.target.tassel;
      }
      step(p.grow); step(p.leaves); step(p.tassel);
      arr[i * 3] = Math.max(0, p.grow.x);
      arr[i * 3 + 1] = clamp(p.leaves.x, 0, LEAVES);
      arr[i * 3 + 2] = clamp(p.tassel.x, 0, 1.2);
      p.h = (P.sprout + (P.maxH - P.sprout) * Math.max(0, p.grow.x)) * p.seed[1];
    });
    this.state.needsUpdate = true;

    for (const s of [this.water, this.droop, this.lean, this.wind, this.level]) step(s);
    const u = this.maizeMat.uniforms;
    u.uWind.value = this.reduce ? 0 : Math.max(0, this.wind.x);
    u.uLean.value = this.lean.x;
    u.uDroop.value = clamp(this.droop.x, 0, 1);

    this.pulse *= Math.exp(-1.4 * dt);
    const pulse = this.reduce ? 0 : this.pulse, lv = clamp(this.level.x, 0, 1);
    this.fluid.mat.uniforms.uEmit.value = 0.06 + 0.8 * lv + 1.7 * pulse;
    this.slabMat.emissive.copy(this.soilColor).lerp(this.red, clamp(GL.slabRed * (lv + 0.5 * pulse), 0, 1));
    this.drawWater(clamp(this.water.x, 0, 1));
    this.tickMotes(Math.min(dt, 0.05));
  }

  // Lightning lights the cube shaders through the shared uFlash uniform and the glass through the scene lights
  // (season3d.js); nothing per field.
  flash() {}
}
