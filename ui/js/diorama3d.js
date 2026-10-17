// One floating voxel field diorama for the 3D Season view. season3d.js makes two, side by side. Everything is
// small matte cubes with tight gaps; neon only on data. One InstancedMesh (one draw call) per kind:
//
//   ground   top layer of matte dark-brown cubes; the plants sit directly on it
//   soil     brown cubes below (outer shell only: the inside is never seen), darker with depth. Water: the cubes
//            tint cyan from the bottom up with obs.soil_water_frac (glows softly). Leaching: the bottom rows warm
//            red with each splash
//   plants   voxel maize (maize3d.js): height ~ obs.biomass_kg_ha over the task's max across both fields, leaves
//            from obs.stage, tassel at VT / R, cubes pop in as they appear; sway, thirst droop (soil_water_frac),
//            storm lean
//   n        small green cubes: soil N sits on the ground (obs.soil_n_kg_ha), the dose falls in (decision.n_kg_ha),
//            uptake rises into the plants (weekly.n_uptake)
//   leach    small red cubes fall out of the block bottom (weekly.n_leached) into the groundwater pool
//   pool     flat red tiles under the block; their glow builds with cumulative N leached, and each splash adds to a
//            pulse, so the worst leaching week flares most (the strongest event on screen)
//
// Bloom (season3d.js, selective): soil (water tint, leach warmth), leach cubes and the pool only. Every value comes
// from the week snapshot main.js passes in; amounts scale by the max across both fields. ?lite=1 halves the cube
// counts (larger soil cells, half the plants, half the motes).

import * as THREE from "three";
import { theme } from "./theme.js";
import { maizeMaterial, plantSlots, SHARED_GLSL, LEAVES } from "./maize3d.js";
import { leafCount, hasTassel } from "./fieldSvg.js";

export const BLOOM_LAYER = 1;

const T = theme.three, B = T.block, P = T.plants, V = T.voxel;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const has = (v) => typeof v === "number" && Number.isFinite(v);

// Deterministic jitter in [0, 1) per cube or plant, so the field looks organic and stays put between weeks.
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

// ---------------------------------------------------------------- voxel material (ground, soil, pool, motes)

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
uniform float uBlack;
varying vec3 vColor;
varying vec3 vEmit;
varying vec3 vNormalW;
varying float vViewZ;
void main() {
  vec3 col = vColor * matte(vNormalW) + vEmit * uEmit;
  col += uFlash * (0.5 * vColor + vec3(0.08, 0.09, 0.1));
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)) * (1.0 - uBlack), 1.0);
  #include <colorspace_fragment>
}
`;

// One instanced cube kind: per-instance base color (lit, matte) and emissive color (unlit, times uEmit).
function voxels(count, U, emit = 1) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  geo.setAttribute("aColor", color);
  geo.setAttribute("aEmit", glow);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VOXEL_VERTEX, fragmentShader: VOXEL_FRAGMENT,
    uniforms: { uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar,
      uEmit: { value: emit }, uBlack: { value: 0 } },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  return { mesh, mat, color, glow };
}

// ---------------------------------------------------------------- diorama

export class Diorama {
  // shared: scene-wide uniform objects {uTime, uFlash, uFogOn, uFogNear, uFogFar, uPx}
  constructor({ x, shared, lite = false, reduceMotion = false }) {
    this.reduce = reduceMotion;
    this.lite = lite;
    this.shared = shared;
    this.scale = {};
    this.group = new THREE.Group();
    this.group.position.x = x;
    this.cap = lite ? Math.round(T.motes.cap / 2) : T.motes.cap;
    // Soil cell pitch: lite cells are sqrt(2) larger, so the (surface) cube counts halve.
    this.cell = lite ? V.cell * Math.SQRT2 : V.cell;
    this.nx = Math.round(B.w / this.cell);
    this.nz = Math.round(B.d / this.cell);
    this.ny = Math.max(4, Math.round(B.soil / this.cell));   // layers, ground layer included
    this.W = this.nx * this.cell;
    this.D = this.nz * this.cell;
    this.depth = this.ny * this.cell;
    this.poolY = -this.depth - B.gap;
    this.target = { grow: 0, leaves: 1, tassel: 0 };
    this.since = 0;
    this.water = new Spring(0, 30, 10);
    this.droop = new Spring(0, 30, 10);
    this.lean = new Spring(0, 18, 6);
    this.wind = new Spring(T.wind, 18, 8);
    this.level = new Spring(0, 20, 9);
    this.pulse = 0;
    this.leachGlow = 0;
    this.tint = { wf: -1, red: -1 };
    this.motes = [];
    this.soilTarget = 0;
    this.m4 = new THREE.Matrix4();
    this.build();
  }

  build() {
    const c = theme.color, g = this.group, U = this.shared, cell = this.cell, fill = V.fill;
    const bloom = (o) => { o.layers.enable(BLOOM_LAYER); return o; };
    const col = (hex) => new THREE.Color(hex);
    const m = this.m4;
    const cx = (ix) => -this.W / 2 + (ix + 0.5) * cell;
    const cz = (iz) => -this.D / 2 + (iz + 0.5) * cell;
    const cy = (layer) => -(layer + 0.5) * cell;

    // Ground: one full layer of matte dark-brown cubes; its top face sits at y ~ 0.
    const nTop = this.nx * this.nz;
    this.ground = voxels(nTop, U, 0);
    const gTop = col(V.ground.top), gLow = col(V.ground.low), tmp = new THREE.Color();
    let n = 0;
    for (let ix = 0; ix < this.nx; ix++) {
      for (let iz = 0; iz < this.nz; iz++) {
        this.ground.mesh.setMatrixAt(n, m.makeScale(cell * fill, cell * fill, cell * fill).setPosition(cx(ix), cy(0), cz(iz)));
        tmp.copy(gTop).lerp(gLow, jitter(n, 11));
        this.ground.color.setXYZ(n, tmp.r, tmp.g, tmp.b);
        n++;
      }
    }
    g.add(this.ground.mesh);

    // Soil: the outer shell of the block under the ground layer, darker with depth.
    const sTop = col(V.soil.top), sBottom = col(V.soil.bottom);
    this.soilCells = [];
    for (let layer = 1; layer < this.ny; layer++) {
      for (let ix = 0; ix < this.nx; ix++) {
        for (let iz = 0; iz < this.nz; iz++) {
          const shell = ix === 0 || iz === 0 || ix === this.nx - 1 || iz === this.nz - 1 || layer === this.ny - 1;
          if (!shell) continue;
          const k = this.soilCells.length;
          const base = sTop.clone().lerp(sBottom, (layer - 1) / Math.max(1, this.ny - 2))
            .multiplyScalar(0.88 + 0.24 * jitter(k, 13));
          this.soilCells.push({ x: cx(ix), y: cy(layer), z: cz(iz), b: this.ny - 1 - layer, base });
        }
      }
    }
    this.soil = voxels(this.soilCells.length, U, 1);
    this.soilCells.forEach((s, i) => {
      this.soil.mesh.setMatrixAt(i, m.makeScale(cell * fill, cell * fill, cell * fill).setPosition(s.x, s.y, s.z));
      this.soil.color.setXYZ(i, s.base.r, s.base.g, s.base.b);
    });
    this.soil.color.setUsage(THREE.DynamicDrawUsage);
    this.soil.glow.setUsage(THREE.DynamicDrawUsage);
    this.wet = col(V.wet);
    this.cyan = col(c.water);
    this.red = col(c.leach);
    g.add(bloom(this.soil.mesh));

    // Groundwater pool: flat red tiles under the block, one cell wider on each side.
    const px = this.nx + 2, pz = this.nz + 2;
    this.pool = voxels(px * pz, U, 0);
    const dark = col(V.pool);
    n = 0;
    for (let ix = 0; ix < px; ix++) {
      for (let iz = 0; iz < pz; iz++) {
        this.pool.mesh.setMatrixAt(n, m.makeScale(cell * fill, cell * 0.28, cell * fill)
          .setPosition(cx(ix - 1), this.poolY, cz(iz - 1)));
        this.pool.color.setXYZ(n, dark.r, dark.g, dark.b);
        const e = 0.75 + 0.4 * jitter(n, 17);
        this.pool.glow.setXYZ(n, this.red.r * e, this.red.g * e, this.red.b * e);
        n++;
      }
    }
    g.add(bloom(this.pool.mesh));

    // Voxel maize: one instance per cube slot per plant.
    this.plants = [];
    const per = P.perRow, xs = this.W - 0.5;
    this.rowZ().forEach((z0, r) => {
      for (let i = 0; i < per; i++) {
        if (this.lite && (i + r) % 2) continue;
        const k = r * per + i;
        const x = -xs / 2 + (xs * i) / (per - 1) + (jitter(k, 1) - 0.5) * 0.14;
        const z = z0 + (jitter(k, 2) - 0.5) * 0.16;
        this.plants.push({
          x, z, yaw: Math.floor(jitter(k, 3) * 4) * (Math.PI / 2) + (jitter(k, 8) - 0.5) * 0.3,
          seed: [jitter(k, 4) * 6.28, 0.86 + 0.2 * jitter(k, 5), jitter(k, 6)],
          lag: 0.35 * ((x + xs / 2) / xs) + 0.12 * jitter(k, 7),
          grow: new Spring(0), leaves: new Spring(1), tassel: new Spring(0, 40, 12), h: P.sprout,
        });
      }
    });
    this.slots = plantSlots({ maxH: P.maxH, cube: V.plant });
    const S = this.slots.length, count = this.plants.length * S;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const slot = new Float32Array(count * 3), seed = new Float32Array(count * 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.state.setUsage(THREE.DynamicDrawUsage);
    this.maizeMat = maizeMaterial({ uTime: U.uTime, uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar },
      { maxH: P.maxH, sprout: P.sprout, cube: V.plant, colors: V.maize });
    this.maize = new THREE.InstancedMesh(geo, this.maizeMat, count);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    this.plants.forEach((p, i) => {
      m.compose(at.set(p.x, 0, p.z), q.setFromAxisAngle(up, p.yaw), one);
      for (let s = 0; s < S; s++) {
        const k = i * S + s;
        this.maize.setMatrixAt(k, m);
        slot.set(this.slots[s], k * 3);
        seed.set(p.seed, k * 3);
      }
    });
    geo.setAttribute("aSlot", new THREE.InstancedBufferAttribute(slot, 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 3));
    geo.setAttribute("aState", this.state);
    this.maize.frustumCulled = false;
    g.add(this.maize);

    // Motes as small cubes: green N (no bloom), red leaching drips and splashes (bloom).
    this.nCubes = voxels(this.cap, U, 1);
    this.leachCubes = voxels(this.cap, U, 1);
    const green = col(c.nitrogen);
    for (let i = 0; i < this.cap; i++) {
      this.nCubes.color.setXYZ(i, green.r * 0.3, green.g * 0.3, green.b * 0.3);
      this.nCubes.glow.setXYZ(i, green.r * 0.85, green.g * 0.85, green.b * 0.85);
      this.leachCubes.color.setXYZ(i, this.red.r * 0.3, this.red.g * 0.3, this.red.b * 0.3);
      this.leachCubes.glow.setXYZ(i, this.red.r * 1.6, this.red.g * 1.6, this.red.b * 1.6);
    }
    for (const k of [this.nCubes, this.leachCubes]) {
      k.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      k.mesh.count = 0;
    }
    g.add(this.nCubes.mesh);
    g.add(bloom(this.leachCubes.mesh));
  }

  rowZ() {
    const n = P.rows, span = this.D - 0.8;
    return Array.from({ length: n }, (_, r) => -span / 2 + (n > 1 ? (span * r) / (n - 1) : span / 2));
  }

  materials() {
    return [this.ground.mat, this.soil.mat, this.pool.mat, this.maizeMat, this.nCubes.mat, this.leachCubes.mat];
  }

  // World-space anchors for the HTML overlays: field name above, N leached under the pool.
  anchor(kind) {
    const x = this.group.position.x;
    return kind === "pool" ? new THREE.Vector3(x, this.poolY - 0.12, this.D * 0.54) : new THREE.Vector3(x, T.labelY, 0);
  }

  setScale(scale) {
    this.scale = scale || {};
  }

  clear() {
    this.motes = [];
    this.pulse = 0;
    this.soilTarget = 0;
  }

  // snap: {k, W, obs, weekly, cumLeached, harvest} or null (no log). events: data.weekEvents(), only when the
  // week changed. spread: seconds over which this week's motes start.
  show(snap, events = [], spread = 1) {
    const sc = this.scale;
    const share = (v, max) => (has(v) && max > 0 ? clamp(v / max, 0, 1) : 0);
    this.group.visible = true;
    this.maize.visible = !!snap;   // no log for this season: bare ground
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

    for (const e of events) {
      if (e.kind === "n") this.dose(Math.max(4, Math.round(T.motes.dose * share(e.amount, sc.dose))), spread * 0.6);
      else if (e.kind === "uptake") this.uptake(Math.max(2, Math.round(T.motes.uptake * share(e.amount, sc.uptake))), spread);
      else if (e.kind === "leach") {
        const s = share(e.amount, sc.leachWeek);
        this.leach(Math.max(3, Math.round(T.motes.leach * s)), spread, s);
      }
    }
    // After the dose spawns its falling cubes, so they settle into the soil count instead of doubling it.
    this.setSoil(T.motes.soil * share(obs.soil_n_kg_ha, sc.soilN));
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

  // ------------------------------------------------------------ motes (cubes)

  // Soil N: a green cube resting on the ground between the plants.
  soilMote(fadeIn = true) {
    const size = rand(0.05, 0.065);
    return { kind: "soil", x: rand(-this.W / 2 + 0.1, this.W / 2 - 0.1), y: size / 2, z: rand(-this.D / 2 + 0.1, this.D / 2 - 0.1),
      a: fadeIn ? 0 : 1, to: 1, size, ph: rand(0, 6.28) };
  }

  push(m) {
    if (this.motes.length < this.cap / 2) this.motes.push(m);
  }

  setSoil(target) {
    this.soilTarget = Math.max(0, Math.round(target));
    const alive = this.motes.filter((m) => m.kind === "soil" && m.to > 0);
    const pending = this.motes.filter((m) => m.kind === "fall").length;
    for (const m of alive.slice(this.soilTarget)) m.to = 0;
    const deficit = this.soilTarget - alive.length - pending;
    for (let i = 0; i < deficit; i++) this.push(this.soilMote(!this.reduce));
  }

  dose(count, spread) {
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      const size = rand(0.055, 0.07);
      this.push({ kind: "fall", x: rand(-this.W / 2 + 0.1, this.W / 2 - 0.1), y: rand(2.6, 3.6), z: rand(-this.D / 2 + 0.1, this.D / 2 - 0.1),
        vy: -rand(0.8, 1.8), delay: rand(0, spread), land: size / 2, a: 1, size });
    }
  }

  uptake(count, spread) {
    if (this.reduce || !this.plants.length) return;
    for (let i = 0; i < count; i++) {
      const p = this.plants[Math.floor(Math.random() * this.plants.length)];
      const y0 = 0.03, side = Math.random() < 0.5 ? -1 : 1;
      this.push({ kind: "rise", px: p.x + side * V.plant, pz: p.z, x: p.x, y: y0, z: p.z, y0, y1: p.h * rand(0.35, 0.9), t: 0,
        life: rand(1.2, 1.8), delay: rand(0, spread), a: 0, size: rand(0.04, 0.05) });
    }
  }

  // share = this week's leaching over the task's worst week (0..1): bigger, brighter drips for the worst week.
  leach(count, spread, share) {
    this.leachGlow = Math.max(this.leachGlow, share);
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      this.push({ kind: "leach", x: rand(-this.W / 2 + 0.15, this.W / 2 - 0.15), y: -this.depth - rand(0, 0.08),
        z: rand(-this.D / 2 + 0.15, this.D / 2 - 0.15), vy: -rand(0.3, 0.8), delay: 0.25 + spread * 0.3 + rand(0, spread * 1.2),
        a: 1, size: 0.05 + 0.05 * share, share, trail: [] });
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
            keep.push({ kind: "soil", x: m.x, y: m.land, z: m.z, a: 1, to: stay ? 1 : 0, size: m.size, ph: rand(0, 6.28) });
          } else keep.push(m);
          break;
        case "rise": {
          m.t += dt;
          const p = m.t / m.life;
          if (p >= 1) break;
          m.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - p) ** 2);
          m.x = m.px;
          m.a = Math.min(1, p * 5) * (p > 0.7 ? (1 - p) / 0.3 : 1);
          keep.push(m);
          break;
        }
        case "leach":
          m.trail.unshift(m.y);
          if (m.trail.length > 4) m.trail.pop();
          m.vy -= 5 * dt; m.y += m.vy * dt;
          if (m.y <= this.poolY) {
            keep.push({ kind: "splash", x: m.x, y: this.poolY + 0.04, z: m.z, t: 0, life: 0.6, size: m.size });
            this.pulse = Math.min(1.6, this.pulse + 0.03 * (0.6 + m.share));
          } else keep.push(m);
          break;
        case "splash":
          m.t += dt;
          if (m.t < m.life) keep.push(m);
          break;
        default: break;
      }
    }
    this.motes = keep;
    this.writeMotes();
  }

  // Cube scale stands in for alpha: fading cubes shrink.
  writeMotes() {
    const m4 = this.m4, N = this.nCubes, L = this.leachCubes;
    let nn = 0, nl = 0;
    const put = (k, x, y, z, s) => {
      if (s <= 0.004) return;
      if (k === N ? nn >= this.cap : nl >= this.cap) return;
      k.mesh.setMatrixAt(k === N ? nn++ : nl++, m4.makeScale(s, s, s).setPosition(x, y, z));
    };
    for (const m of this.motes) {
      if (m.delay > 0) continue;
      if (m.kind === "soil") put(N, m.x, m.y, m.z, m.size * m.a * (this.reduce ? 1 : 0.92 + 0.08 * Math.sin(m.ph)));
      else if (m.kind === "fall" || m.kind === "rise") put(N, m.x, m.y, m.z, m.size * Math.min(1, m.a));
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

  // ------------------------------------------------------------ soil tint

  // Water from the bottom up (wf = soil_water_frac, 0..1 of the soil layers): wet cubes shift to dark cyan with a
  // faint glow; the top wet layer (the water line) glows a little more, which is all the bloom picks up. Leaching
  // warms the bottom rows red (splash pulse and the week's share of the worst week).
  tintSoil(wf, red) {
    if (Math.abs(wf - this.tint.wf) < 0.002 && Math.abs(red - this.tint.red) < 0.004) return;
    this.tint.wf = wf;
    this.tint.red = red;
    const layers = this.ny - 1, level = wf * layers, low = Math.max(1, 0.35 * layers);
    const { color, glow } = this.soil, c = new THREE.Color();
    this.soilCells.forEach((s, i) => {
      const t = clamp(level - s.b, 0, 1);
      const line = t * (1 - clamp(level - s.b - 1, 0, 1));
      const w = 0.12 * t + 0.26 * line;
      const r = red * Math.max(0, 1 - s.b / low);
      c.copy(s.base).lerp(this.wet, 0.7 * t);
      color.setXYZ(i, c.r, c.g, c.b);
      glow.setXYZ(i, this.cyan.r * w + this.red.r * r, this.cyan.g * w + this.red.g * r, this.cyan.b * w + this.red.b * r);
    });
    color.needsUpdate = true;
    glow.needsUpdate = true;
  }

  // ------------------------------------------------------------ frame

  update(dt) {
    this.since += dt;
    const step = (s) => (this.reduce ? s.snap() : s.step(dt));
    const arr = this.state.array, S = this.slots.length;
    this.plants.forEach((p, i) => {
      if (this.since >= p.lag || this.reduce) {
        p.grow.target = this.target.grow;
        p.leaves.target = this.target.leaves;
        p.tassel.target = this.target.tassel;
      }
      step(p.grow); step(p.leaves); step(p.tassel);
      const g = Math.max(0, p.grow.x), lv = clamp(p.leaves.x, 0, LEAVES), ts = clamp(p.tassel.x, 0, 1.2);
      for (let s = 0, k = i * S * 3; s < S; s++, k += 3) {
        arr[k] = g;
        arr[k + 1] = lv;
        arr[k + 2] = ts;
      }
      p.h = (P.sprout + (P.maxH - P.sprout) * g) * p.seed[1];
    });
    this.state.needsUpdate = true;

    for (const s of [this.water, this.droop, this.lean, this.wind, this.level]) step(s);
    const u = this.maizeMat.uniforms;
    u.uWind.value = this.reduce ? 0 : Math.max(0, this.wind.x);
    u.uLean.value = this.lean.x;
    u.uDroop.value = clamp(this.droop.x, 0, 1);

    this.pulse *= Math.exp(-1.4 * dt);
    this.leachGlow *= Math.exp(-0.9 * dt);
    const pulse = this.reduce ? 0 : this.pulse;
    this.pool.mat.uniforms.uEmit.value = 0.06 + 0.8 * clamp(this.level.x, 0, 1) + 1.7 * pulse;
    this.tintSoil(clamp(this.water.x, 0, 1), this.reduce ? 0 : Math.max(pulse * 0.6, this.leachGlow * 0.4));
    this.tickMotes(Math.min(dt, 0.05));
  }

  // Lightning lights every cube through the shared uFlash uniform; nothing per field.
  flash() {}
}
