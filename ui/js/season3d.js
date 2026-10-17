// 3D Season view (R2), three.js 0.160.0 (vendored, import map in index.html). Pure black background, black fog
// for depth, two floating dioramas (diorama3d.js): LEFT farmer baseline, RIGHT agent team (or grid hindsight).
//
//   camera   slow dolly between the two blocks; drag to orbit (OrbitControls), double click to reset
//   bloom    selective: only objects on BLOOM_LAYER (plant rims, water edge, motes, drips, pool, rain); the
//            rest is hidden for the bloom pass and the two passes are mixed (three.js selective bloom recipe)
//   storm    a week with logged rain over theme.stormMm: rain streaks, strong lean (dioramas), one lightning
//            flash when the week is entered; the flash stays below the leaching pulse in brightness
//   overlays HTML elements pinned to world anchors (field names, finale numbers), positioned every frame
//   ?lite=1  no bloom, half the plants, no fog
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
    };

    const C = T.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.1, 200);
    this.home = { pos: new THREE.Vector3(...C.pos), target: new THREE.Vector3(...C.target) };
    this.camera.position.copy(this.home.pos);
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
      left: new Diorama({ x: -T.block.x, shared: this.shared, lite, reduceMotion }),
      right: new Diorama({ x: T.block.x, shared: this.shared, lite, reduceMotion }),
    };
    for (const s of SIDES) this.scene.add(this.fields[s].group);
    this.buildRain();

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
    const n = T.motes.rain;
    this.rain = Array.from({ length: n }, () => this.rainDrop(true));
    this.rainTarget = 0;
    this.rainPos = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", this.rainPos);
    g.setDrawRange(0, 0);
    this.rainMat = new THREE.LineBasicMaterial({ color: theme.color.rain, transparent: true, opacity: 0.55, depthWrite: false });
    this.rainLines = new THREE.LineSegments(g, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.layers.enable(BLOOM_LAYER);
    this.scene.add(this.rainLines);
  }

  rainDrop(anywhere = false) {
    const span = T.block.x + T.block.w / 2 + 1.5;
    return { x: (Math.random() * 2 - 1) * span, z: (Math.random() * 2 - 1) * (T.block.d / 2 + 0.6),
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
    this.rainTarget = storm && !this.reduce ? Math.round(T.motes.rain * Math.min(1, rain / 100)) : 0;
    if (storm && moved && !this.reduce) this.flashT = 0;
    return storm;
  }

  // ------------------------------------------------------------ overlays

  // items: [{el, side: "left"|"right"|null, kind: "name"|"pool"|"mid"}]; el is positioned at the anchor.
  setOverlays(items) {
    this.overlays = items.map((it) => ({ ...it, v: new THREE.Vector3() }));
  }

  placeOverlays() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    for (const o of this.overlays) {
      if (o.kind === "mid") {
        const a = this.fields.left.anchor("name"), b = this.fields.right.anchor("name");
        o.v.copy(a).add(b).multiplyScalar(0.5);
      } else o.v.copy(this.fields[o.side].anchor(o.kind));
      o.v.project(this.camera);
      const behind = o.v.z > 1;
      o.el.style.visibility = behind ? "hidden" : "";
      o.el.style.transform = `translate(${((o.v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - o.v.y) / 2 * h).toFixed(1)}px)`;
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

  resize() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    for (const s of SIDES) {
      this.fields[s].update(dt);
      this.fields[s].flash(f);
    }
    this.tickRain(this.reduce ? 0 : dt);
    this.tickCamera(dt);
    this.render();
    this.placeOverlays();
    this.checkShaders();
  }

  render() {
    if (!this.bloomComposer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const hidden = [];
    for (const o of this.nonBloom) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    this.bloomComposer.render();
    for (const o of hidden) o.visible = true;
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
