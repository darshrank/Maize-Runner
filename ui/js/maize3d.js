// Voxel maize for the 3D Season view: every plant is a stack of small matte cubes (stalk column, leaf cubes
// branching out, tassel cubes at VT / R), drawn as one InstancedMesh per field (one draw call). One instance per
// cube slot of one plant; instanceMatrix puts the slot's plant base and yaw on the field. The vertex shader places
// each cube from per-plant state, so growth, leaf count, tassel, wind sway, storm lean and thirst droop need no
// geometry rebuild:
//   aSlot  (per cube, fixed): x part (0 stalk, 1 leaf, 2 tassel), y leaf / spike index, z cube index along it
//   aSeed  (per cube, its plant's): x sway phase, y size jitter, z leaf angle jitter
//   aState (per cube, its plant's, written each frame by diorama3d.js): x growth 0..1 (biomass over the task's
//          max), y leaves shown (float), z tassel 0..1
//   uniforms per field: uWind (sway), uLean (storm lean), uDroop (thirst, from soil_water_frac)
// A cube pops in (ease-out-back) as the plant's height or leaf length passes it, so growth reads as cubes
// springing into place. Matte: lambert light only, no rim, no bloom (uBlack = 1 draws it black in the bloom pass,
// so it still hides what is behind it). Fog is applied by hand (black fog).

import * as THREE from "three";

export const LEAVES = 7;
export const TASSEL = 5;
export const TASSEL_CUBES = 3;

export const SHARED_GLSL = /* glsl */ `
uniform float uFlash;
uniform float uFogOn;
uniform float uFogNear;
uniform float uFogFar;
float fogFactor(float depth) { return uFogOn * smoothstep(uFogNear, uFogFar, depth); }
const vec3 LIGHT = vec3(0.39, 0.82, 0.42);
float matte(vec3 n) { return 0.42 + 0.58 * max(dot(normalize(n), LIGHT), 0.0); }
`;

// Cube slots for one plant at the tallest size (maxH with the largest jitter): [part, index, cube].
export function plantSlots({ maxH, cube }) {
  const top = maxH * 1.08;
  const stalk = Math.ceil(top / cube) + 1;
  const leaf = Math.ceil((0.15 + 0.3 * top) / cube) + 1;
  const slots = [];
  for (let i = 0; i < stalk; i++) slots.push([0, 0, i]);
  for (let j = 0; j < LEAVES; j++) for (let i = 0; i < leaf; i++) slots.push([1, j, i]);
  for (let j = 0; j < TASSEL; j++) for (let i = 0; i < TASSEL_CUBES; i++) slots.push([2, j, i]);
  return slots;
}

const VERTEX = /* glsl */ `
attribute vec3 aSlot;
attribute vec3 aSeed;
attribute vec3 aState;
uniform float uTime;
uniform float uWind;
uniform float uLean;
uniform float uDroop;
uniform float uMaxH;
uniform float uSprout;
uniform float uCube;
uniform vec3 uStalk;
uniform vec3 uLeaf;
uniform vec3 uTip;
uniform vec3 uTassel;
uniform vec3 uThirst;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vViewZ;

const float PI = 3.14159265;
const float LAST = ${(LEAVES - 1).toFixed(1)};

float leafPhi(float j) { return mod(j, 2.0) * PI + 0.5 * sin(j * 2.3 + aSeed.z * 6.0) + aSeed.z * 2.0; }

// Leaf center line: out and up, then arching over; droop pulls the tip down.
vec3 leafPoint(float j, float t, float L, float droop) {
  float phi = leafPhi(j);
  float d = L * t * (0.92 - 0.3 * droop * t);
  float h = L * (0.55 * t - 0.62 * t * t) - droop * L * 0.6 * t * t;
  return vec3(cos(phi) * d, h, sin(phi) * d);
}

// 0 until x > 0, then ease-out-back to 1 over one cube: the spring pop.
float pop(float x) {
  float t = clamp(x * 2.5, 0.0, 1.0) - 1.0;
  return x <= 0.0 ? 0.0 : 1.0 + 2.70158 * t * t * t + 1.70158 * t * t;
}

void main() {
  float c = uCube;
  float growth = aState.x;
  float H = (uSprout + (uMaxH - uSprout) * growth) * aSeed.y;
  float y0 = 0.2 * c;               // the bottom cube sits half sunk in the ground: no gap
  float part = aSlot.x, j = aSlot.y, i = aSlot.z;
  vec3 center;
  float s;
  vec3 col;
  if (part < 0.5) {
    center = vec3(0.0, y0 + i * c, 0.0);
    s = pop(H / c - i);
    col = uStalk;
  } else if (part < 1.5) {
    float show = clamp(aState.y - j, 0.0, 1.0);
    float attach = (0.1 + 0.72 * j / LAST) * H;
    float L = (0.15 + 0.3 * H) * (1.0 - 0.3 * j / LAST);
    float n = max(L / c, 1.0);
    float t = (i + 1.0) / n;
    vec3 q = vec3(0.0, attach, 0.0) + leafPoint(j, min(t, 1.0), L, uDroop);
    // Snap to the plant's cube grid, so leaves read as voxels.
    center = vec3(floor(q.x / c + 0.5) * c, floor((q.y - y0) / c + 0.5) * c + y0, floor(q.z / c + 0.5) * c);
    s = pop(n * show - i);
    col = mix(uLeaf, uTip, clamp(t, 0.0, 1.0) * 0.6);
  } else {
    float a = j / ${TASSEL.toFixed(1)} * 2.0 * PI + aSeed.z * 3.0;
    vec3 dir = normalize(vec3(cos(a) * 0.6, 1.0, sin(a) * 0.6));
    center = vec3(0.0, y0 + floor(H / c + 0.5) * c, 0.0) + dir * (i + 1.0) * c * 0.95;
    s = pop(aState.z * ${TASSEL_CUBES.toFixed(1)} - i);
    col = uTassel;
  }
  col = mix(col, uThirst, 0.5 * uDroop);
  vec3 p = center + position * c * 0.9 * s;

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vNormalW = mat3(modelMatrix) * mat3(instanceMatrix) * normal;

  // Wind sway and storm lean: a bend that grows with height, roughly length-preserving.
  float hf = clamp(center.y / max(H, 0.05), 0.0, 1.3);
  float sway = uWind * (0.65 * sin(uTime * 1.7 + aSeed.x) + 0.3 * sin(uTime * 2.9 + aSeed.x * 1.7));
  float bend = (sway + uLean) * hf * hf * H * 0.5;
  vec3 windDir = normalize(vec3(1.0, 0.0, 0.35));
  wp.xyz += windDir * bend;
  wp.y -= 0.5 * bend * bend / max(H, 0.05) * hf;
  if (part > 0.5 && part < 1.5) wp.y += uWind * 0.08 * sin(uTime * 4.1 + j * 1.3 + aSeed.x) * min(i / 6.0, 1.0);

  vColor = col;
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform float uBlack;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vViewZ;

void main() {
  vec3 col = vColor * matte(vNormalW);
  col += uFlash * (0.5 * vColor + vec3(0.1, 0.12, 0.14));
  gl_FragColor = vec4(col * (1.0 - fogFactor(vViewZ)) * (1.0 - uBlack), 1.0);
  #include <colorspace_fragment>
}
`;

// shared: {uTime, uFlash, uFogOn, uFogNear, uFogFar} uniform objects (one set for the whole scene).
export function maizeMaterial(shared, { maxH, sprout, cube, colors }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...shared,
      uWind: { value: 0 },
      uLean: { value: 0 },
      uDroop: { value: 0 },
      uBlack: { value: 0 },
      uMaxH: { value: maxH },
      uSprout: { value: sprout },
      uCube: { value: cube },
      uStalk: { value: new THREE.Color(colors.stalk) },
      uLeaf: { value: new THREE.Color(colors.leaf) },
      uTip: { value: new THREE.Color(colors.tip) },
      uTassel: { value: new THREE.Color(colors.tassel) },
      uThirst: { value: new THREE.Color(colors.thirst) },
    },
  });
}
