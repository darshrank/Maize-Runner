// Sizes, motion and display scales in one place (UI_SPEC.md sections 5 and 8). Colors and fonts are not here: the
// theme tokens live once, in the :root block of style.css, and readCssTheme() copies the colors into theme.color at
// boot, so the SVG fields, the mote canvas and the 3D scene read the same values as the CSS.
// Display scales only map data to pixels; they are not facts.

// style.css token names (kebab case) -> theme.color keys (camel case).
const TOKENS = ["bg", "surface-1", "surface-2", "border", "text", "muted", "accent",
  "water", "nitrogen", "plant", "leach", "rain", "tassel", "thirst"];

export const theme = {
  color: {},                     // filled by readCssTheme() from the style.css tokens
  motion: {
    ms: 340,                     // counters and panel transitions (< 400 ms, eased, no bounce)
    growMs: 700,                 // plant height / leaf transitions
    weekSeconds: 1.5,            // one week per 1.5 s at 1x
  },
  stormMm: 50,                   // a week with more logged rain than this is a storm week (UI_SPEC.md section 6)
  // Field geometry, in SVG viewBox units (fieldSvg.js). The plot keeps this aspect ratio; at 1920 x 1080 one
  // unit is about 1.4 px, so strokes of 1.6+ stay at or above 2 px.
  field: {
    w: 640, h: 470,
    ground: 262,                 // ground line y
    soilBottom: 410,             // bottom of the soil profile
    groundwater: 446,            // groundwater line y
    topsoil: 54,                 // depth of the topsoil band that holds N motes
    plants: 8,
    stalkMax: 220,               // stalk height at the task's max biomass
    sprout: 12,                  // stalk height at zero biomass, so the row is visible at week 0
    leavesMax: 7,
    stroke: { stalk: 2.4, leaf: 1.8, ground: 1.4 },
  },
  // 3D Season view (season3d.js, diorama3d.js, maize3d.js), in world units. Display mappings only, not facts.
  three: {
    fieldX: 3.2,                  // |x| of each field center (fix2: 3.5 -> 3.2, so both fields can fill the height)
    // Glass cube grid under each field: cols x rows columns, `layers` deep; gap = fraction of the pitch left
    // between cubes. One plant stands on the center of each top cube. The groundwater slab sits slabGap under it.
    grid: { cols: 6, rows: 6, layers: 4, pitch: 0.62, gap: 0.08, slabGap: 0.55, slabH: 0.14 },
    // Frosted glass (MeshPhysicalMaterial). soil / soilGlow: the faint brown in every cube (emissive). ?lite=1:
    // no transmission, plain translucent at liteOpacity. edge: the thin bright edge lines.
    // Neutral (no meaning): the glass is white-tinted (--text), its faint inner glow and the slab base are --surface-2,
    // the edges --text at edgeOpacity. Only water (cyan), N (green) and leaching (red) color the field.
    glass: {
      transmission: 0.9, roughness: 0.35, ior: 1.3, thickness: 0.5,
      soilGlow: 0.5, liteOpacity: 0.2, env: 0.45,
      edgeOpacity: 0.34, slabRed: 0.9,
      ambient: 0.35, key: 1.1,
    },
    water: { fill: 0.84, emit: 0.5 },    // inner cyan fill, as a share of the cube (fix1: emit 0.32 -> 0.9; fix2b: 0.5, less glare)
    // N and leaching cores (small emissive cubes). soil: cores at the task's max soil_n_kg_ha (perCube slots in
    // each top cube); dose / uptake / leach: counts at the task's max of that value. ?lite=1 halves dose and leach.
    // fix1: size 0.075 -> 0.095 and leach 80 -> 110 so the N cores and leaching drips read on video.
    cores: { perCube: 3, size: 0.095, dose: 36, uptake: 18, leach: 110, capN: 360, capLeach: 720 },
    plants: { maxH: 2.1, sprout: 0.1 },   // fix1: 2.4 -> 2.1, more of the frame for the soil grid
    labelY: 2.7,                  // top of the frame fit, above the back row's tallest plant + tassel (names sit in the strips now)
    // fix1: camera closer (z 16.2 -> 13), smaller sideways sway (2.2 -> 1.2). fix2: pos / target give only the
    // direction; the camera sits `dist` from the target (about fix1's fitted distance, so the black fog dims the
    // fields as before) and fitView zooms with the field of view (at most `fov`) to fill the window. Sway 1.4 at
    // dist 20 = fix1's 1.2 at about 17 (same angle).
    camera: { fov: 38, pos: [0, 2.1, 13.0], target: [0, -1.2, 0], dist: 20, dollyX: 1.4, dollyPeriod: 44 },
    fog: { near: 13, far: 30 },
    // Bloom between R2 (1.0 / 0.0) and R3 (0.5 / 0.15). Selective: plants (rim), water fill, N and leach cores,
    // groundwater fluid, lightning bolt. glow: per-kind gain in the bloom pass only (the scene itself is unchanged).
    // R5 (browser check): water 0.7 and pool 1.0 washed a full soil profile into solid cyan and the slab into a red
    // haze over the controls; both lowered so the glass and edges stay readable.
    bloom: { strength: 0.6, radius: 0.52, threshold: 0.1 },
    glow: { plant: 0.85, rim: 1.4, leafEdge: 0.85, water: 0.18, core: 1.25, pool: 0.4 },   // fix2b: water 0.3 -> 0.18
    // Leaching pulse (each splash adds to it, capped at 1.6, decays): gain on the groundwater fluid's emission and
    // on the slab's red tint. R4 used 1.7 and 0.5; one leaching week saturated the slab.
    leachPulse: { fluid: 0.8, slab: 0.25 },
    thirst: { start: 0.32, full: 0.15 },   // obs.soil_water_frac where leaves start to droop / droop fully
    stormLean: 0.55,              // bend at the plant top in a storm week (logged rain > stormMm)
    wind: 0.09, stormWind: 0.22,  // sway amplitude, calm and storm
    flashPeak: 0.55,              // lightning: kept below the leaching pulse so leaching stays the main event
    bolt: 1.4,                    // lightning bolt line brightness at the flash peak (bloomed)
    rain: 520,                    // rain streaks at full storm (weekly.rain_mm / 100)
    cards: { objectionChars: 100, stiffness: 150, damping: 24 },   // week cards (carousel.js)
    // Camera refit (season3d.js fitView, fix2): backs off when both fields (plus margin world units and the dolly
    // sway) would not fit the window width, or when the plant-top anchors (labelY) to the slab bottom would not fit
    // between `top` px (just under the top bar) and `bottom` px above the weather strip (the strips under the fields
    // overlap the slab's front edge a little).
    fit: { margin: 0.1, top: 72, bottom: 34, zoom: 0.84 },   // zoom: share of that box the fields fill (fix2b)
  },
  // Mote counts at full scale (each scaled by its value over the max across both fields for this task).
  motes: {
    soil: 36,                    // obs.soil_n_kg_ha
    dose: 40,                    // decision.n_kg_ha
    uptake: 26,                  // weekly.n_uptake
    leach: 110,                  // weekly.n_leached: the largest count, so the worst leaching week dominates
    rain: 150,                   // storm weeks, by weekly.rain_mm / 100
    cap: 700,                    // per field
  },
};

// Copies the style.css color tokens into theme.color (6-digit hex strings; motes.js appends alpha digits) and writes the
// motion timings onto :root. Call once at boot, before any view builds.
export function readCssTheme(root = document.documentElement) {
  const css = getComputedStyle(root);
  for (const name of TOKENS) {
    const v = css.getPropertyValue(`--${name}`).trim();
    if (!v) console.error(`Maize Runner theme: style.css token --${name} is missing`);
    theme.color[name.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
  }
  root.style.setProperty("--ms", `${theme.motion.ms}ms`);
  root.style.setProperty("--grow-ms", `${theme.motion.growMs}ms`);
}
