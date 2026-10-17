// Season timeline (UI_SPEC.md section 6), hand-written SVG:
//   rain bars: one per day from the weather file, aligned to week 0 by data.alignSeason; without a matching
//              weather file, one bar per week from the log's weekly.rain_mm (labelled as such)
//   storm weeks (weekly rain > theme.stormMm) highlighted, with their logged total
//   week track 0..W-1 plus harvest, click or drag to seek
//   one marker row per config: green dot = N applied that week (area ~ kg), red dot = N leached (area ~ kg)

import { theme } from "./theme.js";
import { configName } from "./data.js";

const NS = "http://www.w3.org/2000/svg";
const H = 150, LABEL_W = 190, RIGHT_PAD = 20;
const RAIN_TOP = 18, RAIN_H = 44, TRACK_Y = 82, ROW0 = 112, ROW_H = 22;

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(v, digits = 0) {
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export class Timeline {
  constructor(svg, { onSeek, onPickRow }) {
    this.svg = svg;
    this.onSeek = onSeek;
    this.onPickRow = onPickRow;
    this.model = null;
    this.week = 0;
    let dragging = false;
    const seek = (e) => {
      if (!this.model) return;
      const pt = this.svg.getBoundingClientRect();
      const x = e.clientX - pt.left;
      if (x < LABEL_W - 8) return;
      const k = Math.floor((x - LABEL_W) / this.cw);
      this.onSeek(Math.max(0, Math.min(this.model.W, k)));
    };
    svg.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-config]")) return;
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      seek(e);
    });
    svg.addEventListener("pointermove", (e) => dragging && seek(e));
    svg.addEventListener("pointerup", () => (dragging = false));
    svg.addEventListener("click", (e) => {
      const row = e.target.closest("[data-config]");
      if (row) this.onPickRow(row.dataset.config);
    });
    new ResizeObserver(() => this.draw()).observe(svg);
  }

  // model: {W, rows: [{config, run, active, fake}], days: [mm...] | null (W*7 daily values), weeklyRain: [mm|null]}
  setModel(model) {
    this.model = model;
    this.draw();
  }

  setWeek(k) {
    this.week = k;
    if (!this.cursor) return;
    const x = LABEL_W + k * this.cw;
    this.cursor.style.transform = `translateX(${x}px)`;
    this.progress.setAttribute("x2", LABEL_W + (k + 0.5) * this.cw);
    this.svg.querySelectorAll(".wk").forEach((t) => t.classList.toggle("now", +t.dataset.week === k));
  }

  draw() {
    const svg = this.svg, m = this.model;
    const width = svg.clientWidth || 1200;
    svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    svg.replaceChildren();
    this.cursor = null;
    if (!m) return;
    const W = m.W, cells = W + 1;   // decision weeks + harvest
    const cw = (this.cw = (width - LABEL_W - RIGHT_PAD) / cells);
    const x0 = LABEL_W;
    const storms = new Set(m.weeklyRain.map((v, k) => (v !== null && v > theme.stormMm ? k : -1)).filter((k) => k >= 0));

    // Current-week column, behind everything.
    this.cursor = el("rect", { class: "cursor", x: 0, y: 6, width: cw, height: H - 10 });
    svg.append(this.cursor);

    // Rain bars.
    const daily = !!m.days;
    const values = daily ? m.days : m.weeklyRain;
    const max = Math.max(1e-6, ...values.filter((v) => v !== null));
    const per = daily ? 7 : 1;
    const bw = cw / per;
    values.forEach((mm, i) => {
      if (mm === null || mm <= 0) return;
      const week = Math.floor(i / per);
      const h = Math.max(1, (RAIN_H * mm) / max);
      svg.append(el("rect", {
        class: `rain${storms.has(week) ? " storm" : ""}`,
        x: x0 + i * bw + (daily ? 0.5 : bw * 0.25), y: RAIN_TOP + RAIN_H - h,
        width: Math.max(1, daily ? bw - 1 : bw * 0.5), height: h,
      }));
    });
    for (const k of storms) {
      svg.append(el("text", { class: "storm-label", x: x0 + (k + 0.5) * cw, y: RAIN_TOP - 6, "text-anchor": "middle" },
        `${fmt(m.weeklyRain[k], 0)} mm`));
    }
    svg.append(el("text", { class: "axis-label", x: 0, y: RAIN_TOP + 10 }, daily ? "RAIN · MM/DAY" : "RAIN · MM/WEEK (LOG)"));
    svg.append(el("text", { class: "axis-sub", x: 0, y: RAIN_TOP + 24 }, `max ${fmt(max, 1)} mm`));
    if (m.rainNote) svg.append(el("text", { class: "axis-sub", x: 0, y: RAIN_TOP + 38 }, m.rainNote));

    // Week track.
    svg.append(el("line", { class: "track", x1: x0, x2: x0 + cells * cw, y1: TRACK_Y, y2: TRACK_Y }));
    this.progress = el("line", { class: "track-on", x1: x0, x2: x0, y1: TRACK_Y, y2: TRACK_Y });
    svg.append(this.progress);
    for (let k = 0; k < cells; k++) {
      const cx = x0 + (k + 0.5) * cw;
      svg.append(el("line", { class: "tick", x1: x0 + k * cw, x2: x0 + k * cw, y1: TRACK_Y - 3, y2: TRACK_Y + 3 }));
      svg.append(el("text", { class: "wk", "data-week": k, x: cx, y: TRACK_Y + 15, "text-anchor": "middle" },
        k === W ? "H" : String(k)));
    }
    svg.append(el("text", { class: "axis-label", x: 0, y: TRACK_Y + 4 }, "WEEK"));

    // Marker rows.
    m.rows.forEach((row, r) => {
      const y = ROW0 + r * ROW_H;
      const g = el("g", { class: `row${row.active ? " active" : ""}`, "data-config": row.config });
      g.append(el("rect", { class: "row-hit", x: 0, y: y - ROW_H / 2, width: LABEL_W - 12, height: ROW_H }));
      g.append(el("text", { class: "row-label", x: 0, y: y + 4 }, configName(row.config).toUpperCase() + (row.fake ? "  FAKE" : "")));
      svg.append(g);
      svg.append(el("line", { class: "row-line", x1: x0, x2: x0 + cells * cw, y1: y, y2: y }));
      if (!row.run) {
        svg.append(el("text", { class: "axis-sub", x: x0 + 6, y: y + 4 }, "no log for this season"));
        return;
      }
      for (const w of row.run.weeks) {
        const n = w.decision && typeof w.decision.n_kg_ha === "number" ? w.decision.n_kg_ha : 0;
        const lch = w.weekly && typeof w.weekly.n_leached === "number" ? w.weekly.n_leached : 0;
        const cx = x0 + (w.week + 0.5) * cw;
        const dot = (cls, dx, r, tip) => {
          const c = el("circle", { class: cls, cx: cx + dx, cy: y, r: Math.min(9, r) });
          c.append(el("title", {}, tip));
          svg.append(c);
        };
        if (n > 0) dot("dot-n", -cw * 0.18, 1.6 + Math.sqrt(n) * 0.75, `Week ${w.week}: ${fmt(n, 0)} kg N/ha applied`);
        if (lch >= 0.05) dot("dot-leach", cw * 0.18, 1.6 + Math.sqrt(lch) * 0.9, `Week ${w.week}: ${fmt(lch, 1)} kg N/ha leached`);
      }
    });
    this.setWeek(this.week);
  }
}
