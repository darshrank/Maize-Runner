// One FieldTwin field as a 3D cutaway block (UI_SPEC.md section 6). Unit 1: canopy, soil slab with water glow,
// groundwater plane. Particles and rain come in unit 2.
//
// Data -> visuals (every input is a logged value; theme.field holds only display scales):
//   canopy cube height and core color  <- obs.biomass_kg_ha (growth; N stress is not used, see STATE.md)
//   soil cores glowing cyan, bottom up <- obs.soil_water_frac (one whole-profile value; layers are visual only)
//   groundwater red tint               <- cumulative weekly.n_leached (final.n_leached at harvest)
//
// Draw calls: one InstancedMesh per kind (canopy shells, canopy cores, soil shells, soil cores) + the plane.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { theme } from "./theme.js";

const dummy = new THREE.Object3D();
const tmp = new THREE.Color();

// Thin dark edges on the crystal shells: darken fragments near each face's UV border.
function withEdges(material, key, color, width) {
  material.customProgramCacheKey = () => `edges-${key}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeColor = { value: new THREE.Color(color) };
    shader.uniforms.uEdgeWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vEdgeUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEdgeUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vEdgeUv;\nuniform vec3 uEdgeColor;\nuniform float uEdgeWidth;")
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
        float eDist = min(min(vEdgeUv.x, 1.0 - vEdgeUv.x), min(vEdgeUv.y, 1.0 - vEdgeUv.y));
        float edge = 1.0 - smoothstep(uEdgeWidth * 0.4, uEdgeWidth, eDist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, edge * 0.9);
        gl_FragColor.a = max(gl_FragColor.a, edge * 0.85);`);
  };
  return material;
}

function crystal(key, tint, lite) {
  const m = new THREE.MeshPhysicalMaterial({
    color: tint, metalness: 0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08,
    ior: 1.45, thickness: 0.35, envMapIntensity: 0.9,
    transmission: lite ? 0 : 0.6, transparent: lite, opacity: lite ? 0.3 : 1, depthWrite: !lite,
  });
  return withEdges(m, key, "#030405", 0.045);
}

// Small fixed per-cube variation so the field reads as many cubes, not one block.
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ease(cur, target, k) {
  return cur + (target - cur) * k;
}

export class Field {
  constructor({ lite = false } = {}) {
    const F = theme.field, C = theme.color;
    this.n = F.grid;
    this.count = this.n * this.n;
    this.group = new THREE.Group();
    this.cur = { growth: 0, water: 0, tint: 0 };
    this.target = { growth: 0, water: 0, tint: 0 };
    this.dirty = true;
    this.offsets = [];
    const half = ((this.n - 1) / 2) * F.pitch;
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) this.offsets.push([i * F.pitch - half, j * F.pitch - half]);
    }
    this.jitter = this.offsets.map((_, i) => 0.82 + 0.36 * hash(i));

    // Canopy: unit-height cubes standing on y = 0, scaled in y by growth.
    const shellGeo = new RoundedBoxGeometry(F.cube, 1, F.cube, 2, 0.05).translate(0, 0.5, 0);
    const coreGeo = new THREE.BoxGeometry(F.cube * 0.42, 0.9, F.cube * 0.42).translate(0, 0.5, 0);
    this.canopy = new THREE.InstancedMesh(shellGeo, crystal("canopy", C.canopyGlass, lite), this.count);
    this.canopyCore = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.count);

    // Soil slab: soilLayers of full cubes under y = 0; cores glow with water from the bottom up.
    const L = F.soilLayers, soilCount = this.count * L;
    const soilGeo = new RoundedBoxGeometry(F.cube, F.cube, F.cube, 2, 0.05);
    const soilCoreGeo = new THREE.BoxGeometry(F.cube * 0.36, F.cube * 0.36, F.cube * 0.36);
    this.soil = new THREE.InstancedMesh(soilGeo, crystal("soil", C.soilGlass, lite), soilCount);
    this.soilCore = new THREE.InstancedMesh(soilCoreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), soilCount);
    this.layerOf = new Int8Array(soilCount);   // 0 = bottom layer
    let s = 0;
    for (let layer = 0; layer < L; layer++) {   // layer 0 = top
      const y = -(layer + 0.5) * F.pitch - 0.08;
      for (const [x, z] of this.offsets) {
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.soil.setMatrixAt(s, dummy.matrix);
        this.soilCore.setMatrixAt(s, dummy.matrix);
        this.layerOf[s] = L - 1 - layer;
        s++;
      }
    }

    // Groundwater: a dark plane under the slab that takes on a red tint as nitrate accumulates.
    const size = this.n * F.pitch + 0.6;
    this.groundY = -L * F.pitch - 1.1;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.groundwater, transparent: true, opacity: 0.92 }));
    this.ground.position.y = this.groundY;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: C.text, transparent: true, opacity: 0.14 }));
    frame.position.y = this.groundY + 0.002;
    this.groundFrame = frame;

    this.colors = {
      stressed: new THREE.Color(C.canopyStressed), healthy: new THREE.Color(C.canopyHealthy),
      water: new THREE.Color(C.water), leach: new THREE.Color(C.leach), ground: new THREE.Color(C.groundwater),
    };
    for (const m of [this.canopy, this.canopyCore, this.soil, this.soilCore]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    this.group.add(this.soil, this.soilCore, this.canopy, this.canopyCore, this.ground, this.groundFrame);
    this.apply();
  }

  // weekState: {biomass, waterFrac, leachedCum} from the log, or null (no run: an empty, dark field).
  setTarget(weekState) {
    const F = theme.field;
    const has = (v) => typeof v === "number" && Number.isFinite(v);
    const ws = weekState || {};
    this.target.growth = has(ws.biomass) ? Math.min(ws.biomass / F.biomassFull, 1.2) : 0;
    this.target.water = has(ws.waterFrac) ? Math.min(Math.max(ws.waterFrac, 0), 1) : 0;
    this.target.tint = has(ws.leachedCum) ? 1 - Math.exp(-Math.max(ws.leachedCum, 0) / F.leachScale) : 0;
    this.dirty = true;
  }

  update(dt) {
    if (!this.dirty) return;
    const k = 1 - Math.exp(-dt * theme.motion.damping);
    let moving = false;
    for (const key of Object.keys(this.cur)) {
      this.cur[key] = ease(this.cur[key], this.target[key], k);
      if (Math.abs(this.cur[key] - this.target[key]) > 1e-4) moving = true;
      else this.cur[key] = this.target[key];
    }
    this.apply();
    this.dirty = moving;
  }

  apply() {
    const F = theme.field, { growth, water, tint } = this.cur, c = this.colors;
    // Canopy: height and color by growth; dim seedlings, bright mature canopy.
    const g = Math.min(growth, 1);
    for (let i = 0; i < this.count; i++) {
      const [x, z] = this.offsets[i];
      const h = 0.06 + growth * F.canopyMaxHeight * this.jitter[i];
      dummy.position.set(x, 0, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      this.canopy.setMatrixAt(i, dummy.matrix);
      this.canopyCore.setMatrixAt(i, dummy.matrix);
      tmp.copy(c.stressed).lerp(c.healthy, g * g * (3 - 2 * g)).multiplyScalar(0.25 + 1.25 * g * (0.9 + 0.2 * this.jitter[i]));
      this.canopyCore.setColorAt(i, tmp);
    }
    // Soil: water level in layers, filled from the bottom; each core glows by its fill.
    const level = water * F.soilLayers;
    for (let s = 0; s < this.layerOf.length; s++) {
      const fill = Math.min(Math.max(level - this.layerOf[s], 0), 1);
      tmp.copy(c.water).multiplyScalar(0.04 + 1.6 * fill * fill);
      this.soilCore.setColorAt(s, tmp);
    }
    // Groundwater: dark -> red with cumulative leaching (brighter than 1 so bloom picks it up).
    this.ground.material.color.copy(c.ground).lerp(c.leach, tint * 0.85).multiplyScalar(1 + tint * 0.6);
    for (const m of [this.canopy, this.canopyCore]) m.instanceMatrix.needsUpdate = true;
    this.canopyCore.instanceColor.needsUpdate = true;
    this.soilCore.instanceColor.needsUpdate = true;
  }

  // Top of the canopy at full growth and the groundwater depth, for camera framing.
  get bounds() {
    return { top: theme.field.canopyMaxHeight, bottom: this.groundY, half: (this.n * theme.field.pitch) / 2 };
  }
}
