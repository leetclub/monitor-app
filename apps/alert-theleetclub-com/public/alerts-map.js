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

  let W = 0, H = 0, dpr = 1;
  let rot = -Math.PI / 2;
  let targetRot = rot;
  let zoom = 1;
  let targetZoom = 1;
  let camX = 0, camY = 0, tCamX = 0, tCamY = 0;
  let focusCat = null;
  let selectedAlert = null;
  let panelOpen = false;
  let coreOpen = false;
  let viewMode = 'map';
  let dragging = false;
  let lastX = 0;
  let dragStartX = 0;
  let dragDist = 0;
  let idleSpin = true;
  let searchQ = '';
  const particles = [];
  const coreDust = [];
  const hitNodes = [];
  const labelEls = new Map();
  const nodeLabelEls = new Map();

  const R_CORE = 52;
  const R_CAT = 168;
  const R_LEAF = 268;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = mapView.clientWidth;
    H = mapView.clientHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function usable() {
    const left = panelOpen || coreOpen ? Math.min(390, W - 32) + 28 : 0;
    return {
      x: left,
      y: 56,
      w: Math.max(240, W - left - 12),
      h: Math.max(220, H - 56 - 20),
      get cx() { return this.x + this.w / 2; },
      get cy() { return this.y + this.h * 0.52; },
    };
  }

  function catAngle(i) {
    return rot + (i / CATS.length) * Math.PI * 2;
  }

  function worldToScreen(x, y) {
    const u = usable();
    return {
      x: u.cx + (x + camX) * zoom,
      y: u.cy + (y + camY) * zoom,
    };
  }

  function layout() {
    const nodes = [];
    CATS.forEach((cat, i) => {
      const a = catAngle(i);
      const cx = Math.cos(a) * R_CAT;
      const cy = Math.sin(a) * R_CAT;
      nodes.push({
        kind: 'category',
        id: cat.id,
        cat,
        x: cx,
        y: cy,
        r: 18,
        angle: a,
      });
      const alerts = (cat.alerts || []).filter((al) => matchSearch(al));
      const n = Math.max(alerts.length, 1);
      alerts.forEach((al, j) => {
        const spread = (j - (n - 1) / 2) * 0.22;
        const la = a + spread;
        const rr = R_LEAF + (j % 3) * 18;
        nodes.push({
          kind: 'alert',
          id: al.id,
          cat,
          alert: al,
          x: Math.cos(la) * rr,
          y: Math.sin(la) * rr,
          r: 9,
          angle: la,
          parentX: cx,
          parentY: cy,
        });
      });
    });
    return nodes;
  }

  function matchSearch(al) {
    if (!searchQ) return true;
    const hay = `${al.title} ${al.subtype} ${al.machine.machine} ${al.machine.site} ${al.machine.area}`.toLowerCase();
    return hay.includes(searchQ);
  }

  function ensureLabels() {
    CATS.forEach((cat) => {
      if (labelEls.has(cat.id)) return;
      const el = document.createElement('div');
      el.className = 'cat-label';
      el.dataset.id = cat.id;
      el.innerHTML = `<div class="name">${cat.label}</div><div class="sub">${cat.subtitle}</div>`;
      labelLayer.appendChild(el);
      labelEls.set(cat.id, el);
    });
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

  function drawIcon(x, y, type, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (type === 'offline') {
      ctx.arc(0, 0, 5, 0.2, Math.PI * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(0, -2);
      ctx.stroke();
    } else if (type === 'stock') {
      ctx.rect(-5, -4, 10, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3, 0); ctx.lineTo(3, 0);
      ctx.stroke();
    } else if (type === 'revenue') {
      ctx.moveTo(-5, 4); ctx.lineTo(-1, -1); ctx.lineTo(2, 2); ctx.lineTo(5, -4);
      ctx.stroke();
    } else if (type === 'tasks') {
      ctx.rect(-4.5, -4.5, 9, 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, 0); ctx.lineTo(-0.5, 2); ctx.lineTo(3, -2);
      ctx.stroke();
    } else if (type === 'support') {
      ctx.arc(0, -1, 3.5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 3.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'cleaning') {
      ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath();
      ctx.stroke();
    } else {
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -2); ctx.lineTo(0, 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 3, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCore(t) {
    const p = worldToScreen(0, 0);
    for (let i = 0; i < 48; i++) {
      const ang = t * 0.35 + i * 0.4;
      const rad = 10 + (i % 7) * 4.2 + Math.sin(t * 1.2 + i) * 2;
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang * 1.1) * rad * 0.85;
      const a = 0.25 + (i % 5) * 0.1;
      ctx.beginPath();
      ctx.fillStyle = i % 3 === 0
        ? `rgba(196,181,253,${a})`
        : i % 3 === 1
          ? `rgba(103,232,249,${a})`
          : `rgba(255,255,255,${a})`;
      ctx.arc(x, y, 1.1 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, R_CORE * zoom * 0.55);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.35, 'rgba(167,139,250,0.28)');
    g.addColorStop(1, 'rgba(37,36,59,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R_CORE * zoom * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(244,244,245,0.92)';
    ctx.font = `600 ${Math.max(11, 13 * zoom)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('leet', p.x, p.y);
  }

  function curve(x0, y0, x1, y1) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const nx = -dy * 0.18;
    const ny = dx * 0.18;
    return { c1x: mx + nx * 0.35, c1y: my + ny * 0.35, c2x: mx + nx, c2y: my + ny };
  }

  function drawBranch(nodes, t) {
    hitNodes.length = 0;
    const u = usable();
    ctx.save();
    if (panelOpen || coreOpen) {
      ctx.beginPath();
      ctx.rect(u.x, 0, u.w, H);
      ctx.clip();
    }

    // faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    const step = 28;
    for (let x = u.x % step; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    nodes.forEach((n) => {
      if (n.kind !== 'alert') return;
      const hot = !focusCat || focusCat === n.cat.id;
      const a = hot ? (focusCat ? 0.75 : 0.5) : 0.05;
      const p0 = worldToScreen(n.parentX, n.parentY);
      const p1 = worldToScreen(n.x, n.y);
      const c = curve(p0.x, p0.y, p1.x, p1.y);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, p1.x, p1.y);
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = hot ? 1.15 : 0.7;
      ctx.stroke();
    });

    CATS.forEach((cat, i) => {
      const a = catAngle(i);
      const hot = !focusCat || focusCat === cat.id;
      const alpha = hot ? 0.7 : 0.1;
      const p0 = worldToScreen(0, 0);
      const p1 = worldToScreen(Math.cos(a) * R_CAT, Math.sin(a) * R_CAT);
      const c = curve(p0.x, p0.y, p1.x, p1.y);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, p1.x, p1.y);
      ctx.strokeStyle = hot
        ? `${cat.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
        : `rgba(255,255,255,${0.08})`;
      ctx.lineWidth = hot ? 1.6 : 0.9;
      ctx.stroke();
    });

    // flowing dots
    if (particles.length < 40) {
      for (let i = particles.length; i < 40; i++) {
        particles.push({
          cat: CATS[i % CATS.length].id,
          u: Math.random(),
          speed: 0.08 + Math.random() * 0.12,
        });
      }
    }
    particles.forEach((p) => {
      if (focusCat && p.cat !== focusCat) return;
      const cat = CATS.find((c) => c.id === p.cat);
      if (!cat) return;
      const i = CATS.indexOf(cat);
      const a = catAngle(i);
      p.u = (p.u + p.speed * 0.016) % 1;
      const rr = R_CAT * p.u;
      const s = worldToScreen(Math.cos(a) * rr, Math.sin(a) * rr);
      ctx.beginPath();
      ctx.fillStyle = cat.color;
      ctx.globalAlpha = 0.85;
      ctx.arc(s.x, s.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    nodes.forEach((n) => {
      const hot = !focusCat || focusCat === n.cat.id || n.kind === 'category';
      const fade = focusCat && focusCat !== n.cat.id ? 0.12 : 1;
      const p = worldToScreen(n.x, n.y);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) return;
      const selected = selectedAlert && n.kind === 'alert' && selectedAlert.id === n.id;
      const r = (n.r + (selected ? 3 : 0)) * Math.min(1.25, 0.85 + zoom * 0.2);

      if (n.kind === 'category') {
        ctx.beginPath();
        ctx.fillStyle = `rgba(24,24,27,${0.85 * fade})`;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = n.cat.color;
        ctx.globalAlpha = fade;
        ctx.stroke();
        drawIcon(p.x, p.y, n.cat.icon, n.cat.color, fade);
        ctx.globalAlpha = 1;
        hitNodes.push({ id: n.id, kind: 'category', x: p.x, y: p.y, r: r + 8, ref: n });
      } else {
        ctx.beginPath();
        ctx.fillStyle = `rgba(244,244,245,${0.92 * fade})`;
        ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = n.cat.color;
        ctx.globalAlpha = fade;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        hitNodes.push({ id: n.id, kind: 'alert', x: p.x, y: p.y, r: r + 6, ref: n });
        const el = ensureNodeLabel(n.id, n.alert.machine.machine);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y + r}px`;
        el.classList.toggle('is-on', !!focusCat && focusCat === n.cat.id && fade > 0.5);
      }
    });

    drawCore(t);

    // category labels
    ensureLabels();
    CATS.forEach((cat, i) => {
      const a = catAngle(i);
      const lx = Math.cos(a) * (R_CAT + 54);
      const ly = Math.sin(a) * (R_CAT + 54);
      const p = worldToScreen(lx, ly);
      const el = labelEls.get(cat.id);
      if (!el) return;
      const show = !focusCat || focusCat === cat.id;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = show ? (focusCat ? 0 : 1) : 0.12;
      if (focusCat === cat.id) el.style.opacity = '0';
    });

    ctx.restore();
  }

  function tick(ts) {
    const t = ts / 1000;
    if (idleSpin && !dragging && !focusCat) targetRot += 0.0018;
    rot += (targetRot - rot) * 0.08;
    zoom += (targetZoom - zoom) * 0.1;
    camX += (tCamX - camX) * 0.1;
    camY += (tCamY - camY) * 0.1;
    ctx.clearRect(0, 0, W, H);
    if (viewMode === 'map') drawBranch(layout(), t);
    requestAnimationFrame(tick);
  }

  function focusCategory(id, { push = true } = {}) {
    const cat = CATS.find((c) => c.id === id);
    if (!cat) return;
    focusCat = id;
    idleSpin = false;
    const i = CATS.indexOf(cat);
    // put branch at bottom-center extending upward → category angle ≈ +π/2
    const desired = Math.PI / 2;
    const current = catAngle(i);
    targetRot += desired - current;
    targetZoom = 1.72;
    tCamX = 0;
    tCamY = -48;
    focusBar.hidden = false;
    focusTitle.textContent = cat.label;
    focusSub.textContent = cat.subtitle;
    closeCore(false);
    if (selectedAlert && selectedAlert.categoryId !== id) closePanel(false);
    document.body.classList.toggle('panel-open', panelOpen || coreOpen);
  }

  function clearFocus({ immediate = false } = {}) {
    focusCat = null;
    idleSpin = true;
    targetZoom = 1;
    tCamX = 0;
    tCamY = 0;
    focusBar.hidden = true;
    if (immediate) {
      zoom = 1;
      camX = 0;
      camY = 0;
    }
    closePanel(false);
    closeCore(false);
  }

  function stepCategory(dir) {
    if (!focusCat) {
      focusCategory(CATS[0].id);
      return;
    }
    const i = CATS.findIndex((c) => c.id === focusCat);
    const next = CATS[(i + dir + CATS.length) % CATS.length];
    focusCategory(next.id);
  }

  function badgeClass(state) {
    const s = String(state || '').toLowerCase();
    if (s.includes('critical')) return 'critical';
    if (s.includes('warn')) return 'warning';
    if (s.includes('resol')) return 'resolved';
    return 'open';
  }

  function renderNodePanel(alert) {
    const m = alert.machine;
    panelBody.innerHTML = `
      <div class="panel-kicker"><span class="badge ${badgeClass(alert.state)}">${alert.state}</span></div>
      <h2 class="panel-title">${escapeHtml(alert.title)}</h2>
      <div class="panel-meta">${escapeHtml(alert.catLabel || catLabel(alert.categoryId))} · ${escapeHtml(alert.subtype)}</div>
      <p class="panel-desc">${escapeHtml(alert.description)}</p>
      <div class="action-banner">
        <span>Ops action ready for this machine</span>
        <button type="button" data-action="primary">${escapeHtml(alert.action || 'Open →')}</button>
      </div>
      <div class="sec">
        <h3>Affects</h3>
        <div class="pills">
          <span class="pill">${iconTiny('m')}${escapeHtml(m.machine)}</span>
          <span class="pill">${iconTiny('s')}${escapeHtml(m.site)}</span>
          <span class="pill">${iconTiny('a')}${escapeHtml(m.area)}</span>
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
          <div class="kicker" style="font:700 0.62rem/1 Inter,sans-serif;letter-spacing:.12em;color:#a1a1aa;text-transform:uppercase">Revenue at risk</div>
          <div class="big">${alert.impactPerHour.toFixed(1)} KWD / hr</div>
          <div class="tiny">Estimated from daily average while this alert stays open.</div>
        </div>
      </div>
      <div class="sec">
        <h3>The ladder</h3>
        <div class="ladder">
          ${(alert.ladderSteps || []).map((s) => `
            <div class="ladder-row ${s.current ? 'is-current' : ''}">
              <div class="step">${s.label}</div>
              <div>${escapeHtml(s.copy)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function catLabel(id) {
    return (CATS.find((c) => c.id === id) || {}).label || id;
  }

  function iconTiny() {
    return '';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function openPanel(alert) {
    selectedAlert = { ...alert, catLabel: catLabel(alert.categoryId) };
    renderNodePanel(selectedAlert);
    closeCore(false);
    nodePanel.hidden = false;
    nodePanel.setAttribute('aria-hidden', 'false');
    panelOpen = true;
    document.body.classList.add('panel-open');
    // Force layout, then slide in.
    void nodePanel.offsetWidth;
    nodePanel.classList.add('is-open');
  }

  function closePanel(animate = true) {
    selectedAlert = null;
    panelOpen = false;
    nodePanel.classList.remove('is-open');
    if (!animate) {
      nodePanel.hidden = true;
      nodePanel.setAttribute('aria-hidden', 'true');
    } else {
      setTimeout(() => {
        if (!panelOpen) {
          nodePanel.hidden = true;
          nodePanel.setAttribute('aria-hidden', 'true');
        }
      }, 320);
    }
    if (!coreOpen) document.body.classList.remove('panel-open');
  }

  function renderCorePanel() {
    const c = SNAP.counters;
    coreBody.innerHTML = `
      <div class="panel-kicker">LEET OVERVIEW</div>
      <h2 class="panel-title">Leet overview</h2>
      <div class="panel-meta">Single snapshot · ${c.machines} machines · Shadadiya · Zahra · Salmiya</div>
      <p class="panel-desc">Open alerts across Red Flags criteria, stock, cleaning, tasks, and support — one counter set for the core, branches, and this panel.</p>
      <div class="core-stats">
        <div class="core-stat"><div class="n">${c.open}</div><div class="l">Open alerts</div></div>
        <div class="core-stat"><div class="n">${c.critical}</div><div class="l">Critical</div></div>
        <div class="core-stat"><div class="n">${c.warning}</div><div class="l">Warning</div></div>
        <div class="core-stat"><div class="n">${c.revenueAtRisk}</div><div class="l">KWD / hr risk</div></div>
      </div>
      <div class="sec">
        <h3>By category</h3>
        <div class="ladder">
          ${CATS.map((cat) => `
            <div class="ladder-row">
              <div class="step" style="color:${cat.color}">${cat.label}</div>
              <div>${cat.count} open · ${escapeHtml(cat.subtitle)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="sec">
        <h3>Recent incidents</h3>
        <div class="ladder">
          ${SNAP.alerts.slice(0, 6).map((a) => `
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
    requestAnimationFrame(() => corePanel.classList.add('is-open'));
    coreOpen = true;
    document.body.classList.add('panel-open');
    closePanel(false);
  }

  function closeCore(animate = true) {
    coreOpen = false;
    corePanel.classList.remove('is-open');
    if (!animate) {
      corePanel.hidden = true;
      corePanel.setAttribute('aria-hidden', 'true');
    } else {
      setTimeout(() => {
        if (!coreOpen) {
          corePanel.hidden = true;
          corePanel.setAttribute('aria-hidden', 'true');
        }
      }, 320);
    }
    if (!panelOpen) document.body.classList.remove('panel-open');
  }

  function pick(x, y) {
    const core = worldToScreen(0, 0);
    if (Math.hypot(x - core.x, y - core.y) < 28 * zoom) return { kind: 'core' };
    let best = null;
    let bestD = 1e9;
    hitNodes.forEach((h) => {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d <= h.r && d < bestD) {
        best = h;
        bestD = d;
      }
    });
    return best;
  }

  function onPointerDown(e) {
    if (viewMode !== 'map') return;
    dragging = true;
    idleSpin = false;
    lastX = e.clientX;
    dragStartX = e.clientX;
    dragDist = 0;
    canvas.classList.add('is-dragging');
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    dragDist += Math.abs(dx);
    targetRot += dx * 0.005;
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (!focusCat) idleSpin = true;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  canvas.addEventListener('click', (e) => {
    if (viewMode !== 'map') return;
    if (dragDist > 6) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    if (hit.kind === 'core') {
      openCore();
      return;
    }
    if (hit.kind === 'category') {
      focusCategory(hit.ref.cat.id);
      return;
    }
    if (hit.kind === 'alert') {
      if (focusCat !== hit.ref.cat.id) focusCategory(hit.ref.cat.id);
      openPanel(hit.ref.alert);
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
      <div class="dash-card"><div class="k">Open alerts</div><div class="v">${c.open}</div><div class="d">Single snapshot across all categories</div></div>
      <div class="dash-card"><div class="k">Critical</div><div class="v">${c.critical}</div><div class="d">Offline / maintenance board</div></div>
      <div class="dash-card"><div class="k">Warning</div><div class="v">${c.warning}</div><div class="d">Stock · cleaning · stale sale · unknown</div></div>
      <div class="dash-card"><div class="k">KWD / hr risk</div><div class="v">${c.revenueAtRisk}</div><div class="d">Sum of open alert impact cards</div></div>
      <div class="dash-list">
        ${SNAP.alerts.map((a) => `
          <div class="dash-row">
            <span class="badge ${badgeClass(a.state)}">${a.state}</span>
            <span>${escapeHtml(a.title)}</span>
            <span style="color:var(--muted)">${escapeHtml(catLabel(a.categoryId))}</span>
            <span style="color:var(--muted)">${a.impactPerHour} KWD/h</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Public API for acceptance tests
  window.LEET_ALERTS_MAP = {
    snapshot: () => structuredClone(SNAP),
    getCounters: () => ({ ...SNAP.counters }),
    getFocus: () => ({ categoryId: focusCat, alertId: selectedAlert?.id || null, coreOpen, panelOpen, view: viewMode }),
    getTransform: () => ({ zoom, rot, camX, camY }),
    focusCategory: (id) => focusCategory(id),
    clearFocus: () => clearFocus(),
    openAlert: (id) => {
      const a = SNAP.alerts.find((x) => x.id === id);
      if (!a) return false;
      focusCategory(a.categoryId);
      openPanel(a);
      return true;
    },
    openCore: () => openCore(),
    closePanel: () => closePanel(),
    closeCore: () => closeCore(),
    setView: (v) => {
      document.querySelector(`.view-toggle button[data-view="${v}"]`)?.click();
    },
    waitForIdle: () => new Promise((r) => setTimeout(r, 420)),
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
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) hits += 1;
        }
      }
      return hits;
    },
    panelClearance: () => {
      if (!panelOpen && !coreOpen) return true;
      const panel = panelOpen ? nodePanel : corePanel;
      const pr = panel.getBoundingClientRect();
      const nodes = hitNodes.filter((h) => h.kind === 'alert' || h.kind === 'category');
      return nodes.every((h) => h.x > pr.right + 8 || h.x < pr.left - 8);
    },
  };

  window.addEventListener('resize', resize);
  resize();
  ensureLabels();
  window.__LEET_ALERTS_READY__ = true;
  requestAnimationFrame(tick);
})();
