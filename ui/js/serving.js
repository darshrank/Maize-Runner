// Serving (page 5): vLLM serving metrics from results/vllm_metrics.json (data.loadVllmMetrics; Lane C schema in
// STATE.md: {vllm_version, model, measured_at, rows: [{parallel, setting, split, seasons_per_hour, p50_ms, p99_ms,
// prefix_cache_hit_rate, peak_running, calls, fallbacks, seasons, ...}]}). Two settings: "dedicated H100, controlled
// run" (the S3 sweep) and "shared server" (recorded dev logs). Top to bottom: title + split badge, one line chart
// (seasons per hour vs configured parallel level, dedicated rows only), one callout (highest / lowest dedicated level),
// one table per setting, footnotes. Every number comes from the file; nothing is filled in. A shared-server row with
// every metric null is hidden and named in a footnote; other nulls read "not measured". cached_prompt_share is not
// shown: in vLLM 0.27.1 it is the same token count as the prefix-cache hit rate. Missing or failed file: empty state.

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
  { key: "p50_ms", head: "p50 ms", f: (v) => fmt(v) },
  { key: "p99_ms", head: "p99 ms", f: (v) => fmt(v) },
  { key: "prefix_cache_hit_rate", head: "Prefix-cache hit rate", f: (v) => `${fmt(v * 100, 1)}%` },
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
  const head = COLS.map((c) => `<th${c.key === "parallel" ? "" : ' class="num"'}>${esc(c.head)}</th>`).join("");
  const body = rows.map((r) => `<tr>${COLS.map((c) => num(r[c.key])
    ? `<td class="num mono">${esc(c.f(r[c.key]))}</td>`
    : `<td class="num na">${NA}</td>`).join("")}</tr>`).join("");
  return `<section class="srv-card"><h2 class="srv-h2">${esc(title)}</h2>`
    + `<div class="srv-scroll"><table class="srv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// Line chart: seasons per hour (y, from 0) vs configured parallel level (x, linear from 0), dedicated rows only.
function chart(pts) {
  const W = 760, H = 250, L = 64, R = 24, T = 20, B = 52;
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
  const xTicks = pts.map((p) => `<text class="srv-tick" x="${x(p.parallel)}" y="${H - B + 24}" text-anchor="middle">${fmt(p.parallel)}</text>`).join("");
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.parallel).toFixed(1)},${y(p.seasons_per_hour).toFixed(1)}`).join("");
  const last = pts.length - 1;
  const marks = pts.map((p, i) => {
    const cx = x(p.parallel), cy = y(p.seasons_per_hour);
    const tip = `Parallel ${fmt(p.parallel)}: ${fmt(p.seasons_per_hour, 2)} seasons/h`;
    // Direct labels on the first and last point only; hover / focus shows every point.
    const lab = i === 0 || i === last
      ? `<text class="srv-val" x="${cx}" y="${cy - 14}" text-anchor="${i === last ? "end" : "start"}">${fmt(p.seasons_per_hour, 2)}</text>` : "";
    return `<g class="srv-pt" tabindex="0" data-tip="${esc(tip)}" data-x="${cx}" data-y="${cy}">`
      + `<circle class="srv-hit" cx="${cx}" cy="${cy}" r="18"/><circle class="srv-dot" cx="${cx}" cy="${cy}" r="5"/>${lab}</g>`;
  }).join("");
  return `<section class="srv-card srv-chart"><div class="srv-chart-head"><h2 class="srv-h2">Seasons per hour vs parallel level</h2>`
    + `<span class="quiet">${esc(DEDICATED)}</span></div>`
    + `<div class="srv-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Seasons per hour by configured parallel level, ${esc(DEDICATED)}">`
    + grid
    + `<line class="srv-axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`
    + xTicks
    + `<text class="srv-axis-label" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Configured parallel level</text>`
    + `<text class="srv-axis-label" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Seasons per hour</text>`
    + `<path class="srv-line" d="${line}"/>${marks}</svg><div class="srv-tip" hidden></div></div></section>`;
}

function wireTips(root) {
  const plot = root.querySelector(".srv-plot");
  if (!plot) return;
  const svg = plot.querySelector("svg"), tip = plot.querySelector(".srv-tip");
  const show = (g) => {
    const s = svg.getBoundingClientRect(), k = s.width / svg.viewBox.baseVal.width;
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${+g.dataset.x * k}px`;
    tip.style.top = `${+g.dataset.y * k}px`;
  };
  const hide = () => (tip.hidden = true);
  plot.querySelectorAll(".srv-pt").forEach((g) => {
    g.addEventListener("pointerenter", () => show(g));
    g.addEventListener("pointerleave", hide);
    g.addEventListener("focus", () => show(g));
    g.addEventListener("blur", hide);
  });
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

function empty(el) {
  el.innerHTML = `<div class="srv-empty"><span class="label">Serving</span>`
    + `<span class="srv-empty-text">No serving metrics found. Run lanec/scripts/vllm_metrics.py.</span></div>`;
}

export async function renderServing(el) {
  const m = cached || await data.loadVllmMetrics();
  if (!m || m instanceof data.LoadError || !Array.isArray(m.rows)) return empty(el);
  cached = m;

  const ded = rowsFor(m, DEDICATED);
  const shared = rowsFor(m, SHARED);
  const sharedShown = shared.filter((r) => METRICS.some((k) => num(r[k])));
  const sharedHidden = shared.filter((r) => !METRICS.some((k) => num(r[k]))).map((r) => fmt(r.parallel));
  const splits = [...new Set(m.rows.map((r) => r && r.split).filter(Boolean))];

  const pts = ded.filter((r) => num(r.seasons_per_hour));
  let callout = "";
  if (pts.length >= 2 && pts[0].seasons_per_hour > 0) {
    const lo = pts[0], hi = pts[pts.length - 1];
    const n = hi.seasons_per_hour / lo.seasons_per_hour;
    callout = `<section class="srv-callout"><span class="srv-callout-n mono">${fmt(n, 1)}x</span>`
      + `<span>seasons per hour from parallel ${fmt(lo.parallel)} to parallel ${fmt(hi.parallel)}</span>`
      + `<span class="quiet">${esc(DEDICATED)}</span></section>`;
  }

  const notes = [];
  if (sharedHidden.length) notes.push(`Shared-server level${sharedHidden.length > 1 ? "s" : ""} ${andList(sharedHidden)} ${sharedHidden.length > 1 ? "were" : "was"} not run.`);
  const runs = runsNote(ded);
  if (runs) notes.push(runs);
  notes.push("Peak running comes from /metrics polls every 15 s.");
  notes.push("Shared-server p99 includes contention from other jobs on that server.");

  el.innerHTML = `<header class="srv-head"><h1>Serving</h1>${splits.map((s) => `<span class="badge">${esc(s)}</span>`).join("")}</header>`
    + (pts.length ? chart(pts) : "")
    + callout
    + (ded.length ? table("Dedicated H100, controlled run", ded) : "")
    + (sharedShown.length ? table("Shared server", sharedShown) : "")
    + `<footer class="srv-notes">${notes.map((t) => `<p>${esc(t)}</p>`).join("")}</footer>`;
  wireTips(el);
}
