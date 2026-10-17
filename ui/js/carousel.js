// Week cards carousel (R4): a plain-JS port of the behavior of the React Bits <Carousel /> component
// (reactbits.dev). No React, no motion library, no icon library. Used only inside this app; do not export or
// publish it as a standalone component or package.
//
// What is ported: the position spring (stiffness / damping, sub-stepped, snap near rest), the "cube" effect
// (each card turns on a cube around the deck center: translateZ(-half) rotateY(offset * 90deg) translateZ(half),
// a slight scale-down mid-turn, a dark shade on turning cards, perspective = 2.6 x card width), the "counter"
// indicator (zero-padded "07 / 20", the number slides on change), pointer drag with a 6 px dead zone, vertical
// gestures left to the page, rubber band past the ends (max 0.3), release by position plus velocity
// (round(p + v * 0.2), a flick of |v| > 0.8 or a drag over 0.18 of a card moves one), horizontal wheel that
// settles 120 ms after it stops, arrow keys / Home / End on the root, reduced motion (jumps).
// Changes for FieldTwin: no arrows, no autoplay, no loop; only the current card is visible at rest (the others
// are hidden, not stacked); setIndex() from outside moves the deck without calling onChange, so playback and
// the deck stay in sync both ways without echo.
//
// Credit: the React Bits Carousel component by David Haz.
//
// Original license (React Bits repository, LICENSE.md), reproduced in full:
//
//   MIT + Commons Clause License Condition v1.0
//
//   Copyright (c) 2026 David Haz
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   ## Commons Clause Restriction
//
//   You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
//
//   ## No Warranty
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, "0");
const DEAD_ZONE = 6, OVERSHOOT = 0.3, SHADE = 0.6;

export class Carousel {
  // root: an empty element. onChange(index) fires only for the viewer's own moves (drag, wheel, keys).
  constructor(root, { stiffness = 150, damping = 24, onChange = null, reduceMotion = false, label = "Carousel" } = {}) {
    this.root = root;
    this.k = stiffness;
    this.c = damping;
    this.onChange = onChange;
    this.reduce = reduceMotion;
    this.n = 0;
    this.index = 0;
    this.p = 0;
    this.v = 0;
    this.raf = 0;
    this.drag = null;
    this.wheelTimer = 0;
    this.cards = [];

    root.classList.add("carousel");
    root.tabIndex = 0;
    root.setAttribute("role", "region");
    root.setAttribute("aria-roledescription", "carousel");
    root.setAttribute("aria-label", label);
    this.viewport = document.createElement("div");
    this.viewport.className = "carousel-viewport";
    this.counter = document.createElement("div");
    this.counter.className = "carousel-counter mono";
    this.counter.innerHTML = `<span class="cur-box"><span class="cur">00</span></span><span class="sep">/</span><span class="tot">00</span>`;
    this.cur = this.counter.querySelector(".cur");
    this.tot = this.counter.querySelector(".tot");
    root.append(this.viewport, this.counter);

    root.addEventListener("pointerdown", (e) => this.down(e));
    root.addEventListener("pointermove", (e) => this.move(e));
    root.addEventListener("pointerup", (e) => this.up(e));
    root.addEventListener("pointercancel", (e) => this.up(e, true));
    root.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    root.addEventListener("keydown", (e) => this.key(e));
    new ResizeObserver(() => this.layout()).observe(this.viewport);
  }

  // items: HTML strings, one per card. index: the card to show (no animation, no onChange).
  setItems(items, index = this.index) {
    this.viewport.textContent = "";
    this.cards = items.map((html) => {
      const card = document.createElement("article");
      card.className = "carousel-card";
      card.innerHTML = `<div class="carousel-card-body">${html}</div><div class="carousel-shade"></div>`;
      this.viewport.append(card);
      return { el: card, shade: card.lastElementChild };
    });
    this.n = items.length;
    this.index = clamp(index, 0, Math.max(0, this.n - 1));
    this.p = this.index;
    this.v = 0;
    this.tot.textContent = pad2(this.n);
    this.setCounter(false);
    this.layout();
  }

  // From outside (playback, scrubber): move the deck without calling onChange.
  setIndex(i) {
    this.go(i, false);
  }

  go(i, user) {
    if (!this.n) return;
    const next = clamp(Math.round(i), 0, this.n - 1);
    const dir = Math.sign(next - this.index);
    const changed = next !== this.index;
    this.index = next;
    if (changed) this.setCounter(true, dir);
    if (this.reduce) {
      this.p = next;
      this.v = 0;
      this.layout();
    } else this.start();
    if (changed && user && this.onChange) this.onChange(next);
  }

  setCounter(animate, dir = 1) {
    this.cur.textContent = pad2(this.index + 1);
    if (animate && !this.reduce && this.cur.animate) {
      this.cur.animate([{ transform: `translateY(${dir * 70}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    }
  }

  // ------------------------------------------------------------ spring

  start() {
    if (this.raf) return;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.drag) this.step(dt);
      this.layout();
      const rest = !this.drag && Math.abs(this.index - this.p) < 0.0004 && Math.abs(this.v) < 0.004;
      if (rest) {
        this.p = this.index;
        this.v = 0;
        this.layout();
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (this.index - this.p) - this.c * this.v) * h;
      this.p += this.v * h;
    }
  }

  // ------------------------------------------------------------ cube effect

  layout() {
    const w = this.viewport.clientWidth;
    if (!w) return;
    const half = w / 2;
    this.viewport.style.perspective = `${(w * 2.6).toFixed(0)}px`;
    const frac = this.p - Math.floor(this.p);
    const turn = Math.sin(Math.PI * frac);
    this.cards.forEach((c, i) => {
      const off = i - this.p, near = Math.min(1, Math.abs(off));
      const show = Math.abs(off) < 1 - 1e-3;
      c.el.style.visibility = show ? "" : "hidden";
      c.el.setAttribute("aria-hidden", i === this.index ? "false" : "true");
      if (!show) return;
      c.el.style.transform = `translateZ(${-half}px) rotateY(${(clamp(off, -1, 1) * 90).toFixed(3)}deg) translateZ(${half}px) scale(${(1 - 0.12 * turn).toFixed(4)})`;
      c.el.style.zIndex = String(100 - Math.round(near * 10));
      c.shade.style.opacity = (near * SHADE).toFixed(3);
    });
  }

  // ------------------------------------------------------------ input

  down(e) {
    if (!this.n || e.button !== 0) return;
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: this.p, start: this.index, live: false, samples: [] };
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.live) {
      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      if (Math.abs(dy) > Math.abs(dx)) { this.drag = null; return; }   // vertical: leave it to the page
      d.live = true;
      this.root.setPointerCapture(e.pointerId);
      this.root.classList.add("dragging");
      this.v = 0;
      this.start();
    }
    const w = this.viewport.clientWidth || 1;
    this.p = this.band(d.p0 - dx / w);
    const t = performance.now();
    d.samples.push({ t, p: this.p });
    while (d.samples.length > 2 && t - d.samples[0].t > 90) d.samples.shift();
  }

  up(e, cancel = false) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.root.classList.remove("dragging");
    if (!d.live) return;
    let v = 0;
    if (d.samples.length > 1) {
      const a = d.samples[0], b = d.samples[d.samples.length - 1];
      v = b.t > a.t ? ((b.p - a.p) / (b.t - a.t)) * 1000 : 0;
    }
    v = clamp(v, -12, 12);
    let target = Math.round(this.p + v * 0.2);
    if (target === d.start && !cancel) {
      if (Math.abs(v) > 0.8) target = d.start + Math.sign(v);
      else if (Math.abs(this.p - d.start) > 0.18) target = d.start + Math.sign(this.p - d.start);
    }
    if (cancel) target = d.start;
    this.v = v;
    this.go(target, true);
    this.start();
  }

  // Past the first or last card: rubber band, at most OVERSHOOT of a card.
  band(p) {
    const max = this.n - 1;
    if (p < 0) return -OVERSHOOT * (1 - Math.exp(p / OVERSHOOT));
    if (p > max) return max + OVERSHOOT * (1 - Math.exp(-(p - max) / OVERSHOOT));
    return p;
  }

  wheel(e) {
    if (!this.n || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const w = this.viewport.clientWidth || 1;
    this.drag = this.drag || { wheel: true, start: this.index };
    this.p = this.band(this.p + e.deltaX / w);
    this.v = 0;
    this.start();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.drag = null;
      this.go(Math.round(this.p), true);
      this.start();
    }, 120);
  }

  key(e) {
    if (!this.n || e.metaKey || e.ctrlKey || e.altKey) return;
    const to = { ArrowLeft: this.index - 1, ArrowRight: this.index + 1, Home: 0, End: this.n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();   // the page's own arrow keys would step the week a second time
    this.go(to, true);
  }
}
