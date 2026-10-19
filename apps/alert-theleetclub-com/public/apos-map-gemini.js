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
    let tools = header.querySelector('.header-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'header-tools';
      header.insertBefore(tools, header.firstChild);
    }
    const brand = header.querySelector('.brand-mark');
    if (brand) tools.appendChild(brand);
    tools.appendChild(nav);
    const toggle = header.querySelector('.view-toggle');
    if (toggle) tools.appendChild(toggle);
    const layout = header.querySelector('.layout-mode-toggle');
    if (layout) tools.appendChild(layout);
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
    const sections = payload.sections && payload.sections.length ? payload.sections : [{ title: '', rows: payload.rows || [] }];
    sections.forEach((sec) => {
      if (sec.title) {
        const h = document.createElement('h4');
        h.className = 'insp-sec';
        h.textContent = sec.title;
        grid.appendChild(h);
      }
      (sec.rows || []).forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'insp-row';
        row.innerHTML = `<span>${k}</span><span>${v}</span>`;
        grid.appendChild(row);
      });
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
          sections: facts?.sections,
          rows: facts ? [
            ['Alerts', String(facts.alerts)],
            ['Offline', String(facts.offline)],
            ['Revenue today', facts.revenueToday == null ? '—' : `${facts.revenueToday} KWD`],
            ['Stock', facts.stockPct == null ? '—' : `${facts.stockPct}%`],
            ['Status', facts.health || facts.status],
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
    const prevIdle = m.waitForIdle?.bind(m);
    if (prevIdle) {
      m.waitForIdle = async () => {
        await prevIdle();
        paintInspector();
      };
    }
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
    function triage() {
      const m = api();
      const f = m?.fleetKpis?.() || {};
      return [
        { id: '__offline', label: `${f.offline || 0} offline machines`, type: 'triage', filter: 'offline' },
        { id: '__low', label: `${f.low || 0} low stock`, type: 'triage', filter: 'lowstock' },
        { id: '__unk', label: `${f.unknown || 0} stale machines`, type: 'triage', filter: 'unknown' },
        { id: '__crit', label: `${f.critical || 0} critical alerts`, type: 'triage', filter: 'critical' },
      ];
    }
    function paint() {
      const rows = input.value.trim() ? hits() : triage();
      active = Math.min(active, Math.max(0, rows.length - 1));
      list.innerHTML = '';
      rows.forEach((h, i) => {
        const li = document.createElement('li');
        li.className = i === active ? 'is-active' : '';
        const path = h.path ? `<span class="hit-path">${h.path}</span>` : '';
        li.innerHTML = `<span class="hit-label">${h.label}</span>${path}<span class="hit-type">${h.type}</span>`;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const m = api();
          if (!m) return;
          if (h.filter && m.setFilter) {
            m.setFilter(h.filter);
            document.querySelectorAll('[data-filter], [data-kpi]').forEach((b) => {
              b.classList.toggle('is-on', b.dataset.filter === h.filter || b.dataset.kpi === h.filter);
            });
          } else m.flyTo(h.id);
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
      const rows = input.value.trim() ? hits() : triage();
      if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); paint(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      if (e.key === 'Enter' && rows[active]) {
        e.preventDefault();
        e.stopPropagation();
        const m = api();
        const row = rows[active];
        if (m && row.filter && m.setFilter) m.setFilter(row.filter);
        else if (m) m.flyTo(row.id);
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
    stage.addEventListener('apos-live', () => {
      const map = api();
      if (map && map.fleetSnapshot) map.fleetSnapshot();
      if (map && typeof map.refreshInspector === 'function') map.refreshInspector();
    });
    stage.addEventListener('apos-fleet-sync', (e) => {
      renderIncidents(e.detail || null);
      if (e.detail) paintKpisFrom(e.detail);
    });
    function renderIncidents(snap) {
      const map = api();
      if (!snap) return;
      feed.innerHTML = '';
      if (!snap) return;
      feed.dataset.offline = String(snap.offline || 0);
      feed.dataset.open = String((snap.openIncidents || []).length);
      feed.dataset.history = String(snap.historyCount || 0);
      (snap.openIncidents || []).slice(0, 6).forEach((ev) => {
        const li = document.createElement('li');
        const sev = ev.severity || 'info';
        li.className = `incident sev-${sev}`;
        li.dataset.sev = sev;
        li.dataset.kind = ev.kind || '';
        li.dataset.machine = ev.machineId || '';
        const when = new Date(ev.at || Date.now());
        const hh = String(when.getHours()).padStart(2, '0');
        const mm = String(when.getMinutes()).padStart(2, '0');
        const facts = ev.machineId && map.nodeFacts ? map.nodeFacts(ev.machineId) : null;
        li.innerHTML = `<span class="inc-sev" aria-hidden="true"></span><span class="inc-path">${facts?.path || ev.label || ''}</span><span class="inc-what">${ev.happened || ev.label || 'Update'}</span><time class="inc-time">${hh}:${mm}</time>`;
        if (ev.machineId) {
          li.addEventListener('click', () => {
            const current = api();
            if (!current) return;
            if (current.focusIncident) current.focusIncident(Object.assign({}, ev, { path: facts?.path || ev.label, happened: ev.happened, severity: sev }));
            current.flyTo(ev.machineId);
          });
        }
        feed.appendChild(li);
      });
    }
  }

  function paintKpisFrom(f) {
    const bar = document.getElementById('fleet-kpis');
    if (!bar || !f) return;
    const when = new Date(f.refreshedAt || Date.now());
    const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
    const cells = [
      ['offline', 'Offline', f.offline],
      ['critical', 'Critical', f.critical],
      ['lowstock', 'Low stock', f.low],
      ['revenue', 'Revenue', `${f.revenueToday} KWD`],
      ['availability', 'Availability', `${f.availability}%`],
      ['refresh', 'Updated', clock],
    ];
    cells.forEach(([key, label, value]) => {
      const btn = bar.querySelector(`[data-kpi="${key}"]`);
      if (!btn) return;
      btn.querySelector('b').textContent = value == null ? '—' : String(value);
      btn.querySelector('span').textContent = label;
    });
  }

  function paintKpis() {
    const m = api();
    if (!m || typeof m.fleetKpis !== 'function') return;
    paintKpisFrom(m.fleetKpis());
  }

  function ensureFleetChrome() {
    const header = document.querySelector('.space-top, .tree-top, .map3d-top');
    if (header && !document.getElementById('fleet-kpis')) {
      const bar = document.createElement('div');
      bar.id = 'fleet-kpis';
      bar.className = 'fleet-kpis';
      bar.innerHTML = ['offline', 'critical', 'lowstock', 'revenue', 'availability', 'refresh']
        .map((k) => `<button type="button" data-kpi="${k}"><span></span><b>—</b></button>`).join('');
      header.appendChild(bar);
      bar.querySelectorAll('[data-kpi]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.kpi;
          if (key === 'revenue' || key === 'availability' || key === 'refresh') return;
          const m = api();
          if (!m || !m.setFilter) return;
          const next = m.getFilter?.() === key ? 'all' : key;
          m.setFilter(next);
          bar.querySelectorAll('[data-kpi]').forEach((b) => b.classList.toggle('is-on', b.dataset.kpi === next));
          document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-on', b.dataset.filter === next));
        });
      });
    }
    const stage = document.querySelector('.space-stage, .tree-stage, .map3d-stage');
    if (stage && !document.getElementById('map-legend')) {
      const legend = document.createElement('div');
      legend.id = 'map-legend';
      legend.className = 'map-legend';
      legend.innerHTML = `
        <span><i class="lg-shape lg-country"></i>Country</span>
        <span><i class="lg-shape lg-brand"></i>Brand</span>
        <span><i class="lg-shape lg-area"></i>Area</span>
        <span><i class="lg-shape lg-site"></i>Site</span>
        <span><i class="lg-shape lg-machine"></i>Machine</span>
        <span><i class="lg-dot lg-healthy"></i>Healthy</span>
        <span><i class="lg-dot lg-warning"></i>Warning</span>
        <span><i class="lg-dot lg-critical"></i>Critical</span>
        <span><i class="lg-dot lg-offline"></i>Offline</span>
        <span><i class="lg-dot lg-unknown"></i>Unknown</span>
        <span><i class="lg-shape lg-planned"></i>Planned</span>`;
      stage.appendChild(legend);
    }
    paintKpis();
    const crumb = document.querySelector('.crumb-pill, .space-crumb, .map3d-crumb');
    if (crumb && header && crumb.parentElement !== header) header.appendChild(crumb);
    const tools = header && header.querySelector('.header-tools');
    const cmd = document.getElementById('map-command');
    if (tools && cmd && cmd.parentElement !== tools) tools.appendChild(cmd);
    const layout = header && header.querySelector('.layout-mode-toggle');
    if (tools && layout && layout.parentElement !== tools) tools.appendChild(layout);
  }

  function boot() {
    ensureNav();
    ensureChrome();
    ensureLiveChrome();
    ensureFleetChrome();
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
