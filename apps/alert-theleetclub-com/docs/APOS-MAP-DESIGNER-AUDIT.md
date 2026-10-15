# APOS Map Designer Audit (tree + space)

Shared engine: `public/apos-map-engine.js` · themes: `apos-tree-map.js` / `apos-space-map.js`

## Findings fixed

| # | Surface | State | Issue | Fix |
|---|---------|-------|-------|-----|
| 1 | Both | architecture | Divergent layout/LOD/camera copies | Extracted shared engine; thin theme mounts |
| 2 | Space | load / overview | Legacy polar map, not tidy-tree | `countryTree` layout on same engine |
| 3 | Space | overview | No official logo | Header logo + core wordmark (white invert) |
| 4 | Space | overview | Flat starfield | Multi-layer parallax stars + muted indigo/teal nebulae |
| 5 | Space | drill | Broken/stub links | Continuous centre→centre Bézier with length fade |
| 6 | Space | pan/zoom | Focus steal / stale expansion | Pure derive from focus + zoom; pan-safe |
| 7 | Space | task | Terminal missing / modal used | Green fluorescent terminal retained as task UI |
| 8 | Space | task | Branch card stacked under terminal | `openTask` closes leaf/branch card first |
| 9 | Space | alerts | SVG badge assertions stale | Canvas rollup pills (same as tree) |
| 10 | Space | framing | Client/country underfilled | Fit rules for `country` / `client` |
| 11 | Tree | regression | Engine extract risk | Full Playwright suite still green |
| 12 | Both | idle | Mid-flight idle race | `flying` set after interrupt; 2-frame idle |

## Audit checklist (passed)

- Load / first paint: both show core + ring within first frames
- Overview: tree brand hubs; space KW/SA/AE countries + KW brands
- Levels: hub/country → brand/area → site → machine → 5 branches
- Cards: leaf/branch beside node with leader
- Task: tree modal; space green terminal
- Hover: soft halo, no starburst
- Zoom/pan stress: overview snapshot restores
- Alerts: red rollup pills on path nodes
- Signals: white normal / red alert pulses

## Stills

Tree: `level-full|hub|area|site|machine|branch-card.png`, `pan-zoom-stress.png`  
Space: `space-level-full|country|brand|area|site|machine|branch-card|terminal.png`, `space-pan-zoom-stress.png`
