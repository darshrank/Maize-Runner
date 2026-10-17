// One floating field diorama for the 3D Season view (R2). season3d.js makes two, side by side.
//
//   top      a row field of neon maize (maize3d.js, instanced): height ~ obs.biomass_kg_ha over the task's max
//            across both fields, leaves from obs.stage, tassel at VT / R stages, spring ease with a small stagger
//            per plant; leaves droop when obs.soil_water_frac is low (theme.three.thirst); storm weeks lean
//   soil     dark translucent block; a cyan water level plane rises with obs.soil_water_frac
//   motes    green N motes in the topsoil (obs.soil_n_kg_ha); the dose falls in (decision.n_kg_ha); uptake rises
//            into the plants (weekly.n_uptake)
//   drips    red nitrate drips fall out of the block bottom (weekly.n_leached) into a groundwater pool whose red
//            glow builds with cumulative N leached; each splash adds to a pulse, so the worst week flares most
//
// Every value comes from the week snapshot main.js passes in; amounts scale by the max across both fields.

import * as THREE from "three";
import { theme } from "./theme.js";
import { maizeGeometry, maizeMaterial, SHARED_GLSL, LEAVES } from "./maize3d.js";
import { leafCount, hasTassel } from "./fieldSvg.js";

export const BLOOM_LAYER = 1;

const T = theme.three, B = T.block, P = T.plants;
const POOL_Y = -B.soil - B.gap;
const WHITE = new THREE.Color(1, 1, 1);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const has = (v) => typeof v === "number" && Number.isFinite(v);

// Deterministic jitter in [0, 1) per plant, so the field looks organic and stays put between weeks.
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

// ---------------------------------------------------------------- shaders (soil, pool, motes)

const SOIL_VERTEX = /* glsl */ `
uniform float uSoilH;
varying float vH;
varying float vViewZ;
void main() {
  vH = 1.0 + position.y / uSoilH;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SOIL_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uLeachCol;
uniform float uLeach;
uniform float uOpacity;
varying float vH;
varying float vViewZ;
void main() {
  vec3 col = mix(uBottom, uTop, vH);
  col += uLeachCol * uLeach * (1.0 - smoothstep(0.0, 0.6, vH)) * 0.45;
  col += vec3(0.5, 0.58, 0.66) * uFlash * 0.18;
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)), uOpacity);
  #include <colorspace_fragment>
}
`;

const POOL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vViewZ;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const POOL_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform vec3 uColor;
uniform float uLevel;
uniform float uPulse;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0;
  float d = max(q.x, q.y);
  float body = 1.0 - smoothstep(0.35, 1.0, d);
  float rim = smoothstep(0.88, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
  float glow = 0.05 + 0.75 * uLevel + 1.6 * uPulse;
  vec3 col = uColor * (body * glow * 0.55 + rim * (0.2 + 0.8 * uLevel + 0.9 * uPulse));
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)), 1.0);
  #include <colorspace_fragment>
}
`;

const MOTE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_PointSize = aSize * uPx / max(vViewZ, 0.1);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha;
}
`;

const MOTE_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying vec3 vColor;
varying float vAlpha;
varying float vViewZ;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.4, d);
  float halo = pow(1.0 - d, 2.0) * 0.5;
  vec3 col = vColor * (1.5 * core + halo) + vec3(0.35 * core);
  gl_FragColor = vec4(col, vAlpha * (1.0 - fogFactor(vViewZ)));
  #include <colorspace_fragment>
}
`;

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
    this.target = { grow: 0, leaves: 1, tassel: 0 };
    this.since = 0;
    this.water = new Spring(0, 30, 10);
    this.droop = new Spring(0, 30, 10);
    this.lean = new Spring(0, 18, 6);
    this.wind = new Spring(T.wind, 18, 8);
    this.level = new Spring(0, 20, 9);
    this.pulse = 0;
    this.leachGlow = 0;
    this.motes = [];
    this.soilTarget = 0;
    this.lines = [];
    this.build();
  }

  build() {
    const c = theme.color, g = this.group, U = this.shared;
    const bloom = (o) => { o.layers.enable(BLOOM_LAYER); return o; };

    // Soil block: top face at y 0.
    const box = new THREE.BoxGeometry(B.w, B.soil, B.d);
    box.translate(0, -B.soil / 2, 0);
    this.soilMat = new THREE.ShaderMaterial({
      vertexShader: SOIL_VERTEX, fragmentShader: SOIL_FRAGMENT, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar,
        uSoilH: { value: B.soil }, uTop: { value: new THREE.Color("#141a10") }, uBottom: { value: new THREE.Color("#07080a") },
        uLeachCol: { value: new THREE.Color(c.leach) }, uLeach: { value: 0 }, uOpacity: { value: 0.5 } },
    });
    const soil = new THREE.Mesh(box, this.soilMat);
    soil.renderOrder = 1;
    g.add(soil);
    const edgeMat = new THREE.LineBasicMaterial({ color: "#4a5745", transparent: true, opacity: 0.9 });
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMat));
    this.lines.push({ mat: edgeMat, base: new THREE.Color("#4a5745") });

    // Furrows on the field top, one line per plant row.
    const rowZ = this.rowZ();
    const furrow = new THREE.BufferGeometry().setFromPoints(rowZ.flatMap((z) => [
      new THREE.Vector3(-B.w / 2 + 0.08, 0.003, z), new THREE.Vector3(B.w / 2 - 0.08, 0.003, z)]));
    g.add(new THREE.LineSegments(furrow, new THREE.LineBasicMaterial({ color: c.plant, transparent: true, opacity: 0.2 })));

    // Water: additive cyan volume scaled from the bottom, a level plane and its glowing edge.
    const inset = 0.04;
    const vol = new THREE.BoxGeometry(B.w - inset, 1, B.d - inset);
    vol.translate(0, 0.5, 0);
    this.waterVol = new THREE.Mesh(vol, new THREE.MeshBasicMaterial({ color: c.water, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.waterVol.position.y = -B.soil;
    this.waterVol.renderOrder = 2;
    g.add(this.waterVol);
    this.waterTop = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(B.w - inset, B.d - inset).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: c.water, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide }));
    plane.renderOrder = 2;
    const hw = (B.w - inset) / 2, hd = (B.d - inset) / 2;
    const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd), new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd)]),
    new THREE.LineBasicMaterial({ color: c.water, transparent: true, opacity: 0.9 }));
    this.waterTop.add(bloom(plane), bloom(loop));
    g.add(this.waterTop);

    // Groundwater pool under the block.
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERTEX, fragmentShader: POOL_FRAGMENT, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar,
        uColor: { value: new THREE.Color(c.leach) }, uLevel: { value: 0 }, uPulse: { value: 0 } },
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(B.w * 1.08, B.d * 1.08).rotateX(-Math.PI / 2), this.poolMat);
    pool.position.y = POOL_Y;
    pool.renderOrder = 2;
    g.add(bloom(pool));

    // Maize field.
    this.plants = [];
    const per = P.perRow, xs = B.w - 0.5;
    rowZ.forEach((z0, r) => {
      for (let i = 0; i < per; i++) {
        if (this.lite && (i + r) % 2) continue;
        const n = r * per + i;
        const x = -xs / 2 + (xs * i) / (per - 1) + (jitter(n, 1) - 0.5) * 0.14;
        const z = z0 + (jitter(n, 2) - 0.5) * 0.16;
        this.plants.push({
          x, z, yaw: jitter(n, 3) * Math.PI * 2,
          seed: [jitter(n, 4) * 6.28, 0.86 + 0.2 * jitter(n, 5), jitter(n, 6)],
          lag: 0.35 * ((x + xs / 2) / xs) + 0.12 * jitter(n, 7),
          grow: new Spring(0), leaves: new Spring(1), tassel: new Spring(0, 40, 12), h: P.sprout,
        });
      }
    });
    this.maizeMat = maizeMaterial({ uTime: U.uTime, uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar },
      { maxH: P.maxH, sprout: P.sprout, colors: c });
    const geo = maizeGeometry();
    const seeds = new Float32Array(this.plants.length * 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(this.plants.length * 3), 3);
    this.state.setUsage(THREE.DynamicDrawUsage);
    this.plants.forEach((p, i) => seeds.set(p.seed, i * 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 3));
    geo.setAttribute("aState", this.state);
    this.maize = new THREE.InstancedMesh(geo, this.maizeMat, this.plants.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    this.plants.forEach((p, i) => this.maize.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.yaw), one)));
    this.maize.frustumCulled = false;
    g.add(bloom(this.maize));

    // Motes and drips: one additive Points cloud.
    this.colors = { n: new THREE.Color(c.nitrogen), leach: new THREE.Color(c.leach) };
    const cap = this.cap;
    const mg = new THREE.BufferGeometry();
    this.mBuf = {
      pos: new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage),
      col: new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage),
      size: new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage),
      alpha: new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage),
    };
    mg.setAttribute("position", this.mBuf.pos);
    mg.setAttribute("aColor", this.mBuf.col);
    mg.setAttribute("aSize", this.mBuf.size);
    mg.setAttribute("aAlpha", this.mBuf.alpha);
    mg.setDrawRange(0, 0);
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uFlash: U.uFlash, uFogOn: U.uFogOn, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uPx: U.uPx },
    });
    this.points = new THREE.Points(mg, this.moteMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    g.add(bloom(this.points));
  }

  rowZ() {
    const n = P.rows, span = B.d - 0.8;
    return Array.from({ length: n }, (_, r) => -span / 2 + (n > 1 ? (span * r) / (n - 1) : span / 2));
  }

  materials() {
    return [this.soilMat, this.poolMat, this.maizeMat, this.moteMat];
  }

  // World-space anchors for the HTML overlays: field name above, N leached under the pool.
  anchor(kind) {
    const x = this.group.position.x;
    return kind === "pool" ? new THREE.Vector3(x, POOL_Y - 0.12, B.d * 0.54) : new THREE.Vector3(x, T.labelY, 0);
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
    if (!snap) {
      Object.assign(this.target, { grow: 0, leaves: 1, tassel: 0 });
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
    // After the dose spawns its falling motes, so they settle into the topsoil count instead of doubling it.
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

  // ------------------------------------------------------------ motes

  soilMote(fadeIn = true) {
    return { kind: "soil", x: rand(-B.w / 2 + 0.15, B.w / 2 - 0.15), y: rand(-0.55, -0.08), z: rand(-B.d / 2 + 0.15, B.d / 2 - 0.15),
      vx: 0, vy: 0, vz: 0, a: fadeIn ? 0 : 1, to: 1, size: rand(0.06, 0.085), ph: rand(0, 6.28) };
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
      this.push({ kind: "fall", x: rand(-B.w / 2 + 0.15, B.w / 2 - 0.15), y: rand(2.6, 3.6), z: rand(-B.d / 2 + 0.15, B.d / 2 - 0.15),
        vy: -rand(0.8, 1.8), delay: rand(0, spread), land: rand(-0.5, -0.08), a: 1, size: rand(0.07, 0.09) });
    }
  }

  uptake(count, spread) {
    if (this.reduce || !this.plants.length) return;
    for (let i = 0; i < count; i++) {
      const p = this.plants[Math.floor(Math.random() * this.plants.length)];
      const y0 = rand(-0.35, -0.05);
      this.push({ kind: "rise", px: p.x, pz: p.z, x: p.x, y: y0, z: p.z, y0, y1: p.h * rand(0.35, 0.9), t: 0,
        life: rand(1.2, 1.8), delay: rand(0, spread), a: 0, size: rand(0.05, 0.065), ph: rand(0, 6.28) });
    }
  }

  // share = this week's leaching over the task's worst week (0..1): bigger, brighter drips for the worst week.
  leach(count, spread, share) {
    this.leachGlow = Math.max(this.leachGlow, share);
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      this.push({ kind: "leach", x: rand(-B.w / 2 + 0.2, B.w / 2 - 0.2), y: rand(-B.soil + 0.05, -B.soil + 0.35),
        z: rand(-B.d / 2 + 0.2, B.d / 2 - 0.2), vy: -rand(0.3, 0.8), delay: 0.25 + spread * 0.3 + rand(0, spread * 1.2),
        a: 1, size: 0.07 + 0.06 * share, share, trail: [] });
    }
  }

  tickMotes(dt) {
    const keep = [];
    let soilAlive = this.motes.filter((m) => m.kind === "soil" && m.to > 0).length;
    for (const m of this.motes) {
      if (m.delay > 0) { m.delay -= dt; keep.push(m); continue; }
      switch (m.kind) {
        case "soil":
          if (!this.reduce) {
            m.vx += rand(-1, 1) * 0.5 * dt; m.vy += rand(-1, 1) * 0.3 * dt; m.vz += rand(-1, 1) * 0.5 * dt;
            m.vx *= 0.96; m.vy *= 0.96; m.vz *= 0.96;
            m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
            if (m.y < -0.6 || m.y > -0.06) m.vy *= -1;
            if (Math.abs(m.x) > B.w / 2 - 0.1) m.vx *= -1;
            if (Math.abs(m.z) > B.d / 2 - 0.1) m.vz *= -1;
            m.ph += dt * 1.4;
          }
          m.a += Math.sign(m.to - m.a) * Math.min(Math.abs(m.to - m.a), dt * 2.5);
          if (m.to > 0 || m.a > 0.01) keep.push(m);
          break;
        case "fall":
          m.vy -= 6 * dt; m.y += m.vy * dt;
          if (m.y <= m.land) {
            const stay = soilAlive < this.soilTarget;
            if (stay) soilAlive++;
            keep.push({ kind: "soil", x: m.x, y: m.land, z: m.z, vx: 0, vy: 0, vz: 0, a: 1, to: stay ? 1 : 0, size: m.size, ph: rand(0, 6.28) });
          } else keep.push(m);
          break;
        case "rise": {
          m.t += dt;
          const p = m.t / m.life;
          if (p >= 1) break;
          m.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - p) ** 2);
          m.x = m.px + Math.sin(m.ph + p * 6) * 0.03;
          m.a = Math.min(1, p * 5) * (p > 0.7 ? (1 - p) / 0.3 : 1);
          keep.push(m);
          break;
        }
        case "leach":
          m.trail.unshift(m.y);
          if (m.trail.length > 4) m.trail.pop();
          m.vy -= 5 * dt; m.y += m.vy * dt;
          if (m.y <= POOL_Y) {
            keep.push({ kind: "splash", x: m.x, y: POOL_Y + 0.01, z: m.z, t: 0, life: 0.6, size: m.size });
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

  writeMotes() {
    const { pos, col, size, alpha } = this.mBuf;
    let n = 0;
    const put = (x, y, z, color, s, a) => {
      if (n >= this.cap || a <= 0.01) return;
      pos.array[n * 3] = x; pos.array[n * 3 + 1] = y; pos.array[n * 3 + 2] = z;
      col.array[n * 3] = color.r; col.array[n * 3 + 1] = color.g; col.array[n * 3 + 2] = color.b;
      size.array[n] = s;
      alpha.array[n] = Math.min(1, a);
      n++;
    };
    const green = this.colors.n, red = this.colors.leach;
    for (const m of this.motes) {
      if (m.delay > 0) continue;
      if (m.kind === "soil") put(m.x, m.y, m.z, green, m.size, m.a * (this.reduce ? 0.8 : 0.6 + 0.3 * Math.sin(m.ph)));
      else if (m.kind === "fall" || m.kind === "rise") put(m.x, m.y, m.z, green, m.size, m.a);
      else if (m.kind === "leach") {
        put(m.x, m.y, m.z, red, m.size, 1);
        m.trail.forEach((ty, i) => put(m.x, ty, m.z, red, m.size * 0.7, (1 - (i + 1) / (m.trail.length + 1)) * 0.5));
      } else if (m.kind === "splash") {
        const p = m.t / m.life;
        put(m.x, m.y, m.z, red, m.size * (1 + 3 * p), 1 - p);
      }
    }
    for (const a of [pos, col, size, alpha]) a.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
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
      const g = Math.max(0, p.grow.x);
      arr[i * 3] = g;
      arr[i * 3 + 1] = clamp(p.leaves.x, 0, LEAVES);
      arr[i * 3 + 2] = clamp(p.tassel.x, 0, 1);
      p.h = (P.sprout + (P.maxH - P.sprout) * g) * p.seed[1];
    });
    this.state.needsUpdate = true;

    for (const s of [this.water, this.droop, this.lean, this.wind, this.level]) step(s);
    const wf = clamp(this.water.x, 0, 1);
    this.waterVol.scale.y = Math.max(0.001, wf * B.soil);
    this.waterVol.visible = wf > 0.002;
    this.waterTop.position.y = -B.soil + wf * B.soil;
    this.waterTop.visible = wf > 0.002;
    const u = this.maizeMat.uniforms;
    u.uWind.value = this.reduce ? 0 : Math.max(0, this.wind.x);
    u.uLean.value = this.lean.x;
    u.uDroop.value = clamp(this.droop.x, 0, 1);

    this.pulse *= Math.exp(-1.4 * dt);
    this.leachGlow *= Math.exp(-0.9 * dt);
    this.poolMat.uniforms.uLevel.value = clamp(this.level.x, 0, 1);
    this.poolMat.uniforms.uPulse.value = this.reduce ? 0 : this.pulse;
    this.soilMat.uniforms.uLeach.value = this.reduce ? 0 : Math.max(this.pulse * 0.6, this.leachGlow * 0.4);
    this.tickMotes(Math.min(dt, 0.05));
  }

  // Lightning: brighten the hairline edges with the scene flash.
  flash(f) {
    for (const l of this.lines) l.mat.color.copy(l.base).lerp(WHITE, clamp(f, 0, 1) * 0.6);
  }
}
