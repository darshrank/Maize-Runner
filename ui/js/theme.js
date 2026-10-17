// All colors and sizes in one place (UI_SPEC.md sections 5 and 8). main.js writes the CSS ones onto :root as
// custom properties, so style.css and the 3D scene read the same values. Kept out of main.js only to avoid an
// import cycle (field3d.js and timeline.js need it too).
//
// Display scales (biomassFull, leachScale) only map data to pixels; they are not facts about the season.

export const theme = {
  color: {
    bg: "#07090a",
    text: "#e8efe0",
    quiet: "#8a9a80",
    faint: "#4a5646",
    hairline: "rgba(232, 239, 224, 0.12)",
    hairlineStrong: "rgba(232, 239, 224, 0.24)",
    panel: "rgba(7, 9, 10, 0.62)",
    accent: "#76b900",
    // Meaning colors, used consistently everywhere (charts included).
    water: "#3fd7ff",
    nitrogen: "#76b900",
    leach: "#ff4d4d",
    gas: "#ffb020",
    rain: "#7a93ad",
    // Agents (chat tags, unit 3).
    weather: "#7a93ad",
    crop: "#9be15d",
    planner: "#3fd7ff",
    critic: "#ff8a3d",
    coordinator: "#76b900",
    // 3D only. Cube faces use bg (cut-out look); edges carry the data.
    canopyGlass: "#dfe9d2",      // fallback material only
    soilGlass: "#6b5a48",        // fallback material only
    canopyStressed: "#d6df8a",   // pale yellow-green, young / thin canopy
    canopyHealthy: "#7fd13b",    // bright green, full canopy
    soilEdge: "#4d473d",         // dry soil edge
    groundwater: "#0b1216",
    keyLight: "#f2f5ec",
  },
  font: {
    sans: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  motion: {
    ms: 340,                     // counters and panel transitions (< 400 ms, eased, no bounce)
    damping: 9,                  // 3D easing rate per second (about 95% in 340 ms)
    weekSeconds: 1,              // one week per second at 1x
  },
  field: {
    grid: 16,                    // 16 x 16 canopy cubes
    soilLayers: 4,
    pitch: 1,                    // cube spacing
    cube: 0.82,                  // cube size within its cell (reference gap 0.18)
    biomassFull: 20000,          // kg/ha that maps to full canopy height and color
    canopyMaxHeight: 2.8,
    leachScale: 40,              // kg/ha cumulative leached that gives about 63% groundwater tint
  },
  stormMm: 50,                   // a week with more rain than this gets a "Storm <mm>" tag (UI_SPEC.md section 6)
  // Bloom only above 1.0 (HDR): edges and ripple flashes stay at or below 1, so the 1px lines stay sharp.
  // Only the groundwater glow (and unit 2 particles) exceed it.
  bloom: { strength: 0.3, radius: 0.35, threshold: 1.0 },
  // React Bits Cubes reference values (see edgeMaterial.js): spring, ring travel and decay, intro tumble.
  cubes: {
    edgePx: 1, shading: 0.6, speed: 1, bounce: 0.4,
    ringTravel: 8,               // cells per second at speed 1
    glowFade: 3.2,               // flash decay per second
    maxRings: 6,
    introSeconds: 1.1,
  },
  // Data-event ripples. scale = the amount that gives full strength (display only); kick = spring tilt
  // impulse (reference uses 13); speed multiplies ringTravel; delay staggers the beats within a week;
  // color names a meaning color in theme.color.
  ripple: {
    storm: { color: "rain", scale: 100, kick: 6, speed: 1, delay: 0 },     // weekly.rain_mm > stormMm
    n: { color: "nitrogen", scale: 60, kick: 2.5, speed: 1, delay: 0.12 },    // decision.n_kg_ha > 0
    leach: { color: "leach", scale: 15, kick: 0, speed: 0.6, delay: 0.3 }, // weekly.n_leached > 0
  },
};

// The subset style.css uses, as --kebab-case custom properties.
export function applyCssTheme(root = document.documentElement) {
  for (const [k, v] of Object.entries(theme.color)) {
    root.style.setProperty(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v);
  }
  root.style.setProperty("--sans", theme.font.sans);
  root.style.setProperty("--mono", theme.font.mono);
  root.style.setProperty("--ms", `${theme.motion.ms}ms`);
}
