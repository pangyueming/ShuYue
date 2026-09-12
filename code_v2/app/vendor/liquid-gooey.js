// ===== liquid-gooey (vanilla port) =====
// Source: https://github.com/Jakubantalik/Libraries.dev · packages/liquid-gooey (MIT © Jakub Antalik)
// Ported to framework-free JS for CogniBridge. Requires ./gooey-core.js (global: GooeyCore).
//
// Architecture preserved from the original:
//   - Silhouette SVG layer carries the goo (blur + alpha-contrast filter on SVG
//     content, never CSS url() on HTML — the WebKit-correct variant) and the
//     spread/inset shadows; blurred/offset outer shadows ride the compositor as
//     CSS drop-shadow() on the <svg> element.
//   - Your real DOM stays crisp above the liquid; it is never filtered.
//   - ObserveEngine mirrors each item's rendered rect into a blob <rect>; merge
//     physics, springs and droplets live in the engine (gooey-core.js).
//
// Usage (observe mode — animate the element however you like, the liquid follows):
//   const goo = createGooey(container, { fill:'#fff', shadow:'0 2px 6px rgba(0,0,0,.08)' });
//   const it = goo.item(el, { effect:['morph','move'], move:{ springiness:.5 } });
//   it.destroy(); goo.destroy();
(function () {
    'use strict';
    var G = window.GooeyCore;
    if (!G) { console.error('[liquid-gooey] gooey-core.js not loaded'); return; }

    var SVGNS = 'http://www.w3.org/2000/svg';
    // Alpha-binarize before spread dilation (keeps the soft fringe from reading
    // as a second hairline) — identical to filter.tsx BINARIZE.
    var BINARIZE = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5';

    function el(name, attrs) {
        var n = document.createElementNS(SVGNS, name);
        for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
        return n;
    }

    /** Rebuild of filter.tsx GooFilterPrimitives as vanilla SVG DOM. */
    function buildFilterPrimitives(filter, blur, contrast, shadows, waviness, wavinessFreq) {
        filter.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: blur, result: 'blur' }));
        var intercept = Math.round((0.5 - contrast * (5 / 12)) * 100) / 100;
        filter.appendChild(el('feColorMatrix', {
            in: 'blur', type: 'matrix',
            values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' + contrast + ' ' + intercept,
            result: 'goo'
        }));
        var wavy = waviness > 0;
        filter.appendChild(el('feComposite', {
            in: 'SourceGraphic', in2: 'goo', operator: 'atop',
            result: wavy ? 'shape-raw' : 'shape'
        }));
        if (wavy) {
            filter.appendChild(el('feTurbulence', {
                type: 'fractalNoise', baseFrequency: wavinessFreq, numOctaves: 2, seed: 7, result: 'wave-noise'
            }));
            filter.appendChild(el('feDisplacementMap', {
                in: 'shape-raw', in2: 'wave-noise', scale: waviness * 2,
                xChannelSelector: 'R', yChannelSelector: 'G', result: 'shape'
            }));
        }
        if (shadows.some(function (s) { return s.inset || s.spread !== 0; })) {
            filter.appendChild(el('feColorMatrix', { in: 'shape', type: 'matrix', values: BINARIZE, result: 'bin' }));
        }
        var mergeInputs = [];
        shadows.forEach(function (s, i) {
            if (s.inset) {
                // InsetPass: colour where the silhouette is NOT covered by a
                // shrunk/offset/blurred copy of itself, clipped to the silhouette.
                var src1 = 'bin';
                if (s.spread !== 0) {
                    filter.appendChild(el('feMorphology', {
                        in: src1, operator: s.spread > 0 ? 'erode' : 'dilate', radius: Math.abs(s.spread), result: 's' + i + '-er'
                    }));
                    src1 = 's' + i + '-er';
                }
                if (s.x !== 0 || s.y !== 0) {
                    filter.appendChild(el('feOffset', { in: src1, dx: s.x, dy: s.y, result: 's' + i + '-o' }));
                    src1 = 's' + i + '-o';
                }
                if (s.blur > 0) {
                    filter.appendChild(el('feGaussianBlur', { in: src1, stdDeviation: s.blur / 2, result: 's' + i + '-b' }));
                    src1 = 's' + i + '-b';
                }
                filter.appendChild(el('feComposite', { in: 'bin', in2: src1, operator: 'out', result: 's' + i + '-band' }));
                filter.appendChild(el('feFlood', { 'flood-color': s.color, result: 's' + i + '-c' }));
                filter.appendChild(el('feComposite', { in: 's' + i + '-c', in2: 's' + i + '-band', operator: 'in', result: 's' + i }));
                mergeInputs.push({ in: 's' + i, inset: true });
            } else {
                // ShadowPass.
                var src2 = 'shape';
                if (s.spread !== 0) {
                    filter.appendChild(el('feMorphology', {
                        in: 'bin', operator: s.spread > 0 ? 'dilate' : 'erode', radius: Math.abs(s.spread), result: 's' + i + '-sp'
                    }));
                    src2 = 's' + i + '-sp';
                }
                if (s.blur > 0) {
                    filter.appendChild(el('feGaussianBlur', { in: src2, stdDeviation: s.blur / 2, result: 's' + i + '-b' }));
                    src2 = 's' + i + '-b';
                }
                if (s.x !== 0 || s.y !== 0) {
                    filter.appendChild(el('feOffset', { in: src2, dx: s.x, dy: s.y, result: 's' + i + '-o' }));
                    src2 = 's' + i + '-o';
                }
                filter.appendChild(el('feFlood', { 'flood-color': s.color, result: 's' + i + '-c' }));
                filter.appendChild(el('feComposite', { in: 's' + i + '-c', in2: src2, operator: 'in', result: 's' + i }));
                mergeInputs.push({ in: 's' + i, inset: false });
            }
        });
        if (shadows.length > 0) {
            var merge = el('feMerge', {});
            // CSS paints the first shadow on top: outer passes merge in reverse
            // BELOW the shape; inset passes paint ABOVE it.
            mergeInputs.filter(function (m) { return !m.inset; }).reverse().forEach(function (m) {
                merge.appendChild(el('feMergeNode', { in: m.in }));
            });
            merge.appendChild(el('feMergeNode', { in: 'shape' }));
            mergeInputs.filter(function (m) { return m.inset; }).forEach(function (m) {
                merge.appendChild(el('feMergeNode', { in: m.in }));
            });
            filter.appendChild(merge);
        }
    }

    /**
     * Create a gooey group over `container`.
     * opts: blur (6), contrast (18), fill ('#fff'), shadow (box-shadow syntax),
     * filterPadding (24), waviness (0), wavinessFreq (0.018).
     */
    function createGooey(container, opts) {
        if (!container) return null;
        opts = opts || {};
        var blur = opts.blur != null ? opts.blur : 6;
        var contrast = opts.contrast != null ? opts.contrast : 18;
        var fill = opts.fill != null ? opts.fill : '#fff';
        var filterPadding = opts.filterPadding != null ? opts.filterPadding : 24;
        var waviness = opts.waviness || 0;
        var wavinessFreq = opts.wavinessFreq || 0.018;

        var prevPos = container.style.position;
        var prevIso = container.style.isolation;
        container.style.position = 'relative';
        container.style.isolation = 'isolate';

        var shadows = G.parseShadow(opts.shadow);
        var svgShadows = shadows.filter(function (s) { return s.inset || s.spread !== 0; });
        var cssShadowFilter = shadows
            .filter(function (s) { return !s.inset && s.spread === 0; })
            .map(function (s) { return 'drop-shadow(' + s.x + 'px ' + s.y + 'px ' + s.blur + 'px ' + s.color + ')'; })
            .join(' ');
        var shadowExtent = svgShadows.reduce(function (m, s) {
            return Math.max(m, Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5 + Math.max(0, s.spread));
        }, 0);
        var pad = Math.ceil(blur * 3 + shadowExtent + filterPadding);

        var filterId = 'gooey-v' + Math.random().toString(36).slice(2, 9);
        var svg = el('svg', {
            'aria-hidden': 'true', 'data-gooey-svg': ''
        });
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:-1;will-change:filter,transform;';
        if (cssShadowFilter) svg.style.filter = cssShadowFilter;

        var defs = el('defs', {});
        var filter = el('filter', {
            id: filterId, filterUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB'
        });
        buildFilterPrimitives(filter, blur, contrast, svgShadows, waviness, wavinessFreq);
        defs.appendChild(filter);
        svg.appendChild(defs);
        var portal = el('g', { id: filterId + '-sil', filter: 'url(#' + filterId + ')' });
        portal.style.fill = fill;
        svg.appendChild(portal);
        container.insertBefore(svg, container.firstChild);

        function syncSize() {
            var w = container.offsetWidth, h = container.offsetHeight;
            filter.setAttribute('x', -pad);
            filter.setAttribute('y', -pad);
            filter.setAttribute('width', w + pad * 2);
            filter.setAttribute('height', h + pad * 2);
        }
        syncSize();
        var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
        if (ro) ro.observe(container);

        var engine = new G.ObserveEngine(function () { return container; });
        engine.gooBlur = blur;

        var items = [];
        var destroyed = false;

        return {
            el: container,
            svg: svg,
            /** Register an element as a gooey piece (observe mode).
             * itemOpts: effect ('morph'|'evolve'|'move' or array, default 'morph'),
             * evolve, move (tunings), radius (px override), blobInset, bridgeGrow. */
            item: function (targetEl, itemOpts) {
                if (destroyed || !targetEl) return null;
                itemOpts = itemOpts || {};
                var effects = Array.isArray(itemOpts.effect) ? itemOpts.effect
                    : [itemOpts.effect || 'morph'];
                var dynamics = {
                    evolve: effects.indexOf('evolve') !== -1,
                    move: effects.indexOf('move') !== -1,
                    evolveOpts: Object.assign({}, G.EVOLVE_DEFAULTS, itemOpts.evolve),
                    moveOpts: Object.assign({}, G.MOVE_DEFAULTS, itemOpts.move)
                };
                var hasDynamics = dynamics.evolve || dynamics.move;
                var blob = el('rect', { x: 0, y: 0, width: 0, height: 0 });
                blob.style.willChange = 'transform';
                blob.style.transformBox = 'fill-box';
                blob.style.transformOrigin = 'center';
                portal.appendChild(blob);
                var radius = itemOpts.radius != null
                    ? G.normalizeRadius(itemOpts.radius)[0]
                    : undefined;
                var unregister = engine.add({
                    target: targetEl,
                    blob: blob,
                    radius: radius,
                    blobInset: itemOpts.blobInset,
                    bridgeGrow: itemOpts.bridgeGrow,
                    dynamics: hasDynamics ? dynamics : undefined
                });
                var record = {
                    el: targetEl,
                    destroy: function () {
                        var i = items.indexOf(record);
                        if (i !== -1) items.splice(i, 1);
                        unregister();
                        blob.remove();
                    }
                };
                items.push(record);
                return record;
            },
            destroy: function () {
                destroyed = true;
                items.slice().forEach(function (it) { it.destroy(); });
                engine.dispose();
                if (ro) ro.disconnect();
                svg.remove();
                container.style.position = prevPos;
                container.style.isolation = prevIso;
            }
        };
    }

    window.LiquidGooey = { create: createGooey };
})();
