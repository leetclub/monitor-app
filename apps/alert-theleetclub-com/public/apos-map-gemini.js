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
    // Engine draws world-locked hex grid; DOM overlay unused
    const canvas = document.getElementById('hex-layer');
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.classList.remove('is-on');
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
    function paintInspector() {
      try {
        const focus = m.getFocus?.();
        const isOverview = !!(focus?.overview || m.isOverview?.());
        if (!focus || isOverview || focus.type === 'enterprise') {
          closeInspector();
          return;
        }
        const facts = m.nodeFacts?.(focus.id);
        openInspector({
          kicker: focus.type || 'node',
          title: facts?.label || focus.id,
          rows: facts ? [
            ['Alerts', String(facts.alerts)],
            ['Offline', String(facts.offline)],
            ['Revenue today', facts.revenueToday == null ? '—' : `${facts.revenueToday} KWD`],
            ['Stock', facts.stockPct == null ? '—' : `${facts.stockPct}%`],
            ['Status', facts.status],
          ] : [
            ['Level', String(focus.level ?? '—')],
          ],
        });
      } catch (_) { /* ignore */ }
    }
    const prevFly = m.flyTo?.bind(m);
    if (prevFly) {
      m.flyTo = (id) => {
        const r = prevFly(id);
        const paint = () => {
          if (m.isFlying?.()) requestAnimationFrame(paint);
          else paintInspector();
        };
        requestAnimationFrame(paint);
        return r;
      };
    }
    m.refreshInspector = paintInspector;
    const prevReset = m.reset?.bind(m);
    if (prevReset) {
      m.reset = (...args) => {
        closeInspector();
        return prevReset(...args);
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

  function ensureLiveChrome() {
    const stage = document.querySelector('.space-stage, .tree-stage, .map3d-stage');
    if (!stage || document.getElementById('map-command')) return;
    const bar = document.createElement('div');
    bar.id = 'map-command';
    bar.className = 'map-command';
    bar.innerHTML = `
      <button type="button" class="map-search-btn" id="map-search-btn">Search <kbd>Ctrl K</kbd></button>
      <div class="map-filters" role="tablist" aria-label="Filter nodes">
        <button type="button" data-filter="all" class="is-on">All</button>
        <button type="button" data-filter="alerts">Alerts</button>
        <button type="button" data-filter="offline">Offline</button>
        <button type="button" data-filter="lowstock">Low stock</button>
      </div>`;
    stage.appendChild(bar);
    const search = document.createElement('div');
    search.id = 'map-search';
    search.className = 'map-search';
    search.hidden = true;
    search.innerHTML = `<input id="map-search-input" placeholder="Find a node…" autocomplete="off" aria-label="Find a node"><ul id="map-search-list"></ul>`;
    stage.appendChild(search);
    const feed = document.createElement('ol');
    feed.id = 'map-event-feed';
    feed.className = 'map-event-feed';
    feed.setAttribute('aria-live', 'polite');
    stage.appendChild(feed);

    const input = search.querySelector('#map-search-input');
    const list = search.querySelector('#map-search-list');
    let active = 0;
    function hits() {
      const m = api();
      if (!m || typeof m.searchNodes !== 'function') return [];
      return m.searchNodes(input.value);
    }
    function paint() {
      const rows = hits();
      active = Math.min(active, Math.max(0, rows.length - 1));
      list.innerHTML = '';
      rows.forEach((h, i) => {
        const li = document.createElement('li');
        li.className = i === active ? 'is-active' : '';
        li.innerHTML = `${h.label}<span class="hit-type">${h.type}</span>`;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const m = api();
          if (m) m.flyTo(h.id);
          closeSearch();
        });
        list.appendChild(li);
      });
    }
    function openSearch() {
      search.hidden = false;
      input.value = '';
      active = 0;
      paint();
      input.focus();
    }
    function closeSearch() {
      search.hidden = true;
      input.blur();
    }
    document.getElementById('map-search-btn').addEventListener('click', openSearch);
    input.addEventListener('input', () => { active = 0; paint(); });
    input.addEventListener('keydown', (e) => {
      const rows = hits();
      if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); paint(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      if (e.key === 'Enter' && rows[active]) {
        e.preventDefault();
        e.stopPropagation();
        const m = api();
        if (m) m.flyTo(rows[active].id);
        closeSearch();
      }
    });
    bar.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = api();
        if (m && typeof m.setFilter === 'function') m.setFilter(btn.dataset.filter);
        bar.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-on', b === btn));
      });
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (search.hidden) openSearch();
        else closeSearch();
      }
    });
    stage.addEventListener('apos-live', (e) => {
      const ev = e.detail || {};
      const li = document.createElement('li');
      li.className = `kind-${ev.kind || 'sale'}`;
      li.textContent = ev.body || ev.label || 'event';
      feed.prepend(li);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      const map = api();
      if (map && typeof map.refreshInspector === 'function') map.refreshInspector();
    });
  }

  function boot() {
    ensureNav();
    ensureChrome();
    ensureLiveChrome();
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
