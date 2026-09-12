# Vendor effects (Libraries.dev ports)

Vanilla (framework-free) ports of three libraries from
[Libraries.dev](https://github.com/Jakubantalik/Libraries.dev) by Jakub Antalik — **MIT License, © Jakub Antalik**.
Bundles (`beam-css.js`, `orbs-engine.js`, `gooey-core.js`) are compiled from the
upstream TypeScript sources with esbuild (IIFE globals `BeamCSS` / `OrbsEngine` / `GooeyCore`);
the sibling `*.js` wrappers are hand-ported runtime shells replacing the React lifecycle.

## Files

| File | Global | API |
|---|---|---|
| `beam-css.js` + `border-beam.js` | `BeamCSS` / `BorderBeam` | `BorderBeam.apply(el, {size, colorVariant, theme, duration, strength, …}) → {setActive, destroy}` |
| `orbs-engine.js` + `thinking-orbs.js` | `OrbsEngine` / `ThinkingOrb` | `ThinkingOrb.create(container, {state, size, theme, speed, …}) → {setPaused, setState, destroy}` |
| `gooey-core.js` + `liquid-gooey.js` | `GooeyCore` / `LiquidGooey` | `LiquidGooey.create(stage, {fill, shadow, blur, contrast, …}) → {item(el, {effect}), destroy}` |

## Usage in this app

- AI chat / Math Tutor "Thinking…" bubbles use `orbThinking()` (see `app/init.js`).
- See `demo-effects.html` in the project root for live examples of all three.
- Wrapper behaviors preserved from upstream: `prefers-reduced-motion`, offscreen
  pause (IntersectionObserver), shared ~30fps pulse loop, live theme detection.

## Not ported

`thinking-orbs` gravity interaction; `liquid-gooey` dissolve/image-melt/mirrored
transitions and the `img-fx` / `metal-fx` packages.
