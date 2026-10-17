// Renderer, camera, lights, bloom and lite mode for the full-bleed Season scene (UI_SPEC.md sections 2 and 6).
// Fields are added with addField(field, x); unit 2 places a second one beside the first.
//
// Camera: slow auto-orbit, drag to orbit (auto-orbit resumes after a pause), double click to reset.
// ?lite=1: no bloom (the fields also drop transmission).

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { theme } from "./theme.js";

const HOME = { position: new THREE.Vector3(15.5, 9.5, 19.5), target: new THREE.Vector3(0, -2.6, 0) };
const RESUME_ORBIT_MS = 5000;

export class Stage {
  constructor(container, { lite = false } = {}) {
    this.container = container;
    this.lite = lite;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(theme.color.bg, 1);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(theme.color.keyLight, 1.4);
    key.position.set(8, 14, 6);
    this.scene.add(key, new THREE.AmbientLight(theme.color.keyLight, 0.15));

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.camera.position.copy(HOME.position);
    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.target.copy(HOME.target);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = 14;
    c.maxDistance = 48;
    c.maxPolarAngle = Math.PI * 0.47;
    c.autoRotate = true;
    c.autoRotateSpeed = 0.35;
    c.addEventListener("start", () => { clearTimeout(this.resumeTimer); c.autoRotate = false; this.homing = null; });
    c.addEventListener("end", () => { this.resumeTimer = setTimeout(() => (c.autoRotate = true), RESUME_ORBIT_MS); });
    r.domElement.addEventListener("dblclick", () => this.resetCamera());

    if (!lite) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const b = theme.bloom;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), b.strength, b.radius, b.threshold);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.fields = [];
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  addField(field, x = 0) {
    field.group.position.x = x;
    this.scene.add(field.group);
    this.fields.push(field);
  }

  // Ease back to the home view in under 400 ms.
  resetCamera() {
    clearTimeout(this.resumeTimer);
    this.homing = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone() };
    this.controls.autoRotate = true;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (this.homing) {
      const hm = this.homing;
      hm.t = Math.min(hm.t + (dt * 1000) / theme.motion.ms, 1);
      const p = 1 - (1 - hm.t) ** 3;
      this.camera.position.lerpVectors(hm.fromPos, HOME.position, p);
      this.controls.target.lerpVectors(hm.fromTarget, HOME.target, p);
      if (hm.t >= 1) this.homing = null;
    }
    for (const f of this.fields) f.update(dt);
    this.controls.update(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
