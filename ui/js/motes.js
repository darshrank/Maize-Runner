// Mote layer for one field: a 2D canvas over the field SVG, in the same viewBox units (fieldSvg.js sets the
// transform on resize). Canvas instead of SVG so hundreds of motes stay cheap. Kinds:
//   soil    green motes drifting in the topsoil band; count tracks obs.soil_n_kg_ha
//   fall    N dose: green motes fall from the sky and settle into the topsoil
//   rise    uptake: green motes climb the stalks and fade
//   leach   red motes drip from the soil bottom into the groundwater line, with a splash
//   rain    storm-week streaks in the sky (persistent while the storm week is shown)
// Glow: pre-rendered radial sprites drawn additively. ?lite=1 uses core-only sprites. Reduced motion: only
// static soil motes; rain, falls, rises and drips are skipped (the SVG keeps the storm tag and groundwater glow).

import { theme } from "./theme.js";

const F = theme.field;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

function sprite(color, halo) {
  const size = 48, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d"), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, theme.color.text);
  grad.addColorStop(halo ? 0.12 : 0.3, color);
  if (halo) {
    grad.addColorStop(0.32, color + "88");
    grad.addColorStop(1, color + "00");
  } else {
    grad.addColorStop(0.55, color + "00");
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Motes {
  constructor(canvas, { lite = false, reduceMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.reduce = reduceMotion;
    const halo = !lite;
    this.sprites = { n: sprite(theme.color.nitrogen, halo), leach: sprite(theme.color.leach, halo) };
    this.view = { s: 1, ox: 0, oy: 0, dpr: 1 };
    this.list = [];
    this.rain = [];
    this.rainTarget = 0;
    this.soilTarget = 0;
    this.plants = [];
  }

  resize(cssW, cssH, view) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.view = { ...view, dpr };
  }

  setPlants(plants) {
    this.plants = plants;
  }

  clear() {
    this.list = [];
    this.rain = [];
    this.rainTarget = 0;
    this.soilTarget = 0;
  }

  // ------------------------------------------------------------ spawning

  soilMote(fadeIn = true) {
    return { kind: "soil", x: rand(10, F.w - 10), y: rand(F.ground + 8, F.ground + F.topsoil), vx: 0, vy: 0,
      a: fadeIn ? 0 : 1, to: 1, r: rand(3.2, 4.6), ph: rand(0, 6.28) };
  }

  setSoil(target) {
    this.soilTarget = Math.max(0, Math.round(target));
    const alive = this.list.filter((m) => m.kind === "soil" && m.to > 0);
    const pending = this.list.filter((m) => m.kind === "fall").length;
    for (const m of alive.slice(this.soilTarget)) m.to = 0;
    const deficit = this.soilTarget - alive.length - pending;
    for (let i = 0; i < deficit; i++) this.push(this.soilMote(!this.reduce));
  }

  push(m) {
    if (this.list.length < theme.motes.cap) this.list.push(m);
  }

  dose(count, spread) {
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      this.push({ kind: "fall", x: rand(14, F.w - 14), y: rand(18, 110), vy: rand(30, 70), delay: rand(0, spread),
        land: rand(F.ground + 6, F.ground + F.topsoil), a: 1, r: rand(3.4, 4.6) });
    }
  }

  uptake(count, spread) {
    if (this.reduce || !this.plants.length) return;
    for (let i = 0; i < count; i++) {
      const p = this.plants[Math.floor(Math.random() * this.plants.length)];
      const y0 = rand(F.ground + 4, F.ground + 26);
      this.push({ kind: "rise", px: p.x, x: p.x, y: y0, y0, y1: F.ground - p.h * rand(0.35, 0.95), t: 0,
        life: rand(1.2, 1.8), delay: rand(0, spread), a: 0, r: rand(2.8, 3.6), ph: rand(0, 6.28) });
    }
  }

  // share = this week's leaching over the task's worst week (0..1): bigger, brighter drips for the worst week.
  leach(count, spread, share) {
    if (this.reduce) return;
    for (let i = 0; i < count; i++) {
      this.push({ kind: "leach", x: rand(16, F.w - 16), y: rand(F.soilBottom - 26, F.soilBottom), vy: rand(10, 40),
        delay: spread * 0.3 + rand(0, spread * 1.2), a: 1, r: 3.4 + 2.4 * share, trail: [] });
    }
  }

  setRain(count) {
    this.rainTarget = this.reduce ? 0 : Math.round(count);
    while (this.rain.length < this.rainTarget) {
      this.rain.push({ x: rand(-20, F.w), y: rand(-40, F.ground), len: rand(12, 22), v: rand(520, 720) });
    }
  }

  // ------------------------------------------------------------ simulation and drawing

  tick(dt) {
    dt = Math.min(dt, 0.05);
    const keep = [];
    let soilAlive = this.list.filter((m) => m.kind === "soil" && m.to > 0).length;
    for (const m of this.list) {
      if (m.delay > 0) { m.delay -= dt; keep.push(m); continue; }
      switch (m.kind) {
        case "soil":
          if (!this.reduce) {
            m.vx += rand(-1, 1) * 30 * dt; m.vy += rand(-1, 1) * 20 * dt;
            m.vx *= 0.96; m.vy *= 0.96;
            m.x += m.vx * dt; m.y += m.vy * dt;
            if (m.y < F.ground + 6 || m.y > F.ground + F.topsoil) m.vy *= -1;
            if (m.x < 6 || m.x > F.w - 6) m.vx *= -1;
            m.ph += dt * 1.4;
          }
          m.a += Math.sign(m.to - m.a) * Math.min(Math.abs(m.to - m.a), dt * 2.5);
          if (m.to > 0 || m.a > 0.01) keep.push(m);
          break;
        case "fall":
          m.vy += 520 * dt; m.y += m.vy * dt;
          if (m.y >= m.land) {
            if (soilAlive < this.soilTarget) {
              keep.push({ kind: "soil", x: m.x, y: m.land, vx: 0, vy: 0, a: 1, to: 1, r: m.r, ph: rand(0, 6.28) });
              soilAlive++;
            } else {
              keep.push({ kind: "soil", x: m.x, y: m.land, vx: 0, vy: 0, a: 1, to: 0, r: m.r, ph: 0 });
            }
          } else keep.push(m);
          break;
        case "rise": {
          m.t += dt;
          const p = m.t / m.life;
          if (p >= 1) break;
          m.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - p) ** 2);
          m.x = m.px + Math.sin(m.ph + p * 6) * 2.5;
          m.a = Math.min(1, p * 5) * (p > 0.7 ? (1 - p) / 0.3 : 1);
          keep.push(m);
          break;
        }
        case "leach":
          m.trail.push(m.y);
          if (m.trail.length > 6) m.trail.shift();
          m.vy += 300 * dt; m.y += m.vy * dt;
          if (m.y >= F.groundwater) {
            keep.push({ kind: "splash", x: m.x, y: F.groundwater, t: 0, life: 0.55, r: m.r });
          } else keep.push(m);
          break;
        case "splash":
          m.t += dt;
          if (m.t < m.life) keep.push(m);
          break;
        default: break;
      }
    }
    this.list = keep;

    for (let i = this.rain.length - 1; i >= 0; i--) {
      const d = this.rain[i];
      d.y += d.v * dt; d.x += d.v * 0.12 * dt;
      if (d.y - d.len > F.ground) {
        if (this.rain.length > this.rainTarget) this.rain.splice(i, 1);
        else { d.y = rand(-60, -10); d.x = rand(-40, F.w); }
      }
    }
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const { s, ox, oy, dpr } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, F.w, F.h);
    ctx.clip();

    if (this.rain.length) {
      ctx.strokeStyle = theme.color.rain;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const d of this.rain) {
        if (d.y < 0 || d.y - d.len > F.ground) continue;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.12, Math.max(0, d.y - d.len));
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "lighter";
    const dot = (img, x, y, r, a) => {
      if (a <= 0.01) return;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, x - r * 3, y - r * 3, r * 6, r * 6);
    };
    const green = this.sprites.n, red = this.sprites.leach;
    for (const m of this.list) {
      if (m.delay > 0) continue;
      if (m.kind === "soil") dot(green, m.x, m.y, m.r, m.a * (this.reduce ? 0.8 : 0.6 + 0.3 * Math.sin(m.ph)));
      else if (m.kind === "fall" || m.kind === "rise") dot(green, m.x, m.y, m.r, m.a);
      else if (m.kind === "leach") {
        m.trail.forEach((ty, i) => dot(red, m.x, ty, m.r * 0.7, (i + 1) / (m.trail.length + 1) * 0.5));
        dot(red, m.x, m.y, m.r, 1);
      } else if (m.kind === "splash") {
        const p = m.t / m.life;
        dot(red, m.x, m.y, m.r * (1 + 2.2 * p), 1 - p);
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
}
