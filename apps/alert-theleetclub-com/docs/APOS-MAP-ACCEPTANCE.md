# APOS map acceptance

Applies to all three pages: tree (`apos-tree-map.html`), space (`apos-space-map.html`), and 3D (`apos-3d-map.html`). A line passes only when the measurement below is true. The runner is `test-apos-acceptance.mjs`.

## Flow / camera

1. **F1 Smooth.** During every focus flight, scale stays inside 4% of the closed interval between the start scale and the end scale (no overshoot, no snap past the target). When two samples are less than 50ms apart, neither step covers more than 72% of the log-scale travel. A host that coalesces frames (headless WebGL often does) is not scored as a jump.
2. **F2 Budget.** After the walk, `getFrameStats().median` is ≤ 16ms and `n` ≥ 8. That is the 60fps CPU budget. Headless refresh is not required to be 60Hz.
3. **F3 Prior view.** Esc, back (`goBack`), and a breadcrumb click return the camera to the exact transform captured before that navigation: scale within 0.02, translation within 1.5px, same focus id. Overlay Esc closes the card or task first; the next Esc restores the view.
4. **F4 Centred.** The focused node’s screen position is inside 22% of the usable width and height. Usable area is the stage minus the top HUD (64px), bottom chrome (78px), and the inspector when it is open.
5. **F5 Zoom out restores context.** Pulling scale down (back, or `setZoomK` toward the overview floor) keeps sibling hubs/brands drawn. Context alpha rises as scale falls; nodes are not deleted and popped back in.

## Relations

1. **R1 Path.** Every hop from the focused node to APOS exists. Both ends are drawn, or the core is off-screen and the APOS edge chip is visible.
2. **R2 Siblings.** Other nodes with the same parent and type stay drawn. When scale ≥ 1.25 (2D) or the camera is in close (3D), their alpha is ≤ 0.85. They are never removed.
3. **R3 No dangling lines.** `pathLinksVisible` is true for the focus. A link whose source or target is missing is a failure.
4. **R4 No crossings.** `countLinkCrossings()` is 0. 2D counts drawn tree curves that do not share a vertex. 3D counts visible edges whose ground (x, z) segments cross without sharing a vertex.
5. **R5 Labels match.** Every visible label’s text contains that node’s label, and the node id on the element is the node it is placed against.
6. **R6 No label overlap.** Visible label boxes (opacity ≥ 0.2, at least 2×2px) do not intersect by more than 1px.

## Data logic

1. **D1 Rollups.** For every non-branch node, revenue today, alert count, and offline count equal the sum of descendant machines. Parent totals equal the sum of their children. Enterprise is included.
2. **D2 One number.** Badge (`alertCount`), `nodeFacts`, the inspector rows, and the tooltip fields for revenue, alerts, offline, and stock come from that same rollup. 3D HUD text, when HUD mode is on, shows the enterprise alert count and the rounded enterprise revenue.
3. **D3 Live.** An offline event increments the machine and every ancestor, then restores status and the previous alert totals within 9s. A low-stock event clamps fill below 15% and restores the previous fill on the same timer. Sale revenue is cumulative and is not reverted.
4. **D4 Possible values.** No machine has fill outside 0–100, negative or non-finite revenue, or an empty label. No displayed value is `NaN` or `undefined`.

## Views

1. **V1 Question per level.** Overview draws every hub/country and at least one alert badge when the data has alerts (where are the problems). Brand/area/country focus draws its child sites (which sites need action). Machine focus draws the five branch labels and the drawer names the machine (what is wrong and who is assigned).
2. **V2 In frame.** Focus and direct-child labels lie fully inside the usable rect (2px tolerance), not under the drawer or the header.
3. **V3 Sizes.** V1 and V2 hold at 1366×768, 1920×1080, and 2560×1440.
4. **V4 Browsers.** The same checks pass in Chromium and Firefox.

## Robustness

1. **B1 Stress.** 200 mixed actions (fly, Esc, wheel, click, resize, hide/show) leave no page errors and no console errors. Afterwards the focus id exists, the transform is finite, and `auditData()` is empty.
