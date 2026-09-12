"use strict";
var GooeyCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // C:/Users/yuemi/AppData/Local/Temp/opencode/libraries-dev/packages/liquid-gooey/src/vanilla-entry.ts
  var vanilla_entry_exports = {};
  __export(vanilla_entry_exports, {
    EVOLVE_DEFAULTS: () => EVOLVE_DEFAULTS,
    MOVE_DEFAULTS: () => MOVE_DEFAULTS,
    ObserveEngine: () => ObserveEngine,
    easingFunction: () => easingFunction,
    measureRadius: () => measureRadius,
    normalizeRadius: () => normalizeRadius,
    offsetTo: () => offsetTo,
    parseShadow: () => parseShadow,
    presets: () => presets,
    resolveTransition: () => resolveTransition,
    roundedRectPath: () => roundedRectPath
  });

  // C:/Users/yuemi/AppData/Local/Temp/opencode/libraries-dev/packages/liquid-gooey/src/geometry.ts
  function offsetTo(el, ancestor) {
    let x = 0;
    let y = 0;
    let node = el;
    while (node && node !== ancestor && ancestor.contains(node)) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return { x, y };
  }
  function measureRadius(el, w, h) {
    const cs = getComputedStyle(el);
    const parse = (v) => {
      const first = v.split(" ")[0];
      if (first.endsWith("%")) return (parseFloat(first) || 0) / 100 * Math.min(w, h);
      return parseFloat(first) || 0;
    };
    return [
      parse(cs.borderTopLeftRadius),
      parse(cs.borderTopRightRadius),
      parse(cs.borderBottomRightRadius),
      parse(cs.borderBottomLeftRadius)
    ];
  }
  function normalizeRadius(r) {
    return typeof r === "number" ? [r, r, r, r] : r;
  }
  function roundedRectPath(x, y, w, h, radii) {
    let [tl, tr, br, bl] = radii.map((v) => Math.max(0, v));
    const f = Math.min(
      1,
      w / Math.max(1e-6, tl + tr),
      w / Math.max(1e-6, bl + br),
      h / Math.max(1e-6, tl + bl),
      h / Math.max(1e-6, tr + br)
    );
    tl *= f;
    tr *= f;
    br *= f;
    bl *= f;
    return `M ${x + tl} ${y} H ${x + w - tr} A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr} V ${y + h - br} A ${br} ${br} 0 0 1 ${x + w - br} ${y + h} H ${x + bl} A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl} V ${y + tl} A ${tl} ${tl} 0 0 1 ${x + tl} ${y} Z`;
  }

  // C:/Users/yuemi/AppData/Local/Temp/opencode/libraries-dev/packages/liquid-gooey/src/observer.ts
  var import_meta = {};
  var viteHot = import_meta.hot;
  if (viteHot) viteHot.accept(() => viteHot.invalidate());
  var EVOLVE_DEFAULTS = {
    massStiffness: 320,
    massDamping: 17,
    sizeStiffness: 170,
    sizeDamping: 11.5,
    radiusStiffness: 900,
    radiusDamping: 60,
    contentBlur: 7,
    roundness: 1,
    cornerDuration: 460,
    cornerDelay: 0,
    cornerEase: "cubic-bezier(0.3, 1.05, 0.4, 1)",
    anticipation: 90,
    travel: 32
  };
  var easeCache = /* @__PURE__ */ new Map();
  function easingFn(spec) {
    let fn = easeCache.get(spec);
    if (fn) return fn;
    const m = /cubic-bezier\(([^)]+)\)/.exec(spec);
    if (m) {
      const [x1, y1, x2, y2] = m[1].split(",").map(Number);
      fn = (t) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const x = 3 * mid * (1 - mid) * (1 - mid) * x1 + 3 * mid * mid * (1 - mid) * x2 + mid ** 3;
          if (x < t) lo = mid;
          else hi = mid;
        }
        const u = (lo + hi) / 2;
        return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
      };
    } else if (spec === "ease-in-out") {
      fn = easingFn("cubic-bezier(0.42, 0, 0.58, 1)");
    } else {
      fn = (t) => Math.min(1, Math.max(0, t));
    }
    easeCache.set(spec, fn);
    return fn;
  }
  var MOVE_DEFAULTS = {
    stiffness: 380,
    damping: 18,
    stretch: 0.18,
    tail: 0.46,
    force: 0.5,
    // Both bows are OPT-IN. As defaults they deformed every move item: the
    // sliders' circular thumbs turned egg-shaped mid-drag (cap deformation)
    // and sagged off the track's centreline (vertical bow) from nothing but
    // spring wobble in the velocity.
    bend: 0,
    bendX: 0
  };
  var MELT_LAYERS = 3;
  function cornerTotalOf(eo) {
    return Math.max(0, eo.cornerDelay) + Math.max(1, eo.cornerDuration);
  }
  function pillRadius(r, w, h) {
    return Math.max(0, Math.min(r, Math.min(w, h) / 2));
  }
  function springStep(cur, vel, target, k, c, dt) {
    const a = k * (target - cur) - c * vel;
    const v = vel + a * dt;
    return [cur + v * dt, v];
  }
  function springSteps(cur, vel, target, k, c, dt) {
    let n = Math.max(1, Math.ceil(dt * 60));
    const h = dt / n;
    let p = cur;
    let v = vel;
    while (n-- > 0) {
      const step = springStep(p, v, target, k, c, h);
      p = step[0];
      v = step[1];
    }
    return [p, v];
  }
  function q(v, step) {
    return Math.round(v / step) * step;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  var meltCounter = 0;
  function smoothstep(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  }
  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
  function downscaleHref(el) {
    try {
      if (!el.complete || !el.naturalWidth) return null;
      const dw = Math.max(2, Math.min(el.naturalWidth, Math.round((el.offsetWidth || 40) * 3)));
      const dh = Math.max(2, Math.min(el.naturalHeight, Math.round((el.offsetHeight || 40) * 3)));
      if (el.naturalWidth <= dw * 1.5) return null;
      const cv = document.createElement("canvas");
      cv.width = dw;
      cv.height = dh;
      const c2 = cv.getContext("2d");
      if (!c2) return null;
      const scale = Math.max(dw / el.naturalWidth, dh / el.naturalHeight);
      const sw = dw / scale;
      const sh = dh / scale;
      c2.drawImage(el, (el.naturalWidth - sw) / 2, (el.naturalHeight - sh) / 2, sw, sh, 0, 0, dw, dh);
      return cv.toDataURL();
    } catch {
      return null;
    }
  }
  var ObserveEngine = class {
    constructor(getGroup) {
      this.getGroup = getGroup;
      /** Goo blur of the owning group; used to derive the default blend range. */
      this.gooBlur = 6;
      this.items = /* @__PURE__ */ new Set();
      this.awake = false;
      this.clean = 0;
      this.raf = 0;
      this.sourcesReady = false;
      this.mo = null;
      this.interval = null;
      this.removeListeners = [];
      this.wake = () => {
        this.clean = 0;
        if (this.awake || this.items.size === 0) return;
        this.awake = true;
        this.raf = requestAnimationFrame(this.loop);
      };
      this.lastNow = 0;
      /** EMA of the raw frame interval (ms) — the melt write pass consults it to
       *  pick its cadence: every frame while the clock is healthy, backed off to
       *  ~28fps when frames are dropping (WebKit under CPU-raster load is exactly
       *  the case that degrades the clock). Seeded at 60Hz-healthy. */
      this.frameEma = 17;
      this.loop = (now) => {
        if (this.items.size === 0) {
          this.awake = false;
          this.lastNow = 0;
          return;
        }
        const dt = this.lastNow ? Math.min(0.25, Math.max(1 / 240, (now - this.lastNow) / 1e3)) : 1 / 60;
        if (this.lastNow) {
          this.frameEma += (Math.min(now - this.lastNow, 80) - this.frameEma) * 0.12;
        }
        this.lastNow = now;
        if (this.measureAll(dt)) this.clean = 0;
        else this.clean++;
        if (this.clean > 30) {
          this.awake = false;
          this.lastNow = 0;
          return;
        }
        this.raf = requestAnimationFrame(this.loop);
      };
    }
    add(t) {
      const item = {
        ...t,
        baseW: t.target.offsetWidth || 1,
        baseH: t.target.offsetHeight || 1,
        radiusPx: this.resolveRadius(t),
        last: null,
        frame: null,
        lastBlend: null,
        melt: null,
        sim: null,
        motionEnv: 0,
        tPrev: null,
        tvx: 0,
        tvy: 0,
        lead01: 0,
        cornerT0: 0,
        lastTargetMoveT: 0,
        lastTargetSize: null,
        morphActive: false,
        round01: 0,
        tailEl: null,
        tailMidA: null,
        tailMidB: null,
        tailPhase: 0,
        bendCur: 0,
        bendCurX: 0,
        bendPathEl: null,
        lastBendD: null,
        lastBendVars: null,
        tailX: 0,
        tailY: 0,
        tailVx: 0,
        tailVy: 0,
        tailR: 0,
        contentBlurred: false,
        lastPaint: null,
        lastTail: null,
        lastBi: t.blobInset ?? 0,
        biSmooth: null,
        meltFade: 0,
        meltRel: null,
        meltOp: 1,
        meltPhase: 0,
        meltPrev: null,
        meltGeom: null,
        meltWroteAt: 0,
        meltAxis: null,
        meltHostLast: null,
        ro: new ResizeObserver(() => {
          item.baseW = t.target.offsetWidth || 1;
          item.baseH = t.target.offsetHeight || 1;
          item.radiusPx = this.resolveRadius(t);
          this.syncMelt(item);
          this.wake();
        })
      };
      item.ro.observe(t.target);
      this.items.add(item);
      this.refreshMelt(item);
      if (t.dynamics?.move) {
        const tail = svg("circle", { cx: "0", cy: "0", r: "0" });
        const midA = svg("circle", { cx: "0", cy: "0", r: "0" });
        const midB = svg("circle", { cx: "0", cy: "0", r: "0" });
        t.blob.parentNode?.insertBefore(tail, t.blob);
        t.blob.parentNode?.insertBefore(midA, t.blob);
        t.blob.parentNode?.insertBefore(midB, t.blob);
        item.tailEl = tail;
        item.tailMidA = midA;
        item.tailMidB = midB;
        const bendPath = svg("path", { d: "" });
        t.blob.parentNode?.insertBefore(bendPath, t.blob);
        item.bendPathEl = bendPath;
      }
      this.ensureSources();
      this.measureAll();
      this.wake();
      return () => {
        item.ro.disconnect();
        this.items.delete(item);
        this.clearBlend(item);
        if (item.contentBlurred) item.target.style.removeProperty("filter");
        item.tailEl?.remove();
        item.tailMidA?.remove();
        item.tailMidB?.remove();
        item.bendPathEl?.remove();
      };
    }
    dispose() {
      cancelAnimationFrame(this.raf);
      this.mo?.disconnect();
      this.removeListeners.forEach((off) => off());
      this.removeListeners = [];
      if (this.interval) clearInterval(this.interval);
      this.items.forEach((i) => i.ro.disconnect());
      this.items.clear();
      this.awake = false;
      this.sourcesReady = false;
    }
    resolveRadius(t) {
      if (t.radius != null) return t.radius;
      return measureRadius(t.target, t.target.offsetWidth, t.target.offsetHeight)[0];
    }
    /** (Re)build the warped-image SVG structure for a melt item. Two graded
     *  warp layers share ONE noise field (same frequency + seed): a wide gentle
     *  ripple and a tight strong core. Same field, different displacement
     *  scales → the layers align and read as a single liquid getting deeper
     *  toward the contact. The noise frequency is derived from the melt zone,
     *  so several ripple wavelengths fit across it — a fixed low frequency
     *  displaces the whole zone as one chunk, which reads as a shifted ghost
     *  copy instead of liquid. */
    /** Resize response. The melt DOM only needs REBUILDING when the set of
     *  images changes; a resize alone just makes the cached corner radii stale.
     *
     *  Rebuilding on every resize tore down and recreated three turbulence
     *  filters plus a pattern + <image> per photo, and WebKit re-decodes and
     *  re-rasterises all of it synchronously. The pill resizes the moment the
     *  hover gap opens — i.e. exactly as the flight begins — so that landed as
     *  a ~120ms main-thread stall. CSS transitions keep running on the
     *  compositor through a stall, but the silhouette is written from this
     *  loop, so the liquid froze while the content sailed on: the timing
     *  mismatch, and it never showed in Chromium because the rebuild is cheap
     *  enough there to fit in a frame. */
    syncMelt(item) {
      if (!item.blend) return;
      const melt = item.melt;
      const t = item.target;
      const imgs = t instanceof HTMLImageElement ? [t] : Array.from(t.querySelectorAll("img"));
      const same = !!melt && melt.entries.length === imgs.length && melt.entries.every((e, i) => e.el === imgs[i]);
      if (!same) {
        this.refreshMelt(item);
        return;
      }
      for (const entry of melt.entries) {
        entry.radiusPx = measureRadius(entry.el, entry.el.offsetWidth, entry.el.offsetHeight)[0];
        entry.lastGeom = null;
      }
    }
    refreshMelt(item) {
      const blend = item.blend;
      if (!blend) return;
      const host = blend.host;
      while (host.firstChild) host.removeChild(host.firstChild);
      const t = item.target;
      const imgs = t instanceof HTMLImageElement ? [t] : Array.from(t.querySelectorAll("img"));
      const uid = `gooey-melt-${++meltCounter}`;
      const seed = String(meltCounter * 7 % 100);
      const zone = blend.zone ?? this.gooBlur * 2.2 + 4;
      const freqK = Math.max(0.2, blend.warpFreq ?? 1);
      const bf = Math.min(0.3, Math.max(0.01, freqK / (zone * 1.1))).toFixed(4);
      const octaves = String(Math.max(1, Math.round(blend.detail ?? 2)));
      const noiseType = blend.warpStyle ?? "fractalNoise";
      const defs = svg("defs", {});
      const gradient = svg("radialGradient", { id: `${uid}-g` });
      gradient.append(
        // Long, smooth falloff: the melt reads as a gradient from intact rim
        // to fully mixed core, not as a disc with a soft edge.
        // Core-to-mid FULLY opaque, rim tight. Two failure modes shaped this:
        // a translucent middle let the white silhouette neck glow through the
        // copy right at the seam (a bright ring/dot wherever the goo bridges
        // dark imagery — the neck sits between the photos' rounded corners, so
        // nothing else can cover it), and a half-opaque rim let the copy's
        // blurred imagery drift far past the neck, reading as fog over a
        // contrasting neighbour. Opaque to 55%, then a fast falloff.
        svg("stop", { offset: "0%", "stop-color": "#fff" }),
        svg("stop", { offset: "55%", "stop-color": "#fff" }),
        svg("stop", { offset: "78%", "stop-color": "#fff", "stop-opacity": "0.55" }),
        svg("stop", { offset: "100%", "stop-color": "#fff", "stop-opacity": "0" })
      );
      defs.append(gradient);
      const mkLayer = (suffix) => {
        const filter = svg("filter", {
          id: `${uid}-f${suffix}`,
          filterUnits: "userSpaceOnUse",
          x: "0",
          y: "0",
          width: "0",
          height: "0",
          "color-interpolation-filters": "sRGB"
        });
        const turb = svg("feTurbulence", {
          type: noiseType,
          baseFrequency: bf,
          numOctaves: octaves,
          seed,
          result: "noise0"
        });
        filter.append(turb);
        const noiseOffset = svg("feOffset", { in: "noise0", dx: "0", dy: "0", result: "noise" });
        const disp = svg("feDisplacementMap", {
          in: "SourceGraphic",
          in2: "noise",
          scale: "0",
          xChannelSelector: "R",
          yChannelSelector: "G",
          result: "disp"
        });
        filter.append(noiseOffset);
        const blurEl = svg("feGaussianBlur", { in: "disp", stdDeviation: "0", result: "soft" });
        const sat = svg("feColorMatrix", {
          in: "soft",
          type: "saturate",
          values: "1.2",
          result: "col"
        });
        const erode = svg("feColorMatrix", {
          in: "noise",
          type: "matrix",
          values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1",
          result: "erode"
        });
        const clip = svg("feComposite", { in: "col", in2: "erode", operator: "in" });
        filter.append(disp, blurEl, sat, erode, clip);
        const mask = svg("mask", {
          id: `${uid}-m${suffix}`,
          maskUnits: "userSpaceOnUse",
          x: "-10000",
          y: "-10000",
          width: "20000",
          height: "20000"
        });
        const circle = svg("circle", { cx: "0", cy: "0", r: "0", fill: `url(#${uid}-g)` });
        mask.append(circle);
        defs.append(filter, mask);
        const gl = svg("g", {});
        gl.setAttribute("mask", `url(#${uid}-m${suffix})`);
        gl.setAttribute("opacity", "0");
        const filtered = svg("g", {});
        filtered.setAttribute("filter", `url(#${uid}-f${suffix})`);
        const shift = svg("g", {});
        filtered.append(shift);
        gl.append(filtered);
        return { filter, disp, blurEl, erode, turb, noiseOffset, circle, gl, shift };
      };
      const layers = Array.from({ length: MELT_LAYERS }, (_, i) => mkLayer(`l${i}`));
      host.append(defs, ...layers.map((l) => l.gl));
      let seam = null;
      if ((blend.seamBlur ?? 1) > 0) {
        const filter = svg("filter", {
          id: `${uid}-fs`,
          filterUnits: "userSpaceOnUse",
          x: "0",
          y: "0",
          width: "0",
          height: "0",
          "color-interpolation-filters": "sRGB"
        });
        const blurEl = svg("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "0" });
        filter.append(blurEl);
        const mask = svg("mask", {
          id: `${uid}-ms`,
          maskUnits: "userSpaceOnUse",
          x: "-10000",
          y: "-10000",
          width: "20000",
          height: "20000"
        });
        const circle = svg("circle", { cx: "0", cy: "0", r: "0", fill: `url(#${uid}-g)` });
        mask.append(circle);
        defs.append(filter, mask);
        const gl = svg("g", {});
        gl.setAttribute("mask", `url(#${uid}-ms)`);
        gl.setAttribute("opacity", "0");
        const filtered = svg("g", {});
        filtered.setAttribute("filter", `url(#${uid}-fs)`);
        gl.append(filtered);
        host.insertBefore(gl, defs.nextSibling);
        seam = { gl, filter, blurEl, circle };
      }
      const entries = imgs.map((el, i) => {
        const pattern = svg("pattern", {
          id: `${uid}-p${i}`,
          patternUnits: "userSpaceOnUse",
          x: "0",
          y: "0",
          width: "1",
          height: "1"
        });
        const image = svg("image", { width: "1", height: "1", preserveAspectRatio: "xMidYMid slice" });
        image.setAttribute("href", el.currentSrc || el.src);
        pattern.append(image);
        defs.append(pattern);
        const rects = layers.map((l) => {
          const rect = svg("rect", { x: "0", y: "0", width: "0", height: "0", fill: `url(#${uid}-p${i})` });
          l.shift.append(rect);
          return rect;
        });
        if (seam) {
          const rect = svg("rect", { x: "0", y: "0", width: "0", height: "0", fill: `url(#${uid}-p${i})` });
          seam.gl.firstElementChild.append(rect);
          rects.push(rect);
        }
        const radiusPx = measureRadius(el, el.offsetWidth, el.offsetHeight)[0];
        return {
          el,
          rects,
          pattern,
          image,
          radiusPx,
          lowRes: false,
          measured: null,
          lastGeom: null,
          lastHole: null
        };
      });
      host.setAttribute("opacity", "0");
      item.melt = { layers, entries, seam };
      if (blend.surface === "image" && imgs[0]) {
        const bp = svg("pattern", {
          id: `${uid}-bp`,
          patternUnits: "objectBoundingBox",
          patternContentUnits: "objectBoundingBox",
          width: "1",
          height: "1"
        });
        const bpImage = svg("image", {
          width: "1",
          height: "1",
          preserveAspectRatio: "xMidYMid slice"
        });
        bpImage.setAttribute("href", imgs[0].currentSrc || imgs[0].src);
        bp.append(bpImage);
        defs.append(bp);
        item.blob.setAttribute("fill", `url(#${uid}-bp)`);
      } else {
        item.blob.removeAttribute("fill");
      }
    }
    /** Remove all melt traces: hide the warped overlay, restore image masks. */
    clearBlend(item) {
      item.blend?.host.setAttribute("opacity", "0");
      item.meltHostLast = null;
      item.meltWroteAt = 0;
      item.meltAxis = null;
      for (const layer of item.melt?.layers ?? []) layer.last = void 0;
      if (item.melt?.seam) {
        item.melt.seam.last = void 0;
        item.melt.seam.gl.setAttribute("opacity", "0");
      }
      for (const entry of item.melt?.entries ?? []) {
        entry.el.style.removeProperty("mask-image");
        entry.el.style.removeProperty("-webkit-mask-image");
        entry.el.style.removeProperty("mask-composite");
        entry.el.style.removeProperty("-webkit-mask-composite");
        entry.lastHole = null;
        entry.lastGeom = null;
      }
    }
    measureAll(dt = 1 / 60) {
      const group = this.getGroup();
      if (!group || this.items.size === 0) return false;
      const g = group.getBoundingClientRect();
      let changed = false;
      for (const item of this.items) {
        const r = item.target.getBoundingClientRect();
        item.frame = { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height };
      }
      for (const item of this.items) {
        if (!item.blend || !item.melt) continue;
        for (const entry of item.melt.entries) {
          const ir = entry.el.getBoundingClientRect();
          entry.measured = {
            x: ir.left - g.left,
            y: ir.top - g.top,
            w: ir.width,
            h: ir.height,
            ow: entry.el.offsetWidth,
            oh: entry.el.offsetHeight
          };
        }
      }
      for (const item of this.items) {
        if (this.writeBlob(item, dt)) changed = true;
      }
      for (const item of this.items) {
        if (item.blend && this.writeBlend(item, dt)) changed = true;
      }
      return changed;
    }
    /** Effective blob inset: bridgeGrow pulls it toward negative (a visible
     *  liquid coat) as the nearest neighbour approaches.
     *
     *  Smoothed on a time constant rather than tracking proximity instantly.
     *  The raw value is a function of the dragged neighbour's position, so it
     *  moves as fast as the pointer does and lands on a different value every
     *  frame; the blob grows symmetrically from it, so that per-frame step is
     *  visible on the silhouette's far edge as a size flicker. It stayed small
     *  enough to read as smooth at 60fps, but a frame-rate drop multiplies the
     *  per-frame delta — which is why the pill's left edge flashed in Safari
     *  and not in Chromium. dt-based smoothing makes the growth rate identical
     *  at any frame rate. */
    effectiveInset(item, dt) {
      let bi = item.blobInset ?? 0;
      const grow = item.bridgeGrow ?? 0;
      if (grow > 0 && item.frame) {
        const f = item.frame;
        const range = Math.max(14, this.gooBlur * 3);
        let best = Infinity;
        for (const other of this.items) {
          if (other === item || !other.frame) continue;
          const o = other.frame;
          const dx = Math.max(o.x - (f.x + f.w), f.x - (o.x + o.w), 0);
          const dy = Math.max(o.y - (f.y + f.h), f.y - (o.y + o.h), 0);
          const gap = Math.hypot(dx, dy);
          if (gap < best) best = gap;
        }
        if (best < range) bi -= grow * smoothstep(1 - best / range);
      }
      if (grow <= 0) {
        item.biSmooth = bi;
        return bi;
      }
      if (item.biSmooth === null) item.biSmooth = bi;
      else item.biSmooth += (bi - item.biSmooth) * Math.min(1, dt * 18);
      return item.biSmooth;
    }
    writeBlob(item, dt) {
      const f = item.frame;
      const dyn = item.dynamics;
      if (!dyn || !dyn.evolve && !dyn.move) {
        const bi2 = this.effectiveInset(item, dt);
        const last = item.last;
        const frameChanged = !last || Math.abs(last.x - f.x) >= 0.05 || Math.abs(last.y - f.y) >= 0.05 || Math.abs(last.w - f.w) >= 0.05 || Math.abs(last.h - f.h) >= 0.05;
        const biChanged = Math.abs(bi2 - item.lastBi) >= 0.05;
        if (!frameChanged && !biChanged) return false;
        item.blob.style.transform = `translate(${f.x + bi2}px, ${f.y + bi2}px)`;
        if (frameChanged || biChanged) {
          const bw2 = Math.max(0, f.w - bi2 * 2);
          const bh2 = Math.max(0, f.h - bi2 * 2);
          item.blob.setAttribute("width", String(bw2));
          item.blob.setAttribute("height", String(bh2));
          const scale = item.baseW > 0 ? f.w / item.baseW : 1;
          item.blob.setAttribute("rx", String(pillRadius(item.radiusPx * scale - bi2, bw2, bh2)));
        }
        item.lastPaint = null;
        item.last = f;
        item.lastBi = bi2;
        return true;
      }
      const tcx = f.x + f.w / 2;
      const tcy = f.y + f.h / 2;
      let tr;
      if (dyn.evolve) {
        const ow = item.target.offsetWidth;
        const oh = item.target.offsetHeight;
        tr = measureRadius(item.target, ow, oh)[0];
      } else {
        tr = item.radiusPx * (item.baseW > 0 ? f.w / item.baseW : 1);
      }
      if (!item.sim) {
        item.sim = { cx: tcx, cy: tcy, w: f.w, h: f.h, r: tr, vcx: 0, vcy: 0, vw: 0, vh: 0, vr: 0 };
      }
      const s = item.sim;
      if (dyn.move) {
        const mo = dyn.moveOpts ?? MOVE_DEFAULTS;
        [s.cx, s.vcx] = springSteps(s.cx, s.vcx, tcx, mo.stiffness, mo.damping, dt);
        [s.cy, s.vcy] = springSteps(s.cy, s.vcy, tcy, mo.stiffness, mo.damping, dt);
      } else if (dyn.evolve) {
        const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
        const rawVx = item.tPrev ? (tcx - item.tPrev.cx) / dt : 0;
        const rawVy = item.tPrev ? (tcy - item.tPrev.cy) / dt : 0;
        item.tvx = item.tvx * 0.7 + rawVx * 0.3;
        item.tvy = item.tvy * 0.7 + rawVy * 0.3;
        item.tPrev = { cx: tcx, cy: tcy };
        const remX = tcx - s.cx;
        const remY = tcy - s.cy;
        const rem = Math.hypot(remX, remY);
        const vMag = Math.hypot(item.tvx, item.tvy);
        let dx = 0;
        let dy = 0;
        if (vMag > 1e-3) {
          dx = item.tvx / vMag;
          dy = item.tvy / vMag;
        } else if (rem > 1e-3) {
          dx = remX / rem;
          dy = remY / rem;
        }
        const tau = Math.max(0, eo.anticipation) / 1e3;
        const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
        item.lead01 += ((rem > 0.5 ? 1 : 0) - item.lead01) * k;
        const reach = Math.min(Math.max(0, eo.travel) * item.lead01, rem);
        const ox = dx * reach;
        const oy = dy * reach;
        [s.cx, s.vcx] = springSteps(s.cx, s.vcx, tcx + ox, eo.massStiffness, eo.massDamping, dt);
        [s.cy, s.vcy] = springSteps(s.cy, s.vcy, tcy + oy, eo.massStiffness, eo.massDamping, dt);
      } else {
        s.cx = tcx;
        s.cy = tcy;
        s.vcx = 0;
        s.vcy = 0;
      }
      if (dyn.evolve) {
        const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
        [s.w, s.vw] = springSteps(s.w, s.vw, f.w, eo.sizeStiffness, eo.sizeDamping, dt);
        [s.h, s.vh] = springSteps(s.h, s.vh, f.h, eo.sizeStiffness, eo.sizeDamping, dt);
        [s.r, s.vr] = springSteps(s.r, s.vr, tr, eo.radiusStiffness, eo.radiusDamping, dt);
      } else {
        s.w = f.w;
        s.h = f.h;
        s.r = tr;
        s.vw = 0;
        s.vh = 0;
        s.vr = 0;
      }
      let extra = "";
      const speed = Math.hypot(s.vcx, s.vcy);
      if (dyn.move && speed > 2) {
        const st = Math.min((dyn.moveOpts ?? MOVE_DEFAULTS).stretch, speed * 6e-4);
        const a = Math.round(Math.atan2(s.vcy, s.vcx) * 100) / 100;
        extra += ` rotate(${a}rad) scale(${(1 + st).toFixed(3)}, ${(1 / (1 + st * 0.65)).toFixed(3)}) rotate(${-a}rad)`;
      }
      if (dyn.move && item.tailEl) {
        const round = (v) => Math.round(v * 10) / 10;
        if (item.tailR === 0 && Math.abs(item.tailX) < 1e-3 && Math.abs(item.tailY) < 1e-3) {
          item.tailX = s.cx;
          item.tailY = s.cy;
        }
        ;
        [item.tailX, item.tailVx] = springSteps(item.tailX, item.tailVx, s.cx, 170, 22, dt);
        [item.tailY, item.tailVy] = springSteps(item.tailY, item.tailVy, s.cy, 170, 22, dt);
        const bi2 = item.blobInset ?? 0;
        const ux = speed > 1e-3 ? s.vcx / speed : 1;
        const uy = speed > 1e-3 ? s.vcy / speed : 0;
        const perp = Math.max(4, Math.abs(ux) * s.h + Math.abs(uy) * s.w - bi2 * 2);
        const halfAlong = (Math.abs(ux) * s.w + Math.abs(uy) * s.h) / 2;
        const base = perp / 2;
        const lagX = item.tailX - s.cx;
        const lagY = item.tailY - s.cy;
        const lag = Math.hypot(lagX, lagY);
        const mo = dyn.moveOpts ?? MOVE_DEFAULTS;
        const maxLag = halfAlong + base * (0.2 + mo.force * 1.6);
        if (lag > maxLag) {
          item.tailX = s.cx + lagX / lag * maxLag;
          item.tailY = s.cy + lagY / lag * maxLag;
        }
        const tailK = mo.tail;
        const onset = Math.max(0, Math.min(1, (speed - 20) / 120));
        const targetR = base * tailK * onset;
        item.tailR += (targetR - item.tailR) * Math.min(1, dt * 10);
        if (item.tailR < 0.3) {
          if (item.lastTail !== "hidden") {
            item.tailEl.setAttribute("r", "0");
            item.tailMidA?.setAttribute("r", "0");
            item.tailMidB?.setAttribute("r", "0");
            item.lastTail = "hidden";
          }
        } else {
          item.tailPhase += speed * dt * 0.045;
          const wob = item.tailR * 0.16;
          const px = -uy;
          const py = ux;
          const w1 = Math.sin(item.tailPhase) * wob;
          const w2 = Math.sin(item.tailPhase + 2.4) * -wob;
          const aX = s.cx + lagX * 0.45 + px * w1;
          const aY = s.cy + lagY * 0.45 + py * w1;
          const bX = s.cx + lagX * 0.75 + px * w2;
          const bY = s.cy + lagY * 0.75 + py * w2;
          const tail = `${round(item.tailX)},${round(item.tailY)},${round(item.tailR)},${round(aX)},${round(aY)},${round(bX)},${round(bY)}`;
          if (tail !== item.lastTail) {
            item.tailEl.setAttribute("cx", String(round(item.tailX)));
            item.tailEl.setAttribute("cy", String(round(item.tailY)));
            item.tailEl.setAttribute("r", String(round(item.tailR)));
            if (item.tailMidA) {
              item.tailMidA.setAttribute("cx", String(round(aX)));
              item.tailMidA.setAttribute("cy", String(round(aY)));
              item.tailMidA.setAttribute("r", String(round(item.tailR * 0.62)));
            }
            if (item.tailMidB) {
              item.tailMidB.setAttribute("cx", String(round(bX)));
              item.tailMidB.setAttribute("cy", String(round(bY)));
              item.tailMidB.setAttribute("r", String(round(item.tailR * 0.4)));
            }
            item.lastTail = tail;
          }
        }
      }
      let renderR = Math.max(0, s.r);
      let cornerActive = false;
      if (dyn.evolve) {
        const eo = dyn.evolveOpts ?? EVOLVE_DEFAULTS;
        const now = performance.now();
        const prevSize = item.lastTargetSize;
        const sizeDelta = prevSize ? Math.abs(f.w - prevSize.w) + Math.abs(f.h - prevSize.h) : 0;
        if (sizeDelta > 0.5) {
          if (!item.morphActive) {
            item.cornerT0 = now;
            item.morphActive = true;
          }
          item.lastTargetMoveT = now;
        } else if (item.morphActive && now - item.lastTargetMoveT > 150 && now - item.cornerT0 > cornerTotalOf(eo)) {
          item.morphActive = false;
        }
        item.lastTargetSize = { w: f.w, h: f.h };
        const cornerTotal = cornerTotalOf(eo);
        let target01 = 0;
        if (item.cornerT0 > 0 && eo.roundness > 0 && now - item.cornerT0 < cornerTotal) {
          const p = Math.min(
            1,
            Math.max(0, (now - item.cornerT0 - Math.max(0, eo.cornerDelay)) / Math.max(1, eo.cornerDuration))
          );
          const eased = easingFn(eo.cornerEase)(p);
          target01 = Math.min(1, Math.max(0, (1 - eased) * eo.roundness));
        }
        const maxStep = dt * 8;
        item.round01 += Math.max(-maxStep, Math.min(maxStep, target01 - item.round01));
        cornerActive = item.cornerT0 > 0 && now - item.cornerT0 < cornerTotal + 80 || Math.abs(target01 - item.round01) > 4e-3 || item.round01 > 4e-3;
        if (item.round01 > 1e-3) {
          const roundTarget = Math.max(Math.min(s.w, s.h) / 2, renderR);
          renderR = renderR + (roundTarget - renderR) * item.round01;
          renderR = Math.max(renderR, tr);
        }
        const motionRaw = Math.min(
          1,
          (Math.hypot(s.vcx, s.vcy) + Math.abs(s.vw) + Math.abs(s.vh)) / 420
        );
        item.motionEnv = Math.max(motionRaw, item.motionEnv - dt * 1.9);
        const motion = item.motionEnv;
        const blurPx = motion * motion * Math.max(0, eo.contentBlur);
        if (blurPx > 0.3) {
          item.target.style.filter = `blur(${blurPx.toFixed(1)}px)`;
          item.contentBlurred = true;
        } else if (item.contentBlurred) {
          item.target.style.removeProperty("filter");
          item.contentBlurred = false;
        }
      }
      const bi = item.blobInset ?? 0;
      const bw = Math.max(0, s.w - bi * 2);
      const bh = Math.max(0, s.h - bi * 2);
      const paintRx = pillRadius(renderR - bi, bw, bh);
      let bendD = "";
      if (dyn.move && item.bendPathEl) {
        const mo = dyn.moveOpts ?? MOVE_DEFAULTS;
        const cap = Math.min(bw, bh) * 0.5;
        const bTy = Math.max(-cap, Math.min(cap, s.vcy * 0.05)) * mo.bend;
        const capX = Math.min(bw, bh) * 0.9;
        const bTx = Math.max(-capX, Math.min(capX, s.vcx * 0.09)) * mo.bendX;
        item.bendCur += (bTy - item.bendCur) * Math.min(1, dt * 9);
        item.bendCurX += (bTx - item.bendCurX) * Math.min(1, dt * 9);
        const bvx = Math.round(item.bendCurX * 10) / 10;
        const bvy = Math.round(item.bendCur * 10) / 10;
        const bendVars = `${bvx},${bvy}`;
        if (bendVars !== item.lastBendVars) {
          item.target.style.setProperty("--lg-bend-x", `${bvx}px`);
          item.target.style.setProperty("--lg-bend-y", `${bvy}px`);
          item.target.style.setProperty("--lg-bend-xn", String(bvx));
          item.target.style.setProperty("--lg-bend-yn", String(bvy));
          item.lastBendVars = bendVars;
        }
        const bendActive = Math.abs(item.bendCur) > 0.5 || Math.abs(item.bendCurX) > 0.5;
        if (bendActive && bw > 1 && bh > 1) {
          const r = Math.min(paintRx, bw / 2, bh / 2);
          const cy = Math.round(item.bendCur * 2 * 10) / 10;
          const k = item.bendCurX;
          const rxR = Math.max(r * 0.2, Math.min(r * 3, k > 0 ? r - 0.8 * k : r + 1.6 * -k));
          const rxL = Math.max(r * 0.2, Math.min(r * 3, k > 0 ? r + 1.6 * k : r - 0.8 * -k));
          const K = 0.5523;
          const f2 = (v) => Math.round(v * 10) / 10;
          bendD = `M ${f2(rxL)} 0 Q ${f2(bw / 2)} ${cy} ${f2(bw - rxR)} 0 C ${f2(bw - rxR + K * rxR)} 0 ${f2(bw)} ${f2(r - K * r)} ${f2(bw)} ${f2(r)} L ${f2(bw)} ${f2(bh - r)} C ${f2(bw)} ${f2(bh - r + K * r)} ${f2(bw - rxR + K * rxR)} ${f2(bh)} ${f2(bw - rxR)} ${f2(bh)} Q ${f2(bw / 2)} ${f2(bh + item.bendCur * 2)} ${f2(rxL)} ${f2(bh)} C ${f2(rxL - K * rxL)} ${f2(bh)} 0 ${f2(bh - r + K * r)} 0 ${f2(bh - r)} L 0 ${f2(r)} C 0 ${f2(r - K * r)} ${f2(rxL - K * rxL)} 0 ${f2(rxL)} 0 Z`;
        }
      }
      const bending = bendD !== "";
      const paint = {
        t: `translate(${s.cx - s.w / 2 + bi}px, ${s.cy - s.h / 2 + bi}px)` + extra,
        w: bending ? "0" : String(bw),
        h: String(bh),
        rx: String(paintRx)
      };
      const lp = item.lastPaint;
      if (!lp || lp.t !== paint.t) item.blob.style.transform = paint.t;
      if (!lp || lp.w !== paint.w) item.blob.setAttribute("width", paint.w);
      if (!lp || lp.h !== paint.h) item.blob.setAttribute("height", paint.h);
      if (!lp || lp.rx !== paint.rx) item.blob.setAttribute("rx", paint.rx);
      item.lastPaint = paint;
      if (item.bendPathEl) {
        if (bendD !== (item.lastBendD ?? "")) {
          item.bendPathEl.setAttribute("d", bendD);
          item.lastBendD = bendD;
        }
        if (bending) item.bendPathEl.style.transform = paint.t;
      }
      item.last = f;
      const settled = Math.abs(s.cx - tcx) < 0.05 && Math.abs(s.cy - tcy) < 0.05 && Math.abs(s.w - f.w) < 0.05 && Math.abs(s.h - f.h) < 0.05 && Math.abs(s.r - tr) < 0.05 && speed < 1 && Math.abs(s.vw) + Math.abs(s.vh) + Math.abs(s.vr) < 1 && item.motionEnv < 0.01 && item.tailR < 0.3 && !cornerActive;
      return !settled;
    }
    /** Nearest-neighbour proximity → a liquid warp-melt at the contact point.
     *  The strength is ONE smoothed value: fast attack while approaching, and
     *  a gradual `releaseMs` decay whenever the target drops — whether from a
     *  drag release (`active: false`), moving out of range, or absorption. No
     *  path clears instantly. */
    writeBlend(item, dt) {
      const f = item.frame;
      const blend = item.blend;
      const melt = item.melt;
      if (!melt) return false;
      const range = blend.range ?? Math.max(10, this.gooBlur * 2.5);
      let bestGap = Infinity;
      let bestOther = null;
      for (const other of this.items) {
        if (other === item || !other.frame) continue;
        const o2 = other.frame;
        const dx = Math.max(o2.x - (f.x + f.w), f.x - (o2.x + o2.w), 0);
        const dy = Math.max(o2.y - (f.y + f.h), f.y - (o2.y + o2.h), 0);
        const gap = Math.hypot(dx, dy);
        if (gap < bestGap) {
          bestGap = gap;
          bestOther = o2;
        }
      }
      let embed = 0;
      let contactSpan = 0;
      if (bestOther && bestGap === 0) {
        const o2 = bestOther;
        const ox = Math.min(f.x + f.w, o2.x + o2.w) - Math.max(f.x, o2.x);
        const oy = Math.min(f.y + f.h, o2.y + o2.h) - Math.max(f.y, o2.y);
        const span = Math.max(1, Math.min(f.w, f.h, o2.w, o2.h));
        embed = Math.max(0, Math.min(ox, oy)) / span;
        contactSpan = Math.max(0, Math.max(ox, oy));
      }
      let sTarget = 0;
      if (bestOther && bestGap < range && blend.active !== false) {
        const sRaw = smoothstep(Math.min(1, (1 - bestGap / range) / 0.65));
        const strength = Math.max(0, Math.min(1, blend.strength ?? 1));
        const sink = Math.max(0.01, blend.sink ?? 0.45);
        const sunk = smoothstep(
          Math.max(0, Math.min(1, (embed - sink * 0.2) / Math.max(0.01, sink * 0.8)))
        );
        sTarget = Math.pow(sRaw, 1.25) * strength * (1 - sunk);
      }
      if (sTarget >= item.meltFade) {
        item.meltFade += (sTarget - item.meltFade) * Math.min(1, dt * 16);
        item.meltRel = null;
      } else if (sTarget > 0.02) {
        item.meltFade += (sTarget - item.meltFade) * Math.min(1, dt * 6);
        item.meltRel = null;
      } else {
        const relMs = Math.max(
          40,
          Math.max(blend.releaseMs ?? 240, blend.fadeMs ?? blend.releaseMs ?? 240)
        );
        if (!item.meltRel) item.meltRel = { from: item.meltFade, t: 0 };
        const rel2 = item.meltRel;
        rel2.t += dt * 1e3;
        const k = Math.min(1, rel2.t / relMs);
        item.meltFade = sTarget + (rel2.from - sTarget) * (1 - k) * (1 - k);
      }
      if (sTarget === 0 && item.meltFade < 1e-3) item.meltFade = 0;
      const s = item.meltFade;
      if (s <= 1e-3) {
        if (item.lastBlend && item.lastBlend.s !== 0) {
          this.clearBlend(item);
          item.lastBlend = { cx: 0, cy: 0, s: 0, d: 0, pk: "" };
          return true;
        }
        return false;
      }
      let o = bestOther;
      if ((!o || bestGap >= range) && item.meltGeom) o = item.meltGeom.o;
      if (!o) return false;
      const cx = f.x + f.w < o.x ? (f.x + f.w + o.x) / 2 : o.x + o.w < f.x ? (o.x + o.w + f.x) / 2 : (Math.max(f.x, o.x) + Math.min(f.x + f.w, o.x + o.w)) / 2;
      const cy = f.y + f.h < o.y ? (f.y + f.h + o.y) / 2 : o.y + o.h < f.y ? (o.y + o.h + f.y) / 2 : (Math.max(f.y, o.y) + Math.min(f.y + f.h, o.y + o.h)) / 2;
      item.meltGeom = { o: { ...o } };
      const rel = item.meltRel;
      const fadeMs = Math.max(40, blend.fadeMs ?? blend.releaseMs ?? 240);
      const fadeK = rel ? Math.min(1, rel.t / fadeMs) : 0;
      const relFade = rel ? (1 - fadeK) * (1 - fadeK) : 1;
      const sStruct = rel ? Math.min(1, rel.from * (0.55 + 0.45 * (1 - fadeK))) : s;
      const eStruct = sStruct * sStruct * (3 - 2 * sStruct);
      item.meltOp = relFade < item.meltOp ? relFade : item.meltOp + (relFade - item.meltOp) * Math.min(1, dt * 16);
      const zone = blend.zone ?? this.gooBlur * 2.2 + 4;
      const d = Math.min(Math.min(f.w, f.h) * 0.9, zone * (0.7 + 0.6 * sStruct));
      const flowSpeed = Math.max(0, blend.flowSpeed ?? 26);
      const prevPos = item.meltPrev;
      const moveSpeed = prevPos ? Math.hypot(f.x - prevPos.x, f.y - prevPos.y) / Math.max(1e-3, dt) : 0;
      item.meltPrev = { x: f.x, y: f.y };
      const phaseAdv = Math.min(dt, 1 / 24) * flowSpeed * 0.12 * Math.min(1, moveSpeed / 40);
      item.meltPhase += phaseAdv;
      const lb = item.lastBlend;
      const paramKey = `${blend.seamBlur ?? ""}/${blend.strength ?? ""}/${blend.warp}/${blend.blur}/${blend.mix ?? ""}/${blend.gravity ?? ""}`;
      if (phaseAdv < 1e-4 && lb && lb.pk === paramKey && Math.abs(lb.cx - cx) < 0.05 && Math.abs(lb.cy - cy) < 0.05 && Math.abs(lb.s - s) < 5e-3 && Math.abs(lb.d - d) < 0.05) {
        return false;
      }
      const nowMs = performance.now();
      if (this.frameEma > 20 && nowMs - item.meltWroteAt < 35) return true;
      item.meltWroteAt = nowMs;
      const round = (v) => Math.round(v * 10) / 10;
      const host = blend.host;
      const n = melt.layers.length;
      const ncx = o.x + o.w / 2;
      const ncy = o.y + o.h / 2;
      const gdx = ncx - cx;
      const gdy = ncy - cy;
      const gdl = Math.hypot(gdx, gdy) || 1;
      const gux = gdx / gdl;
      const guy = gdy / gdl;
      const gAmt = Math.max(0, blend.gravity ?? 25) * eStruct;
      const gDeg = round(Math.atan2(guy, gux) * 180 / Math.PI);
      const r3 = (v) => Math.round(v * 1e3) / 1e3;
      const taper = Math.max(0, Math.min(1, blend.taper ?? 0.65));
      const freqK = Math.max(0.2, blend.warpFreq ?? 1);
      const zoneBase = blend.zone ?? this.gooBlur * 2.2 + 4;
      const bfBase = Math.min(0.3, Math.max(0.01, freqK / (zoneBase * 1.1)));
      const alongF = (bfBase * 0.35).toFixed(4);
      const acrossF = (bfBase * 1.6).toFixed(4);
      const ax = Math.abs(gux);
      const ay = Math.abs(guy);
      const axis = item.meltAxis === "x" ? ay > ax * 1.25 ? "y" : "x" : item.meltAxis === "y" ? ax > ay * 1.25 ? "x" : "y" : ax >= ay ? "x" : "y";
      item.meltAxis = axis;
      const bfStr = axis === "x" ? `${alongF} ${acrossF}` : `${acrossF} ${alongF}`;
      const bx = cx + gux * d * 0.05;
      const by = cy + guy * d * 0.05;
      const layerVals = melt.layers.map((_, i) => {
        const t = n > 1 ? i / (n - 1) : 1;
        const blurK = 0.15 + 0.85 * Math.pow(t, 1.4);
        const warpK = 0.45 + 0.55 * t;
        const pr = 0.7 + 0.45 * t;
        const oa = 6 * Math.sin(item.meltPhase * pr);
        const ob = 2 * Math.sin(item.meltPhase * pr * 1.31 + 1.7);
        return [
          String(q(blend.warp * warpK * eStruct, 0.25)),
          String(q(blend.blur * blurK * eStruct, 0.25)),
          String(q(gux * oa - guy * ob, 0.5)),
          String(q(guy * oa + gux * ob, 0.5)),
          String(q(bx, 0.5)),
          String(q(by, 0.5)),
          // Outermost disc at 0.95d, not 1.15d: past d the copy has left the
          // neck entirely, and its blurred rim smearing onto the neighbour's
          // body was half of the white-fog-ring report (the other half was the
          // gradient rim above).
          String(q(d * (0.95 - 0.55 * t), 0.5)),
          String(q(Math.min(1, eStruct * (0.75 + 0.25 * t)), 0.02))
        ];
      });
      const anchorX = cx - gux * d;
      const anchorY = cy - guy * d;
      const settle = 1 - 0.45 * smoothstep(Math.min(1, embed * 2.2));
      const kFlow = Math.min(2.2, (gAmt + bestGap) / Math.max(8, 2 * d)) * (0.5 + taper) * settle;
      const flow = (k) => {
        const sx = r3(1 + kFlow * k);
        const sy = r3(1 / (1 + kFlow * 0.35 * k));
        return `translate(${round(anchorX)}, ${round(anchorY)}) rotate(${gDeg}) scale(${sx}, ${sy}) rotate(${-gDeg}) translate(${round(-anchorX)}, ${round(-anchorY)})`;
      };
      const mixAmt = Math.max(0, Math.min(1, blend.mix ?? 0)) * eStruct;
      const erodeRow = (amt) => {
        if (amt < 2e-3) return "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1";
        const k = r3(1 + 4 * amt);
        const c = r3(1 - k * (0.38 + 0.12 * amt));
        return `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${k} 0 0 0 ${c}`;
      };
      const elong = q(1 + Math.min(1.8, bestGap / Math.max(8, 2 * d)), 0.05);
      const zoneT = elong > 1.001 ? `translate(${round(bx)}, ${round(by)}) rotate(${gDeg}) scale(${r3(elong)}, 1) rotate(${-gDeg}) translate(${round(-bx)}, ${round(-by)})` : "";
      const spread = blend.blur * 2.5 + blend.warp + gAmt * 0.5 + kFlow * d + 8;
      const rr = q(d * 1.15 * elong + spread, 8);
      const regionX = String(q(bx - rr, 8));
      const regionY = String(q(by - rr, 8));
      const regionW = String(q(rr * 2, 8));
      melt.layers.forEach((layer, i) => {
        const t = n > 1 ? i / (n - 1) : 1;
        const v = layerVals[i];
        const shiftT = flow(0.4 + 0.6 * t);
        const erodeV = erodeRow(q(mixAmt * (0.15 + 0.85 * t), 0.01));
        const fp = v.join(",") + "|" + bfStr + "|" + shiftT + "|" + erodeV + "|" + zoneT + "|" + regionX + "," + regionY + "," + regionW;
        if (layer.last === fp) return;
        layer.last = fp;
        layer.filter.setAttribute("x", regionX);
        layer.filter.setAttribute("y", regionY);
        layer.filter.setAttribute("width", regionW);
        layer.filter.setAttribute("height", regionW);
        layer.disp.setAttribute("scale", v[0]);
        layer.blurEl.setAttribute("stdDeviation", v[1]);
        if (layer.turb.getAttribute("baseFrequency") !== bfStr) {
          layer.turb.setAttribute("baseFrequency", bfStr);
        }
        layer.noiseOffset.setAttribute("dx", v[2]);
        layer.noiseOffset.setAttribute("dy", v[3]);
        layer.circle.setAttribute("cx", v[4]);
        layer.circle.setAttribute("cy", v[5]);
        layer.circle.setAttribute("r", v[6]);
        if (zoneT) layer.circle.setAttribute("transform", zoneT);
        else layer.circle.removeAttribute("transform");
        layer.gl.setAttribute("opacity", v[7]);
        layer.shift.setAttribute("transform", shiftT);
        layer.erode.setAttribute("values", erodeV);
      });
      if (melt.seam) {
        const seam = melt.seam;
        const sBlur = q((blend.seamBlur ?? blend.blur * 1.6) * eStruct, 0.25);
        const sOp = q(Math.min(1, eStruct * 1.2) * 0.55, 0.02);
        const sR = q(d * 1.25, 0.5);
        const fp = `${sBlur}|${sOp}|${q(bx, 0.5)},${q(by, 0.5)},${sR}|${zoneT}|${regionX},${regionY},${regionW}`;
        if (seam.last !== fp) {
          seam.last = fp;
          seam.filter.setAttribute("x", regionX);
          seam.filter.setAttribute("y", regionY);
          seam.filter.setAttribute("width", regionW);
          seam.filter.setAttribute("height", regionW);
          seam.blurEl.setAttribute("stdDeviation", String(sBlur));
          seam.circle.setAttribute("cx", String(q(bx, 0.5)));
          seam.circle.setAttribute("cy", String(q(by, 0.5)));
          seam.circle.setAttribute("r", String(sR));
          if (zoneT) seam.circle.setAttribute("transform", zoneT);
          else seam.circle.removeAttribute("transform");
          seam.gl.setAttribute("opacity", String(sOp));
        }
      }
      const icx = f.x + f.w / 2;
      const icy = f.y + f.h / 2;
      const ang = Math.atan2(cy - icy, cx - icx);
      const pull = blend.pull * sStruct;
      const hostStr = r3(item.meltOp).toString() + `|translate(${round(Math.cos(ang) * pull)}px, ${round(Math.sin(ang) * pull)}px)`;
      if (hostStr !== item.meltHostLast) {
        item.meltHostLast = hostStr;
        const parts = hostStr.split("|");
        host.setAttribute("opacity", parts[0]);
        host.style.transform = parts[1];
      }
      const bridgeRange = Math.max(10, this.gooBlur * 2.5);
      const sBridge = bestOther ? bestGap < bridgeRange ? smoothstep(1 - bestGap / bridgeRange) : 0 : s;
      const holeAlpha = q(Math.max(0, 1 - Math.min(s, sBridge) * 2.2), 0.05).toFixed(2);
      const holeMid = (Math.round((1 + 2 * Number(holeAlpha)) / 3 * 20) / 20).toFixed(2);
      for (const entry of melt.entries) {
        if (!entry.lowRes) {
          const lo = downscaleHref(entry.el);
          if (lo) {
            entry.image.setAttribute("href", lo);
            entry.lowRes = true;
          } else if (entry.el.complete && entry.el.naturalWidth) {
            entry.lowRes = true;
          }
        }
        const ir = entry.measured;
        if (!ir || ir.w < 1 || ir.h < 1) continue;
        const ix = ir.x;
        const iy = ir.y;
        const kx = (ir.ow || ir.w) / ir.w;
        const geom = `${round(ix)},${round(iy)},${round(ir.w)},${round(ir.h)},${round(pillRadius(entry.radiusPx / (kx || 1), ir.w, ir.h))}`;
        if (geom !== entry.lastGeom) {
          entry.lastGeom = geom;
          for (const rect of entry.rects) {
            rect.setAttribute("x", String(round(ix)));
            rect.setAttribute("y", String(round(iy)));
            rect.setAttribute("width", String(round(ir.w)));
            rect.setAttribute("height", String(round(ir.h)));
            rect.setAttribute(
              "rx",
              String(round(pillRadius(entry.radiusPx / (kx || 1), ir.w, ir.h)))
            );
          }
          entry.pattern.setAttribute("x", String(round(ix)));
          entry.pattern.setAttribute("y", String(round(iy)));
          entry.pattern.setAttribute("width", String(round(ir.w)));
          entry.pattern.setAttribute("height", String(round(ir.h)));
          entry.image.setAttribute("width", String(round(ir.w)));
          entry.image.setAttribute("height", String(round(ir.h)));
        }
        const ky = (ir.oh || ir.h) / ir.h;
        const gapToImg = Math.hypot(
          Math.max(ix - cx, cx - (ix + ir.w), 0),
          Math.max(iy - cy, cy - (iy + ir.h), 0)
        );
        if (gapToImg > d) {
          if (entry.lastHole !== null) {
            entry.lastHole = null;
            entry.el.style.removeProperty("mask-image");
            entry.el.style.removeProperty("-webkit-mask-image");
            entry.el.style.removeProperty("mask-composite");
            entry.el.style.removeProperty("-webkit-mask-composite");
          }
          continue;
        }
        const ow = ir.ow || ir.w;
        const oh = ir.oh || ir.h;
        const rim = Math.min(ow, oh) / 2;
        let lx = (cx - ix) * kx;
        let ly = (cy - iy) * ky;
        let vx = lx - ow / 2;
        let vy = ly - oh / 2;
        const vlen = Math.hypot(vx, vy);
        if (vlen < rim) {
          if (vlen < 1e-3) {
            vx = gux;
            vy = guy;
          } else {
            vx /= vlen;
            vy /= vlen;
          }
          lx = ow / 2 + vx * rim;
          ly = oh / 2 + vy * rim;
        }
        const hx = Math.round(lx);
        const hy = Math.round(ly);
        const hd = q(
          Math.min(Math.max(d, contactSpan * 0.75) * Math.min(kx, ky), rim),
          1
        );
        const far = round(
          Math.max(
            Math.hypot(hx, hy),
            Math.hypot(hx - ow, hy),
            Math.hypot(hx, hy - oh),
            Math.hypot(hx - ow, hy - oh)
          )
        ) + 2;
        let hole;
        if (bestGap === 0 && contactSpan > 4 && bestOther) {
          const o2 = bestOther;
          const ncx2 = (o2.x + o2.w / 2 - ix) * kx;
          const ncy2 = (o2.y + o2.h / 2 - iy) * ky;
          const ovx0 = (Math.max(f.x, o2.x) - ix) * kx;
          const ovy0 = (Math.max(f.y, o2.y) - iy) * ky;
          const ovx1 = (Math.min(f.x + f.w, o2.x + o2.w) - ix) * kx;
          const ovy1 = (Math.min(f.y + f.h, o2.y + o2.h) - iy) * ky;
          const rEnd = Math.round(
            Math.max(
              Math.hypot(ovx0 - ncx2, ovy0 - ncy2),
              Math.hypot(ovx1 - ncx2, ovy0 - ncy2),
              Math.hypot(ovx0 - ncx2, ovy1 - ncy2),
              Math.hypot(ovx1 - ncx2, ovy1 - ncy2)
            ) + 3
          );
          const band = Math.round(
            Math.min(
              rim * 2.6,
              Math.max(hd, (blend.seamBlur ?? blend.blur * 1.6) * 3.2)
            )
          );
          const rCore = Math.max(0, rEnd - band);
          const farR = Math.round(
            Math.max(
              Math.hypot(ncx2, ncy2),
              Math.hypot(ncx2 - ow, ncy2),
              Math.hypot(ncx2, ncy2 - oh),
              Math.hypot(ncx2 - ow, ncy2 - oh)
            )
          ) + 2;
          hole = `radial-gradient(circle at ${Math.round(ncx2)}px ${Math.round(ncy2)}px, rgba(255,255,255,${holeAlpha}) ${rCore}px, #fff ${rEnd}px, #fff ${farR}px)`;
        } else {
          hole = `radial-gradient(circle at ${hx}px ${hy}px, rgba(255,255,255,${holeAlpha}) ${round(hd * 0.2)}px, rgba(255,255,255,${holeMid}) ${round(hd * 0.45)}px, #fff ${round(hd * 0.78)}px, #fff ${far}px)`;
        }
        if (hole !== entry.lastHole) {
          entry.lastHole = hole;
          entry.el.style.setProperty("mask-image", hole);
          entry.el.style.setProperty("-webkit-mask-image", hole);
          entry.el.style.removeProperty("mask-composite");
          entry.el.style.removeProperty("-webkit-mask-composite");
        }
      }
      item.lastBlend = { cx, cy, s, d, pk: paramKey };
      return true;
    }
    ensureSources() {
      if (this.sourcesReady) return;
      const group = this.getGroup();
      if (!group) return;
      this.sourcesReady = true;
      this.mo = new MutationObserver((muts) => {
        for (const m of muts) {
          const t = m.target;
          if (!(t instanceof Element) || !t.closest("[data-gooey-svg], [data-gooey-overlay]")) {
            this.wake();
            return;
          }
        }
      });
      this.mo.observe(group, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["style", "class"]
      });
      const wake = () => this.wake();
      for (const type of ["transitionrun", "animationstart", "pointerdown"]) {
        group.addEventListener(type, wake, true);
        this.removeListeners.push(() => group.removeEventListener(type, wake, true));
      }
      window.addEventListener("scroll", wake, { capture: true, passive: true });
      this.removeListeners.push(() => window.removeEventListener("scroll", wake, true));
      this.interval = setInterval(() => {
        if (!this.awake && this.measureAll()) this.wake();
      }, 300);
    }
  };

  // C:/Users/yuemi/AppData/Local/Temp/opencode/libraries-dev/packages/liquid-gooey/src/spring.ts
  var presets = {
    snappy: { stiffness: 480, damping: 34, mass: 1 },
    smooth: { stiffness: 190, damping: 26, mass: 1 },
    bouncy: { stiffness: 320, damping: 17, mass: 1 }
  };
  var DT = 1 / 240;
  function simulate(c) {
    let x = 0;
    let v = 0;
    let t = 0;
    let settledAt = -1;
    let max = 0;
    const xs = [0];
    while (t < 10) {
      const a = (-c.stiffness * (x - 1) - c.damping * v) / c.mass;
      v += a * DT;
      x += v * DT;
      t += DT;
      xs.push(x);
      if (x > max) max = x;
      if (Math.abs(x - 1) < 1e-3 && Math.abs(v) < 0.02) {
        if (settledAt < 0) settledAt = t;
        if (t - settledAt >= 0.064) break;
      } else {
        settledAt = -1;
      }
    }
    const duration = settledAt > 0 ? settledAt : t;
    const n = Math.round(Math.min(120, Math.max(24, duration * 90)));
    const lastIdx = Math.min(xs.length - 1, duration / DT);
    const values = [];
    for (let i = 0; i <= n; i++) {
      const idx = Math.min(xs.length - 1, Math.round(i / n * lastIdx));
      values.push(Math.round(xs[idx] * 1e4) / 1e4);
    }
    values[values.length - 1] = 1;
    return { duration, values, overshoots: max > 1.001 };
  }
  var linearOK = null;
  function supportsLinear() {
    if (linearOK == null) {
      linearOK = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
    }
    return linearOK;
  }
  var cache = /* @__PURE__ */ new Map();
  var evalCache = /* @__PURE__ */ new Map();
  function easingFunction(spec) {
    let fn = evalCache.get(spec);
    if (fn) return fn;
    const lin = /^linear\(([^)]+)\)$/.exec(spec.trim());
    const bez = /^cubic-bezier\(([^)]+)\)$/.exec(spec.trim());
    if (lin) {
      const values = lin[1].split(",").map(Number);
      fn = (t) => {
        if (t <= 0) return values[0];
        if (t >= 1) return values[values.length - 1];
        const f = t * (values.length - 1);
        const i = Math.floor(f);
        return values[i] + (values[i + 1] - values[i]) * (f - i);
      };
    } else if (bez) {
      const [x1, y1, x2, y2] = bez[1].split(",").map(Number);
      fn = (t) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const xm = 3 * mid * (1 - mid) * (1 - mid) * x1 + 3 * mid * mid * (1 - mid) * x2 + mid ** 3;
          if (xm < t) lo = mid;
          else hi = mid;
        }
        const u = (lo + hi) / 2;
        return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
      };
    } else if (spec === "ease") {
      fn = easingFunction("cubic-bezier(0.25, 0.1, 0.25, 1)");
    } else if (spec === "ease-in") {
      fn = easingFunction("cubic-bezier(0.42, 0, 1, 1)");
    } else if (spec === "ease-out") {
      fn = easingFunction("cubic-bezier(0, 0, 0.58, 1)");
    } else if (spec === "ease-in-out") {
      fn = easingFunction("cubic-bezier(0.42, 0, 0.58, 1)");
    } else {
      fn = (t) => Math.min(1, Math.max(0, t));
    }
    evalCache.set(spec, fn);
    return fn;
  }
  function resolveTransition(t, reducedMotion = false) {
    if (reducedMotion) return { duration: 0, easing: "linear" };
    const cfg = t ?? "smooth";
    if (typeof cfg === "object" && "duration" in cfg) {
      return {
        duration: cfg.duration,
        easing: cfg.ease ?? "cubic-bezier(0.22, 1, 0.36, 1)"
      };
    }
    const spring = typeof cfg === "string" ? presets[cfg] : { stiffness: 300, damping: 24, mass: 1, ...cfg };
    const key = `${spring.stiffness}/${spring.damping}/${spring.mass}/${supportsLinear()}`;
    let resolved = cache.get(key);
    if (!resolved) {
      const sim = simulate(spring);
      resolved = {
        duration: Math.round(sim.duration * 1e3),
        easing: supportsLinear() ? `linear(${sim.values.join(", ")})` : sim.overshoots ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "cubic-bezier(0.22, 1, 0.36, 1)"
      };
      cache.set(key, resolved);
    }
    return resolved;
  }

  // C:/Users/yuemi/AppData/Local/Temp/opencode/libraries-dev/packages/liquid-gooey/src/shadow.ts
  function splitTop(s, sep) {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }
  var LENGTH = /^[+-]?(\d+\.?\d*|\.\d+)(px)?$/;
  function parseShadow(input) {
    if (!input || input.trim() === "" || input.trim() === "none") return [];
    const out = [];
    for (const layer of splitTop(input, ",")) {
      const tokens = splitTop(layer, " ");
      if (tokens.length === 0) continue;
      const inset = tokens.includes("inset");
      const nums = [];
      const colorParts = [];
      for (const tok of tokens) {
        if (tok === "inset") continue;
        if (nums.length < 4 && LENGTH.test(tok)) nums.push(parseFloat(tok));
        else colorParts.push(tok);
      }
      const [x = 0, y = 0, blur = 0, spread = 0] = nums;
      out.push({ x, y, blur, spread, color: colorParts.join(" ") || "rgba(0, 0, 0, 0.35)", inset });
    }
    return out;
  }
  return __toCommonJS(vanilla_entry_exports);
})();
