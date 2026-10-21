(function () {
  const canvas = document.getElementById('alerts-canvas');
  const ctx = canvas.getContext('2d');
  const labelLayer = document.getElementById('label-layer');
  const focusBar = document.getElementById('focus-bar');
  const focusTitle = document.getElementById('focus-title');
  const focusSub = document.getElementById('focus-sub');
  const nodePanel = document.getElementById('node-panel');
  const corePanel = document.getElementById('core-panel');
  const panelBody = document.getElementById('panel-body');
  const coreBody = document.getElementById('core-body');
  const mapView = document.getElementById('map-view');
  const dashView = document.getElementById('dash-view');
  const dashGrid = document.getElementById('dash-grid');

  const SNAP = window.LEET_ALERTS_DATA.buildSnapshot();
  const CATS = SNAP.categories;
  const walk = window.LEET_ALERTS_DATA.walk;

  // Interaction constants from skilltree INTERACTION-NOTES (ref is source of truth)
  const EASE_CAM = 0.13;
  const EASE_WHEEL = 0.11;
  const DIM_OTHERS = 0.18; // skilltree #sky:has(.mini:hover) .mini:not(:hover)
  const NODE_FADED = 0.25;
  const HOVER_NODE_SCALE = 1.12; // skilltree .node:hover scale(1.12)
  const HOVER_CAT_SCALE = 1.1; // category icon brighten/scale on hover (~1.1×)
  // Overview leaf = solid ivory fill (default .jdot); hub = hollow .rootb
  const LEAF_R = 2.15; // ~solid bright dot (buildSky joint r≈1.8–2.4 at display scale)
  const LEAF_HOT_R = 2.6;
  const GROUP_DOT_R = 4; // mini fork fill r=4
  const IDLE_ROT_DEG_PER_S = 4; // video slow CW; map.html has no idle dial (hub hspin only)
  const FEATURED_SCALE = 1.05;
  const DRAG_CLICK_CANCEL = 8;
  const WHEEL_ZOOM_EXP = 0.0018; // plain-scroll feel (marketing video: smooth continuous)
  const ZOOM_STEP_IN = 1.25;
  const ZOOM_STEP_OUT = 0.8;
  const Z_FAN_MIN = 0.42;
  const Z_FAN_MAX = 5.8; // allow dive ~4–6× (skilltree fan deep + video)
  // Continuous canvas: full map (~1) → deep branch (3–5 nodes fill frame)
  const Z_SKY_MIN = 0.42;
  const Z_SKY_MAX = 5.8;
  const RISE_SCALE = 0.43;
  // LOD label thresholds (sky continuous zoom)
  const LOD_GROUP_IN = 1.25;
  const LOD_GROUP_FULL = 1.85;
  const LOD_NODE_IN = 2.35;
  const LOD_NODE_FULL = 3.2;
  const LOD_CAT_FADE_START = 1.45;
  const LOD_CAT_FADE_END = 2.4;
  const LABEL_FADE_MS = 500; // skilltree opacity .5s on chevrons / label tiers
  const SETTLE_MS = 250; // post-wheel camera settle (ref)
  const ARROW_FADE_ZOOM = 1.2; // hide ‹ › once zoomed past ~120%
  const MAX_VIEW_EMPTY = 0.25; // while zoomed in, ≤25% of viewport empty
  const FAN_SPAN = 182 * Math.PI / 180;
  const R0_FAN = 248;
  const R_BASE = 410;
  const R_STEP = 214;
  // Skilltree dive: seat → focusPoint → swapAfter 520 → transitioning 1250
  const DIVE_ALIGN_MS = 280;
  const DIVE_SWAP_MS = 520;
  const DIVE_MORPH_MS = 1200; // ~1.2s ease-in-out (video + user r18)
  const DIVE_ZOOM_TARGET = 4.8; // ~4–6× overview
  const TRANSITIONING_MS = 1250;
  const RISE_MS = 900; // reverse dive ~700–1000ms
  const HOVER_FADE_MS = 350; // ref CSS transitionMs
  // Stroke / node constants from skilltree map.html
  const STROKE_SPOKE = 1.5;
  const STROKE_SPOKE_OP = 0.14;
  const STROKE_BRANCH = 2;
  const STROKE_BRANCH_OP = 0.4;
  const JDOT_R = 7.5; // 15px hit/fan leaf base; drawn solid ivory (not hollow)
  const ROOTB_R = 26; // category hollow ring (sky); fan group rings larger
  const COPPER = '#C4A574';
  const GRID_STEP = 14;
  const GRID_ALPHA = 0.035; // softer than stark .05 canvas dots (CSS uses .05; we under-paint)
  const GRID_DOT_R = 0.45;
  const WHEEL_FRICTION = 0.92; // dial coast per frame @60fps-ish
  const WHEEL_COAST_MIN = 0.08; // deg/ms → snap when below
  const FLICK_EMA = 0.75;
  const FLICK_THRESH = 0.18; // ref mobile flickV threshold (px/ms)
  const N = CATS.length;
  const W_STEP = 360 / N;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let zoom = 1, targetZoom = 1;
  let camX = 0, camY = 0, tCamX = 0, tCamY = 0;
  // Sky wheel dial (degrees). Rest = 0 → cat0 (OFFLINE) at top (r10 overview).
  // Seat department i at bottom when wheelT = 180 - i*W_STEP (dive / dial snap).
  let wheelA = 0, wheelT = 0;
  let wheelV = 0; // deg/ms coast velocity (sky dial)
  let flickV = 0; // px/ms EMA (ref)
  let flickT = 0;
  let wheelIdle = null;
  let settleTimer = null;
  let lastWheelSX = 0;
  let lastWheelSY = 0;
  let zoomPivot = null; // {sx,sy,wx,wy} while wheel-zoom eases
  let lastInteractTs = 0;
  let idleRotateOn = true;
  let wheelCoasting = false;
  let mapState = 'sky'; // sky | aligning | diving | fan | rising
  let focusCat = null;
  let hoverCat = null;
  let hoverNodeId = null;
  let selectedChain = -1; // fan: fade sibling chains on select
  let hoverAlpha = {}; // catId → 0..1
  let selectedAlert = null;
  let panelOpen = false;
  let coreOpen = false;
  let viewMode = 'map';
  let dragging = false;
  let lastX = 0, lastY = 0;
  let dragDist = 0;
  let lastMoveTs = 0;
  let lastTickTs = 0;
  let zoomLockUntil = 0;
  let zoomIntent = 0;
  let searchQ = '';
  let layoutNodes = [];
  let layoutLinks = [];
  let focusLayout = null;
  let parentOf = new Map();
  let sectorLocal = []; // per-cat local geometry for wheel placement
  let morph = null; // {dir, t0, dur, fromNodes, toNodes, fromLinks, toLinks, focusId, otherIds}
  let mapReady = false;
  const flowParticles = [];
  const coreDust = [];
  const spokeMotes = [];
  const hitNodes = [];
  const labelEls = new Map();
  const nodeLabelEls = new Map();
  const groupLabelEls = new Map();
  const labelOpSmooth = new Map(); // id → displayed opacity (0.5s ease)
  const ptrs = new Map();
  let pinchD0 = 0, pinchS0 = 1, pinchRatio = 1, pinchAX = 0, pinchAY = 0;

  let catLabelWorld = new Map();
  let overviewGeom = { rHub: 160, rTip: 300, rLabel: 420, rCore: 70, segLen: 32 };

  function clampZSky(v) { return Math.max(Z_SKY_MIN, Math.min(Z_SKY_MAX, v)); }
  function clampZFan(v) { return Math.max(Z_FAN_MIN, Math.min(Z_FAN_MAX, v)); }
  function clampZoom(v) { return (focusCat || mapState === 'fan' || mapState === 'diving') ? clampZFan(v) : clampZSky(v); }

  function lodAlpha(z, zIn, zFull) {
    if (z <= zIn) return 0;
    if (z >= zFull) return 1;
    return (z - zIn) / Math.max(1e-6, zFull - zIn);
  }

  /** Short leaf label — avoids overlap at deep zoom (site first token · short id). */
  function shortNodeLabel(site, leaf) {
    const s = String(site || '').trim().split(/\s+/)[0] || '';
    let m = String(leaf || '').trim();
    // Keep machine ids intact (avoid "KU · ering"); only shorten long LT-KW-#### pads
    if (/^LT-KW-/i.test(m)) m = m.replace(/^LT-KW-/i, '');
    if (m.length > 12) m = m.slice(0, 12);
    if (s && m) return s + ' · ' + m;
    return (m || s || '·').slice(0, 18);
  }

  /** Category subline: lowercase descriptive (skilltree .wname .sb). */
  function catSubline(cat) {
    return String(cat.subtitle || '')
      .replace(/[|•]/g, '·')
      .replace(/\s*·\s*/g, ' · ')
      .replace(/,/g, ' · ')
      .toLowerCase()
      .trim();
  }


  /** Department groups from subtitle line (video LOD: ENRICHMENT-style primary branches). */
  function groupsFromSubtitle(cat) {
    const parts = String(cat.subtitle || '')
      .split(/[·•|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const fallback = ['GROUP A', 'GROUP B', 'GROUP C'];
    const src = parts.length ? parts : fallback;
    return src.slice(0, 3).map((p, i) => ({
      id: `${cat.id}:grp${i}`,
      label: p.replace(/\s+/g, ' ').toUpperCase(),
      index: i,
    }));
  }

  function setTransitioning(on) {
    document.body.classList.toggle('transitioning', !!on);
  }
  function setFanMode(on) {
    document.body.classList.toggle('fanmode', !!on);
  }
  function focusedIdx() {
    return ((Math.round((180 - wheelA) / W_STEP)) % N + N) % N;
  }
  function easeOutCubic(u) {
    const t = Math.max(0, Math.min(1, u));
    return 1 - Math.pow(1 - t, 3);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = mapView.clientWidth || window.innerWidth;
    H = mapView.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildOverviewLayout();
    if (focusCat) rebuildFocusLayout(focusCat);
  }

  function usable() {
    const left = (panelOpen || coreOpen) ? Math.min(400, Math.floor(W * 0.32)) + 20 : 0;
    return {
      x: left,
      y: 56,
      w: Math.max(280, W - left),
      h: Math.max(240, H - 56),
      get cx() { return this.x + this.w / 2; },
      // Balanced centre maximises label radius (toolbar + bottom margins)
      get cy() { return this.y + this.h * (focusCat ? 0.42 : 0.50); },
    };
  }

  /**
   * Skilltree overview (vs viewport height):
   * hub ~19% H; chain length ≈ 1.0× hub radius (ref gap mechanism) → tips ~38% H;
   * SPAN 140° wide fans; core compact; labels clear of top bar.
   */
  function toolbarBottomPx() {
    const toggle = document.querySelector('.view-toggle');
    if (toggle) return toggle.getBoundingClientRect().bottom;
    const bar = document.querySelector('.topbar');
    if (bar) return bar.getBoundingClientRect().bottom;
    return 56;
  }

  function computeOverviewGeom() {
    const m = Math.min(W, H);
    // r19: wider hub ring (ref_over) — more air between categories
    const rHub = H * 0.235;
    const u = usable();
    const TITLE_GAP = 40;
    const topClear = toolbarBottomPx() + TITLE_GAP + 28;
    const botClear = 36;
    const rLabelMax = Math.min(u.cy - topClear, (H - botClear) - u.cy);
    const minLabelGap = Math.max(88, H * 0.095);
    // skilltree chain: r0=80 → Rmax=rb+3*rstep=314 on hub-local; longer spokes
    const rTipPref = rHub + H * 0.28;
    const rTipMax = rLabelMax - minLabelGap;
    const rTip = Math.max(rHub + H * 0.20, Math.min(rTipPref, rTipMax));
    const rLabel = Math.min(rTip + minLabelGap, rLabelMax);
    const rCore = m * 0.062;
    const segLen = H * 0.035;
    overviewGeom = { rHub, rTip, rLabel, rCore, segLen, titleGap: TITLE_GAP };
    return overviewGeom;
  }

  function worldToScreen(x, y) {
    const u = usable();
    return { x: u.cx + (x + camX) * zoom, y: u.cy + (y + camY) * zoom };
  }

  function leafWeight(node) {
    if (!node.children || !node.children.length) return 1;
    return node.children.reduce((s, c) => s + leafWeight(c), 0);
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function normAngle(a) {
    return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  }

  function angleDelta(a, b) {
    return normAngle(a - b);
  }

  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(denom) < 1e-9) return false;
    const ua = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
    const ub = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
    return ua > 0.02 && ua < 0.98 && ub > 0.02 && ub < 0.98;
  }

  /**
   * Build one department fan in LOCAL coords (hub at 0,0, outward +Y).
   * r19 / skilltree buildSky mini: SPAN 140°, 3 functions (= groups) = 3 chains,
   * r0=80, rb=146, rstep=56 → Rmax=314; solid leaf dots; straight zig-zag.
   */
  function buildSectorLocal(cat, catIndex) {
    const { rHub, rTip } = overviewGeom;
    const color = cat.color;
    const ov = cat.overviewTree || {};
    const tips = ov.tips || [];
    let seq = 0;
    const nodes = [];
    const links = [];
    const groups = groupsFromSubtitle(cat);

    nodes.push({
      id: cat.id, kind: 'category', label: cat.label, color, icon: cat.icon,
      alert: null, catId: cat.id, lx: 0, ly: 0, r: ROOTB_R, depth: 0, hot: false,
      chain: -1, morphKey: `${cat.id}:hub`,
    });

    // Exact skilltree mini constants
    const SPAN = (140 * Math.PI) / 180;
    const r0 = 80, rb = 146, rstep = 56;
    const Rmax = rb + 3 * rstep; // 314
    const scale = (rTip - rHub) / Rmax;
    const nf = Math.max(1, groups.length); // 3 groups → 3 chains (sparse like ref)

    const SITE_PAD = [
      'Salmiya', 'Hawally', 'Sharq', 'Jabriya', 'Salwa', 'Rumaithiya',
      'Bayan', 'Mishref', 'Sabah Al Salem', 'Fahaheel', 'Mahboula', 'Fintas',
      'Egaila', 'Mangaf', 'Abu Halifa', 'Bneid Al Gar', 'Qortuba', 'Surra',
    ];
    const tipPool = [];
    const seenTips = new Set();
    tips.forEach((t) => {
      const key = `${t.site || ''}·${t.label || ''}`;
      if (seenTips.has(key)) return;
      seenTips.add(key);
      tipPool.push(t);
    });
    const need = nf * 4;
    while (tipPool.length < need) {
      const i = tipPool.length;
      tipPool.push({
        id: `${cat.id}:u${i}`,
        site: SITE_PAD[i % SITE_PAD.length],
        label: `LT-KW-${String(1000 + (i * 17) % 9000).padStart(4, '0')}`,
        alert: null,
        hot: false,
      });
    }
    let tipCursor = 0;
    const usedNodeLabels = new Set();
    let cursor = -SPAN / 2;

    groups.forEach((grp, planIndex) => {
      const span = SPAN / nf;
      const aC = cursor + span / 2;
      const groupId = grp.id;
      // Fork at r0 (skilltree)
      const glx = (r0 * scale) * Math.sin(aC);
      const gly = (r0 * scale) * Math.cos(aC);
      nodes.push({
        id: groupId, kind: 'group', label: grp.label, color, icon: null,
        alert: null, catId: cat.id, lx: glx, ly: gly, r: GROUP_DOT_R,
        depth: 1, hot: false, tint: true, chain: planIndex, groupIndex: planIndex,
        morphKey: `${cat.id}:${groupId}:fork`,
        groupLabel: grp.label,
      });
      links.push({
        s: cat.id, t: groupId, color, depth: 1, straight: true,
        chain: planIndex, morphKey: `${cat.id}:L:${groupId}:trunk`,
      });

      const nJobs = 3 + (hash01(cat.id.length * 17 + planIndex * 3.7 + catIndex) > 0.55 ? 1 : 0); // 3–4
      const jobs = tipPool.slice(tipCursor, tipCursor + nJobs);
      tipCursor += nJobs;
      let prevId = groupId;
      let plx = glx, ply = gly;
      jobs.forEach((job, ji) => {
        const zig = (ji % 2 ? 1 : -1) * Math.min(span * 0.22, 0.075) * (ji ? 1 : 0.45);
        const r = (rb + (nJobs > 1 ? ji * (Rmax - rb) / (nJobs - 1) : 0)) * scale;
        const a = aC + zig;
        const lx = r * Math.sin(a);
        const ly = r * Math.cos(a);
        const id = `${cat.id}:n${seq++}`;
        const site = job.site || '';
        const leaf = job.label || '·';
        let nodeLabel = shortNodeLabel(site, leaf);
        let guard = 0;
        while (usedNodeLabels.has(nodeLabel) && guard < 40) {
          guard += 1;
          nodeLabel = shortNodeLabel(
            SITE_PAD[(seq + guard) % SITE_PAD.length],
            `LT-KW-${String(1200 + seq * 23 + guard * 7).padStart(4, '0')}`,
          );
        }
        usedNodeLabels.add(nodeLabel);
        nodes.push({
          id, kind: 'machine',
          label: nodeLabel,
          color, icon: null, alert: job.alert || null,
          catId: cat.id, lx, ly, r: LEAF_R, depth: 2 + ji,
          hot: !!job.hot, tint: false,
          chain: planIndex, morphKey: `${cat.id}:c${planIndex}:j${ji + 1}`,
          groupId,
        });
        links.push({
          s: prevId, t: id, color, depth: 2 + ji, straight: true,
          chain: planIndex, morphKey: `${cat.id}:L:c${planIndex}:j${ji + 1}`,
          x0: plx, y0: ply, x1: lx, y1: ly,
        });
        prevId = id; plx = lx; ply = ly;
      });
      cursor += span;
    });
    return {
      cat, catIndex, nodes, links, rHub, groups,
      spokeCount: nf,
    };
  }

  /** Place local sectors onto the wheel using current wheelA (ref layoutWheel). */
  function layoutWheel() {
    const g = overviewGeom;
    const nodes = [];
    const links = [];
    catLabelWorld = new Map();

    sectorLocal.forEach((sec) => {
      const deg = wheelA + sec.catIndex * W_STEP;
      const a = deg * Math.PI / 180;
      // Hub on circle (ref P): x = R sin a, y = -R cos a
      const hx = g.rHub * Math.sin(a);
      const hy = -g.rHub * Math.cos(a);
      // Local outward +Y → world along hub ray; local +X → perpendicular
      const ox = Math.sin(a), oy = -Math.cos(a);
      const tx = Math.cos(a), ty = Math.sin(a);

      const idMap = new Map();
      sec.nodes.forEach((n) => {
        const wx = hx + n.lx * tx + n.ly * ox;
        const wy = hy + n.lx * ty + n.ly * oy;
        const copy = { ...n, x: wx, y: wy };
        delete copy.lx; delete copy.ly;
        nodes.push(copy);
        idMap.set(n.id, copy);
      });
      sec.links.forEach((L) => {
        const s = idMap.get(L.s);
        const t = idMap.get(L.t);
        if (!s || !t) return;
        links.push({
          ...L, x0: s.x, y0: s.y, x1: t.x, y1: t.y,
        });
      });
      // virtual core→hub for parent index (drawn only when needed)
      links.push({
        s: '__core__', t: sec.cat.id, color: sec.cat.color, depth: 0,
        straight: true, spine: true, virtual: true,
        x0: 0, y0: 0, x1: hx, y1: hy,
      });
      const lr = g.rLabel;
      catLabelWorld.set(sec.cat.id, {
        x: lr * Math.sin(a), y: -lr * Math.cos(a), a,
      });
    });

    layoutNodes = nodes;
    layoutLinks = links;
    rebuildParentIndex(links);
    seedFlowParticles();
  }

  function rebuildOverviewLayout() {
    computeOverviewGeom();
    sectorLocal = CATS.map((cat, i) => {
      hoverAlpha[cat.id] = hoverAlpha[cat.id] ?? 1;
      return buildSectorLocal(cat, i);
    });
    layoutWheel();
    if (!focusCat && mapState === 'sky') {
      targetZoom = clampZSky(1);
    }
  }

  function snapWheel() {
    wheelV = 0;
    wheelCoasting = false;
    wheelT = 180 + Math.round((wheelT - 180) / W_STEP) * W_STEP;
    // Leave wheelA ≠ wheelT so EASE_WHEEL coasts into the detent
    if (Math.abs(wheelT - wheelA) < 0.01) {
      wheelA = wheelT;
      layoutWheel();
    }
  }

  function stepWheel(d) {
    if (mapState !== 'sky' && mapState !== 'aligning') return;
    clearTimeout(wheelIdle);
    wheelV = 0;
    wheelCoasting = false;
    // Snap lattice then step — ease via EASE_WHEEL (same as dial snap)
    wheelT = 180 + Math.round((wheelT - 180) / W_STEP) * W_STEP - d * W_STEP;
  }

  function rebuildParentIndex(links) {
    parentOf = new Map();
    links.forEach((L) => {
      if (L.t) parentOf.set(L.t, L.s);
    });
  }

  function pathToCore(nodeId) {
    const ids = new Set();
    let cur = nodeId;
    let guard = 0;
    while (cur && guard++ < 64) {
      ids.add(cur);
      if (cur === '__core__') break;
      const p = parentOf.get(cur);
      if (!p) {
        if (CATS.some((c) => c.id === cur)) ids.add('__core__');
        break;
      }
      cur = p;
    }
    ids.add('__core__');
    return ids;
  }

  function recenterMap({ immediate = false } = {}) {
    tCamX = 0;
    // Slight downward bias so the top dept title clears the MAP/DASHBOARDS toggle
    tCamY = mapState === 'sky' ? H * 0.02 : 0;
    if (!focusCat) targetZoom = clampZSky(1);
    if (immediate) {
      camX = tCamX;
      camY = tCamY;
      zoom = targetZoom;
    }
  }

  function seedFlowParticles() {
    flowParticles.length = 0;
    // Skilltree buildSky: copper outward + ivory return on every spoke (desktop)
    const segs = layoutLinks.filter((L) => !L.stub && !L.virtual);
    segs.forEach((L, i) => {
      const catId = (layoutNodes.find((n) => n.id === L.t) || {}).catId;
      const durOut = 2.6 + (i % 3) * 0.7; // animateMotion dur
      const durBack = 3.5 + (i % 2) * 0.9;
      flowParticles.push({
        link: L, u: hash01(i * 3.1), speed: 1 / durOut, dir: 1,
        catId, color: COPPER, r: 2.4, op: 0.9,
      });
      flowParticles.push({
        link: L, u: hash01(i * 5.7 + 1.3), speed: 1 / durBack, dir: -1,
        catId, color: '#e9e4d6', r: 1.7, op: 0.5,
      });
    });
  }

  /**
   * Focus fan: FAN_SPAN 182° / R0 248 / R_BASE 410 / R_STEP 214 (skilltree buildFan),
   * scaled to fit the usable viewport.
   */
  function rebuildFocusLayout(catId, { setCamera = true, diveZoom = false } = {}) {
    const cat = CATS.find((c) => c.id === catId);
    if (!cat) { focusLayout = null; return null; }
    const nodes = [];
    const links = [];
    const root = { ...cat.tree, icon: cat.icon, catId: cat.id };
    const groups = groupsFromSubtitle(cat);
    const tips = [];
    walk(root, (n) => {
      if (n.kind === 'machine' || (n.alert && (!n.children || !n.children.length))) tips.push(n);
    });
    const tipPool = tips.slice();
    const SITE_PAD = [
      'Salmiya', 'Hawally', 'Sharq', 'Jabriya', 'Salwa', 'Rumaithiya',
      'Bayan', 'Mishref', 'Fahaheel', 'Mahboula', 'Egaila', 'Surra',
    ];
    const usedLabels = new Set();
    const takeJobs = (n, start) => {
      const out = [];
      let i = start;
      while (out.length < n) {
        let job = tipPool[i % Math.max(1, tipPool.length)];
        if (!tipPool.length) {
          job = {
            id: `${catId}:pad${i}`, site: SITE_PAD[i % SITE_PAD.length],
            label: `LT-KW-${String(2000 + i * 13).padStart(4, '0')}`, alert: null,
          };
        }
        i += 1;
        let label = shortNodeLabel(job.site || job.alert?.machine?.site || '', job.label || '·');
        let g = 0;
        while (usedLabels.has(label) && g < 50) {
          g += 1;
          label = shortNodeLabel(SITE_PAD[(i + g) % SITE_PAD.length], `LT-KW-${String(2100 + i * 17 + g).padStart(4, '0')}`);
        }
        usedLabels.add(label);
        out.push({ ...job, _label: label });
      }
      return { jobs: out, next: i };
    };

    const u = usable();
    // World units sized so at DIVE_ZOOM_TARGET the 3 rings read as a clear row (ref_sales)
    // Aim ~90–110px between ring centres at zoom≈4.8 → gap≈20–23 world
    const ringGap = 22;
    const ringR = 5.5;
    const chainLen0 = 48;
    const chainStep = 22;
    const FAN = 100 * Math.PI / 180; // upward fan from each ring

    // Category anchor under the row (title lives in focus-bar; node is back-target)
    nodes.push({
      id: cat.id, kind: 'category', label: cat.label, color: cat.color, icon: cat.icon,
      alert: null, catId: cat.id, x: 0, y: ringGap * 0.55, r: ringR * 0.9, depth: 0, hot: false,
      chain: -1, morphKey: `${cat.id}:hub`,
    });

    let tipCursor = 0;
    let maxR = ringGap;
    const ng = Math.max(1, groups.length);
    groups.forEach((grp, gi) => {
      const gx = (gi - (ng - 1) / 2) * ringGap;
      const gy = 0;
      const groupId = grp.id;
      nodes.push({
        id: groupId, kind: 'group', label: grp.label, color: cat.color,
        icon: cat.icon, alert: null, catId: cat.id, x: gx, y: gy, r: ringR,
        depth: 1, hot: false, chain: gi, morphKey: `${cat.id}:${groupId}:fork`,
        groupLabel: grp.label, groupIndex: gi, baseRow: true,
      });
      links.push({
        s: cat.id, t: groupId, color: cat.color, depth: 1, chain: gi, straight: true,
        morphKey: `${cat.id}:L:${groupId}:trunk`,
      });

      // 2 upward zig-zag chains per group ring
      const nChains = 2;
      const { jobs: pool, next } = takeJobs(nChains * 4, tipCursor);
      tipCursor = next;
      for (let ci = 0; ci < nChains; ci++) {
        const a0 = -FAN / 2 + (FAN * (ci + 0.5)) / nChains; // upward-ish
        // bias outward from center
        const aBias = gx === 0 ? 0 : (gx > 0 ? 0.12 : -0.12);
        let px = gx, py = gy, prevId = groupId;
        const jobs = pool.slice(ci * 4, ci * 4 + 4);
        jobs.forEach((job, ji) => {
          const zig = (ji % 2 ? 1 : -1) * 0.07 * (ji ? 1 : 0.4);
          const a = a0 + aBias + zig;
          const r = chainLen0 + ji * chainStep;
          const x = gx + r * Math.sin(a);
          const y = gy - r * Math.cos(a); // up = -y
          maxR = Math.max(maxR, Math.hypot(x, y));
          const id = job.id || `${cat.id}:g${gi}c${ci}j${ji}`;
          nodes.push({
            id, kind: job.kind || 'machine',
            label: job._label,
            color: cat.color,
            icon: null, alert: job.alert || null, catId: cat.id, x, y,
            r: LEAF_R * 1.15, depth: 2 + ji, hot: !!(job.alert && job.alert.hot),
            chain: gi * 10 + ci, morphKey: `${cat.id}:c${gi}_${ci}:j${ji + 1}`, groupId,
          });
          links.push({
            s: prevId, t: id, color: cat.color, depth: 2 + ji, chain: gi * 10 + ci,
            straight: true,
            morphKey: `${cat.id}:L:c${gi}_${ci}:j${ji + 1}`, x0: px, y0: py, x1: x, y1: y,
          });
          px = x; py = y; prevId = id;
        });
      }
    });

    rebuildParentIndex(links);

    if (setCamera) {
      targetZoom = clampZFan(DIVE_ZOOM_TARGET);
      tCamX = 0;
      // Frame the upward fan; base rings near bottom third
      tCamY = maxR * 0.22;
    }

    focusLayout = { nodes, links, color: cat.color, cat, maxR };
    return focusLayout;
  }

  function fitFanCamera() {
    if (!focusLayout) return;
    const u = usable();
    const maxR = focusLayout.maxR || 400;
    const bw = (maxR + 280) * 2;
    const bh = maxR + 260 + 180;
    const pad = 0.9;
    const kz = Math.min((u.w * pad) / bw, (u.h * pad) / bh);
    targetZoom = clampZFan(Math.max(0.7, Math.min(1.45, kz)));
    tCamX = 0;
    tCamY = maxR * 0.18;
    zoom = targetZoom;
    camX = tCamX;
    camY = tCamY;
    zoomPivot = null;
  }

  function snapshotLayout(nodes, links) {
    const nmap = new Map();
    nodes.forEach((n) => {
      if (!n.morphKey) return;
      nmap.set(n.morphKey, { ...n });
    });
    const lmap = new Map();
    links.forEach((L) => {
      const key = L.morphKey || `${L.s}->${L.t}`;
      lmap.set(key, { ...L });
    });
    return { nmap, lmap };
  }

  function beginMorph({ dir, focusId, from, to, duration, camFrom, camTo, otherFrom }) {
    morph = {
      dir, focusId,
      t0: performance.now(),
      dur: reduceMotion ? 1 : Math.max(400, duration),
      from, to,
      camFrom: camFrom || { zoom, camX, camY },
      camTo: camTo || { zoom: targetZoom, camX: tCamX, camY: tCamY },
      otherFrom: otherFrom || [],
    };
  }

  function morphProgress() {
    if (!morph) return 1;
    const u = (performance.now() - morph.t0) / morph.dur;
    return Math.max(0, Math.min(1, u));
  }

  function easeInOutCubic(u) {
    const t = Math.max(0, Math.min(1, u));
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** Interpolated draw lists during dive/rise — camera + nodes share one eased clock. */
  function morphDisplay() {
    if (!morph) return null;
    const raw = morphProgress();
    const e = easeInOutCubic(raw);
    const fromN = morph.from.nmap;
    const toN = morph.to.nmap;
    const keys = new Set([...fromN.keys(), ...toN.keys()]);
    const hubFrom = fromN.get(`${morph.focusId}:hub`) || { x: 0, y: 0, r: 8, color: '#e9e4d6' };
    const hubTo = toN.get(`${morph.focusId}:hub`) || { x: 0, y: 0, r: 20, color: '#e9e4d6' };
    const nodes = [];
    keys.forEach((k) => {
      const A = fromN.get(k);
      const B = toN.get(k);
      const src = B || A;
      const a = A || {
        x: hubFrom.x, y: hubFrom.y, r: 0, color: hubFrom.color,
        catId: morph.focusId, kind: src.kind || 'machine', label: src.label || '',
        morphKey: k, chain: src.chain != null ? src.chain : -1, hot: false, id: src.id,
      };
      const b = B || {
        x: hubTo.x, y: hubTo.y, r: 0, color: hubTo.color,
        catId: morph.focusId, kind: src.kind || 'machine', label: src.label || '',
        morphKey: k, chain: src.chain != null ? src.chain : -1, hot: false, id: src.id,
      };
      nodes.push({
        id: src.id,
        kind: src.kind,
        label: src.label,
        color: src.color,
        icon: src.icon,
        alert: src.alert,
        catId: morph.focusId,
        chain: src.chain,
        morphKey: k,
        hot: !!src.hot,
        depth: src.depth,
        x: lerp(a.x, b.x, e),
        y: lerp(a.y, b.y, e),
        r: lerp(a.r || 2, b.r || 2, e),
        morphOp: 1,
        morphing: true,
      });
    });

    // Other departments: dive → fade/fly off; rise → fade back in from dim
    const otherNodes = [];
    const others = morph.otherFrom.length ? morph.otherFrom : [];
    others.forEach((n) => {
      if (n.kind === 'stub') return;
      if (morph.dir === 1) {
        const fly = e * e;
        otherNodes.push({
          ...n,
          x: lerp(n.x, n.x * 1.35, fly),
          y: lerp(n.y, n.y * 1.35, fly),
          morphOp: lerp(1, 0, e),
          otherDim: true,
        });
      } else {
        otherNodes.push({
          ...n,
          x: lerp(n.x * 1.25, n.x, e),
          y: lerp(n.y * 1.25, n.y, e),
          morphOp: lerp(0, 1, e),
          otherDim: true,
        });
      }
    });

    // Links from interpolated node positions (chain order — reliable during morph)
    const links = [];
    const byChain = new Map();
    nodes.forEach((n) => {
      if (n.chain == null || n.chain < 0) return;
      if (!byChain.has(n.chain)) byChain.set(n.chain, []);
      byChain.get(n.chain).push(n);
    });
    const hub = nodes.find((n) => n.morphKey === `${morph.focusId}:hub`);
    byChain.forEach((arr) => {
      arr.sort((a, b) => (a.depth || 0) - (b.depth || 0));
      let prev = hub;
      arr.forEach((n) => {
        if (!prev) return;
        links.push({
          s: prev.id, t: n.id, color: n.color, chain: n.chain, straight: true,
          morphOp: 1, morphing: true, x0: prev.x, y0: prev.y, x1: n.x, y1: n.y,
        });
        prev = n;
      });
    });
    // other-dept links (straight stubs between consecutive depths)
    const otherByCat = new Map();
    otherNodes.forEach((n) => {
      if (!otherByCat.has(n.catId)) otherByCat.set(n.catId, []);
      otherByCat.get(n.catId).push(n);
    });
    otherByCat.forEach((arr) => {
      const hubN = arr.find((n) => n.kind === 'category');
      if (!hubN) return;
      arr.forEach((n) => {
        if (n === hubN || n.kind === 'category') return;
        // connect first-depth sites to hub
        if ((n.depth || 0) <= 1) {
          links.push({
            s: hubN.id, t: n.id, color: n.color, straight: true,
            morphOp: n.morphOp, otherDim: true, x0: hubN.x, y0: hubN.y, x1: n.x, y1: n.y,
          });
        }
      });
    });

    return { nodes: nodes.concat(otherNodes), links, e: raw, ease: e, done: raw >= 1 };
  }

  function activeNodes() {
    if (morph && (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning')) {
      const m = morphDisplay();
      if (m) return m.nodes;
    }
    return focusCat && focusLayout ? focusLayout.nodes : layoutNodes;
  }
  function activeLinks() {
    if (morph && (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning')) {
      const m = morphDisplay();
      if (m) return m.links;
    }
    return focusCat && focusLayout ? focusLayout.links : layoutLinks;
  }

  function matchSearch(label, alert) {
    if (!searchQ) return true;
    const hay = `${label} ${alert?.title || ''} ${alert?.subtype || ''} ${alert?.machine?.site || ''} ${alert?.machine?.area || ''}`.toLowerCase();
    return hay.includes(searchQ);
  }

  function ensureCatLabel(cat) {
    let el = labelEls.get(cat.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cat-label';
      el.dataset.id = cat.id;
      el.innerHTML = `<div class="name"></div><div class="sub"></div>`;
      labelLayer.appendChild(el);
      labelEls.set(cat.id, el);
    }
    el.querySelector('.name').textContent = cat.label;
    const sub = el.querySelector('.sub');
    if (sub) sub.textContent = catSubline(cat);
    return el;
  }

  function ensureNodeLabel(id, text) {
    let el = nodeLabelEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node-label';
      el.dataset.id = id;
      labelLayer.appendChild(el);
      nodeLabelEls.set(id, el);
    }
    el.textContent = text;
    return el;
  }

  function ensureGroupLabel(id, text) {
    let el = groupLabelEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'group-label';
      el.dataset.id = id;
      labelLayer.appendChild(el);
      groupLabelEls.set(id, el);
    }
    el.textContent = text;
    return el;
  }

  /** Fade a DOM label off (~LABEL_FADE_MS); instant only when requested (morph swap). */
  function hideDomLabel(el, instant) {
    if (!el) return;
    el.classList.remove('is-on');
    el._opTarget = 0;
    const lid = el.dataset.id;
    if (instant || reduceMotion) {
      el.style.opacity = '0';
      if (lid) labelOpSmooth.set(lid, 0);
      el.style.visibility = 'hidden';
      return;
    }
    // smoothLabelOpacities eases to 0; visibility cleared when near 0
  }

  function clearPointerHover() {
    hoverCat = null;
    hoverNodeId = null;
    hideHoverTip();
    if (!dragging) canvas.style.cursor = mapState === 'sky' || mapState === 'fan' ? 'grab' : 'default';
  }

  /** Force every floating label off (used on blur / leave / layout swap). */
  function clearFloatingLabels() {
    nodeLabelEls.forEach((el) => hideDomLabel(el, true));
    groupLabelEls.forEach((el) => hideDomLabel(el, true));
    labelEls.forEach((el) => hideDomLabel(el, true));
  }

  /** Simple AABB overlap — skip later labels that collide (r15/r16 no-overlap). */
  function labelBoxesOverlap(a, b, pad = 4) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x
      || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
  }

  function syncZoomPct() {
    const el = document.getElementById('zoom-pct');
    if (el) el.textContent = `${Math.round(zoom * 100)}%`;
  }

  function fitCurrent() {
    if (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    if ((mapState === 'fan' || focusCat) && focusCat) {
      rebuildFocusLayout(focusCat, { setCamera: true });
      zoom = targetZoom; camX = tCamX; camY = tCamY; zoomPivot = null;
    } else {
      recenterMap({ immediate: false });
    }
  }

  /** +/- buttons: continuous zoom (r16 video); fan zoom-out past floor rises. */
  function zoomStep(dir) {
    if (viewMode !== 'map') return;
    if (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    const u = usable();
    const sx = u.cx;
    const sy = u.cy;
    const next = clampZoom(zoom * (dir > 0 ? ZOOM_STEP_IN : ZOOM_STEP_OUT));
    zoomAtScreen(sx, sy, next);
    scheduleCameraSettle(sx, sy);
    zoomIntent = 0;
    if ((mapState === 'fan' || focusCat) && dir < 0 && next <= RISE_SCALE) {
      clearFocus();
    }
  }

  function drawIcon(x, y, type, color, alpha, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (type === 'offline') {
      ctx.arc(0, 0, 5, 0.25, Math.PI * 1.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -2); ctx.stroke();
    } else if (type === 'stock') {
      ctx.strokeRect(-5, -4, 10, 8);
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.stroke();
    } else if (type === 'revenue') {
      ctx.moveTo(-5, 4); ctx.lineTo(-1, -1); ctx.lineTo(2, 2); ctx.lineTo(5, -4); ctx.stroke();
    } else if (type === 'tasks') {
      ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-0.5, 2); ctx.lineTo(3, -2); ctx.stroke();
    } else if (type === 'support') {
      ctx.arc(0, -1, 3.5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 3.5, 1.2, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'cleaning') {
      ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.stroke();
    } else {
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, 1); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 3, 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBackChevron(x, y, color, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const s = Math.max(5, r * 0.38);
    ctx.beginPath();
    ctx.moveTo(s * 0.35, -s);
    ctx.lineTo(-s * 0.55, 0);
    ctx.lineTo(s * 0.35, s);
    ctx.stroke();
    ctx.restore();
  }

  function drawCore(t) {
    const p = focusCat
      ? worldToScreen(0, -110)
      : worldToScreen(0, 0);
    // Keep centre web clear of top chrome
    const minCy = toolbarBottomPx() + (overviewGeom.rCore || 40) + 8;
    if (p.y < minCy) p.y = minCy;
    const coreR = focusCat ? 48 : (overviewGeom.rCore || Math.min(W, H) * 0.054);
    const scale = focusCat ? 1.1 : Math.max(0.85, Math.min(1.35, zoom));
    const colors = CATS.map((c) => c.color);

    // Build organic hub graph once (skilltree buildSky hub)
    if (!coreDust.length || coreDust._gen !== 18) {
      coreDust.length = 0;
      coreDust._gen = 18;
      coreDust.edges = [];
      const HUBF = Math.min(1, N / 7);
      const pickC = (i) => (hash01(i) < 0.32 ? '#e9e4d6' : colors[Math.floor(hash01(i + 3) * colors.length)]);
      const pushDot = (x, y, r, fill, op, pulse) => {
        coreDust.push({ x, y, r, fill, op, pulse: !!pulse });
      };
      // free-floating memories denser toward centre
      for (let k = 0; k < Math.round(130 * HUBF); k++) {
        const a = hash01(k * 1.7) * Math.PI * 2;
        const r = 112 * Math.sqrt(hash01(k * 2.3));
        pushDot(r * Math.cos(a), r * Math.sin(a), 0.8 + hash01(k) * 1.2, pickC(k), 0.25 + hash01(k + 1) * 0.5, hash01(k + 2) < 0.25);
      }
      // denser rim band
      for (let k = 0; k < Math.round(55 * HUBF); k++) {
        const a = hash01(k * 4.1 + 9) * Math.PI * 2;
        const r = 96 + hash01(k * 3.2) * 17;
        pushDot(r * Math.cos(a), r * Math.sin(a), 0.7 + hash01(k + 5) * 1, pickC(k + 40), 0.3 + hash01(k + 6) * 0.45, hash01(k + 7) < 0.2);
      }
      const burst = (cx, cy, n, spread, seed) => {
        for (let i = 0; i < n; i++) {
          const a = hash01(seed + i * 1.1) * Math.PI * 2;
          const r = spread * (0.35 + hash01(seed + i * 2.2) * 0.65);
          const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
          coreDust.edges.push({ x0: cx, y0: cy, x1: x, y1: y, op: 0.16 + hash01(seed + i) * 0.1 });
          pushDot(x, y, 1.1 + hash01(seed + i * 3) * 1.3, pickC(seed + i), 0.55 + hash01(seed + i * 4) * 0.4, hash01(seed + i * 5) < 0.4);
        }
      };
      burst(-20, -15, Math.round(28 * HUBF), 52, 100);
      burst(17, 19, Math.round(35 * HUBF), 58, 200);
      coreDust.edges.push({ x0: -20, y0: -15, x1: 17, y1: 19, op: 0.16 });
      coreDust.nucleus = [{ x: -20, y: -15, r: 4.5, fill: COPPER }, { x: 17, y: 19, r: 3.4, fill: '#e9e4d6' }];
      // satellite clusters
      const NCL = Math.max(4, Math.round(11 * HUBF));
      for (let k = 0; k < NCL; k++) {
        const a = (k / NCL) * Math.PI * 2 + hash01(k * 8) * 0.5;
        const R = 54 + hash01(k * 9) * 42;
        const cx = R * Math.cos(a), cy = R * Math.sin(a);
        pushDot(cx, cy, 1.7 + hash01(k) , pickC(k + 300), 0.85, false);
        const m = 5 + Math.floor(hash01(k * 11) * 7);
        const base = hash01(k * 12) * Math.PI * 2;
        const span = Math.PI * (0.7 + hash01(k * 13) * 1.3);
        for (let i = 0; i < m; i++) {
          const aa = base + span * (i / m);
          const rr = 6.5 + hash01(k * 14 + i) * 9;
          const x = cx + rr * Math.cos(aa), y = cy + rr * Math.sin(aa);
          coreDust.edges.push({ x0: cx, y0: cy, x1: x, y1: y, op: 0.18 });
          pushDot(x, y, 0.9 + hash01(k + i) * 1, pickC(k + i + 400), 0.45 + hash01(k + i + 1) * 0.4, hash01(k + i + 2) < 0.3);
        }
      }
    }

    const bloomR = coreR * scale * 1.15;
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, bloomR);
    g.addColorStop(0, 'rgba(26,29,38,0.16)');
    g.addColorStop(0.44, 'rgba(26,29,38,0.08)');
    g.addColorStop(1, 'rgba(32,36,45,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bloomR, 0, Math.PI * 2);
    ctx.fill();

    // Slow spin (skilltree hspin 170s) + hdrift
    const spin = reduceMotion ? 0 : (t / 170) * Math.PI * 2;
    const driftX = reduceMotion ? 0 : 2.2 * Math.sin(t / 12 * Math.PI * 2);
    const driftY = reduceMotion ? 0 : -2.6 * Math.cos(t / 12 * Math.PI * 2);
    const hubScale = (coreR / 115) * scale;
    ctx.save();
    ctx.translate(p.x + driftX, p.y + driftY);
    ctx.rotate(spin);
    ctx.scale(hubScale, hubScale);

    (coreDust.edges || []).forEach((e) => {
      ctx.beginPath();
      ctx.moveTo(e.x0, e.y0);
      ctx.lineTo(e.x1, e.y1);
      ctx.strokeStyle = `rgba(233,228,214,${e.op})`;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    });
    coreDust.forEach((d, i) => {
      const pulse = d.pulse && !reduceMotion ? (0.85 + 0.15 * Math.sin(t * (Math.PI * 2 / 3.2) + i)) : 1;
      ctx.beginPath();
      ctx.fillStyle = d.fill.startsWith('#')
        ? hexAlpha(d.fill, d.op * pulse)
        : d.fill;
      if (!d.fill.startsWith('#')) ctx.globalAlpha = d.op * pulse;
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    (coreDust.nucleus || []).forEach((n, i) => {
      const pr = reduceMotion ? n.r : n.r * (0.92 + 0.08 * Math.sin(t * (Math.PI * 2 / 2.6) + i));
      ctx.beginPath();
      ctx.fillStyle = n.fill;
      ctx.globalAlpha = 0.95;
      ctx.arc(n.x, n.y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    // leet wordmark under / over hub (skilltree .hname)
    const fs = Math.max(11, 11 * scale);
    ctx.font = `700 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(233,228,214,0.78)';
    ctx.letterSpacing = '0.3em';
    ctx.fillText('leet', p.x + driftX, p.y + driftY + coreR * 0.72 * scale);
    ctx.letterSpacing = '0px';
    hitNodes.push({ id: '__core__', kind: 'core', x: p.x, y: p.y, r: 32 * scale, vr: 32 * scale });
  }

  function curvePts(x0, y0, x1, y1) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const nx = -dy * 0.16;
    const ny = dx * 0.16;
    return { c1x: x0 + dx * 0.35 + nx * 0.2, c1y: y0 + dy * 0.35 + ny * 0.2, c2x: mx + nx, c2y: my + ny };
  }

  function nodeById(id) {
    if (id === '__core__') {
      return focusCat ? { x: 0, y: -110, r: 20 } : { x: 0, y: 0, r: 20 };
    }
    return activeNodes().find((n) => n.id === id);
  }

  const starField = [];
  function ensureStars() {
    if (starField._w === W && starField._h === H && starField.length) return;
    starField.length = 0;
    starField._w = W;
    starField._h = H;
    const n = Math.floor((W * H) / 18000);
    for (let i = 0; i < n; i++) {
      starField.push({
        x: hash01(i * 3.1 + 2) * W,
        y: hash01(i * 7.7 + 5) * H,
        r: 0.4 + hash01(i * 11.3) * 0.9,
        a: 0.08 + hash01(i * 13.9) * 0.18,
      });
    }
  }

  function drawScene(t) {
    hitNodes.length = 0;
    // Skilltree-like charcoal + faint grid + sparse stars
    ctx.fillStyle = '#20242D';
    ctx.fillRect(0, 0, W, H);

    // Skilltree body: radial-gradient dots rgba(232,235,242,.05) @ 14px — paint softer
    ctx.fillStyle = `rgba(232,235,242,${GRID_ALPHA})`;
    for (let x = GRID_STEP / 2; x < W; x += GRID_STEP) {
      for (let y = GRID_STEP / 2; y < H; y += GRID_STEP) {
        ctx.beginPath();
        ctx.arc(x, y, GRID_DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ensureStars();
    starField.forEach((s) => {
      ctx.beginPath();
      ctx.fillStyle = `rgba(233,228,214,${s.a * 0.55})`;
      ctx.arc(s.x, s.y, s.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
    });

    const nodes = activeNodes().filter((n) => matchSearch(n.label, n.alert));
    const links = activeLinks();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function catOpacity(catId) {
      if (mapState === 'fan' || focusCat) return 1;
      const a = hoverAlpha[catId];
      let op = a == null ? 1 : a;
      // Deep zoom without hover: keep nearest dept full, gently dim others (ref density)
      if (!focusCat && (mapState === 'sky' || mapState === 'aligning') && zoom >= LOD_GROUP_FULL && !hoverCat && catId) {
        const feat = CATS[focusedIdx()]?.id;
        if (feat && catId !== feat) op *= 0.35;
      }
      return op;
    }
    function chainFaded(nOrLink) {
      if (selectedChain < 0 || mapState !== 'fan') return false;
      const ch = nOrLink.chain;
      return ch != null && ch >= 0 && ch !== selectedChain;
    }

    // links
    links.forEach((L) => {
      if (L.virtual) return; // overview core gap stays empty
      const s = L.s === '__core__' ? { x: 0, y: 0, catId: null } : (nodeMap.get(L.s) || nodeById(L.s) || (L.x0 != null ? { x: L.x0, y: L.y0 } : null));
      const tN = nodeMap.get(L.t) || nodeById(L.t) || (L.x1 != null ? { x: L.x1, y: L.y1, catId: L.catId, color: L.color } : null);
      if (!s || !tN) return;
      if (focusCat && L.s !== '__core__' && !nodeMap.has(L.s) && L.s !== focusCat && L.x0 == null) return;
      const catId = tN.catId || s.catId;
      let op = (L.morphOp != null ? L.morphOp : 1) * catOpacity(catId);
      if (tN.morphOp != null) op *= tN.morphOp;
      if (tN.otherDim) op *= (tN.morphOp != null ? 1 : 0); // dive: other branches fade to 0
      if (chainFaded(L) || chainFaded(tN)) op *= NODE_FADED;
      const a0 = worldToScreen(s.x, s.y);
      const a1 = worldToScreen(tN.x, tN.y);
      if (!focusCat && mapState !== 'fan' && mapState !== 'diving' && (L.straight || L.s === '__core__' || L.morphing)) {
        const hovered = !!(hoverCat && catId === hoverCat && !L.otherDim);
        const col = L.color || tN.color || '#e9e4d6';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Soft colour glow underlay (branch colour)
        if (!L.stub && op > 0.05) {
          ctx.beginPath();
          ctx.moveTo(a0.x, a0.y);
          ctx.lineTo(a1.x, a1.y);
          ctx.strokeStyle = hexAlpha(col, (hovered ? 0.35 : 0.12) * op);
          ctx.lineWidth = hovered ? 5 : 3.2;
          ctx.shadowColor = hexAlpha(col, hovered ? 0.45 : 0.22);
          ctx.shadowBlur = hovered ? 12 : 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        if (hovered) {
          ctx.strokeStyle = hexAlpha(col, 0.92 * op);
          ctx.lineWidth = STROKE_BRANCH;
          ctx.stroke();
        } else if (L.morphing) {
          ctx.strokeStyle = hexAlpha(col, 0.55 * op);
          ctx.lineWidth = STROKE_SPOKE;
          ctx.stroke();
        } else {
          // Skilltree spokes: stroke-width 1.5, stroke-opacity .14 ivory
          const lineOp = L.stub ? 0.1 : STROKE_SPOKE_OP;
          ctx.strokeStyle = `rgba(233,228,214,${lineOp * op})`;
          ctx.lineWidth = L.stub ? 1 : STROKE_SPOKE;
          ctx.setLineDash(L.depth <= 1 ? [] : [2, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        return;
      }
      // During morph dive, keep straight solid strokes (no bezier flash)
      if (morph && (mapState === 'diving' || mapState === 'rising')) {
        const col = L.color || '#e9e4d6';
        const dim = !!(L.otherDim || tN.otherDim);
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        ctx.strokeStyle = hexAlpha(col, (dim ? 0.05 : 0.55) * op);
        ctx.lineWidth = dim ? 1 : STROKE_BRANCH;
        ctx.lineCap = 'round';
        ctx.stroke();
        return;
      }
      // r19: always straight segments (ref_sales / skilltree buildFan line())
      const col = L.color || '#e9e4d6';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(col, 0.12 * op);
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(col, (focusCat || mapState === 'fan' ? 0.55 : 0.22) * op);
      ctx.lineWidth = STROKE_BRANCH;
      ctx.stroke();
    });

    // Flow particles along every branch (skilltree animateMotion copper↔ivory)
    if ((mapState === 'sky' || morph || mapState === 'aligning') && !reduceMotion) {
      flowParticles.forEach((p) => {
        const L = p.link;
        const s = nodeMap.get(L.s) || nodeById(L.s) || (L.x0 != null ? { x: L.x0, y: L.y0 } : null);
        const tN = nodeMap.get(L.t) || nodeById(L.t) || (L.x1 != null ? { x: L.x1, y: L.y1 } : null);
        if (!s || !tN) return;
        const op = catOpacity(p.catId);
        if (op < 0.15) return;
        const du = p.speed * 0.016 * (p.dir || 1);
        p.u = (p.u + du) % 1;
        if (p.u < 0) p.u += 1;
        const u = p.dir < 0 ? (1 - p.u) : p.u;
        const x = s.x + (tN.x - s.x) * u;
        const y = s.y + (tN.y - s.y) * u;
        const scr = worldToScreen(x, y);
        ctx.beginPath();
        ctx.fillStyle = hexAlpha(p.color || COPPER, (p.op != null ? p.op : 0.7) * op);
        ctx.arc(scr.x, scr.y, (p.r || 2) * Math.min(1.2, 0.7 + zoom * 0.2), 0, Math.PI * 2);
        ctx.fill();
      });
      if (!spokeMotes.length) {
        for (let k = 0; k < 30; k++) {
          spokeMotes.push({
            a: hash01(k * 2.2) * Math.PI * 2,
            r: overviewGeom.rHub * (0.7 + hash01(k * 5.1) * 0.9),
            s: 0.9 + hash01(k * 7.3) * 1.2,
            op: 0.1 + hash01(k * 9.1) * 0.18,
          });
        }
      }
      const coreScr = worldToScreen(0, 0);
      spokeMotes.forEach((m) => {
        const ang = m.a + wheelA * Math.PI / 180;
        const scr = worldToScreen(m.r * Math.sin(ang), -m.r * Math.cos(ang));
        ctx.beginPath();
        ctx.fillStyle = `rgba(233,228,214,${m.op * (hoverCat ? 0.3 : 1)})`;
        ctx.arc(scr.x, scr.y, m.s, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // nodes
    const inSky = (mapState === 'sky' || mapState === 'aligning') && !morph && !focusCat;
    const inFan = !!(focusCat || mapState === 'fan') && !morph;
    // r16 LOD: continuous sky zoom drives label tiers; fan shows groups+nodes
    const groupLod = inSky ? lodAlpha(zoom, LOD_GROUP_IN, LOD_GROUP_FULL)
      : (inFan ? 1 : 0);
    const nodeLod = inSky ? lodAlpha(zoom, LOD_NODE_IN, LOD_NODE_FULL)
      : (inFan ? 1 : 0);
    const catLod = inSky
      ? (1 - lodAlpha(zoom, LOD_CAT_FADE_START, LOD_CAT_FADE_END))
      : 0;
    const wantedNodeLabels = new Map();
    const wantedGroupLabels = new Map();
    const placedBoxes = [];
    const zScale = Math.min(1.2, 0.95 + zoom * 0.12);
    const featuredCatId = (mapState === 'sky') ? CATS[focusedIdx()]?.id : null;
    nodes.forEach((n) => {
      if (n.kind === 'stub' || n.hidden) return;
      if (focusCat && n.catId && n.catId !== focusCat && !n.otherDim) return;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const selected = selectedAlert && n.alert && selectedAlert.id === n.alert.id;
      const isCat = n.kind === 'category';
      const isHub = isCat || n.kind === 'subtype' || n.kind === 'group';
      let op = catOpacity(n.catId);
      if (n.morphOp != null) op *= n.morphOp;
      if (chainFaded(n)) op *= NODE_FADED;
      const catHover = mapState === 'sky' && hoverCat && n.catId === hoverCat;
      const hoverBoost = (mapState === 'fan' && hoverNodeId === n.id) ? HOVER_NODE_SCALE
        : (isCat && catHover ? HOVER_CAT_SCALE
          : (featuredCatId && n.catId === featuredCatId && isCat ? FEATURED_SCALE : 1));
      const pulse = reduceMotion ? 1 : (0.96 + 0.04 * Math.sin(t * 1.2 + (n.x + n.y) * 0.01));
      // Subtle per-node drift (canvas-space wobble)
      const drift = (!reduceMotion && (mapState === 'sky' || mapState === 'fan'))
        ? { x: 0.6 * Math.sin(t * 0.7 + n.x * 0.02), y: 0.6 * Math.cos(t * 0.55 + n.y * 0.02) }
        : { x: 0, y: 0 };
      const px = p.x + drift.x;
      const py = p.y + drift.y;
      let r = (n.r + (selected ? 1.2 : 0)) * zScale * hoverBoost;
      if (isCat) r = (mapState === 'sky' ? ROOTB_R : ROOTB_R * 0.85) * zScale * hoverBoost;
      else if (n.kind === 'group') r = (n.baseRow ? Math.max(14, n.r * zScale * 2.2) : (GROUP_DOT_R + 2) * zScale) * hoverBoost;
      else r = (n.hot ? LEAF_HOT_R : LEAF_R) * zScale * Math.max(1, hoverBoost * 0.92);

      if (n.kind === 'machine' || n.kind === 'site') {
        // SOLID bright ivory/white dots (ref_over / default .jdot fill)
        const rr = r * pulse;
        const lit = catHover || hoverNodeId === n.id;
        ctx.beginPath();
        ctx.fillStyle = lit
          ? hexAlpha(n.color, 0.92 * op)
          : `rgba(245,243,238,${(n.hot ? 0.95 : 0.88) * op})`;
        ctx.shadowColor = lit ? hexAlpha(n.color, 0.45) : 'rgba(233,228,214,0.25)';
        ctx.shadowBlur = lit ? 6 : 2;
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (isHub) {
        // Hollow glowing ring — category + group hubs only
        ctx.globalAlpha = op;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(233,228,214,0.05)';
        ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = isCat ? 1.5 : 1.5;
        ctx.strokeStyle = hexAlpha(n.color, (isCat && catHover ? 0.95 : 0.75));
        ctx.shadowColor = hexAlpha(n.color, catHover || isCat ? 0.45 : 0.25);
        ctx.shadowBlur = catHover ? 14 : 7;
        ctx.beginPath();
        ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (isCat) {
          ctx.beginPath();
          ctx.strokeStyle = hexAlpha(n.color, 0.07 * op);
          ctx.lineWidth = 6;
          ctx.arc(px, py, r * pulse + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        if ((focusCat || mapState === 'fan') && isCat) {
          drawBackChevron(px, py, n.color, r);
        } else if (isCat || (n.kind === 'group' && n.baseRow)) {
          drawIcon(px, py, n.icon || 'unknown', n.color, catHover ? 1.05 : 0.85, 0.9);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.fillStyle = `rgba(245,243,238,${0.88 * op})`;
        ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      hitNodes.push({
        id: n.id,
        kind: n.kind === 'category' ? 'category' : (n.alert ? 'alert' : n.kind),
        x: px,
        y: py,
        r: r + 6,
        vr: r,
        ref: n,
      });

      // Group labels — base-row: under each ring; overview: clear of spokes
      if (n.kind === 'group' && groupLod > 0.02) {
        const gi = typeof n.groupIndex === 'number' ? n.groupIndex : 0;
        let gx, gy;
        if (n.baseRow || inFan) {
          // Three rings in a row — label centered under each ring (no stack)
          gx = px;
          gy = py + Math.max(r + 18, 28);
        } else {
          const off = [{ dx: -56, dy: -14 }, { dx: 72, dy: -18 }, { dx: 40, dy: 16 }];
          const o = off[Math.min(gi, off.length - 1)] || { dx: 24, dy: -10 };
          gx = px + o.dx;
          gy = py + o.dy;
        }
        wantedGroupLabels.set(n.id, {
          text: n.groupLabel || n.label,
          x: gx,
          y: gy,
          opacity: groupLod * catOpacity(n.catId),
          mustShow: true,
        });
      }
      // Node / leaf labels — LOD deep tier; sparse enough that text never stacks
      if (n.kind !== 'category' && n.kind !== 'group' && nodeLod > 0.02) {
        const labelOn = inFan
          ? (n.hot || n.depth <= 3 || hoverNodeId === n.id)
          : (n.hot || n.depth <= 3 || (n.kind === 'machine' && n.depth <= 4));
        if (labelOn) {
          wantedNodeLabels.set(n.id, {
            text: n.label,
            x: p.x,
            y: p.y + r + 10,
            opacity: nodeLod * (n.kind === 'machine' && !n.hot ? 0.75 : 1) * catOpacity(n.catId),
          });
        }
      }
    });

    /**
     * Place a DOM label with AABB cull. Groups (priority≥2) win over nodes;
     * groups/nodes may 2D-offset; mustShow groups keep searching farther.
     */
    function placeLabel(want, makeEl, opts = {}) {
      if (!want || want.opacity < 0.03) return null;
      const priority = opts.priority || 0;
      const tryOffset = !!opts.tryOffset;
      const mustShow = !!(opts.mustShow || want.mustShow);
      const charW = priority >= 2 ? 8.2 : 5.6; // short labels; group letter-spaced
      const pad = priority >= 2 ? 12 : 14; // r18: wider cull so text never stacks
      const w = Math.max(28, (want.text || '').length * charW);
      const h = priority >= 2 ? 16 : 14;
      const minY = toolbarBottomPx() + 8;
      const deltas = tryOffset
        ? [
          [0, 0], [18, -6], [-18, -6], [0, -16], [0, 16],
          [28, 0], [-28, 0], [22, -18], [-22, -18], [0, -30],
          [36, -10], [-36, -10], [14, 22], [-14, 22], [0, 32],
        ]
        : [[0, 0]];
      for (let oi = 0; oi < deltas.length; oi++) {
        const [dx, dy] = deltas[oi];
        const x = want.x + dx;
        const y = want.y + dy;
        const box = { x: x - w / 2, y, w, h, priority };
        if (box.x < 4 || box.x + box.w > W - 4 || box.y < minY || box.y > H - 12) continue;
        let clash = false;
        for (let i = 0; i < placedBoxes.length; i++) {
          const other = placedBoxes[i];
          if (!labelBoxesOverlap(box, other, pad)) continue;
          if (priority <= (other.priority || 0)) { clash = true; break; }
        }
        if (clash) continue;
        placedBoxes.push(box);
        const el = makeEl();
        clearTimeout(el._hideT);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.visibility = 'visible';
        el.classList.add('is-on');
        const lid = el.dataset.id || want.text;
        el._opTarget = want.opacity;
        if (!labelOpSmooth.has(lid)) labelOpSmooth.set(lid, 0);
        el.style.opacity = String(labelOpSmooth.get(lid));
        return el;
      }
      // Last resort for required group labels: keep searching wider offsets (no overlap)
      if (mustShow) {
        const extra = [
          [55, -8], [-55, -8], [48, -28], [-48, -28], [70, 0], [-70, 0],
          [40, 24], [-40, 24], [0, -44], [60, -20], [-60, -20],
        ];
        for (let ei = 0; ei < extra.length; ei++) {
          const [dx, dy] = extra[ei];
          const x = want.x + dx;
          const y = Math.max(minY + 4, want.y + dy);
          const box = { x: x - w / 2, y, w, h, priority };
          if (box.x < 4 || box.x + box.w > W - 4 || box.y > H - 12) continue;
          let clash = false;
          for (let i = 0; i < placedBoxes.length; i++) {
            if (labelBoxesOverlap(box, placedBoxes[i], pad)) { clash = true; break; }
          }
          if (clash) continue;
          placedBoxes.push(box);
          const el = makeEl();
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          el._opTarget = want.opacity;
          el.style.visibility = 'visible';
          el.classList.add('is-on');
          const lid2 = el.dataset.id || want.text;
          if (!labelOpSmooth.has(lid2)) labelOpSmooth.set(lid2, 0);
          el.style.opacity = String(labelOpSmooth.get(lid2));
          return el;
        }
      }
      return null;
    }

    // Sync group labels first (higher priority — win over node labels)
    groupLabelEls.forEach((el, id) => {
      const want = wantedGroupLabels.get(id);
      if (!want || want.opacity < 0.03) { hideDomLabel(el); wantedGroupLabels.delete(id); return; }
      el.textContent = want.text;
      if (!placeLabel(want, () => el, { priority: 2, tryOffset: true, mustShow: true })) hideDomLabel(el);
      wantedGroupLabels.delete(id);
    });
    wantedGroupLabels.forEach((want, id) => {
      placeLabel(want, () => ensureGroupLabel(id, want.text), { priority: 2, tryOffset: true, mustShow: true });
    });

    // Sync node labels (derive-or-clear; offset then hide on clash with groups)
    nodeLabelEls.forEach((el, id) => {
      const want = wantedNodeLabels.get(id);
      if (!want || want.opacity < 0.03) { hideDomLabel(el); wantedNodeLabels.delete(id); return; }
      el.textContent = want.text;
      if (!placeLabel(want, () => el, { priority: 0, tryOffset: true })) hideDomLabel(el);
      wantedNodeLabels.delete(id);
    });
    wantedNodeLabels.forEach((want, id) => {
      placeLabel(want, () => ensureNodeLabel(id, want.text), { priority: 0, tryOffset: true });
    });

    // Hard pass: real DOM rects — group labels always win over node labels
    const groupRects = [];
    groupLabelEls.forEach((el) => {
      if (!el.classList.contains('is-on')) return;
      if (Number(getComputedStyle(el).opacity) < 0.05) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      groupRects.push(r);
    });
    if (groupRects.length) {
      nodeLabelEls.forEach((el) => {
        if (!el.classList.contains('is-on')) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        for (let i = 0; i < groupRects.length; i++) {
          const g = groupRects[i];
          const pad = 14;
          const overlap = !(r.right + pad < g.left || r.left - pad > g.right
            || r.bottom + pad < g.top || r.top - pad > g.bottom);
          if (overlap) { hideDomLabel(el); return; }
        }
      });
    }

    // Dim core when a department is hovered (ref hub/spokes → 0.3)
    let coreDim = 1;
    if (mapState === 'sky' && hoverCat) coreDim = 0.3;
    if (coreDim < 1) {
      ctx.save();
      ctx.globalAlpha = coreDim;
      drawCore(t);
      ctx.restore();
    } else {
      drawCore(t);
    }

    // overview category titles — fade as groups take over (clear space for group labels)
    const sidePad = 40;
    const showCatLabels = inSky && catLod > 0.04 && groupLod < 0.88;
    CATS.forEach((cat) => {
      const el = ensureCatLabel(cat);
      if (!showCatLabels) {
        hideDomLabel(el);
        return;
      }
      const wp = catLabelWorld.get(cat.id);
      if (!wp) { hideDomLabel(el); return; }
      const p = worldToScreen(wp.x, wp.y);
      const lx = Math.max(sidePad, Math.min(W - sidePad, p.x));
      // Keep title block ≥40px below toolbar/toggle
      const minTitleCy = toolbarBottomPx() + 40 + 18;
      const ly = Math.max(minTitleCy, Math.min(H - 8, p.y));
      const op = catOpacity(cat.id) * catLod;
      if (op < 0.04 || ly > H - 8) { hideDomLabel(el); return; }
      const w = Math.max(40, cat.label.length * 9);
      const box = { x: lx - w / 2, y: ly - 18, w, h: 36 };
      let clash = false;
      for (let i = 0; i < placedBoxes.length; i++) {
        if (labelBoxesOverlap(box, placedBoxes[i], 2)) { clash = true; break; }
      }
      if (clash && zoom >= LOD_GROUP_IN) { hideDomLabel(el); return; }
      placedBoxes.push(box);
      el.style.left = `${lx}px`;
      el.style.top = `${ly}px`;
      el._opTarget = op;
      el.style.visibility = 'visible';
      el.classList.add('is-on');
      if (!labelOpSmooth.has(cat.id)) { labelOpSmooth.set(cat.id, 0); el.style.opacity = '0'; }
      const featured = CATS[focusedIdx()]?.id === cat.id;
      el.style.filter = (hoverCat && cat.id === hoverCat) || featured
        ? 'brightness(1.15)'
        : 'none';
      if (featured && !hoverCat) el.style.transform = 'translate(-50%, -50%) scale(1.05)';
      else el.style.transform = 'translate(-50%, -50%)';
    });
  }

  function hexAlpha(hex, a) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function contentWorldBounds(catId = null) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let n = 0;
    layoutNodes.forEach((node) => {
      if (catId && node.catId !== catId) return;
      if (node.kind === 'stub' || node.hidden) return;
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
      n += 1;
    });
    if (!n) return null;
    return {
      minX, maxX, minY, maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }

  /** Nearest department cluster to the current view centre (for deep-zoom framing). */
  function activeClusterBounds(camXRef = camX, camYRef = camY) {
    if (zoom < LOD_GROUP_IN) return contentWorldBounds();
    const wx = -camXRef;
    const wy = -camYRef;
    let bestId = null;
    let bestD = Infinity;
    layoutNodes.forEach((n) => {
      if (n.kind !== 'category') return;
      const d = (n.x - wx) * (n.x - wx) + (n.y - wy) * (n.y - wy);
      if (d < bestD) { bestD = d; bestId = n.id; }
    });
    return contentWorldBounds(bestId) || contentWorldBounds();
  }

  /**
   * Largest empty edge band as a fraction of the usable viewport.
   * Catches “jammed to the top / bottom half empty” (r16 stills) better than
   * raw AABB coverage (fans are sparse rectangles).
   */
  function viewportEmptyRatio(cam = null) {
    const cx = cam ? cam.x : camX;
    const cy = cam ? cam.y : camY;
    const bb = activeClusterBounds(cx, cy);
    if (!bb) return 1;
    const u = usable();
    const sMinX = u.cx + (bb.minX + cx) * zoom;
    const sMaxX = u.cx + (bb.maxX + cx) * zoom;
    const sMinY = u.cy + (bb.minY + cy) * zoom;
    const sMaxY = u.cy + (bb.maxY + cy) * zoom;
    const gapTop = Math.max(0, sMinY - u.y) / u.h;
    const gapBot = Math.max(0, (u.y + u.h) - sMaxY) / u.h;
    const gapLeft = Math.max(0, sMinX - u.x) / u.w;
    const gapRight = Math.max(0, (u.x + u.w) - sMaxX) / u.w;
    return Math.max(gapTop, gapBot, gapLeft, gapRight);
  }

  function clampPanToContent() {
    if (mapState === 'diving' || mapState === 'rising') return;
    if (focusCat || mapState === 'fan') {
      const M = 420;
      tCamX = Math.max(-M, Math.min(M, tCamX));
      tCamY = Math.max(-M, Math.min(M, tCamY));
      return;
    }
    if (mapState !== 'sky' && mapState !== 'aligning') return;

    if (zoom <= 1.15) {
      const M = 80;
      tCamX = Math.max(-M, Math.min(M, tCamX));
      tCamY = Math.max(-M, Math.min(M, tCamY));
      camX = Math.max(-M, Math.min(M, camX));
      camY = Math.max(-M, Math.min(M, camY));
      return;
    }

    const bb = activeClusterBounds(tCamX, tCamY);
    if (!bb) return;
    const u = usable();
    const viewCX = u.cx;
    const viewCY = u.y + u.h * 0.45;
    for (let iter = 0; iter < 6; iter++) {
      if (viewportEmptyRatio({ x: tCamX, y: tCamY }) <= MAX_VIEW_EMPTY) break;
      const sMinX = u.cx + (bb.minX + tCamX) * zoom;
      const sMaxX = u.cx + (bb.maxX + tCamX) * zoom;
      const sMinY = u.cy + (bb.minY + tCamY) * zoom;
      const sMaxY = u.cy + (bb.maxY + tCamY) * zoom;
      const cCX = (sMinX + sMaxX) / 2;
      const cCY = (sMinY + sMaxY) / 2;
      tCamX += (viewCX - cCX) / zoom * 0.95;
      tCamY += (viewCY - cCY) / zoom * 0.95;
    }
    const M = 40 + Math.max(0, zoom - 1) * 280;
    tCamX = Math.max(-M, Math.min(M, tCamX));
    tCamY = Math.max(-M, Math.min(M, tCamY));
    camX = Math.max(-M, Math.min(M, camX));
    camY = Math.max(-M, Math.min(M, camY));
  }

  function clampPanSoft() {
    clampPanToContent();
  }

  /** After wheel idle: ease pan so the nearest department fan fills the frame. */
  function settleCameraTowardCluster(sx, sy) {
    if (mapState !== 'sky' || focusCat || morph) return;
    if (zoom < LOD_GROUP_IN) return;
    const u = usable();
    const wx = (sx - u.cx) / Math.max(zoom, 1e-6) - camX;
    const wy = (sy - u.cy) / Math.max(zoom, 1e-6) - camY;
    let bestId = null;
    let bestD = Infinity;
    layoutNodes.forEach((n) => {
      if (n.kind !== 'category') return;
      const d = (n.x - wx) * (n.x - wx) + (n.y - wy) * (n.y - wy);
      if (d < bestD) { bestD = d; bestId = n.id; }
    });
    if (!bestId) return;
    const hub = layoutNodes.find((n) => n.id === bestId && n.kind === 'category');
    if (!hub) return;
    // Focus along hub → tips so the fan opens across the viewport (not void behind hub)
    let tipX = 0, tipY = 0, tipN = 0;
    layoutNodes.forEach((n) => {
      if (n.catId !== bestId || n.kind !== 'machine') return;
      tipX += n.x; tipY += n.y; tipN += 1;
    });
    // Park the hub on the near side of the viewport so the fan opens across the frame
    const outLen = Math.hypot(hub.x, hub.y) || 1;
    const ox = hub.x / outLen;
    const oy = hub.y / outLen;
    // world outward → screen: +worldY is +screenY; top hub has oy≈-1 → push hub down
    const wantHubSX = u.cx - ox * u.w * 0.02;
    // Push hub toward the near edge (~78–82% along outward-opposite) so the fan fills the frame
    const wantHubSY = Math.max(u.y + u.h * 0.18, Math.min(u.y + u.h * 0.82, u.cy - oy * u.h * 0.40));
    tCamX = (wantHubSX - u.cx) / zoom - hub.x;
    tCamY = (wantHubSY - u.cy) / zoom - hub.y;
    clampPanToContent();
    // r19: do not snap cam — let EASE_CAM interpolate (avoids wheel stutter)
  }

  function scheduleCameraSettle(sx, sy) {
    lastWheelSX = sx;
    lastWheelSY = sy;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleCameraTowardCluster(lastWheelSX, lastWheelSY);
    }, SETTLE_MS);
  }

  function smoothLabelOpacities(dt) {
    const k = reduceMotion ? 1 : (1 - Math.pow(0.05, dt / LABEL_FADE_MS));
    labelLayer.querySelectorAll('.cat-label, .group-label, .node-label').forEach((el) => {
      const lid = el.dataset.id || el.className + el.textContent;
      const target = el.classList.contains('is-on')
        ? (el._opTarget != null ? el._opTarget : parseFloat(el.style.opacity) || 0)
        : 0;
      const cur = labelOpSmooth.has(lid) ? labelOpSmooth.get(lid) : (parseFloat(el.style.opacity) || 0);
      const next = cur + (target - cur) * k;
      labelOpSmooth.set(lid, next);
      el.style.opacity = String(next);
      if (next < 0.02 && target < 0.02) {
        el.style.visibility = 'hidden';
        el.classList.remove('is-on');
      }
    });
  }

  function syncWchevOpacity() {
    const elL = document.getElementById('wchev-l');
    const elR = document.getElementById('wchev-r');
    if (!elL || !elR) return;
    let op = 0;
    if (mapState === 'sky' && !focusCat && !morph) {
      // 1.0 → full; fade out by ARROW_FADE_ZOOM (~120%)
      op = zoom <= 1
        ? 1
        : Math.max(0, Math.min(1, (ARROW_FADE_ZOOM - zoom) / Math.max(1e-6, ARROW_FADE_ZOOM - 1)));
    }
    const hide = op < 0.05;
    const pe = hide ? 'none' : 'auto';
    elL.style.opacity = String(op);
    elR.style.opacity = String(op);
    elL.style.visibility = hide ? 'hidden' : 'visible';
    elR.style.visibility = hide ? 'hidden' : 'visible';
    elL.style.pointerEvents = pe;
    elR.style.pointerEvents = pe;
    document.body.classList.toggle('wchev-hidden', hide);
  }

  function zoomAtScreen(clientX, clientY, nextZoom, opts) {
    lastInteractTs = performance.now();
    // wheel activity pauses idle dial
    const immediate = !!(opts && opts.immediate) || reduceMotion;
    const u = usable();
    const ox = u.cx;
    const oy = u.cy;
    const zn = clampZoom(nextZoom);
    // Pivot from current rendered zoom (skilltree scaleT ease 0.13 / wheel 0.11)
    const zBase = Math.max(zoom, 1e-6);
    const wx = (clientX - ox) / zBase - camX;
    const wy = (clientY - oy) / zBase - camY;
    targetZoom = zn;
    tCamX = (clientX - ox) / zn - wx;
    tCamY = (clientY - oy) / zn - wy;
    lastWheelSX = clientX;
    lastWheelSY = clientY;
    zoomPivot = { sx: clientX, sy: clientY, wx, wy };
    if (immediate) {
      zoom = zn;
      camX = tCamX;
      camY = tCamY;
      zoomPivot = null;
    }
    clampPanToContent();
  }

  function tick(ts) {
    const t = ts / 1000;
    const dt = lastTickTs ? Math.min(48, ts - lastTickTs) : 16;
    lastTickTs = ts;
    const ease = reduceMotion ? 1 : EASE_CAM;

    // r19 idle: slow CW dial when sky + idle (map.html has no idle dial; video does ~4°/s)
    if (idleRotateOn && mapState === 'sky' && !dragging && !morph && !hoverCat && !wheelCoasting
      && Math.abs(wheelT - wheelA) < 0.05 && zoom <= 1.02 && Math.abs(targetZoom - zoom) < 0.01
      && !reduceMotion && (performance.now() - lastInteractTs) > 1200) {
      const d = IDLE_ROT_DEG_PER_S * (dt / 1000);
      wheelA += d;
      wheelT = wheelA;
      layoutWheel();
    }

    // Sky dial: coast with friction, then ease to detent (ref flick + snapWheel)
    if ((mapState === 'sky' || mapState === 'aligning') && !dragging) {
      if (wheelCoasting && Math.abs(wheelV) > WHEEL_COAST_MIN) {
        wheelA += wheelV * dt;
        wheelT = wheelA;
        wheelV *= Math.pow(WHEEL_FRICTION, dt / 16.67);
        layoutWheel();
        if (Math.abs(wheelV) <= WHEEL_COAST_MIN) {
          wheelV = 0;
          wheelCoasting = false;
          snapWheel();
        }
      } else if (Math.abs(wheelT - wheelA) > 0.01) {
        wheelA += (wheelT - wheelA) * (reduceMotion ? 1 : EASE_WHEEL);
        layoutWheel();
      } else {
        wheelA = wheelT;
      }
    } else if (Math.abs(wheelT - wheelA) > 0.01) {
      wheelA += (wheelT - wheelA) * (reduceMotion ? 1 : EASE_WHEEL);
      if (mapState === 'sky' || mapState === 'aligning') layoutWheel();
    } else {
      wheelA = wheelT;
    }

    // Hover / dive dim — time-based ease (ref 350ms; dive fades others to 0)
    if (mapState === 'sky' || mapState === 'aligning' || mapState === 'diving') {
      const k = reduceMotion ? 1 : (1 - Math.pow(0.05, dt / HOVER_FADE_MS));
      CATS.forEach((cat) => {
        let target = 1;
        if (mapState === 'diving' || mapState === 'aligning') {
          const fid = (morph && morph.focusId) || hoverCat;
          if (fid) target = cat.id === fid ? 1 : 0;
        } else if (hoverCat) {
          target = cat.id === hoverCat ? 1 : DIM_OTHERS;
        }
        const cur = hoverAlpha[cat.id] ?? 1;
        hoverAlpha[cat.id] = cur + (target - cur) * k;
        if (Math.abs(hoverAlpha[cat.id] - target) < 0.004) hoverAlpha[cat.id] = target;
      });
    }

    // Morph: drive camera from shared ease clock; complete without layout flash
    if (morph && (mapState === 'diving' || mapState === 'rising')) {
      const u = morphProgress();
      const e = easeInOutCubic(u);
      const cf = morph.camFrom;
      const ct = morph.camTo;
      zoom = targetZoom = lerp(cf.zoom, ct.zoom, e);
      camX = tCamX = lerp(cf.camX, ct.camX, e);
      camY = tCamY = lerp(cf.camY, ct.camY, e);
      if (u >= 1) {
        if (mapState === 'diving') {
          focusCat = morph.focusId;
          mapState = 'fan';
          setFanMode(true);
          zoom = targetZoom = ct.zoom;
          camX = tCamX = ct.camX;
          camY = tCamY = ct.camY;
          morph = null;
          clearPointerHover();
          // Drop overview cat titles; node labels re-derive next frame
          labelEls.forEach((el) => hideDomLabel(el, true));
          const cat = CATS.find((c) => c.id === focusCat);
          if (cat) {
            focusBar.hidden = false;
            focusTitle.textContent = cat.label;
            focusSub.textContent = catSubline(cat);
            focusTitle.style.color = cat.color;
          }
          setTimeout(() => setTransitioning(false), Math.max(40, TRANSITIONING_MS - DIVE_MORPH_MS));
        } else if (mapState === 'rising') {
          zoom = targetZoom = ct.zoom;
          camX = tCamX = ct.camX;
          camY = tCamY = ct.camY;
          morph = null;
          focusCat = null;
          focusLayout = null;
          selectedChain = -1;
          mapState = 'sky';
          setFanMode(false);
          focusBar.hidden = true;
          clearPointerHover();
          nodeLabelEls.forEach((el) => hideDomLabel(el));
          setTimeout(() => setTransitioning(false), 40);
        }
      }
    } else {
      // Normal camera ease (skilltree EASE_CAM 0.13) — continuous, no steppy jumps
      zoom += (targetZoom - zoom) * ease;
      if (zoomPivot && Math.abs(targetZoom - zoom) > 0.0008) {
        const u = usable();
        const { sx, sy, wx, wy } = zoomPivot;
        camX = (sx - u.cx) / Math.max(zoom, 1e-6) - wx;
        camY = (sy - u.cy) / Math.max(zoom, 1e-6) - wy;
        tCamX = (sx - u.cx) / Math.max(targetZoom, 1e-6) - wx;
        tCamY = (sy - u.cy) / Math.max(targetZoom, 1e-6) - wy;
      } else {
        zoomPivot = null;
        camX += (tCamX - camX) * ease;
        camY += (tCamY - camY) * ease;
      }
    }
    clampPanSoft();
    smoothLabelOpacities(dt);
    syncZoomPct();
    syncWchevOpacity();

    if (viewMode === 'map') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Always paint charcoal first — kills white flash
      ctx.fillStyle = '#20242d';
      ctx.fillRect(0, 0, W, H);
      if (mapReady) {
        drawScene(t);
        if (!reduceMotion) {
          ensureStars();
          starField.forEach((s, i) => {
            const tw = 0.45 + 0.35 * Math.sin(t * 1.1 + i * 1.7);
            if (tw < 0.55) return;
            ctx.beginPath();
            ctx.fillStyle = `rgba(233,228,214,${s.a * tw * 0.35})`;
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function seatWheelTo(di) {
    let t = 180 - di * W_STEP;
    while (t - wheelT > 180) t -= 360;
    while (t - wheelT < -180) t += 360;
    wheelT = t;
    return Math.min(800, 180 + Math.abs(t - wheelA) * 5);
  }

  function focusCategory(id) {
    const cat = CATS.find((c) => c.id === id);
    if (!cat || mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    if (focusCat === id && mapState === 'fan') return;

    const idx = CATS.findIndex((c) => c.id === id);
    clearPointerHover();
    clearFloatingLabels();
    selectedChain = -1;
    closeCore(false);
    if (selectedAlert && selectedAlert.categoryId !== id) closePanel(false);
    setTransitioning(true);

    // Phase A: align wheel (ref aligning)
    mapState = 'aligning';
    const wait = seatWheelTo(idx);

    const startMorph = () => {
      mapState = 'diving';
      layoutWheel();
      const focusNodes = layoutNodes.filter((n) => n.catId === id);
      const from = snapshotLayout(focusNodes, layoutLinks.filter((L) => {
        const tN = layoutNodes.find((n) => n.id === L.t);
        return tN && tN.catId === id;
      }));
      const otherFrom = layoutNodes
        .filter((n) => n.catId !== id && n.kind !== 'stub')
        .map((n) => ({ ...n }));

      // Build TO (fan) + camera targets WITHOUT snapping current camera
      rebuildFocusLayout(id, { setCamera: true, diveZoom: true });
      const to = snapshotLayout(focusLayout.nodes, focusLayout.links);
      const camFrom = { zoom, camX, camY };
      const camTo = { zoom: targetZoom, camX: tCamX, camY: tCamY };

      // Keep drawing morph until complete — never flash raw focusLayout early
      focusCat = null;
      beginMorph({
        dir: 1, focusId: id, from, to, duration: DIVE_MORPH_MS,
        camFrom, camTo, otherFrom,
      });
    };

    // Soft dim toward focus during align — others fade out (skilltree .dim)
    hoverCat = id;
    CATS.forEach((c) => {
      if (c.id !== id) hoverAlpha[c.id] = Math.min(hoverAlpha[c.id] ?? 1, 0.12);
    });
    const hub = layoutNodes.find((n) => n.id === id);
    if (hub) {
      targetZoom = clampZSky(Math.min(1.35, Math.max(zoom, 1.05)));
      tCamX = -hub.x * 0.15;
      tCamY = -hub.y * 0.15;
    }

    setTimeout(startMorph, reduceMotion ? 0 : Math.max(DIVE_ALIGN_MS, wait));
  }

  function clearFocus({ immediate = false } = {}) {
    if (mapState === 'rising' || mapState === 'diving' || mapState === 'aligning') return;
    if (mapState === 'sky' && !focusCat) {
      recenterMap({ immediate });
      return;
    }
    const id = focusCat || (focusLayout && focusLayout.cat && focusLayout.cat.id);
    if (!id) return;

    setTransitioning(true);
    closePanel(false);
    closeCore(false);
    selectedChain = -1;
    clearPointerHover();
    clearFloatingLabels();

    if (immediate || reduceMotion) {
      morph = null;
      focusCat = null;
      focusLayout = null;
      mapState = 'sky';
      setFanMode(false);
      focusBar.hidden = true;
      rebuildOverviewLayout();
      targetZoom = clampZSky(1);
      recenterMap({ immediate: true });
      setTransitioning(false);
      return;
    }

    if (!focusLayout) rebuildFocusLayout(id, { setCamera: false });
    const from = snapshotLayout(focusLayout.nodes, focusLayout.links);
    const camFrom = { zoom, camX, camY };
    mapState = 'rising';
    focusCat = null;
    setFanMode(false);
    focusBar.hidden = true;
    // Rebuild overview for TO + other departments (wheel stays seated)
    rebuildOverviewLayout();
    const toNodes = layoutNodes.filter((n) => n.catId === id);
    const to = snapshotLayout(toNodes, layoutLinks.filter((L) => {
      const tn = layoutNodes.find((n) => n.id === L.t);
      return tn && tn.catId === id;
    }));
    const otherFrom = layoutNodes
      .filter((n) => n.catId !== id && n.kind !== 'stub')
      .map((n) => ({ ...n }));
    const camTo = { zoom: clampZSky(1), camX: 0, camY: -H * 0.04 };
    targetZoom = camTo.zoom;
    tCamX = camTo.camX;
    tCamY = camTo.camY;
    beginMorph({
      dir: -1, focusId: id, from, to, duration: RISE_MS,
      camFrom, camTo, otherFrom,
    });
  }

  function stepCategory(dir) {
    if (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    if (focusCat || mapState === 'fan') {
      const i = CATS.findIndex((c) => c.id === focusCat);
      const next = CATS[(i + dir + CATS.length) % CATS.length];
      // Ref: buildFan(prev/next) — morph between focus layouts
      setTransitioning(true);
      const from = snapshotLayout(focusLayout.nodes, focusLayout.links);
      rebuildFocusLayout(next.id, { setCamera: true });
      const to = snapshotLayout(focusLayout.nodes, focusLayout.links);
      focusCat = next.id;
      selectedChain = -1;
      closePanel(false);
      beginMorph({ dir: 1, focusId: next.id, from, to, duration: 600 });
      mapState = 'diving'; // reuse morph completion → fan
      focusTitle.textContent = next.label;
      focusSub.textContent = catSubline(next);
      focusTitle.style.color = next.color;
      return;
    }
    // Sky: rotate dial (ref stepWheel)
    stepWheel(dir);
  }

  function badgeClass(state) {
    const s = String(state || '').toLowerCase();
    if (s.includes('critical')) return 'critical';
    if (s.includes('warn')) return 'warning';
    if (s.includes('resol') || s.includes('monitor')) return s.includes('monitor') ? 'open' : 'resolved';
    return 'open';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function renderNodePanel(alert) {
    const m = alert.machine;
    const cat = CATS.find((c) => c.id === alert.categoryId);
    panelBody.innerHTML = `
      <div class="panel-kicker"><span class="badge ${badgeClass(alert.state)}">${escapeHtml(alert.state)}</span></div>
      <h2 class="panel-title">${escapeHtml(alert.title)}</h2>
      <div class="panel-meta">${escapeHtml(cat?.label || alert.categoryId)} · ${escapeHtml(alert.subtype)}</div>
      <p class="panel-desc">${escapeHtml(alert.description)}</p>
      <div class="action-banner">
        <span>Ops action ready for this machine</span>
        <button type="button">${escapeHtml(alert.action || 'Open →')}</button>
      </div>
      <div class="sec">
        <h3>Affects</h3>
        <div class="pills">
          <span class="pill"><i class="pi pi-m"></i>${escapeHtml(m.machine)}</span>
          <span class="pill"><i class="pi pi-s"></i>${escapeHtml(m.site)}</span>
          <span class="pill"><i class="pi pi-a"></i>${escapeHtml(m.area)}</span>
        </div>
      </div>
      <div class="sec">
        <h3>Caused by</h3>
        <div class="pills">
          <span class="pill dashed">${escapeHtml(alert.subtype)}</span>
          <span class="pill dashed">${escapeHtml(m.status)}</span>
        </div>
      </div>
      <div class="sec">
        <h3>Impact</h3>
        <div class="impact-card">
          <div class="tiny" style="letter-spacing:.12em;text-transform:uppercase;font-weight:700">Revenue at risk</div>
          <div class="big">${alert.impactPerHour.toFixed(1)} KWD / hr</div>
          <div class="tiny">Estimated from daily average while this alert stays open.</div>
        </div>
      </div>
      <div class="sec">
        <h3>The ladder</h3>
        <div class="ladder">
          ${(alert.ladderSteps || window.LEET_ALERTS_DATA.ladder(alert.ladder)).map((s) => `
            <div class="ladder-row ${s.current ? 'is-current' : ''}">
              <div class="step">${s.label}</div>
              <div>${escapeHtml(s.copy)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function openPanel(alert) {
    selectedAlert = alert;
    renderNodePanel(alert);
    closeCore(false);
    nodePanel.hidden = false;
    nodePanel.setAttribute('aria-hidden', 'false');
    panelOpen = true;
    document.body.classList.add('panel-open');
    void nodePanel.offsetWidth;
    nodePanel.classList.add('is-open');
    if (focusCat) rebuildFocusLayout(focusCat);
  }

  function closePanel(animate = true) {
    selectedAlert = null;
    panelOpen = false;
    nodePanel.classList.remove('is-open');
    const hide = () => {
      if (!panelOpen) {
        nodePanel.hidden = true;
        nodePanel.setAttribute('aria-hidden', 'true');
      }
    };
    if (!animate) hide();
    else setTimeout(hide, 320);
    if (!coreOpen) document.body.classList.remove('panel-open');
    if (focusCat) rebuildFocusLayout(focusCat);
  }

  function renderCorePanel() {
    const c = SNAP.counters;
    coreBody.innerHTML = `
      <div class="panel-kicker">LEET OVERVIEW</div>
      <h2 class="panel-title">Leet overview</h2>
      <div class="panel-meta">Single snapshot · ${c.machines} machines · ${c.totalNodes} map nodes · Shadadiya · Zahra · Salmiya</div>
      <p class="panel-desc">Category trees share one counter set with the core, branch badges, and dashboards.</p>
      <div class="core-stats">
        <div class="core-stat"><div class="n">${c.open}</div><div class="l">Open alerts</div></div>
        <div class="core-stat"><div class="n">${c.critical}</div><div class="l">Critical</div></div>
        <div class="core-stat"><div class="n">${c.warning}</div><div class="l">Warning</div></div>
        <div class="core-stat"><div class="n">${c.revenueAtRisk}</div><div class="l">KWD / hr risk</div></div>
      </div>
      <div class="sec"><h3>By category</h3>
        <div class="ladder">
          ${CATS.map((cat) => `
            <div class="ladder-row">
              <div class="step" style="color:${cat.color}">${cat.label}</div>
              <div>${cat.count} open · ${cat.nodeCount} nodes · ${escapeHtml(cat.subtitle)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="sec"><h3>Recent incidents</h3>
        <div class="ladder">
          ${SNAP.alerts.slice(0, 8).map((a) => `
            <div class="ladder-row">
              <div class="step">${a.state}</div>
              <div>${escapeHtml(a.title)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function openCore() {
    renderCorePanel();
    corePanel.hidden = false;
    corePanel.setAttribute('aria-hidden', 'false');
    coreOpen = true;
    document.body.classList.add('panel-open');
    void corePanel.offsetWidth;
    corePanel.classList.add('is-open');
    closePanel(false);
  }

  function closeCore(animate = true) {
    coreOpen = false;
    corePanel.classList.remove('is-open');
    const hide = () => {
      if (!coreOpen) {
        corePanel.hidden = true;
        corePanel.setAttribute('aria-hidden', 'true');
      }
    };
    if (!animate) hide();
    else setTimeout(hide, 320);
    if (!panelOpen) document.body.classList.remove('panel-open');
  }

  function pick(x, y) {
    let best = null, bestD = 1e9;
    hitNodes.forEach((h) => {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d <= h.r && d < bestD) { best = h; bestD = d; }
    });
    return best;
  }

  /** Hit-test department under pointer (hub or any branch node). */
  function pickDepartment(x, y) {
    const hit = pick(x, y);
    if (!hit || hit.kind === 'core') return null;
    return hit.ref?.catId || (hit.kind === 'category' ? (hit.ref?.id || hit.id) : null);
  }


  function ensureHoverTip() {
    let el = document.getElementById('hover-tip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hover-tip';
      el.className = 'hover-tip';
      el.hidden = true;
      mapView.appendChild(el);
    }
    return el;
  }
  function showHoverTip(n, sx, sy) {
    const el = ensureHoverTip();
    if (!n || (!n.alert && n.kind === 'category')) { el.hidden = true; return; }
    const title = n.label || n.alert?.title || '';
    const sub = n.alert ? `${n.alert.state || ''} · ${n.alert.subtype || ''}`.replace(/^ · | · $/g, '') : (n.kind || '');
    el.innerHTML = `<div class="ht-name">${escapeHtml(title)}</div><div class="ht-sub">${escapeHtml(sub)}</div>`;
    el.style.left = `${Math.min(W - 180, Math.max(12, sx + 14))}px`;
    el.style.top = `${Math.min(H - 70, Math.max(60, sy - 10))}px`;
    el.hidden = false;
  }
  function hideHoverTip() {
    const el = document.getElementById('hover-tip');
    if (el) el.hidden = true;
  }

  function setHoverFromPointer(lx, ly) {
    if (mapState !== 'sky' && mapState !== 'fan') { hideHoverTip(); return; }
    const hit = pick(lx, ly);
    if (!hit || hit.kind === 'core') {
      hoverNodeId = null;
      if (mapState === 'sky') hoverCat = null;
      hideHoverTip();
      canvas.style.cursor = dragging ? 'grabbing' : 'grab';
      return;
    }
    if (mapState === 'sky') {
      // Ref: whole department hover only (no per-node path)
      hoverCat = hit.ref?.catId || (hit.kind === 'category' ? (hit.ref?.id || hit.id) : null);
      hoverNodeId = null;
      hideHoverTip();
      canvas.style.cursor = hoverCat ? 'pointer' : 'grab';
      return;
    }
    // Fan: hover scales node + small info card (ref 0:16 / 0:23)
    hoverCat = null;
    hoverNodeId = hit.ref?.id || hit.id;
    canvas.style.cursor = 'pointer';
    if (hit.ref && hit.kind !== 'category') showHoverTip(hit.ref, lx, ly);
    else hideHoverTip();
  }

  function setHoverCat(id) {
    if (mapState !== 'sky') {
      hoverCat = null;
      return;
    }
    // Only set target; tick eases hoverAlpha over HOVER_FADE_MS (no instant snap)
    hoverCat = id || null;
    hoverNodeId = null;
    canvas.style.cursor = hoverCat ? 'pointer' : 'grab';
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (viewMode !== 'map') return;
    if (e.target.closest?.('.wchev, .focus-bar, .side-panel, .core-panel, .topbar')) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      dragging = false;
      const vals = [...ptrs.values()];
      pinchD0 = Math.hypot(vals[0][0] - vals[1][0], vals[0][1] - vals[1][1]);
      pinchS0 = zoom; pinchRatio = 1;
      const mx = (vals[0][0] + vals[1][0]) / 2;
      const my = (vals[0][1] + vals[1][1]) / 2;
      const u = usable();
      const rect = canvas.getBoundingClientRect();
      pinchAX = (mx - rect.left - u.cx) / zoom - camX;
      pinchAY = (my - rect.top - u.cy) / zoom - camY;
      dragDist = 99;
      return;
    }
    dragging = true;
    lastInteractTs = performance.now();
    lastX = e.clientX; lastY = e.clientY;
    lastMoveTs = performance.now();
    flickV = 0;
    flickT = lastMoveTs;
    wheelV = 0;
    wheelCoasting = false;
    dragDist = 0;
    canvas.classList.add('is-dragging');
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const rect = canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;

    if (ptrs.size >= 2 && pinchD0 > 0) {
      const vals = [...ptrs.values()];
      const dist = Math.hypot(vals[0][0] - vals[1][0], vals[0][1] - vals[1][1]);
      pinchRatio = dist / pinchD0;
      if (mapState === 'sky' || mapState === 'fan' || focusCat) {
        const zn = clampZoom(pinchS0 * pinchRatio);
        const mx = (vals[0][0] + vals[1][0]) / 2 - rect.left;
        const my = (vals[0][1] + vals[1][1]) / 2 - rect.top;
        const u = usable();
        zoom = targetZoom = zn;
        camX = tCamX = (mx - u.cx) / zn - pinchAX;
        camY = tCamY = (my - u.cy) / zn - pinchAY;
      }
      return;
    }

    if (!dragging && viewMode === 'map') setHoverFromPointer(lx, ly);
    if (!dragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    dragDist += Math.hypot(dx, dy);

    if (mapState === 'sky' || mapState === 'aligning') {
      // r16 video: drag pans the canvas. Dial rotate stays on arrows (+ snap).
      // At near-rest zoom, outer angular drag still spins the dial (no scroll conflict).
      const u = usable();
      const ox = u.cx + camX * zoom;
      const oy = u.cy + camY * zoom;
      const x1 = e.clientX - rect.left, y1 = e.clientY - rect.top;
      const rad = Math.hypot(x1 - ox, y1 - oy);
      const dialGrab = zoom < 1.35 && rad > Math.min(W, H) * 0.22;
      if (dialGrab) {
        const x0 = lastX - dx - rect.left, y0 = lastY - dy - rect.top;
        const r0x = x0 - ox, r0y = y0 - oy;
        const r1x = x1 - ox, r1y = y1 - oy;
        let dA = 0;
        if (Math.hypot(r0x, r0y) > 48 && Math.hypot(r1x, r1y) > 48) {
          dA = (Math.atan2(r1y, r1x) - Math.atan2(r0y, r0x)) * 180 / Math.PI;
          if (dA > 180) dA -= 360; if (dA < -180) dA += 360;
          wheelA += dA;
        } else {
          dA = -dx * 0.12;
          wheelA += dA;
        }
        const now2 = performance.now();
        const dtm = Math.max(1, now2 - flickT);
        wheelV = FLICK_EMA * wheelV + (1 - FLICK_EMA) * (dA / dtm);
        flickV = FLICK_EMA * flickV + (1 - FLICK_EMA) * (dx / dtm);
        flickT = now2;
        wheelT = wheelA;
        layoutWheel();
        clearTimeout(wheelIdle);
      } else {
        const inv = 1 / Math.max(zoom, 0.05);
        camX += dx * inv; tCamX = camX;
        camY += dy * inv; tCamY = camY;
        wheelV = 0;
        wheelCoasting = false;
      }
    } else if (mapState === 'fan' || focusCat) {
      // Direct pan, no inertia (ref fan)
      const inv = 1 / Math.max(zoom, 0.05);
      camX += dx * inv; tCamX = camX;
      camY += dy * inv; tCamY = camY;
    }
  });

  const endPtr = (e) => {
    if (ptrs.has(e.pointerId)) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2 && pinchD0 > 0) {
        if (mapState === 'sky' && pinchRatio > 1.35) focusCategory(CATS[focusedIdx()].id);
        else if ((mapState === 'fan' || focusCat) && pinchRatio < 0.62 && targetZoom <= RISE_SCALE + 0.02) clearFocus();
        pinchD0 = 0;
      }
    }
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (mapState === 'sky') {
      clearTimeout(wheelIdle);
      // Coast with momentum then snap to bottom detent (desktop + mobile)
      const brisk = Math.abs(flickV) > FLICK_THRESH || Math.abs(wheelV) > 0.05;
      if (brisk) {
        // Ref: contA capped ±1.6*W_STEP from flick, then snap lattice
        const contA = Math.max(-1.6 * W_STEP, Math.min(1.6 * W_STEP, wheelV * 140));
        wheelT = wheelA + contA;
        wheelCoasting = true;
        // Keep wheelV for friction coast; ensure non-zero
        if (Math.abs(wheelV) < 0.12) wheelV = (contA >= 0 ? 1 : -1) * 0.22;
        wheelIdle = setTimeout(() => {
          if (Math.abs(wheelV) <= WHEEL_COAST_MIN) snapWheel();
        }, 420);
      } else {
        wheelV = 0;
        wheelCoasting = false;
        wheelIdle = setTimeout(snapWheel, 260);
      }
    }
    canvas.style.cursor = (hoverCat || hoverNodeId) ? 'pointer' : 'grab';
  };
  window.addEventListener('pointerup', endPtr);
  window.addEventListener('pointercancel', (e) => {
    endPtr(e);
    clearPointerHover();
  });

  // Fast leave / blur / tab hide must not leave hover dim or orphan DOM labels
  canvas.addEventListener('pointerleave', () => {
    if (!dragging) clearPointerHover();
  });
  window.addEventListener('blur', () => {
    clearPointerHover();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') clearPointerHover();
  });

  canvas.addEventListener('wheel', (e) => {
    if (viewMode !== 'map') return;
    if (e.target.closest?.('.side-panel, .core-panel, .map-controls')) return;
    e.preventDefault();
    if (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    const now = performance.now();
    if (now < zoomLockUntil) return;
    const rect = canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;

    // r16 marketing video: PLAIN scroll zooms (ctrl/pinch too). Never rotates the dial.
    const dominantY = Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 0.85;
    if (!dominantY && Math.abs(e.deltaX) > 0.5) {
      // Mostly-horizontal trackpad → pan only
      const inv = 1 / Math.max(zoom, 0.05);
      camX -= e.deltaX * inv; tCamX = camX;
      camY -= e.deltaY * inv; tCamY = camY;
      return;
    }

    const zn = clampZoom(zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_EXP));
    zoomAtScreen(lx, ly, zn);
    scheduleCameraSettle(lx, ly);

    // Fan: zooming out past floor still rises (Escape/back parity)
    if ((mapState === 'fan' || focusCat) && e.deltaY > 0 && zn <= RISE_SCALE) {
      zoomIntent += -e.deltaY;
      if (zoomIntent < -110) {
        clearFocus();
        zoomIntent = 0;
        zoomLockUntil = now + 900;
      }
    } else if (e.deltaY < 0) {
      zoomIntent = 0;
    }
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    if (viewMode !== 'map' || dragDist >= DRAG_CLICK_CANCEL) return;
    if (mapState === 'diving' || mapState === 'rising' || mapState === 'aligning') return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      if (mapState === 'fan') {
        if (panelOpen) { closePanel(); selectedChain = -1; }
        else if (coreOpen) closeCore();
        else {
          // fitCurrent
          if (focusCat) rebuildFocusLayout(focusCat, { setCamera: true });
          selectedChain = -1;
        }
      } else if (coreOpen) closeCore();
      return;
    }
    if (hit.kind === 'core') { openCore(); return; }
    if (hit.kind === 'category') {
      if (mapState === 'fan' || focusCat) { clearFocus(); return; }
      focusCategory(hit.ref?.catId || hit.ref?.id || hit.id);
      return;
    }
    if (mapState === 'sky' && hit.ref?.catId) {
      focusCategory(hit.ref.catId);
      return;
    }
    if (hit.ref?.alert && (mapState === 'fan' || focusCat)) {
      selectedChain = hit.ref.chain != null ? hit.ref.chain : -1;
      targetZoom = clampZFan(Math.min(Z_FAN_MAX, Math.max(targetZoom, 1.35)));
      tCamX = -hit.ref.x;
      tCamY = -hit.ref.y + 30 / Math.max(targetZoom, 0.5);
      openPanel({
        ...hit.ref.alert,
        ladderSteps: hit.ref.alert.ladderSteps || window.LEET_ALERTS_DATA.ladder(hit.ref.alert.ladder),
      });
    } else if (hit.ref && (mapState === 'fan' || focusCat)) {
      selectedChain = hit.ref.chain != null ? hit.ref.chain : -1;
      targetZoom = clampZFan(0.92);
      tCamX = -hit.ref.x;
      tCamY = -hit.ref.y;
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    if (viewMode !== 'map') return;
    e.preventDefault();
    if (mapState === 'fan' || focusCat) {
      // Double-click in focus: step zoom out / rise at floor (ref Fit-adjacent)
      zoomStep(-1);
      return;
    }
    if (mapState === 'sky') recenterMap({ immediate: false });
  });

  document.getElementById('cat-prev').addEventListener('click', () => stepCategory(-1));
  document.getElementById('cat-next').addEventListener('click', () => stepCategory(1));
  document.getElementById('wchev-l').addEventListener('click', () => stepWheel(-1));
  document.getElementById('wchev-r').addEventListener('click', () => stepWheel(1));
  document.getElementById('zoom-out')?.addEventListener('click', () => zoomStep(-1));
  document.getElementById('zoom-in')?.addEventListener('click', () => zoomStep(1));
  document.getElementById('zoom-fit')?.addEventListener('click', () => fitCurrent());
  document.getElementById('panel-close').addEventListener('click', () => { closePanel(); selectedChain = -1; });
  document.getElementById('core-close').addEventListener('click', () => closeCore());
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (e.key === 'Escape') {
      if (panelOpen) { closePanel(); selectedChain = -1; }
      else if (coreOpen) closeCore();
      else if (mapState === 'fan' || focusCat) clearFocus();
      else recenterMap({ immediate: false });
    }
    if (e.key === '-' || e.key === '_') { zoomStep(-1); }
    if (e.key === '=' || e.key === '+') { zoomStep(1); }
    if (e.key === '0') {
      if (mapState === 'fan' && focusCat) rebuildFocusLayout(focusCat, { setCamera: true });
      else recenterMap({ immediate: false });
    }
    if (mapState === 'fan' || focusCat) {
      if (e.key === 'ArrowRight') stepCategory(1);
      if (e.key === 'ArrowLeft') stepCategory(-1);
    } else if (mapState === 'sky') {
      if (e.key === 'ArrowRight') stepWheel(1);
      if (e.key === 'ArrowLeft') stepWheel(-1);
    }
  });

  document.querySelectorAll('.view-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-toggle button').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      viewMode = btn.dataset.view;
      mapView.hidden = viewMode !== 'map';
      dashView.hidden = viewMode !== 'dashboards';
      if (viewMode === 'dashboards') renderDash();
    });
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQ = String(e.target.value || '').trim().toLowerCase();
  });

  function renderDash() {
    const c = SNAP.counters;
    dashGrid.innerHTML = `
      <div class="dash-card"><div class="k">Open alerts</div><div class="v">${c.open}</div><div class="d">Critical + warning across all trees</div></div>
      <div class="dash-card"><div class="k">Map nodes</div><div class="v">${c.totalNodes}</div><div class="d">Category → rule → area → site → machine</div></div>
      <div class="dash-card"><div class="k">Critical</div><div class="v">${c.critical}</div><div class="d">Offline / maintenance</div></div>
      <div class="dash-card"><div class="k">KWD / hr risk</div><div class="v">${c.revenueAtRisk}</div><div class="d">Sum of open impact cards</div></div>
      <div class="dash-list">
        ${SNAP.alerts.map((a) => `
          <div class="dash-row">
            <span class="badge ${badgeClass(a.state)}">${a.state}</span>
            <span>${escapeHtml(a.title)}</span>
            <span style="color:var(--muted)">${escapeHtml((CATS.find((c) => c.id === a.categoryId) || {}).label || '')}</span>
            <span style="color:var(--muted)">${a.impactPerHour} KWD/h</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function visibleScreenNodes() {
    const u = usable();
    return hitNodes.filter((h) => h.kind !== 'core' && h.x >= u.x - 8 && h.x <= u.x + u.w + 8 && h.y >= 40 && h.y <= H - 8);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(denom) < 1e-9) return false; // parallel
    const ua = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
    const ub = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
    // Proper crossing (exclude shared endpoints)
    return ua > 0.02 && ua < 0.98 && ub > 0.02 && ub < 0.98;
  }

  window.LEET_ALERTS_MAP = {
    snapshot: () => JSON.parse(JSON.stringify(SNAP)),
    getCounters: () => ({ ...SNAP.counters }),
    getFocus: () => ({
      categoryId: focusCat, alertId: selectedAlert?.id || null,
      coreOpen, panelOpen, view: viewMode, mapState, focusedIdx: focusedIdx(),
      selectedChain, wheelA, wheelT,
    }),
    getTransform: () => ({ zoom, camX, camY, tCamX, tCamY, targetZoom, wheelA, wheelT }),
    interactionConstants: () => ({
      EASE_CAM, EASE_WHEEL, EASE_HOVER: 1 - Math.pow(0.05, 16.67 / HOVER_FADE_MS),
      HOVER_FADE_MS, LABEL_FADE_MS, DIM_OTHERS, NODE_FADED, HOVER_NODE_SCALE, HOVER_CAT_SCALE,
      DRAG_CLICK_CANCEL, WHEEL_ZOOM_EXP, ZOOM_STEP_IN, ZOOM_STEP_OUT,
      Z_FAN_MIN, Z_FAN_MAX, Z_SKY_MIN, Z_SKY_MAX, RISE_SCALE, FAN_SPAN_DEG: 182, R0_FAN, R_BASE, R_STEP,
      LOD_GROUP_IN, LOD_GROUP_FULL, LOD_NODE_IN, LOD_NODE_FULL,
      SETTLE_MS, ARROW_FADE_ZOOM, MAX_VIEW_EMPTY,
      plainWheelZooms: true, scrollNeverRotatesDial: true,
      DIVE_ALIGN_MS, DIVE_MORPH_MS, DIVE_SWAP_MS, DIVE_ZOOM_TARGET, TRANSITIONING_MS, RISE_MS, W_STEP, N,
      STROKE_SPOKE, STROKE_SPOKE_OP, STROKE_BRANCH, JDOT_R, ROOTB_R, GRID_STEP, GRID_ALPHA,
      WHEEL_FRICTION, FLICK_THRESH, fanInertia: false, skyDial: true, morphDive: true,
      dialCoast: true, cameraSettle: true, denseGroupForks: true,
      aliveMotion: true, pathParticles: true, organicCore: true, labelFade: true,
      solidLeafDots: true, straightLinks: true, sparseOverview: true, idleRotate: true,
      IDLE_ROT_DEG_PER_S, LEAF_R, LEAF_HOT_R, GROUP_DOT_R, RISE_MS,
      particleCount: () => flowParticles.length,
    }),
    getMorphProgress: () => (morph ? morphProgress() : (mapState === 'fan' || mapState === 'sky' ? (mapState === 'fan' ? 1 : 0) : 0)),
    getMapState: () => mapState,
    focusCategory: (id) => focusCategory(id),
    clearFocus: (opts) => clearFocus(opts || {}),
    stepCategory: (d) => stepCategory(d),
    stepWheel: (d) => stepWheel(d),
    snapWheel: () => snapWheel(),
    openAlert: (id) => {
      const a = SNAP.categories.flatMap((c) => c.alerts).find((x) => x.id === id) || SNAP.alerts.find((x) => x.id === id);
      if (!a) return false;
      focusCategory(a.categoryId);
      const tryOpen = () => {
        if (mapState === 'fan' && focusCat === a.categoryId) {
          const n = (focusLayout?.nodes || []).find((x) => x.alert && x.alert.id === a.id);
          if (n) selectedChain = n.chain != null ? n.chain : -1;
          openPanel({ ...a, ladderSteps: a.ladderSteps || window.LEET_ALERTS_DATA.ladder(a.ladder) });
          return true;
        }
        return false;
      };
      const iv = setInterval(() => { if (tryOpen()) clearInterval(iv); }, 80);
      setTimeout(() => clearInterval(iv), 4000);
      return true;
    },
    openCore: () => openCore(),
    closePanel: () => { closePanel(); selectedChain = -1; },
    closeCore: () => closeCore(),
    setView: (v) => document.querySelector(`.view-toggle button[data-view="${v}"]`)?.click(),
    waitForIdle: (ms = 480) => new Promise((r) => setTimeout(r, ms)),
    setIdleSpin: (on) => { idleRotateOn = on !== false; },
    setIdleRotate: (on) => { idleRotateOn = !!on; },
    setHover: (id) => setHoverCat(id || null),
    setHoverNode: (nodeId) => {
      // Fan-only hover scale target (no path lighting — matches ref)
      hoverNodeId = nodeId || null;
    },
    clearHover: () => clearPointerHover(),
    getHover: () => ({
      hoverCat, hoverNodeId, selectedChain,
      hoverAlpha: { ...hoverAlpha }, focusedIdx: focusedIdx(),
    }),
    panBy: (dx, dy) => {
      if (mapState === 'sky') {
        wheelT -= dx * 0.12;
      } else {
        tCamX += dx; tCamY += dy;
        camX += dx; camY += dy;
      }
    },
    zoomAt: (sx, sy, factor) => zoomAtScreen(sx, sy, zoom * factor),
    zoomStep: (dir) => zoomStep(dir),
    fitCurrent: () => fitCurrent(),
    recenter: () => recenterMap({ immediate: true }),
    worldToScreen: (x, y) => worldToScreen(x, y),
    hubScreen: (catId) => {
      const hub = (focusCat && focusLayout ? focusLayout.nodes : layoutNodes)
        .find((n) => n.id === catId && n.kind === 'category');
      if (!hub) return null;
      return worldToScreen(hub.x, hub.y);
    },
    /** Labels that are lit but must not be (orphans after leave/morph/dial). */
    orphanLabels: () => {
      const out = [];
      const inSky = !focusCat && !morph && (mapState === 'sky' || mapState === 'aligning');
      const inFan = !!(focusCat || mapState === 'fan') && !morph;
      const catLod = inSky ? (1 - lodAlpha(zoom, LOD_CAT_FADE_START, LOD_CAT_FADE_END)) : 0;
      const groupLodNow = inSky ? lodAlpha(zoom, LOD_GROUP_IN, LOD_GROUP_FULL) : (inFan ? 1 : 0);
      const allowCat = catLod > 0.04 && groupLodNow < 0.88;
      const allowGroup = (inSky && groupLodNow > 0.02) || inFan;
      const allowNode = (inSky && lodAlpha(zoom, LOD_NODE_IN, LOD_NODE_FULL) > 0.02) || inFan;
      // Intentional lit = is-on + style.opacity (ignore CSS fade lag for orphan detection)
      const intentionallyLit = (el) => {
        if (!el.classList.contains('is-on')) return false;
        const intended = parseFloat(el.style.opacity);
        if (!Number.isNaN(intended)) return intended > 0.05;
        return Number(getComputedStyle(el).opacity) > 0.05;
      };
      labelLayer.querySelectorAll('.cat-label').forEach((el) => {
        if (intentionallyLit(el) && !allowCat) out.push({ kind: 'cat', id: el.dataset.id || '' });
      });
      labelLayer.querySelectorAll('.group-label').forEach((el) => {
        if (intentionallyLit(el) && !allowGroup) out.push({ kind: 'group', id: el.dataset.id || '' });
      });
      labelLayer.querySelectorAll('.node-label').forEach((el) => {
        if (intentionallyLit(el) && !allowNode) out.push({ kind: 'node', id: el.dataset.id || '' });
      });
      return out;
    },
    litLabelCount: () => {
      let n = 0;
      labelLayer.querySelectorAll('.cat-label, .group-label, .node-label').forEach((el) => {
        const st = getComputedStyle(el);
        if (Number(st.opacity) > 0.05 && st.visibility !== 'hidden') n += 1;
      });
      return n;
    },
    lodState: () => ({
      zoom,
      group: lodAlpha(zoom, LOD_GROUP_IN, LOD_GROUP_FULL),
      node: lodAlpha(zoom, LOD_NODE_IN, LOD_NODE_FULL),
      cat: 1 - lodAlpha(zoom, LOD_CAT_FADE_START, LOD_CAT_FADE_END),
      thresholds: {
        LOD_GROUP_IN, LOD_GROUP_FULL, LOD_NODE_IN, LOD_NODE_FULL,
        Z_SKY_MIN, Z_SKY_MAX,
      },
    }),
    labelOverlapCount: () => {
      const boxes = [];
      labelLayer.querySelectorAll('.cat-label.is-on, .group-label.is-on, .node-label.is-on').forEach((el) => {
        const st = getComputedStyle(el);
        if (Number(st.opacity) < 0.05 || st.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        boxes.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      });
      let hits = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (labelBoxesOverlap(boxes[i], boxes[j], 1)) hits += 1;
        }
      }
      return hits;
    },
    viewportEmptyRatio: () => viewportEmptyRatio(),
    overviewSpokeCount: (catId) => {
      const sec = sectorLocal.find((s) => s.cat.id === catId);
      return sec ? sec.spokeCount : 0;
    },
    /** Per-category uniqueness of site·machine node labels in the overview. */
    nodeLabelsUniquePerCategory: () => {
      const byCat = new Map();
      layoutNodes.forEach((n) => {
        if (n.kind !== 'machine' || !n.label) return;
        const list = byCat.get(n.catId) || [];
        list.push(n.label);
        byCat.set(n.catId, list);
      });
      const out = {};
      byCat.forEach((labels, id) => {
        out[id] = { total: labels.length, unique: new Set(labels).size };
      });
      return out;
    },
    settleNow: () => {
      zoomPivot = null;
      zoom = targetZoom;
      camX = tCamX;
      camY = tCamY;
      settleCameraTowardCluster(lastWheelSX || W / 2, lastWheelSY || H / 2);
      // Snap label opacities to targets (tests / capture after settle)
      labelLayer.querySelectorAll('.cat-label, .group-label, .node-label').forEach((el) => {
        const t = el._opTarget != null ? el._opTarget : (el.classList.contains('is-on') ? 1 : 0);
        const lid = el.dataset.id || el.className;
        labelOpSmooth.set(lid, t);
        el.style.opacity = String(t);
        if (t < 0.02) { el.style.visibility = 'hidden'; el.classList.remove('is-on'); }
        else { el.style.visibility = 'visible'; }
      });
    },
    particleCount: () => flowParticles.length,
    sampleLabelOpacities: () => {
      const out = [];
      labelLayer.querySelectorAll('.cat-label, .group-label, .node-label').forEach((el) => {
        const op = parseFloat(el.style.opacity || '0');
        if (!el.classList.contains('is-on') && op < 0.02) return;
        out.push({
          id: el.dataset.id || el.className,
          op,
          target: el._opTarget != null ? el._opTarget : op,
          cls: el.className,
        });
      });
      return out;
    },
    sampleMotionFrame: () => {
      let others = 0, n = 0;
      CATS.forEach((c) => {
        if (hoverCat && c.id !== hoverCat) { others += (hoverAlpha[c.id] ?? 1); n += 1; }
        else if (morph && morph.focusId && c.id !== morph.focusId) {
          others += (hoverAlpha[c.id] ?? 1); n += 1;
        }
      });
      const labels = [];
      labelLayer.querySelectorAll('.group-label.is-on, .node-label.is-on, .cat-label.is-on').forEach((el) => {
        labels.push(parseFloat(el.style.opacity || '0'));
      });
      return {
        t: performance.now(),
        zoom,
        targetZoom,
        wheelA,
        wheelT,
        mapState,
        othersMean: n ? others / n : 1,
        labelOpMean: labels.length ? labels.reduce((a, b) => a + b, 0) / labels.length : 0,
        labelOpMax: labels.length ? Math.max(...labels) : 0,
        particles: flowParticles.length,
      };
    },
    wchevOpacity: () => {
      const el = document.getElementById('wchev-l');
      return el ? Number(getComputedStyle(el).opacity) : 0;
    },
    /** Hub distance / viewport height (target ~0.17–0.20). */
    hubRadiusRatio: () => {
      const hub = layoutNodes.find((n) => n.kind === 'category');
      if (!hub || !H) return 0;
      return Math.hypot(hub.x, hub.y) / H;
    },
    /** Outer tip distance / viewport height (mean of per-department max tip). */
    tipRadiusRatio: () => {
      if (!H) return 0;
      const byCat = new Map();
      layoutNodes.forEach((n) => {
        if (n.kind !== 'machine') return;
        const r = Math.hypot(n.x, n.y);
        const prev = byCat.get(n.catId) || 0;
        if (r > prev) byCat.set(n.catId, r);
      });
      if (!byCat.size) return 0;
      let sum = 0;
      byCat.forEach((r) => { sum += r; });
      return (sum / byCat.size) / H;
    },
    /** True if any overview link connects __core__ to a hub. */
    hasCoreHubLinks: () => layoutLinks.some((L) => L.s === '__core__' || L.t === '__core__'),
    /**
     * Count same-department segment crossings (stubs excluded).
     * Neighbouring categories may interleave at the tips (Skilltree does too);
     * within a fan, chains must not wander into each other.
     */
    lineCrossings: () => {
      const segs = layoutLinks.filter((L) => !L.stub && L.s !== '__core__' && L.t !== '__core__');
      const byId = new Map(layoutNodes.map((n) => [n.id, n]));
      const pts = segs.map((L) => {
        const s = byId.get(L.s);
        const t = byId.get(L.t);
        if (!s || !t) return null;
        return { ax: s.x, ay: s.y, bx: t.x, by: t.y, cat: s.catId || t.catId };
      }).filter(Boolean);
      let hits = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const A = pts[i], B = pts[j];
          if (A.cat !== B.cat) continue;
          if (segmentsIntersect(A.ax, A.ay, A.bx, A.by, B.ax, B.ay, B.bx, B.by)) hits += 1;
        }
      }
      return hits;
    },
    crossingPairs: () => {
      const segs = layoutLinks.filter((L) => !L.stub && L.s !== '__core__' && L.t !== '__core__');
      const byId = new Map(layoutNodes.map((n) => [n.id, n]));
      const pts = segs.map((L) => {
        const s = byId.get(L.s);
        const t = byId.get(L.t);
        if (!s || !t) return null;
        return { id: L.s + '->' + L.t, ax: s.x, ay: s.y, bx: t.x, by: t.y, cat: s.catId || t.catId, s: L.s, t: L.t };
      }).filter(Boolean);
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const A = pts[i], B = pts[j];
          if (segmentsIntersect(A.ax, A.ay, A.bx, A.by, B.ax, B.ay, B.bx, B.by)) {
            out.push({ a: A.id, b: B.id, catA: A.cat, catB: B.cat, same: A.cat === B.cat });
          }
        }
      }
      return out.slice(0, 20);
    },
    /** Per-department drawn node counts (excludes stubs). */
    departmentNodeCounts: () => {
      const out = {};
      CATS.forEach((c) => { out[c.id] = 0; });
      layoutNodes.forEach((n) => {
        if (n.kind === 'stub' || n.hidden) return;
        if (n.catId && out[n.catId] != null) out[n.catId] += 1;
      });
      return out;
    },
    overviewGeom: () => ({ ...overviewGeom, H, W }),
    visibleNodeCount: () => visibleScreenNodes().length,
    labeledNodeCount: () => [...labelLayer.querySelectorAll('.node-label.is-on')].filter((el) => {
      const st = getComputedStyle(el);
      return Number(st.opacity) > 0.2 && el.getBoundingClientRect().width > 2;
    }).length,
    viewportOverflow: () => {
      const vw = window.innerWidth;
      let bad = 0;
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1) bad += 1;
      });
      return bad;
    },
    labelBoxes: () => {
      const boxes = [];
      labelLayer.querySelectorAll('.cat-label, .node-label.is-on').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number(st.opacity) < 0.2) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        boxes.push({ id: el.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height });
      });
      return boxes;
    },
    labelCollisions: () => {
      // Backward-compatible alias: label↔label + label↔node + node↔node
      return window.LEET_ALERTS_MAP.nodeOverlaps() + window.LEET_ALERTS_MAP.labelNodeOverlaps();
    },
    /** Screen-space circle overlaps between drawn nodes (uses visual radius). */
    nodeOverlaps: () => {
      const ns = hitNodes.filter((h) => h.kind !== 'core' && h.vr > 0);
      let hits = 0;
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j];
          const min = (a.vr || a.r) + (b.vr || b.r) - 0.35;
          if (Math.hypot(a.x - b.x, a.y - b.y) < min) hits += 1;
        }
      }
      return hits;
    },
    /** Category/node label boxes intersecting node circles in screen space. */
    labelNodeOverlaps: () => {
      const labels = [];
      const cr = canvas.getBoundingClientRect();
      labelLayer.querySelectorAll('.cat-label').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number(st.opacity) < 0.15) return;
        // Use the title line only (subtitle is lighter and sits further out)
        const name = el.querySelector('.name') || el;
        const r = name.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const insetX = Math.min(40, r.width * 0.16);
        labels.push({
          id: el.dataset.id || '',
          cat: true,
          x: r.left - cr.left + insetX,
          y: r.top - cr.top + 2,
          w: Math.max(4, r.width - insetX * 2),
          h: Math.max(4, r.height - 4),
        });
      });
      labelLayer.querySelectorAll('.node-label.is-on').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number(st.opacity) < 0.15) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        labels.push({
          id: el.dataset.id || '',
          cat: false,
          x: r.left - cr.left,
          y: r.top - cr.top,
          w: r.width,
          h: r.height,
        });
      });
      const ns = hitNodes.filter((h) => h.kind !== 'core' && h.kind !== 'category' && h.vr > 0);
      let hits = 0;
      labels.forEach((box) => {
        ns.forEach((n) => {
          // Wide 140° fans may graze a neighbour title; only flag same-department hits
          if (box.cat && box.id && n.ref?.catId && n.ref.catId !== box.id) return;
          const vr = n.vr || n.r;
          const cx = Math.max(box.x, Math.min(n.x, box.x + box.w));
          const cy = Math.max(box.y, Math.min(n.y, box.y + box.h));
          if (Math.hypot(n.x - cx, n.y - cy) < vr + 1) hits += 1;
        });
      });
      return hits;
    },
    panelClearance: () => {
      if (!panelOpen && !coreOpen) return true;
      const panel = panelOpen ? nodePanel : corePanel;
      const pr = panel.getBoundingClientRect();
      return visibleScreenNodes().every((h) => h.x > pr.right + 6 || h.kind === 'core');
    },
    /**
     * Angular width (degrees) of each department fan about its hub.
     * buildSky target ≈ 140°.
     */
    fanSpanDegrees: () => {
      const out = {};
      CATS.forEach((cat) => {
        const hub = layoutNodes.find((n) => n.id === cat.id);
        if (!hub) { out[cat.id] = 0; return; }
        const angs = [];
        layoutNodes.forEach((n) => {
          if (n.catId !== cat.id || n.kind === 'stub' || n.hidden || n.kind === 'category') return;
          angs.push(Math.atan2(n.y - hub.y, n.x - hub.x));
        });
        if (angs.length < 2) { out[cat.id] = 0; return; }
        angs.sort((a, b) => a - b);
        // Circular span of points relative to hub
        let maxGap = 0;
        for (let i = 0; i < angs.length; i++) {
          const next = angs[(i + 1) % angs.length];
          let gap = next - angs[i];
          if (i === angs.length - 1) gap = (angs[0] + Math.PI * 2) - angs[i];
          if (gap > maxGap) maxGap = gap;
        }
        const span = Math.PI * 2 - maxGap;
        out[cat.id] = (span * 180) / Math.PI;
      });
      return out;
    },
    /** True when every visible cat title sits ≥40px below the top toolbar/toggle. */
    titlesClearOfToolbar: (toolbarBottom = 56, minGap = 40) => {
      const barBottom = toolbarBottomPx() || toolbarBottom;
      let clear = true;
      const hits = [];
      labelLayer.querySelectorAll('.cat-label').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.15) return;
        const r = el.getBoundingClientRect();
        if (r.height < 2) return;
        const gap = r.top - barBottom;
        if (gap < minGap) {
          clear = false;
          hits.push({ id: el.dataset.id, top: r.top, bar: barBottom, gap });
        }
      });
      return { clear, hits, barBottom, minGap };
    },
    /**
     * Rest-state gate: fail if fewer than ~40 node dots are on-screen, or any
     * category label sits more than 15% of the viewport away from its hub.
     * Also samples the canvas so an opaque overlay cannot fake a pass.
     */
    assertRestOverview: () => {
      const errors = [];
      if (mapState !== 'sky' || morph || focusCat) {
        errors.push(`not at rest (mapState=${mapState}, focus=${focusCat}, morph=${!!morph})`);
      }
      const dots = hitNodes.filter((h) => h.kind !== 'core' && (h.vr || 0) > 0);
      const nodeDots = dots.filter((h) => h.kind !== 'category');
      if (nodeDots.length < 40) {
        errors.push(`nodeDots=${nodeDots.length} (need ≥40)`);
      }
      // 15% of the longer viewport side (~label ring gap on 1440×900 is ~0.15·W)
      const thr = 0.15 * Math.max(W, H);
      const labelDrift = [];
      const cr = canvas.getBoundingClientRect();
      CATS.forEach((cat) => {
        const hub = hitNodes.find((h) => h.id === cat.id);
        const el = labelEls.get(cat.id);
        if (!hub || !el) {
          labelDrift.push({ id: cat.id, missing: true });
          errors.push(`missing hub/label for ${cat.id}`);
          return;
        }
        const r = el.getBoundingClientRect();
        const lx = r.left + r.width / 2 - cr.left;
        const ly = r.top + r.height / 2 - cr.top;
        const dist = Math.hypot(lx - hub.x, ly - hub.y);
        labelDrift.push({ id: cat.id, dist: Math.round(dist), thr: Math.round(thr) });
        if (dist > thr) errors.push(`label ${cat.id} ${Math.round(dist)}px from hub (max ${Math.round(thr)})`);
      });
      // Canvas must show non-background ink near core (catches opaque label-layer regressions)
      const dprNow = Math.min(window.devicePixelRatio || 1, 2);
      const u = usable();
      const sx = Math.floor((u.cx + camX * zoom) * dprNow);
      const sy = Math.floor((u.cy + camY * zoom) * dprNow);
      let coreInk = 0;
      try {
        const sample = ctx.getImageData(
          Math.max(0, sx - 24), Math.max(0, sy - 24), 48, 48,
        );
        for (let i = 0; i < sample.data.length; i += 4) {
          const r = sample.data[i], g = sample.data[i + 1], b = sample.data[i + 2];
          if (r + g + b > 140) coreInk += 1;
        }
      } catch (e) {
        errors.push(`canvas sample failed: ${e.message || e}`);
      }
      if (coreInk < 40) errors.push(`coreInk=${coreInk} (canvas looks empty near core)`);

      // Composited visibility: label-layer must not paint an opaque fill over the canvas
      const labelBg = getComputedStyle(labelLayer).backgroundColor;
      const opaqueLabel = (() => {
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(labelBg || '');
        if (!m) return false;
        const a = m[4] == null ? 1 : Number(m[4]);
        return a > 0.05;
      })();
      if (opaqueLabel) errors.push(`label-layer background is opaque (${labelBg})`);

      return {
        ok: errors.length === 0,
        errors,
        nodeDots: nodeDots.length,
        hubs: dots.filter((h) => h.kind === 'category').length,
        labelDrift,
        coreInk,
        wheelA,
        mapState,
      };
    },
  };

  window.addEventListener('resize', resize);
  // Paint charcoal immediately to avoid white flash
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = mapView.clientWidth || window.innerWidth;
  H = mapView.clientHeight || window.innerHeight;
  canvas.width = Math.max(1, Math.floor(W * dpr));
  canvas.height = Math.max(1, Math.floor(H * dpr));
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#20242d';
  ctx.fillRect(0, 0, W, H);

  resize();
  rebuildOverviewLayout();
  tCamY = -H * 0.04; camY = tCamY;
  mapReady = true;
  document.body.classList.add('map-ready');
  window.__LEET_ALERTS_READY__ = true;
  requestAnimationFrame(tick);
})();
