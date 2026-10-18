// Serving (page 4): vLLM serving metrics from results/vllm_metrics.json (data.loadVllmMetrics; Lane C schema in
// STATE.md: {vllm_version, model, measured_at, rows: [{parallel, setting, split, seasons_per_hour, p50_ms, p99_ms,
// prefix_cache_hit_rate, peak_running, calls, fallbacks, seasons, ...}]}). Two settings: "dedicated H100, controlled
// run" (the S3 sweep) and "shared server" (recorded dev logs).
// Layout: one headline (the throughput gain), one hero (that gain, computed from the dedicated rows' seasons per hour
// at the lowest and highest parallel level, with the chart of every level, all points labeled), table A (dedicated)
// and table B (shared server), then "This run" when a live season is running or done: model calls, p50 / p99
// latency and tokens computed from the live log's message events (latency_s, usage). The live log does not record
// the server, so that panel says "server not recorded". Every number comes from a file; nothing is filled in. A
// shared-server row with every metric null is hidden and named in a footnote; other nulls read "not measured".
// cached_prompt_share is not shown: in vLLM 0.27.1 it is the same token count as the prefix-cache hit rate.

import * as data from "./data.js";
import { esc } from "./agents.js";

const DEDICATED = "dedicated H100, controlled run";
const SHARED = "shared server";
const NA = "not measured";

const num = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// Table columns: key, header, formatter. The same keys decide whether a row is all null.
const COLS = [
  { key: "parallel", head: "Parallel", f: (v) => fmt(v) },
  { key: "seasons_per_hour", head: "Seasons/h", f: (v) => fmt(v, 2) },
  { key: "p50_ms", head: "p50 (ms)", f: (v) => fmt(v) },
  { key: "p99_ms", head: "p99 (ms)", f: (v) => fmt(v) },
  { key: "prefix_cache_hit_rate", head: "Cache hits", f: (v) => `${fmt(v * 100, 1)}%` },
  { key: "peak_running", head: "Peak running", f: (v) => fmt(v) },
  { key: "calls", head: "Calls", f: (v) => fmt(v) },
  { key: "fallbacks", head: "Fallbacks", f: (v) => fmt(v) },
];
const METRICS = COLS.filter((c) => c.key !== "parallel").map((c) => c.key);

let cached = null;

// "1", "1 and 32", "1, 8 and 32".
function andList(xs) {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function rowsFor(m, setting) {
  return (Array.isArray(m.rows) ? m.rows : [])
    .filter((r) => r && r.setting === setting && num(r.parallel))
    .sort((a, b) => a.parallel - b.parallel);
}

function table(title, rows) {
  const splits = [...new Set(rows.map((r) => r.split).filter(Boolean))];
  const head = COLS.map((c) => `<th${c.key === "parallel" ? "" : ' class="num"'}>${esc(c.head)}</th>`).join("");
  const body = rows.map((r) => `<tr>${COLS.map((c) => num(r[c.key])
    ? `<td class="num mono">${esc(c.f(r[c.key]))}</td>`
    : `<td class="num na">${NA}</td>`).join("")}</tr>`).join("");
  return `<section class="srv-card card"><h2 class="srv-h2">${esc(title)}${splits.map((s) => `<span class="badge split">${esc(s)}</span>`).join("")}</h2>`
    + `<div class="srv-scroll"><table class="srv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// Line chart: seasons per hour (y, from 0) vs configured parallel level (x, linear from 0), dedicated rows only.
// Every point carries its value (no hover needed).
function chart(pts) {
  const W = 760, H = 270, L = 64, R = 30, T = 30, B = 56;
  const xMax = Math.max(...pts.map((p) => p.parallel));
  const yTop = Math.max(...pts.map((p) => p.seasons_per_hour));
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => yTop / s <= 5) || Math.ceil(yTop / 5);
  const yMax = Math.ceil(yTop / step) * step;
  const x = (v) => L + (v / xMax) * (W - L - R);
  const y = (v) => H - B - (v / yMax) * (H - T - B);
  const yTicks = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);
  const grid = yTicks.map((v) => `<line class="srv-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`
    + `<text class="srv-tick" x="${L - 10}" y="${y(v) + 5}" text-anchor="end">${fmt(v)}</text>`).join("");
  const xTicks = pts.map((p) => `<text class="srv-tick" x="${x(p.parallel)}" y="${H - B + 26}" text-anchor="middle">${fmt(p.parallel)}</text>`).join("");
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.parallel).toFixed(1)},${y(p.seasons_per_hour).toFixed(1)}`).join("");
  const last = pts.length - 1;
  const marks = pts.map((p, i) => {
    const cx = x(p.parallel), cy = y(p.seasons_per_hour);
    const anchor = i === last ? "end" : i === 0 ? "start" : "middle";
    return `<circle class="srv-dot" cx="${cx}" cy="${cy}" r="6"/>`
      + `<text class="srv-val" x="${cx + (i === 0 ? 6 : 0)}" y="${cy - 16}" text-anchor="${anchor}">${fmt(p.seasons_per_hour, 2)}</text>`;
  }).join("");
  return `<div class="srv-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Seasons per hour by parallel level, ${esc(DEDICATED)}">`
    + grid
    + `<line class="srv-axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`
    + xTicks
    + `<text class="srv-axis-label" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">Seasons running at once (parallel)</text>`
    + `<text class="srv-axis-label" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Seasons per hour</text>`
    + `<path class="srv-line" d="${line}"/>${marks}</svg></div>`;
}

// "Parallel 8 and 20 each ran one wave of seasons; parallel 1 ran 2 seasons." from seasons vs parallel.
function runsNote(rows) {
  const r = rows.filter((x) => num(x.seasons));
  const waves = r.filter((x) => x.parallel > 1 && x.seasons === x.parallel).map((x) => fmt(x.parallel));
  const parts = [];
  if (waves.length) parts.push(`Parallel ${andList(waves)} ${waves.length > 1 ? "each ran" : "ran"} one wave of seasons`);
  r.filter((x) => !(x.parallel > 1 && x.seasons === x.parallel)).forEach((x) =>
    parts.push(`${parts.length ? "parallel" : "Parallel"} ${fmt(x.parallel)} ran ${fmt(x.seasons)} season${x.seasons === 1 ? "" : "s"}`));
  return parts.length ? `${parts.join("; ")}.` : "";
}

// Model id -> words: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16" -> "NVIDIA Nemotron 3.5 Lightning 30B A3B BF16".
function modelWords(id) {
  return typeof id === "string" && id ? id.split("/").pop().replace(/-/g, " ") : null;
}

// Linear-interpolated quantile of a sorted array.
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// This live run, from its log: message events with latency_s (one per model call) and their usage tokens.
// null when the log has no latency_s (then the panel is skipped).
export function liveRunStats(run) {
  if (!run) return null;
  const msgs = run.weeks.flatMap((w) => w.events).filter((e) => e.kind === "message" && e.data && num(e.data.latency_s));
  if (!msgs.length) return null;
  const lat = msgs.map((e) => e.data.latency_s).sort((a, b) => a - b);
  const usage = msgs.map((e) => e.data.usage).filter((u) => u && num(u.prompt_tokens) && num(u.completion_tokens));
  return {
    calls: msgs.length, p50: quantile(lat, 0.5), p99: quantile(lat, 0.99),
    prompt: usage.length ? usage.reduce((a, u) => a + u.prompt_tokens, 0) : null,
    completion: usage.length ? usage.reduce((a, u) => a + u.completion_tokens, 0) : null,
    usageCalls: usage.length,
  };
}

function livePanel(run, st) {
  const cell = (v, k) => `<div class="t"><span class="v mono">${v}</span><span class="k">${esc(k)}</span></div>`;
  const tok = (v) => (v === null ? "not in log" : fmt(v));
  return `<section class="srv-live card"><div class="t"><span class="srv-h2">This run <span class="badge split">${esc(`${run.year || ""} live`.trim())}</span></span>`
    + `<span class="k">server not recorded · computed from the live log</span></div>`
    + cell(fmt(st.calls), "model calls")
    + cell(`${fmt(st.p50, 1)} s`, "p50 latency per call")
    + cell(`${fmt(st.p99, 1)} s`, "p99 latency per call")
    + cell(tok(st.prompt), "prompt tokens")
    + cell(tok(st.completion), "output tokens")
    + `</section>`;
}

function empty(el) {
  el.innerHTML = `<div class="srv-empty"><span class="label">Serving</span>`
    + `<span class="srv-empty-text">No serving metrics found. Run lanec/scripts/vllm_metrics.py.</span></div>`;
}

// liveRun: the Maize Runner team's live run (main.js), or null.
export async function renderServing(el, liveRun = null) {
  const m = cached || await data.loadVllmMetrics();
  if (!m || m instanceof data.LoadError || !Array.isArray(m.rows)) return empty(el);
  cached = m;

  const ded = rowsFor(m, DEDICATED);
  const shared = rowsFor(m, SHARED);
  const sharedShown = shared.filter((r) => METRICS.some((k) => num(r[k])));
  const sharedHidden = shared.filter((r) => !METRICS.some((k) => num(r[k]))).map((r) => fmt(r.parallel));
  const pts = ded.filter((r) => num(r.seasons_per_hour));
  const lo = pts[0], hi = pts[pts.length - 1];
  const gain = pts.length >= 2 && lo.seasons_per_hour > 0 ? hi.seasons_per_hour / lo.seasons_per_hour : null;
  const splits = [...new Set(ded.map((r) => r.split).filter(Boolean))];
  const model = modelWords(m.model);

  const notes = [];
  if (sharedHidden.length) notes.push(`Shared-server level${sharedHidden.length > 1 ? "s" : ""} ${andList(sharedHidden)} ${sharedHidden.length > 1 ? "were" : "was"} not run.`);
  const runs = runsNote(ded);
  if (runs) notes.push(runs);
  notes.push("Peak running comes from /metrics polls every 15 s. Shared-server p99 includes contention from other jobs on that server.");

  const st = liveRunStats(liveRun);
  el.innerHTML = `<header class="page-head"><div class="head">`
    + `<h1>${gain !== null ? `${fmt(gain, 1)}x more seasons per hour` : "Serving metrics"}</h1>`
    + `<p class="sub">${[model && `${esc(model)} on vLLM ${esc(m.vllm_version || "")}`.trim(), esc(DEDICATED), splits.length ? `${esc(splits.join(", "))} seasons` : ""]
      .filter(Boolean).join(" · ")}</p></div></header>`
    + (gain !== null ? `<section class="srv-hero card"><div>`
      + `<div class="srv-big big-num">${fmt(gain, 1)}x</div>`
      + `<div class="srv-what">Throughput, parallel ${fmt(lo.parallel)} → ${fmt(hi.parallel)}</div>`
      + `<div class="srv-range"><b>${fmt(lo.seasons_per_hour, 2)}</b> → <b>${fmt(hi.seasons_per_hour, 2)}</b> seasons per hour</div>`
      + `</div>${chart(pts)}</section>` : "")
    + `<div class="srv-tables">${ded.length ? table("Dedicated H100, controlled run", ded) : ""}`
    + `${sharedShown.length ? table("Shared server", sharedShown) : ""}</div>`
    + (st ? livePanel(liveRun, st) : "")
    + `<footer class="srv-notes">${notes.map((t) => `<p>${esc(t)}</p>`).join("")}</footer>`;
  if (liveRun && !st) console.info("Serving: the live log has no latency_s on its messages; This run panel skipped.");
  else if (st && st.usageCalls < st.calls) console.info(`Serving: usage tokens missing on ${st.calls - st.usageCalls} of ${st.calls} live calls.`);
}
