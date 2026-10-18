// How it works (page 6): a step-by-step walkthrough of one real week of the FieldTwin agent team (a_d1c_multi).
// The week: the first Critic objection week of UFGA-2006 (dev), else of the first dev season (tasks/dev.jsonl order)
// that has one. Every value shown comes from that week's log lines (data.loadRun, dev seasons only); a value the log
// lacks is left out, never filled in. Steps (Back / Next, arrow keys):
//   1 Weather and Crop gather data (their env tool calls), 2 Planner proposes, 3 Critic objects, 4 Planner revises,
//   5 Coordinator decides, 6 the field steps one week.
// The step's boxes light up with a short card each; the rest dims. Hover (or focus) any box: its role in one line plus
// its message this week. A week with no review_plan verdict shows "No verdict", not accept.
// Order and wiring follow the a_d1c_multi dev logs (agents_a/designs/d1_multi/policy.py decide()): Weather and Crop in
// parallel, Planner, Critic (an objection goes to the Planner, which revises once), Coordinator, env step. Env tools
// are GET /tool/{name} on the env server (port 9000); every agent is a call to the same Nemotron on vLLM.

import { theme } from "./theme.js";
import { DOCK_ICONS } from "./dock.js";
import * as data from "./data.js";

const CONFIG = "a_d1c_multi";
// Live mode (?live=UFGA-2026, or picking the live season on the Season page): follow a season that
// scripts/live_season.py is playing right now. The page polls the live log, lights each box as that agent answers
// and moves on week by week. Nothing is precomputed.
let LIVE = new URLSearchParams(location.search).get("live");
let liveTimer = null;
const POLL_MS = 600, STAGE_MS = 1800, HOLD_MS = 3500;   // poll; min time per stage; hold the finished week
const PREFERRED = "UFGA-2006";
const W = 1400, H = 770;
const C = theme.color;

const BOX = {
  tools:   { x: 180,  y: 24,  w: 860, h: 64 },
  weather: { x: 100,  y: 170, w: 230, h: 80 },
  crop:    { x: 100,  y: 498, w: 230, h: 80 },
  coord:   { x: 500,  y: 330, w: 220, h: 100 },
  planner: { x: 890,  y: 170, w: 230, h: 80 },
  critic:  { x: 890,  y: 498, w: 230, h: 80 },
  field:   { x: 1180, y: 300, w: 150, h: 160 },
  model:   { x: 180,  y: 680, w: 860, h: 64 },
};

const ROLE = {
  weather: "Reads the weather and forecasts rain.",
  crop: "Reads crop stage and soil.",
  planner: "Proposes nitrogen and irrigation.",
  critic: "Checks the plan: accepts or objects.",
  coord: "Makes the final call for the week.",
  tools: "Env server, port 9000: the read tools agents call.",
  model: "The one model behind every agent.",
  field: "gym-DSSAT maize simulation: one step per weekly decision.",
};
const NAME = { weather: "Weather", crop: "Crop", planner: "Planner", critic: "Critic", coord: "Coordinator" };

const STEPS = [
  "Weather and Crop gather data",
  "Planner proposes",
  "Critic objects",
  "Planner revises",
  "Coordinator decides",
  "The field steps one week",
];

// ---------------------------------------------------------------- the week, from the log

function args(raw) {
  try {
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    return a && typeof a === "object" ? a : null;
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const has = (v) => v !== null && v !== undefined;

// First sentence of a logged text (cut at a word near 150 chars if it runs on). Shortens; never rewrites.
function firstSentence(s) {
  if (!s) return null;
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  let out = (m ? m[0] : s).trim();
  if (out.length > 150) out = `${out.slice(0, 150).replace(/\s+\S*$/, "")}…`;
  return out;
}

// Everything the steps and hover cards use, read from the week's log lines. missing: what the log did not have.
function readWeek(run, k) {
  const w = run.weeks[k], ev = w.events, missing = [];
  const calls = (agent) => ev.filter((e) => e.agent === agent && e.kind === "tool_call").map((e) => e.data && e.data.name)
    .filter(Boolean);
  const answers = (agent, name) => ev.filter((e) => e.agent === agent && e.kind === "message")
    .flatMap((e) => (Array.isArray(e.data && e.data.tool_calls) ? e.data.tool_calls : []))
    .filter((c) => c && c.name === name).map((c) => args(c.arguments)).filter(Boolean);

  const wr = answers("weather", "weather_report")[0] || null;
  const cr = answers("crop", "crop_report")[0] || null;
  const plans = answers("planner", "propose_plan");
  const review = answers("critic", "review_plan")[0] || null;
  const submit = answers("coordinator", "submit_decision")[0] || null;
  const objected = !!review && review.verdict === "object";
  const first = plans[0] || null, revised = objected ? plans[1] || null : null;
  const prev = k > 0 && run.weeks[k - 1].step ? run.weeks[k - 1].step.obs : null;
  const step = w.step || null;
  const plan = (p) => p && { n: num(p.n_kg_ha), irr: num(p.irr_mm), reason: str(p.reason) };

  const wk = {
    task: run.task, k, split: run.split,
    tools: { weather: calls("weather"), crop: calls("crop"), planner: calls("planner"), critic: calls("critic") },
    weather: wr && { r3: num(wr.rain_next_3d_mm), summary: str(wr.summary) },
    crop: cr && { stage: str(cr.stage), water: str(cr.water_status), summary: str(cr.summary) },
    first: plan(first), revised: plan(revised), submit: plan(submit),
    review: review ? { verdict: str(review.verdict), objection: str(review.objection) } : null,
    applied: w.policyDecision ? { n: num(w.policyDecision.n_kg_ha), irr: num(w.policyDecision.irr_mm) } : null,
    clamped: w.clamped,
    rain: step && step.weekly ? num(step.weekly.rain_mm) : null,
    leached: step && step.weekly ? num(step.weekly.n_leached) : null,
    swBefore: prev ? num(prev.soil_water_frac) : null,
    swAfter: step && step.obs ? num(step.obs.soil_water_frac) : null,
    modelCalls: ev.filter((e) => e.kind === "message" && e.data && num(e.data.latency_s) !== null).length,
    missing,
  };
  const need = [
    [wk.tools.weather.length || null, "weather tool calls"], [wk.tools.crop.length || null, "crop tool calls"],
    [wk.weather && wk.weather.r3, "weather_report rain_next_3d_mm"], [wk.crop && wk.crop.stage, "crop_report stage"],
    [wk.first && wk.first.n, "planner first proposal N"], [wk.first && wk.first.irr, "planner first proposal irrigation"],
    [wk.review && wk.review.objection, "critic objection text"],
    [wk.revised && wk.revised.n, "planner revised N"], [wk.revised && wk.revised.irr, "planner revised irrigation"],
    [wk.submit && wk.submit.n, "coordinator N"], [wk.submit && wk.submit.irr, "coordinator irrigation"],
    [wk.submit && wk.submit.reason, "coordinator reason"], [wk.rain, "step_result rain"],
    [wk.swBefore, "soil water before (previous step_result)"], [wk.swAfter, "soil water after"],
  ];
  for (const [v, what] of need) if (!has(v)) missing.push(what);
  return wk;
}

// UFGA-2006 if it is a dev season, then the other dev seasons in tasks/dev.jsonl order; the first with a Critic
// objection wins, at its first objection week. A failed load stops the search (shown on the load card).
async function pickWeek() {
  const dev = data.seasons();
  const order = dev.includes(PREFERRED) ? [PREFERRED, ...dev.filter((t) => t !== PREFERRED)] : dev;
  for (const task of order) {
    const run = await data.loadRun(CONFIG, task);
    if (run instanceof data.LoadError) return { error: `Could not load ${task}` };
    if (run && run.objectionWeeks.length) return { run, k: run.objectionWeeks[0] };
  }
  return { error: "No dev season with a Critic objection" };
}

// ---------------------------------------------------------------- cards per step (short: the main point only)

const amt = (n, irr) => [has(n) ? `${n} kg N/ha` : null, has(irr) ? `${irr} mm water` : null].filter(Boolean).join(" · ") || null;
const joined = (list) => (list && list.length ? list.join(" · ") : null);

function stepCards(wk, s) {
  if (s === 0) {
    const r = wk.weather || {}, cr = wk.crop || {};
    return [
      { box: "weather", tools: joined(wk.tools.weather), lines: [has(r.r3) ? `Rain next 3 days: ${r.r3} mm` : null] },
      { box: "crop", tools: joined(wk.tools.crop),
        lines: [[cr.stage ? `Stage ${cr.stage}` : null, cr.water ? `soil ${cr.water}` : null].filter(Boolean).join(" · ") || null] },
    ];
  }
  if (s === 1) return [{ box: "planner", head: "Proposes", main: wk.first && amt(wk.first.n, wk.first.irr), tools: joined(wk.tools.planner),
    lines: [wk.first && firstSentence(wk.first.reason)] }];
  if (s === 2) {
    const v = wk.review;
    const head = !v ? "No verdict" : v.verdict === "object" ? "Objects" : v.verdict === "accept" ? "Accepts" : `Verdict: ${v.verdict}`;
    return [{ box: "critic", head, lines: [v && firstSentence(v.objection)], tools: joined(wk.tools.critic) }];
  }
  if (s === 3) {
    const was = wk.first && amt(wk.first.n, wk.first.irr);
    return [{ box: "planner", head: "Revises", main: wk.revised && amt(wk.revised.n, wk.revised.irr), lines: [was ? `was ${was}` : null] }];
  }
  if (s === 4) {
    return [{ box: "coord", head: "Decides", main: wk.submit && amt(wk.submit.n, wk.submit.irr),
      lines: [wk.submit && firstSentence(wk.submit.reason)] }];
  }
  const sw = has(wk.swBefore) && has(wk.swAfter) ? `Soil water ${wk.swBefore} → ${wk.swAfter}` : null;
  return [{ box: "field", head: "One week later",
    lines: [has(wk.rain) ? `Rain ${wk.rain} mm` : null, sw, has(wk.leached) ? `N leached ${wk.leached} kg/ha` : null,
      wk.clamped ? "Clamped by the code guard" : null] }];
}

// Which diagram parts light up on each step (boxes, arrows, lines). Tool lines light only when the log has calls.
function litParts(wk, s) {
  const on = new Set();
  const agent = (b) => { on.add(b); on.add(`m:${b}`); on.add("model"); };
  const tools = (b) => { if (wk.tools[b] && wk.tools[b].length) { on.add(`t:${b}`); on.add("tools"); } };
  if (s === 0) { agent("weather"); agent("crop"); tools("weather"); tools("crop"); on.add("s:weather"); on.add("s:crop"); }
  if (s === 1) { agent("planner"); tools("planner"); on.add("s:planner"); }
  if (s === 2) { agent("critic"); tools("critic"); on.add("s:critic"); if (wk.review && wk.review.verdict === "object") on.add("obj"); }
  if (s === 3) { agent("planner"); tools("planner"); on.add("obj"); on.add("r:planner"); }
  if (s === 4) { agent("coord"); on.add("dec"); }
  if (s === 5) { on.add("field"); on.add("dec"); }
  return on;
}

// Hover: role in one line plus the box's message this week.
function hoverText(wk, key) {
  const plan = wk.revised || wk.first;
  const msg = {
    weather: wk.weather && wk.weather.summary,
    crop: wk.crop && wk.crop.summary,
    planner: plan && plan.reason,
    critic: !wk.review ? "No verdict this week." : wk.review.verdict === "accept" ? "Accept." : wk.review.objection,
    coord: wk.submit && wk.submit.reason,
    tools: ["weather", "crop", "planner", "critic"].filter((a) => wk.tools[a].length)
      .map((a) => `${NAME[a]}: ${wk.tools[a].join(", ")}`).join(" · ") || null,
    model: wk.modelCalls ? `${wk.modelCalls} model calls this week.` : null,
    field: [wk.applied && amt(wk.applied.n, wk.applied.irr) ? `Applied ${amt(wk.applied.n, wk.applied.irr)}` : null,
      has(wk.rain) ? `rain ${wk.rain} mm` : null].filter(Boolean).join(" · ") || null,
  }[key];
  return { role: ROLE[key], msg: msg || null };
}

// ---------------------------------------------------------------- diagram

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
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// One diagram part (data-on: the lit-set key). A black halo under a crossing path leaves a gap in the line below.
function line(d, cls, on, { color, marker, halo = false, dash = false } = {}) {
  const attrs = `d="${d}"${color ? ` stroke="${color}"` : ""}${dash ? ' stroke-dasharray="5 6"' : ""}`;
  return `<g class="hiw-part" data-on="${on}">${halo ? `<path class="hiw-halo" d="${d}"/>` : ""}`
    + `<path class="${cls}" ${attrs}${marker ? ` marker-end="url(#hiw-arrow-${marker})"` : ""}/></g>`;
}

// Hub <-> agent: the call arrow (accent) and the return arrow (muted), side by side. Agents are told apart by their
// name labels, not by color.
function spoke(to) {
  const hub = center(BOX.coord), dst = center(BOX[to]);
  const len = Math.hypot(dst[0] - hub[0], dst[1] - hub[1]);
  const u = [(dst[0] - hub[0]) / len, (dst[1] - hub[1]) / len], n = [-u[1], u[0]];
  const shift = (p, k) => [p[0] + n[0] * k, p[1] + n[1] * k];
  const seg = (k) => {
    const a = shift(hub, k), b = shift(dst, k);
    const p = exit(BOX.coord, a, b), q = exit(BOX[to], b, a);
    return [[p[0] + u[0] * 9, p[1] + u[1] * 9], [q[0] - u[0] * 9, q[1] - u[1] * 9]];
  };
  return line(`M${pts(seg(-6))}`, "hiw-call", `s:${to}`, { color: C.accent, marker: "call" })
    + line(`M${pts(seg(6).reverse())}`, "hiw-back", `r:${to}`, { marker: "back" });
}

function box(key, label, inner) {
  return `<g class="hiw-part hiw-node" data-on="${key}" data-box="${key}" tabindex="0" aria-label="${esc(label)}">${inner(BOX[key])}</g>`;
}

const rect = (b, cls = "") => `<rect class="hiw-box ${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/>`;
const label = (x, y, s, cls = "") => `<text class="hiw-label ${cls}" x="${x}" y="${y}" text-anchor="middle">${esc(s)}</text>`;

function agentBox(key) {
  return box(key, NAME[key], (b) => rect(b) + label(b.x + b.w / 2, b.y + b.h / 2 + 7, NAME[key]));
}

function diagramSvg() {
  const B = BOX, hub = center(B.coord);
  const markers = [["call", C.accent], ["back", C.muted], ["warn", C.warn]]
    .map(([id, c]) => `<marker id="hiw-arrow-${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7"`
      + ` orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0.8 L9 5 L0 9.2 z" style="fill:${c};stroke:none"/></marker>`)
    .join("");
  const modelMid = B.model.y + B.model.h / 2, toolsMid = B.tools.y + B.tools.h / 2, toolsBot = B.tools.y + B.tools.h;
  const wy = B.weather.y + B.weather.h / 2, cy = B.crop.y + B.crop.h / 2;

  // Model lines: one thin line from every agent to the shared model. Weather and Planner go round the outside.
  const model = [
    line(`M${pts([[B.weather.x, wy], [56, wy], [56, modelMid], [B.model.x, modelMid]])}`, "hiw-model", "m:weather"),
    line(`M${pts([[B.planner.x + B.planner.w, wy], [1356, wy], [1356, modelMid], [B.model.x + B.model.w, modelMid]])}`, "hiw-model", "m:planner"),
    line(`M${pts([[215, B.crop.y + B.crop.h], [215, B.model.y]])}`, "hiw-model", "m:crop"),
    line(`M${pts([[1005, B.critic.y + B.critic.h], [1005, B.model.y]])}`, "hiw-model", "m:critic"),
    line(`M${pts([[hub[0], B.coord.y + B.coord.h], [hub[0], B.model.y]])}`, "hiw-model", "m:coord"),
  ].join("");
  // Env tool lines (dashed) to the agents that can call env tools. Crop and Critic go round the outside.
  const tools = [
    line(`M${pts([[215, toolsBot], [215, B.weather.y]])}`, "hiw-tool", "t:weather", { dash: true }),
    line(`M${pts([[1005, toolsBot], [1005, B.planner.y]])}`, "hiw-tool", "t:planner", { dash: true }),
    line(`M${pts([[B.tools.x, toolsMid], [30, toolsMid], [30, cy], [B.crop.x, cy]])}`, "hiw-tool", "t:crop", { dash: true, halo: true }),
    line(`M${pts([[B.tools.x + B.tools.w, toolsMid], [1382, toolsMid], [1382, cy], [B.critic.x + B.critic.w, cy]])}`,
      "hiw-tool", "t:critic", { dash: true, halo: true }),
  ].join("");
  const objX = 1085;
  const objection = line(`M${pts([[objX, B.critic.y - 4], [objX, B.planner.y + B.planner.h + 9]])}`, "hiw-obj", "obj",
    { color: C.warn, marker: "warn" });
  const decision = line(`M${pts([[B.coord.x + B.coord.w + 9, hub[1]], [B.field.x - 9, hub[1]]])}`, "hiw-call", "dec",
    { color: C.accent, marker: "call", halo: true });

  const fc = B.field.x + B.field.w / 2;
  const field = box("field", "gym-DSSAT field", (b) => rect(b, "hiw-field")
    + `<g class="hiw-icon" transform="translate(${fc - 24} ${b.y + 26}) scale(2)">${DOCK_ICONS.sprout}</g>`
    + label(fc, b.y + 106, "gym-DSSAT") + label(fc, b.y + 132, "field", "hiw-label-sm"));
  const toolBox = box("tools", "Tools", (b) => rect(b)
    + label(b.x + b.w / 2, b.y + b.h / 2 + 7, "Tools · env server, port 9000"));
  const modelBox = box("model", "Nemotron 3.5 Lightning on vLLM", (b) => rect(b)
    + label(b.x + b.w / 2, b.y + b.h / 2 + 7, "Nemotron 3.5 Lightning on vLLM"));

  return `<svg class="hiw-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="One week of the FieldTwin agent team, step by step">
    <defs>${markers}
      <!-- Soft accent glow around the active boxes (the box's alpha, blurred, filled with --accent). userSpaceOnUse:
           a bounding-box filter region would clip the halo. -->
      <filter id="hiw-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur"/>
        <feFlood style="flood-color: var(--accent)" flood-opacity="0.45"/>
        <feComposite in2="blur" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${model}${tools}${["weather", "crop", "planner", "critic"].map(spoke).join("")}${objection}${decision}
    ${toolBox}${modelBox}${["weather", "crop", "planner", "critic", "coord"].map(agentBox).join("")}${field}
  </svg>`;
}

// ---------------------------------------------------------------- page

const ui = { root: null, wk: null, step: 0 };
// Card side per box: below the top row, above the bottom row; Planner and Critic cards sit to the right so the red
// objection arrow between them stays visible.
const SIDE = { weather: "below", crop: "above", planner: "right", critic: "right", coord: "below", field: "below",
  tools: "below", model: "above" };
// Card / tip edge: the accent, or --warn for the Critic in an objection week.
const tint = (key) => (key === "critic" && ui.wk && ui.wk.review && ui.wk.review.verdict === "object" ? C.warn : C.accent);

function cardHtml(c) {
  return [c.head ? `<div class="hiw-card-head">${esc(c.head)}</div>` : "",
    c.main ? `<div class="hiw-card-main mono">${esc(c.main)}</div>` : "",
    c.tools ? `<div class="hiw-card-tools mono">${esc(c.tools)}</div>` : "",
    ...(c.lines || []).filter(Boolean).map((t) => `<div class="hiw-card-line">${esc(t)}</div>`)].join("");
}

// Place an absolutely positioned el next to diagram box `key` (stage coordinates), clamped inside the stage.
function place(el, key, side, gap = 10) {
  const stage = ui.root.querySelector(".hiw-stage");
  const node = ui.root.querySelector(`[data-box="${key}"] rect`);
  if (!stage || !node) return;
  const s = stage.getBoundingClientRect(), r = node.getBoundingClientRect();
  el.style.maxWidth = "";
  if (side === "right") {
    // Narrow the card to the room right of the box; with too little room, fall back to under the box.
    const room = s.right - r.right - gap;
    if (room >= 200) el.style.maxWidth = `${Math.floor(room)}px`;
    else side = r.top - s.top > s.bottom - r.bottom ? "above" : "below";
  }
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = side === "right" ? r.right - s.left + gap : key === "field" ? r.right - s.left - w : r.left - s.left;
  let y = side === "right" ? r.top - s.top : side === "above" ? r.top - s.top - h - gap : r.bottom - s.top + gap;
  if (y < 0) y = r.bottom - s.top + gap;
  x = Math.max(0, Math.min(x, s.width - w));
  y = Math.max(0, Math.min(y, s.height - h));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

function layout() {
  if (!ui.root || !ui.wk) return;
  ui.root.querySelectorAll(".hiw-card").forEach((el) => place(el, el.dataset.for, SIDE[el.dataset.for]));
}

function render() {
  const { root, wk, step } = ui;
  const label = LIVE && step === 2 ? "Critic reviews" : STEPS[step];
  const on = litParts(wk, step);
  root.querySelectorAll(".hiw-part").forEach((el) => el.classList.toggle("dim", !on.has(el.dataset.on)));
  root.querySelector(".hiw-count").textContent = `Step ${step + 1} of ${STEPS.length}`;
  root.querySelector(".hiw-step-label").textContent = label;
  root.querySelectorAll(".hiw-pill").forEach((b, i) => b.classList.toggle("on", i === step));
  root.querySelector(".hiw-back").disabled = step === 0;
  root.querySelector(".hiw-next").disabled = step === STEPS.length - 1;
  root.querySelector(".hiw-pops").innerHTML = stepCards(wk, step)
    .map((c) => `<div class="hiw-card" data-for="${c.box}" style="--c:${tint(c.box)}">${cardHtml(c)}</div>`).join("");
  layout();
}

function showTip(key) {
  const tip = ui.root.querySelector(".hiw-tip");
  const { role, msg } = hoverText(ui.wk, key);
  tip.style.setProperty("--c", tint(key));
  tip.innerHTML = `<div class="hiw-tip-role">${esc(role)}</div>${msg ? `<div class="hiw-tip-msg">${esc(msg)}</div>` : ""}`;
  tip.hidden = false;
  place(tip, key, SIDE[key] === "above" ? "below" : "above", 8);
}

function hideTip() {
  const tip = ui.root && ui.root.querySelector(".hiw-tip");
  if (tip) tip.hidden = true;
}

// Back / Next and the arrow keys (main.js) call this.
export function howStep(delta) {
  if (!ui.wk || LIVE) return;   // live: the steps follow the running season
  const next = Math.max(0, Math.min(STEPS.length - 1, ui.step + delta));
  if (next === ui.step) return;
  ui.step = next;
  hideTip();
  render();
}

// Live step from what the week's log already has: the furthest stage reached.
function liveStep(wk) {
  if (has(wk.rain)) return 5;
  if (wk.submit) return 4;
  if (wk.revised) return 3;
  if (wk.review) return 2;
  if (wk.first) return 1;
  return 0;
}

let live = { k: -1, step: -1, shownAt: 0, done: false };

async function livePoll() {
  const task = LIVE;
  const run = await data.loadLiveRun(CONFIG, task);
  if (task !== LIVE || !ui.root) return;   // switched seasons while loading
  const sub = ui.root.querySelector(".hiw-sub");
  if (!run || run instanceof data.LoadError) {
    sub.textContent = `LIVE · ${LIVE} · waiting for the season to start (press Play on the Season page)`;
    return;
  }
  let k = run.weeks.reduce((m, w, i) => (w.events.length ? i : m), 0);
  if (run.final && k === run.W) k = run.W - 1;   // the harvest line: stay on the last decision week
  if (live.k >= 0 && k > live.k) {
    if (live.step < 5) k = live.k;                                         // first show the week's field step
    else if (performance.now() - live.shownAt < HOLD_MS) return;           // then hold it a moment
  }
  const wk = readWeek(run, k);
  const target = liveStep(wk);
  let step = target;
  if (k === live.k && target > live.step) {
    if (performance.now() - live.shownAt < STAGE_MS) return;   // let the current card be read first
    step = live.step + 1;
    if (step === 3 && !wk.revised) step = 4;
  } else if (k !== live.k) {
    step = 0;                                   // a new week starts from the data-gathering stage
  }
  if (k !== live.k || step !== live.step) {
    live.k = k; live.step = step; live.shownAt = performance.now();
    ui.wk = wk; ui.step = step;
    render();
  }
  const f = run.final;
  sub.textContent = f
    ? `LIVE · ${LIVE} · season done: score $${Math.round(f.reward).toLocaleString("en-US")}/ha, grain ${Math.round(f.grain_kg_ha).toLocaleString("en-US")} kg/ha, `
      + `water ${Math.round(f.irr_mm)} mm, N ${Math.round(f.n_applied)} kg/ha`
    : `LIVE · ${LIVE} · Week ${k + 1} · ${wk.modelCalls} model calls this week so far`;
  if (f && !live.done) live.done = true;
}

// Built once, on first visit; later visits only re-place the cards (the stage size may have changed while hidden).
export async function renderHowItWorks(root) {
  if (root.dataset.built) { requestAnimationFrame(layout); return; }
  root.dataset.built = "1";
  ui.root = root;
  if (LIVE) return renderLive(root);
  root.innerHTML = `<header class="hiw-head"><h1>How it works</h1><p class="hiw-sub">Loading the week…</p></header>`;
  const pick = await pickWeek();
  if (pick.error) {
    root.querySelector(".hiw-sub").textContent = pick.error;
    return;
  }
  ui.wk = readWeek(pick.run, pick.k);
  if (ui.wk.missing.length) console.info("How it works: not in the log:", ui.wk.missing.join(", "));
  root.innerHTML = `<header class="hiw-head">
      <h1>How it works</h1>
      <p class="hiw-sub mono">${esc(ui.wk.split || "dev")} · ${esc(ui.wk.task)} · Week ${ui.wk.k + 1}</p>
    </header>
    <div class="hiw-bar">
      <button class="btn hiw-back" aria-label="Previous step">&lsaquo; Back</button>
      <span class="hiw-count mono"></span><span class="hiw-step-label"></span>
      <button class="btn hiw-next" aria-label="Next step">Next &rsaquo;</button>
      <div class="hiw-pills">${STEPS.map((s, i) => `<button class="hiw-pill" data-step="${i}">${i + 1} ${esc(s)}</button>`).join("")}</div>
    </div>
    <div class="hiw-stage">${diagramSvg()}<div class="hiw-pops" aria-live="polite"></div><div class="hiw-tip" role="tooltip" hidden></div></div>`;
  root.querySelector(".hiw-back").onclick = () => howStep(-1);
  root.querySelector(".hiw-next").onclick = () => howStep(1);
  root.querySelectorAll(".hiw-pill").forEach((b) => (b.onclick = () => howStep(+b.dataset.step - ui.step)));
  root.querySelectorAll(".hiw-node").forEach((g) => {
    g.addEventListener("pointerenter", () => showTip(g.dataset.box));
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("focus", () => showTip(g.dataset.box));
    g.addEventListener("blur", hideTip);
  });
  new ResizeObserver(layout).observe(root.querySelector(".hiw-stage"));
  render();
}

function renderLive(root) {
  root.innerHTML = `<header class="hiw-head">
      <h1>How it works <span class="badge live-badge">LIVE</span></h1>
      <p class="hiw-sub mono">LIVE · ${esc(LIVE)} · connecting…</p>
    </header>
    <div class="hiw-bar">
      <span class="hiw-count mono"></span><span class="hiw-step-label"></span>
      <button class="btn hiw-back" hidden></button><button class="btn hiw-next" hidden></button>
      <div class="hiw-pills">${STEPS.map((s, i) => `<span class="hiw-pill" data-step="${i}">${i + 1} ${esc(i === 2 ? "Critic reviews" : s)}</span>`).join("")}</div>
    </div>
    <div class="hiw-stage">${diagramSvg()}<div class="hiw-pops" aria-live="polite"></div><div class="hiw-tip" role="tooltip" hidden></div></div>`;
  root.querySelectorAll(".hiw-node").forEach((g) => {
    g.addEventListener("pointerenter", () => ui.wk && showTip(g.dataset.box));
    g.addEventListener("pointerleave", hideTip);
  });
  new ResizeObserver(layout).observe(root.querySelector(".hiw-stage"));
  livePoll();
  liveTimer = setInterval(livePoll, POLL_MS);
}

// The Season page picked a season: a live one (task id) turns live mode on, null turns it off. The page is rebuilt
// on the next visit, or right away when it is already built.
export function setLiveTask(task) {
  if (task === LIVE) return;
  LIVE = task;
  clearInterval(liveTimer);
  liveTimer = null;
  live = { k: -1, step: -1, shownAt: 0, done: false };
  const root = ui.root;
  if (!root || !root.dataset.built) return;
  delete root.dataset.built;
  ui.wk = null; ui.step = 0;
  if (!root.closest("[hidden]")) renderHowItWorks(root);
}
