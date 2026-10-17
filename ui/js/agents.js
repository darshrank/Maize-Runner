// Agent text (R1). Under each field: one line with the week's reason (the Coordinator's, or the policy's for
// non-LLM configs) and, in a week where the Critic objects, the objection as one orange line above it.
// The full chat (Weather, Crop, Planner, Critic, Coordinator, tool calls) sits behind a toggle (key A).

import { AGENT_NAMES } from "./data.js";

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function fmt(v, digits = 0) {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "n/a";
}

// {objection: text|null, who, reason: text|null, fallback: bool} for one field and week.
export function weekLines(run, k) {
  const w = run && run.weeks[Math.min(k, run.W)];
  if (!w || w.harvest) return { objection: null, who: null, reason: null, fallback: false };
  const obj = w.chat.find((m) => m.objection);
  return {
    objection: obj ? obj.text || "Critic objected" : null,
    who: run.hasAgents ? AGENT_NAMES.coordinator : "Schedule",
    reason: w.decision ? w.decision.reason || null : null,
    fallback: w.fallback,
  };
}

function toolText(v) {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

// Full chat for one field and week, in log order.
export function chatHtml(run, label, k) {
  const head = `<div class="chat-head"><span class="chat-title">${esc(label)}</span></div>`;
  if (!run) return head + `<div class="quiet">No log for this season.</div>`;
  const w = run.weeks[Math.min(k, run.W)];
  if (!w || w.harvest) return head + `<div class="quiet">Harvest: no decision this week.</div>`;
  const d = w.decision;
  const card = d ? `<div class="chat-decision">Apply <b class="n">${fmt(d.n_kg_ha, 0)} kg N/ha</b>, `
    + `<b class="water">${fmt(d.irr_mm, 0)} mm</b> water.</div>` : "";
  if (!run.hasAgents) {
    return head + card + (d && d.reason ? `<div class="bubble policy"><span class="who">Schedule</span>${esc(d.reason)}</div>` : "")
      + `<div class="quiet">No agent chat: fixed policy.</div>`;
  }
  const items = w.chat.map((m) => `<div class="bubble ${m.agent}${m.objection ? " objection" : ""}">`
    + `<span class="who">${esc(AGENT_NAMES[m.agent] || m.agent)}</span>${esc(m.text)}</div>`);
  const tools = w.tools.map((t) => `<details class="tool"><summary><span class="who ${esc(t.agent)}">${esc(AGENT_NAMES[t.agent] || t.agent)}</span>${esc(t.name || "tool")}</summary>`
    + `<pre>${esc(toolText(t.args))}\n→ ${esc(toolText(t.result))}</pre></details>`).join("");
  const falls = w.fallbacks.map((f) => `<div class="bubble fallback"><span class="who">Fallback</span>${esc(f.why)}</div>`).join("");
  return head + card + items.join("") + falls + (tools ? `<div class="tools">${tools}</div>` : "");
}
