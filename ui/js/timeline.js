// Season timeline (R1), hand-written SVG: one strip of rain bars plus a week scrubber. The 3D Season view uses the
// same geometry as the 2D fallback: "Rain (mm)" and "Week" labels, 1-based week numbers ("H" = harvest), and a
// legend for the marks on the right.
//   rain bars: one per day from the weather file, aligned to week 0 by data.seasonStart; without a matching
//              weather file, one bar per week from the log's weekly.rain_mm (labelled as such)
//   storm weeks (weekly rain > theme.stormMm) drawn brighter
//   scrubber: week ticks 0..W-1 plus harvest; click or drag to seek
//   Critic objection weeks (Maize Runner run): a white outline pill above the track (the Objection pill's look)
//   fallback weeks (either run): a small white outline pill under the track (.flag-pill)
//   live: weeks after `cap` (not decided yet) keep their observed rain, dimmed
// Dose timing shows in the fields now, so there are no per-config marker rows.

import { theme } from "./theme.js";

const NS = "http://www.w3.org/2000/svg";
const FULL = { H: 74, LABEL_W: 96, RIGHT_PAD: 124, RAIN_TOP: 4, RAIN_H: 28, TRACK_Y: 48, WK_DY: 21 };
// 3D Season (fix2): a thin strip along the bottom, over the fields.
const COMPACT = { H: 54, LABEL_W: 88, RIGHT_PAD: 112, RAIN_TOP: 2, RAIN_H: 18, TRACK_Y: 34, WK_DY: 16 };

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Timeline {
  constructor(svg, { onSeek, compact = false }) {
    this.svg = svg;
    this.g = compact ? COMPACT : FULL;
    this.onSeek = onSeek;
    this.model = null;
    this.week = 0;
    let dragging = false;
    const seek = (e) => {
      if (!this.model) return;
      const x = e.clientX - this.svg.getBoundingClientRect().left;
      const k = Math.floor((x - this.g.LABEL_W) / this.cw);
      this.onSeek(Math.max(0, Math.min(this.model.W, k)));
    };
    svg.addEventListener("pointerdown", (e) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      seek(e);
    });
    svg.addEventListener("pointermove", (e) => dragging && seek(e));
    svg.addEventListener("pointerup", () => (dragging = false));
    new ResizeObserver(() => this.draw()).observe(svg);
  }

  // model: {W, days: [mm|null] (W*7 daily values) | null, weeklyRain: [mm|null], rainNote, fallbackWeeks: [k],
  //         objectionWeeks: [k], cap: last decided week (live) or null}
  setModel(model) {
    this.model = model;
    this.draw();
  }

  setWeek(k) {
    this.week = k;
    if (!this.cursor) return;
    const L = this.g.LABEL_W;
    this.cursor.style.transform = `translateX(${L + k * this.cw}px)`;
    this.progress.setAttribute("x2", L + (k + 0.5) * this.cw);
    this.knob.style.transform = `translateX(${L + (k + 0.5) * this.cw}px)`;
    this.svg.querySelectorAll(".wk").forEach((t) => t.classList.toggle("now", +t.dataset.week === k));
  }

  draw() {
    const svg = this.svg, m = this.model;
    const { H, LABEL_W, RIGHT_PAD, RAIN_TOP, RAIN_H, TRACK_Y, WK_DY } = this.g;
    const width = svg.clientWidth || 1200;
    svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
    svg.replaceChildren();
    this.cursor = null;
    if (!m) return;
    const W = m.W, cells = W + 1;
    const cw = (this.cw = (width - LABEL_W - RIGHT_PAD) / cells);
    const x0 = LABEL_W;
    const storms = new Set(m.weeklyRain.map((v, k) => (v !== null && v > theme.stormMm ? k : -1)).filter((k) => k >= 0));

    this.cursor = el("rect", { class: "cursor", x: 0, y: 0, width: cw, height: H });
    svg.append(this.cursor);

    const daily = !!m.days;
    const values = daily ? m.days : m.weeklyRain;
    const max = Math.max(1e-6, ...values.filter((v) => v !== null));
    const per = daily ? 7 : 1, bw = cw / per;
    values.forEach((mm, i) => {
      if (mm === null || mm <= 0) return;
      const h = Math.max(1, (RAIN_H * mm) / max);
      const wk = Math.floor(i / per);
      svg.append(el("rect", {
        class: `rain${storms.has(wk) ? " storm" : ""}${m.cap !== null && m.cap !== undefined && wk > m.cap ? " ahead" : ""}`,
        x: x0 + i * bw + (daily ? 0.5 : bw * 0.25), y: RAIN_TOP + RAIN_H - h,
        width: Math.max(1, daily ? bw - 1 : bw * 0.5), height: h,
      }));
    });
    const ry = RAIN_TOP + Math.round(RAIN_H * 0.75);
    svg.append(el("text", { class: "axis-label", x: 0, y: ry }, "Rain (mm)"));
    if (m.rainNote) svg.append(el("text", { class: "axis-sub", x: x0 + 8, y: ry }, m.rainNote));

    svg.append(el("line", { class: "track", x1: x0, x2: x0 + cells * cw, y1: TRACK_Y, y2: TRACK_Y }));
    this.progress = el("line", { class: "track-on", x1: x0, x2: x0, y1: TRACK_Y, y2: TRACK_Y });
    svg.append(this.progress);
    for (let k = 0; k < cells; k++) {
      svg.append(el("line", { class: "tick", x1: x0 + k * cw, x2: x0 + k * cw, y1: TRACK_Y - 3, y2: TRACK_Y + 3 }));
      svg.append(el("text", { class: "wk", "data-week": k, x: x0 + (k + 0.5) * cw, y: TRACK_Y + WK_DY, "text-anchor": "middle" },
        k === W ? "H" : String(k + 1)));
    }
    const pill = (cls, k, y, h) => el("rect", { class: cls, x: x0 + (k + 0.18) * cw, y, width: 0.64 * cw, height: h, rx: h / 2 });
    for (const k of m.objectionWeeks || []) svg.append(pill("obj", k, TRACK_Y - 14, 9));
    for (const k of m.fallbackWeeks || []) svg.append(pill("fb flag-pill", k, TRACK_Y + 4, 5));
    // Legend for the marks that are on the strip (right of the track).
    const lx = x0 + cells * cw + 16;
    if ((m.objectionWeeks || []).length) {
      svg.append(el("rect", { class: "obj", x: lx, y: TRACK_Y - 14, width: 22, height: 9, rx: 4.5 }));
      svg.append(el("text", { class: "legend", x: lx + 30, y: TRACK_Y - 5 }, "Objection"));
    }
    if ((m.fallbackWeeks || []).length) {
      svg.append(el("rect", { class: "fb flag-pill", x: lx, y: TRACK_Y + 4, width: 22, height: 5, rx: 2.5 }));
      svg.append(el("text", { class: "legend", x: lx + 30, y: TRACK_Y + 12 }, "Fallback"));
    }
    this.knob = el("circle", { class: "knob", cx: 0, cy: TRACK_Y, r: 5 });
    svg.append(this.knob);
    svg.append(el("text", { class: "axis-label", x: 0, y: TRACK_Y + 6 }, "Week"));
    this.setWeek(this.week);
  }
}
