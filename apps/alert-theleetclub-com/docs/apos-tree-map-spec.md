# APOS Tree Map — Reference Spec

Source: reference promotional recording of [skilltree.altari.ai/map](https://skilltree.altari.ai/map)  
Files: `uploads/307b156fcb09c404b91849ce61cafca94cd3869042f46657ce5f110d19566b92_*.mp4` (720×1280 phone capture of ultrawide monitor, 30 fps, ~48.9 s; three copies identical).  
Clean stills: `assets/f_02…f_16.jpg`, `assets/grid.jpg`.  
Extracts: `artifacts/ref-frames-10fps/f_XXXX.jpg` (10 fps), contact sheets `artifacts/ref-contact/contact-sheet-map.jpg`, `contact-sheet-assets.jpg`.

Frame index convention: **Fnnnn** = 10 fps extract (`t = (n-1)/10` s). Asset stills cited as **A-fXX**. Map segments only — chat/code/landing screens skipped (e.g. t≈14 s knowledge-base UI, late marketing copy pages).

---

## 1. Canvas & scene framing

| Property | Measurement | Evidence |
|---|---|---|
| Intended aspect | ≈ 21:9 ultrawide (monitor), not the phone crop | A-f02, A-f03, A-grid |
| Safe map area | Full viewport minus top bar (~48 px) and bottom crumb (~56 px) | A-f02 |
| Overview fill | Hub ring + trees occupy ~78–85% of map height; outer tips near edges | F0015–F0030, A-grid |
| Hub-focus fill | Focused tree fills ~70–80% height; hub orb sits ~18–25% from bottom | A-f02, A-f03, F0061–F0101 |
| Neighbor peek | Adjacent hub trees clipped at L/R edges, dimmed | A-f02 right edge, A-f03 |

**Background gradient (dark indigo skilltree)**  
Radial, not flat:

- Centre soft stop ≈ `#4a4880` → mid `#3b3a6b` → edge `#2e2d55` / `#1e1d3a`
- Optional second ellipse highlight behind focused hub (~55% × 50%, opacity ~0.35)
- Evidence: A-f02, A-f03, F0021

**Starfield**  
Sparse tiny white/blue-white dots, radius 0.4–1.6 px screen, opacity 0.15–0.55, slow twinkle. Count ≈ 120–180 on 1920×1080. Evidence: A-f02 grain, F0021.

---

## 2. Core (APOS centre)

| Property | Spec | Evidence |
|---|---|---|
| Form | Dense particle nebula, not a flat disc | F0015–F0030, A-grid centre |
| Particle count | ≈ 180–280 bright motes + soft glow bloom | A-grid |
| Size | Core cloud diameter ≈ 9–12% of min(viewport) | F0021 |
| Drift | Slow radial drift / Brownian; speed ≈ 4–10 world-units/s | Motion streaks 0.3–1.0 s idle energy |
| Glow | Additive white bloom, feathered falloff | A-grid |
| Wordmark | Optional faint “APOS” in core (our product); reference has no word | Product choice |

---

## 3. Hub ring & orbs

| Property | Spec | Evidence |
|---|---|---|
| Count | Reference: **7** hubs on a circle; our product: **5** brands (Leet, EE, Park, SA, AE) on same geometry | A-grid, F0021 |
| Ring radius | ≈ 32–36% of half-min-viewport (trees grow outward to ~80% height) | F0021 |
| Orb diameter | ≈ 14–18 px screen (constant under zoom via counter-scale) | A-f02, A-f03 |
| Ring | Thin coloured stroke, + soft outer glow matching accent | A-f02 coral ring, A-f03 rose |
| Focus ring | Brighter, ~2.2–2.8 px effective, stronger glow | A-f02 |
| Accents (ref) | Teal, sky, violet, amber, rose/magenta, pink, indigo — one per hub | A-grid labels |
| Accents (ours) | Leet teal `#6ed4d0`, EE violet `#b8a0e8`, Park rose `#e8a0b8`, SA amber `#e8c078`, AE sky `#7ec8e8` | Product |

---

## 4. Tree geometry

| Depth | Node screen Ø | Segment length (relative) | Fan |
|---|---|---|---|
| Hub→area | 6–7 px | Long trunk ≈ 0.38–0.42 of tree radius | Sweep ≈ 100–140° outward |
| Area→site | 5.5–6.5 px | Medium ≈ 0.28–0.32 | Slightly tighter |
| Site→machine | 5–6 px | Short ≈ 0.20–0.24 | Open tips |
| Machine→branch | 4.5–5.5 px | Leaf ring ≈ 0.10–0.12 | Full 360° at deep zoom |

**Lines**

- Straight segments between nodes (jointed at each node — not Bézier spaghetti)
- Width ≈ **1.1–1.35 px screen-constant** (`non-scaling-stroke` / strokeWidth / k)
- Opacity ≈ **0.45–0.55** white (`rgba(255,255,255,0.5)`)
- First segment from focused hub tinted with hub accent (subtle)
- Focused path: accent colour, opacity ≈ 0.85–0.95, width ≈ 1.5–2 px + soft glow
- Evidence: A-f02, A-f03, F0061

**Curvature**  
Reference uses mostly straight polylines with slight zig at joints. Organic feel comes from angle jitter (±2–4°) and uneven child counts, not heavy curves. Light quadratic bend (≤6% of chord) is acceptable if it stays thin and readable.

---

## 5. Labels & typography

| Level | Font | Size | Weight | Tracking | Colour |
|---|---|---|---|---|---|
| Hub title (overview) | Display serif ≈ Cormorant Garamond / Cinzel | 22–28 px | 500–600 | 0.28–0.4 em | White 85–95% |
| Hub title (focused) | Same | 32–40 px | 600 | 0.32–0.42 em | **Hub accent** |
| Hub subtitle | Manrope / Inter | 9–11 px | 400 | 0.12–0.18 em | White 35–45% |
| Area | Manrope | 11–12 px | 500 | 0.04 em | White 85% |
| Site | Manrope | 10 px | 500 | 0.04 em | White 70% |
| Machine | Manrope | 9 px | 500 | 0.02 em | White 70%; only on hover / deep zoom |
| Branch | Manrope | 9 px | 500 | — | White 75% at leaf zoom |

Labels stay **constant screen size**, anchored near node, collision-nudged. Evidence: A-f02 “SALES” + subtitle; A-f03 peach/rose title.

Closest web fonts (already loaded): **Cormorant Garamond** (hub titles), **Manrope** (UI / node labels).

---

## 6. Motion (critical)

### 6.1 Idle
- Core particles drift continuously
- Hubs breathe ±1–1.5% scale @ ~0.7 Hz
- Occasional soft signal pulses along random drawn edges (~1–3 Hz ambient)
- Respect `prefers-reduced-motion` (freeze idle; snaps for camera)
- Evidence: continuous low energy F0001–F0010; A-grid “live” feel

### 6.2 Click → fly (hub / area / site / machine)
Measured from high-energy streaks on map segments (phone shake included — treat as upper bound):

| Phase | Duration | Easing | Visual |
|---|---|---|---|
| Camera flight | **850–1000 ms** (target **900 ms**) | Cubic in-out (easeCubicInOut) | Pan+zoom via interpolateZoom (view: cx, cy, width) |
| Unrelated fade | Parallel 200–350 ms | Ease-out | Off-path hubs/trees → opacity ≈ 0.18–0.28 |
| Focus brighten | Parallel | — | Focus path + subtree → 1.0; accent on path |
| Child grow-in | Start ~80 ms after click | Stagger **40 ms** × index, duration **260–300 ms**, easeCubicOut | Children scale 0.35→1 + fade 0→lodAlpha |
| Interrupt | Immediate | New flight from **current** mid-transform | No snap to old target |

Evidence: hub switch streaks ≈ 0.7–1.1 s (F0052–F0094 region); grow visible as tree “bloom” into frame on A-f02 vs overview A-grid.

### 6.3 Chevron ‹ › hub cycle
- Cycles sibling hubs (overview: around ring; focused: next brand hub)
- Same fly camera as click (~900 ms)
- Updates crumb + accent title
- Evidence: A-f02 bottom chevrons; F0061–F0101 hub carousel feel

### 6.4 Hover
- Cursor pointer
- Node scale ≈ **1.25–1.35×** with soft white glow
- Label brightens; tooltip (name + 1 key stat) near cursor
- Evidence: focused ring around a tip node in A-f02

### 6.5 Esc / back
- Closes card/task first; else flies to parent; from hub → overview
- Evidence: product UX (reference uses “← ALL DEPARTMENTS” on deep cards, A-f12)

### 6.6 Top / bottom UI
- Top: brand mark + Map|Dashboards pills (MAP active = filled light pill)
- Bottom: ‹ crumb trail › — crumb updates with focus; does not slide away during flight
- Zoom +/-/reset floating bottom-right
- Evidence: A-f02, A-f03, F0021

---

## 7. Cards & interaction chrome

- Dark translucent card, thin border, accent-coloured title
- KPI rows for rollups; branch rows for leaf metrics
- Task flow from Operators/Tech (and general “New task”)
- Evidence: A-f12 card density / typography hierarchy (adapted to APOS ops content, not skilltree marketing copy)

---

## 8. Business data mapping (ours)

| Reference concept | APOS mapping |
|---|---|
| Centre nebula | APOS enterprise core |
| Department hubs | Brand hubs: Leet, EE, Park (+ SA/AE planned) |
| Primary limbs | Areas |
| Secondary | Sites (locations) |
| Tips | Machines |
| Leaf skills | 5 branches: Revenue, Operators, Technical, Stock, Contract |

Logic required: realistic mock values; alert thresholds (stock &lt;15%, offline &gt;2 h, revenue &lt;70% baseline); rollup badges; path signals (tx soft white, alert `#ff6b7a`).

---

## 9. Engine requirements (rebuild)

1. **Single world canvas** at `devicePixelRatio` (2D with additive glow / `shadowBlur`) — 60 fps.
2. Thin DOM: hub labels, node labels, tooltip, cards, crumbs, chrome.
3. Invisible hit targets (`[data-id]`) for pointer + tests.
4. One interruptible camera (900 ms cubic, mid-flight redirect).
5. LOD + expand-only-focused-path when drilled; overview shows all hub trees.
6. Prefer-reduced-motion respected.

---

## 10. Verification artefacts

| Artefact | Path |
|---|---|
| 10 fps frames | `artifacts/ref-frames-10fps/` |
| Contact sheet (video) | `artifacts/ref-contact/contact-sheet-map.jpg` |
| Contact sheet (assets) | `artifacts/ref-contact/contact-sheet-assets.jpg` |
| Side-by-side flow | `artifacts/compare-flow.mp4` (ours \| reference) |
| Still compares | `artifacts/compare-full.png`, `compare-hub.png`, `compare-leaf.png` |
