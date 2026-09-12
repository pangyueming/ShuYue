// ===== thinking-orbs (vanilla port) =====
// Source: https://github.com/Jakubantalik/Libraries.dev · packages/thinking-orbs (MIT © Jakub Antalik)
// Ported to framework-free JS for CogniBridge. Requires ./orbs-engine.js (global: OrbsEngine).
//
// Usage:
//   const orb = createOrb(container, { state:'searching', size:20, theme:'auto' });
//   orb.setPaused(true); orb.setState('solving'); orb.destroy();
//
// Options: state (9 verbs, default 'working'), size (px, default 64), theme
// ('auto'|'dark'|'light'), speed (multiplier), paused, color (tint), dots,
// dotSize, ariaLabel.
(function () {
    'use strict';
    var E = window.OrbsEngine;
    if (!E) { console.error('[thinking-orbs] orbs-engine.js not loaded'); return; }

    function ancestorTheme(el) {
        var node = el;
        while (node) {
            var attr = node.getAttribute && node.getAttribute('data-theme');
            if (attr === 'dark') return true;
            if (attr === 'light') return false;
            if (node.classList && (node.classList.contains('dark'))) return true;
            if (node.classList && (node.classList.contains('light'))) return false;
            node = node.parentElement;
        }
        return null;
    }
    function systemDark() {
        return typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches;
    }
    function reducedMotion() {
        return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function createOrb(container, opts) {
        if (!container) return null;
        opts = opts || {};
        var state = opts.state || 'working';
        var size = opts.size != null ? opts.size : 64;
        var theme = opts.theme || 'auto';
        var speedMul = opts.speed != null ? opts.speed : 1;
        var paused = !!opts.paused;

        var canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        canvas.style.display = 'block';
        if (opts.style) canvas.style.cssText += ';' + opts.style;
        container.appendChild(canvas);

        var dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        var ctx = canvas.getContext('2d');
        if (!ctx) return { canvas: canvas, destroy: function () { canvas.remove(); } };

        var dark = theme === 'dark' ? true : theme === 'light' ? false : (ancestorTheme(canvas) ?? systemDark());
        var raf = 0, running = false, visible = true, disposed = false;
        var mqTheme = null, mqReduced = null, mo = null;

        function build() {
            var p = E.resolvePreset(state, size);
            var o = p.opts;
            if (opts.dots != null && opts.dots !== 1) o = E.scaleCounts(o, Math.max(0.1, opts.dots));
            if (opts.dotSize != null && opts.dotSize !== 1) o = E.scaleRadii(o, Math.max(0.1, opts.dotSize));
            if (opts.opts) o = Object.assign({}, o, opts.opts);
            return { frameFn: E.MODE_FRAMES[p.mode], opts: o, speed: p.speed * speedMul };
        }

        var built = build();
        canvas.setAttribute('aria-label', opts.ariaLabel || (E.ORB_LABELS && E.ORB_LABELS[state]) || state);

        function draw(tSec) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, size, size);
            E.paintFrame(ctx, built.frameFn(size, tSec, built.opts), dark, E.parseTint(opts.color));
        }

        function loop() {
            draw((performance.now() / 1000) * built.speed);
            if (running) raf = requestAnimationFrame(loop);
        }
        function start() {
            if (running || paused || disposed) return;
            running = true;
            raf = requestAnimationFrame(loop);
        }
        function stop() {
            running = false;
            cancelAnimationFrame(raf);
        }

        if (reducedMotion()) {
            draw(0.6);
        } else {
            draw((performance.now() / 1000) * built.speed);
            var io = typeof IntersectionObserver !== 'undefined'
                ? new IntersectionObserver(function (entries) {
                    visible = entries[0].isIntersecting;
                    if (visible && document.visibilityState !== 'hidden') start();
                    else stop();
                })
                : null;
            if (io) io.observe(canvas);
            var onVis = function () {
                if (document.visibilityState === 'hidden') stop();
                else if (visible) start();
            };
            document.addEventListener('visibilitychange', onVis);
            if (!io) start();
        }

        // Live theme: data-theme / .dark|.light ancestor flips + OS scheme.
        function resolveTheme() {
            if (theme === 'dark') { dark = true; return; }
            if (theme === 'light') { dark = false; return; }
            var fromTree = ancestorTheme(canvas);
            dark = fromTree == null ? systemDark() : fromTree;
            if (!reducedMotion() && !running && visible && !paused && document.visibilityState !== 'hidden') start();
        }
        if (theme === 'auto') {
            if (typeof matchMedia !== 'undefined') {
                mqTheme = matchMedia('(prefers-color-scheme: dark)');
                if (mqTheme.addEventListener) mqTheme.addEventListener('change', resolveTheme);
            }
            if (typeof MutationObserver !== 'undefined') {
                mo = new MutationObserver(resolveTheme);
                mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'], subtree: true });
            }
        }

        return {
            canvas: canvas,
            setPaused: function (p) {
                paused = p;
                if (p) stop(); else if (visible && document.visibilityState !== 'hidden' && !reducedMotion()) start();
            },
            setState: function (s) {
                state = s;
                built = build();
                canvas.setAttribute('aria-label', opts.ariaLabel || (E.ORB_LABELS && E.ORB_LABELS[state]) || state);
                draw((performance.now() / 1000) * built.speed);
            },
            destroy: function () {
                disposed = true;
                stop();
                document.removeEventListener('visibilitychange', onVis);
                if (io) io.disconnect();
                if (mo) mo.disconnect();
                if (mqTheme && mqTheme.removeEventListener) mqTheme.removeEventListener('change', resolveTheme);
                canvas.remove();
            }
        };
    }

    window.ThinkingOrb = { create: createOrb };
})();
