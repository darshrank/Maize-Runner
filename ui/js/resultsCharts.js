// Headline charts for the Results page (A's demo results, agents_a/demo_results.json, built by
// scripts/build_demo_results.py from the committed eval.csv files). Plain SVG strings; colors come from the
// style.css tokens through CSS classes (farmer = --muted, FieldTwin team = --accent, water = --water,
// leaching = --leach, failures = --warn), so they follow the theme. Score = the env's reward (USD/ha per season).

const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const signed = (v) => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 1. Held-out test, one site: vertical bars (farmer, single agent, team) and the hindsight ceiling as a dashed line.
export function headlineChart(test) {
  const bars = [
    { label: "Farmer practice", value: test.farmer, cls: "c-farmer" },
    ...(test.single ? [{ label: "Single agent", value: test.single, cls: "c-single" }] : []),
    { label: "FieldTwin team", value: test.team, cls: "c-team" },
  ];
  const W = 560, H = 300, top = 30, bottom = 46, left = 16, right = 150;
  const max = Math.max(test.hindsight, ...bars.map((b) => b.value)) * 1.12;
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left - right) / bars.length, bw = slot * 0.56;
  const svgBars = bars.map((b, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    // Value inside the bar top, so the hindsight line never crosses it.
    return `<rect class="${b.cls}" x="${x}" y="${y(b.value)}" width="${bw}" height="${y(0) - y(b.value)}" rx="4"/>`
      + `<text class="v in" x="${x + bw / 2}" y="${y(b.value) + 24}" text-anchor="middle">${money(b.value)}</text>`
      + `<text class="l" x="${x + bw / 2}" y="${H - 18}" text-anchor="middle">${escapeText(b.label)}</text>`;
  }).join("");
  const hy = y(test.hindsight);
  const ceiling = `<line class="ceiling" x1="${left}" x2="${W - right + 8}" y1="${hy}" y2="${hy}"/>`
    + `<text class="l" x="${W - right + 14}" y="${hy + 4}">Hindsight ${money(test.hindsight)}</text>`
    + `<text class="l dim" x="${W - right + 14}" y="${hy + 20}">(best fixed plan,</text>`
    + `<text class="l dim" x="${W - right + 14}" y="${hy + 34}">weather known)</text>`;
  const d = test.team_vs_farmer;
  return `<div class="chart-card mb-card"><div class="chart-title">${escapeText(test.label)}</div>`
    + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean score per season on held-out test seasons">`
    + `<line class="axis" x1="${left}" x2="${W - right + 8}" y1="${y(0)}" y2="${y(0)}"/>${svgBars}${ceiling}</svg>`
    + `<div class="chart-caption"><b class="t-team">${signed(d.mean_diff)}/ha</b> vs farmer practice `
    + `(95% CI ±${Math.round(d.ci95)}) · ahead in <b>${d.wins} of ${d.seasons}</b> seasons · above the hindsight ceiling</div></div>`;
}

// 2. Two sites: farmer vs team, grouped bars with the gain on top.
export function sitesChart(sites) {
  const W = 560, H = 260, top = 34, bottom = 52, left = 16, right = 16;
  const max = Math.max(...sites.flatMap((s) => [s.farmer, s.team])) * 1.15;
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const group = (W - left - right) / sites.length, bw = group * 0.28;
  const body = sites.map((s, i) => {
    const gx = left + i * group + group / 2;
    const xs = [gx - bw - 4, gx + 4];
    return [["c-farmer", s.farmer], ["c-team", s.team]].map(([cls, v], j) =>
      `<rect class="${cls}" x="${xs[j]}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="4"/>`
      + `<text class="v" x="${xs[j] + bw / 2}" y="${y(v) - 8}" text-anchor="middle">${money(v)}</text>`).join("")
      + `<text class="gain" x="${gx}" y="${top - 12}" text-anchor="middle">${signed(s.team_vs_farmer.mean_diff)}/ha</text>`
      + `<text class="l" x="${gx}" y="${H - 28}" text-anchor="middle">${escapeText(s.short)}</text>`
      + `<text class="l dim" x="${gx}" y="${H - 12}" text-anchor="middle">${escapeText(s.note)}</text>`;
  }).join("");
  return `<div class="chart-card mb-card"><div class="chart-title">Works at a site it never saw</div>`
    + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Farmer practice vs FieldTwin team at two sites">`
    + `<line class="axis" x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}"/>${body}</svg>`
    + `<div class="chart-caption legend"><span class="key c-farmer"></span>Farmer practice <span class="key c-team"></span>FieldTwin team</div></div>`;
}

// 3. Resource tiles: water and leaching vs farmer practice, plus failed decisions.
export function resourceTiles(test, fallbacks) {
  const pct = (a, b) => Math.round((100 * (b - a)) / a);
  const tile = (cls, big, label, sub) => `<div class="mb-cell"><div class="tile mb-card ${cls}"><div class="big">${big}</div>`
    + `<div class="tl">${escapeText(label)}</div><div class="ts">${escapeText(sub)}</div></div></div>`;
  const d = test.team_vs_farmer;
  return tile("t-team", `${d.wins}/${d.seasons}`, "test seasons won vs farmer practice", `${signed(d.mean_diff)}/ha on average`)
    + tile("t-water", `${pct(test.water_mm.farmer, test.water_mm.team)}%`, "irrigation water",
      `${Math.round(test.water_mm.farmer)} → ${Math.round(test.water_mm.team)} mm per season`)
    + tile("t-leach", `${pct(test.leached_kg_ha.farmer, test.leached_kg_ha.team)}%`, "nitrate leached to groundwater",
      `${test.leached_kg_ha.farmer.toFixed(1)} → ${test.leached_kg_ha.team.toFixed(1)} kg N/ha`)
    + tile("t-team", `${fallbacks.team}`, "failed decisions (team)", `single agent: ${fallbacks.single}`);
}

// 4. Team vs single agent, same model and knowledge: one bar per unseen season (team minus single), sorted.
export function teamVsSingleChart(tvs) {
  const W = 1100, H = 240, top = 16, bottom = 16, left = 60, right = 10;
  const diffs = tvs.per_season.map((s) => s.diff);
  const lim = Math.max(...diffs.map(Math.abs)) * 1.1;
  const y = (v) => top + (H - top - bottom) * (1 - (v + lim) / (2 * lim));
  const slot = (W - left - right) / diffs.length, bw = slot * 0.7;
  const bars = tvs.per_season.map((s, i) => {
    const x = left + i * slot + (slot - bw) / 2, y0 = y(0), yv = y(s.diff);
    return `<rect class="${s.diff >= 0 ? "c-team" : "c-loss"}" x="${x}" y="${Math.min(y0, yv)}" width="${bw}" `
      + `height="${Math.max(1, Math.abs(yv - y0))}" rx="2"><title>${escapeText(s.task_id)}: ${signed(s.diff)}</title></rect>`;
  }).join("");
  const ticks = [lim * 0.8, 0, -lim * 0.8].map((v) => {
    const r = Math.round(v / 100) * 100;
    return `<text class="l dim" x="${left - 6}" y="${y(r) + 4}" text-anchor="end">${r ? signed(r) : "0"}</text>`;
  }).join("");
  return `<div class="chart-card mb-card"><div class="chart-title">Why a team: same model, same knowledge, one agent vs five</div>`
    + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Team minus single agent, per unseen season">`
    + `${ticks}<line class="axis" x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}"/>${bars}</svg>`
    + `<div class="chart-caption">Team minus single agent, each of the ${tvs.seasons} seasons neither was tuned on: `
    + `team ahead in <b class="t-team">${tvs.wins} of ${tvs.seasons}</b>, <b>${signed(tvs.mean_diff)}/ha</b> on average `
    + `(95% CI ±${Math.round(tvs.ci95)}), failed decisions <b>${tvs.fallbacks.team}</b> vs <b class="t-warn">${tvs.fallbacks.single}</b></div></div>`;
}

export function headlineResults(demo) {
  const sites = [
    { ...demo.test, short: "Gainesville, FL", note: "held-out test 2010–2024" },
    { ...demo.tifton, short: "Tifton, GA", note: "new site, never tuned on" },
  ];
  const ablation = demo.test.ablation_d1d
    ? `<div class="quiet res-note">Next design (ablation, not the submitted one): independent Nitrogen and Water agents `
      + `score ${money(demo.test.ablation_d1d)} on the same test seasons.</div>` : "";
  const cell = (span, html) => `<div class="mb-cell" style="--span:${span}">${html}</div>`;
  return `<div class="res-head"><span class="label">Headline results</span><span class="badge">held-out</span></div>`
    + `<div class="bento">${cell(2, headlineChart(demo.test))}${cell(2, sitesChart(sites))}`
    + resourceTiles(demo.test, demo.team_vs_single.fallbacks)
    + `${cell(4, teamVsSingleChart(demo.team_vs_single))}</div>`
    + `<div class="quiet res-note">Score = profit minus a $2.44/kg penalty for nitrate leached (USD/ha per season). `
    + `Final design: ${escapeText(demo.final_design)}.</div>${ablation}`;
}

// MagicBento-style lights (ported from React Bits MagicBento to plain JS): a spotlight inside the hovered card,
// a border glow on card edges near the cursor (neighbors too), a ring of light from a click, a staggered intro.
// The CSS reads --mb-x/--mb-y (cursor in card coords), --mb-near, --mb-hot and the click-wave vars.
export function attachBento(root) {
  if (root.dataset.bento) return;          // the listeners live on the persistent results container
  root.dataset.bento = "1";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0, pointer = null, wave = null;
  const cards = () => [...root.querySelectorAll(".bento .mb-card")];
  const paint = (now) => {
    raf = 0;
    const list = cards();
    const grid = root.querySelector(".bento");
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    const near = pointer && pointer.x > g.left - 150 && pointer.x < g.right + 150 && pointer.y > g.top - 150 && pointer.y < g.bottom + 150;
    let waveR = 0, waveA = 0;
    if (wave) {
      const t = Math.min(1, (now - wave.t0) / 1100);
      waveR = wave.reach * (1 - Math.pow(1 - t, 2.2));
      waveA = Math.pow(1 - t, 1.3);
      if (t >= 1) wave = null;
    }
    for (const card of list) {
      const r = card.getBoundingClientRect();
      const x = pointer ? pointer.x - r.left : -999, y = pointer ? pointer.y - r.top : -999;
      const inside = pointer && x >= 0 && y >= 0 && x <= r.width && y <= r.height;
      card.style.setProperty("--mb-x", `${x}px`);
      card.style.setProperty("--mb-y", `${y}px`);
      card.style.setProperty("--mb-near", near ? "1" : "0");
      card.style.setProperty("--mb-hot", inside ? "1" : "0");
      if (wave || waveA === 0) {
        card.style.setProperty("--mb-wx", `${wave ? wave.x - r.left : -999}px`);
        card.style.setProperty("--mb-wy", `${wave ? wave.y - r.top : -999}px`);
        card.style.setProperty("--mb-wr", `${waveR}px`);
        card.style.setProperty("--mb-wa", `${waveA}`);
      }
    }
    if (wave) raf = requestAnimationFrame(paint);
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(paint); };
  root.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; wake(); }, { passive: true });
  root.addEventListener("pointerleave", () => { pointer = null; wake(); });
  window.addEventListener("scroll", wake, { passive: true, capture: true });
  root.addEventListener("click", (e) => {
    if (reduced || !e.target.closest(".bento .mb-card")) return;
    const g = root.querySelector(".bento").getBoundingClientRect();
    const reach = Math.max(...[[g.left, g.top], [g.right, g.top], [g.left, g.bottom], [g.right, g.bottom]]
      .map(([cx, cy]) => Math.hypot(e.clientX - cx, e.clientY - cy))) + 140;
    wave = { x: e.clientX, y: e.clientY, t0: performance.now(), reach };
    wake();
  });
}

// Staggered rise-in when the Results page is opened (animate = true); re-renders show the cards at once.
export function introBento(root, animate = true) {
  const cells = root.querySelectorAll(".bento .mb-cell");
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cells.forEach((cell) => cell.classList.add("mb-in"));
    return;
  }
  cells.forEach((cell, i) => {
    cell.style.setProperty("--mb-delay", `${i * 80}ms`);
    cell.classList.remove("mb-in");
    requestAnimationFrame(() => requestAnimationFrame(() => cell.classList.add("mb-in")));
  });
}
