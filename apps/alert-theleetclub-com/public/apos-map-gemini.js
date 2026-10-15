/**
 * APOS Gemini-inspired layer — orbit rings, inspector, hex toggle, nav, intro, hover dim.
 * Works with APOS_MAP_ENGINE mounts (space + tree). Inspiration only; keeps APOS hierarchy.
 */
(function () {
  'use strict';

  const PAGE = (() => {
    const p = (location.pathname || '').split('/').pop() || '';
    if (p.includes('3d')) return '3d';
    if (p.includes('tree')) return 'tree';
    return 'space';
  })();

  function api() {
    if (PAGE === 'tree') return window.APOS_TREE_MAP;
    if (PAGE === '3d') return window.APOS_3D_MAP;
    return window.APOS_SPACE_MAP;
  }

  function ensureNav() {
    const header = document.querySelector('.space-top, .tree-top, .map3d-top');
    if (!header || header.querySelector('.map-page-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'map-page-nav';
    nav.setAttribute('aria-label', 'Map variants');
    const links = [
      { href: 'apos-space-map.html', id: 'space', label: 'Space' },
      { href: 'apos-tree-map.html', id: 'tree', label: 'Tree' },
      { href: 'apos-3d-map.html', id: '3d', label: '3D' },
    ];
    links.forEach((L) => {
      const a = document.createElement('a');
      a.href = L.href;
      a.textContent = L.label;
      if (L.id === PAGE) a.classList.add('is-active');
      nav.appendChild(a);
    });
    const toggle = header.querySelector('.view-toggle');
    header.insertBefore(nav, toggle || null);
  }

  function ensureChrome() {
    const app = document.querySelector('.space-app, .tree-app, .map3d-app');
    const stage = document.querySelector('.space-stage, .tree-stage, .map3d-stage');
    if (!app || !stage) return;

    if (PAGE === 'space' && !stage.querySelector('.map-vignette')) {
      const v = document.createElement('div');
      v.className = 'map-vignette';
      stage.appendChild(v);
      const s = document.createElement('div');
      s.className = 'map-scanlines';
      stage.appendChild(s);
    }

    if (!app.querySelector('#inspector-drawer')) {
      const d = document.createElement('aside');
      d.id = 'inspector-drawer';
      d.className = 'inspector-drawer';
      d.innerHTML = `
        <button type="button" class="insp-close" aria-label="Close">×</button>
        <p class="insp-kicker" id="insp-kicker">node</p>
        <h3 class="insp-title" id="insp-title">—</h3>
        <div class="insp-grid" id="insp-grid"></div>`;
      app.appendChild(d);
      d.querySelector('.insp-close').addEventListener('click', () => closeInspector());
    }

    if (PAGE === 'space') {
      const header = document.querySelector('.space-top .view-toggle');
      if (header && !document.querySelector('.layout-mode-toggle')) {
        const wrap = document.createElement('div');
        wrap.className = 'layout-mode-toggle';
        wrap.innerHTML = `
          <button type="button" data-layout="radial" class="active">Radial</button>
          <button type="button" data-layout="hex">Hex</button>`;
        header.parentElement.insertBefore(wrap, header);
        wrap.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
            setLayoutMode(btn.dataset.layout);
          });
        });
      }
      if (!stage.querySelector('.hex-layer')) {
        const hx = document.createElement('canvas');
        hx.className = 'hex-layer';
        hx.id = 'hex-layer';
        stage.insertBefore(hx, stage.firstChild?.nextSibling || null);
      }
    }

    if (!document.getElementById('gemini-tooltip')) {
      const tip = document.createElement('div');
      tip.id = 'gemini-tooltip';
      tip.className = 'gemini-tooltip';
      tip.hidden = true;
      (stage || app).appendChild(tip);
    }
  }

  let layoutMode = 'radial';
  function setLayoutMode(mode) {
    layoutMode = mode === 'hex' ? 'hex' : 'radial';
    const hx = document.getElementById('hex-layer');
    if (hx) hx.classList.toggle('is-on', layoutMode === 'hex');
    document.querySelectorAll('.layout-mode-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.layout === layoutMode);
    });
    const m = api();
    if (m && typeof m.setLayoutMode === 'function') m.setLayoutMode(layoutMode);
    paintHexOverlay();
  }

  function paintHexOverlay() {
    const canvas = document.getElementById('hex-layer');
    const stage = document.querySelector('.space-stage');
    if (!canvas || !stage) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (layoutMode !== 'hex') return;
    const R = 74;
    const dx = R * 1.5;
    const dy = R * Math.sqrt(3);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    ctx.lineWidth = 1;
    for (let row = -2; row < h / dy + 3; row++) {
      for (let col = -2; col < w / dx + 3; col++) {
        const cx = col * dx + (row % 2 ? R * 0.75 : 0) + w * 0.5;
        const cy = row * dy * 0.5 + h * 0.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  function openInspector(payload) {
    const d = document.getElementById('inspector-drawer');
    if (!d) return;
    document.getElementById('insp-kicker').textContent = payload.kicker || 'node';
    document.getElementById('insp-title').textContent = payload.title || '—';
    const grid = document.getElementById('insp-grid');
    grid.innerHTML = '';
    (payload.rows || []).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'insp-row';
      row.innerHTML = `<span>${k}</span><span>${v}</span>`;
      grid.appendChild(row);
    });
    d.classList.add('is-open');
    document.body.classList.add('inspector-open');
    const m = api();
    if (m && typeof m.setInspectorOpen === 'function') m.setInspectorOpen(true);
  }

  function closeInspector() {
    const d = document.getElementById('inspector-drawer');
    if (d) d.classList.remove('is-open');
    document.body.classList.remove('inspector-open');
    const m = api();
    if (m && typeof m.setInspectorOpen === 'function') m.setInspectorOpen(false);
  }

  function showTip(text, x, y) {
    const tip = document.getElementById('gemini-tooltip');
    if (!tip) return;
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${x + 12}px`;
    tip.style.top = `${y + 12}px`;
    requestAnimationFrame(() => tip.classList.add('is-on'));
  }
  function hideTip() {
    const tip = document.getElementById('gemini-tooltip');
    if (!tip) return;
    tip.classList.remove('is-on');
    tip.hidden = true;
  }

  function bindInspectorBridge() {
    const m = api();
    if (!m) return;
    // Enrich API
    m.openInspector = openInspector;
    m.closeInspector = closeInspector;
    // Prefer engine getLayoutMode when present (hex tween lives in engine)
    if (typeof m.getLayoutMode !== 'function') {
      m.getLayoutMode = () => layoutMode;
    }
    const prevFly = m.flyTo?.bind(m);
    if (prevFly) {
      m.flyTo = (id) => {
        const r = prevFly(id);
        setTimeout(() => {
          try {
            const focus = m.getFocus?.();
            if (!focus || focus.overview) {
              closeInspector();
              return;
            }
            openInspector({
              kicker: focus.type || 'node',
              title: focus.id,
              rows: [
                ['Level', String(focus.level ?? '—')],
                ['Machine', focus.machineId || '—'],
                ['Location', focus.locationId || '—'],
                ['Hub', focus.hubId || focus.countryId || '—'],
                ['Mode', layoutMode],
              ],
            });
          } catch (_) { /* ignore */ }
        }, 420);
        return r;
      };
    }
  }

  function runIntro() {
    const app = document.querySelector('.space-app, .tree-app');
    if (!app || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    app.classList.add('gemini-intro');
    setTimeout(() => app.classList.add('gemini-intro-rays'), 40);
    setTimeout(() => app.classList.add('gemini-intro-rings'), 250);
    setTimeout(() => app.classList.add('gemini-intro-leaves'), 400);
    setTimeout(() => app.classList.remove('gemini-intro', 'gemini-intro-rays', 'gemini-intro-rings', 'gemini-intro-leaves'), 1600);
  }

  function boot() {
    ensureNav();
    ensureChrome();
    bindInspectorBridge();
    paintHexOverlay();
    window.addEventListener('resize', () => paintHexOverlay());
    runIntro();
    window.APOS_MAP_GEMINI = {
      openInspector,
      closeInspector,
      setLayoutMode,
      showTip,
      hideTip,
      page: PAGE,
    };
  }

  function waitReady() {
    const flag =
      PAGE === 'tree' ? '__APOS_TREE_READY__' : PAGE === '3d' ? '__APOS_3D_READY__' : '__APOS_SPACE_READY__';
    if (window[flag] || window.__APOS_MAP_READY__) {
      boot();
      return;
    }
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (window[flag] || window.__APOS_MAP_READY__ || n > 80) {
        clearInterval(t);
        boot();
      }
    }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitReady);
  else waitReady();
})();
