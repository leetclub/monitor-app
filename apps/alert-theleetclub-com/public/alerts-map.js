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

  const R_HUB = 155;

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

  /** Place a tree in a radial wedge outward from (ox,oy) along baseAngle. */
  function placeRadialTree(root, ox, oy, baseAngle, halfSpan, depth0, color, outNodes, outLinks, parent = null) {
    const depth = depth0;
    const rByDepth = [0, 52, 88, 118, 148, 178];
    const rad = (rByDepth[Math.min(depth, rByDepth.length - 1)] || (178 + (depth - 5) * 22));
    const sizeByKind = { category: 17, subtype: 12, area: 9, site: 7.5, machine: 6 };
    const node = {
      id: root.id,
      kind: root.kind,
      label: root.label,
      color,
      icon: root.icon,
      alert: root.alert || null,
      catId: root.catId || (root.kind === 'category' ? root.id : parent?.catId),
      x: ox + Math.cos(baseAngle) * rad,
      y: oy + Math.sin(baseAngle) * rad,
      r: sizeByKind[root.kind] || 6,
      depth,
      hot: !!(root.alert && root.alert.hot),
    };
    if (depth === 0) { node.x = ox; node.y = oy; }
    outNodes.push(node);
    if (parent) outLinks.push({ s: parent.id, t: node.id, color, depth });

    const kids = root.children || [];
    if (!kids.length) return;
    const weights = kids.map(leafWeight);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = baseAngle - halfSpan;
    kids.forEach((child, i) => {
      const span = halfSpan * 2 * (weights[i] / total);
      const mid = cursor + span / 2;
      const childHalf = Math.max(0.04, span * 0.48);
      placeRadialTree(
        { ...child, catId: node.catId, icon: child.kind === 'subtype' ? root.icon : child.icon },
        ox, oy, mid, childHalf, depth + 1, color, outNodes, outLinks, node
      );
      cursor += span;
    });
  }

  function rebuildOverviewLayout() {
    const nodes = [];
    const links = [];
    CATS.forEach((cat, i) => {
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      const hx = Math.cos(a) * R_HUB;
      const hy = Math.sin(a) * R_HUB;
      const tree = { ...cat.tree, icon: cat.icon, catId: cat.id };
      const wedge = (Math.PI * 2) / CATS.length * 0.42;
      placeRadialTree(tree, hx, hy, a, wedge, 0, cat.color, nodes, links, null);
      // spine from core to category hub
      links.push({ s: '__core__', t: cat.id, color: cat.color, depth: 0, spine: true });
    });
    layoutNodes = nodes;
    layoutLinks = links;
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
      el.innerHTML = `<div class="name"></div><div class="sub"></div>`;
      labelLayer.appendChild(el);
      labelEls.set(cat.id, el);
    }
    el.querySelector('.name').textContent = cat.label;
    el.querySelector('.sub').textContent = cat.subtitle;
    el.style.color = cat.color;
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
      for (let i = 0; i < 260; i++) {
        const ring = Math.random();
        coreDust.push({
          a: Math.random() * Math.PI * 2,
          r: ring < 0.55 ? 4 + Math.random() * 28 : 22 + Math.random() * 58,
          s: 0.15 + Math.random() * 0.95,
          hue: Math.random(),
          size: 0.7 + Math.random() * (ring < 0.55 ? 2.4 : 1.6),
        });
      }
    }
    const scale = (focusCat ? 1.35 : 1.2) * Math.min(1.55, 0.95 + zoom * 0.28);
    // soft bloom — large dense "brain"
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 110 * scale);
    g.addColorStop(0, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.18, 'rgba(196,181,253,0.42)');
    g.addColorStop(0.42, 'rgba(94,234,212,0.16)');
    g.addColorStop(0.7, 'rgba(244,114,182,0.08)');
    g.addColorStop(1, 'rgba(37,36,59,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 112 * scale, 0, Math.PI * 2);
    ctx.fill();

    coreDust.forEach((d, i) => {
      const ang = d.a + t * 0.12 * d.s;
      const rad = d.r * scale * (0.82 + 0.18 * Math.sin(t * 1.35 + i * 0.7));
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang * 1.08) * rad * 0.9;
      const col = d.hue < 0.28
        ? `rgba(255,255,255,${0.4 + d.s * 0.45})`
        : d.hue < 0.52
          ? `rgba(196,181,253,${0.32 + d.s * 0.4})`
          : d.hue < 0.78
            ? `rgba(94,234,212,${0.28 + d.s * 0.38})`
            : `rgba(251,113,133,${0.22 + d.s * 0.3})`;
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.arc(x, y, d.size * scale, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = 'rgba(244,244,245,0.96)';
    ctx.font = `600 ${Math.max(13, 15 * scale)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('leet', p.x, p.y);
    hitNodes.push({ id: '__core__', kind: 'core', x: p.x, y: p.y, r: 48 * scale });
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
      const alpha = focusCat ? 0.55 : (L.spine ? 0.45 : 0.28 + (5 - Math.min(L.depth || 0, 5)) * 0.05);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, a1.x, a1.y);
      ctx.strokeStyle = hexAlpha(L.color || '#fff', alpha);
      ctx.lineWidth = L.spine ? 1.7 : Math.max(0.7, 1.4 - (L.depth || 0) * 0.15);
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
    nodes.forEach((n) => {
      if (focusCat && n.catId && n.catId !== focusCat) return;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;
      const selected = selectedAlert && n.alert && selectedAlert.id === n.alert.id;
      const r = (n.r + (selected ? 2.5 : 0)) * Math.min(1.35, 0.9 + zoom * 0.2);
      const dim = (!focusCat && n.kind === 'machine' && !n.hot) ? 0.55 : 1;

      ctx.beginPath();
      ctx.fillStyle = `rgba(24,24,27,${0.88 * dim})`;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = n.kind === 'category' || n.kind === 'subtype' ? 2.1 : 1.4;
      ctx.strokeStyle = hexAlpha(n.color, (n.hot || n.kind !== 'machine' ? 0.95 : 0.55) * dim);
      ctx.stroke();

      if (n.kind === 'category' || n.kind === 'subtype') {
        drawIcon(p.x, p.y, n.icon || 'unknown', n.color, dim, n.kind === 'category' ? 1 : 0.85);
      } else if (n.hot) {
        ctx.beginPath();
        ctx.fillStyle = hexAlpha(n.color, 0.9);
        ctx.arc(p.x, p.y, Math.max(1.6, r * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }

      hitNodes.push({
        id: n.id,
        kind: n.kind === 'category' ? 'category' : (n.alert ? 'alert' : n.kind),
        x: p.x,
        y: p.y,
        r: r + 7,
        ref: n,
      });

      const labelOn = showLabels && (n.kind !== 'machine' || n.hot || n.depth <= 4);
      if (n.kind === 'category' && !focusCat) {
        // overview category titles outside hub
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

    // overview category labels
    CATS.forEach((cat, i) => {
      const el = ensureCatLabel(cat);
      if (focusCat) {
        el.style.opacity = '0';
        return;
      }
      const a = (i / CATS.length) * Math.PI * 2 + rot;
      const lx = Math.cos(a) * (R_HUB + 78);
      const ly = Math.sin(a) * (R_HUB + 78);
      const p = worldToScreen(lx, ly);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = '1';
      el.querySelector('.name').style.color = cat.color;
    });

    // keep focused content inside usable area (soft clip only for overflow right of panel)
    if (panelOpen || coreOpen) {
      // already framed via usable(); no undrawn grey strip on the right
    }
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
      const boxes = window.LEET_ALERTS_MAP.labelBoxes();
      let hits = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const pad = 1;
          if (a.x < b.x + b.w - pad && a.x + a.w > b.x + pad && a.y < b.y + b.h - pad && a.y + a.h > b.y + pad) hits += 1;
        }
      }
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
