// Edge-line cube material for the Maize Runner field, ported from the fragment shader of the React Bits
// <Cubes /> component (reactbits.dev, JavaScript + CSS variant). Not React: a three.js ShaderMaterial (GLSL3)
// used only inside this app. Do not export or publish it as a standalone component or package.
//
// Credit: the React Bits Cubes component by David Haz, inspired by Can Tastemel's original work for the
// lambda.ai landing page (https://cantastemel.com).
//
// What is ported (FRAGMENT): fwidth-based UV edge lines with antialiased coverage, edges faded on faces seen
// edge-on, side shading from a fixed light, and the ripple flash on faces and edges. Faces use the page
// background (#07090a) for the cut-out look. Changes for Maize Runner: per-instance edge color (data-driven)
// and per-instance flash (rgb = ripple color, a = strength) instead of single uniforms; solid edges only;
// a perspective scene with instanceMatrix and view-space normals instead of the 2D grid projection.
// The ring, spring and intro logic from the same component lives in field3d.js.
//
// Original license (React Bits repository, LICENSE.md), reproduced in full:
//
//   MIT + Commons Clause License Condition v1.0
//
//   Copyright (c) 2026 David Haz
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   ## Commons Clause Restriction
//
//   You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
//
//   ## No Warranty
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

import * as THREE from "three";

// The reference light, normalized (Cubes render(): [-0.42, 0.55, 0.72]).
const LIGHT = new THREE.Vector3(-0.42, 0.55, 0.72).normalize();

// three.js (r160, GLSL3 ShaderMaterial) prepends #version 300 es, precision, USE_INSTANCING and the
// position / normal / uv / instanceMatrix attributes and matrix uniforms.
export const EDGE_VERTEX = /* glsl */ `
in vec3 aEdge;
in vec4 aFlash;
out vec3 vNormal;
out vec2 vUv;
out vec3 vEdge;
out vec4 vFlash;

void main() {
  mat3 im = mat3(instanceMatrix);
  // Normal through the instance transform: R * S^-1 * n (instances are rotated and non-uniformly scaled).
  vec3 s2 = max(vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])), vec3(1e-8));
  vNormal = normalize(normalMatrix * (im * (normal / s2)));
  vUv = uv;
  vEdge = aEdge;
  vFlash = aFlash;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

// Ported from the reference FRAGMENT (solid edge style). With GLSL3, three.js does not declare the output,
// so it is declared here; colorspace_fragment then converts to the output color space (sRGB on screen,
// linear into the bloom composer).
export const EDGE_FRAGMENT = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
in vec3 vNormal;
in vec2 vUv;
in vec3 vEdge;
in vec4 vFlash;
uniform vec3 uFace;
uniform vec3 uLight;
uniform float uShading;
uniform float uEdgeWidth;

void main() {
  vec2 span = max(fwidth(vUv), vec2(0.00001));
  vec2 border = min(vUv, 1.0 - vUv) / span;
  float dist = min(border.x, border.y);
  float halfWidth = uEdgeWidth * 0.5;
  float cover = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, dist);
  vec3 normal = normalize(vNormal);
  cover *= smoothstep(0.06, 0.28, abs(normal.z));
  float side = clamp(1.0 - normal.z, 0.0, 1.0);
  float toward = clamp(0.6 + 0.6 * dot(normalize(normal.xy + vec2(0.00001)), normalize(uLight.xy)), 0.0, 1.0);
  vec3 face = mix(uFace, vEdge, side * mix(0.12, 0.42, toward) * uShading);
  face = mix(face, vFlash.rgb, vFlash.a * 0.22);
  vec3 edge = mix(vEdge, vFlash.rgb, vFlash.a);
  gl_FragColor = vec4(mix(face, edge, cover), 1.0);
  #include <colorspace_fragment>
}`;

// face: hex color of the faces (the background); shading: reference default 0.6.
export function createEdgeMaterial({ face, shading = 0.6, edgePx = 1, pixelRatio = 1 }) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: EDGE_VERTEX,
    fragmentShader: EDGE_FRAGMENT,
    uniforms: {
      uFace: { value: new THREE.Color(face) },
      uLight: { value: LIGHT.clone() },
      uShading: { value: shading },
      uEdgeWidth: { value: edgePx * pixelRatio },
    },
  });
  // Faces must equal the background exactly; the composer's OutputPass tone-maps both together.
  material.toneMapped = false;
  material.userData.edgePx = edgePx;
  return material;
}

// Edge width is 1px times the device pixel ratio (fwidth works in framebuffer pixels).
export function setEdgePixelRatio(material, pixelRatio) {
  if (material.uniforms && material.uniforms.uEdgeWidth) {
    material.uniforms.uEdgeWidth.value = (material.userData.edgePx || 1) * pixelRatio;
  }
}

// Per-instance attributes the shader reads: aEdge (rgb, linear) and aFlash (rgb ripple color, a strength).
export function addEdgeAttributes(geometry, count) {
  const edge = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  edge.setUsage(THREE.DynamicDrawUsage);
  flash.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aEdge", edge);
  geometry.setAttribute("aFlash", flash);
  return { edge, flash };
}
