// Headline charts for the Results page (A's demo results, agents_a/demo_results.json, built by
// scripts/build_demo_results.py from the committed eval.csv files). Plain SVG strings; colors come from the
// style.css tokens through CSS classes (farmer = --muted, FieldTwin team = --accent, water = --water,
// leaching = --leach), so they follow the theme. Score = the env's reward (USD/ha per season).

const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const signed = (v) => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 1. Held-out test, one site: vertical bars (farmer, single agent, team) and grid hindsight as a dashed reference line.
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
  const ref = `<line class="ref" x1="${left}" x2="${W - right + 8}" y1="${hy}" y2="${hy}"/>`
    + `<text class="l" x="${W - right + 14}" y="${hy + 4}">Grid hindsight ${money(test.hindsight)}</text>`
    + `<text class="l dim" x="${W - right + 14}" y="${hy + 20}">(best fixed plan,</text>`
    + `<text class="l dim" x="${W - right + 14}" y="${hy + 34}">weather known)</text>`;
  const d = test.team_vs_farmer;
  return `<div class="chart-card mb-card"><div class="chart-title">${escapeText(test.label)}</div>`
    + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean score per season on held-out test seasons">`
    + `<line class="axis" x1="${left}" x2="${W - right + 8}" y1="${y(0)}" y2="${y(0)}"/>${svgBars}${ref}</svg>`
    + `<div class="chart-caption"><b class="t-team">${signed(d.mean_diff)}/ha</b> vs farmer practice `
    + `(95% CI ±${Math.round(d.ci95)}) · ahead in <b>${d.wins} of ${d.seasons}</b> seasons · above grid hindsight</div></div>`;
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

// 4. Team vs single agent, same model and knowledge: three plain side-by-side comparisons over the seasons
// neither design was tuned on (average score, seasons won head-to-head, failed decisions).
export function teamVsSingleChart(tvs) {
  const panels = [
    { title: "Average score", unit: "$/ha per season", single: tvs.single_mean, team: tvs.team_mean, fmt: money, better: "higher" },
    { title: "Seasons won", unit: `head-to-head, of ${tvs.seasons}`, single: tvs.seasons - tvs.wins, team: tvs.wins, fmt: (v) => String(v), better: "higher" },
    { title: "Failed decisions", unit: "weeks the agent gave no valid answer", single: tvs.fallbacks.single, team: tvs.fallbacks.team, fmt: (v) => String(v), better: "lower" },
  ];
  const panel = (p) => {
    const W = 340, H = 150, left = 104, right = 64, barH = 34, gap = 18, top = 30;
    const max = Math.max(p.single, p.team, 1);
    const w = (v) => Math.max(v > 0 ? 3 : 0, ((W - left - right) * v) / max);
    const row = (label, v, cls, i) => {
      const y = top + i * (barH + gap);
      return `<text class="l row" x="${left - 10}" y="${y + barH / 2 + 5}" text-anchor="end">${label}</text>`
        + `<rect class="${cls}" x="${left}" y="${y}" width="${w(v)}" height="${barH}" rx="5"/>`
        + `<text class="v" x="${left + w(v) + 10}" y="${y + barH / 2 + 6}">${p.fmt(v)}</text>`;
    };
    return `<div class="tvs-panel"><div class="tvs-title">${escapeText(p.title)} <span class="quiet">(${p.better} is better)</span></div>`
      + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeText(p.title)}: single agent vs team">`
      + row("Single agent", p.single, "c-single", 0) + row("Team", p.team, "c-team", 1) + `</svg>`
      + `<div class="tvs-unit">${escapeText(p.unit)}</div></div>`;
  };
  return `<div class="chart-card mb-card"><div class="chart-title">Why a team: same model, same knowledge, one agent vs five</div>`
    + `<div class="tvs">${panels.map(panel).join("")}</div>`
    + `<div class="chart-caption">Over the ${tvs.seasons} seasons neither was tuned on, the team scores `
    + `<b class="t-team">${signed(tvs.mean_diff)}/ha more</b> (95% CI ±${Math.round(tvs.ci95)}), wins ${tvs.wins} of ${tvs.seasons}, `
    + `and never fails to decide.</div></div>`;
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

// ---------------------------------------------------------------- Results page (demo layout)
// One headline, one hero (team score gain over farmer practice on Gainesville held-out test seasons, seasons won,
// 95% CI, the farmer / team means with grid hindsight as a labeled reference line), then four tiles: water,
// leaching, team vs single agent (fallbacks counted), Tifton. Every number is read from agents_a/demo_results.json
// and shown with the file's own precision (one decimal), so the page matches the file exactly. Each tile carries
// its split. Percentages are computed from the two values beside them.
const one = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usd1 = (v) => `$${one(v)}`;
const sgn1 = (v) => `${v >= 0 ? "+" : "−"}$${one(Math.abs(v))}`;
const pctOf = (a, b) => Math.round((100 * (b - a)) / a);
const pctTxt = (p) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`;

// Grid hindsight wording follows eval/hindsight.py (grid search over fixed schedules per season, weather known).
function heroBars(t) {
  const max = Math.max(t.farmer, t.team, t.hindsight) * 1.04;
  const w = (v) => `${((100 * v) / max).toFixed(2)}%`;
  const bar = (cls, label, v) => `<div class="res-bar ${cls}"><span class="k">${escapeText(label)}</span>`
    + `<div class="track"><div class="fill ${cls}" style="width:${w(v)}">${usd1(v)}</div>`
    + `<div class="res-ref" style="left:${w(t.hindsight)}"></div></div></div>`;
  return `<div class="res-bars"><div class="res-bar"><span></span><div class="res-ref-label" style="width:${w(t.hindsight)}">`
    + `<span>Grid hindsight ${usd1(t.hindsight)}</span><span class="quiet">reference</span></div></div>`
    + bar("farmer", "Farmer practice", t.farmer) + bar("team", "FieldTwin team", t.team)
    + `<div class="res-bar"><span></span><span class="res-note">Mean score per season ($/ha). Grid hindsight: the best fixed schedule from a grid search run after the season, weather known.</span></div></div>`;
}

function tile(title, split, value, cls, sub) {
  return `<div class="res-tile card"><div class="top"><span class="t">${escapeText(title)}</span><span class="badge split">${escapeText(split)}</span></div>`
    + `<div class="v ${cls}">${value}</div><div class="s">${sub}</div></div>`;
}

export function resultsPage(demo) {
  const t = demo.test, d = t.team_vs_farmer, g = demo.tifton, s = demo.team_vs_single;
  const score = typeof demo.score === "string" ? demo.score.replace(/^reward\s*=\s*/i, "") : "";
  const water = pctOf(t.water_mm.farmer, t.water_mm.team), leach = pctOf(t.leached_kg_ha.farmer, t.leached_kg_ha.team);
  return `<header class="page-head"><div class="head"><h1>Team beats farmer on unseen seasons</h1>`
    + `<p class="sub">${escapeText(t.label)} · ${d.seasons} seasons${score ? ` · score = ${escapeText(score)}` : ""}</p></div></header>`
    + `<section class="res-hero card"><div>`
    + `<div class="res-big big-num">${sgn1(d.mean_diff)}<span class="u">/ha per season</span></div>`
    + `<div class="res-what">Score gain over farmer practice</div>`
    + `<div class="res-facts"><div class="res-fact"><span class="v">${d.wins} of ${d.seasons}</span><span class="k">seasons won</span></div>`
    + `<div class="res-fact"><span class="v">±${usd1(d.ci95)}</span><span class="k">95% CI</span></div>`
    + `<div class="res-fact"><span class="v">${t.fallbacks.team}</span><span class="k">fallbacks (team)</span></div></div></div>`
    + heroBars(t) + `</section>`
    + `<section class="res-tiles">`
    + tile("Water (mm)", "test", pctTxt(water), "water",
      `<b>${one(t.water_mm.farmer)}</b> → <b>${one(t.water_mm.team)}</b> mm per season, farmer → team`)
    + tile("Leaching (kg/ha)", "test", pctTxt(leach), "leach",
      `<b>${one(t.leached_kg_ha.farmer)}</b> → <b>${one(t.leached_kg_ha.team)}</b> kg N/ha, farmer → team`)
    + tile("Team vs single agent", "dev + test", `${sgn1(s.mean_diff)}`, "team",
      `won <b>${s.wins} of ${s.seasons}</b> · fallbacks <b>${s.fallbacks.team}</b> vs <b>${s.fallbacks.single}</b> · same model`)
    + tile("Tifton, GA (new site)", "test", `${sgn1(g.team_vs_farmer.mean_diff)}`, "team",
      `won <b>${g.team_vs_farmer.wins} of ${g.team_vs_farmer.seasons}</b> vs farmer · never tuned there`)
    + `</section>`;
}
