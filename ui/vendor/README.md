# Vendored assets (offline replay: no CDN, no Google Fonts at runtime)

Each file is copied unchanged from an npm tarball whose sha512 matched the registry's `dist.integrity`.

| Package | Files | Integrity (prefix) |
|---|---|---|
| three@0.160.0 (MIT, `three/LICENSE`) | `three/build/three.module.js`; `three/examples/jsm/`: controls/OrbitControls, environments/RoomEnvironment, geometries/RoundedBoxGeometry, postprocessing/{EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, MaskPass, Pass}, shaders/{CopyShader, LuminosityHighPassShader, OutputShader} | sha512-DLU8lc0zNIPkM7rH5/e1Ks1 |
| @fontsource-variable/inter@5.2.8 (OFL 1.1, `fonts/LICENSE-inter.txt`) | `fonts/inter-latin-wght-normal.woff2` | sha512-kOfP2D+ykbcX/P3IFnokOhV |
| @fontsource-variable/jetbrains-mono@5.2.8 (OFL 1.1, `fonts/LICENSE-jetbrains-mono.txt`) | `fonts/jetbrains-mono-latin-wght-normal.woff2` | sha512-WBA9elru6Jdp5df2mES55wu |

three.js is used by the R2 3D Season view (js/season3d.js, diorama3d.js, maize3d.js) through the import map in ui/index.html (`three` and `three/addons/` point here). It loads only in 3D mode; ?view2d=1 (the R1 2D fallback) never loads it. RoomEnvironment lights the glass grid (R4, not in ?lite=1). RoundedBoxGeometry and js/edgeMaterial.js stay vendored but unused.
