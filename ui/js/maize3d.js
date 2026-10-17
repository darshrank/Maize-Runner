// Stylized neon maize for the 3D Season view (R2 shape, restored in R4): one merged low-poly plant (stalk, curved
// ribbon leaves, tassel spikes) drawn as an InstancedMesh, one draw call per field, one instance per plant (one
// plant on the center of each top glass cube, diorama3d.js). The shape is built in the vertex shader from
// per-instance state, so growth, leaf unfurl, tassel, wind sway, storm lean and thirst droop need no geometry
// rebuild:
//   aState (per instance, written each frame by diorama3d.js): x growth 0..1 (biomass over the task's max),
//          y leaves shown (float, leaf j unfurls as y passes j), z tassel 0..1 (VT / R stages)
//   aSeed  (per instance, fixed): x sway phase, y size jitter, z leaf angle jitter
//   uniforms per field: uWind (sway), uLean (storm lean), uDroop (thirst, from soil_water_frac)
// Look: dark body with a green fresnel rim plus bright leaf edges and midrib, so the plants read as neon on
// black; the rim is what the selective bloom picks up (soft rim glow). Gains: theme.three.glow (rim, leafEdge,
// plant = brightness in the bloom pass only, through the shared uBloomPass flag). Fog is applied by hand.

import * as THREE from "three";

export const LEAVES = 7;
const LEAF_SEG = 10, TASSEL = 5, TASSEL_SEG = 3, RADIAL = 5, STALK_SEG = 6;

export const SHARED_GLSL = /* glsl */ `
uniform float uFlash;
uniform float uFogOn;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBloomPass;
float fogFactor(float depth) { return uFogOn * smoothstep(uFogNear, uFogFar, depth); }
const vec3 LIGHT = vec3(0.39, 0.82, 0.42);
float matte(vec3 n) { return 0.42 + 0.58 * max(dot(normalize(n), LIGHT), 0.0); }
`;

// Merged plant geometry. position.xz holds the stalk's unit circle; everything else comes from aPart/aLeaf.
export function maizeGeometry() {
  const pos = [], part = [], leaf = [], index = [];
  const add = (x, y, z, p, j, t, v) => {
    pos.push(x, y, z);
    part.push(p);
    leaf.push(j, t, v);
    return pos.length / 3 - 1;
  };
  // Stalk: open tapered cylinder.
  const s0 = 0;
  for (let i = 0; i <= STALK_SEG; i++) {
    for (let r = 0; r < RADIAL; r++) {
      const a = (r / RADIAL) * Math.PI * 2;
      add(Math.cos(a), 0, Math.sin(a), 0, 0, i / STALK_SEG, 0);
    }
  }
  for (let i = 0; i < STALK_SEG; i++) {
    for (let r = 0; r < RADIAL; r++) {
      const a = s0 + i * RADIAL + r, b = s0 + i * RADIAL + ((r + 1) % RADIAL);
      const c = a + RADIAL, d = b + RADIAL;
      index.push(a, c, b, b, c, d);
    }
  }
  // Ribbons (leaves: part 1, tassel spikes: part 2): two vertices across (v = -1, 1) per segment.
  const ribbon = (p, j, segs) => {
    const first = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      add(0, 0, 0, p, j, s / segs, -1);
      add(0, 0, 0, p, j, s / segs, 1);
    }
    for (let s = 0; s < segs; s++) {
      const a = first + 2 * s;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (let j = 0; j < LEAVES; j++) ribbon(1, j, LEAF_SEG);
  for (let j = 0; j < TASSEL; j++) ribbon(2, j, TASSEL_SEG);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute("aLeaf", new THREE.Float32BufferAttribute(leaf, 3));
  g.setIndex(index);
  // Plants move in the shader; a loose fixed bound keeps frustum culling from clipping them.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 4);
  return g;
}

const VERTEX = /* glsl */ `
attribute float aPart;
attribute vec3 aLeaf;
attribute vec3 aSeed;
attribute vec3 aState;
uniform float uTime;
uniform float uWind;
uniform float uLean;
uniform float uDroop;
uniform float uMaxH;
uniform float uSprout;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vPart;
varying float vAcross;
varying float vT;
varying float vViewZ;

const float PI = 3.14159265;
const float LAST = ${(LEAVES - 1).toFixed(1)};

float leafPhi(float j) { return mod(j, 2.0) * PI + 0.5 * sin(j * 2.3 + aSeed.z * 6.0) + aSeed.z * 2.0; }

// Leaf center line in the leaf's vertical plane: out and up, then arching over; droop pulls the tip down.
vec3 leafPoint(float j, float t, float L, float droop) {
  float phi = leafPhi(j);
  float d = L * t * (0.92 - 0.3 * droop * t);
  float h = L * (0.55 * t - 0.62 * t * t) - droop * L * 0.6 * t * t;
  return vec3(cos(phi) * d, h, sin(phi) * d);
}

void main() {
  float growth = aState.x;
  float H = (uSprout + (uMaxH - uSprout) * growth) * aSeed.y;
  vec3 p;
  vec3 n;
  float t = aLeaf.y;
  vAcross = aLeaf.z;
  vT = t;
  if (aPart < 0.5) {
    float r = (0.014 + 0.032 * growth) * (1.0 - 0.55 * t);
    p = vec3(position.x * r, t * H, position.z * r);
    n = normalize(vec3(position.x, 0.2, position.z));
  } else if (aPart < 1.5) {
    float j = aLeaf.x;
    float show = clamp(aState.y - j, 0.0, 1.0);
    float attach = (0.1 + 0.72 * j / LAST) * H;
    float L = (0.15 + 0.3 * H) * (1.0 - 0.3 * j / LAST) * show;
    float phi = leafPhi(j);
    vec3 c = leafPoint(j, t, L, uDroop);
    vec3 c2 = leafPoint(j, t + 0.03, L, uDroop);
    vec3 tang = c2 - c + vec3(0.0, 1e-4, 0.0);
    vec3 across = normalize(vec3(-sin(phi), 0.28 * t, cos(phi)));
    float w = 0.09 * L * sin(PI * pow(t, 0.7));
    p = vec3(0.0, attach, 0.0) + c + across * aLeaf.z * w;
    n = normalize(cross(normalize(tang), across));
  } else {
    float j = aLeaf.x;
    float a = j / 5.0 * 2.0 * PI + aSeed.z * 3.0;
    float len = 0.34 * aState.z * (0.6 + 0.4 * growth);
    vec3 dir = vec3(cos(a) * 0.5, 1.0, sin(a) * 0.5);
    vec3 c = vec3(dir.x * t, dir.y * t - 0.45 * t * t, dir.z * t) * len;
    vec3 across = normalize(vec3(-sin(a), 0.0, cos(a)));
    p = vec3(0.0, H, 0.0) + c + across * aLeaf.z * 0.014 * aState.z;
    n = normalize(vec3(cos(a), 0.4, sin(a)));
  }

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);

  // Wind sway and storm lean: a bend that grows with height, roughly length-preserving.
  float hf = clamp(p.y / max(H, 0.05), 0.0, 1.3);
  float sway = uWind * (0.65 * sin(uTime * 1.7 + aSeed.x) + 0.3 * sin(uTime * 2.9 + aSeed.x * 1.7));
  float bend = (sway + uLean) * hf * hf * H * 0.5;
  vec3 windDir = normalize(vec3(1.0, 0.0, 0.35));
  wp.xyz += windDir * bend;
  wp.y -= 0.5 * bend * bend / max(H, 0.05) * hf;
  if (aPart > 0.5 && aPart < 1.5) wp.y += uWind * 0.25 * sin(uTime * 4.1 + aLeaf.x * 1.3 + aSeed.x) * t * t * 0.3;

  vWorld = wp.xyz;
  vNormalW = wn;
  vPart = aPart;
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform vec3 uRim;
uniform vec3 uBody;
uniform vec3 uTassel;
uniform vec3 uThirst;
uniform float uDroop;
uniform float uRimGain;
uniform float uEdgeGain;
uniform float uGlow;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vPart;
varying float vAcross;
varying float vT;
varying float vViewZ;

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  float f = 1.0 - abs(dot(N, V));
  float rim = f * f;
  vec3 rimCol = mix(uRim, uThirst, 0.4 * uDroop);
  vec3 col = uBody;
  if (vPart < 0.5) {
    col += rimCol * (0.12 + uRimGain * rim);
  } else if (vPart < 1.5) {
    float edge = smoothstep(0.55, 1.0, abs(vAcross));
    float rib = 1.0 - smoothstep(0.0, 0.2, abs(vAcross));
    col += rimCol * (0.08 + 0.72 * uRimGain * rim + uEdgeGain * edge + 0.3 * rib) * (0.7 + 0.3 * vT);
  } else {
    col = uTassel * (0.7 + 0.9 * rim);
  }
  col += uFlash * vec3(0.55, 0.62, 0.7) * (0.25 + 0.75 * rim);
  col *= mix(1.0, uGlow, uBloomPass);
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)), 1.0);
  #include <colorspace_fragment>
}
`;

// shared: {uTime, uFlash, uFogOn, uFogNear, uFogFar, uBloomPass} uniform objects (one set for the whole scene).
// colors: {plant, body, tassel, thirst}; glow: theme.three.glow.
export function maizeMaterial(shared, { maxH, sprout, colors, glow }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    uniforms: {
      ...shared,
      uWind: { value: 0 },
      uLean: { value: 0 },
      uDroop: { value: 0 },
      uMaxH: { value: maxH },
      uSprout: { value: sprout },
      uRimGain: { value: glow.rim },
      uEdgeGain: { value: glow.leafEdge },
      uGlow: { value: glow.plant },
      uRim: { value: new THREE.Color(colors.plant) },
      uBody: { value: new THREE.Color(colors.body) },
      uTassel: { value: new THREE.Color(colors.tassel) },
      uThirst: { value: new THREE.Color(colors.thirst) },
    },
  });
}
