# APOS Gemini Video Spec — Tracktor Segundo Cérebro (Canvas Graph & HUD)

Inspiration extracted from the reference video via Gemini. **Use as inspiration, not a literal copy.** Keep APOS branding, Kuwait→Leet/EE/Park→areas→sites→machines→Revenue/Operators/Tech Support/Stock/Contract hierarchy, mock data, logo, and product rules: curved organic links, no overlaps, progressive LOD, one continuous zoom world, professional low-noise palette.

---

## Camera

| Behaviour | Spec |
|-----------|------|
| Pan / zoom settle | Exponential damping lerp **0.085 / frame** toward target |
| Fly-in | `cubic-bezier(0.25, 1, 0.5, 1)` |
| Pull-out / spring | `cubic-bezier(0.16, 1, 0.3, 1)`, **550 ms** |
| Depth of field | Blur **0 → 3.5 px** on unfocused outer nodes when zoomed in |

## Staggered intro

1. **t = 0** — core appears  
2. **+250 ms** — rays draw out from core  
3. **+400 ms** — orbit rings fade in  
4. Leaves spring out (stiffness **120**, damping **14**)

## Layout rings

| Level | Role | Radius (of half-width) |
|-------|------|------------------------|
| L0 | Core | Centre; offset **−160 px** when inspector drawer is open |
| L1 | Hubs / countries | **~38–42%**, even angular spacing + label repulsion |
| L2 | Brands / areas | **52–65%** |
| L3 | Leaves | Arc clusters at **70–88%**, up to **4** rows, **16 px** apart |

## Orbit guide rings

Three dotted concentric rings: **1 px** stroke, `dasharray 2,4`, very low alpha (`#ffffff14`). Key “governed system” feel.

## Nodes

| Tier | Geometry | Notes |
|------|----------|-------|
| Core | Outer Ø**96** (2 px dashed) + inner Ø**64**; glow 24 px α0.45 | Rotating tick rings: CW **1°/s**, CCW **0.6°/s** |
| L1 | Ø**24** ring + **7 px** centre dot; 1.5 px sector stroke; glow 12 px α0.35 | |
| L2 | Ø**12–16** | |
| L3 | Dots Ø**5–7** | |

- **Hover:** L1 ×1.25; leaf ×1.8 + mini tag  
- **Selected:** crosshair ticks / reticle  
- **Dimmed unrelated:** α **0.08–0.15**, desaturated  

## Core particles

- **120** particles at r **32–68 px**  
- Log-spiral rotation ω = **0.015 rad/frame** + Brownian σ **0.4**  
- **70/30** dual tint (adapt to APOS palette)

## Links

- Hub spokes: fade core → hub  
- Tree connectors: **0.6–0.8 px**, α **0.35**, sector colour (**APOS keeps curves**)  
- Cross-dependency arcs: cubic Bézier  
  - `P1 = P0 + (P0 − core) × 0.25`  
  - `P2 = P3 − (P3 − core) × 0.25`  
  - **1.5–2 px**, glow **10 px**, flowing light packets  
  - Draw-on **320 ms** ease-out  
- Hub hover/select: highlight related paths; fade **~95%** of the rest  
- **APOS mapping:** arcs = alert / task signals (e.g. tech support ↔ machine, operator routes)

## Palette (Oceano — dark map)

| Token | Value |
|-------|-------|
| Background | `radial-gradient(circle at 50% 45%, #0a1524, #04080e)` |
| Accent | `#00f2fe` |
| Cyan / teal | `#00f2fe` / `#05ffa1` |
| Amber | `#ffaa00` |
| Magenta | `#ff2a85` |
| Indigo | `#9d4edd` / `#6366f1` |
| Cards | `rgba(7,16,28,.85)` + blur 12 px + border `#00f2fe30` |
| Text | `#fff` / secondary `#7d93b2` |

Keep restrained. Tree map retains its indigo skilltree look; space map leans Oceano.

## Typography

- Titles: Inter / Space Grotesk  
- Metrics: JetBrains Mono–like  
- L1 labels: **11–12 px** bold uppercase, letter-spacing **1.2 px**, 2 px dark stroke  
- Leaf labels: **8.5–9.5 px** `#8fa8c8`, offset **+8 px**

## LOD

| Zoom | Behaviour |
|------|-----------|
| ≤ **1.2×** | Core, rings, L1 titles, leaf dots only |
| **1.4× → 2.0×** | Leaf labels fade in: `opacity = (z − 1.4) / 0.6` |
| Collision &lt; **14 px** | Ellipsis / cluster |
| &gt; **2.6×** | Detail badges; unfocused α **0.08** |

## Inspector & chrome

- Right glass inspector drawer with node metrics  
- Tooltip scale **0.92 → 1**  
- Layout-mode toggle **Radial ↔ Hex** (tween **600 ms** `easeInOutCubic`; hex R = **74 px**, stroke 1 px, tint `#00f2fe08`; deep zoom into hex shows micro-nodes)

## Background

- **250** stars on a 2× plane, parallax **0.2×** camera  
- Vignette: transparent at 40% → `rgba(1,4,10,.75)`  
- Optional scanlines **3 px** at **1.5%** alpha (dark map only)

## HUD cockpit

Full dashboard frame around the graph:

- **Left:** portfolio / clients  
- **Right:** team / alerts  
- **Bottom:** terminal  
- “Back to command” navigation  
- Fade crossfade **220 ms** between HUD and full-graph modes  

---

## APOS implementation surfaces

| Surface | File(s) | Role |
|---------|---------|------|
| Spec (this doc) | `docs/APOS-GEMINI-VIDEO-SPEC.md` | Inspiration source of truth |
| Shared 2D engine | `public/apos-map-engine.js` | Damped camera, rings, arcs, LOD, intro |
| Space theme | `apos-space-map.{html,js,css}` | Oceano dark + green terminal |
| Tree theme | `apos-tree-map.{html,js,css}` | Indigo video style + applicable Gemini parts |
| 3D constellation | `apos-3d-map.{html,js,css}` + vendored three.js | Marketing-grade 3D radial + HUD |

## Non-goals / keep ours

- Do **not** replace APOS hierarchy or mock data  
- Do **not** abandon curved organic links for straight spokes  
- Prefer **professional low noise** over maximal neon  
- Local commits only unless asked to push  
