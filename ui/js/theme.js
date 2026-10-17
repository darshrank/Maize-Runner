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
    // 3D only.
    canopyGlass: "#dfe9d2",
    soilGlass: "#6b5a48",
    canopyStressed: "#d6df8a",   // pale yellow-green
    canopyHealthy: "#7fd13b",    // bright green
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
    cube: 0.8,                   // cube size within its cell
    biomassFull: 20000,          // kg/ha that maps to full canopy height and color
    canopyMaxHeight: 2.8,
    leachScale: 40,              // kg/ha cumulative leached that gives about 63% groundwater tint
  },
  stormMm: 50,                   // a week with more rain than this gets a "Storm <mm>" tag (UI_SPEC.md section 6)
  bloom: { strength: 0.35, radius: 0.35, threshold: 0.72 },
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
