// One FieldTwin field as a 3D cutaway block (UI_SPEC.md section 6), drawn in the React Bits Cubes look
// (edgeMaterial.js): faces match the background, 1px edges carry the data. Unit 2 adds a second field and
// particles on top of this.
//
// Data -> visuals (every input is a logged value; theme.field and theme.ripple hold only display scales):
//   canopy cube height, edge green    <- obs.biomass_kg_ha (growth)
//   soil edges cyan, filled bottom up <- obs.soil_water_frac (one whole-profile value; layers are visual only)
//   groundwater red tint              <- cumulative weekly.n_leached (final.n_leached at harvest)
//   ripples (trigger(events))         <- data.weekEvents(): N dose (green, canopy), leaching (red, down
//                                        through the soil, then the groundwater flashes), storm (blue-grey
//                                        wave across the canopy that tilts it)
//
// Motion, ported from the React Bits Cubes component (credit and license in edgeMaterial.js):
//   rings: a front travels ringTravel cells/s; a cube flashes when the front passes it, with strength
//          exp(-reach / (0.8 * grid)); flashes decay by exp(-glowFade * dt); rings can kick the springs
//   springs: stiffness 160 * speed^2, damping 2 * (1 - 0.82 * bounce) * sqrt(stiffness); no cursor input,
//            only data events move them
//   intro: cubes grow and tumble a quarter turn into place from the center on page load
// prefers-reduced-motion: no intro, no ripples, no tilt (data-driven edges still update).
//
// Draw calls: canopy cubes and soil cubes are one InstancedMesh each, plus the groundwater plane.

import * as THREE from "three";
import { theme } from "./theme.js";
import { createEdgeMaterial, setEdgePixelRatio, addEdgeAttributes } from "./edgeMaterial.js";

const tmpColor = new THREE.Color();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const qTilt = new THREE.Quaternion();
const qTurn = new THREE.Quaternion();
const axis = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (cur, target, k) => cur + (target - cur) * k;

// Fallback when the edge shader fails to compile: the previous glass look (no data in the edges).
function crystal(tint) {
  return new THREE.MeshPhysicalMaterial({
    color: tint, metalness: 0, roughness: 0.15, clearcoat: 1, ior: 1.45, thickness: 0.35,
    transmission: 0.6, envMapIntensity: 0.9,
  });
}

export class Field {
  constructor({ lite = false, reduceMotion = false, pixelRatio = 1 } = {}) {
    const F = theme.field, C = theme.color, K = theme.cubes;
    this.lite = lite;
    this.reduce = reduceMotion;
    this.n = F.grid;
    this.count = this.n * this.n;
    this.L = F.soilLayers;
    this.group = new THREE.Group();
    this.cur = { growth: 0, water: 0, tint: 0 };
    this.target = { growth: 0, water: 0, tint: 0 };
    this.dataDirty = true;
    this.clock = 0;
    this.introClock = this.reduce ? Infinity : 0;
    this.rings = [];
    this.groundFlash = 0;

    // Grid cells in cube units, centered; delays for the center-out intro (reference allocate()).
    const c = (this.n - 1) / 2;
    this.cells = [];
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        const delay = Math.hypot(i - c, j - c) / Math.max(1, this.n / 2);
        this.cells.push({ x: (i - c) * F.pitch, z: (j - c) * F.pitch, delay, jitter: 0.82 + 0.36 * hash(i * this.n + j) });
      }
    }

    // Canopy: unit-height boxes standing on y = 0 (BoxGeometry has 0..1 UVs per face, as the shader needs).
    const canopyGeo = new THREE.BoxGeometry(F.cube, 1, F.cube).translate(0, 0.5, 0);
    const soilGeo = new THREE.BoxGeometry(F.cube, F.cube, F.cube);
    this.canopyAttr = addEdgeAttributes(canopyGeo, this.count);
    this.soilAttr = addEdgeAttributes(soilGeo, this.count * this.L);
    const mat = () => createEdgeMaterial({ face: C.bg, shading: K.shading, edgePx: K.edgePx, pixelRatio });
    this.canopy = new THREE.InstancedMesh(canopyGeo, mat(), this.count);
    this.soil = new THREE.InstancedMesh(soilGeo, mat(), this.count * this.L);
    for (const m of [this.canopy, this.soil]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }

    // Springs (canopy only): tilt angles and velocities about the x and z axes.
    this.rx = new Float32Array(this.count);
    this.rz = new Float32Array(this.count);
    this.wx = new Float32Array(this.count);
    this.wz = new Float32Array(this.count);
    // Flash strength and color per cube, canopy then soil.
    this.glowC = new Float32Array(this.count);
    this.glowS = new Float32Array(this.count * this.L);
    this.flashColC = new Float32Array(this.count * 3);
    this.flashColS = new Float32Array(this.count * this.L * 3);

    // Groundwater: a dark plane under the slab that takes on a red tint as nitrate accumulates.
    const size = this.n * F.pitch + 0.6;
    this.groundY = -this.L * F.pitch - 1.1;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.groundwater }));
    this.ground.position.y = this.groundY;
    this.ground.material.toneMapped = false;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: C.text, transparent: true, opacity: 0.14 }));
    frame.position.y = this.groundY + 0.002;

    this.colors = {
      stressed: new THREE.Color(C.canopyStressed), healthy: new THREE.Color(C.canopyHealthy),
      soil: new THREE.Color(C.soilEdge), water: new THREE.Color(C.water), leach: new THREE.Color(C.leach),
      ground: new THREE.Color(C.groundwater),
    };
    this.group.add(this.soil, this.canopy, this.ground, frame);
    this.writeEdges();
    this.writeMatrices();
  }

  // ---------------------------------------------------------------- data in

  // weekState: {biomass, waterFrac, leachedCum} from the log, or null (no run: an empty, dark field).
  setTarget(weekState) {
    const F = theme.field;
    const has = (v) => typeof v === "number" && Number.isFinite(v);
    const ws = weekState || {};
    this.target.growth = has(ws.biomass) ? Math.min(ws.biomass / F.biomassFull, 1.2) : 0;
    this.target.water = has(ws.waterFrac) ? clamp(ws.waterFrac, 0, 1) : 0;
    this.target.tint = has(ws.leachedCum) ? 1 - Math.exp(-Math.max(ws.leachedCum, 0) / F.leachScale) : 0;
    this.dataDirty = true;
  }

  // events: [{kind: "storm" | "n" | "leach", amount}] for the week just shown (data.weekEvents).
  trigger(events) {
    if (this.reduce) return;
    const R = theme.ripple, half = (this.n - 1) / 2;
    for (const ev of events || []) {
      const r = R[ev.kind];
      if (!r) continue;
      const amp = clamp(ev.amount / r.scale, 0.25, 1);
      const color = new THREE.Color(theme.color[r.color] || r.color);
      const ring = { kind: ev.kind, amp, color, kick: r.kick, travel: theme.cubes.ringTravel * theme.cubes.speed * r.speed,
        born: this.clock + r.delay, ox: 0, oz: 0, reachedBottom: false };
      if (ev.kind === "storm") { ring.ox = -half - 6; ring.limit = this.n + 9; }   // a near-straight front from one side
      else if (ev.kind === "leach") ring.limit = this.L + half * 0.35 + 1;        // down through the layers
      else ring.limit = this.n * 1.5 + 2;                                          // reference reachLimit
      this.rings.push(ring);
      if (this.rings.length > theme.cubes.maxRings) this.rings.shift();
    }
  }

  setPixelRatio(r) {
    for (const m of [this.canopy, this.soil]) setEdgePixelRatio(m.material, r);
  }

  // Swap to the previous glass material if the edge shader cannot compile (called from scene.js).
  useFallback() {
    if (this.fallback) return;
    this.fallback = true;
    this.canopy.material = crystal(theme.color.canopyGlass);
    this.soil.material = crystal(theme.color.soilGlass);
  }

  // ---------------------------------------------------------------- per frame

  update(dtRaw) {
    const dt = Math.min(dtRaw, 0.05);   // reference clamp for the spring integration
    this.clock += dt;
    let moving = false;
    if (this.dataDirty) {
      const k = 1 - Math.exp(-dt * theme.motion.damping);
      let easing = false;
      for (const key of Object.keys(this.cur)) {
        this.cur[key] = ease(this.cur[key], this.target[key], k);
        if (Math.abs(this.cur[key] - this.target[key]) > 1e-4) easing = true;
        else this.cur[key] = this.target[key];
      }
      this.dataDirty = easing;
      moving = true;
    }
    const intro = this.introClock !== Infinity;
    if (intro) {
      this.introClock += dt;
      if (this.introClock > theme.cubes.introSeconds + 0.55 + 0.4 + this.L * 0.08) this.introClock = Infinity;
      moving = true;
    }
    const flashing = this.stepRings(dt);
    const springing = this.stepSprings(dt);
    if (moving || flashing || springing || intro) {
      this.writeEdges();
      this.writeMatrices();
    }
  }

  // Reference ring logic: a cube is hit in the frame the front passes it.
  stepRings(dt) {
    const fade = Math.exp(-dt * theme.cubes.glowFade);
    let active = this.groundFlash > 0.01;
    this.groundFlash *= fade;
    for (let i = 0; i < this.glowC.length; i++) { this.glowC[i] *= fade; if (this.glowC[i] > 0.01) active = true; }
    for (let i = 0; i < this.glowS.length; i++) { this.glowS[i] *= fade; if (this.glowS[i] > 0.01) active = true; }
    const half = (this.n - 1) / 2;
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const ring = this.rings[k];
      const now = (this.clock - ring.born) * ring.travel;
      if (now > ring.limit) { this.rings.splice(k, 1); continue; }
      active = true;
      if (now < 0) continue;
      const prev = now - ring.travel * dt;
      const hit = (reach) => reach <= now && reach > prev;
      if (ring.kind === "leach") {
        // Front moves down: depth below the top layer, slightly later toward the edges.
        for (let layer = 0; layer < this.L; layer++) {
          for (let i = 0; i < this.count; i++) {
            const cell = this.cells[i];
            const reach = layer + Math.hypot(cell.x, cell.z) / half * 0.35;
            if (!hit(reach)) continue;
            const s = layer * this.count + i;
            this.flash(this.glowS, this.flashColS, s, ring.amp * Math.exp(-layer / (this.L * 2.5)), ring.color);
          }
        }
        if (!ring.reachedBottom && now >= this.L) {
          ring.reachedBottom = true;
          this.groundFlash = Math.max(this.groundFlash, ring.amp);
        }
        continue;
      }
      for (let i = 0; i < this.count; i++) {
        const cell = this.cells[i];
        const ox = cell.x - ring.ox, oz = cell.z - ring.oz;
        const reach = Math.hypot(ox, oz);
        if (!hit(reach) || reach < 0.0001) continue;
        const strength = ring.amp * (ring.kind === "storm" ? 1 : Math.exp(-reach / (this.n * 0.8)));
        this.flash(this.glowC, this.flashColC, i, strength, ring.color);
        if (ring.kick) {
          // Reference: wx -= (oy / reach) * 13 * s; wy += (ox / reach) * 13 * s (screen plane). Here the grid
          // lies in x-z, so the kick tips each cube away from the ring origin: +rx leans toward +z, -rz toward +x.
          this.wx[i] += (oz / reach) * ring.kick * strength;
          this.wz[i] -= (ox / reach) * ring.kick * strength;
        }
      }
    }
    return active;
  }

  flash(glow, colors, i, strength, color) {
    if (strength <= glow[i]) return;
    glow[i] = strength;
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }

  // Reference spring: targets are 0 (no cursor); only ring kicks move the cubes.
  stepSprings(dt) {
    const K = theme.cubes;
    const stiffness = 160 * K.speed * K.speed;
    const damping = 2 * (1 - 0.82 * K.bounce) * Math.sqrt(stiffness);
    let moving = false;
    for (let i = 0; i < this.count; i++) {
      if (this.reduce) { this.rx[i] = this.rz[i] = this.wx[i] = this.wz[i] = 0; continue; }
      this.wx[i] += (stiffness * -this.rx[i] - damping * this.wx[i]) * dt;
      this.wz[i] += (stiffness * -this.rz[i] - damping * this.wz[i]) * dt;
      this.rx[i] += this.wx[i] * dt;
      this.rz[i] += this.wz[i] * dt;
      if (Math.abs(this.rx[i]) + Math.abs(this.rz[i]) > 0.0005 || Math.abs(this.wx[i]) + Math.abs(this.wz[i]) > 0.0005) moving = true;
    }
    return moving;
  }

  // Reference intro: per cube, local = (clock - delay * 0.55) / introSeconds, eased; grow and quarter tumble.
  introAt(delay) {
    if (this.introClock === Infinity) return { grow: 1, tumble: 0 };
    const local = clamp((this.introClock - delay * 0.55) / theme.cubes.introSeconds, 0, 1);
    const eased = 1 - Math.pow(1 - local, 3);
    return { grow: eased, tumble: (1 - eased) * (Math.PI / 2) };
  }

  writeMatrices() {
    const F = theme.field;
    for (let i = 0; i < this.count; i++) {
      const cell = this.cells[i];
      const { grow, tumble } = this.introAt(cell.delay);
      const angle = Math.hypot(this.rx[i], this.rz[i]);
      if (angle > 1e-6) qTilt.setFromAxisAngle(axis.set(this.rx[i] / angle, 0, this.rz[i] / angle), angle);
      else qTilt.identity();
      qTurn.setFromAxisAngle(X_AXIS, tumble);
      qTilt.multiply(qTurn);
      const h = 0.06 + this.cur.growth * F.canopyMaxHeight * cell.jitter;
      tmpMatrix.compose(tmpPos.set(cell.x, 0, cell.z), qTilt, tmpScale.set(grow, h * grow, grow));
      this.canopy.setMatrixAt(i, tmpMatrix);
    }
    for (let layer = 0; layer < this.L; layer++) {
      const y = -(layer + 0.5) * F.pitch - 0.08;
      for (let i = 0; i < this.count; i++) {
        const cell = this.cells[i];
        const { grow, tumble } = this.introAt(cell.delay + layer * 0.08);
        qTurn.setFromAxisAngle(X_AXIS, tumble);
        tmpMatrix.compose(tmpPos.set(cell.x, y, cell.z), qTurn, tmpScale.set(grow, grow, grow));
        this.soil.setMatrixAt(layer * this.count + i, tmpMatrix);
      }
    }
    this.canopy.instanceMatrix.needsUpdate = true;
    this.soil.instanceMatrix.needsUpdate = true;
  }

  // Edge colors from the eased data values, flashes from the rings.
  writeEdges() {
    const { growth, water, tint } = this.cur, c = this.colors;
    const g = Math.min(growth, 1);
    const ce = this.canopyAttr.edge.array, cf = this.canopyAttr.flash.array;
    for (let i = 0; i < this.count; i++) {
      tmpColor.copy(c.stressed).lerp(c.healthy, g * g * (3 - 2 * g)).multiplyScalar((0.22 + 0.78 * g) * (0.85 + 0.15 * this.cells[i].jitter));
      ce[i * 3] = tmpColor.r; ce[i * 3 + 1] = tmpColor.g; ce[i * 3 + 2] = tmpColor.b;
      cf[i * 4] = this.flashColC[i * 3]; cf[i * 4 + 1] = this.flashColC[i * 3 + 1]; cf[i * 4 + 2] = this.flashColC[i * 3 + 2];
      cf[i * 4 + 3] = Math.min(this.glowC[i], 1);
    }
    // Soil: water level in layers, filled from the bottom; each layer's edges go cyan by its fill.
    const level = water * this.L;
    const se = this.soilAttr.edge.array, sf = this.soilAttr.flash.array;
    for (let layer = 0; layer < this.L; layer++) {
      const fill = clamp(level - (this.L - 1 - layer), 0, 1);
      tmpColor.copy(c.soil).lerp(c.water, fill * (0.35 + 0.65 * fill));
      for (let i = 0; i < this.count; i++) {
        const s = layer * this.count + i;
        se[s * 3] = tmpColor.r; se[s * 3 + 1] = tmpColor.g; se[s * 3 + 2] = tmpColor.b;
        sf[s * 4] = this.flashColS[s * 3]; sf[s * 4 + 1] = this.flashColS[s * 3 + 1]; sf[s * 4 + 2] = this.flashColS[s * 3 + 2];
        sf[s * 4 + 3] = Math.min(this.glowS[s], 1);
      }
    }
    for (const a of [this.canopyAttr.edge, this.canopyAttr.flash, this.soilAttr.edge, this.soilAttr.flash]) a.needsUpdate = true;
    // Groundwater: dark -> red with cumulative leaching, plus a flash when a leach ripple arrives. Above 1.0,
    // so this is what blooms.
    this.ground.material.color.copy(c.ground).lerp(c.leach, tint * 0.85)
      .multiplyScalar(1 + tint * 0.6 + this.groundFlash * 1.2);
  }

  get bounds() {
    return { top: theme.field.canopyMaxHeight, bottom: this.groundY, half: (this.n * theme.field.pitch) / 2 };
  }
}

// Small fixed per-cube variation so the field reads as many cubes, not one block.
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
