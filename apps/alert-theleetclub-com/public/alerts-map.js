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

  const R_HUB = 118;
  const LABEL_PAD = 72;
  let catLabelWorld = new Map(); // catId → {x,y}

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

  function worldToScreen(x, y) {
    const u = usable();
    return { x: u.cx + (x + camX) * zoom, y: u.cy + (y + camY) * zoom };
  }

  function leafWeight(node) {
    if (!node.children || !node.children.length) return 1;
    return node.children.reduce((s, c) => s + leafWeight(c), 0);
  }

  const SIZE_OV = { category: 15, subtype: 10.5, area: 4.2, site: 3.6, machine: 3.2 };

  /**
   * Parent-relative constellation placement (not concentric rings from hub).
   * Each child grows outward from its parent within an angular sector.
   */
  function placeConstellation(root, px, py, angle, halfSpan, depth, color, outNodes, outLinks, parent = null) {
    const edgeByDepth = [0, 50, 40, 36, 32];
    const edge = edgeByDepth[Math.min(depth, edgeByDepth.length - 1)] || 30;
    // Stronger lateral jitter so fans read as zig-zag constellations, not arcs
    const jitter = depth === 0 ? 0 : Math.sin(depth * 2.7 + angle * 6.1) * (depth >= 2 ? 11 : 5)
      + Math.cos(angle * 3.1 + depth) * (depth >= 2 ? 4 : 1.5);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const x = depth === 0 ? px : px + Math.cos(angle) * edge + nx * jitter;
    const y = depth === 0 ? py : py + Math.sin(angle) * edge + ny * jitter;
    const catId = root.catId || (root.kind === 'category' ? root.id : parent?.catId);
    const node = {
      id: root.id,
      kind: root.kind,
      label: root.label,
      color,
      icon: root.icon,
      alert: root.alert || null,
      catId,
      x,
      y,
      r: SIZE_OV[root.kind] || 3.5,
      depth,
      hot: !!(root.hot || (root.alert && root.alert.hot)),
      count: root.count || 0,
    };
    outNodes.push(node);
    if (parent) outLinks.push({ s: parent.id, t: node.id, color, depth });

    const kids = root.children || [];
    if (!kids.length) return;
    const weights = kids.map(leafWeight);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    // Leave breathing room between sibling fans
    const usableSpan = halfSpan * 2 * 0.92;
    let cursor = angle - usableSpan / 2;
    kids.forEach((child, i) => {
      const span = usableSpan * (weights[i] / total);
      const mid = cursor + span / 2;
      const childHalf = Math.max(0.035, span * 0.46);
      placeConstellation(
        { ...child, catId, icon: child.kind === 'subtype' ? root.icon : child.icon },
        x, y, mid, childHalf, depth + 1, color, outNodes, outLinks, node
      );
      cursor += span;
    });
  }

  /** Push overlapping overview nodes apart (min gap >= sum of radii + air). */
  function separateOverviewNodes(nodes) {
    for (let iter = 0; iter < 60; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.kind === 'category' && b.kind === 'category') continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy) || 0.001;
          const air = (a.kind === 'subtype' || b.kind === 'subtype') ? 7 : 9;
          const min = a.r + b.r + air;
          if (dist >= min) continue;
          const push = (min - dist) / 2;
          dx /= dist;
          dy /= dist;
          if (a.kind !== 'category') { a.x -= dx * push; a.y -= dy * push; }
          if (b.kind !== 'category') { b.x += dx * push; b.y += dy * push; }
        }
      }
    }
  }

  function fitOverviewCamera(nodes, labelPts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    labelPts.forEach((p) => {
      minX = Math.min(minX, p.x - 40);
      maxX = Math.max(maxX, p.x + 40);
      minY = Math.min(minY, p.y - 28);
      maxY = Math.max(maxY, p.y + 28);
    });
    minX = Math.min(minX, -24);
    maxX = Math.max(maxX, 24);
    minY = Math.min(minY, -24);
    maxY = Math.max(maxY, 24);
    const bw = maxX - minX;
    const bh = maxY - minY;
    const u = usable();
    const kz = Math.min((u.w * 0.86) / bw, (u.h * 0.84) / bh);
    targetZoom = Math.max(0.68, Math.min(1.02, kz));
    zoom = targetZoom;
    tCamX = -((minX + maxX) / 2);
    tCamY = -((minY + maxY) / 2);
    camX = tCamX;
    camY = tCamY;
  }

  /** Push category labels out until their screen AABB clears every node circle. */
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
          // circle vs label AABB in world space
          const cx = Math.max(lx - halfW, Math.min(n.x, lx + halfW));
          const cy = Math.max(ly - halfH, Math.min(n.y, ly + halfH));
          if (Math.hypot(n.x - cx, n.y - cy) < n.r + 2) { hit = true; break; }
        }
        if (!hit) break;
        lr += 7;
      }
      catLabelWorld.set(cat.id, { x: Math.cos(a) * lr, y: Math.sin(a) * lr, a });
    });
  }

  function rebuildOverviewLayout() {
    const nodes = [];
    const links = [];
    catLabelWorld = new Map();
    CATS.forEach((cat, i) => {
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      const hx = Math.cos(a) * R_HUB;
      const hy = Math.sin(a) * R_HUB;
      const tree = { ...(cat.overviewTree || cat.tree), icon: cat.icon, catId: cat.id };
      const wedge = (Math.PI * 2) / CATS.length * 0.38;
      placeConstellation(tree, hx, hy, a, wedge, 0, cat.color, nodes, links, null);
      links.push({ s: '__core__', t: cat.id, color: cat.color, depth: 0, spine: true });
    });
    separateOverviewNodes(nodes);

    // Category labels at OUTER edge of each sector (beyond farthest node)
    CATS.forEach((cat, i) => {
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      const catNodes = nodes.filter((n) => n.catId === cat.id);
      let maxR = R_HUB;
      catNodes.forEach((n) => {
        maxR = Math.max(maxR, Math.hypot(n.x, n.y));
      });
      let lr = maxR + LABEL_PAD;
      // Keep label clear of every node in this sector (world-space approx)
      for (let guard = 0; guard < 24; guard++) {
        const lx = Math.cos(a) * lr;
        const ly = Math.sin(a) * lr;
        let hit = false;
        for (let k = 0; k < catNodes.length; k++) {
          const n = catNodes[k];
          if (Math.hypot(n.x - lx, n.y - ly) < n.r + 30) { hit = true; break; }
        }
        if (!hit) break;
        lr += 6;
      }
      catLabelWorld.set(cat.id, { x: Math.cos(a) * lr, y: Math.sin(a) * lr, a });
    });

    layoutNodes = nodes;
    layoutLinks = links;
    if (!focusCat) {
      fitOverviewCamera(nodes, [...catLabelWorld.values()]);
      resolveCatLabelClearance(nodes);
      // Refit once labels moved outward
      fitOverviewCamera(nodes, [...catLabelWorld.values()]);
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
          r: node.kind === 'category' ? 16 : node.kind === 'subtype' ? 11 : node.kind === 'area' ? 8.5 : node.kind === 'site' ? 7 : 6,
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

  function drawCore(t) {
    const p = focusCat
      ? worldToScreen(0, -110)
      : worldToScreen(0, 0);
    if (!coreDust.length) {
      for (let i = 0; i < 180; i++) {
        const ring = Math.random();
        coreDust.push({
          a: Math.random() * Math.PI * 2,
          r: ring < 0.6 ? 6 + Math.random() * 26 : 24 + Math.random() * 42,
          s: 0.12 + Math.random() * 0.55,
          hue: Math.random(),
          size: 0.45 + Math.random() * 1.15,
        });
      }
    }
    const scale = (focusCat ? 1.25 : 1.05) * Math.min(1.35, 0.92 + zoom * 0.22);
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 88 * scale);
    g.addColorStop(0, 'rgba(255,255,255,0.48)');
    g.addColorStop(0.22, 'rgba(196,181,253,0.28)');
    g.addColorStop(0.5, 'rgba(94,234,212,0.1)');
    g.addColorStop(1, 'rgba(37,36,59,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 90 * scale, 0, Math.PI * 2);
    ctx.fill();

    coreDust.forEach((d, i) => {
      const ang = d.a + t * 0.06 * d.s;
      const rad = d.r * scale * (0.9 + 0.1 * Math.sin(t * 0.9 + i * 0.5));
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang * 1.05) * rad * 0.9;
      // Keep a clear disc around the wordmark
      if (Math.hypot(x - p.x, y - p.y) < 22 * scale) return;
      const col = d.hue < 0.3
        ? `rgba(255,255,255,${0.28 + d.s * 0.35})`
        : d.hue < 0.55
          ? `rgba(196,181,253,${0.22 + d.s * 0.3})`
          : d.hue < 0.8
            ? `rgba(94,234,212,${0.18 + d.s * 0.28})`
            : `rgba(251,113,133,${0.16 + d.s * 0.22})`;
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.arc(x, y, d.size * scale, 0, Math.PI * 2);
      ctx.fill();
    });

    // Crisp wordmark on top with dark halo
    const fs = Math.max(13, 15 * scale);
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6 * scale;
    ctx.strokeStyle = 'rgba(20, 19, 34, 0.95)';
    ctx.lineJoin = 'round';
    ctx.strokeText('leet', p.x, p.y);
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeStyle = 'rgba(37, 36, 59, 0.9)';
    ctx.strokeText('leet', p.x, p.y);
    ctx.fillStyle = 'rgba(252,252,254,0.99)';
    ctx.fillText('leet', p.x, p.y);
    hitNodes.push({ id: '__core__', kind: 'core', x: p.x, y: p.y, r: 36 * scale, vr: 36 * scale });
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
      const c = curvePts(a0.x, a0.y, a1.x, a1.y);
      const alpha = focusCat
        ? 0.55
        : (L.spine ? 0.42 : Math.max(0.14, 0.32 - (L.depth || 0) * 0.06));
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(L.color || '#fff', alpha);
      ctx.lineWidth = L.spine ? 1.55 : Math.max(0.55, 1.15 - (L.depth || 0) * 0.18);
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
        x1 = Math.cos(a) * R_HUB;
        y1 = Math.sin(a) * R_HUB;
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
    const zScale = Math.min(1.25, 0.92 + zoom * 0.18);
    nodes.forEach((n) => {
      if (focusCat && n.catId && n.catId !== focusCat) return;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const selected = selectedAlert && n.alert && selectedAlert.id === n.alert.id;
      const isHub = n.kind === 'category' || n.kind === 'subtype';
      const isLeaf = n.kind === 'site' || n.kind === 'machine' || n.kind === 'area';
      let r = (n.r + (selected ? 2 : 0)) * zScale;
      if (!focusCat && isLeaf) r = Math.max(2.6, Math.min(4.2, n.r * zScale));

      if (!focusCat && isLeaf) {
        // Overview leaves: small solid soft-white / accent dots (Skilltree)
        ctx.beginPath();
        ctx.fillStyle = n.hot
          ? hexAlpha(n.color, 0.95)
          : 'rgba(250, 250, 252, 0.88)';
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (isHub) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(24,24,27,0.9)';
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = n.kind === 'category' ? 2.1 : 1.7;
        ctx.strokeStyle = hexAlpha(n.color, 0.95);
        ctx.stroke();
        drawIcon(p.x, p.y, n.icon || 'unknown', n.color, 1, n.kind === 'category' ? 1 : 0.82);
      } else {
        // Focus mid/leaf nodes — outlined rings
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
    if (hit.kind === 'category') { focusCategory(hit.ref.catId || hit.ref.id); return; }
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
