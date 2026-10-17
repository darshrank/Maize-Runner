# Vendored assets (offline replay: no CDN, no Google Fonts at runtime)

Each file is copied unchanged from an npm tarball whose sha512 matched the registry's `dist.integrity`.

| Package | Files | Integrity (prefix) |
|---|---|---|
| three@0.160.0 (MIT, `three/LICENSE`) | `three/build/three.module.js`; `three/examples/jsm/`: controls/OrbitControls, environments/RoomEnvironment, geometries/RoundedBoxGeometry, postprocessing/{EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, MaskPass, Pass}, shaders/{CopyShader, LuminosityHighPassShader, OutputShader} | sha512-DLU8lc0zNIPkM7rH5/e1Ks1 |
| @fontsource-variable/inter@5.2.8 (OFL 1.1, `fonts/LICENSE-inter.txt`) | `fonts/inter-latin-wght-normal.woff2` | sha512-kOfP2D+ykbcX/P3IFnokOhV |
| @fontsource-variable/jetbrains-mono@5.2.8 (OFL 1.1, `fonts/LICENSE-jetbrains-mono.txt`) | `fonts/jetbrains-mono-latin-wght-normal.woff2` | sha512-WBA9elru6Jdp5df2mES55wu |

The import map in `ui/index.html` maps `three` and `three/addons/` to `vendor/three/`.
