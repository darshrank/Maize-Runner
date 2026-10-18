// 3D Season view, three.js 0.160.0 (vendored, import map in index.html). Pure black background, black fog for
// depth, two floating glass-grid dioramas (diorama3d.js), one config per side (data.SEASON_PAIR).
//
//   camera   slow dolly between the two fields; drag to orbit (OrbitControls), double click to reset
//   light    one ambient and one key light plus a dim room environment, for the glass only (every other material
//            is a hand-written shader)
//   bloom    selective and soft (theme.three.bloom, gains in theme.three.glow): only objects on BLOOM_LAYER
//            (plants, water fill, cores, groundwater fluid, lightning bolt). For the bloom pass, cube shaders with
//            uBlack draw black, other objects (glass, edges, rain) are hidden, and uBloomPass = 1 applies the
//            per-kind glow gains; then the two passes are mixed
//   storm    a week with logged rain over theme.stormMm: rain streaks, strong lean (dioramas), one lightning
//            flash (cubes lit through uFlash, one bloomed bolt) when the week is entered
//   fit      the scene centers in the space right of the week cards (a camera view offset), the camera backs off
//            along its home direction when both fields would not fit that width or the labels-to-slab height would
//            not fit between the top bar and the finale row, and the camera moves up or down to center the scene in
//            that height, so no field slides under the cards or the finale (fitView, theme.three.fit)
//   overlays HTML elements placed from each field's projected anchors every frame (placeOverlays): field names
//            centered above their field, the finale in one row under the fields (each field's number centered on
//            its projected x, the gap centered between them). Labels are pushed apart so none overlaps another,
//            and the finale row stays between the scene's lowest point and the controls
//   ?lite=1  no bloom, no transmission (plain translucent glass), no fog, no environment
//   shaders  a compile failure is retried once with fresh programs; a second failure calls onFail (main.js
//            then reloads with ?view2d=1)
//
// Every value comes from the snapshots main.js passes in (data.js). Display constants: theme.three.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { theme } from "./theme.js";
import { Diorama, BLOOM_LAYER } from "./diorama3d.js";

const T = theme.three;
const SIDES = ["left", "right"];
const RAIN_TOP = 7.5;

const MIX_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const MIX_FRAGMENT = /* glsl */ `
uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }
`;

export class Season3D {
  constructor(root, { lite = false, reduceMotion = false, onFail = null } = {}) {
    this.root = root;
    this.lite = lite;
    this.reduce = reduceMotion;
    this.onFail = onFail;
    this.active = true;
    this.failed = false;
    this.time = 0;
    this.overlays = [];
    this.flashT = -1;
    this.shaderErrors = 0;
    this.handledErrors = 0;
    this.attempts = 0;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "3D season: two fields side by side");
    root.prepend(canvas);
    this.canvas = canvas;
    // Throws when WebGL is unavailable; main.js catches it and falls back to ?view2d=1.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 2));
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderErrors++;
      this.lastError = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
        .map((s) => (s || "").trim()).filter(Boolean).join("\n");
      console.error("FieldTwin 3D: shader failed to compile\n", this.lastError);
    };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    if (!lite) this.scene.fog = new THREE.Fog(0x000000, T.fog.near, T.fog.far);
    this.shared = {
      uTime: { value: 0 }, uFlash: { value: 0 }, uPx: { value: 600 },
      uFogOn: { value: lite ? 0 : 1 }, uFogNear: { value: T.fog.near }, uFogFar: { value: T.fog.far },
      uBloomPass: { value: 0 },
    };
    this.ambient = new THREE.AmbientLight(0xffffff, T.glass.ambient);
    this.key = new THREE.DirectionalLight(0xffffff, T.glass.key);
    this.key.position.set(4, 9, 7);
    this.scene.add(this.ambient, this.key);
    if (!lite) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    const C = T.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.1, 200);
    this.home = { pos: new THREE.Vector3(...C.pos), target: new THREE.Vector3(...C.target) };
    this.basePos = this.home.pos.clone();
    this.baseTarget = this.home.target.clone();
    this.camera.position.copy(this.home.pos);
    this.reserve = { target: 0, cur: 0, fitted: -1, floor: null };   // px on the left kept free for the week cards
    this.finExtra = 0;   // px reserved under the fields beyond fit.bottom when the finale gap drops a line
    this.pv = new THREE.Vector3();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.home.target);
    this.controls.enableDamping = !reduceMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = 1.75;
    this.controls.update();
    this.user = false;           // the viewer took the camera: the dolly waits until a double click
    this.dollyT = 0;
    this.dollyX = 0;
    this.resetAnim = null;
    this.controls.addEventListener("start", () => {
      this.user = true;
      this.resetAnim = null;
    });
    canvas.addEventListener("dblclick", () => this.resetCamera());

    this.fields = {
      left: new Diorama({ x: -T.fieldX, shared: this.shared, lite, reduceMotion }),
      right: new Diorama({ x: T.fieldX, shared: this.shared, lite, reduceMotion }),
    };
    for (const s of SIDES) this.scene.add(this.fields[s].group);
    this.buildRain();
    this.buildBolt();

    this.bloomLayer = new THREE.Layers();
    this.bloomLayer.set(BLOOM_LAYER);
    if (!lite) this.buildComposer();
    this.nonBloom = [];
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isLine || o.isPoints) && !this.bloomLayer.test(o.layers)) this.nonBloom.push(o);
    });

    new ResizeObserver(() => this.resize()).observe(root);
    this.resize();
  }

  buildComposer() {
    const r = this.renderer, B = T.bloom;
    this.bloomComposer = new EffectComposer(r);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), B.strength, B.radius, B.threshold);
    this.bloomComposer.addPass(this.bloomPass);
    this.mixMat = new THREE.ShaderMaterial({
      vertexShader: MIX_VERTEX, fragmentShader: MIX_FRAGMENT,
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: this.bloomComposer.renderTarget2.texture } },
    });
    const mix = new ShaderPass(this.mixMat, "baseTexture");
    mix.needsSwap = true;
    this.finalComposer = new EffectComposer(r);
    this.finalComposer.addPass(new RenderPass(this.scene, this.camera));
    this.finalComposer.addPass(mix);
    this.finalComposer.addPass(new OutputPass());
  }

  // Rain streaks over both blocks (same weather): line segments that fall onto the field tops.
  buildRain() {
    const n = T.rain;
    this.rain = Array.from({ length: n }, () => this.rainDrop(true));
    this.rainTarget = 0;
    this.rainPos = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", this.rainPos);
    g.setDrawRange(0, 0);
    this.rainMat = new THREE.LineBasicMaterial({ color: theme.color.rain, transparent: true, opacity: 0.55, depthWrite: false });
    this.rainLines = new THREE.LineSegments(g, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
  }

  // Lightning bolt between the two blocks: a jagged line, redrawn for each flash, visible only while it lasts.
  buildBolt() {
    const n = 14;
    this.boltPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", this.boltPos);
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.bolt = new THREE.Line(g, this.boltMat);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.layers.enable(BLOOM_LAYER);
    this.scene.add(this.bolt);
  }

  strikeBolt() {
    const a = this.boltPos.array, n = a.length / 3;
    let x = (Math.random() * 2 - 1) * 1.2, z = -1.2 - Math.random();
    for (let i = 0; i < n; i++) {
      a.set([x, RAIN_TOP + 1 - (i / (n - 1)) * (RAIN_TOP - 1.2), z], i * 3);
      x += (Math.random() * 2 - 1) * 0.35;
      z += (Math.random() * 2 - 1) * 0.12;
    }
    this.boltPos.needsUpdate = true;
  }

  rainDrop(anywhere = false) {
    const f = this.fields.left, span = T.fieldX + f.W / 2 + 1.5;
    return { x: (Math.random() * 2 - 1) * span, z: (Math.random() * 2 - 1) * (f.D / 2 + 0.6),
      y: anywhere ? Math.random() * RAIN_TOP : RAIN_TOP + Math.random() * 2, v: 8 + Math.random() * 3, len: 0.3 + Math.random() * 0.25 };
  }

  tickRain(dt) {
    const wind = 0.16, a = this.rainPos.array;
    let n = 0;
    for (let i = 0; i < this.rain.length && n < this.rainTarget; i++) {
      const d = this.rain[i];
      d.y -= d.v * dt;
      d.x += d.v * wind * dt;
      if (d.y < 0) Object.assign(d, this.rainDrop());
      a.set([d.x, d.y, d.z, d.x - d.len * wind, d.y + d.len, d.z], n * 6);
      n++;
    }
    this.rainPos.needsUpdate = true;
    this.rainLines.geometry.setDrawRange(0, n * 2);
    this.rainLines.visible = n > 0;
  }

  // ------------------------------------------------------------ data in

  // Shared scale for both fields (max of each value across both runs for this task).
  setRuns(scale) {
    for (const s of SIDES) {
      this.fields[s].setScale(scale);
      this.fields[s].clear();
    }
  }

  // views: {left: {snap, events}, right: {snap, events}}. moved: the week changed (play its events).
  show(views, { spread = 1, moved = false } = {}) {
    let rain = null;
    for (const s of SIDES) {
      const v = views[s] || {};
      this.fields[s].show(v.snap || null, v.events || [], spread);
      const w = v.snap && !v.snap.harvest && v.snap.weekly;
      if (w && typeof w.rain_mm === "number") rain = Math.max(rain ?? 0, w.rain_mm);
    }
    const storm = rain !== null && rain > theme.stormMm;
    this.rainTarget = storm && !this.reduce ? Math.round(T.rain * Math.min(1, rain / 100)) : 0;
    if (storm && moved && !this.reduce) {
      this.flashT = 0;
      this.strikeBolt();
    }
    return storm;
  }

  // ------------------------------------------------------------ overlays

  // heads: {left, right} elements centered above each field (bottom edge at the anchor); fins: {left, right} the
  // finale under each field (top edge on the row); mid: the gap between them; floor: the element whose top edge
  // the finale row must stay above (the controls).
  // side: the element on the left the scene must stay clear of (the week cards).
  setOverlays({ heads, fins, mid, floor, side = null }) {
    this.ov = { heads, fins, mid, floor, side, floorY: null, floorAge: 0 };
    this.anchors = Object.fromEntries(SIDES.map((s) => [s, this.fields[s].anchors()]));
  }

  project(p) {
    const v = this.pv.copy(p).project(this.camera);
    return { x: (v.x + 1) / 2 * this.root.clientWidth, y: (1 - v.y) / 2 * this.root.clientHeight, behind: v.z > 1 };
  }

  // Spread two boxes {x (center), w} apart so they keep `pad` px between them; returns the new centers.
  static apart(a, b, pad) {
    const need = (a.w + b.w) / 2 + pad - (b.x - a.x);
    return need > 0 ? [a.x - need / 2, b.x + need / 2] : [a.x, b.x];
  }

  placeOverlays(dt) {
    const o = this.ov;
    if (!o) return;
    const PAD = 24, TOP = 56, place = (el, x, y) => (el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`);
    // Reads first (sizes), then writes, so the layout is computed once per frame.
    o.floorAge -= dt;
    if (o.floor && (o.floorY === null || o.floorAge <= 0)) {
      const top = this.root.getBoundingClientRect();
      o.floorY = o.floor.getBoundingClientRect().top - top.top;
      o.floorAge = 0.5;
      const r = o.side && !o.side.hidden ? o.side.getBoundingClientRect() : null;
      this.reserve.target = r && r.width ? Math.max(0, r.right - top.left + T.fit.gap) : 0;
    }
    // Each overlay is a zero-size anchor; its one child (.s3-in) holds the content and carries the size.
    const size = (el) => { const c = el.firstElementChild || el; return { w: c.offsetWidth, h: c.offsetHeight }; };
    const hs = { left: size(o.heads.left), right: size(o.heads.right) };
    const fs = { left: size(o.fins.left), right: size(o.fins.right) }, ms = size(o.mid);
    const at = {};
    for (const s of SIDES) {
      const a = this.anchors[s];
      at[s] = { head: this.project(a.head), center: this.project(a.center),
        bottom: Math.max(...a.bottom.map((p) => this.project(p).y)) };
    }
    // Heads: centered above each field, never above the top bar, never on top of each other.
    const [hl, hr] = Season3D.apart({ x: at.left.head.x, w: hs.left.w }, { x: at.right.head.x, w: hs.right.w }, PAD);
    const hy = (s) => Math.max(TOP + hs[s].h, at[s].head.y);
    place(o.heads.left, hl, hy("left"));
    place(o.heads.right, hr, hy("right"));
    // Finale row: under the lowest point of both fields, above the controls; the gap on the same row between the
    // two numbers when it fits, else one line lower.
    let [fl, fr] = Season3D.apart({ x: at.left.center.x, w: fs.left.w }, { x: at.right.center.x, w: fs.right.w }, PAD);
    const rowH = Math.max(fs.left.h, fs.right.h);
    const mx = (fl + fr) / 2;
    const fits = ms.w === 0 || (mx - ms.w / 2 >= fl + fs.left.w / 2 + PAD && mx + ms.w / 2 <= fr - fs.right.w / 2 - PAD);
    const total = fits ? Math.max(rowH, ms.h) : rowH + 8 + ms.h;
    // When the gap drops a line, fitView reserves that line too (finExtra px). Kept until the finale hides, so
    // the refit cannot flip it back and forth.
    const extra = ms.w === 0 ? 0 : fits ? this.finExtra : ms.h + 8;
    if (extra !== this.finExtra) {
      this.finExtra = extra;
      this.fitView();
    }
    let y = Math.max(at.left.bottom, at.right.bottom) + 18;
    if (o.floorY !== null) y = Math.min(y, o.floorY - 8 - total);
    place(o.fins.left, fl, y);
    place(o.fins.right, fr, y);
    place(o.mid, mx, fits ? y : y + rowH + 8);
    const hide = (s) => at[s].head.behind || at[s].center.behind;
    for (const s of SIDES) {
      o.heads[s].style.visibility = hide(s) ? "hidden" : "";
      o.fins[s].style.visibility = hide(s) ? "hidden" : "";
    }
  }

  // ------------------------------------------------------------ camera

  resetCamera() {
    this.resetAnim = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone() };
    if (this.reduce) this.resetAnim.t = 1;
  }

  tickCamera(dt) {
    const C = T.camera;
    if (this.resetAnim) {
      const r = this.resetAnim;
      r.t = Math.min(1, r.t + dt / 0.9);
      const e = 1 - (1 - r.t) ** 3;
      this.camera.position.lerpVectors(r.fromPos, this.home.pos, e);
      this.controls.target.lerpVectors(r.fromTarget, this.home.target, e);
      if (r.t >= 1) {
        this.resetAnim = null;
        this.user = false;
        this.dollyT = 0;
        this.dollyX = 0;
      }
    } else if (!this.user && !this.reduce) {
      this.dollyT += dt;
      const x = C.dollyX * Math.sin((2 * Math.PI * this.dollyT) / C.dollyPeriod);
      const dx = x - this.dollyX;
      this.dollyX = x;
      this.camera.position.x += dx;
      this.controls.target.x += dx * 0.4;
    }
    this.controls.update();
  }

  // ------------------------------------------------------------ frame

  setActive(on) {
    this.active = on;
  }

  // Center the scene in the free width right of the reserve (a wider virtual frame, rendered from its left part),
  // then back the camera off until both fields fit that width and the label anchors to the slab bottom fit between
  // fit.top and the finale row, and move it up or down to center them there. Projection-based, a few passes.
  fitView() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    const L = this.reserve.cur, free = Math.max(1, w - L), C = T.camera, F = T.fit;
    const floor = this.ov && this.ov.floorY !== null ? this.ov.floorY : h - 120;
    this.reserve.fitted = L;
    this.reserve.floor = floor;
    this.camera.aspect = (w + L) / h;
    if (L > 0.5) this.camera.setViewOffset(w + L, h, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const half = T.fieldX + this.fields.left.W / 2 + F.margin + 0.6 * C.dollyX;
    const d0 = this.basePos.distanceTo(this.baseTarget);
    const tanV = Math.tan(THREE.MathUtils.degToRad(C.fov) / 2);
    let k = Math.max(1, (half * h) / (0.92 * free * tanV) / d0), dy = 0;
    if (this.user) return;   // the viewer holds the camera; the frame still follows the cards
    const anchors = SIDES.map((s) => this.fields[s].anchors());
    const top = F.top, bottom = Math.max(top + 80, floor - F.bottom - this.finExtra);
    for (let pass = 0; pass < 4; pass++) {
      this.placeCamera(k, dy);
      const ys = anchors.flatMap((a) => [a.head, ...a.bottom]).map((p) => this.project(p).y);
      const a = Math.min(...ys), b = Math.max(...ys);
      if (b - a > bottom - top) k *= (b - a) / (bottom - top);
      const pxPerUnit = h / (2 * d0 * k * tanV);
      dy += ((a + b) / 2 - (top + bottom) / 2) / pxPerUnit;
    }
    this.placeCamera(k, dy);
  }

  // Home camera at distance factor k along the base direction, raised by dy world units (camera and target).
  placeCamera(k, dy) {
    const target = this.baseTarget.clone();
    target.y -= dy;
    const pos = this.basePos.clone().sub(this.baseTarget).multiplyScalar(k).add(target);
    this.home.pos.copy(pos);
    this.home.target.copy(target);
    if (this.resetAnim) return;
    this.camera.position.copy(pos);
    this.camera.position.x += this.dollyX;
    this.controls.target.copy(target);
    this.controls.target.x += this.dollyX * 0.4;
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }

  resize() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.fitView();
    const pr = this.renderer.getPixelRatio();
    this.shared.uPx.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    if (this.bloomComposer) {
      for (const c of [this.bloomComposer, this.finalComposer]) {
        c.setPixelRatio(pr);
        c.setSize(w, h);
      }
    }
  }

  tick(dt) {
    if (!this.active || this.failed) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.shared.uTime.value = this.time;

    let f = 0;
    if (this.flashT >= 0) {
      const t = (this.flashT += dt);
      f = T.flashPeak * (Math.exp(-t * 11) + 0.55 * Math.exp(-(((t - 0.22) / 0.05) ** 2)));
      if (t > 0.9) this.flashT = -1;
    }
    this.shared.uFlash.value = f;
    this.rainMat.opacity = 0.55 + 0.4 * f;
    const bolt = f / T.flashPeak;
    this.bolt.visible = bolt > 0.04;
    this.boltMat.opacity = Math.min(1, bolt);
    this.boltMat.color.setScalar(T.bolt * bolt);
    for (const s of SIDES) {
      this.fields[s].update(dt);
      this.fields[s].flash(f);
    }
    this.tickRain(this.reduce ? 0 : dt);
    const R = this.reserve;
    R.cur = this.reduce ? R.target : R.cur + (R.target - R.cur) * Math.min(1, dt * 6);
    const floorY = this.ov ? this.ov.floorY : null;
    if (Math.abs(R.cur - R.fitted) > 0.5 || (floorY !== null && Math.abs(floorY - (R.floor ?? -1)) > 1)) this.fitView();
    this.tickCamera(dt);
    this.ambient.intensity = T.glass.ambient * (1 + 2 * f);
    this.render();
    this.placeOverlays(dt);
    this.checkShaders();
  }

  render() {
    if (!this.bloomComposer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const hidden = [], black = [];
    for (const o of this.nonBloom) {
      const u = o.material && o.material.uniforms;
      if (u && u.uBlack) {
        u.uBlack.value = 1;
        black.push(u);
      } else if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    this.shared.uBloomPass.value = 1;
    this.bloomComposer.render();
    this.shared.uBloomPass.value = 0;
    for (const o of hidden) o.visible = true;
    for (const u of black) u.uBlack.value = 0;
    this.finalComposer.render();
  }

  // First failure: drop the programs and compile again. Second failure: hand over to the 2D view.
  checkShaders() {
    if (this.shaderErrors === this.handledErrors) return;
    this.handledErrors = this.shaderErrors;
    this.attempts++;
    if (this.attempts >= 2) {
      this.failed = true;
      if (this.onFail) this.onFail(this.lastError || "shader compile failed");
      return;
    }
    const mats = new Set(SIDES.flatMap((s) => this.fields[s].materials()));
    if (this.mixMat) mats.add(this.mixMat);
    for (const m of mats) {
      m.dispose();
      m.needsUpdate = true;
    }
  }
}
