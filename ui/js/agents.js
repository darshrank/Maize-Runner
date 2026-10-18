// Agent text. weekLines feeds the 2D Season fallback (?view2d=1): the week's reason (the Coordinator's, or the
// policy's for non-LLM configs) and, in a week where the Critic objects, the objection as one orange line.
// chatHtml renders the full weekly chat on the Agents page (R2): decision, every message in log order (Critic
// objections in orange), fallbacks, and the tool calls collapsed under <details>. Message text is basic markdown
// (mdHtml: bold, italics, lists, line breaks) rendered after every character is HTML-escaped.

import { AGENT_NAMES } from "./data.js";

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// Inline markdown on already-escaped text: **bold** / __bold__, *italics* / _italics_ (not inside words).
function mdInline(s) {
  return s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<b>$2</b>")
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, "$1<i>$2</i>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, "$1<i>$2</i>");
}

// Basic markdown -> HTML. The whole text is escaped first, so no tag from the log survives; only <b>, <i>, <ul>,
// <ol>, <li> and <br> are produced here. List lines start with "- ", "* ", "+ " or "1. "; other lines join with <br>.
export function mdHtml(text) {
  const lines = esc(String(text).replace(/\r\n?/g, "\n").trim()).split("\n");
  let html = "", list = null, para = [];
  const flushPara = () => { if (para.length) html += para.map(mdInline).join("<br>"); para = []; };
  const closeList = () => { if (list) html += `</${list}>`; list = null; };
  for (const line of lines) {
    const m = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (m) {
      const kind = m[1] ? "ul" : "ol";
      flushPara();
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li>${mdInline(m[3])}</li>`;
    } else if (!line.trim()) {
      closeList();
      flushPara();
      if (html && !/(<br>|<\/[uo]l>)$/.test(html)) html += "<br>";
    } else {
      closeList();
      para.push(line);
    }
  }
  closeList();
  flushPara();
  return html.replace(/(<br>)+$/, "");
}

// Plain text for one-line places (week cards): markdown markers removed, whitespace collapsed.
export function mdPlain(text) {
  return String(text).replace(/\*\*|__/g, "").replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*/g, "$1$2")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
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
    who: !run.hasAgents ? "Schedule" : run.weeks.some((x) => x.messages.coordinator) ? AGENT_NAMES.coordinator : AGENT_NAMES.policy,
    reason: w.decision ? w.decision.reason || null : null,
    fallback: w.fallback,
  };
}

function toolText(v) {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

// Full chat for one run and week, in log order.
export function chatHtml(run, k) {
  if (!run) return `<div class="quiet">No run for this season.</div>`;
  const w = run.weeks[Math.min(k, run.W)];
  if (!w || w.harvest) return `<div class="quiet">Harvest: no decision this week.</div>`;
  const d = w.decision;
  const card = d ? `<div class="chat-decision">Apply <b class="n">${fmt(d.n_kg_ha, 0)} kg N/ha</b>, `
    + `<b class="water">${fmt(d.irr_mm, 0)} mm</b> water.</div>` : "";
  if (!run.hasAgents) {
    return card + (d && d.reason ? `<div class="bubble policy"><span class="who">Schedule</span><div class="md">${mdHtml(d.reason)}</div></div>` : "")
      + `<div class="quiet">No agent chat: fixed policy.</div>`;
  }
  const items = w.chat.map((m) => `<div class="bubble ${m.agent}${m.objection ? " objection" : ""}">`
    + `<span class="who">${esc(AGENT_NAMES[m.agent] || m.agent)}${m.objection ? " · objection" : ""}</span>`
    + `<div class="md">${mdHtml(m.text)}</div></div>`);
  const tools = w.tools.map((t) => `<details class="tool"><summary><span class="who ${esc(t.agent)}">${esc(AGENT_NAMES[t.agent] || t.agent)}</span>${esc(t.name || "tool")}</summary>`
    + `<pre>${esc(toolText(t.args))}\n→ ${esc(toolText(t.result))}</pre></details>`).join("");
  const falls = w.fallbacks.map((f) => `<div class="bubble fallback"><span class="who">Fallback</span><div class="md">${mdHtml(f.why)}</div></div>`).join("");
  return card + items.join("") + falls
    + (tools ? `<div class="tools"><span class="label">Tool calls (${w.tools.length})</span>${tools}</div>` : "");
}
