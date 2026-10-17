// Agent panel. Unit 1 keeps the old viewer's decision "stamp": the week's final decision (coordinator wins
// over the runner's policy line, see data.js), its reason, and objection / fallback flags. The full chat
// (Weather, Crop, Planner, Critic, Coordinator bubbles, tool chips) is UI_SPEC.md step 3.

import { AGENT_NAMES } from "./data.js";

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function fmt(v, digits = 0) {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "n/a";
}

export function decisionHtml(run, week) {
  if (!run) return `<div class="quiet">No log for this season.</div>`;
  const w = run.weeks[week];
  if (!w) return `<div class="quiet">No data for this week.</div>`;
  if (w.harvest) {
    return `<div class="card-head"><span class="label">Harvest</span><span class="label">final line</span></div>`
      + `<div class="quiet">Yield, profit and reward are in the counters below.</div>`;
  }
  const d = w.decision;
  const who = run.hasAgents ? AGENT_NAMES.coordinator : "Policy";
  const flags = (w.objection ? `<span class="flag critic">Critic objected</span>` : "")
    + (w.fallback ? `<span class="flag fallback">Fallback</span>` : "")
    + (w.clamped ? `<span class="flag">Clamped by env</span>` : "");
  const objection = w.chat.filter((m) => m.objection).map((m) => `<div class="objection">${esc(m.text)}</div>`).join("");
  const fallbacks = w.fallbacks.map((f) => `<div class="fallback-why">${esc(f.why)}</div>`).join("");
  return `<div class="card-head"><span class="label">Week ${week} decision</span><span class="label who">${who}</span></div>`
    + (d ? `<div class="pair">`
      + `<div class="kv"><span class="big n">${fmt(d.n_kg_ha, 0)}</span><span class="unit">kg N/ha</span></div>`
      + `<div class="kv"><span class="big w">${fmt(d.irr_mm, 0)}</span><span class="unit">mm water</span></div></div>`
      : `<div class="quiet">No decision logged this week.</div>`)
    + (flags ? `<div class="flags">${flags}</div>` : "")
    + (d && d.reason ? `<div class="reason">${esc(d.reason)}</div>` : "")
    + objection + fallbacks;
}
