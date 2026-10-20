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
  const EASE_HOVER = 0.18;
  const DIM_OTHERS = 0.18;
  const NODE_FADED = 0.25;
  const HOVER_NODE_SCALE = 1.12;
  const FEATURED_SCALE = 1.05;
  const DRAG_CLICK_CANCEL = 8;
  const WHEEL_ZOOM_EXP = 0.01;
  const ZOOM_STEP_IN = 1.25;
  const ZOOM_STEP_OUT = 0.8;
  const Z_FAN_MIN = 0.42;
  const Z_FAN_MAX = 1.9;
  const Z_SKY_MIN = 0.55;
  const Z_SKY_MAX = 1.85;
  const RISE_SCALE = 0.43;
  const FAN_SPAN = 182 * Math.PI / 180;
  const R0_FAN = 248;
  const R_BASE = 410;
  const R_STEP = 214;
  const DIVE_ALIGN_MS = 520; // after wheel seat → morph start (ref dive swap)
  const DIVE_MORPH_MS = 1250; // branching / morph settle
  const RISE_MS = 380;
  const N = CATS.length;
  const W_STEP = 360 / N;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let zoom = 1, targetZoom = 1;
  let camX = 0, camY = 0, tCamX = 0, tCamY = 0;
  // Sky wheel dial (degrees). Seat department i at bottom when wheelT = 180 - i*W_STEP
  let wheelA = 180, wheelT = 180;
  let wheelIdle = null;
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
  const ptrs = new Map();
  let pinchD0 = 0, pinchS0 = 1, pinchRatio = 1, pinchAX = 0, pinchAY = 0;

  let catLabelWorld = new Map();
  let overviewGeom = { rHub: 160, rTip: 300, rLabel: 420, rCore: 70, segLen: 32 };

  function clampZSky(v) { return Math.max(Z_SKY_MIN, Math.min(Z_SKY_MAX, v)); }
  function clampZFan(v) { return Math.max(Z_FAN_MIN, Math.min(Z_FAN_MAX, v)); }
  function clampZoom(v) { return (focusCat || mapState === 'fan' || mapState === 'diving') ? clampZFan(v) : clampZSky(v); }

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
  function computeOverviewGeom() {
    const m = Math.min(W, H);
    const rHub = H * 0.19;
    const u = usable();
    // Title centres must stay inside the canvas (toolbar + bottom margin)
    const topClear = 56 + 40;
    const botClear = 32;
    const rLabelMax = Math.min(u.cy - topClear, (H - botClear) - u.cy);
    // Prefer ~1.05× hub chain length (ref gap mechanism); never eat title clearance
    const minLabelGap = Math.max(80, H * 0.085);
    const rTipPref = rHub + rHub * 1.05;
    const rTipMax = rLabelMax - minLabelGap;
    const rTip = Math.max(rHub + rHub * 0.8, Math.min(rTipPref, rTipMax));
    const rLabel = Math.min(rTip + minLabelGap, rLabelMax);
    const rCore = m * 0.054; // keep r9 compact core
    const segLen = H * 0.035;
    overviewGeom = { rHub, rTip, rLabel, rCore, segLen };
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
   * layoutWheel() places these on the sky dial via wheelA.
   */
  function buildSectorLocal(cat, catIndex) {
    const { rHub, rTip } = overviewGeom;
    const color = cat.color;
    const ov = cat.overviewTree || {};
    const tips = ov.tips || [];
    const subtypes = ov.subtypes || [];
    let seq = 0;
    const nodes = [];
    const links = [];

    nodes.push({
      id: cat.id, kind: 'category', label: cat.label, color, icon: cat.icon,
      alert: null, catId: cat.id, lx: 0, ly: 0, r: 8, depth: 0, hot: false,
      chain: -1, morphKey: `${cat.id}:hub`,
    });

    const SPAN = (140 * Math.PI) / 180;
    const RmaxRef = 146 + 3 * 56;
    const scale = (rTip - rHub) / RmaxRef;
    const rStart = 80 * scale;
    const rEnd = RmaxRef * scale;
    const maxJoints = 5;
    const rstep = (rEnd - rStart) / (maxJoints - 1);

    const nf = 5 + Math.floor(hash01(cat.id.length * 11 + catIndex * 3.1) * 3);
    const tipPool = tips.slice();
    const need = nf * 5;
    while (tipPool.length < need) {
      const srcTip = tips[tipPool.length % Math.max(1, tips.length)] || {
        id: `${cat.id}:pad`, label: '·', alert: null, hot: false,
      };
      tipPool.push({ ...srcTip, id: `${cat.id}:pad${tipPool.length}`, label: srcTip.label || '·' });
    }
    let tipCursor = 0;
    const chains = Array.from({ length: nf }, (_, i) => {
      const nJobs = 3 + Math.floor(hash01(cat.id.length * 17 + i * 3.7 + catIndex) * 3);
      const jobs = tipPool.slice(tipCursor, tipCursor + nJobs);
      tipCursor += nJobs;
      return { sub: subtypes[i % Math.max(1, subtypes.length)] || null, jobs };
    });

    const span = SPAN / nf;
    const zigAng = Math.min(span * 0.22, 0.075);

    for (let fi = 0; fi < nf; fi++) {
      const ch = chains[fi];
      const aC = nf === 1 ? 0 : -SPAN / 2 + (SPAN * fi) / (nf - 1);
      let prevId = cat.id;
      let plx = 0, ply = 0;
      ch.jobs.forEach((job, ji) => {
        const r = rStart + ji * rstep;
        const sign = (ji % 2 ? 1 : -1) * (ji ? 1 : 0.45);
        const zig = zigAng * sign;
        const a = aC + zig;
        // local: outward +Y, lateral +X
        const lx = r * Math.sin(a);
        const ly = r * Math.cos(a);
        const id = `${cat.id}:n${seq++}`;
        const isRoot = ji === 0;
        nodes.push({
          id, kind: isRoot ? 'site' : 'machine',
          label: isRoot ? (ch.sub?.label || job.label || '·') : (job.label || '·'),
          color, icon: null, alert: isRoot ? null : (job.alert || null),
          catId: cat.id, lx, ly, r: isRoot ? 2.6 : 2.0, depth: 1 + ji,
          hot: !isRoot && !!job.hot, tint: ji <= 1,
          chain: fi, morphKey: `${cat.id}:c${fi}:j${ji}`,
        });
        links.push({
          s: prevId, t: id, color, depth: 1 + ji, straight: true,
          chain: fi, morphKey: `${cat.id}:L:c${fi}:j${ji}`,
        });
        plx = lx; ply = ly; prevId = id;
      });
    }
    return { cat, catIndex, nodes, links, rHub };
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
    wheelT = 180 + Math.round((wheelT - 180) / W_STEP) * W_STEP;
  }

  function stepWheel(d) {
    if (mapState !== 'sky' && mapState !== 'aligning') return;
    clearTimeout(wheelIdle);
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
    tCamY = mapState === 'sky' ? -H * 0.04 : 0;
    if (!focusCat) targetZoom = clampZSky(1);
    if (immediate) {
      camX = tCamX;
      camY = tCamY;
      zoom = targetZoom;
    }
  }

  function seedFlowParticles() {
    flowParticles.length = 0;
    const segs = layoutLinks.filter((L) => !L.stub && L.s !== '__core__');
    segs.forEach((L, i) => {
      if (i % 2 !== 0) return;
      flowParticles.push({
        link: L,
        u: hash01(i * 3.1),
        speed: 0.18 + hash01(i * 7.7) * 0.22,
        catId: (layoutNodes.find((n) => n.id === L.t) || {}).catId,
      });
    });
  }

  /**
   * Focus fan: FAN_SPAN 182° / R0 248 / R_BASE 410 / R_STEP 214 (skilltree buildFan),
   * scaled to fit the usable viewport.
   */
  function rebuildFocusLayout(catId, { setCamera = true } = {}) {
    const cat = CATS.find((c) => c.id === catId);
    if (!cat) { focusLayout = null; return null; }
    const nodes = [];
    const links = [];
    const root = { ...cat.tree, icon: cat.icon, catId: cat.id };
    const subtypes = (root.children || []).filter((c) => c.kind === 'subtype' || c.children?.length);
    const tips = [];
    walk(root, (n) => {
      if (n.kind === 'machine' || (n.alert && (!n.children || !n.children.length))) tips.push(n);
    });
    const tipPool = tips.slice();
    const chains = subtypes.length
      ? subtypes.map((sub, i) => {
          const leafs = [];
          walk(sub, (n) => {
            if (n.kind === 'machine' || (n.alert && (!n.children || !n.children.length))) leafs.push(n);
          });
          if (!leafs.length) {
            const pad = tipPool[i % Math.max(1, tipPool.length)];
            if (pad) leafs.push(pad);
          }
          return { sub, jobs: leafs.slice(0, 6) };
        })
      : [{ sub: null, jobs: tipPool.slice(0, 8) }];

    const totalJobs = Math.max(1, chains.reduce((s, c) => s + Math.max(1, c.jobs.length), 0));
    const P = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];
    const u = usable();
    const fit = Math.min(u.w / 1700, u.h / 1500);
    const sR0 = R0_FAN * fit;
    const sBase = R_BASE * fit;
    const sStep = R_STEP * fit;

    nodes.push({
      id: cat.id, kind: 'category', label: cat.label, color: cat.color, icon: cat.icon,
      alert: null, catId: cat.id, x: 0, y: 0, r: 20, depth: 0, hot: false,
      chain: -1, morphKey: `${cat.id}:hub`,
    });
    links.push({ s: '__core__', t: cat.id, color: cat.color, depth: 0, spine: true, morphKey: `${cat.id}:L:core` });

    let cursor = -FAN_SPAN / 2;
    let maxR = sR0;
    chains.forEach((ch, fi) => {
      const nJobs = Math.max(1, ch.jobs.length);
      const span = FAN_SPAN * nJobs / totalJobs;
      const aC = cursor + span / 2;
      const [ex, ey] = P(sR0, aC);
      const jointId = `${cat.id}:j${fi}`;
      // joint shares morph with overview first joint (j0)
      nodes.push({
        id: jointId, kind: 'subtype', label: ch.sub?.label || cat.label, color: cat.color,
        icon: ch.sub?.icon || null, alert: null, catId: cat.id, x: ex, y: ey, r: 11,
        depth: 1, hot: false, chain: fi, morphKey: `${cat.id}:c${fi}:j0`,
      });
      links.push({ s: cat.id, t: jointId, color: cat.color, depth: 1, chain: fi, morphKey: `${cat.id}:L:c${fi}:j0` });

      let px = ex, py = ey, prevId = jointId;
      ch.jobs.forEach((job, ji) => {
        const zig = (ji % 2 ? 1 : -1) * Math.min(span * 0.22, 0.075) * (ji ? 1 : 0.45);
        const a = aC + zig;
        const r = sBase + ji * sStep;
        maxR = Math.max(maxR, r);
        const [x, y] = P(r, a);
        const id = job.id || `${cat.id}:f${fi}n${ji}`;
        const mk = `${cat.id}:c${fi}:j${ji}`;
        nodes.push({
          id, kind: job.kind || 'machine', label: job.label || '·', color: cat.color,
          icon: job.icon || null, alert: job.alert || null, catId: cat.id, x, y,
          r: job.alert ? 7 : 6, depth: 2 + ji, hot: !!(job.alert && job.alert.hot),
          chain: fi, morphKey: mk,
        });
        links.push({
          s: prevId, t: id, color: cat.color, depth: 2 + ji, chain: fi,
          morphKey: `${cat.id}:L:c${fi}:j${ji + 1}`, x0: px, y0: py, x1: x, y1: y,
        });
        px = x; py = y; prevId = id;
      });
      cursor += span;
    });

    rebuildParentIndex(links);

    if (setCamera) {
      const bw = (maxR + 280) * 2;
      const bh = maxR + 260 + 180;
      const pad = 0.9;
      const kz = Math.min((u.w * pad) / bw, (u.h * pad) / bh);
      targetZoom = clampZFan(Math.max(0.55, Math.min(1.35, kz)));
      tCamX = 0;
      tCamY = maxR * 0.18;
    }

    focusLayout = { nodes, links, color: cat.color, cat, maxR };
    return focusLayout;
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

  function beginMorph({ dir, focusId, from, to, duration }) {
    morph = {
      dir, focusId,
      t0: performance.now(),
      dur: reduceMotion ? 1 : duration,
      from, to,
    };
  }

  function morphProgress() {
    if (!morph) return 1;
    const u = (performance.now() - morph.t0) / morph.dur;
    return Math.max(0, Math.min(1, u));
  }

  /** Interpolated draw lists during dive/rise — no jump cut. */
  function morphDisplay() {
    if (!morph) return null;
    const raw = morphProgress();
    const e = easeOutCubic(raw);
    const fromN = morph.from.nmap;
    const toN = morph.to.nmap;
    const keys = new Set([...fromN.keys(), ...toN.keys()]);
    const hubFrom = fromN.get(`${morph.focusId}:hub`) || { x: 0, y: 0, r: 8 };
    const hubTo = toN.get(`${morph.focusId}:hub`) || { x: 0, y: 0, r: 20 };
    const nodes = [];
    keys.forEach((k) => {
      const A = fromN.get(k);
      const B = toN.get(k);
      const a = A || { x: hubFrom.x, y: hubFrom.y, r: 0, color: hubFrom.color, catId: morph.focusId, kind: 'machine', label: '', morphKey: k, chain: -1, hot: false };
      const b = B || { x: hubTo.x, y: hubTo.y, r: 0, color: hubTo.color, catId: morph.focusId, kind: 'machine', label: '', morphKey: k, chain: -1, hot: false };
      const opA = A ? 1 : 0;
      const opB = B ? 1 : 0;
      nodes.push({
        ...b, ...a,
        id: (B || A).id,
        kind: (B || A).kind,
        label: (B || A).label,
        color: (B || A).color,
        icon: (B || A).icon,
        alert: (B || A).alert,
        catId: morph.focusId,
        chain: (B || A).chain,
        morphKey: k,
        hot: !!(B || A).hot,
        x: lerp(a.x, b.x, e),
        y: lerp(a.y, b.y, e),
        r: lerp(a.r || 2, b.r || 2, e),
        morphOp: lerp(opA, opB, e),
      });
    });
    // other departments: fade / drift toward core
    const otherNodes = [];
    if (morph.dir === 1) {
      layoutNodes.forEach((n) => {
        if (n.catId === morph.focusId || n.kind === 'stub') return;
        const pull = e * 0.35;
        otherNodes.push({
          ...n,
          x: lerp(n.x, 0, pull),
          y: lerp(n.y, 0, pull),
          morphOp: lerp(1, 0.12, e),
          otherDim: true,
        });
      });
    } else {
      layoutNodes.forEach((n) => {
        if (n.catId === morph.focusId || n.kind === 'stub') return;
        const pull = (1 - e) * 0.35;
        otherNodes.push({
          ...n,
          x: lerp(n.x, 0, pull),
          y: lerp(n.y, 0, pull),
          morphOp: lerp(0.12, 1, e),
          otherDim: true,
        });
      });
    }
    const fromL = morph.from.lmap;
    const toL = morph.to.lmap;
    const lkeys = new Set([...fromL.keys(), ...toL.keys()]);
    const byKey = new Map(nodes.map((n) => [n.morphKey, n]));
    const links = [];
    lkeys.forEach((k) => {
      const A = fromL.get(k);
      const B = toL.get(k);
      if (!A && !B) return;
      const sKey = (B || A).s === '__core__' ? null : null;
      // resolve endpoints via morphKey of endpoints when possible
      const sId = (B || A).s;
      const tId = (B || A).t;
      let sNode = nodes.find((n) => n.id === sId) || (sId === '__core__' ? { x: 0, y: 0 } : null);
      let tNode = nodes.find((n) => n.id === tId);
      if (!sNode || !tNode) {
        // try morph keys on overview/focus originals
        return;
      }
      links.push({
        s: sId, t: tId, color: (B || A).color, chain: (B || A).chain,
        straight: true, morphOp: lerp(A ? 1 : 0, B ? 1 : 0, e),
        x0: sNode.x, y0: sNode.y, x1: tNode.x, y1: tNode.y,
      });
    });
    // also connect morphing nodes by chain order as fallback for missing link keys
    if (!links.length) {
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
            morphOp: n.morphOp, x0: prev.x, y0: prev.y, x1: n.x, y1: n.y,
          });
          prev = n;
        });
      });
    }
    return { nodes: nodes.concat(otherNodes), links, e: raw, done: raw >= 1 };
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
    el.querySelector('.sub').textContent = cat.subtitle;
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
    const coreR = focusCat ? 48 : (overviewGeom.rCore || Math.min(W, H) * 0.054);
    if (!coreDust.length || coreDust._gen !== 9) {
      coreDust.length = 0;
      coreDust._gen = 9;
      // Crisp small particles (ref-like); fewer, tighter than r8 bloom
      for (let i = 0; i < 280; i++) {
        const ring = Math.random();
        coreDust.push({
          a: Math.random() * Math.PI * 2,
          r: ring < 0.55
            ? coreR * (0.12 + Math.random() * 0.55)
            : coreR * (0.55 + Math.random() * 0.42),
          s: 0.1 + Math.random() * 0.4,
          hue: Math.random(),
          size: 0.35 + Math.random() * 0.85,
        });
      }
    }
    const scale = focusCat ? 1.1 : zoom;
    const bloomR = coreR * scale * 0.92;
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, bloomR);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.35, 'rgba(233,228,214,0.05)');
    g.addColorStop(1, 'rgba(32,36,45,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bloomR, 0, Math.PI * 2);
    ctx.fill();

    coreDust.forEach((d, i) => {
      const ang = d.a + t * 0.028 * d.s;
      const rad = d.r * scale * (0.97 + 0.03 * Math.sin(t * 0.7 + i * 0.4));
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang * 1.02) * rad * 0.94;
      if (Math.hypot(x - p.x, y - p.y) < Math.min(8, bloomR * 0.16)) return;
      const col = d.hue < 0.35
        ? `rgba(255,255,255,${0.4 + d.s * 0.4})`
        : d.hue < 0.55
          ? `rgba(233,228,214,${0.32 + d.s * 0.28})`
          : d.hue < 0.75
            ? `rgba(196,181,253,${0.24 + d.s * 0.22})`
            : `rgba(251,113,133,${0.22 + d.s * 0.2})`;
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.arc(x, y, d.size * scale, 0, Math.PI * 2);
      ctx.fill();
    });

    // Hub drift (ref hdrift ~12s ±2.2/±2.6) + nucleus pulse
    const driftX = reduceMotion ? 0 : 2.2 * Math.sin(t / 12 * Math.PI * 2);
    const driftY = reduceMotion ? 0 : -2.6 * Math.cos(t / 12 * Math.PI * 2);
    const cx = p.x + driftX;
    const cy = p.y + driftY;
    const nucR = reduceMotion ? 5 * scale : (5 + 1.5 * (0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 2.6)))) * scale;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(233,228,214,0.55)';
    ctx.arc(cx, cy, nucR * 0.35, 0, Math.PI * 2);
    ctx.fill();

    const fs = Math.max(12, 13.5 * scale);
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(236,233,226,0.78)';
    ctx.fillText('leet', cx, cy);
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
    ctx.fillStyle = '#20242d';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(232,235,242,0.05)';
    for (let x = 7; x < W; x += 14) {
      for (let y = 7; y < H; y += 14) {
        ctx.beginPath();
        ctx.arc(x, y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ensureStars();
    starField.forEach((s) => {
      ctx.beginPath();
      ctx.fillStyle = `rgba(233,228,214,${s.a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const nodes = activeNodes().filter((n) => matchSearch(n.label, n.alert));
    const links = activeLinks();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function catOpacity(catId) {
      if (mapState === 'fan' || focusCat) return 1;
      const a = hoverAlpha[catId];
      return a == null ? 1 : a;
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
      if (tN.otherDim) op *= (tN.morphOp != null ? 1 : 0.12);
      if (chainFaded(L) || chainFaded(tN)) op *= NODE_FADED;
      const a0 = worldToScreen(s.x, s.y);
      const a1 = worldToScreen(tN.x, tN.y);
      if (!focusCat && mapState !== 'fan' && (L.straight || L.s === '__core__')) {
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        const lineOp = L.stub ? 0.2 : (L.depth <= 1 ? 0.22 : 0.16);
        ctx.strokeStyle = `rgba(233,228,214,${lineOp * op})`;
        ctx.lineWidth = L.stub ? 1.1 : 1;
        ctx.stroke();
        return;
      }
      const c = curvePts(a0.x, a0.y, a1.x, a1.y);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(L.color || '#e9e4d6', (focusCat || mapState === 'fan' ? 0.45 : 0.22) * op);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    });

    // Flow particles along overview segments (hub → tips) + spoke motes
    if (mapState === 'sky' || morph) {
      flowParticles.forEach((p) => {
        const L = p.link;
        const s = nodeMap.get(L.s) || nodeById(L.s);
        const tN = nodeMap.get(L.t) || nodeById(L.t);
        if (!s || !tN) return;
        const op = catOpacity(p.catId);
        if (op < 0.2) return;
        p.u = (p.u + p.speed * 0.016) % 1;
        const x = s.x + (tN.x - s.x) * p.u;
        const y = s.y + (tN.y - s.y) * p.u;
        const scr = worldToScreen(x, y);
        ctx.beginPath();
        ctx.fillStyle = `rgba(233,228,214,${0.55 * op})`;
        ctx.arc(scr.x, scr.y, 1.35, 0, Math.PI * 2);
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
    const showLabels = !!(focusCat || mapState === 'fan') && !morph;
    const zScale = Math.min(1.2, 0.95 + zoom * 0.12);
    const featuredCatId = (mapState === 'sky') ? CATS[focusedIdx()]?.id : null;
    nodes.forEach((n) => {
      if (n.kind === 'stub' || n.hidden) return;
      if (focusCat && n.catId && n.catId !== focusCat && !n.otherDim) return;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const selected = selectedAlert && n.alert && selectedAlert.id === n.alert.id;
      const isCat = n.kind === 'category';
      const isHub = isCat || n.kind === 'subtype';
      let op = catOpacity(n.catId);
      if (n.morphOp != null) op *= n.morphOp;
      if (chainFaded(n)) op *= NODE_FADED;
      const hoverBoost = (mapState === 'fan' && hoverNodeId === n.id) ? HOVER_NODE_SCALE
        : (featuredCatId && n.catId === featuredCatId && isCat ? FEATURED_SCALE : 1);
      let r = (n.r + (selected ? 1.5 : 0)) * zScale * hoverBoost;
      if (mapState === 'sky' && isCat) r = 8 * zScale * hoverBoost;

      if ((mapState === 'sky' || morph) && (n.kind === 'machine' || n.kind === 'site')) {
        if (n.tint) {
          ctx.beginPath();
          ctx.fillStyle = hexAlpha(n.color, 0.55 * op);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.strokeStyle = hexAlpha(n.color, 0.75 * op);
          ctx.lineWidth = 1;
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.fillStyle = `rgba(245,243,238,${0.88 * op})`;
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (isHub) {
        // Thin outlined ring, faint tint, no glow halo
        ctx.globalAlpha = op;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(32,36,45,0.92)';
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = isCat && mapState === 'sky' ? 1.35 : (isCat ? 2.2 : 1.5);
        ctx.strokeStyle = hexAlpha(n.color, isCat && mapState === 'sky' ? 0.55 : 0.92);
        ctx.stroke();
        if ((focusCat || mapState === 'fan') && isCat) {
          drawBackChevron(p.x, p.y, n.color, r);
        } else {
          drawIcon(p.x, p.y, n.icon || 'unknown', n.color, isCat && mapState === 'sky' ? 0.75 : 1, isCat ? 0.95 : 0.85);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(24,24,27,0.88)';
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.35;
        ctx.strokeStyle = hexAlpha(n.color, n.hot ? 0.95 : 0.55);
        ctx.stroke();
        if (n.hot) {
          ctx.beginPath();
          ctx.fillStyle = hexAlpha(n.color, 0.9);
          ctx.arc(p.x, p.y, Math.max(1.5, r * 0.35), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      hitNodes.push({
        id: n.id,
        kind: n.kind === 'category' ? 'category' : (n.alert ? 'alert' : n.kind),
        x: p.x,
        y: p.y,
        r: r + 6,
        vr: r,
        ref: n,
      });

      const labelOn = showLabels && (n.kind !== 'machine' || n.hot || n.depth <= 4);
      if (n.kind === 'category' && !focusCat) {
        // overview category titles placed separately at outer edge
      } else if (labelOn) {
        const el = ensureNodeLabel(n.id, n.label);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y + r + 2}px`;
        el.classList.add('is-on');
        el.style.opacity = n.kind === 'machine' && !n.hot ? '0.65' : '1';
      }
    });

    // hide node labels not in focus set
    nodeLabelEls.forEach((el, id) => {
      if (!showLabels || !nodes.some((n) => n.id === id)) {
        el.classList.remove('is-on');
      }
    });

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

    // overview category labels — outer edge (geom already clears toolbar / bottom)
    const sidePad = 40;
    CATS.forEach((cat) => {
      const el = ensureCatLabel(cat);
      if (focusCat || mapState === 'fan' || morph) {
        el.style.opacity = '0';
        return;
      }
      const wp = catLabelWorld.get(cat.id);
      if (!wp) { el.style.opacity = '0'; return; }
      const p = worldToScreen(wp.x, wp.y);
      el.style.left = `${Math.max(sidePad, Math.min(W - sidePad, p.x))}px`;
      el.style.top = `${p.y}px`;
      const op = catOpacity(cat.id);
      el.style.opacity = String(op);
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

  function clampPanSoft() {
    // Sky: small drift bounds like ref ±40 / ±50; fan: keep content near frame
    if (mapState === 'diving' || mapState === 'rising') return;
    if (!focusCat && mapState === 'sky') {
      tCamX = Math.max(-40, Math.min(40, tCamX));
      tCamY = Math.max(-50, Math.min(50, tCamY));
      camX = Math.max(-40, Math.min(40, camX));
      camY = Math.max(-50, Math.min(50, camY));
      return;
    }
    const M = 420;
    tCamX = Math.max(-M, Math.min(M, tCamX));
    tCamY = Math.max(-M, Math.min(M, tCamY));
  }

  function zoomAtScreen(clientX, clientY, nextZoom) {
    const u = usable();
    const ox = u.cx;
    const oy = u.cy;
    const zn = clampZoom(nextZoom);
    const k = zn / Math.max(zoom, 1e-6);
    // Keep world point under cursor stable (zoom-to-cursor)
    const wx = (clientX - ox) / zoom - camX;
    const wy = (clientY - oy) / zoom - camY;
    zoom = zn;
    targetZoom = zn;
    camX = (clientX - ox) / zn - wx;
    camY = (clientY - oy) / zn - wy;
    tCamX = camX;
    tCamY = camY;
  }

  function tick(ts) {
    const t = ts / 1000;
    const ease = reduceMotion ? 1 : EASE_CAM;

    // Wheel dial ease (ref 0.11)
    if (Math.abs(wheelT - wheelA) > 0.01) {
      wheelA += (wheelT - wheelA) * (reduceMotion ? 1 : EASE_WHEEL);
      if (mapState === 'sky' || mapState === 'aligning') layoutWheel();
    } else {
      wheelA = wheelT;
    }

    // Hover dim (sky whole-department only — ref CSS :has(.mini:hover))
    if (mapState === 'sky' || mapState === 'aligning') {
      CATS.forEach((cat) => {
        let target = 1;
        if (hoverCat) target = cat.id === hoverCat ? 1 : DIM_OTHERS;
        const cur = hoverAlpha[cat.id] ?? 1;
        hoverAlpha[cat.id] = cur + (target - cur) * EASE_HOVER;
        if (Math.abs(hoverAlpha[cat.id] - target) < 0.005) hoverAlpha[cat.id] = target;
      });
    }

    // Morph completion
    if (morph && (mapState === 'diving' || mapState === 'rising')) {
      const u = morphProgress();
      if (u >= 1) {
        if (mapState === 'diving') {
          focusCat = morph.focusId;
          mapState = 'fan';
          setFanMode(true);
          morph = null;
          const cat = CATS.find((c) => c.id === focusCat);
          if (cat) {
            focusBar.hidden = false;
            focusTitle.textContent = cat.label;
            focusSub.textContent = cat.subtitle;
            focusTitle.style.color = cat.color;
          }
          rebuildFocusLayout(focusCat, { setCamera: true });
          setTimeout(() => setTransitioning(false), 40);
        } else if (mapState === 'rising') {
          morph = null;
          focusCat = null;
          focusLayout = null;
          selectedChain = -1;
          mapState = 'sky';
          setFanMode(false);
          focusBar.hidden = true;
          rebuildOverviewLayout();
          targetZoom = clampZSky(1);
          tCamX = 0; tCamY = -H * 0.04;
          setTimeout(() => setTransitioning(false), 40);
        }
      }
    }

    // NO inertial pan (ref fan/sky: no velocity decay on pan)
    zoom += (targetZoom - zoom) * ease;
    camX += (tCamX - camX) * ease;
    camY += (tCamY - camY) * ease;
    clampPanSoft();

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
    hoverCat = null;
    hoverNodeId = null;
    selectedChain = -1;
    closeCore(false);
    if (selectedAlert && selectedAlert.categoryId !== id) closePanel(false);
    setTransitioning(true);

    // Phase A: align wheel (ref aligning)
    mapState = 'aligning';
    const wait = seatWheelTo(idx);

    const startMorph = () => {
      mapState = 'diving';
      // Capture FROM (overview after layoutWheel) then build TO (focus)
      layoutWheel();
      const from = snapshotLayout(
        layoutNodes.filter((n) => n.catId === id || n.id === id),
        layoutLinks.filter((L) => {
          const t = layoutNodes.find((n) => n.id === L.t);
          return t && t.catId === id;
        }),
      );
      // also include hub
      layoutNodes.filter((n) => n.catId === id).forEach((n) => {
        if (n.morphKey) from.nmap.set(n.morphKey, { ...n });
      });

      rebuildFocusLayout(id, { setCamera: false });
      const to = snapshotLayout(focusLayout.nodes, focusLayout.links);

      // Camera: rise out of root then fit (ref)
      zoom = 0.5; camX = 0; camY = 120;
      rebuildFocusLayout(id, { setCamera: true });

      beginMorph({ dir: 1, focusId: id, from, to, duration: DIVE_MORPH_MS });
      // Keep focusCat null until morph completes so labels/other fade via morphDisplay
      focusCat = null;
    };

    // Dim others immediately
    CATS.forEach((c) => { hoverAlpha[c.id] = c.id === id ? 1 : 0.12; });
    // Soft camera push toward hub during align
    const hub = layoutNodes.find((n) => n.id === id);
    if (hub) {
      targetZoom = clampZSky(Math.min(1.45, Math.max(zoom, 1.1)));
      tCamX = -hub.x * 0.2;
      tCamY = -hub.y * 0.2;
    }

    setTimeout(startMorph, reduceMotion ? 0 : wait);
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
    hoverNodeId = null;

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

    // Capture focus layout as FROM before clearing
    if (!focusLayout) rebuildFocusLayout(id, { setCamera: false });
    const from = snapshotLayout(focusLayout.nodes, focusLayout.links);
    mapState = 'rising';
    focusCat = null;
    setFanMode(false);
    focusBar.hidden = true;
    rebuildOverviewLayout();
    const toNodes = layoutNodes.filter((n) => n.catId === id);
    const toLinks = layoutLinks.filter((L) => {
      const tn = layoutNodes.find((n) => n.id === L.t);
      return tn && tn.catId === id;
    });
    const to = snapshotLayout(toNodes, toLinks);
    beginMorph({ dir: -1, focusId: id, from, to, duration: RISE_MS });
    targetZoom = clampZSky(1);
    tCamX = 0;
    tCamY = -H * 0.04;
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
      focusSub.textContent = next.subtitle;
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

  function setHoverFromPointer(lx, ly) {
    if (mapState !== 'sky' && mapState !== 'fan') return;
    const hit = pick(lx, ly);
    if (!hit || hit.kind === 'core') {
      hoverNodeId = null;
      if (mapState === 'sky') hoverCat = null;
      canvas.style.cursor = dragging ? 'grabbing' : 'grab';
      return;
    }
    if (mapState === 'sky') {
      // Ref: whole department hover only (no per-node path)
      hoverCat = hit.ref?.catId || (hit.kind === 'category' ? (hit.ref?.id || hit.id) : null);
      hoverNodeId = null;
      canvas.style.cursor = hoverCat ? 'pointer' : 'grab';
      return;
    }
    // Fan: hover scales node only (ref CSS); no chain fade on hover
    hoverCat = null;
    hoverNodeId = hit.ref?.id || hit.id;
    canvas.style.cursor = 'pointer';
  }

  function setHoverCat(id) {
    if (mapState !== 'sky') {
      hoverCat = null;
      return;
    }
    hoverCat = id || null;
    hoverNodeId = null;
    CATS.forEach((c) => { hoverAlpha[c.id] = !id ? 1 : (c.id === id ? 1 : DIM_OTHERS); });
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
    lastX = e.clientX; lastY = e.clientY;
    lastMoveTs = performance.now();
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
      if (mapState === 'fan' || focusCat) {
        const zn = clampZFan(pinchS0 * pinchRatio);
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
      // Angular dial (ref): point under cursor stays; dead zone uses dx*0.12
      const u = usable();
      const cx = u.cx + camX;
      const cy = u.cy + camY;
      const r0x = lastX - dx - cx, r0y = lastY - dy - cy;
      const r1x = e.clientX - cx, r1y = e.clientY - cy;
      if (Math.hypot(r0x, r0y) > 48 && Math.hypot(r1x, r1y) > 48) {
        let dA = (Math.atan2(r1y, r1x) - Math.atan2(r0y, r0x)) * 180 / Math.PI;
        if (dA > 180) dA -= 360; if (dA < -180) dA += 360;
        wheelA += dA;
      } else {
        wheelA -= dx * 0.12;
      }
      wheelT = wheelA;
      layoutWheel();
      clearTimeout(wheelIdle);
      wheelIdle = setTimeout(snapWheel, 260);
    } else if (mapState === 'fan' || focusCat) {
      // Direct pan, no inertia (ref)
      camX += dx; tCamX = camX;
      camY += dy; tCamY = camY;
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
      wheelIdle = setTimeout(snapWheel, 260);
    }
    canvas.style.cursor = (hoverCat || hoverNodeId) ? 'pointer' : 'grab';
  };
  window.addEventListener('pointerup', endPtr);
  window.addEventListener('pointercancel', endPtr);

  canvas.addEventListener('wheel', (e) => {
    if (viewMode !== 'map') return;
    if (e.target.closest?.('.side-panel, .core-panel')) return;
    e.preventDefault();
    const now = performance.now();

    if (e.ctrlKey || e.metaKey) {
      if (now < zoomLockUntil) return;
      if (mapState === 'sky') {
        zoomIntent += -e.deltaY;
        if (zoomIntent > 110) {
          focusCategory(CATS[focusedIdx()].id);
          zoomIntent = 0; zoomLockUntil = now + 900;
        } else if (zoomIntent < -110) zoomIntent = 0;
        return;
      }
      if (mapState === 'fan' || focusCat) {
        const zn = clampZFan(zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_EXP));
        if (zn <= RISE_SCALE && e.deltaY > 0) {
          zoomIntent += -e.deltaY;
          if (zoomIntent < -110) { clearFocus(); zoomIntent = 0; zoomLockUntil = now + 900; }
          return;
        }
        const rect = canvas.getBoundingClientRect();
        zoomAtScreen(e.clientX - rect.left, e.clientY - rect.top, zn);
      }
      return;
    }

    // Plain scroll: sky rotates wheel; fan pans (ref)
    if (mapState === 'fan' || focusCat) {
      camX -= e.deltaX; tCamX = camX;
      camY -= e.deltaY; tCamY = camY;
    } else if (mapState === 'sky') {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelT += d * 0.1;
      clearTimeout(wheelIdle);
      wheelIdle = setTimeout(snapWheel, 300);
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
    if (viewMode !== 'map' || mapState !== 'sky') return;
    e.preventDefault();
    recenterMap({ immediate: false });
  });

  document.getElementById('cat-prev').addEventListener('click', () => stepCategory(-1));
  document.getElementById('cat-next').addEventListener('click', () => stepCategory(1));
  document.getElementById('wchev-l').addEventListener('click', () => stepWheel(-1));
  document.getElementById('wchev-r').addEventListener('click', () => stepWheel(1));
  document.getElementById('panel-close').addEventListener('click', () => { closePanel(); selectedChain = -1; });
  document.getElementById('core-close').addEventListener('click', () => closeCore());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelOpen) { closePanel(); selectedChain = -1; }
      else if (coreOpen) closeCore();
      else if (mapState === 'fan' || focusCat) clearFocus();
      else recenterMap({ immediate: false });
    }
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
      EASE_CAM, EASE_WHEEL, EASE_HOVER, DIM_OTHERS, NODE_FADED, HOVER_NODE_SCALE,
      DRAG_CLICK_CANCEL, WHEEL_ZOOM_EXP, ZOOM_STEP_IN, ZOOM_STEP_OUT,
      Z_FAN_MIN, Z_FAN_MAX, RISE_SCALE, FAN_SPAN_DEG: 182, R0_FAN, R_BASE, R_STEP,
      DIVE_ALIGN_MS, DIVE_MORPH_MS, RISE_MS, W_STEP, N,
      fanInertia: false, skyDial: true, morphDive: true,
    }),
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
    setIdleSpin: () => {},
    setHover: (id) => setHoverCat(id || null),
    setHoverNode: (nodeId) => {
      // Fan-only hover scale target (no path lighting — matches ref)
      hoverNodeId = nodeId || null;
    },
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
    recenter: () => recenterMap({ immediate: true }),
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
    /** True when every visible cat title sits fully below the top toolbar. */
    titlesClearOfToolbar: (toolbarBottom = 56) => {
      const toggle = document.querySelector('.view-toggle');
      const barBottom = toggle
        ? toggle.getBoundingClientRect().bottom
        : toolbarBottom;
      let clear = true;
      const hits = [];
      labelLayer.querySelectorAll('.cat-label').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number(st.opacity) < 0.15) return;
        const r = el.getBoundingClientRect();
        if (r.height < 2) return;
        if (r.top < barBottom + 4) {
          clear = false;
          hits.push({ id: el.dataset.id, top: r.top, bar: barBottom });
        }
      });
      return { clear, hits, barBottom };
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
