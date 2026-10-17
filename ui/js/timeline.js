// Season timeline (R1), hand-written SVG: one thin strip of rain bars plus a week scrubber.
//   rain bars: one per day from the weather file, aligned to week 0 by data.seasonStart; without a matching
//              weather file, one bar per week from the log's weekly.rain_mm (labelled as such)
//   storm weeks (weekly rain > theme.stormMm) drawn brighter
//   scrubber: week ticks 0..W-1 plus harvest; click or drag to seek
// Dose timing shows in the fields now, so there are no per-config marker rows.

import { theme } from "./theme.js";

const NS = "http://www.w3.org/2000/svg";
const H = 78, LABEL_W = 132, RIGHT_PAD = 16;
const RAIN_TOP = 4, RAIN_H = 28, TRACK_Y = 48;

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Timeline {
  constructor(svg, { onSeek }) {
    this.svg = svg;
    this.onSeek = onSeek;
    this.model = null;
    this.week = 0;
    let dragging = false;
    const seek = (e) => {
      if (!this.model) return;
      const x = e.clientX - this.svg.getBoundingClientRect().left;
      const k = Math.floor((x - LABEL_W) / this.cw);
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

  // model: {W, days: [mm|null] (W*7 daily values) | null, weeklyRain: [mm|null], rainNote}
  setModel(model) {
    this.model = model;
    this.draw();
  }

  setWeek(k) {
    this.week = k;
    if (!this.cursor) return;
    this.cursor.style.transform = `translateX(${LABEL_W + k * this.cw}px)`;
    this.progress.setAttribute("x2", LABEL_W + (k + 0.5) * this.cw);
    this.knob.style.transform = `translateX(${LABEL_W + (k + 0.5) * this.cw}px)`;
    this.svg.querySelectorAll(".wk").forEach((t) => t.classList.toggle("now", +t.dataset.week === k));
  }

  draw() {
    const svg = this.svg, m = this.model;
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
      svg.append(el("rect", {
        class: `rain${storms.has(Math.floor(i / per)) ? " storm" : ""}`,
        x: x0 + i * bw + (daily ? 0.5 : bw * 0.25), y: RAIN_TOP + RAIN_H - h,
        width: Math.max(1, daily ? bw - 1 : bw * 0.5), height: h,
      }));
    });
    svg.append(el("text", { class: "axis-label", x: 0, y: RAIN_TOP + 14 }, daily ? "Rain / day" : "Rain / week"));
    if (m.rainNote) svg.append(el("text", { class: "axis-sub", x: 0, y: RAIN_TOP + 30 }, m.rainNote));

    svg.append(el("line", { class: "track", x1: x0, x2: x0 + cells * cw, y1: TRACK_Y, y2: TRACK_Y }));
    this.progress = el("line", { class: "track-on", x1: x0, x2: x0, y1: TRACK_Y, y2: TRACK_Y });
    svg.append(this.progress);
    for (let k = 0; k < cells; k++) {
      svg.append(el("line", { class: "tick", x1: x0 + k * cw, x2: x0 + k * cw, y1: TRACK_Y - 3, y2: TRACK_Y + 3 }));
      svg.append(el("text", { class: "wk", "data-week": k, x: x0 + (k + 0.5) * cw, y: TRACK_Y + 22, "text-anchor": "middle" },
        k === W ? "H" : String(k)));
    }
    this.knob = el("circle", { class: "knob", cx: 0, cy: TRACK_Y, r: 5 });
    svg.append(this.knob);
    svg.append(el("text", { class: "axis-label", x: 0, y: TRACK_Y + 5 }, "Week"));
    this.setWeek(this.week);
  }
}
