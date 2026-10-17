// All colors and sizes in one place (UI_SPEC.md sections 5 and 8). main.js writes the colors onto :root as
// custom properties, so style.css, the SVG fields and the mote canvas read the same values.
//
// R1 theme (every view): pure black background, neon foreground only, one shared SVG glow filter
// (#glow in index.html; ?lite=1 removes it). Display scales only map data to pixels; they are not facts.

export const theme = {
  color: {
    bg: "#000000",
    text: "#e8efe0",
    quiet: "#8a9a80",
    faint: "#3a4436",
    hairline: "rgba(232, 239, 224, 0.12)",
    hairlineStrong: "rgba(232, 239, 224, 0.26)",
    accent: "#76b900",
    // Meaning colors, used consistently everywhere.
    plant: "#76b900",
    nitrogen: "#76b900",
    water: "#3fd7ff",
    leach: "#ff4d4d",
    rain: "#7a93ad",
    gas: "#ffb020",
    // Agents (chat tags).
    weather: "#7a93ad",
    crop: "#9be15d",
    planner: "#3fd7ff",
    critic: "#ff8a3d",
    coordinator: "#76b900",
  },
  font: {
    sans: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
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
  // 3D Season view (R2, season3d.js, diorama3d.js, maize3d.js), in world units. Display mappings only, not facts.
  three: {
    block: { w: 5.0, d: 3.2, soil: 2.0, gap: 0.95, x: 3.5 },   // soil block size; x = |center| of each block
    plants: { rows: 4, perRow: 12, maxH: 2.4, sprout: 0.1 },   // ?lite=1 keeps every other plant
    labelY: 3.3,                  // field names float here, above the tallest plant
    camera: { fov: 38, pos: [0, 2.8, 15.7], target: [0, -0.3, 0], dollyX: 2.2, dollyPeriod: 44 },
    fog: { near: 13, far: 30 },
    bloom: { strength: 1.0, radius: 0.55, threshold: 0.0 },
    thirst: { start: 0.32, full: 0.15 },   // obs.soil_water_frac where leaves start to droop / droop fully
    stormLean: 0.55,              // bend at the plant top in a storm week (logged rain > stormMm)
    wind: 0.09, stormWind: 0.22,  // sway amplitude, calm and storm
    flashPeak: 0.55,              // lightning: kept below the leaching pulse so leaching stays the main event
    caption: { maxChars: 110 },
    motes: { soil: 60, dose: 50, uptake: 30, leach: 150, rain: 520, cap: 1400 },
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

export function applyCssTheme(root = document.documentElement) {
  for (const [k, v] of Object.entries(theme.color)) {
    root.style.setProperty(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v);
  }
  root.style.setProperty("--sans", theme.font.sans);
  root.style.setProperty("--mono", theme.font.mono);
  root.style.setProperty("--ms", `${theme.motion.ms}ms`);
  root.style.setProperty("--grow-ms", `${theme.motion.growMs}ms`);
}
