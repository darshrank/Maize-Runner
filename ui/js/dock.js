// Page dock (R2): bottom-center bar of neon line icons with macOS-style magnification. A plain-JS port of the
// behavior of the React Bits <Dock /> component (reactbits.dev). No React, no motion library, no icon library:
// the springs are integrated here and the icons are our own SVGs (DOCK_ICONS below). Used only inside this app;
// do not export or publish it as a standalone component or package.
//
// What is ported: per-icon size from the pointer's horizontal distance to the icon center (magnification), a
// spring toward that size, a label tooltip on hover. Changes for FieldTwin: cos^2 falloff instead of a linear
// map, a small hop on click, a dot under the active page, the FieldTwin look (black bar, 1px hairline, no
// blur, no tiles, no shadows), and reduced motion (no magnification, no hop).
//
// Credit: the React Bits Dock component by David Haz.
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

// Sizes in CSS px. target = BASE + (PEAK - BASE) * cos^2(pi * r / 2) for r < 1, r = |pointer - center| / DISTANCE.
const BASE = 44, PEAK = 64, DISTANCE = 180;
// Spring (same constants for size and hop): mass, stiffness, damping.
const MASS = 0.1, STIFFNESS = 150, DAMPING = 12;
const HOP_PX = 9, HOP_MS = 140;
const SUBSTEP = 1 / 600;

// 24 x 24 line icons, stroke only (style.css sets stroke, width and caps).
export const DOCK_ICONS = {
  sprout: '<path d="M7 20.5h10"/><path d="M12 20.5V11.5"/><path d="M12 13.5C12 9.6 9.2 7.2 5 7.2c0 3.9 2.8 6.3 7 6.3z"/>'
    + '<path d="M12 11.5c0-3.6 2.6-6 6.6-6 0 3.6-2.6 6-6.6 6z"/>',
  chats: '<path d="M3.5 4h9.5a1.8 1.8 0 0 1 1.8 1.8v5.4a1.8 1.8 0 0 1-1.8 1.8H8.2L5 15.6V13H3.5a1.8 1.8 0 0 1-1.8-1.8V5.8A1.8 1.8 0 0 1 3.5 4z"/>'
    + '<path d="M17.6 8.6h2.9a1.8 1.8 0 0 1 1.8 1.8v5.4a1.8 1.8 0 0 1-1.8 1.8H19v2.6l-3.2-2.6h-4.6a1.8 1.8 0 0 1-1.8-1.8v-1"/>',
  bars: '<path d="M3.5 20.5h17"/><path d="M7 20.5v-6"/><path d="M12 20.5v-12"/><path d="M17 20.5v-8.5"/>',
  loop: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 3.6v3.6H16"/><path d="M12 8.5v3.5l2.4 1.6"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.4"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.6"/>'
    + '<path d="M9.5 3.5v3M12 3.5v3M14.5 3.5v3M9.5 17.5v3M12 17.5v3M14.5 17.5v3'
    + 'M3.5 9.5h3M3.5 12h3M3.5 14.5h3M17.5 9.5h3M17.5 12h3M17.5 14.5h3"/>',
  flow: '<rect x="9" y="9.5" width="6" height="5" rx="1"/><rect x="2.5" y="3" width="5" height="4" rx="0.8"/>'
    + '<rect x="16.5" y="3" width="5" height="4" rx="0.8"/><rect x="2.5" y="17" width="5" height="4" rx="0.8"/>'
    + '<rect x="16.5" y="17" width="5" height="4" rx="0.8"/><path d="M7.5 6.5 9.5 9.5M16.5 6.5l-2 3M7.5 17.5l2-3M16.5 17.5l-2-3"/>',
};

// One damped spring toward `target`, semi-implicit Euler in fixed substeps (stable for these constants).
class Spring {
  constructor(value) {
    this.x = value;
    this.v = 0;
    this.target = value;
  }

  step(dt) {
    for (let t = 0; t < dt; t += SUBSTEP) {
      const a = (-STIFFNESS * (this.x - this.target) - DAMPING * this.v) / MASS;
      this.v += a * SUBSTEP;
      this.x += this.v * SUBSTEP;
    }
  }

  get settled() {
    return Math.abs(this.x - this.target) < 0.05 && Math.abs(this.v) < 0.5;
  }

  snap(value) {
    this.x = this.target = value;
    this.v = 0;
  }
}

export class Dock {
  // items: [{id, label, icon (DOCK_ICONS key), key (shortcut shown in the tooltip)}]
  constructor(root, items, { onSelect, reduceMotion = false } = {}) {
    this.root = root;
    this.onSelect = onSelect;
    this.reduce = reduceMotion;
    this.pointerX = Infinity;
    this.raf = 0;
    this.last = 0;
    this.panel = document.createElement("div");
    this.panel.className = "dock-panel";
    this.items = items.map((item) => this.buildItem(item));
    root.append(this.panel);

    this.panel.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      this.pointerX = e.clientX;
      this.wake();
    });
    this.panel.addEventListener("pointerleave", () => {
      this.pointerX = Infinity;
      this.wake();
    });
  }

  buildItem(item) {
    const el = document.createElement("button");
    el.className = "dock-item";
    el.type = "button";
    el.dataset.page = item.id;
    el.setAttribute("aria-label", item.label);
    if (item.key) el.setAttribute("aria-keyshortcuts", item.key);
    el.style.width = el.style.height = `${BASE}px`;
    // Key hint: always visible in the icon's top-right corner (the tooltip repeats it with the label).
    el.innerHTML = `<svg class="dock-icon" viewBox="0 0 24 24" aria-hidden="true">${DOCK_ICONS[item.icon] || ""}</svg>`
      + `<span class="dock-label" aria-hidden="true">${item.label}${item.key ? ` <span class="dock-key">${item.key}</span>` : ""}</span>`
      + (item.key ? `<span class="dock-kbd" aria-hidden="true">${item.key}</span>` : "")
      + '<span class="dock-dot" aria-hidden="true"></span>';
    const it = { ...item, el, size: new Spring(BASE), hop: new Spring(0), hopTimer: 0 };
    el.addEventListener("pointerenter", () => el.classList.add("hover"));
    el.addEventListener("pointerleave", () => el.classList.remove("hover"));
    el.addEventListener("click", () => {
      this.hop(it);
      if (this.onSelect) this.onSelect(item.id);
    });
    this.panel.append(el);
    return it;
  }

  // Up for HOP_MS, then back: the spring turns the step into a small hop.
  hop(it) {
    if (this.reduce) return;
    clearTimeout(it.hopTimer);
    it.hop.target = -HOP_PX;
    it.hopTimer = setTimeout(() => {
      it.hop.target = 0;
      this.wake();
    }, HOP_MS);
    this.wake();
  }

  setActive(id) {
    for (const it of this.items) {
      const on = it.id === id;
      it.el.classList.toggle("active", on);
      if (on) it.el.setAttribute("aria-current", "page");
      else it.el.removeAttribute("aria-current");
    }
  }

  setHidden(hidden) {
    this.root.hidden = hidden;
  }

  // The frame loop runs only while the pointer is over the dock or a spring is still moving.
  wake() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = Number.isFinite(this.pointerX) && !this.reduce;
    for (const it of this.items) {
      let target = BASE;
      if (!this.reduce && Number.isFinite(this.pointerX)) {
        const rect = it.el.getBoundingClientRect();
        const r = Math.abs(this.pointerX - (rect.left + rect.width / 2)) / DISTANCE;
        if (r < 1) target = BASE + (PEAK - BASE) * Math.cos((Math.PI * r) / 2) ** 2;
      }
      it.size.target = target;
      if (this.reduce) it.size.snap(target);
      else it.size.step(dt);
      it.hop.step(dt);
      if (!it.size.settled || !it.hop.settled) moving = true;
      const s = Math.max(0, it.size.x);
      it.el.style.width = it.el.style.height = `${s.toFixed(2)}px`;
      it.el.style.transform = Math.abs(it.hop.x) > 0.01 ? `translateY(${it.hop.x.toFixed(2)}px)` : "";
    }
    this.raf = moving ? requestAnimationFrame((t) => this.frame(t)) : 0;
  }
}
