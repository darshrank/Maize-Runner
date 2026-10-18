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
//   fit      the two fields fill the window: the camera stays camera.dist from the target along its home direction
//            (fix1's distance, so the fog depth and the look stay as before) and the field of view narrows until
//            both fields fit the full width and the plant-top-to-slab height fits between fit.top and the strip row
//            above the weather strip; the camera moves up or down to center the scene there (fitView,
//            theme.three.fit). Every other element is a frosted overlay on top of the fields (fix2)
//   overlays HTML elements placed from each field's projected anchors every frame (placeOverlays): one strip
//            under each field (name + counters), the harvest profit just above it, the gap between the profits in
//            the middle. Strips are pushed apart so none overlaps another, stay right of the week cards and inside
//            the window, and sit between the scene's lowest point and the weather strip
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
    this.renderer.setClearColor(theme.color.bg, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 2));
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderErrors++;
      this.lastError = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
        .map((s) => (s || "").trim()).filter(Boolean).join("\n");
      console.error("Maize Runner 3D: shader failed to compile\n", this.lastError);
    };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.color.bg);
    if (!lite) this.scene.fog = new THREE.Fog(theme.color.bg, T.fog.near, T.fog.far);
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
    this.fitted = { w: 0, h: 0, floor: null };   // window size and strip row the camera was last fitted to
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
    this.boltMat = new THREE.LineBasicMaterial({ color: theme.color.text, transparent: true, opacity: 0, depthWrite: false });
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

  // fins: {left, right} the strip + profit under each field (bottom edge on the row); mid: the gap between the
  // profits; floor: the element whose top edge the strip row must stay above (the weather strip); side: the element
  // on the left the strips must stay clear of (the week cards).
  setOverlays({ fins, mid, floor, side = null }) {
    this.ov = { fins, mid, floor, side, floorY: null, sideX: 0, floorAge: 0 };
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
    const PAD = 16, place = (el, x, y) => (el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`);
    // Reads first (sizes), then writes, so the layout is computed once per frame.
    o.floorAge -= dt;
    if (o.floor && (o.floorY === null || o.floorAge <= 0)) {
      const top = this.root.getBoundingClientRect();
      o.floorY = o.floor.getBoundingClientRect().top - top.top;
      o.floorAge = 0.5;
      const r = o.side && !o.side.hidden ? o.side.getBoundingClientRect() : null;
      o.sideX = r && r.width ? r.right - top.left : 0;
    }
    // Each overlay is a zero-size anchor; its one child (.s3-in) holds the content and carries the size.
    const size = (el) => { const c = el.firstElementChild || el; return { w: c.offsetWidth, h: c.offsetHeight }; };
    const fs = { left: size(o.fins.left), right: size(o.fins.right) }, ms = size(o.mid);
    const strip = (s) => { const e = o.fins[s].querySelector(".fstrip"); return e ? e.offsetHeight : 0; };
    const prof = (s) => { const e = o.fins[s].querySelector(".fin-profit"); return e && !e.hidden ? e.offsetWidth : 0; };
    const sh = Math.max(strip("left"), strip("right")), pw = { left: prof("left"), right: prof("right") };
    const at = {};
    for (const s of SIDES) {
      const a = this.anchors[s];
      at[s] = { head: this.project(a.head), center: this.project(a.center),
        bottom: Math.max(...a.bottom.map((p) => this.project(p).y)) };
    }
    // Strips: centered under each field, right of the week cards, inside the window, never on top of each other.
    const W = this.root.clientWidth;
    let fl = Math.max(at.left.center.x, o.sideX + PAD + fs.left.w / 2);
    let fr = Math.min(at.right.center.x, W - PAD - fs.right.w / 2);
    [fl, fr] = Season3D.apart({ x: fl, w: fs.left.w }, { x: fr, w: fs.right.w }, PAD);
    // Row (bottom edge of the strips): just under the lowest point of both fields, above the weather strip.
    let y = Math.max(at.left.bottom, at.right.bottom) + 12 + sh;
    if (o.floorY !== null) y = Math.min(y, o.floorY - 10);
    place(o.fins.left, fl, y);
    place(o.fins.right, fr, y);
    // The gap: between the fields on the profit row (just above the strips) when it fits between the two profits,
    // else one line higher.
    const mx = (fl + fr) / 2;
    const fits = ms.w === 0 || (mx - ms.w / 2 >= fl + pw.left / 2 + PAD && mx + ms.w / 2 <= fr - pw.right / 2 - PAD);
    place(o.mid, mx, fits ? y - sh - 8 : y - Math.max(fs.left.h, fs.right.h) - 8);
    const hide = (s) => at[s].head.behind || at[s].center.behind;
    for (const s of SIDES) o.fins[s].style.visibility = hide(s) ? "hidden" : "";
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

  // Zoom (narrow the field of view, camera fixed at camera.dist) until both fields fit the window width and the
  // plant-top anchors to the slab bottom fit between fit.top and the strip row (fit.bottom px above the weather
  // strip), and move the camera up or down to center them there. Never wider than camera.fov. Projection-based,
  // a few passes.
  fitView() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    const C = T.camera, F = T.fit;
    const floor = this.ov && this.ov.floorY !== null ? this.ov.floorY : h - 120;
    this.fitted = { w, h, floor };
    this.camera.aspect = w / h;
    const half = T.fieldX + this.fields.left.W / 2 + F.margin + 0.6 * C.dollyX;
    const k = C.dist / this.basePos.distanceTo(this.baseTarget);
    const tanMax = Math.tan(THREE.MathUtils.degToRad(C.fov) / 2);
    // t = tan(half vertical fov): start where both fields span 96% x fit.zoom of the width at the target distance.
    let t = Math.min(tanMax, (half * h) / (0.96 * F.zoom * w * C.dist)), dy = 0;
    const setFov = () => {
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
      this.camera.updateProjectionMatrix();
      this.shared.uPx.value = (h * this.renderer.getPixelRatio()) / (2 * t);
    };
    if (this.user) { setFov(); return; }   // the viewer holds the camera
    const anchors = SIDES.map((s) => this.fields[s].anchors());
    // The fields fill fit.zoom of the box between fit.top and the strip row, centered in it.
    const top = F.top, bottom = Math.max(top + 80, floor - F.bottom), span = (bottom - top) * F.zoom;
    for (let pass = 0; pass < 4; pass++) {
      setFov();
      this.placeCamera(k, dy);
      const ys = anchors.flatMap((a) => [a.head, ...a.bottom]).map((p) => this.project(p).y);
      const a = Math.min(...ys), b = Math.max(...ys);
      if (b - a > span) t = Math.min(tanMax, t * (b - a) / span);
      const pxPerUnit = h / (2 * C.dist * t);
      dy += ((a + b) / 2 - (top + bottom) / 2) / pxPerUnit;
    }
    setFov();
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
    this.fitView();   // also sets the field of view and uPx
    const pr = this.renderer.getPixelRatio();
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
    const floorY = this.ov ? this.ov.floorY : null;
    if (floorY !== null && Math.abs(floorY - (this.fitted.floor ?? -1)) > 1) this.fitView();
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
