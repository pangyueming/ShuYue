// ===== border-beam (vanilla port) =====
// Source: https://github.com/Jakubantalik/Libraries.dev · packages/border-beam (MIT © Jakub Antalik)
// Ported to framework-free JS for CogniBridge. Requires ./beam-css.js (global: BeamCSS).
//
// Usage:
//   const ctrl = applyBeam(element, { size:'md', colorVariant:'ocean', theme:'auto' });
//   ctrl.setActive(false);   // graceful fade-out
//   ctrl.destroy();          // unwrap and clean up
//
// Options mirror the React props: size ('sm'|'md'|'line'|'pulse-outside'|'pulse-inner'),
// colorVariant ('colorful'|'mono'|'ocean'|'sunset'|'forest'|'candy'|'ice'|'gold'),
// theme ('dark'|'light'|'auto'), duration, borderRadius, brightness, saturation,
// hueRange, glowSize, strength (0..1), staticColors, wrapperClass, wrapperStyle.
(function () {
    'use strict';
    var seq = 0;

    function systemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    // App-aware auto theme: body/documentElement `.dark` class or data-theme wins,
    // OS scheme as fallback — matches how host apps toggle themes via class.
    function appTheme() {
        var root = document.documentElement, body = document.body;
        if (body && body.classList && (body.classList.contains('dark'))) return 'dark';
        if (body && body.classList && (body.classList.contains('light'))) return 'light';
        var attr = root && root.getAttribute && root.getAttribute('data-theme');
        if (attr === 'dark' || attr === 'light') return attr;
        return systemTheme();
    }

    function applyBeam(el, opts) {
        if (!el) return null;
        opts = opts || {};
        var B = window.BeamCSS;
        if (!B) { console.error('[border-beam] beam-css.js not loaded'); return null; }

        var size = opts.size || 'md';
        var colorVariant = opts.colorVariant || 'colorful';
        var themeOpt = opts.theme || 'dark';
        var sizeConfig = B.sizePresets[size];
        var id = 'vb' + (++seq) + Date.now().toString(36);

        var state = {
            active: opts.active !== false,
            isActive: opts.active !== false,
            isFading: false,
            isVisible: true,
            detectedRadius: null,
            theme: themeOpt === 'auto' ? appTheme() : themeOpt
        };

        // --- wrapper: <div data-beam>{el}<div data-beam-bloom/></div> ---
        var wrapper = document.createElement('div');
        wrapper.dataset.beam = id;
        if (opts.wrapperClass) wrapper.className = opts.wrapperClass;
        if (opts.wrapperStyle) wrapper.style.cssText = opts.wrapperStyle;
        el.parentNode.insertBefore(wrapper, el);
        wrapper.appendChild(el);
        var bloom = document.createElement('div');
        bloom.setAttribute('data-beam-bloom', '');
        wrapper.appendChild(bloom);

        var styleTag = document.createElement('style');
        document.head.appendChild(styleTag);

        var themeMq = null, themeMo = null;
        function onTheme() {
            state.theme = themeOpt === 'auto' ? appTheme() : themeOpt;
            renderCss();
            applyAttrs();
        }

        function resolved() {
            var isPulse = size === 'pulse-inner' || size === 'pulse-outside';
            var themeConfig = B.sizeThemePresets[size][state.theme];
            var finalBorderRadius = opts.borderRadius != null ? opts.borderRadius
                : (state.detectedRadius != null ? state.detectedRadius : sizeConfig.borderRadius);
            var finalDuration = opts.duration != null ? opts.duration
                : (size === 'line' ? 3.1 : isPulse ? 2.3 : 1.96);
            var finalSaturation = opts.saturation != null ? opts.saturation : themeConfig.saturation;
            var finalBrightness = opts.brightness != null ? opts.brightness : (themeConfig.brightness != null ? themeConfig.brightness : 1.3);
            var hueRange = opts.hueRange != null ? opts.hueRange : 30;
            if (size === 'line') hueRange = Math.min(hueRange, 13);
            var staticColors = colorVariant === 'mono' ? true : !!opts.staticColors;
            return {
                isPulse: isPulse, themeConfig: themeConfig, finalBorderRadius: finalBorderRadius,
                finalDuration: finalDuration, finalSaturation: finalSaturation, finalBrightness: finalBrightness,
                hueRange: hueRange, staticColors: staticColors
            };
        }

        var pulseUnregister = null;
        var driverConfig = null;

        function renderCss() {
            var r = resolved();
            styleTag.textContent = B.generateBeamCSS({
                id: id,
                borderRadius: r.finalBorderRadius,
                borderWidth: sizeConfig.borderWidth,
                duration: r.finalDuration,
                strokeOpacity: r.themeConfig.strokeOpacity,
                innerOpacity: r.themeConfig.innerOpacity,
                bloomOpacity: r.themeConfig.bloomOpacity,
                innerShadow: r.themeConfig.innerShadow,
                hairlineOpacity: r.themeConfig.hairlineOpacity,
                size: size,
                colorVariant: colorVariant,
                staticColors: r.staticColors,
                brightness: r.finalBrightness,
                saturation: r.finalSaturation,
                hueRange: r.hueRange,
                theme: state.theme,
                glowSize: opts.glowSize != null ? opts.glowSize : 1
            });
            driverConfig = r.isPulse
                ? B.getPulseDriverConfig(size, state.theme, r.finalDuration, r.hueRange, r.staticColors, id)
                : null;
        }

        function applyAttrs() {
            if (state.isActive && !state.isFading) wrapper.setAttribute('data-active', '');
            else wrapper.removeAttribute('data-active');
            if (state.isFading) wrapper.setAttribute('data-fading', '');
            else wrapper.removeAttribute('data-fading');
            if (state.isActive && !state.isFading && !state.isVisible) wrapper.setAttribute('data-paused', '');
            else wrapper.removeAttribute('data-paused');
            wrapper.style.setProperty('--beam-strength', String(Math.max(0, Math.min(1, opts.strength != null ? opts.strength : 1))));
            syncPulse();
        }

        // Shared breathing driver: on, onscreen, no reduced-motion (mirrors the React effect).
        function syncPulse() {
            if (!driverConfig) return;
            if (!(state.isActive || state.isFading) || !state.isVisible) { unregisterPulse(); return; }
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { unregisterPulse(); return; }
            if (!pulseUnregister) pulseUnregister = B.registerPulseInstance(wrapper, driverConfig);
        }
        function unregisterPulse() {
            if (pulseUnregister) { pulseUnregister(); pulseUnregister = null; }
        }

        function onAnimEnd(e) {
            var name = e.animationName || '';
            if (name.indexOf('fade-out') !== -1) {
                state.isActive = false; state.isFading = false; applyAttrs();
                if (opts.onDeactivate) opts.onDeactivate();
            } else if (name.indexOf('fade-in') !== -1) {
                if (opts.onActivate) opts.onActivate();
            }
        }

        // Auto-detect the wrapped element's border radius (re-detect on child swaps).
        var mo = null;
        if (opts.borderRadius == null) {
            var detect = function () {
                var raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
                if (!isNaN(raw) && raw > 0 && raw !== state.detectedRadius) {
                    state.detectedRadius = raw; renderCss();
                }
            };
            detect();
            mo = new MutationObserver(detect);
            mo.observe(wrapper, { childList: true, subtree: false });
        }

        // Pause paint-heavy animations while offscreen.
        var io = typeof IntersectionObserver !== 'undefined'
            ? new IntersectionObserver(function (entries) {
                for (var i = 0; i < entries.length; i++) state.isVisible = entries[i].isIntersecting;
                applyAttrs();
            }, { rootMargin: '256px' })
            : null;
        if (io) io.observe(wrapper);

        // pulse-outside: per-axis glow scaling for non-reference element sizes.
        var roGlow = null;
        if (size === 'pulse-outside') {
            var REF_W = 350, REF_H = 140;
            var clampS = function (v) { return Math.max(0.35, Math.min(4, v)); };
            var measureGlow = function () {
                var rect = el.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                wrapper.style.setProperty('--pulse-glow-sx', clampS(+(rect.width / REF_W).toFixed(3)));
                wrapper.style.setProperty('--pulse-glow-sy', clampS(+(rect.height / REF_H).toFixed(3)));
            };
            measureGlow();
            if (typeof ResizeObserver !== 'undefined') {
                roGlow = new ResizeObserver(measureGlow);
                roGlow.observe(el);
            }
        }

        var themeListener = null;
        if (themeOpt === 'auto' && window.matchMedia) {
            themeMq = window.matchMedia('(prefers-color-scheme: dark)');
            themeListener = function () { onTheme(); };
            if (themeMq.addEventListener) themeMq.addEventListener('change', themeListener);
            if (typeof MutationObserver !== 'undefined') {
                themeMo = new MutationObserver(onTheme);
                themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
                if (document.body) themeMo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
                else document.addEventListener('DOMContentLoaded', function () {
                    if (document.body) themeMo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
                });
            }
            state.theme = appTheme();
        }

        wrapper.addEventListener('animationend', onAnimEnd);
        renderCss();
        applyAttrs();
        if (!state.active) { state.isFading = false; state.isActive = false; applyAttrs(); }
        if (size === 'pulse-outside') {
            var r0 = resolved();
            wrapper.style.setProperty('--pulse-glow-sx', '1');
            wrapper.style.setProperty('--pulse-glow-sy', '1');
            // re-measure after the CSS lands
            requestAnimationFrame(function () {
                var rect = el.getBoundingClientRect();
                if (rect.width) {
                    wrapper.style.setProperty('--pulse-glow-sx', String(Math.max(0.35, Math.min(4, +(rect.width / 350).toFixed(3)))));
                    wrapper.style.setProperty('--pulse-glow-sy', String(Math.max(0.35, Math.min(4, +(rect.height / 140).toFixed(3)))));
                }
                void r0;
            });
        }

        return {
            el: wrapper,
            setActive: function (on) {
                if (on && !state.isActive && !state.isFading) { state.isActive = true; applyAttrs(); }
                else if (!on && state.isActive && !state.isFading) { state.isFading = true; applyAttrs(); }
            },
            destroy: function () {
                unregisterPulse();
                wrapper.removeEventListener('animationend', onAnimEnd);
                if (io) io.disconnect();
                if (mo) mo.disconnect();
                if (roGlow) roGlow.disconnect();
                if (themeMq && themeMq.removeEventListener) themeMq.removeEventListener('change', themeListener);
                if (themeMo) themeMo.disconnect();
                styleTag.remove();
                if (wrapper.parentNode) wrapper.parentNode.insertBefore(el, wrapper);
                wrapper.remove();
                el.style.removeProperty('--beam-strength');
            }
        };
    }

    window.BorderBeam = { apply: applyBeam };
})();
