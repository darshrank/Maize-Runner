// How it works (page 6): one static inline SVG of a team week, no animation, no data numbers, no fetches.
// The order is the one in the a_d1c_multi dev logs (agents_a/designs/d1c_multi/runs, dev task ids only), which matches
// agents_a/designs/d1_multi/policy.py decide():
//   1. Weather (get_weather) and Crop (get_crop_state, get_soil) run in parallel and return their reports;
//   2. Planner proposes N and irrigation (propose_plan; get_budget / get_history some weeks);
//   3. Critic accepts or objects (review_plan; get_budget / get_soil some weeks). An objection goes to the Planner,
//      which revises once; the revised plan goes on to the Coordinator;
//   4. Coordinator makes the final call (submit_decision) and gym-DSSAT steps the field one week.
// Env tools are GET /tool/{name} on the env server (port 9000); the Coordinator calls none. Every agent is a call
// to the same Nemotron 3.5 Lightning on vLLM.

import { theme } from "./theme.js";
import { DOCK_ICONS } from "./dock.js";

const W = 1400, H = 812;
const C = theme.color;
const RED = C.leach;

const BOX = {
  tools:   { x: 180,  y: 24,  w: 860, h: 76 },
  weather: { x: 100,  y: 170, w: 230, h: 92 },
  crop:    { x: 100,  y: 498, w: 230, h: 92 },
  coord:   { x: 500,  y: 330, w: 220, h: 100 },
  planner: { x: 890,  y: 170, w: 230, h: 92 },
  critic:  { x: 890,  y: 498, w: 230, h: 92 },
  field:   { x: 1180, y: 296, w: 150, h: 168 },
  model:   { x: 180,  y: 690, w: 860, h: 64 },
};

const AGENTS = {
  weather: { name: "Weather", color: C.weather, role: "reads the forecast", tools: "get_weather" },
  crop: { name: "Crop", color: C.crop, role: "reads crop and soil", tools: "get_crop_state · get_soil" },
  planner: { name: "Planner", color: C.planner, role: "proposes N and water", tools: "get_budget · get_history" },
  critic: { name: "Critic", color: C.critic, role: "accepts or objects", tools: "get_budget · get_soil" },
  coord: { name: "Coordinator", color: C.coordinator, role: "makes the final call", tools: "submit_decision" },
};

// Spokes, in call order: out = the hub hands the agent its turn (numbered), back = what the agent returns.
// side: which side of the spoke the return label sits on (+1 / -1 along the normal), anchor: its text-anchor.
const SPOKES = [
  { to: "weather", step: 1, back: "weather_report", side: -1, anchor: "end" },
  { to: "crop", step: 1, back: "crop_report", side: 1, anchor: "end" },
  { to: "planner", step: 2, back: "propose_plan", side: -1, anchor: "end" },
  { to: "critic", step: 3, back: "review_plan", side: -1, anchor: "start" },
];

const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

// Where the segment from p (inside box b) toward q leaves b.
function exit(b, p, q) {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  let t = 1;
  if (dx) t = Math.min(t, ((dx > 0 ? b.x + b.w : b.x) - p[0]) / dx);
  if (dy) t = Math.min(t, ((dy > 0 ? b.y + b.h : b.y) - p[1]) / dy);
  return [p[0] + dx * t, p[1] + dy * t];
}

const f = (v) => Math.round(v * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function text(x, y, s, cls, { anchor = "middle", fill } = {}) {
  return `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" class="${cls}"${fill ? ` fill="${fill}"` : ""}>${esc(s)}</text>`;
}

function badge(x, y, n, color) {
  return `<g class="hiw-badge"><circle cx="${f(x)}" cy="${f(y)}" r="15" stroke="${color}"/>`
    + text(x, y + 5.5, n, "hiw-num", { fill: color }) + "</g>";
}

// A path that may cross another line: a black halo under it leaves a small gap in the line it passes over.
function line(d, cls, { color, marker, halo = false, dash = false } = {}) {
  const attrs = `d="${d}"${color ? ` stroke="${color}"` : ""}${dash ? ' stroke-dasharray="5 6"' : ""}`;
  return (halo ? `<path class="hiw-halo" d="${d}"/>` : "")
    + `<path class="${cls}" ${attrs}${marker ? ` marker-end="url(#hiw-arrow-${marker})"` : ""}/>`;
}

function agentBox(key) {
  const b = BOX[key], a = AGENTS[key], cx = b.x + b.w / 2;
  return `<rect class="hiw-box neon" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" stroke="${a.color}"/>`
    + text(cx, b.y + 31, a.name, "hiw-name", { fill: a.color })
    + text(cx, b.y + 55, a.role, "hiw-sub")
    + text(cx, b.y + 77, a.tools, "hiw-mono");
}

function spoke(s) {
  const hub = center(BOX.coord), dst = center(BOX[s.to]), color = AGENTS[s.to].color;
  const len = Math.hypot(dst[0] - hub[0], dst[1] - hub[1]);
  const u = [(dst[0] - hub[0]) / len, (dst[1] - hub[1]) / len], n = [-u[1], u[0]];
  const shift = (p, k) => [p[0] + n[0] * k, p[1] + n[1] * k];
  const gap = 6, pad = 9;   // half the spacing of the two lines; clearance at each box edge for the arrowheads
  const seg = (k) => {
    const a = shift(hub, k), b = shift(dst, k);
    const p = exit(BOX.coord, a, b), q = exit(BOX[s.to], b, a);
    return [[p[0] + u[0] * pad, p[1] + u[1] * pad], [q[0] - u[0] * pad, q[1] - u[1] * pad]];
  };
  const out = seg(-gap * s.side), back = seg(gap * s.side).reverse();
  const at = (sg, t) => [sg[0][0] + (sg[1][0] - sg[0][0]) * t, sg[0][1] + (sg[1][1] - sg[0][1]) * t];
  const nb = at(out, 0.42), lb = at(back, 0.5);
  const bp = shift(nb, -s.side * 22), lp = shift(lb, s.side * 18);
  return line(`M${pts(out)}`, "hiw-call neon", { color, marker: s.to })
    + line(`M${pts(back)}`, "hiw-back", { marker: "back" })
    + badge(bp[0], bp[1], s.step, color)
    + text(lp[0], lp[1] + 5, s.back, "hiw-mono hiw-back-label", { anchor: s.anchor });
}

export function howItWorksSvg() {
  const B = BOX, hub = center(B.coord);
  const markers = [["weather", C.weather], ["crop", C.crop], ["planner", C.planner], ["critic", C.critic],
    ["coord", C.coordinator], ["back", C.quiet], ["red", RED]]
    .map(([id, c]) => `<marker id="hiw-arrow-${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7"`
      + ` orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0.8 L9 5 L0 9.2 z" style="fill:${c};stroke:none"/></marker>`)
    .join("");

  // Model lines: one thin line from every agent to the shared model. Weather and Planner go round the outside.
  const modelTop = B.model.y, modelMid = B.model.y + B.model.h / 2;
  const model = [
    line(`M${pts([[B.weather.x, 236], [56, 236], [56, modelMid], [B.model.x, modelMid]])}`, "hiw-model"),
    line(`M${pts([[B.planner.x + B.planner.w, 236], [1356, 236], [1356, modelMid], [B.model.x + B.model.w, modelMid]])}`, "hiw-model"),
    line(`M${pts([[215, B.crop.y + B.crop.h], [215, modelTop]])}`, "hiw-model"),
    line(`M${pts([[1005, B.critic.y + B.critic.h], [1005, modelTop]])}`, "hiw-model"),
    line(`M${pts([[hub[0], B.coord.y + B.coord.h], [hub[0], modelTop]])}`, "hiw-model"),
  ].join("");

  // Env tool lines (dashed), only to the agents that call env tools. Crop and Critic go round the outside.
  const toolsMid = B.tools.y + B.tools.h / 2, toolsBot = B.tools.y + B.tools.h;
  const tools = [
    line(`M${pts([[215, toolsBot], [215, B.weather.y]])}`, "hiw-tool", { dash: true }),
    line(`M${pts([[1005, toolsBot], [1005, B.planner.y]])}`, "hiw-tool", { dash: true }),
    line(`M${pts([[B.tools.x, toolsMid], [30, toolsMid], [30, 544], [B.crop.x, 544]])}`, "hiw-tool", { dash: true, halo: true }),
    line(`M${pts([[B.tools.x + B.tools.w, toolsMid], [1382, toolsMid], [1382, 544], [B.critic.x + B.critic.w, 544]])}`,
      "hiw-tool", { dash: true, halo: true }),
  ].join("");

  // Critic objection: straight to the Planner (it revises once, then the plan goes on to the Coordinator).
  const objX = 1085;
  const objection = line(`M${pts([[objX, B.critic.y - 4], [objX, B.planner.y + B.planner.h + 9]])}`, "hiw-obj neon",
    { color: RED, marker: "red" })
    + text(objX - 12, 296, "objection", "hiw-obj-label", { anchor: "end", fill: RED })
    + text(objX - 12, 318, "Planner revises once", "hiw-sub", { anchor: "end" });

  // Step 4: the Coordinator's decision to the field.
  const fy = hub[1];
  const decision = line(`M${pts([[B.coord.x + B.coord.w + 9, fy], [B.field.x - 9, fy]])}`, "hiw-call neon",
    { color: C.coordinator, marker: "coord", halo: true })
    + badge(850, fy - 26, 4, C.coordinator)
    + text(874, fy - 14, "submit_decision", "hiw-mono", { anchor: "start", fill: C.text })
    + text(850, fy + 30, "N kg/ha · irrigation mm", "hiw-sub", { anchor: "start" });

  const fc = B.field.x + B.field.w / 2;
  const field = `<rect class="hiw-box neon" x="${B.field.x}" y="${B.field.y}" width="${B.field.w}" height="${B.field.h}" rx="10" stroke="${C.plant}"/>`
    + `<g class="hiw-icon neon" transform="translate(${fc - 22} ${B.field.y + 16}) scale(1.85)" stroke="${C.plant}">${DOCK_ICONS.sprout}</g>`
    + text(fc, B.field.y + 84, "gym-DSSAT", "hiw-name", { fill: C.plant })
    + text(fc, B.field.y + 106, "maize field", "hiw-sub")
    + text(fc, B.field.y + 130, "steps one week", "hiw-sub")
    + text(fc, B.field.y + 150, "per decision", "hiw-sub");

  const toolBox = `<rect class="hiw-box hiw-plain" x="${B.tools.x}" y="${B.tools.y}" width="${B.tools.w}" height="${B.tools.h}" rx="10"/>`
    + text(B.tools.x + B.tools.w / 2, B.tools.y + 30, "Tools · env server, port 9000 · GET /tool/{name}", "hiw-name", { fill: C.text })
    + text(B.tools.x + B.tools.w / 2, B.tools.y + 56, "get_weather · get_crop_state · get_soil · get_budget · get_history", "hiw-mono");

  const modelBox = `<rect class="hiw-box neon" x="${B.model.x}" y="${B.model.y}" width="${B.model.w}" height="${B.model.h}" rx="10" stroke="${C.accent}"/>`
    + text(B.model.x + B.model.w / 2, B.model.y + 28, "Nemotron 3.5 Lightning on vLLM", "hiw-name", { fill: C.accent })
    + text(B.model.x + B.model.w / 2, B.model.y + 50, "one model, shared by every agent", "hiw-sub");

  const parallel = text(215, 372, "Weather and Crop", "hiw-sub") + text(215, 394, "run in parallel", "hiw-sub");

  // Legend: one row under the model box.
  const ly = 790;
  const key = (x, sample, label) => sample + text(x + 46, ly + 5, label, "hiw-sub", { anchor: "start" });
  const legend = key(180, line(`M${x0(180)}`, "hiw-call neon", { color: C.coordinator, marker: "coord" }), "call order")
    + key(370, line(`M${x0(370)}`, "hiw-back", { marker: "back" }), "returned to the Coordinator")
    + key(680, line(`M${x0(680)}`, "hiw-obj neon", { color: RED, marker: "red" }), "Critic objection")
    + key(880, line(`M${x0(880)}`, "hiw-tool", { dash: true }), "env tool call")
    + key(1060, line(`M${x0(1060)}`, "hiw-model"), "model call");
  function x0(x) { return `${x} ${ly} L${x + 36} ${ly}`; }

  return `<svg class="hiw-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="One FieldTwin week: Weather and Crop in parallel, then Planner, Critic (an objection goes back to the Planner), then the Coordinator sends the decision to the gym-DSSAT field. Env tools on the env server, port 9000. Every agent calls Nemotron 3.5 Lightning on vLLM.">
    <defs>${markers}
      <!-- userSpaceOnUse: a straight horizontal / vertical line has a zero-height box, so a bounding-box filter region would hide it -->
      <filter id="hiw-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${model}${tools}${SPOKES.map(spoke).join("")}${objection}${decision}
    ${toolBox}${modelBox}${["weather", "crop", "planner", "critic", "coord"].map(agentBox).join("")}${field}
    ${parallel}${legend}
  </svg>`;
}

// Static page: built once, on first visit.
export function renderHowItWorks(root) {
  if (root.dataset.built) return;
  root.innerHTML = `<header class="hiw-head">
      <h1>How it works</h1>
      <p class="quiet">One week of the FieldTwin agent team, in the order the a_d1c_multi dev logs record it.
        The loop repeats every week until harvest.</p>
    </header>${howItWorksSvg()}`;
  root.dataset.built = "1";
}
