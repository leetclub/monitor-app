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

  let W = 0, H = 0, dpr = 1;
  let rot = -Math.PI / 2;
  let targetRot = rot;
  let zoom = 1, targetZoom = 1;
  let camX = 0, camY = 0, tCamX = 0, tCamY = 0;
  let focusCat = null;
  let selectedAlert = null;
  let panelOpen = false;
  let coreOpen = false;
  let viewMode = 'map';
  let dragging = false;
  let lastX = 0;
  let dragDist = 0;
  let idleSpin = true;
  let searchQ = '';
  let layoutNodes = [];
  let layoutLinks = [];
  let focusLayout = null;
  const particles = [];
  const coreDust = [];
  const hitNodes = [];
  const labelEls = new Map();
  const nodeLabelEls = new Map();

  let catLabelWorld = new Map(); // catId → {x,y}
  let overviewGeom = { rHub: 120, rTip: 360, rLabel: 400, rCore: 60 };

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
      get cy() { return this.y + this.h * (focusCat ? 0.42 : 0.5); },
    };
  }

  /**
   * Skilltree radii (world ≈ screen px at zoom 1):
   * core ~8% min(vw,vh), hubs 22–25% of label R, tips 85–90% of label R.
   */
  function computeOverviewGeom() {
    const m = Math.min(W, H);
    const rLabel = m * 0.455;
    const rTip = rLabel * 0.88;
    const rHub = rLabel * 0.24;
    const rCore = m * 0.08;
    overviewGeom = { rHub, rTip, rLabel, rCore };
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

  /** One sector: hub + 8–15 zig-zag crystal branches reaching rTip. */
  function buildSectorConstellation(cat, angle, halfSpan, outNodes, outLinks) {
    const { rHub, rTip } = overviewGeom;
    const color = cat.color;
    const ov = cat.overviewTree || {};
    const tips = ov.tips || [];
    const subtypes = ov.subtypes || [];

    const hx = Math.cos(angle) * rHub;
    const hy = Math.sin(angle) * rHub;
    outNodes.push({
      id: cat.id,
      kind: 'category',
      label: cat.label,
      color,
      icon: cat.icon,
      alert: null,
      catId: cat.id,
      x: hx,
      y: hy,
      r: 11,
      depth: 0,
      hot: false,
    });
    outLinks.push({
      s: '__core__', t: cat.id, color, depth: 0, spine: true, straight: true,
    });

    // Optional subtype markers just outside the hub along the sector
    subtypes.forEach((sub, si) => {
      const t = subtypes.length === 1 ? 0.5 : si / (subtypes.length - 1);
      const a = angle - halfSpan * 0.55 + t * halfSpan * 1.1;
      const rr = rHub + (rTip - rHub) * 0.18;
      outNodes.push({
        id: sub.id,
        kind: 'subtype',
        label: sub.label,
        color,
        icon: cat.icon,
        alert: null,
        catId: cat.id,
        x: Math.cos(a) * rr,
        y: Math.sin(a) * rr,
        r: 7.2,
        depth: 1,
        hot: false,
      });
      outLinks.push({
        s: cat.id, t: sub.id, color, depth: 1, straight: true,
      });
    });

    const branchCount = Math.max(8, Math.min(15, Math.max(tips.length, 10)));
    const spanUse = halfSpan * 1.72;

    for (let b = 0; b < branchCount; b++) {
      const t = branchCount === 1 ? 0.5 : b / (branchCount - 1);
      const branchAng = angle - spanUse / 2 + t * spanUse;
      const segs = 2 + (b % 3); // 2–4 segments
      const tipR = rTip * (0.97 + (b % 4) * 0.008); // sit on tip ring (~85–90% of label R)
      let prevId = cat.id;
      let prevX = hx;
      let prevY = hy;
      // Start from a subtype if available (connect visual hub→rule→fork)
      if (subtypes.length) {
        prevId = subtypes[b % subtypes.length].id;
        const sn = outNodes.find((n) => n.id === prevId);
        if (sn) { prevX = sn.x; prevY = sn.y; }
      }

      for (let s = 1; s <= segs; s++) {
        const u = s / segs;
        const baseR = rHub + (tipR - rHub) * (subtypes.length ? 0.22 + u * 0.78 : u);
        const zigScale = (rTip - rHub) * (0.045 + u * 0.03);
        const side = ((b + s) % 2 === 0 ? 1 : -1);
        const zig = side * zigScale * (0.55 + 0.45 * Math.sin(b * 2.3 + s * 1.7));
        const nx = -Math.sin(branchAng);
        const ny = Math.cos(branchAng);
        // Slight angle drift for crystal look
        const ang = branchAng + side * 0.04 * (1 - u) * Math.sin(b + s);
        const x = Math.cos(ang) * baseR + nx * zig;
        const y = Math.sin(ang) * baseR + ny * zig;
        const isTip = s === segs;
        const tip = tips.length ? tips[b % tips.length] : null;
        const id = isTip && tip ? `${tip.id}:b${b}` : `${cat.id}:br${b}:j${s}`;
        outNodes.push({
          id,
          kind: isTip ? 'machine' : 'site',
          label: isTip ? (tip?.label || '·') : '·',
          color,
          icon: null,
          alert: isTip ? (tip?.alert || null) : null,
          catId: cat.id,
          x,
          y,
          r: isTip ? 2.35 : 1.5, // ~4.7px tip / 3px junction at zoom 1
          depth: s + 1,
          hot: !!(isTip && tip && tip.hot),
        });
        outLinks.push({
          s: prevId, t: id, color, depth: s + 1, straight: true,
          x0: prevX, y0: prevY, x1: x, y1: y,
        });
        prevId = id;
        prevX = x;
        prevY = y;
      }

      // Fork once or twice on alternating branches
      if (b % 2 === 0) {
        const forkFrom = prevId;
        const midX = prevX;
        const midY = prevY;
        const forkAng = branchAng + (b % 4 === 0 ? 0.09 : -0.09);
        const forkR = tipR * 0.97;
        const fx = Math.cos(forkAng) * forkR;
        const fy = Math.sin(forkAng) * forkR;
        const tip = tips.length ? tips[(b + 3) % tips.length] : null;
        const fid = tip ? `${tip.id}:fork${b}` : `${cat.id}:fork${b}`;
        outNodes.push({
          id: fid,
          kind: 'machine',
          label: tip?.label || '·',
          color,
          icon: null,
          alert: tip?.alert || null,
          catId: cat.id,
          x: fx,
          y: fy,
          r: 2.35,
          depth: 5,
          hot: !!(tip && tip.hot),
        });
        outLinks.push({
          s: forkFrom, t: fid, color, depth: 5, straight: true,
          x0: midX, y0: midY, x1: fx, y1: fy,
        });
      }
    }
  }

  /** Keep dots from overlapping; preserve radial reach (push sideways). */
  function separateOverviewNodes(nodes) {
    for (let iter = 0; iter < 55; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.kind === 'category' || b.kind === 'category') {
            if (a.kind === 'category' && b.kind === 'category') continue;
          }
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy) || 0.001;
          const air = (a.kind === 'machine' || b.kind === 'machine') ? 2.8
            : (a.kind === 'subtype' || b.kind === 'subtype') ? 5 : 3.2;
          const min = a.r + b.r + air;
          if (dist >= min) continue;
          const push = (min - dist) / 2;
          dx /= dist;
          dy /= dist;
          // Prefer tangential push so tips stay near rTip
          if (a.kind !== 'category' && a.kind !== 'subtype') {
            a.x -= dx * push;
            a.y -= dy * push;
          }
          if (b.kind !== 'category' && b.kind !== 'subtype') {
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
  }

  function resolveCatLabelClearance(nodes) {
    const z = Math.max(0.5, zoom);
    CATS.forEach((cat) => {
      const wp = catLabelWorld.get(cat.id);
      if (!wp) return;
      const a = wp.a;
      let lr = Math.hypot(wp.x, wp.y);
      const halfW = 100 / z;
      const halfH = 22 / z;
      for (let guard = 0; guard < 40; guard++) {
        const lx = Math.cos(a) * lr;
        const ly = Math.sin(a) * lr;
        let hit = false;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const cx = Math.max(lx - halfW, Math.min(n.x, lx + halfW));
          const cy = Math.max(ly - halfH, Math.min(n.y, ly + halfH));
          if (Math.hypot(n.x - cx, n.y - cy) < n.r + 3) { hit = true; break; }
        }
        if (!hit) break;
        lr += 6;
      }
      catLabelWorld.set(cat.id, { x: Math.cos(a) * lr, y: Math.sin(a) * lr, a });
    });
  }

  function rebuildOverviewLayout() {
    const g = computeOverviewGeom();
    const nodes = [];
    const links = [];
    catLabelWorld = new Map();
    const halfSpan = (Math.PI * 2) / CATS.length * 0.42;

    CATS.forEach((cat, i) => {
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      buildSectorConstellation(cat, a, halfSpan, nodes, links);
    });
    // Keep radial structure: project tips onto tip ring, junctions onto mid band
    function projectRadial() {
      nodes.forEach((n, i) => {
        if (n.kind === 'category' || n.kind === 'subtype') return;
        const ang = Math.atan2(n.y, n.x);
        if (n.kind === 'machine') {
          // rTip is already ~0.88×rLabel; keep tips on that ring
          const target = g.rTip * (0.98 + (i % 5) * 0.004);
          n.x = Math.cos(ang) * target;
          n.y = Math.sin(ang) * target;
        } else if (n.kind === 'site') {
          const u = Math.min(0.82, Math.max(0.30, (n.depth || 2) / 5));
          const target = g.rHub + (g.rTip - g.rHub) * u;
          n.x = Math.cos(ang) * target;
          n.y = Math.sin(ang) * target;
        }
      });
    }

    projectRadial();
    separateOverviewNodes(nodes);
    projectRadial();
    // Light tangential-only pass so tips stay on the ring
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.kind === 'category' || b.kind === 'category') continue;
          if (a.kind !== 'machine' && a.kind !== 'site') continue;
          if (b.kind !== 'machine' && b.kind !== 'site') continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const min = a.r + b.r + 2.6;
          if (dist >= min) continue;
          const midAng = Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2);
          const tx = -Math.sin(midAng);
          const ty = Math.cos(midAng);
          const push = (min - dist) / 2;
          a.x -= tx * push;
          a.y -= ty * push;
          b.x += tx * push;
          b.y += ty * push;
        }
      }
      projectRadial();
    }

    CATS.forEach((cat, i) => {
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      // Labels just outside the tip ring (fixed design radius)
      catLabelWorld.set(cat.id, {
        x: Math.cos(a) * g.rLabel,
        y: Math.sin(a) * g.rLabel,
        a,
      });
    });

    layoutNodes = nodes;
    layoutLinks = links;
    if (!focusCat) {
      zoom = 1;
      targetZoom = 1;
      camX = 0;
      camY = 0;
      tCamX = 0;
      tCamY = 0;
      // Only nudge labels outward a little if a tip still clips them
      resolveCatLabelClearance(nodes);
    }
  }

  /** Focus: core at top, full category tree growing downward filling the usable canvas. */
  function rebuildFocusLayout(catId) {
    const cat = CATS.find((c) => c.id === catId);
    if (!cat) { focusLayout = null; return; }
    const nodes = [];
    const links = [];
    const root = { ...cat.tree, icon: cat.icon, catId: cat.id };

    // Top-down layered layout (core → category → subtypes → …)
    const levels = [];
    walk(root, (n, depth) => {
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(n);
    });

    const positioned = new Map();
    const layerGap = 58;
    const y0 = -40; // category near top under core

    levels.forEach((layer, depth) => {
      const y = y0 + depth * layerGap;
      const n = layer.length;
      const width = Math.max(220, Math.min(520, n * 42));
      layer.forEach((node, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = -width / 2 + t * width;
        // slight crystalline jitter
        const jx = Math.sin(i * 2.3 + depth) * 6;
        const jy = (i % 2) * 8;
        positioned.set(node.id, {
          id: node.id,
          kind: node.kind,
          label: node.label,
          color: cat.color,
          icon: node.kind === 'category' ? cat.icon : node.icon,
          alert: node.alert || null,
          catId: cat.id,
          x: x + jx,
          y: y + jy,
          r: node.kind === 'category' ? 18 : node.kind === 'subtype' ? 11 : node.kind === 'area' ? 8.5 : node.kind === 'site' ? 7 : 6,
          depth,
          hot: !!(node.alert && node.alert.hot),
        });
      });
    });

    walk(root, (n, depth, parent) => {
      const pn = positioned.get(n.id);
      if (pn) nodes.push(pn);
      if (parent) {
        links.push({ s: parent.id, t: n.id, color: cat.color, depth });
      }
    });
    links.push({ s: '__core__', t: cat.id, color: cat.color, depth: 0, spine: true });

    // Fit tree into usable frame: compute bbox and set camera targets
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    // include core anchor above
    minY = Math.min(minY, -120);
    const bw = Math.max(80, maxX - minX);
    const bh = Math.max(80, maxY - minY);
    const u = usable();
    const pad = 0.86;
    const kz = Math.min((u.w * pad) / bw, (u.h * pad) / (bh + 40));
    targetZoom = Math.max(0.95, Math.min(1.85, kz));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2 - 10;
    tCamX = -midX;
    tCamY = -midY;

    focusLayout = { nodes, links, color: cat.color, cat };
  }

  function activeNodes() {
    return focusCat && focusLayout ? focusLayout.nodes : layoutNodes;
  }
  function activeLinks() {
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
      el.innerHTML = `<div class="name"></div><div class="accent"></div><div class="sub"></div>`;
      labelLayer.appendChild(el);
      labelEls.set(cat.id, el);
    }
    el.querySelector('.name').textContent = cat.label;
    el.querySelector('.sub').textContent = cat.subtitle;
    el.querySelector('.accent').style.background = cat.color;
    el.style.color = '#f4f4f5';
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
    const coreR = focusCat ? 70 : (overviewGeom.rCore || Math.min(W, H) * 0.08);
    if (!coreDust.length || coreDust._gen !== 5) {
      coreDust.length = 0;
      coreDust._gen = 5;
      for (let i = 0; i < 280; i++) {
        const ring = Math.random();
        coreDust.push({
          a: Math.random() * Math.PI * 2,
          r: ring < 0.55 ? coreR * (0.15 + Math.random() * 0.45) : coreR * (0.45 + Math.random() * 0.55),
          s: 0.1 + Math.random() * 0.5,
          hue: Math.random(),
          size: 0.55 + Math.random() * 1.4,
        });
      }
    }
    const scale = focusCat ? 1.2 : zoom;
    const bloomR = coreR * scale;
    const g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, bloomR);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.18, 'rgba(196,181,253,0.36)');
    g.addColorStop(0.42, 'rgba(94,234,212,0.14)');
    g.addColorStop(0.7, 'rgba(251,113,133,0.07)');
    g.addColorStop(1, 'rgba(37,36,59,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bloomR, 0, Math.PI * 2);
    ctx.fill();

    coreDust.forEach((d, i) => {
      const ang = d.a + t * 0.05 * d.s;
      const rad = d.r * scale * (0.9 + 0.1 * Math.sin(t * 0.85 + i * 0.45));
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang * 1.05) * rad * 0.9;
      if (Math.hypot(x - p.x, y - p.y) < Math.min(22, bloomR * 0.28)) return;
      const col = d.hue < 0.3
        ? `rgba(255,255,255,${0.3 + d.s * 0.35})`
        : d.hue < 0.55
          ? `rgba(196,181,253,${0.24 + d.s * 0.3})`
          : d.hue < 0.8
            ? `rgba(94,234,212,${0.2 + d.s * 0.28})`
            : `rgba(251,113,133,${0.18 + d.s * 0.24})`;
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.arc(x, y, d.size * scale, 0, Math.PI * 2);
      ctx.fill();
    });

    const fs = Math.max(15, 17 * scale);
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7 * scale;
    ctx.strokeStyle = 'rgba(20, 19, 34, 0.96)';
    ctx.lineJoin = 'round';
    ctx.strokeText('leet', p.x, p.y);
    ctx.lineWidth = 2.8 * scale;
    ctx.strokeStyle = 'rgba(37, 36, 59, 0.92)';
    ctx.strokeText('leet', p.x, p.y);
    ctx.fillStyle = 'rgba(252,252,254,0.99)';
    ctx.fillText('leet', p.x, p.y);
    hitNodes.push({ id: '__core__', kind: 'core', x: p.x, y: p.y, r: 52 * scale, vr: 52 * scale });
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

  function drawScene(t) {
    hitNodes.length = 0;
    // Full-bleed background — no grey strip
    ctx.fillStyle = '#25243b';
    ctx.fillRect(0, 0, W, H);

    // Dot grid across entire viewport
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let x = 10; x < W; x += 26) {
      for (let y = 10; y < H; y += 26) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const nodes = activeNodes().filter((n) => matchSearch(n.label, n.alert));
    const links = activeLinks();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const u = usable();

    // links
    links.forEach((L) => {
      const s = L.s === '__core__' ? nodeById('__core__') : nodeMap.get(L.s) || nodeById(L.s);
      const tN = nodeMap.get(L.t) || nodeById(L.t);
      if (!s || !tN) return;
      if (focusCat && L.s !== '__core__' && !nodeMap.has(L.s) && L.s !== focusCat) return;
      const a0 = worldToScreen(s.x, s.y);
      const a1 = worldToScreen(tN.x, tN.y);
      if (!focusCat && L.straight) {
        // Accent near hub → soft white/grey toward tips; clearly visible 1–1.5px
        const grad = ctx.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
        const near = L.spine || L.depth <= 1;
        if (near) {
          grad.addColorStop(0, hexAlpha(L.color || '#fff', L.spine ? 0.85 : 0.72));
          grad.addColorStop(1, 'rgba(228,228,231,0.62)');
        } else {
          grad.addColorStop(0, hexAlpha(L.color || '#fff', 0.55));
          grad.addColorStop(1, 'rgba(212,212,216,0.58)');
        }
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = L.spine ? 1.5 : (L.depth <= 2 ? 1.25 : 1.05);
        ctx.stroke();
        return;
      }
      const c = curvePts(a0.x, a0.y, a1.x, a1.y);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(L.color || '#fff', focusCat ? 0.55 : 0.4);
      ctx.lineWidth = L.spine ? 1.55 : 1.1;
      ctx.stroke();
    });

    // flow particles on spines / hot links
    if (particles.length < 55) {
      for (let i = particles.length; i < 55; i++) {
        particles.push({
          cat: CATS[i % CATS.length].id,
          u: Math.random(),
          speed: 0.06 + Math.random() * 0.1,
        });
      }
    }
    particles.forEach((p) => {
      if (focusCat && p.cat !== focusCat) return;
      const cat = CATS.find((c) => c.id === p.cat);
      if (!cat) return;
      p.u = (p.u + p.speed * 0.016) % 1;
      let x0, y0, x1, y1;
      if (focusCat) {
        x0 = 0; y0 = -110;
        x1 = 0; y1 = -40;
      } else {
        const i = CATS.indexOf(cat);
        const a = (i / CATS.length) * Math.PI * 2 + rot;
        x0 = 0; y0 = 0;
        x1 = Math.cos(a) * overviewGeom.rHub;
        y1 = Math.sin(a) * overviewGeom.rHub;
      }
      const x = x0 + (x1 - x0) * p.u;
      const y = y0 + (y1 - y0) * p.u;
      const s = worldToScreen(x, y);
      ctx.beginPath();
      ctx.fillStyle = cat.color;
      ctx.globalAlpha = 0.85;
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // nodes
    const showLabels = !!focusCat;
    const zScale = Math.min(1.2, 0.95 + zoom * 0.12);
    nodes.forEach((n) => {
      if (focusCat && n.catId && n.catId !== focusCat) return;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const selected = selectedAlert && n.alert && selectedAlert.id === n.alert.id;
      const isCat = n.kind === 'category';
      const isHub = isCat || n.kind === 'subtype';
      let r = (n.r + (selected ? 1.5 : 0)) * zScale;
      if (!focusCat && n.kind === 'machine') r = 2.35 * zScale; // ~4.7px tip
      if (!focusCat && n.kind === 'site') r = 1.5 * zScale; // 3px junction
      if (!focusCat && isCat) r = 11 * zScale; // ~22px diameter

      if (!focusCat && (n.kind === 'machine' || n.kind === 'site')) {
        ctx.beginPath();
        ctx.fillStyle = n.hot
          ? hexAlpha(n.color, n.kind === 'machine' ? 0.95 : 0.7)
          : (n.kind === 'machine' ? 'rgba(250,250,252,0.92)' : 'rgba(228,228,231,0.7)');
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (isHub) {
        if (isCat) {
          const glow = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 2.1);
          glow.addColorStop(0, hexAlpha(n.color, 0.35));
          glow.addColorStop(1, hexAlpha(n.color, 0));
          ctx.beginPath();
          ctx.fillStyle = glow;
          ctx.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = 'rgba(24,24,27,0.92)';
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = isCat ? 2.4 : 1.7;
        ctx.strokeStyle = hexAlpha(n.color, 0.98);
        ctx.stroke();
        if (focusCat && isCat) {
          drawBackChevron(p.x, p.y, n.color, r);
        } else {
          drawIcon(p.x, p.y, n.icon || 'unknown', n.color, 1, isCat ? 1.15 : 0.85);
        }
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

    drawCore(t);

    // overview category labels — outer edge, white, never on nodes
    CATS.forEach((cat) => {
      const el = ensureCatLabel(cat);
      if (focusCat) {
        el.style.opacity = '0';
        return;
      }
      const wp = catLabelWorld.get(cat.id);
      if (!wp) { el.style.opacity = '0'; return; }
      const p = worldToScreen(wp.x, wp.y);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = '1';
    });
  }

  function hexAlpha(hex, a) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function tick(ts) {
    const t = ts / 1000;
    if (idleSpin && !dragging && !focusCat) {
      targetRot += 0.0015;
      rebuildOverviewLayout();
    } else if (!focusCat && Math.abs(targetRot - rot) > 0.0001) {
      rebuildOverviewLayout();
    }
    rot += (targetRot - rot) * (focusCat ? 0.12 : 0.07);
    zoom += (targetZoom - zoom) * 0.1;
    camX += (tCamX - camX) * 0.1;
    camY += (tCamY - camY) * 0.1;
    if (viewMode === 'map') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(t);
    }
    requestAnimationFrame(tick);
  }

  function focusCategory(id) {
    const cat = CATS.find((c) => c.id === id);
    if (!cat) return;
    focusCat = id;
    idleSpin = false;
    rebuildFocusLayout(id);
    focusBar.hidden = false;
    focusTitle.textContent = cat.label;
    focusSub.textContent = cat.subtitle;
    focusTitle.style.color = cat.color;
    closeCore(false);
    if (selectedAlert && selectedAlert.categoryId !== id) closePanel(false);
    document.body.classList.toggle('panel-open', panelOpen || coreOpen);
  }

  function clearFocus({ immediate = false } = {}) {
    focusCat = null;
    focusLayout = null;
    idleSpin = true;
    targetZoom = 1;
    tCamX = 0;
    tCamY = 0;
    if (immediate) { zoom = 1; camX = 0; camY = 0; }
    focusBar.hidden = true;
    closePanel(false);
    closeCore(false);
    rebuildOverviewLayout();
  }

  function stepCategory(dir) {
    if (!focusCat) { focusCategory(CATS[0].id); return; }
    const i = CATS.findIndex((c) => c.id === focusCat);
    focusCategory(CATS[(i + dir + CATS.length) % CATS.length].id);
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

  canvas.addEventListener('pointerdown', (e) => {
    if (viewMode !== 'map') return;
    dragging = true;
    idleSpin = false;
    lastX = e.clientX;
    dragDist = 0;
    canvas.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    dragDist += Math.abs(dx);
    if (!focusCat) {
      targetRot += dx * 0.005;
      rebuildOverviewLayout();
    } else {
      tCamX += dx * 0.4 / Math.max(zoom, 0.5);
    }
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (!focusCat) idleSpin = true;
  });

  canvas.addEventListener('click', (e) => {
    if (viewMode !== 'map' || dragDist > 6) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    if (hit.kind === 'core') { openCore(); return; }
    if (hit.kind === 'category') {
      // In focus, category hub is a back control (chevron)
      if (focusCat) { clearFocus(); return; }
      focusCategory(hit.ref.catId || hit.ref.id);
      return;
    }
    if (hit.ref?.alert) {
      if (focusCat !== hit.ref.catId) focusCategory(hit.ref.catId);
      openPanel({ ...hit.ref.alert, ladderSteps: hit.ref.alert.ladderSteps || window.LEET_ALERTS_DATA.ladder(hit.ref.alert.ladder) });
    }
  });

  document.getElementById('cat-prev').addEventListener('click', () => stepCategory(-1));
  document.getElementById('cat-next').addEventListener('click', () => stepCategory(1));
  document.getElementById('panel-close').addEventListener('click', () => closePanel());
  document.getElementById('core-close').addEventListener('click', () => closeCore());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelOpen) closePanel();
      else if (coreOpen) closeCore();
      else if (focusCat) clearFocus();
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

  window.LEET_ALERTS_MAP = {
    snapshot: () => JSON.parse(JSON.stringify(SNAP)),
    getCounters: () => ({ ...SNAP.counters }),
    getFocus: () => ({ categoryId: focusCat, alertId: selectedAlert?.id || null, coreOpen, panelOpen, view: viewMode }),
    getTransform: () => ({ zoom, rot, camX, camY }),
    focusCategory: (id) => focusCategory(id),
    clearFocus: () => clearFocus(),
    openAlert: (id) => {
      const a = SNAP.categories.flatMap((c) => c.alerts).find((x) => x.id === id) || SNAP.alerts.find((x) => x.id === id);
      if (!a) return false;
      focusCategory(a.categoryId);
      openPanel({ ...a, ladderSteps: a.ladderSteps || window.LEET_ALERTS_DATA.ladder(a.ladder) });
      return true;
    },
    openCore: () => openCore(),
    closePanel: () => closePanel(),
    closeCore: () => closeCore(),
    setView: (v) => document.querySelector(`.view-toggle button[data-view="${v}"]`)?.click(),
    waitForIdle: () => new Promise((r) => setTimeout(r, 480)),
    setIdleSpin: (on) => { idleSpin = !!on; },
    /**
     * Drawing fill (excludes labels): bbox height of visible links + leaf dots
     * divided by viewport height. Target ≥ 0.70.
     */
    mapFillRatio: () => {
      let minY = Infinity;
      let maxY = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      const mark = (x, y, pad = 2) => {
        minX = Math.min(minX, x - pad);
        maxX = Math.max(maxX, x + pad);
        minY = Math.min(minY, y - pad);
        maxY = Math.max(maxY, y + pad);
      };
      hitNodes.forEach((h) => {
        if (h.kind === 'core' || h.kind === 'category') return;
        // leaf / junction / subtype dots that form the drawing
        if (h.kind === 'alert' || h.kind === 'site' || h.kind === 'machine' || h.ref?.kind === 'site'
          || h.ref?.kind === 'machine' || h.ref?.kind === 'subtype') {
          mark(h.x, h.y, h.vr || 2);
        }
      });
      // Link endpoints from overview layout (screen space)
      if (!focusCat) {
        layoutLinks.forEach((L) => {
          const s = L.s === '__core__' ? { x: 0, y: 0 } : layoutNodes.find((n) => n.id === L.s);
          const t = layoutNodes.find((n) => n.id === L.t);
          if (!s || !t) return;
          const a0 = worldToScreen(s.x, s.y);
          const a1 = worldToScreen(t.x, t.y);
          mark(a0.x, a0.y, 1);
          mark(a1.x, a1.y, 1);
        });
      }
      if (!Number.isFinite(minY)) return 0;
      return (maxY - minY) / H;
    },
    /** Hub distance as fraction of design label radius (~0.22–0.25). */
    hubRadiusRatio: () => {
      const hub = layoutNodes.find((n) => n.kind === 'category');
      const lr = overviewGeom.rLabel || 1;
      if (!hub) return 0;
      return Math.hypot(hub.x, hub.y) / lr;
    },
    /** Mean tip distance as fraction of design label radius (~0.85–0.90). */
    tipRadiusRatio: () => {
      const tips = layoutNodes.filter((n) => n.kind === 'machine');
      const lr = overviewGeom.rLabel || 1;
      if (!tips.length) return 0;
      const avg = tips.reduce((s, n) => s + Math.hypot(n.x, n.y), 0) / tips.length;
      return avg / lr;
    },
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
      labelLayer.querySelectorAll('.cat-label, .node-label.is-on').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number(st.opacity) < 0.15) return;
        const r = el.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        labels.push({
          x: r.left - cr.left,
          y: r.top - cr.top,
          w: r.width,
          h: r.height,
        });
      });
      const ns = hitNodes.filter((h) => h.kind !== 'core' && h.vr > 0);
      let hits = 0;
      labels.forEach((box) => {
        ns.forEach((n) => {
          const vr = n.vr || n.r;
          // circle vs AABB
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
  };

  window.addEventListener('resize', resize);
  resize();
  rebuildOverviewLayout();
  window.__LEET_ALERTS_READY__ = true;
  requestAnimationFrame(tick);
})();
