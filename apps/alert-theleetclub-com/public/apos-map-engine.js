/**
 * APOS Map Engine — shared layout / LOD / camera / labels / cards / world canvas.
 * Themes: tree (indigo skilltree) and space (deep-space + green terminal).
 * Mount via window.APOS_MAP_ENGINE.mount(config).
 */
(function () {
  'use strict';

  function mount(cfg) {
  cfg = cfg || {};
  const THEME = cfg.theme || 'tree';
  const LAYOUT = cfg.layout || (THEME === 'space' ? 'countryTree' : 'brandHubs');
  const API_NAME = cfg.apiName || (THEME === 'space' ? 'APOS_SPACE_MAP' : 'APOS_TREE_MAP');
  const READY_FLAG = cfg.readyFlag || (THEME === 'space' ? '__APOS_SPACE_READY__' : '__APOS_TREE_READY__');
  const TASK_UI = cfg.taskUi || (THEME === 'space' ? 'terminal' : 'modal');
  const DOM = Object.assign({
    stage: THEME === 'space' ? 'space-stage' : 'tree-stage',
    svg: THEME === 'space' ? '#space-svg' : '#tree-svg',
    world: THEME === 'space' ? 'space-world' : 'tree-world',
    labelLayer: 'label-layer',
    crumbList: 'crumb-list',
    leafCard: THEME === 'space' ? 'branch-card' : 'leaf-card',
    leafCardTitle: THEME === 'space' ? 'branch-card-title' : 'leaf-card-title',
    leafCardBody: THEME === 'space' ? 'branch-card-body' : 'leaf-card-body',
    leafCardTask: THEME === 'space' ? 'branch-card-task' : 'leaf-card-task',
    leafCardClose: THEME === 'space' ? 'branch-card-close' : 'leaf-card-close',
    taskOverlay: THEME === 'space' ? 'terminal-overlay' : 'task-overlay',
    taskClose: THEME === 'space' ? 'terminal-close' : 'task-close',
    taskSend: THEME === 'space' ? 'term-send' : 'task-send',
    taskAssignee: THEME === 'space' ? 'term-assignee' : 'task-assignee',
    taskDesc: THEME === 'space' ? 'term-task' : 'task-desc',
    taskLog: THEME === 'space' ? 'term-log' : 'task-log',
    tooltip: 'map-tooltip',
    dashboards: 'dashboards-view',
  }, cfg.dom || {});

  const DATA = window.APOS_SPACE_DATA;
  const BRANCHES = window.APOS_SPACE_BRANCHES;
  if (!DATA || !window.d3) {
    console.error('APOS Map Engine: missing data or d3');
    return null;
  }

  const UTILS = window.APOS_MAP_UTILS;
  const POLISH = window.APOS_MAP_POLISH;
  const reduceMotion = POLISH?.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THRESH = DATA.thresholds;
  const flyQuery = Number(new URLSearchParams(location.search).get('fly') || 0);
  const FLY_MS = reduceMotion ? 0 : (flyQuery > 0 ? flyQuery : 900);
  const PULL_MS = reduceMotion ? 0 : (flyQuery > 0 ? Math.max(120, Math.round(flyQuery * 0.62)) : 550);
  const CAM_LERP = reduceMotion ? 1 : 0.085;
  const GEMINI = true; // APOS Gemini-inspired camera / rings / reticle
  const FIT = 0.88;
  const RING_ACCENTS = ['teal', 'violet', 'rose', 'amber', 'sky'];
  const ALERT = '#ff6b7a';

  // World geometry — tree: compact brand ring; space: countries ~30% screen radius
  const R_HUB = LAYOUT === 'countryTree' ? 900 : 260;
  const HUB_SCREEN_R = 18;
  const NODE_SCREEN_R = 5.5;
  const NODE_R_BY_TYPE = { area: 7.2, location: 5.8, machine: 5.4, branch: 5.0, artic: 3.2, client: 7.2 };
  const DEEP_NODE_R = { area: 16, location: 15, machine: 15, branch: 14, artic: 5.5, client: 16 };
  const DEEP_HUB_R = 18;
  const TREE = LAYOUT === 'countryTree'
    ? {
        // First hop under country = brands (client uses area slot in typeDist)
        area: 380,
        location: 240,
        machine: 170,
        branch: 110,
      }
    : {
        area: 220,
        location: 170,
        machine: 130,
        branch: 92,
      };
  const FAN_TARGET_R = TREE.area + TREE.location + TREE.machine * 0.85;
  // Space titles sit just outside brand tips; keep R_TITLE tight so enterprise
  // fit can pin hubs at ~30% without maxK clamp eating the ring.
  const TITLE_PAD = LAYOUT === 'countryTree' ? 90 : 220;
  const R_TITLE = R_HUB + TREE.area + TITLE_PAD;
  const R_LABEL = R_HUB + TREE.area + TREE.location + TREE.machine + 44;
  const R_OUTER = R_LABEL + 20;
  // Core galaxy must stay inside the hub ring (world units)
  const CORE_WORLD_R = R_HUB * (LAYOUT === 'countryTree' ? 0.20 : 0.42);

  const LOD = {
    enterprise: { draw: 0.02, label: 0.05, labelMax: 2 },
    hub: { draw: 0.02, label: 0.05, labelMax: 8 },
    area: { draw: 0.05, label: 0.55, labelMax: 14 },
    location: { draw: 0.08, label: 0.65, labelMax: 18 },
    machine: { draw: 0.12, label: 3.4, labelMax: 40 },
    branch: { draw: 3.6, label: 5.0, labelMax: 48 },
    artic: { draw: 0.9, label: 99, labelMax: 99 },
  };

  const people = DATA.people;
  const nodes = [];
  const links = [];
  const articulations = []; // decorative mid-edge dots
  const nodeById = new Map();
  const childrenOf = new Map();
  const machines = [];
  const hubs = [];

  function addNode(n) {
    n.draw = true;
    n.preview = false;
    n.labelOn = false;
    n.lodAlpha = 1;
    nodes.push(n);
    nodeById.set(n.id, n);
    if (n.parentId) {
      if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
      childrenOf.get(n.parentId).push(n);
    }
  }

  function computeAlert(m) {
    return UTILS ? UTILS.computeAlert(m) : null;
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function countLeavesUnder(id) {
    const kids = (childrenOf.get(id) || []).filter((c) => !c.pad && c.type !== 'artic' && c.type !== 'branch');
    if (!kids.length) {
      const br = (childrenOf.get(id) || []).filter((c) => c.type === 'branch');
      return br.length ? br.length : 1;
    }
    return kids.reduce((s, c) => s + countLeavesUnder(c.id), 0);
  }

  /** Tidy d3.tree in a polar wedge per hub — no crossings, even sibling spacing */
  function layoutHubSector(hub, wedge) {
    function childDocs(id) {
      return (childrenOf.get(id) || [])
        .filter((c) => !c.pad && c.type !== 'artic')
        .map((c) => ({
          id: c.id,
          type: c.type,
          children: c.type === 'branch' ? undefined : childDocs(c.id),
        }));
    }
    const data = { id: hub.id, type: 'hub', children: childDocs(hub.id) };
    if (!data.children || !data.children.length) return;

    const root = d3.hierarchy(data);
    const leafN = Math.max(root.leaves().length, 1);
    const sep = Math.max(14, Math.min(28, (wedge * (R_HUB + TREE.area)) / leafN));
    d3.tree()
      .nodeSize([sep, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2))(root);

    const xs = root.descendants().map((d) => d.x);
    const x0 = d3.min(xs);
    const x1 = d3.max(xs);
    const xSpan = Math.max(x1 - x0, 1e-6);
    const typeDist = LAYOUT === 'countryTree'
      ? {
          client: TREE.area * 1.2,
          area: TREE.area + TREE.location * 0.55,
          location: TREE.area + TREE.location + TREE.machine * 0.35,
          machine: TREE.area + TREE.location + TREE.machine * 0.85,
          branch: TREE.area + TREE.location + TREE.machine + TREE.branch,
        }
      : {
          area: TREE.area,
          location: TREE.area + TREE.location * 0.9,
          machine: TREE.area + TREE.location + TREE.machine * 0.8,
          branch: TREE.area + TREE.location + TREE.machine + TREE.branch,
        };

    root.each((d) => {
      if (d.data.id === hub.id) return;
      const node = nodeById.get(d.data.id);
      if (!node) return;
      const t = (d.x - x0) / xSpan - 0.5;
      const ang = hub.outAngle + t * wedge;
      const dist = typeDist[node.type] || (d.depth / Math.max(root.height, 1)) * FAN_TARGET_R;
      node.x = hub.x + Math.cos(ang) * dist;
      node.y = hub.y + Math.sin(ang) * dist;
      node.angle = ang;
      node.labelOx = 0;
      node.labelOy = 16;
    });
  }

  /** Space overview: seat first-level brands on an even fan (≥40° apart). */
  function reseatCountryBrandFan(hub) {
    if (LAYOUT !== 'countryTree') return;
    const brands = (childrenOf.get(hub.id) || []).filter((c) => c.type === 'client' && !c.pad);
    if (brands.length < 2) return;
    const minGap = (72 * Math.PI) / 180;
    const fan = Math.max((brands.length - 1) * minGap, (156 * Math.PI) / 180);
    hub.wedge = Math.max(hub.wedge || 0, fan + 0.25);
    const brandDist = TREE.area * 1.62;
    const shiftTree = (id, dx, dy) => {
      (childrenOf.get(id) || []).forEach((c) => {
        c.x += dx;
        c.y += dy;
        shiftTree(c.id, dx, dy);
      });
    };
    brands.forEach((b, i) => {
      const t = brands.length === 1 ? 0.5 : i / (brands.length - 1);
      const ang = hub.outAngle - fan / 2 + t * fan;
      const nx = hub.x + Math.cos(ang) * brandDist;
      const ny = hub.y + Math.sin(ang) * brandDist;
      const dx = nx - b.x;
      const dy = ny - b.y;
      b.x = nx;
      b.y = ny;
      b.angle = ang;
      if (dx || dy) shiftTree(b.id, dx, dy);
    });
  }


  function addGeminiSignalArcs() {
    // Snapshot radial home for hex↔radial tween
    nodes.forEach((n) => {
      if (n.radialX == null) {
        n.radialX = n.x;
        n.radialY = n.y;
      }
    });
    // Curated overview signals: cross-brand only (never duplicate tree edges).
    // Max 3 calm cyan arcs. Drill signals added below.
    const overviewSignals = [];
    const alertByClient = new Map();
    machines.forEach((m) => {
      if (!m.alert || !m.clientId) return;
      alertByClient.set(m.clientId, (alertByClient.get(m.clientId) || 0) + 1);
    });
    const alertClients = [...alertByClient.keys()];
    // Pair adjacent alert brands under same country when possible
    hubs.forEach((h) => {
      const brands = (childrenOf.get(h.id) || []).filter(
        (c) => (c.type === 'client' || c.type === 'area') && alertByClient.has(c.id)
      );
      for (let i = 0; i + 1 < brands.length && overviewSignals.length < 3; i++) {
        overviewSignals.push({
          source: brands[i].id,
          target: brands[i + 1].id,
          kind: 'signal',
          soft: true,
          overview: true,
          cross: true,
        });
      }
    });
    // If still short, one cross-hub brand pair
    if (overviewSignals.length < 2 && alertClients.length >= 2) {
      overviewSignals.push({
        source: alertClients[0],
        target: alertClients[1],
        kind: 'signal',
        soft: true,
        overview: true,
        cross: true,
      });
    }
    overviewSignals.slice(0, 3).forEach((L) => links.push(L));

    // Drill-only: tech support ↔ alert machine (drawn only when both local)
    machines.forEach((m) => {
      if (!m.alert) return;
      const tech = nodeById.get(m.id + '::technical');
      if (tech) {
        links.push({ source: tech.id, target: m.id, kind: 'signal', drill: true });
      }
    });
  }
  function layoutAllHubTrees() {
    const weights = hubs.map((h) => {
      const n = countLeavesUnder(h.id);
      return Math.max(n, h.status === 'future' ? 2 : 3);
    });
    const total = d3.sum(weights) || 1;
    const gap = 0.1;
    const usable = Math.PI * 2 - hubs.length * gap;
    hubs.forEach((hub, i) => {
      const share = weights[i] / total;
      // Space countries with brands need a wide first-hop fan (≥40° between brands)
      const brandN = (childrenOf.get(hub.id) || []).filter((c) => c.type === 'client').length;
      const minBrandFan = brandN >= 2 ? (brandN - 1) * ((72 * Math.PI) / 180) + 0.35 : 0.5;
      const wedge = Math.max(0.5, minBrandFan, Math.min(2.55, share * usable));
      hub.wedge = wedge;
      layoutHubSector(hub, wedge);
      reseatCountryBrandFan(hub);
      const seatBranches = (n) => {
        const kids = childrenOf.get(n.id) || [];
        const brs = kids.filter((c) => c.type === 'branch');
        const parent = n.parentId ? nodeById.get(n.parentId) : null;
        // Symmetric ~200° fan around outward direction (machine.angle)
        const outward =
          n.angle != null
            ? n.angle
            : parent
              ? Math.atan2(n.y - parent.y, n.x - parent.x)
              : hub.outAngle;
        const sweep = (200 * Math.PI) / 180;
        const nB = Math.max(brs.length, 1);
        brs.forEach((b, bi) => {
          const ang = outward - sweep / 2 + ((bi + 0.5) / nB) * sweep;
          b.x = n.x + Math.cos(ang) * TREE.branch;
          b.y = n.y + Math.sin(ang) * TREE.branch;
          b.angle = ang;
        });
        kids.forEach((c) => {
          if (c.type !== 'branch') seatBranches(c);
        });
      };
      seatBranches(hub);
    });
  }

  /** Cubic Bézier control points — organic outward flow (no straight / zig) */
  function curveControls(s, t, kind) {
    const x1 = s.x;
    const y1 = s.y;
    const x2 = t.x;
    const y2 = t.y;
    const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
    // Gemini signal arcs: P1 = P0+(P0-core)*0.25, P2 = P3-(P3-core)*0.25
    if (kind === 'signal') {
      // core assumed at origin; mild inward bow, never looping
      const p1x = x1 + x1 * 0.25;
      const p1y = y1 + y1 * 0.25;
      const p2x = x2 - x2 * 0.25;
      const p2y = y2 - y2 * 0.25;
      return { c1x: p1x, c1y: p1y, c2x: p2x, c2y: p2y };
    }
    // Spine: gentle radial arc from core; tree: organic outward flow
    if (kind === 'spine' || s.type === 'enterprise') {
      const a = Math.atan2(y2, x2);
      return {
        c1x: x1 + Math.cos(a) * dist * 0.33,
        c1y: y1 + Math.sin(a) * dist * 0.33,
        c2x: x2 - Math.cos(a) * dist * 0.28,
        c2y: y2 - Math.sin(a) * dist * 0.28,
      };
    }
    // First hop from hub/country: gentle single arc (no overshoot loops)
    if (
      s.type === 'hub' || s.type === 'country' || s.type === 'enterprise' ||
      t.type === 'hub' || t.type === 'country'
    ) {
      return {
        c1x: x1 + (x2 - x1) * 0.35,
        c1y: y1 + (y2 - y1) * 0.35,
        c2x: x1 + (x2 - x1) * 0.7,
        c2y: y1 + (y2 - y1) * 0.7,
      };
    }
    const a1 = s.angle != null ? s.angle : Math.atan2(y1, x1);
    const a2 = t.angle != null ? t.angle : Math.atan2(y2 - y1, x2 - x1);
    return {
      c1x: x1 + Math.cos(a1) * dist * 0.4,
      c1y: y1 + Math.sin(a1) * dist * 0.4,
      c2x: x2 - Math.cos(a2) * dist * 0.35,
      c2y: y2 - Math.sin(a2) * dist * 0.35,
    };
  }

  function sampleCubic(x1, y1, c1x, c1y, c2x, c2y, x2, y2, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2;
      const y = u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2;
      pts.push([x, y]);
    }
    return pts;
  }

  function segmentsIntersect(a, b, c, d) {
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = cross(a, b, c);
    const d2 = cross(a, b, d);
    const d3 = cross(c, d, a);
    const d4 = cross(c, d, b);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return false;
  }

  /** Sample drawn tree curves; count improper crossings (non-adjacent links) */
  function countLabelLinkHits() {
    window.__LINK_HIT = null;
    const stageR = stage.getBoundingClientRect();
    const boxes = [];
    document.querySelectorAll('.hub-title, .hub-sub, .node-label-dom, .node-badge, .focus-title-main, .focus-title-sub').forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      if (Number.parseFloat(st.opacity || '1') < 0.2) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      boxes.push({
        l: r.left - stageR.left, t: r.top - stageR.top, r: r.right - stageR.left, b: r.bottom - stageR.top,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        badge: el.classList.contains('node-badge'),
      });
    });
    const pointIn = (p, b) => p.x > b.l + 1 && p.x < b.r - 1 && p.y > b.t + 1 && p.y < b.b - 1;
    let hits = 0;
    linkSampleCache = null;
    linkScreenSamples().forEach((p) => {
      const hitBox = boxes.find((b) => pointIn(p, b));
      if (hitBox) {
        if (hitBox.badge && p.link) {
          const ids = p.link.split('->');
          const ends = ids.map((id) => nodeById.get(id)).filter(Boolean).map((n) => worldToScreen(n.x, n.y));
          const cx = (hitBox.l + hitBox.r) / 2;
          const cy = (hitBox.t + hitBox.b) / 2;
          if (ends.some((e) => Math.hypot(cx - e.x, cy - e.y) < 72)) return;
        }
        hits += 1;
        window.__LINK_HIT = { link: p.link, text: hitBox.text, x: p.x, y: p.y };
      }
    });
    return hits;
  }

  function countLinkCrossings() {
    const segs = [];
    links.forEach((L) => {
      if (L.kind === 'spine' || L.kind === 'leaf') return;
      const s = nodeById.get(L.source);
      const t = nodeById.get(L.target);
      if (!s?.draw || !t?.draw || s.preview || t.preview) return;
      if (s.pad || t.pad) return;
      const { c1x, c1y, c2x, c2y } = curveControls(s, t, L.kind);
      const pts = sampleCubic(s.x, s.y, c1x, c1y, c2x, c2y, t.x, t.y, 8);
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], s: L.source, t: L.target });
      }
    });
    let crosses = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i];
        const B = segs[j];
        if (A.s === B.s || A.s === B.t || A.t === B.s || A.t === B.t) continue;
        if (segmentsIntersect(A.a, A.b, B.a, B.b)) crosses++;
      }
    }
    return crosses;
  }

  /**
   * Build 5–7 hubs: active area groups + brand/country futures.
   * Trees: area hub → locations → machines → (branches on zoom).
   */

  /** Space layout: country ring (Kuwait at top) → brand → area → site → machine → branches */
  function buildCountryTreeWorld(core) {
    const countries = (DATA.countries || []).slice();
    // Kuwait first (top of ring), then others
    countries.sort((a, b) => {
      if (a.id === 'country-kw') return -1;
      if (b.id === 'country-kw') return 1;
      return 0;
    });
    const n = Math.max(countries.length, 3);
    countries.forEach((country, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const isFuture = country.status === 'future';
      const hub = {
        id: country.id,
        type: 'country',
        label: country.label,
        bgLabel: (country.code || country.label).toUpperCase(),
        subtitle: isFuture ? '3 planned sites' : 'brands · sites · machines',
        status: isFuture ? 'future' : 'active',
        parentId: core.id,
        countryId: country.id,
        depth: 1,
        r: 6,
        ring: (UTILS && UTILS.HUB_ACCENT[country.id]) || RING_ACCENTS[i % RING_ACCENTS.length],
        outAngle: a,
        x: Math.cos(a) * R_HUB,
        y: Math.sin(a) * R_HUB,
        comingSoon: !!country.comingSoon,
        planned: !!country.planned,
        opsManagerId: country.opsManagerId,
      };
      addNode(hub);
      hubs.push(hub);
      links.push({ source: core.id, target: hub.id, kind: 'spine' });

      (country.clients || []).forEach((client) => {
        const cl = {
          id: client.id,
          type: 'client',
          label: client.label,
          brand: client.brand,
          status: client.status === 'future' || isFuture ? 'future' : 'active',
          parentId: hub.id,
          countryId: country.id,
          hubId: hub.id,
          clientId: client.id,
          depth: 2,
          r: 5.5,
          comingSoon: !!client.comingSoon,
          planned: !!client.planned,
        };
        addNode(cl);
        links.push({ source: hub.id, target: cl.id, kind: 'tree' });

        (client.areas || []).forEach((area) => {
          const ar = {
            id: area.id,
            type: 'area',
            label: area.label,
            areaManagerId: area.areaManagerId,
            parentId: cl.id,
            countryId: country.id,
            clientId: client.id,
            hubId: hub.id,
            depth: 3,
            status: cl.status,
            r: 5,
          };
          addNode(ar);
          links.push({ source: cl.id, target: ar.id, kind: 'tree' });

          (area.locations || []).forEach((loc) => {
            const ln = {
              id: loc.id,
              type: 'location',
              label: loc.label,
              address: loc.address,
              lat: loc.lat,
              lng: loc.lng,
              parentId: ar.id,
              countryId: country.id,
              clientId: client.id,
              areaId: area.id,
              hubId: hub.id,
              depth: 4,
              status: cl.status,
              r: 4.8,
            };
            addNode(ln);
            links.push({ source: ar.id, target: ln.id, kind: 'tree' });

            (loc.machines || []).forEach((m) => {
              const alert = computeAlert(m);
              const mn = {
                id: m.id,
                type: 'machine',
                label: m.label,
                model: m.model,
                status: m.status,
                offlineHours: m.offlineHours || 0,
                operatorId: m.operatorId,
                technicianId: m.technicianId,
                revenue: m.revenue,
                stock: m.stock,
                contract: m.contract,
                technical: m.technical,
                operators: m.operators,
                parentId: ln.id,
                countryId: country.id,
                clientId: client.id,
                areaId: area.id,
                locationId: loc.id,
                hubId: hub.id,
                depth: 5,
                r: 4.6,
                alert: !!alert,
                alertKind: alert,
                lastSeen: m.lastSeen || null,
                stale: !!m.stale,
              };
              addNode(mn);
              machines.push(mn);
              links.push({ source: ln.id, target: mn.id, kind: 'tree' });
            });
          });
        });
      });
    });

    // Pad to at least 3 ring seats if needed
    while (hubs.length < 3) {
      const i = hubs.length;
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
      const pad = {
        id: `country-pad-${i}`,
        type: 'country',
        label: 'SOON',
        bgLabel: 'SOON',
        subtitle: 'reserved',
        status: 'future',
        parentId: core.id,
        depth: 1,
        r: 5,
        ring: RING_ACCENTS[i % RING_ACCENTS.length],
        outAngle: a,
        x: Math.cos(a) * R_HUB,
        y: Math.sin(a) * R_HUB,
        pad: true,
      };
      addNode(pad);
      hubs.push(pad);
      links.push({ source: core.id, target: pad.id, kind: 'spine' });
    }

    layoutAllHubTrees();
    stretchKuwait(1.25);
    addGeminiSignalArcs();
    seedRollups();
  }

  /** Space overview: give the KW hub 25% more radius so its label, subtitle, and badge clear the stems. */
  function stretchKuwait(factor) {
    if (LAYOUT !== 'countryTree') return;
    const hub = nodeById.get('country-kw');
    if (!hub || !factor || factor === 1) return;
    const dx = hub.x * (factor - 1);
    const dy = hub.y * (factor - 1);
    const shiftKids = (id) => {
      (childrenOf.get(id) || []).forEach((c) => {
        c.x += dx;
        c.y += dy;
        shiftKids(c.id);
      });
    };
    shiftKids(hub.id);
    hub.x += dx;
    hub.y += dy;
  }

  function buildWorld() {
    nodes.length = 0;
    links.length = 0;
    articulations.length = 0;
    nodeById.clear();
    childrenOf.clear();
    machines.length = 0;
    hubs.length = 0;

    const core = {
      id: DATA.enterprise.id,
      type: 'enterprise',
      label: 'APOS',
      status: 'active',
      parentId: null,
      depth: 0,
      r: 8,
      x: 0,
      y: 0,
    };
    addNode(core);

    if (LAYOUT === 'countryTree') {
      buildCountryTreeWorld(core);
      return;
    }

    const hubDefs = [];
    const kw = DATA.countries.find((c) => c.id === 'country-kw');
    // Brand hubs: Leet, EE, Park (dim) — keep brand ids for drill/tests
    (kw?.clients || []).forEach((client) => {
      const areas = client.areas || [];
      const isFuture = client.status === 'future' || !areas.length;
      hubDefs.push({
        id: client.id,
        label: client.label.toUpperCase(),
        subtitle: client.comingSoon
          ? 'coming soon'
          : isFuture
            ? 'testing zone'
            : (client.brand || client.label).toLowerCase() + ' · sites · machines',
        status: client.status === 'future' ? 'future' : 'active',
        areas,
        clientId: client.id,
        countryId: kw.id,
        bgLabel: client.label.toUpperCase(),
        comingSoon: !!client.comingSoon,
        planned: !!client.planned,
      });
    });
    DATA.countries
      .filter((c) => c.status === 'future')
      .forEach((c) => {
        hubDefs.push({
          id: c.id,
          label: c.label.toUpperCase(),
          subtitle: c.planned ? 'planned market' : 'future market',
          status: 'future',
          areas: [],
          clientId: null,
          countryId: c.id,
          bgLabel: (c.code || c.label).toUpperCase(),
          planned: !!c.planned,
        });
      });

    // If fewer than 5 hubs, split active brands into area groups (5–7 like the video)
    let list = hubDefs.slice();
    if (list.length < 5) {
      const expanded = [];
      list.forEach((def) => {
        if (def.status === 'active' && def.areas.length > 1 && expanded.length + list.length < 7) {
          def.areas.forEach((area) => {
            expanded.push({
              id: area.id,
              label: area.label.toUpperCase(),
              subtitle: `${def.label} · sites`,
              status: 'active',
              areas: [area],
              clientId: def.clientId,
              countryId: def.countryId,
              bgLabel: area.label.toUpperCase(),
              areaHub: true,
            });
          });
        } else {
          expanded.push(def);
        }
      });
      list = expanded;
    }
    list = list.slice(0, 7);
    while (list.length < 5) {
      list.push({
        id: `hub-pad-${list.length}`,
        label: 'SOON',
        subtitle: 'reserved',
        status: 'future',
        areas: [],
        clientId: null,
        countryId: null,
        bgLabel: 'SOON',
      });
    }

    const nHub = list.length;
    list.forEach((def, i) => {
      const a = -Math.PI / 2 + (i / nHub) * Math.PI * 2;
      const hub = {
        id: def.id,
        type: 'hub',
        label: def.label,
        subtitle: def.subtitle,
        bgLabel: def.bgLabel,
        status: def.status,
        parentId: core.id,
        countryId: def.countryId,
        clientId: def.clientId,
        depth: 1,
        r: 6,
        ring: (UTILS && UTILS.HUB_ACCENT[def.id]) || RING_ACCENTS[i % RING_ACCENTS.length],
        outAngle: a,
        x: Math.cos(a) * R_HUB,
        y: Math.sin(a) * R_HUB,
        comingSoon: !!def.comingSoon,
        planned: !!def.planned,
      };
      addNode(hub);
      hubs.push(hub);
      links.push({ source: core.id, target: hub.id, kind: 'spine' });

      // Future hubs: 2–3 labelled stub areas only (hint of depth, no fake deep trees)
      if ((def.status === 'future' || def.planned) && !def.areas.length) {
        hub.subtitle = '3 planned sites';
        const id = `planned-sites-${def.id}`;
        addNode({
          id,
          type: 'area',
          label: '3 planned sites',
          parentId: hub.id,
          hubId: hub.id,
          depth: 2,
          status: 'future',
          planned: true,
          summary: true,
          r: NODE_SCREEN_R,
        });
        links.push({ source: hub.id, target: id, kind: 'tree' });
        return;
      }

      def.areas.forEach((area) => {
        const locs = area.locations || [];
        let areaNode = hub;
        if (!def.areaHub) {
          areaNode = {
            id: area.id,
            type: 'area',
            label: area.label,
            parentId: hub.id,
            hubId: hub.id,
            clientId: def.clientId,
            countryId: def.countryId,
            depth: 2,
            status: def.status === 'future' ? 'future' : 'active',
            r: NODE_SCREEN_R,
          };
          addNode(areaNode);
          links.push({ source: hub.id, target: area.id, kind: 'tree' });
        }

        locs.forEach((loc) => {
          const ln = {
            id: loc.id,
            type: 'location',
            label: loc.label,
            parentId: def.areaHub ? hub.id : area.id,
            hubId: hub.id,
            areaId: area.id,
            clientId: def.clientId,
            countryId: def.countryId,
            depth: def.areaHub ? 2 : 3,
            status: def.status === 'future' ? 'future' : 'active',
            r: NODE_SCREEN_R,
            address: loc.address,
          };
          addNode(ln);
          links.push({ source: ln.parentId, target: loc.id, kind: 'tree' });

          (loc.machines || []).forEach((m) => {
            const mn = {
              id: m.id,
              type: 'machine',
              label: m.label,
              parentId: loc.id,
              hubId: hub.id,
              locationId: loc.id,
              areaId: area.id,
              clientId: def.clientId,
              countryId: def.countryId,
              depth: ln.depth + 1,
              status: m.status,
              offlineHours: m.offlineHours || 0,
              operatorId: m.operatorId,
              technicianId: m.technicianId,
              revenue: m.revenue,
              stock: m.stock,
              contract: m.contract,
              technical: m.technical,
              operators: m.operators,
              model: m.model,
              lastSeen: m.lastSeen || null,
              stale: !!m.stale,
              r: NODE_SCREEN_R * 0.9,
            };
            mn.alert = computeAlert(mn);
            addNode(mn);
            machines.push(mn);
            links.push({ source: loc.id, target: m.id, kind: 'tree' });
          });
        });
      });

      // Mark areas with collapsed-child hints for overview stubs
      (childrenOf.get(hub.id) || []).forEach((area) => {
        if (area.type !== 'area') return;
        const locs = (childrenOf.get(area.id) || []).filter((c) => c.type === 'location' && !c.pad);
        area.stubHint = Math.min(3, locs.length);
      });
    });

    // Tidy polar layout per hub (replaces fan/zig/pad)
    layoutAllHubTrees();
    addGeminiSignalArcs();

    // Roll up alerts onto sites / areas / hubs + machine counts for overview depth clusters
    function countMachinesUnder(id) {
      let n = 0;
      const walk = (nid) => {
        (childrenOf.get(nid) || []).forEach((c) => {
          if (c.pad) return;
          if (c.type === 'machine') n += 1;
          else if (c.type !== 'branch' && c.type !== 'artic') walk(c.id);
        });
      };
      walk(id);
      return n;
    }
    nodes.forEach((n) => {
      if (n.type === 'machine' || n.type === 'branch' || n.type === 'artic' || n.pad) return;
      n.machineCount = countMachinesUnder(n.id);
    });
    seedRollups();
  }

  function seedRollups() {
    machines.forEach((m) => {
      if (m._baseStatus == null) m._baseStatus = m.status;
      if (m._baseOfflineHours == null) m._baseOfflineHours = m.offlineHours || 0;
      if (m.stock && m._baseFill == null) m._baseFill = m.stock.fillPct;
      m.alertCount = m.alert ? 1 : 0;
    });
    if (!UTILS) return;
    nodes.forEach((n) => {
      if (n.type === 'machine' || n.type === 'branch' || n.type === 'artic' || n.pad) return;
      const r = UTILS.rollup(n, childrenOf);
      n.alertCount = r.alerts;
      n.rollup = r;
      n._pill0 = r.alerts > 0;
    });
  }

  // ——— DOM ———
  const stage = document.getElementById(DOM.stage);
  const svg = d3.select(DOM.svg);
  const particleCanvas = document.getElementById(DOM.world) || document.getElementById('tree-particles') || document.getElementById('starfield');
  const crumbList = document.getElementById(DOM.crumbList);
  const leafCard = document.getElementById(DOM.leafCard);
  const taskOverlay = document.getElementById(DOM.taskOverlay);

  let gRoot;
  let gBg;
  let gLinks;
  let gArts;
  let gNodes;
  let zoomBehavior;
  let transform = d3.zoomIdentity;
  let flying = false;
  let targetTransform = null;
  let focusPinned = false;
  let hoverId = null;
  /** Breadcrumb hover — highlight that ancestor + its path link toward APOS */
  let crumbHoverId = null;
  let layoutMode = 'radial';
  let layoutTween = null;
  let rootPathIds = new Set();
  let focusNodeId = DATA.enterprise.id;
  /** Edge chip toward off-screen APOS (screen coords); null when core is on-screen */
  let aposEdgeHint = null;
  /** Live motion — screen-space only. Never writes node.x/y (framing stays stable). */
  let filterMode = 'all';
  let filterHot = new Set();
  let pointerNX = 0;
  let pointerNY = 0;
  let pageHidden = false;
  let revealT0 = 0;
  let panVx = 0;
  let panVy = 0;
  let panStamp = 0;
  let lastPX = null;
  let lastPY = null;
  let inertia = null;
  let inertiaPan = false;
  const ripples = [];
  const flowEvents = [];
  const liveLog = [];
  const frameSamples = [];
  const cubicCache = new Map();
  /** At overview: all hubs expanded. On drill: only clicked path. */
  let expandedPath = new Set();
  let overviewMode = true;
  let openBranchId = null;

  function allHubIds() {
    return hubs.map((h) => h.id);
  }

  function restoreLayoutHomes() {
    nodes.forEach((n) => {
      if (n._homeX == null) return;
      n.x = n._homeX;
      n.y = n._homeY;
      n._homeX = null;
      n._homeY = null;
    });
  }

  function rememberHome(n) {
    if (!n || n._homeX != null) return;
    n._homeX = n.x;
    n._homeY = n.y;
  }

  /** Pull a machine's site and sibling machines into the usable frame so the focus never floats alone. */
  function applyMachineCluster(focus) {
    restoreLayoutHomes();
    if (!focus || focus.type !== 'machine') return;
    const parent = nodeById.get(focus.parentId);
    if (!parent) return;
    const sibs = (childrenOf.get(parent.id) || []).filter((c) => c.type === 'machine' && c.id !== focus.id);
    const fit = viewportFitRect({ reserveDrawer: true });
    const k = 2.5;
    const halfW = (fit.w * 0.36) / k;
    const halfH = (fit.h * 0.36) / k;
    const pull = (n, ang, dist) => {
      if (!n) return;
      const dx = n.x - focus.x;
      const dy = n.y - focus.y;
      if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) return;
      rememberHome(n);
      const r = Math.min(dist, halfW * 0.9, halfH * 0.9);
      n.x = focus.x + Math.cos(ang) * r;
      n.y = focus.y + Math.sin(ang) * r;
    };
    pull(parent, -2.4, 52);
    sibs.forEach((s, i) => pull(s, -0.35 + i * 0.62, 68));
  }

  function setOverviewExpansion() {
    restoreLayoutHomes();
    // Overview: inspector stays closed
    const _insp = document.getElementById('inspector-drawer');
    if (_insp) _insp.classList.remove('is-open');
    document.body.classList.remove('inspector-open');
    if (stage) stage.classList.remove('inspector-open');

    overviewMode = true;
    // Progressive: core + ring hubs/countries + first-level children only
    expandedPath = new Set([DATA.enterprise.id, ...allHubIds()]);
    hubs.forEach((h) => {
      (childrenOf.get(h.id) || []).forEach((c) => {
        if (c.pad) return;
        if (LAYOUT === 'countryTree') {
          if (c.type === 'client') expandedPath.add(c.id);
        } else if (c.type === 'area') {
          expandedPath.add(c.id);
        }
      });
    });
    focusNodeId = DATA.enterprise.id;
    // Deterministic overview: clear transient grow / label caches so pan/zoom
    // stress returns to the identical label layout.
    nodes.forEach((n) => {
      n.grow = 1;
      n._labelSx = undefined;
      n._labelSy = undefined;
      n._labelAng = undefined;
      n.labelOx = 0;
      n.labelOy = 18;
    });
  }

  function setExpandedTo(nodeId) {
    restoreLayoutHomes();
    overviewMode = false;
    expandedPath = new Set(pathToRoot(nodeId));
    focusNodeId = nodeId;
    const focus = nodeById.get(nodeId);
    if (!focus) return;

    // Progressive disclosure by depth
    if (focus.type === 'hub' || focus.type === 'country') {
      (childrenOf.get(focus.id) || []).forEach((ch) => {
        if (ch.pad || ch.type === 'branch') return;
        expandedPath.add(ch.id);
        // hub→area→location  OR  country→client→area
        (childrenOf.get(ch.id) || []).forEach((g) => {
          if (g.pad || g.type === 'branch') return;
          if (focus.type === 'hub' && g.type === 'location') expandedPath.add(g.id);
          if (focus.type === 'country' && (g.type === 'area' || g.type === 'client')) expandedPath.add(g.id);
        });
      });
    } else if (focus.type === 'client') {
      (childrenOf.get(focus.id) || []).forEach((area) => {
        if (!area.pad && area.type === 'area') {
          expandedPath.add(area.id);
          (childrenOf.get(area.id) || []).forEach((loc) => {
            if (!loc.pad && loc.type === 'location') expandedPath.add(loc.id);
          });
        }
      });
    } else if (focus.type === 'area') {
      (childrenOf.get(focus.id) || []).forEach((loc) => {
        if (!loc.pad && loc.type !== 'branch') expandedPath.add(loc.id);
      });
    } else if (focus.type === 'location') {
      (childrenOf.get(focus.id) || []).forEach((m) => {
        if (m.type === 'machine') expandedPath.add(m.id);
      });
      // keep sibling sites under same area
      if (focus.parentId) {
        (childrenOf.get(focus.parentId) || []).forEach((sib) => {
          if (sib.type === 'location' && !sib.pad) expandedPath.add(sib.id);
        });
      }
    } else if (focus.type === 'machine') {
      (childrenOf.get(focus.id) || []).forEach((b) => {
        if (b.type === 'branch') expandedPath.add(b.id);
      });
      // sibling machines under same site
      if (focus.parentId) {
        (childrenOf.get(focus.parentId) || []).forEach((sib) => {
          if (sib.type === 'machine') expandedPath.add(sib.id);
        });
      }
    }

    // Sibling hubs stay in path (muted peek of their orbs only — areas via neighbor rule)
    if (focus.type === 'hub' && focus.parentId) {
      (childrenOf.get(focus.parentId) || []).forEach((sib) => {
        if (sib.type === 'hub') expandedPath.add(sib.id);
      });
    }
    if (focus.type === 'machine') applyMachineCluster(focus);
  }

  function pathToRoot(id) {
    const path = [];
    let cur = nodeById.get(id);
    while (cur) {
      path.push(cur.id);
      cur = cur.parentId ? nodeById.get(cur.parentId) : null;
    }
    return path;
  }

  function hoverRelatedIds(id) {
    const set = new Set(pathToRoot(id));
    const n = nodeById.get(id);
    if (!n) return set;
    (childrenOf.get(id) || []).forEach((c) => set.add(c.id));
    links.forEach((L) => {
      if (L.kind !== 'signal') return;
      if (L.source === id || L.target === id || set.has(L.source) || set.has(L.target)) {
        set.add(L.source);
        set.add(L.target);
      }
    });
    // Hub/country hover: include whole country tree + soft signal ends
    if (n.type === 'hub' || n.type === 'country') {
      nodes.forEach((x) => {
        if (x.hubId === n.id || x.countryId === n.id) set.add(x.id);
      });
    }
    if (n.type === 'client') {
      nodes.forEach((x) => {
        if (x.clientId === n.id) set.add(x.id);
      });
    }
    return set;
  }

  function initSvg() {
    svg.selectAll('*').remove();
    gRoot = svg.append('g').attr('class', 'viewport');
    gBg = gRoot.append('g').attr('class', 'bg-labels');
    gLinks = gRoot.append('g').attr('class', 'links');
    gArts = gRoot.append('g').attr('class', 'arts');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.12, 80])
      .filter((event) => {
        if (event.type === 'dblclick') return false;
        if (event.type === 'wheel') return true;
        return !event.ctrlKey && !event.button;
      })
      .on('start', () => {
        inertia = null;
        lastPX = null;
        lastPY = null;
        panVx = 0;
        panVy = 0;
      })
      .on('zoom', (event) => {
        // Gemini: user input updates target; display lerps toward it each frame
        targetTransform = event.transform;
        if (!GEMINI || flying || reduceMotion) {
          transform = event.transform;
          gRoot.attr('transform', transform);
        }
        const src = event.sourceEvent;
        const isPan = inertiaPan || !!(src && (src.type === 'mousemove' || src.type === 'pointermove' || src.type === 'touchmove'));
        if (isPan && src && src.clientX != null) {
          const now = performance.now();
          if (lastPX != null) {
            const dt = Math.max(8, now - panStamp);
            panVx = (src.clientX - lastPX) / dt;
            panVy = (src.clientY - lastPY) / dt;
          }
          lastPX = src.clientX;
          lastPY = src.clientY;
          panStamp = now;
        } else if (!inertiaPan) {
          panVx = 0;
          panVy = 0;
        }
        // Never collapse focus while a programmatic fly is writing the transform
        if (!flying) reconcileViewState(isPan ? 'pan' : 'zoom');
        applyLod();
        applyLabelCounterScale();
        updateBreadcrumbFromView();
      })
      .on('end', (event) => {
        if (reduceMotion || flying) return;
        const src = event.sourceEvent;
        const up = src && (src.type === 'pointerup' || src.type === 'mouseup' || src.type === 'touchend');
        if (!up) return;
        if (Math.hypot(panVx, panVy) < 0.18) return;
        inertia = { vx: panVx * 16, vy: panVy * 16 };
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', (e) => {
      e.preventDefault();
      const cur = nodeById.get(focusNodeId);
      if (cur) drillDeeper(cur);
    });
    svg.on('contextmenu', (e) => {
      e.preventDefault();
      flyOut();
    });
  }

  function nodeScreenDistToCenter(n) {
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    return Math.hypot(n.x * transform.k + transform.x - cx, n.y * transform.k + transform.y - cy);
  }

  
  function syncHubTitles() {
    linkSampleCache = null;
    const layer = document.getElementById(DOM.labelLayer);
    if (!layer) return;
    let root = layer.querySelector('.hub-titles');
    if (!root) {
      root = document.createElement('div');
      root.className = 'hub-titles';
      layer.appendChild(root);
    }
    const focus = nodeById.get(focusNodeId);
    const focusHubId = focus?.type === 'hub' ? focus.id : focus?.hubId;
    hubs.forEach((h) => {
      let el = root.querySelector(`[data-hub="${h.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.dataset.hub = h.id;
        el.className = 'hub-title-wrap';
        el.innerHTML = `<div class="hub-title"></div><div class="hub-sub"></div>`;
        root.appendChild(el);
      }
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = '0';
      el.style.height = '0';
      el.style.overflow = 'visible';
      el.style.pointerEvents = 'none';
      const title = el.querySelector('.hub-title');
      const sub = el.querySelector('.hub-sub');
      const focused = !overviewMode && (focusHubId === h.id || focusNodeId === h.id);
      title.textContent = h.bgLabel || h.label;
      title.className = `hub-title hub-title-dom ${h.ring || ''} ${focused ? 'is-focus' : ''} ${overviewMode ? '' : (focused ? '' : 'muted')}`;
      sub.textContent = h.subtitle || '';
      sub.className = 'hub-sub';
      // Overview: planned countries → titles outside; active with brands → title
      // sits inward of the hub (toward core) so it never fights brand labels.
      // Hex: titles sit on the cell (equal planned AE/SA cells stay in the cluster).
      // Focus: under orb along inward radial.
      let wx, wy;
      const inward = h.outAngle + Math.PI;
      const sideAng = h.outAngle + Math.PI / 2;
      const brands = (childrenOf.get(h.id) || []).filter((c) => c.type === 'client' && c.draw && c.label);
      const titleInward = overviewMode && layoutMode !== 'hex' && brands.length > 0 && h.status !== 'future';
      if (layoutMode === 'hex' && overviewMode) {
        // Label under the occupied cell centre
        wx = h.x;
        wy = h.y + 42;
      } else if (focused) {
        // Opposite the children, then swing until the title block misses their links.
        const kids = (childrenOf.get(h.id) || []).filter((c) => c.draw && !c.pad);
        let fx = 0;
        let fy = 0;
        kids.forEach((c) => { fx += c.x - h.x; fy += c.y - h.y; });
        let ang = kids.length ? Math.atan2(-fy, -fx) : h.outAngle + Math.PI;
        const blocksSpoke = (a) => {
          const tx = h.x + Math.cos(a) * 96;
          const ty = h.y + Math.sin(a) * 96;
          return kids.some((c) => {
            const mx = (h.x + c.x) / 2;
            const my = (h.y + c.y) / 2;
            return Math.hypot(tx - mx, ty - my) < 70 || Math.hypot(tx - c.x, ty - c.y) < 54;
          });
        };
        if (blocksSpoke(ang)) {
          for (let step = 1; step <= 8; step++) {
            const delta = step * 0.35;
            if (!blocksSpoke(ang + delta)) { ang += delta; break; }
            if (!blocksSpoke(ang - delta)) { ang -= delta; break; }
          }
        }
        wx = h.x + Math.cos(ang) * 96;
        wy = h.y + Math.sin(ang) * 96;
      } else if (titleInward) {
        wx = h.x + Math.cos(inward) * 110;
        wy = h.y + Math.sin(inward) * 110;
      } else {
        const titleR = R_TITLE;
        wx = Math.cos(h.outAngle) * titleR;
        wy = Math.sin(h.outAngle) * titleR;
      }
      const s = worldToScreen(wx, wy);
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      const ax = Math.cos(h.outAngle);
      const ay = Math.sin(h.outAngle);
      if (layoutMode === 'hex' && overviewMode) {
        let tx = Math.max(56, Math.min(stage.clientWidth - 56, s.x));
        let ty = Math.max(40, Math.min(stage.clientHeight - 40, s.y));
        title.style.left = `${tx}px`;
        title.style.top = `${ty}px`;
        title.style.transform = 'translate(-50%, -50%)';
        sub.style.left = `${tx}px`;
        sub.style.top = `${ty + 18}px`;
        sub.style.transform = 'translate(-50%, 0)';
        // Planned AE/SA: dim equal cells — keep subtitle "planned"
        if (h.status === 'future' || h.planned) {
          sub.textContent = 'planned';
          title.style.opacity = '0.72';
          sub.style.opacity = '0.55';
        }
      } else if (!focused) {
        let tx = s.x;
        let ty = s.y;
        const areas = (childrenOf.get(h.id) || []).filter((c) => (c.type === 'area' || c.type === 'client') && c.draw && c.label);
        // Shift off the stem first, then walk outward until title AND subtitle
        // clear area/brand labels (a post-shift would land the subtitle on them).
        const side = titleInward ? 188 : 86;
        const perpX = titleInward ? Math.cos(sideAng) : -ay;
        const perpY = titleInward ? Math.sin(sideAng) : ax;
        tx += perpX * side;
        ty += perpY * side;
        const labelPts = [];
        nodes.forEach((n) => {
          if (!n.labelOn || !n.draw || n._labelSx == null) return;
          labelPts.push({ x: n._labelSx, y: n._labelSy, clear: n.type === 'client' ? 64 : 46 });
        });
        let push = titleInward ? 0 : 18;
        for (let guard = 0; guard < 10; guard++) {
          const px = tx + ax * push;
          const py = ty + ay * push;
          const spots = [{ x: px, y: py }, { x: px, y: py + 36 }];
          let hit = false;
          spots.forEach((spot) => {
            areas.forEach((a) => {
              const ap = worldToScreen(a.x, a.y);
              const lab = a._labelSx != null ? { x: a._labelSx, y: a._labelSy } : ap;
              const clear = a.type === 'client' ? 56 : 42;
              if (Math.hypot(spot.x - ap.x, spot.y - ap.y) < 36) hit = true;
              if (Math.hypot(spot.x - lab.x, spot.y - lab.y) < clear) hit = true;
            });
            labelPts.forEach((lab) => {
              if (Math.hypot(spot.x - lab.x, spot.y - lab.y) < lab.clear) hit = true;
            });
          });
          if (!hit) break;
          push += 16;
        }
        tx += ax * push;
        ty += ay * push;
        if (overviewMode || focused) {
          tx = Math.max(56, Math.min(stage.clientWidth - 56, tx));
          ty = Math.max(40, Math.min(stage.clientHeight - 40, ty));
        }
        title.style.left = `${tx}px`;
        title.style.top = `${ty}px`;
        title.style.transform = 'translate(-50%, -50%)';
        sub.style.left = `${tx}px`;
        sub.style.top = `${ty + 36}px`;
        sub.style.transform = 'translate(-50%, 0)';
      } else {
        title.style.left = `${s.x}px`;
        title.style.top = `${s.y}px`;
        title.style.transform = 'translate(-50%, 0)';
        sub.style.left = `${s.x}px`;
        sub.style.top = `${s.y + 58}px`;
        sub.style.transform = 'translate(-50%, 0)';
      }
      // Keep hub titles on path / dimmed context while drilled (never blank the relation to APOS)
      const onPath = !overviewMode && focus && pathToRoot(focusNodeId).includes(h.id);
      let op;
      if (overviewMode) {
        op = h.status === 'future' ? 0.72 : 1;
      } else if (focused || onPath) {
        op = h.status === 'future' ? 0.75 : 1;
      } else if (contextRestoreT() < 0.22) {
        op = 0;
      } else {
        op = 0.15 + 0.85 * contextRestoreT();
      }
      el.style.opacity = String(op);
      title.style.opacity = String(op);
      sub.style.opacity = String(op);
      el.style.display = (h.draw === false || op < 0.05) ? 'none' : '';
      if (op >= 0.2 && layoutMode !== 'hex') shiftHubChrome(title, sub, ax, ay);
    });
    separateBadgesFromTitles();
  }

  let linkSampleCache = null;
  function linkScreenSamples() {
    if (linkSampleCache) return linkSampleCache;
    const pts = [];
    links.forEach((L) => {
      if (L.kind === 'signal') return;
      const s = nodeById.get(L.source);
      const t = nodeById.get(L.target);
      if (!s?.draw || !t?.draw || s.ghost || t.ghost || (s.lodAlpha || 0) < 0.2 || (t.lodAlpha || 0) < 0.2) return;
      const cc = curveControls(s, t, L.kind);
      const a = worldToScreen(s.x, s.y);
      const b = worldToScreen(t.x, t.y);
      sampleCubic(s.x, s.y, cc.c1x, cc.c1y, cc.c2x, cc.c2y, t.x, t.y, 14).forEach((p) => {
        const q = worldToScreen(p[0], p[1]);
        if (Math.hypot(q.x - a.x, q.y - a.y) < 22 || Math.hypot(q.x - b.x, q.y - b.y) < 22) return;
        pts.push({ x: q.x, y: q.y, link: `${L.source}->${L.target}` });
      });
    });
    linkSampleCache = pts;
    return pts;
  }

  /** Walk the hub title until its real box misses labels and spokes. */
  function shiftHubChrome(title, sub, ax, ay) {
    const stageR = stage.getBoundingClientRect();
    const samples = linkScreenSamples();
    const boxOf = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - stageR.left, t: r.top - stageR.top, r: r.right - stageR.left, b: r.bottom - stageR.top, w: r.width, h: r.height };
    };
    const offender = () => {
      const boxes = [title, sub].map(boxOf).filter((b) => b.w > 2 && b.h > 2);
      const labels = [];
      document.querySelectorAll('.node-label-dom, .node-badge').forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || Number.parseFloat(st.opacity || '1') < 0.2) return;
        const b = boxOf(el);
        if (b.w > 2) labels.push(b);
      });
      let best = null;
      let bestD = 1e9;
      boxes.forEach((b) => {
        const cx = (b.l + b.r) / 2;
        const cy = (b.t + b.b) / 2;
        labels.forEach((q) => {
          if (!(b.l < q.r - 1 && b.r > q.l + 1 && b.t < q.b - 1 && b.b > q.t + 1)) return;
          const qx = (q.l + q.r) / 2;
          const qy = (q.t + q.b) / 2;
          const d = Math.hypot(cx - qx, cy - qy);
          if (d < bestD) { bestD = d; best = { x: qx, y: qy, cx, cy }; }
        });
        samples.forEach((p) => {
          if (!(p.x > b.l - 6 && p.x < b.r + 6 && p.y > b.t - 6 && p.y < b.b + 6)) return;
          const d = Math.hypot(cx - p.x, cy - p.y);
          if (d < bestD) { bestD = d; best = { x: p.x, y: p.y, cx, cy }; }
        });
      });
      return best;
    };
    for (let g = 0; g < 12; g++) {
      const hit = offender();
      if (!hit) break;
      let dx = hit.cx - hit.x;
      let dy = hit.cy - hit.y;
      const mag = Math.hypot(dx, dy) || 1;
      dx = (dx / mag) * 18;
      dy = (dy / mag) * 18;
      if (mag < 8) { dx = -ay * 22; dy = ax * 22; }
      const lx = parseFloat(title.style.left) || 0;
      const ty = parseFloat(title.style.top) || 0;
      const sy = parseFloat(sub.style.top) || 0;
      title.style.left = `${lx + dx}px`;
      title.style.top = `${ty + dy}px`;
      sub.style.left = `${lx + dx}px`;
      sub.style.top = `${sy + dy}px`;
    }
  }

  /** Context opacity rises as the user zooms out — every frame, no settle delay. */
  function contextRestoreT() {
    if (overviewMode) return 1;
    const zk = transform.k || 1;
    // Below ~1.2k start restoring; by overview floor (~0.62) fully restored
    const hi = 1.25;
    const lo = 0.62;
    if (zk >= hi) return 0;
    if (zk <= lo) return 1;
    return (hi - zk) / (hi - lo);
  }

  function applyLod() {
    const focus = nodeById.get(focusNodeId);
    const focusPath = new Set(pathToRoot(focusNodeId));
    const focusHubId = (focus?.type === 'hub' || focus?.type === 'country')
      ? focus.id
      : (focus?.hubId || focus?.countryId || null);
    const restore = contextRestoreT();
    const dimNode = 0.25 + 0.75 * restore;

    nodes.forEach((n) => {
      n.preview = false;
      n.ghost = false;
      n.labelOx = n.labelOx || 0;
      n.labelOy = n.labelOy || 18;
      n.ancestorOnly = false;
      n.collapsedCount = 0;

      if (n.pad || n.type === 'artic') {
        n.draw = false;
        n.lodAlpha = 0;
        n.labelOn = false;
        return;
      }

      // ——— Overview ———
      if (overviewMode) {
        if (n.type === 'enterprise') {
          n.draw = true;
          n.lodAlpha = 1;
          n.labelOn = false;
          return;
        }
        if (n.type === 'hub' || n.type === 'country') {
          n.draw = true;
          n.lodAlpha = n.status === 'future' ? 0.7 : 1;
          n.labelOn = false;
          return;
        }
        if (layoutMode === 'hex') {
          const hexSeat = n.type === 'client' && expandedPath.has(n.id);
          n.draw = hexSeat;
          n.lodAlpha = hexSeat ? (n.status === 'future' || n.comingSoon ? 0.45 : 1) : 0;
          n.labelOn = hexSeat && !!n.label;
          return;
        }
        const overviewLeaf = (n.type === 'area' || n.type === 'client') && expandedPath.has(n.id);
        if (overviewLeaf) {
          n.draw = true;
          n.lodAlpha = n.status === 'future' || n.comingSoon ? 0.5 : 1;
          n.labelOn = !!n.label;
        } else {
          n.draw = false;
          n.lodAlpha = 0;
          n.labelOn = false;
        }
        return;
      }

      // ——— Drilled: never hide context — dim it; ancestor path always bright ———
      const onPath = focusPath.has(n.id);
      const isFocus = n.id === focus.id;
      const isChild = n.parentId === focus.id;

      // APOS core always present (edge-indicated when off-screen)
      if (n.type === 'enterprise') {
        n.draw = true;
        n.lodAlpha = 0.9;
        n.labelOn = false;
        return;
      }

      n.ghost = false;
      if (focus?.type === 'machine') {
        const siteId = focus.parentId;
        const localGhost = n.id === siteId || (n.type === 'machine' && n.parentId === siteId && n.id !== focus.id);
        if (localGhost) {
          n.draw = true;
          n.ghost = true;
          n.preview = true;
          n.lodAlpha = 0.2;
          n.labelOn = false;
          return;
        }
        if (onPath && n.id !== focus.id) {
          n.draw = true;
          n.lodAlpha = 0.04;
          n.labelOn = false;
          return;
        }
      }
      // Focus path ancestors + focus: bright continuous chain
      if (onPath) {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? 0.45 : 1;
        if (isFocus || n.type === 'hub' || n.type === 'country') n.labelOn = false;
        else n.labelOn = !!(n.label) && (n.type === 'client'
          || n.type === 'area' || n.type === 'location' || n.type === 'machine');
        return;
      }

      // Direct children of focus
      if (isChild) {
        if (n.type === 'branch') {
          n.draw = focus.type === 'machine';
          n.lodAlpha = n.draw ? 1 : 0;
          n.labelOn = n.draw;
          return;
        }
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? 0.4 : 1;
        n.labelOn = !!n.label;
        return;
      }

      // Grandchildren under focus (one level of local subtree)
      if (n.parentId && focusPath.has(n.parentId) === false) {
        const parent = nodeById.get(n.parentId);
        if (parent && parent.parentId === focus.id && n.type !== 'branch') {
          n.draw = true;
          n.lodAlpha = 0.85;
          n.labelOn = !!n.label && (n.type === 'location' || n.type === 'machine' || n.type === 'area');
          return;
        }
      }

      // Other hubs / brands / siblings — always visible, dimmed (restore on zoom-out).
      // Hub and country names live on the title DOM, so a second node label would pile up.
      if (n.type === 'hub' || n.type === 'country' || n.type === 'client') {
        n.draw = true;
        n.preview = true;
        n.lodAlpha = dimNode * (n.status === 'future' || n.comingSoon ? 0.7 : 1);
        n.labelOn = n.type === 'client' && !!n.label;
        return;
      }

      // Siblings of focus (same parent) — dim
      if (n.parentId && focus.parentId && n.parentId === focus.parentId) {
        n.draw = true;
        n.preview = true;
        n.lodAlpha = dimNode;
        n.labelOn = !!n.label && (n.type === 'area' || n.type === 'location' || n.type === 'machine');
        return;
      }

      // Deep sub-trees of non-focused branches: collapse (parent shows +N)
      n.draw = false;
      n.lodAlpha = 0;
      n.labelOn = false;
    });

    // +N rollup on dimmed parents whose deep children are collapsed
    nodes.forEach((n) => {
      if (!n.draw || !(n.type === 'client' || n.type === 'area' || n.type === 'location' || n.type === 'hub' || n.type === 'country')) return;
      if (focusPath.has(n.id) || n.id === focus?.id) return;
      const kids = (childrenOf.get(n.id) || []).filter((c) => !c.pad && c.type !== 'artic' && c.type !== 'branch');
      const hidden = kids.filter((c) => !c.draw).length;
      if (hidden > 0) n.collapsedCount = hidden;
    });

    articulations.forEach((a) => {
      a.draw = false;
      a.lodAlpha = 0;
    });

    resolveLabelCollisions();
    paintLod();
    syncDomLabels();
    syncDomBadges();
    syncHubTitles();
    settleNodeLabels();
    syncDomLabels();
    syncHubTitles();
    syncFocusTitle();
    separateBadgesFromTitles();
    renderBreadcrumb(focusNodeId);
    syncAposEdgeChip();
    syncWatermark();
  }

  function syncWatermark() {
    if (!stage) return;
    let el = document.getElementById('focus-watermark');
    if (!el) {
      el = document.createElement('div');
      el.id = 'focus-watermark';
      el.className = 'focus-watermark';
      stage.appendChild(el);
    }
    const focus = nodeById.get(focusNodeId);
    if (overviewMode || !focus || focus.type !== 'machine') {
      el.hidden = true;
      return;
    }
    const site = nodeById.get(focus.parentId);
    const area = site ? nodeById.get(site.parentId) : null;
    el.hidden = false;
    el.textContent = [area?.label, site?.label].filter(Boolean).join('   ·   ');
    const fit = viewportFitRect({ reserveDrawer: true });
    el.style.left = `${fit.cx}px`;
    el.style.top = `${fit.cy - fit.h * 0.28}px`;
  }

  function focusPathHasHubNeighbor(focusHubId, hubId) {
    if (!focusHubId) return false;
    const idx = hubs.findIndex((h) => h.id === focusHubId);
    if (idx < 0) return false;
    const a = hubs[(idx - 1 + hubs.length) % hubs.length]?.id;
    const b = hubs[(idx + 1) % hubs.length]?.id;
    return hubId === a || hubId === b;
  }

  function nodeScreenRadius(n) {
    const deep = !overviewMode;
    if (n.type === 'hub' || n.type === 'country') return deep ? DEEP_HUB_R : HUB_SCREEN_R;
    if (n.type === 'branch') return deep ? (DEEP_NODE_R.branch || 14) : 5;
    if (n.type === 'enterprise') return 8;
    if (n.type === 'client') return deep ? (DEEP_NODE_R.area || 16) : 7.2;
    return deep ? (DEEP_NODE_R[n.type] || 11) : (NODE_R_BY_TYPE[n.type] || NODE_SCREEN_R);
  }

  function layoutPills() {
    nodes.forEach((n) => { n._pillBox = null; });
    const pills = [];
    nodes.forEach((n) => {
      const text = pillTextFor(n);
      if (!text) return;
      const p = worldToScreen(n.x, n.y);
      const sr = nodeScreenRadius(n) * (n.grow == null ? 1 : n.grow);
      const w = Math.max(18, 8 + text.length * 6.4);
      const h = 14;
      const kids = (childrenOf.get(n.id) || []).filter((c) => c.draw && !c.pad);
      const ref = kids[0] || (n.parentId ? nodeById.get(n.parentId) : null);
      const spoke = ref
        ? Math.atan2(ref.y - n.y, ref.x - n.x)
        : (n.outAngle != null ? n.outAngle : Math.atan2(n.y, n.x));
      const ang = spoke + Math.PI / 2;
      const dist = sr + Math.max(w, h) / 2 + (n.type === 'hub' || n.type === 'country' ? 18 : 8);
      const bx = p.x + Math.cos(ang) * dist - w / 2;
      const by = p.y + Math.sin(ang) * dist - h / 2;
      pills.push({ n, text, w, h, x: bx, y: by });
    });
    const obstacles = [];
    document.querySelectorAll('.hub-title-dom, .hub-sub, .focus-title').forEach((el) => {
      if (el.style.display === 'none') return;
      const r = el.getBoundingClientRect();
      const stageR = stage.getBoundingClientRect();
      if (r.width < 2) return;
      obstacles.push({ x: r.left - stageR.left, y: r.top - stageR.top, w: r.width, h: r.height });
    });
    pills.forEach((a, i) => {
      for (let g = 0; g < 8; g++) {
        const hit = pills.slice(0, i).some((b) => a.x < b.x + b.w + 3 && a.x + a.w > b.x - 3 && a.y < b.y + b.h + 3 && a.y + a.h > b.y - 3)
          || obstacles.some((b) => a.x < b.x + b.w + 2 && a.x + a.w > b.x - 2 && a.y < b.y + b.h + 2 && a.y + a.h > b.y - 2);
        if (!hit) break;
        a.y -= a.h + 2;
      }
      a.n._pillBox = { l: a.x, t: a.y, r: a.x + a.w, b: a.y + a.h, text: a.text, w: a.w, h: a.h };
    });
  }

  /** Labels outward along link; clear full text box from disc + pill (not just center) */
  function resolveLabelCollisions() {
    layoutPills();
    const labeled = nodes.filter((n) => n.labelOn && n.draw && n.label && !n.ancestorOnly);

    function textHalf(n) {
      if (n._measW > 2 && n._measH > 2) {
        return { hw: n._measW / 2 + 2, hh: n._measH / 2 + 2 };
      }
      const len = (n.label || '').length;
      // Overview brand labels match country-title scale (~22px)
      const overviewBrand = overviewMode && n.type === 'client';
      const charW = overviewBrand ? 7.2 : 3.55;
      return {
        hw: Math.min(overviewBrand ? 140 : 100, Math.max(overviewBrand ? 28 : 22, 5 + len * charW)),
        hh: overviewBrand ? 14 : n.type === 'branch' ? 9 : 8,
      };
    }
    function placeAt(p, ang, sr, hw, hh, pillBox, n) {
      // Dist so near edge of centered text box clears disc by radius+6
      let dist = sr + 6 + hw * Math.abs(Math.cos(ang)) + hh * Math.abs(Math.sin(ang)) + 2;
      let sx = p.x + Math.cos(ang) * dist;
      let sy = p.y + Math.sin(ang) * dist;
      const pill = pillBox
        ? { x: (pillBox.l + pillBox.r) / 2, y: (pillBox.t + pillBox.b) / 2, rw: pillBox.w / 2 + 2, rh: pillBox.h / 2 + 2 }
        : null;
      for (let g = 0; g < 10; g++) {
        const box = { l: sx - hw, r: sx + hw, t: sy - hh, b: sy + hh };
        const closestX = Math.max(box.l, Math.min(p.x, box.r));
        const closestY = Math.max(box.t, Math.min(p.y, box.b));
        const clearNode = Math.hypot(closestX - p.x, closestY - p.y) >= sr + 6;
        let clearPill = true;
        if (pill) {
          clearPill = !(box.l < pill.x + pill.rw && box.r > pill.x - pill.rw && box.t < pill.y + pill.rh && box.b > pill.y - pill.rh);
        }
        if (clearNode && clearPill) {
          // Area and site names sit beside the spoke, not on it.
          if (n && (n.type === 'area' || n.type === 'location' || n.type === 'machine')) {
            const tang = ang + Math.PI / 2;
            const mag = Math.max(18, hw * 0.72);
            sx += Math.cos(tang) * mag;
            sy += Math.sin(tang) * mag;
          }
          return { sx, sy, dist, ang };
        }
        dist += 7;
        sx = p.x + Math.cos(ang) * dist;
        sy = p.y + Math.sin(ang) * dist;
      }
      // Try bias away from NE pill
      if (pill) {
        const ang2 = ang + 0.45;
        dist = sr + 6 + hw * Math.abs(Math.cos(ang2)) + hh * Math.abs(Math.sin(ang2)) + 4;
        return {
          sx: p.x + Math.cos(ang2) * dist,
          sy: p.y + Math.sin(ang2) * dist,
          dist,
          ang: ang2,
        };
      }
      return { sx, sy, dist, ang };
    }

    labeled.forEach((n) => {
      const parent = n.parentId ? nodeById.get(n.parentId) : null;
      let ang =
        parent && parent.type !== 'enterprise'
          ? Math.atan2(n.y - parent.y, n.x - parent.x)
          : n.angle != null
            ? n.angle
            : Math.atan2(n.y, n.x);
      // Layout screen, not the bob — DOM labels must not drift frame to frame
      const p = worldToScreen(n.x, n.y);
      const sr = nodeScreenRadius(n) * (n.grow == null ? 1 : n.grow);
      const { hw, hh } = textHalf(n);
      const placed = placeAt(p, ang, sr, hw, hh, n._pillBox, n);
      n._labelAng = placed.ang;
      n._labelSx = placed.sx;
      n._labelSy = placed.sy;
      n._labelHw = hw;
      n._labelHh = hh;
      n.labelOx = placed.sx - p.x;
      n.labelOy = placed.sy - p.y;
    });

    labeled.sort((a, b) => (a._labelAng || 0) - (b._labelAng || 0));
    const placed = [];
    nodes.forEach((n) => {
      const b = n._pillBox;
      if (!b) return;
      placed.push({ sx: (b.l + b.r) / 2, sy: (b.t + b.b) / 2, hw: b.w / 2 + 2, hh: b.h / 2 + 2 });
    });
    labeled.forEach((n) => {
      let sx = n._labelSx;
      let sy = n._labelSy;
      const p = worldToScreen(n.x, n.y);
      const ang = n._labelAng;
      const hw = n._labelHw || 40;
      const hh = n._labelHh || 8;
      for (let guard = 0; guard < 12; guard++) {
        let hit = false;
        for (const q of placed) {
          if (Math.abs(sx - q.sx) < hw + q.hw + 4 && Math.abs(sy - q.sy) < hh + q.hh + 4) {
            const d = Math.hypot(sx - p.x, sy - p.y) + 10;
            const tang = ang + Math.PI / 2 * (guard % 2 === 0 ? 1 : -1);
            sx = p.x + Math.cos(ang) * d + Math.cos(tang) * 8;
            sy = p.y + Math.sin(ang) * d + Math.sin(tang) * 8;
            hit = true;
            break;
          }
        }
        if (!hit) break;
      }
      n._labelSx = sx;
      n._labelSy = sy;
      placed.push({ sx, sy, hw, hh });
    });
    nudgeLabelsOffLinks(placed);
  }

  function separateBadgesFromTitles() {
    const stageR = stage.getBoundingClientRect();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - stageR.left, t: r.top - stageR.top, r: r.right - stageR.left, b: r.bottom - stageR.top, w: r.width };
    };
    const titles = () => [...document.querySelectorAll('.hub-title, .hub-sub, .focus-title, .node-label-dom')].filter((el) => {
      const st = getComputedStyle(el);
      return st.display !== 'none' && Number.parseFloat(st.opacity || '1') >= 0.2;
    });
    document.querySelectorAll('.node-badge').forEach((el) => {
      const n = el.dataset.badge ? nodeById.get(el.dataset.badge) : null;
      for (let g = 0; g < 10; g++) {
        const b = box(el);
        if (b.w < 2) return;
        const hit = titles().some((t) => {
          if (t === el) return false;
          const q = box(t);
          return b.l < q.r - 1 && b.r > q.l + 1 && b.t < q.b - 1 && b.b > q.t + 1;
        });
        if (!hit) break;
        const top = (parseFloat(el.style.top) || b.t) - (b.b - b.t + 4);
        el.style.top = `${top}px`;
        if (n?._pillBox) {
          const h = n._pillBox.b - n._pillBox.t;
          n._pillBox.t = top;
          n._pillBox.b = top + h;
        }
      }
    });
  }

  /** After DOM labels exist, slide any that still sit on a spoke. */
  function settleNodeLabels() {
    linkSampleCache = null;
    const stageR = stage.getBoundingClientRect();
    const samples = linkScreenSamples();
    const fit = viewportFitRect({ reserveDrawer: true });
    nodes.forEach((n) => {
      if (!n.labelOn || !n.draw || !n.label) return;
      const el = document.querySelector(`[data-nid="${CSS.escape(n.id)}"]`);
      if (!el || el.style.display === 'none') return;
      for (let g = 0; g < 14; g++) {
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        const box = {
          l: r.left - stageR.left, t: r.top - stageR.top,
          r: r.right - stageR.left, b: r.bottom - stageR.top,
        };
        const cx = (box.l + box.r) / 2;
        const cy = (box.t + box.b) / 2;
        let hx = null;
        let hy = null;
        let best = 1e9;
        samples.forEach((p) => {
          if (!(p.x > box.l - 6 && p.x < box.r + 6 && p.y > box.t - 6 && p.y < box.b + 6)) return;
          const d = Math.hypot(cx - p.x, cy - p.y);
          if (d < best) { best = d; hx = p.x; hy = p.y; }
        });
        if (hx == null) {
          const inside = box.l >= fit.x - 2 && box.t >= fit.y - 2 && box.r <= fit.x + fit.w + 2 && box.b <= fit.y + fit.h + 2;
          if (!inside && (n.parentId === focusNodeId || n.id === focusNodeId)) {
            const pullX = fit.cx - cx;
            const pullY = fit.cy - cy;
            const pm = Math.hypot(pullX, pullY) || 1;
            n._labelSx += (pullX / pm) * 12;
            n._labelSy += (pullY / pm) * 12;
            el.style.left = `${n._labelSx}px`;
            el.style.top = `${n._labelSy}px`;
            continue;
          }
          break;
        }
        let dx = cx - hx;
        let dy = cy - hy;
        const mag = Math.hypot(dx, dy) || 1;
        const tang = (n._labelAng || 0) + Math.PI / 2;
        if (mag < 8) {
          dx = Math.cos(tang) * 24;
          dy = Math.sin(tang) * 24;
        } else {
          dx = (dx / mag) * 24;
          dy = (dy / mag) * 24;
        }
        n._labelSx = (n._labelSx || cx) + dx;
        n._labelSy = (n._labelSy || cy) + dy;
        el.style.left = `${n._labelSx}px`;
        el.style.top = `${n._labelSy}px`;
      }
    });
    document.querySelectorAll('.node-badge').forEach((el) => {
      const id = el.dataset.badge;
      const n = id ? nodeById.get(id) : null;
      if (!n || !n._pillBox) return;
      for (let g = 0; g < 8; g++) {
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        const box = {
          l: r.left - stageR.left, t: r.top - stageR.top,
          r: r.right - stageR.left, b: r.bottom - stageR.top,
        };
        const cx = (box.l + box.r) / 2;
        const cy = (box.t + box.b) / 2;
        let hx = null;
        let hy = null;
        let best = 1e9;
        samples.forEach((p) => {
          if (!(p.x > box.l - 6 && p.x < box.r + 6 && p.y > box.t - 6 && p.y < box.b + 6)) return;
          const d = Math.hypot(cx - p.x, cy - p.y);
          if (d < best) { best = d; hx = p.x; hy = p.y; }
        });
        if (hx == null) break;
        let dx = cx - hx;
        let dy = cy - hy;
        const mag = Math.hypot(dx, dy) || 1;
        dx = (dx / mag) * 16;
        dy = (dy / mag) * 16;
        n._pillBox.l += dx;
        n._pillBox.r += dx;
        n._pillBox.t += dy;
        n._pillBox.b += dy;
        el.style.left = `${n._pillBox.l}px`;
        el.style.top = `${n._pillBox.t}px`;
      }
    });
  }

  /** Slide a label off any drawn link without landing on another label. */
  function nudgeLabelsOffLinks(placed) {
    const labeled = nodes.filter((n) => n.labelOn && n.draw && n.label && n._labelSx != null && !n.ancestorOnly);
    const pointIn = (p, box) => p.x > box.l + 1 && p.x < box.r - 1 && p.y > box.t + 1 && p.y < box.b - 1;
    labeled.forEach((n) => {
      const hw = n._labelHw || 36;
      const hh = n._labelHh || 8;
      const baseSx = n._labelSx;
      const baseSy = n._labelSy;
      const ang = n._labelAng || 0;
      const tang = ang + Math.PI / 2;
      const hitsLink = (sx, sy) => {
        const box = { l: sx - hw, r: sx + hw, t: sy - hh, b: sy + hh };
        for (let i = 0; i < links.length; i++) {
          const L = links[i];
          if (L.kind === 'signal') continue;
          const s = nodeById.get(L.source);
          const t = nodeById.get(L.target);
          if (!s?.draw || !t?.draw || s.ghost || t.ghost || (s.lodAlpha || 0) < 0.2 || (t.lodAlpha || 0) < 0.2) continue;
          const cc = curveControls(s, t, L.kind);
          const pts = sampleCubic(s.x, s.y, cc.c1x, cc.c1y, cc.c2x, cc.c2y, t.x, t.y, 8);
          for (let k = 0; k < pts.length; k++) {
            const q = worldToScreen(pts[k][0], pts[k][1]);
            if (pointIn(q, box)) return true;
          }
        }
        return false;
      };
      if (!hitsLink(baseSx, baseSy)) return;
      let chosen = null;
      for (let step = 1; step <= 8 && !chosen; step++) {
        const mag = 12 + step * 8;
        const dirs = [1, -1];
        for (let d = 0; d < dirs.length; d++) {
          const sx = baseSx + Math.cos(tang) * dirs[d] * mag;
          const sy = baseSy + Math.sin(tang) * dirs[d] * mag;
          const crowded = placed.some((q) => q.sx !== baseSx && Math.abs(sx - q.sx) < hw + q.hw + 4 && Math.abs(sy - q.sy) < hh + q.hh + 4);
          if (!crowded && !hitsLink(sx, sy)) { chosen = { sx, sy }; break; }
        }
      }
      if (!chosen) return;
      n._labelSx = chosen.sx;
      n._labelSy = chosen.sy;
      const slot = placed.find((q) => q.sx === baseSx && q.sy === baseSy);
      if (slot) { slot.sx = chosen.sx; slot.sy = chosen.sy; }
    });
  }

  function syncDomLabels() {
    const layer = document.getElementById(DOM.labelLayer);
    if (!layer) return;
    let root = layer.querySelector('.node-labels');
    if (!root) {
      root = document.createElement('div');
      root.className = 'node-labels';
      layer.appendChild(root);
    }
    const want = new Set();
    nodes.forEach((n) => {
      if (!n.labelOn || !n.draw || !n.label || n.ancestorOnly) return;
      if (openBranchId && n.id === openBranchId) return; // card shows this name
      want.add(n.id);
      let el = root.querySelector(`[data-nid="${n.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.dataset.nid = n.id;
        el.className = 'node-label-dom';
        root.appendChild(el);
      }
      el.textContent = n.label; // full label (incl. Technical Support)
      const overviewBrand = overviewMode && n.type === 'client';
      el.className = `node-label-dom type-${n.type}${n.type === 'branch' ? ' branch' : ''}${overviewBrand ? ' overview-brand' : ''}`;
      const base = worldToScreen(n.x, n.y);
      const sx = n._labelSx != null ? n._labelSx : base.x;
      const sy = n._labelSy != null ? n._labelSy : base.y + 20;
      // Hex: park labels under the cell, never over the core logo
      let lx = sx;
      let ly = sy;
      if (layoutMode === 'hex') {
        ly = sy + 18;
        const coreN = nodeById.get(DATA.enterprise.id);
        const coreS = coreN ? worldToScreen(coreN.x, coreN.y) : { x: transform.x, y: transform.y };
        if (Math.hypot(lx - coreS.x, ly - coreS.y) < 56 && n.type !== 'enterprise') {
          ly = coreS.y + 64;
        }
      }
      el.style.left = `${lx}px`;
      el.style.top = `${ly}px`;
      el.style.display = '';
      // Gemini LOD: leaf labels fade 1.4→2.0; hubs always on at overview
      let lop = 1;
      const zk = transform.k || 1;
      const isLeafish = n.type === 'location' || n.type === 'machine' || n.type === 'branch' || n.type === 'area';
      if (isLeafish && !overviewMode) {
        const focusChild = n.parentId === focusNodeId;
        if (focusChild) lop = 1;
        else if (zk <= 1.2) lop = 0;
        else if (zk < 1.4) lop = 0;
        else if (zk < 2.0) lop = (zk - 1.4) / 0.6;
        else lop = 1;
        // Dim far context when deep-zoomed — never the focus or its direct children
        if (zk > 2.6 && n.id !== focusNodeId && !focusChild && !pathToRoot(focusNodeId).includes(n.id)) {
          lop *= 0.08;
        }
      }
      if (!overviewMode && n.preview && n.parentId !== focusNodeId && n.id !== focusNodeId) {
        lop = Math.min(lop, (n.lodAlpha || 0) * 0.4);
      }
      el.style.opacity = String(lop);
      if (lop < 0.05) el.style.display = 'none';
      el.style.whiteSpace = 'nowrap';
      el.title = n.label;
      if (el.offsetWidth > 2) {
        n._measW = el.offsetWidth;
        n._measH = el.offsetHeight || 16;
      }
    });
    root.querySelectorAll('[data-nid]').forEach((el) => {
      if (!want.has(el.dataset.nid)) el.style.display = 'none';
    });
  }

  function syncDomBadges() {
    const layer = document.getElementById(DOM.labelLayer);
    if (!layer) return;
    let root = layer.querySelector('.node-badges');
    if (!root) {
      root = document.createElement('div');
      root.className = 'node-badges';
      layer.appendChild(root);
    }
    const want = new Set();
    nodes.forEach((n) => {
      const box = n._pillBox;
      if (!box) return;
      want.add(n.id);
      let el = root.querySelector(`[data-badge="${CSS.escape(n.id)}"]`);
      if (!el) {
        el = document.createElement('div');
        el.dataset.badge = n.id;
        root.appendChild(el);
      }
      const health = UTILS ? UTILS.healthOf(n) : 'warning';
      el.className = `node-badge is-${health}`;
      el.textContent = box.text;
      el.style.left = `${box.l}px`;
      el.style.top = `${box.t}px`;
      el.style.display = '';
    });
    root.querySelectorAll('[data-badge]').forEach((el) => {
      if (!want.has(el.dataset.badge)) el.style.display = 'none';
    });
  }

  function syncFocusTitle() {
    const layer = document.getElementById(DOM.labelLayer);
    if (!layer) return;
    let el = layer.querySelector('.focus-title');
    if (!el) {
      el = document.createElement('div');
      el.className = 'focus-title';
      el.innerHTML = `<div class="focus-title-main"></div><div class="focus-title-sub"></div>`;
      layer.appendChild(el);
    }
    const focus = nodeById.get(focusNodeId);
    if (overviewMode || !focus || focus.type === 'hub' || focus.type === 'country' || focus.type === 'enterprise' || focus.type === 'branch') {
      el.style.display = 'none';
      return;
    }
    const main = el.querySelector('.focus-title-main');
    const sub = el.querySelector('.focus-title-sub');
    main.textContent = focus.label || '';
    sub.textContent = focus.type === 'machine' ? 'machine' : focus.type === 'location' ? 'site' : focus.type;
    const hub = nodeById.get(focus.hubId);
    main.className = `focus-title-main ${hub?.ring || 'teal'}`;
    const s = worldToScreen(focus.x, focus.y);
    const sr = nodeScreenRadius(focus);
    const parent = focus.parentId ? nodeById.get(focus.parentId) : null;
    const spoke = parent
      ? Math.atan2(s.y - worldToScreen(parent.x, parent.y).y, s.x - worldToScreen(parent.x, parent.y).x)
      : Math.atan2(focus.y, focus.x);
    let ang = spoke + Math.PI / 2;
    let left = s.x + Math.cos(ang) * (sr + 46);
    let top = s.y + Math.sin(ang) * (sr + 46);
    const samples = linkScreenSamples();
    for (let g = 0; g < 8; g++) {
      el.style.display = '';
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      const r = el.getBoundingClientRect();
      const stageR = stage.getBoundingClientRect();
      const box = { l: r.left - stageR.left, t: r.top - stageR.top, r: r.right - stageR.left, b: r.bottom - stageR.top };
      const stageR2 = stage.getBoundingClientRect();
      const overlapsChrome = [...document.querySelectorAll('.node-badge, .hub-title, .hub-sub, .node-label-dom')].some((other) => {
        if (other === el || other.closest('.focus-title')) return false;
        const st = getComputedStyle(other);
        if (st.display === 'none' || Number.parseFloat(st.opacity || '1') < 0.2) return false;
        const q = other.getBoundingClientRect();
        const b = { l: q.left - stageR2.left, t: q.top - stageR2.top, r: q.right - stageR2.left, b: q.bottom - stageR2.top };
        return box.l < b.r - 1 && box.r > b.l + 1 && box.t < b.b - 1 && box.b > b.t + 1;
      });
      const hit = overlapsChrome || samples.some((p) => p.x > box.l - 4 && p.x < box.r + 4 && p.y > box.t - 4 && p.y < box.b + 4);
      if (!hit) break;
      ang += 0.4;
      left = s.x + Math.cos(ang) * (sr + 46 + g * 8);
      top = s.y + Math.sin(ang) * (sr + 46 + g * 8);
    }
  }

  function hubLabelWorld(d) {
    return { x: Math.cos(d.outAngle) * R_TITLE, y: Math.sin(d.outAngle) * R_TITLE };
  }

  function applyLabelCounterScale() {
    const inv = 1 / (transform.k || 1);
    gNodes.selectAll('g.label-layer').attr('transform', function (d) {
      const ox = d.labelOx || 0;
      const oy = d.labelOy || 16;
      return `scale(${inv}) translate(${ox},${oy})`;
    });
    gNodes.selectAll('g.core-visual').attr('transform', `scale(${inv})`);
    // Keep hub orbs constant screen size
    gNodes.selectAll('g.node-hub').each(function () {
      d3.select(this).select('g.hub-visual').attr('transform', `scale(${inv})`);
    });
    gNodes.selectAll('g.node-area, g.node-location, g.node-machine, g.node-branch').each(function (d) {
      const g = d3.select(this);
      const base = d.r || NODE_SCREEN_R;
      const s = (NODE_SCREEN_R / base) * inv;
      g.select('circle.star-core').attr('transform', `scale(${s})`);
      g.select('circle.pulse-ring').attr('transform', `scale(${s})`);
    });
    // Pill badges stay ~14px on screen, anchored top-right of the node
    gNodes.selectAll('g.alert-badge-wrap').attr('transform', function () {
      return `scale(${inv}) translate(11,-10)`;
    });
    gArts.selectAll('circle.art-dot').attr('transform', function (d) {
      const s = inv;
      return `translate(${d.x},${d.y}) scale(${s}) translate(${-d.x},${-d.y})`;
    });
    gBg.selectAll('g.bg-group').attr('transform', function (d) {
      const p = hubLabelWorld(d);
      return `translate(${p.x},${p.y}) scale(${inv})`;
    });
  }

  function paintWorldOnce() {
    gBg
      .selectAll('g.bg-group')
      .data(hubs, (d) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'bg-group');
        g.append('text').attr('class', 'bg-label').attr('dy', '0.35em');
        g.append('text').attr('class', 'bg-sub').attr('dy', '1.8em');
        return g;
      })
      .each(function (d) {
        const g = d3.select(this);
        g.select('.bg-label')
          .attr('class', `bg-label ${d.ring || ''}`)
          .text(d.bgLabel || d.label);
        const sub = (d.subtitle || '').toLowerCase().replace(/\s+/g, ' ');
        g.select('.bg-sub').text(sub);
      });

    gLinks
      .selectAll('path.link')
      .data(links, (d) => `${d.source}->${d.target}`)
      .join('path')
      .attr('class', (d) => `link ${d.kind || ''}`)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-width', (d) => (d.kind === 'spine' ? 1.05 : 1.35))
      .attr('d', (d) => {
        const s = nodeById.get(d.source);
        const t = nodeById.get(d.target);
        if (!s || !t) return '';
        const cc = curveControls(s, t, d.kind);
        return `M${s.x},${s.y} C${cc.c1x},${cc.c1y} ${cc.c2x},${cc.c2y} ${t.x},${t.y}`;
      });

    gArts
      .selectAll('circle.art-dot')
      .data(articulations, (d) => d.id)
      .join('circle')
      .attr('class', 'art-dot')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r);

    const nodeSel = gNodes.selectAll('g.node').data(nodes, (d) => d.id);
    nodeSel.join((enter) => {
      const g = enter
        .append('g')
        .attr('class', (d) => `node node-${d.type}${d.status === 'future' ? ' future' : ''}`)
        .attr('data-id', (d) => d.id)
        .attr('data-type', (d) => d.type)
        .attr('transform', (d) => `translate(${d.x},${d.y})`)
        .on('click', (event, d) => {
          event.stopPropagation();
          ripples.push({ id: d.id, t0: performance.now() });
          onNodeClick(d);
        })
        .on('dblclick', (event, d) => {
          event.stopPropagation();
          event.preventDefault();
          drillDeeper(d);
        })
        .on('mouseenter', (event, d) => {
          hoverId = d.id;
          rootPathIds = new Set(pathToRoot(d.id));
          paintLod();
          showTooltip(event, d);
        })
        .on('mousemove', (event, d) => showTooltip(event, d))
        .on('mouseleave', () => {
          hoverId = null;
          rootPathIds = new Set();
          hideTooltip();
          paintLod();
        });

      g.each(function (d) {
        const el = d3.select(this);
        if (d.type === 'enterprise') {
          const cv = el.append('g').attr('class', 'core-visual');
          cv.append('circle').attr('class', 'core-glow').attr('r', 28);
          cv.append('circle').attr('class', 'core-disk').attr('r', 11);
          cv.append('text').attr('class', 'core-wordmark').text('apos');
          el.append('circle').attr('class', 'hit-target').attr('r', 36);
        } else if (d.type === 'hub' || d.type === 'country') {
          const hv = el.append('g').attr('class', 'hub-visual');
          hv.append('circle').attr('class', `hub-ring ${d.ring}`).attr('r', HUB_SCREEN_R + 5);
          hv.append('circle').attr('class', 'hub-disk').attr('r', HUB_SCREEN_R);
          el.append('circle').attr('class', 'hit-target').attr('r', 30);
        } else {
          el.append('circle').attr('class', 'pulse-ring').attr('r', d.r + 6);
          el.append('circle')
            .attr('class', `star-core${d.alert ? ' alert' : ''}`)
            .attr('r', d.r);
          el.append('circle').attr('class', 'hit-target').attr('r', d.r + 9);
          const lab = el.append('g').attr('class', 'label-layer');
          lab
            .append('text')
            .attr('class', 'node-label small')
            .attr('dy', '0.35em')
            .text(d.label);
        }
      });
      return g;
    });

    paintLod();
    applyLabelCounterScale();
  }

  function paintLod() {
    const focusPath = new Set(pathToRoot(focusNodeId));
    const focusHubId =
      nodeById.get(focusNodeId)?.type === 'hub'
        ? focusNodeId
        : nodeById.get(focusNodeId)?.hubId;
    const accent = UTILS ? UTILS.accentFor(focusHubId) : null;
    const crumbHot = crumbHoverId ? new Set(pathToRoot(crumbHoverId)) : null;

    const hoverHot = hoverId ? hoverRelatedIds(hoverId) : null;
    gNodes.selectAll('g.node').each(function (d) {
      const g = d3.select(this);
      g.style('display', d.draw ? null : 'none');
      let op = d.draw ? d.lodAlpha : 0;
      if (d.draw) op *= filterFade(d.id);
      if (crumbHot && crumbHot.has(d.id)) op = Math.max(op, 0.95);
      // Gemini: hub/node hover fades ~95% of unrelated
      if (hoverHot && d.draw) {
        if (!hoverHot.has(d.id) && hoverId !== d.id) op = Math.min(op, 0.1);
      }
      g.style('opacity', op);
      g.classed('is-focus', focusNodeId === d.id || (!overviewMode && expandedPath.has(d.id) && d.type === 'hub'));
      g.classed('is-hover', hoverId === d.id || crumbHoverId === d.id);
      g.classed('is-path', !!(hoverHot && hoverHot.has(d.id)) || !!(crumbHot && crumbHot.has(d.id)));
      g.classed('has-alert', !!(d.alertCount > 0 || d.alert));
      // Canvas draws nodes/labels/badges — keep SVG for hit-testing only
      const label = g.select('text.node-label');
      if (!label.empty()) label.style('opacity', 0).style('display', 'none');
      g.select('circle.star-core').style('opacity', 0);
      g.select('circle.pulse-ring').style('opacity', 0);
      g.select('g.hub-visual').style('opacity', 0);
      g.select('g.core-visual').style('opacity', 0);
      let badge = g.select('g.alert-badge-wrap');
      if (!badge.empty()) badge.style('display', 'none');
    });

    // Canvas owns link rendering — SVG paths are hit-test only (never paint in hex:
    // nearby brand/area Béziers looked like stray squiggles inside cells).
    gLinks.selectAll('path.link').style('opacity', 0).style('display', 'none');
    if (layoutMode !== 'hex') {
      gLinks.selectAll('path.link').each(function (d) {
        const s = nodeById.get(d.source);
        const t = nodeById.get(d.target);
        const onPath = focusPath.has(d.source) && focusPath.has(d.target);
        // Path (incl. spine→APOS) always kept; context links when both ends drawn
        let show = onPath || !!(s?.draw && t?.draw);
        const el = d3.select(this);
        let op = 0;
        if (show) {
          if (onPath) op = 0.92;
          else if (d.kind === 'spine') op = 0.5;
          else if (s?.preview || t?.preview) op = 0.34;
          else op = 0.55;
        }
        // Canvas paints the curves. SVG stays invisible so an untransformed
        // world-origin path cannot draw a diagonal from the stage corner.
        el.style('display', show ? null : 'none')
          .classed('on-path', onPath)
          .classed('dim', !!(s?.preview || t?.preview) || (!overviewMode && !onPath && show))
          .style('opacity', 0)
          .style('pointer-events', show ? 'stroke' : 'none');
        if (onPath && accent) el.style('stroke', accent.stroke);
        else el.style('stroke', null);
      });
    }

    gArts.selectAll('circle.art-dot').each(function (d) {
      d3.select(this)
        .style('display', d.draw ? null : 'none')
        .attr('opacity', d.draw ? d.lodAlpha : 0);
    });

    // SVG bg-labels disabled — DOM hub titles are the single source of truth
    // (prevents stray clipped subtitle fragments under the header).
    // Hide both the group and the <text> nodes: Chromium getComputedStyle on
    // nested SVG text still reports display:block when only the parent is none.
    gBg.selectAll('g.bg-group').style('opacity', 0).style('display', 'none');
    gBg.selectAll('text.bg-label').style('opacity', 0).style('display', 'none');
  }

  // ——— camera ———
  function collectDescendants(node, maxDepth) {
    const out = [];
    const walk = (n, depth) => {
      if (depth > maxDepth) return;
      (childrenOf.get(n.id) || []).forEach((c) => {
        out.push(c);
        walk(c, depth + 1);
      });
    };
    walk(node, 1);
    return out;
  }

  function localFrameNodes(node) {
    const pts = [node];
    const kids = (childrenOf.get(node.id) || []).filter((c) => !c.pad && c.type !== 'artic');
    if (node.type === 'hub') {
      kids.forEach((area) => {
        if (area.type !== 'area' && area.type !== 'location') return;
        pts.push(area);
        (childrenOf.get(area.id) || []).forEach((loc) => {
          if (loc.type === 'location' && !loc.pad) pts.push(loc);
        });
      });
    } else if (node.type === 'country') {
      kids.forEach((cl) => {
        if (cl.type !== 'client') return;
        pts.push(cl);
        (childrenOf.get(cl.id) || []).forEach((area) => {
          if (area.type === 'area' && !area.pad) pts.push(area);
        });
      });
    } else if (node.type === 'client') {
      kids.filter((c) => c.type === 'area').forEach((area) => {
        pts.push(area);
        (childrenOf.get(area.id) || []).forEach((loc) => {
          if (loc.type === 'location' && !loc.pad) pts.push(loc);
        });
      });
    } else if (node.type === 'area') {
      kids.filter((c) => c.type === 'location').forEach((loc) => pts.push(loc));
    } else if (node.type === 'location') {
      kids.filter((c) => c.type === 'machine').forEach((m) => pts.push(m));
    } else if (node.type === 'machine') {
      const parent = nodeById.get(node.parentId);
      if (parent) pts.push(parent);
      (childrenOf.get(node.parentId) || []).forEach((s) => {
        if (s.type === 'machine') pts.push(s);
      });
    }
    return pts;
  }

  /**
   * Focus framing set: always focus + children.
   * Hub/country/client also include the ancestor chain (spine to APOS).
   * Deep levels: at most 1–2 nearby ancestors — never fit the whole chain;
   * the rest runs off-frame via a continuous curve to the edge APOS chip.
   */
  function focusFrameNodes(node) {
    const pts = localFrameNodes(node).slice();
    const seen = new Set(pts.map((n) => n.id));
    const path = pathToRoot(node.id);
    const deep = node.type === 'area' || node.type === 'location'
      || node.type === 'machine' || node.type === 'branch';

    if (!deep) {
      path.forEach((id) => {
        if (seen.has(id)) return;
        const n = nodeById.get(id);
        if (!n) return;
        pts.push(n);
        seen.add(id);
      });
      return pts;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((n) => {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });
    const localSpan = Math.max(maxX - minX, maxY - minY, 40);
    let added = 0;
    const ancestorCap = node.type === 'machine' ? 1 : 2;
    for (const id of path) {
      if (id === node.id || seen.has(id)) continue;
      if (added >= ancestorCap) break;
      const n = nodeById.get(id);
      if (!n || n.type === 'enterprise') break;
      if (node.type === 'machine' && n.id !== node.parentId) break;
      const nx = Math.min(minX, n.x);
      const xx = Math.max(maxX, n.x);
      const ny = Math.min(minY, n.y);
      const yy = Math.max(maxY, n.y);
      const span = Math.max(xx - nx, yy - ny);
      // Only keep an ancestor if it still sits near the local focus cluster
      if (span > localSpan * 2.15) break;
      pts.push(n);
      seen.add(id);
      minX = nx; maxX = xx; minY = ny; maxY = yy;
      added += 1;
    }
    return pts;
  }

  /** Usable camera frame = stage minus chrome + inspector drawer / HUD. */
  function viewportFitRect(opts = {}) {
    const W = stage?.clientWidth || 1200;
    const H = stage?.clientHeight || 800;
    const drawer = document.getElementById('inspector-drawer');
    const drawerOpen = !!(drawer?.classList.contains('is-open')
      || stage?.classList.contains('inspector-open')
      || document.body.classList.contains('inspector-open'));
    const reserveDrawer = !!(opts.reserveDrawer || drawerOpen);
    let right = 12;
    if (reserveDrawer) {
      const dw = drawer ? (drawer.getBoundingClientRect().width || 320) : 320;
      right = Math.round(dw + 20);
    }
    const left = 16;
    const top = 96;
    const bottom = 36;
    const x = left;
    const y = top;
    const w = Math.max(220, W - left - right);
    const h = Math.max(180, H - top - bottom);
    return {
      x, y, w, h,
      cx: x + w / 2,
      cy: y + h / 2,
      W, H, left, right, top, bottom,
      reserveDrawer,
    };
  }

  function subtreeExtent(node) {
    const locals = focusFrameNodes(node);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Fixed world pad for scale (screen label clearance applied in fitTransform centre)
    const labelPad = 48;
    locals.forEach((n) => {
      minX = Math.min(minX, n.x - labelPad);
      maxX = Math.max(maxX, n.x + labelPad);
      minY = Math.min(minY, n.y - labelPad);
      maxY = Math.max(maxY, n.y + labelPad);
    });
    if (node && node.type !== 'hub' && node.type !== 'country' && node.type !== 'enterprise') {
      // Extra room for focus title under disc + child labels above
      maxY = Math.max(maxY, node.y + 72);
      minY = Math.min(minY, node.y - 56);
      locals.forEach((n) => {
        if (n.id === node.id) return;
        maxX = Math.max(maxX, n.x + 56);
        minX = Math.min(minX, n.x - 56);
        maxY = Math.max(maxY, n.y + 48);
        minY = Math.min(minY, n.y - 64);
      });
    }
    if (node.type === 'hub' || node.type === 'country') {
      const tipR = TREE.area + TREE.location;
      const along = node.outAngle || -Math.PI / 2;
      const tx = node.x + Math.cos(along) * tipR;
      const ty = node.y + Math.sin(along) * tipR;
      minX = Math.min(minX, tx, node.x);
      maxX = Math.max(maxX, tx, node.x);
      minY = Math.min(minY, ty, node.y);
      maxY = Math.max(maxY, ty, node.y);
      // Hub title + inward spine toward APOS (never frame hub alone at the edge)
      const inward = along + Math.PI;
      const hx = node.x + Math.cos(inward) * 50;
      const hy = node.y + Math.sin(inward) * 50;
      minX = Math.min(minX, hx);
      maxX = Math.max(maxX, hx);
      minY = Math.min(minY, hy);
      maxY = Math.max(maxY, hy);
      const core = nodeById.get(DATA.enterprise.id);
      if (core) {
        minX = Math.min(minX, core.x - CORE_WORLD_R * 0.35);
        maxX = Math.max(maxX, core.x + CORE_WORLD_R * 0.35);
        minY = Math.min(minY, core.y - CORE_WORLD_R * 0.35);
        maxY = Math.max(maxY, core.y + CORE_WORLD_R * 0.35);
      }
    }
    // Tight world pad — label clearance handled as screen margin in fitTransform
    const pad = node.type === 'hub' || node.type === 'country' ? 40 : 24;
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(48, maxX - minX + pad * 2),
      h: Math.max(48, maxY - minY + pad * 2),
    };
  }

  function fullExtent() {
    const pad = R_TITLE + 80;
    return { x: -pad, y: -pad, w: pad * 2, h: pad * 2 };
  }

  /** Overview content bbox: hubs + first-hop brands + title anchors (world). */
  function overviewContentExtent() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, r = 0) => {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    };
    grow(0, 0, CORE_WORLD_R);
    hubs.forEach((h) => {
      grow(h.x, h.y, 40);
      const brands = (childrenOf.get(h.id) || []).filter((c) => (c.type === 'client' || c.type === 'area') && !c.pad);
      brands.forEach((b) => grow(b.x, b.y, 80));
      // Title sits outside on the hub ray (planned) or inward of brands (active with children)
      const hasBrands = brands.some((b) => b.type === 'client');
      if (hasBrands && h.status !== 'future') {
        const inward = h.outAngle + Math.PI;
        grow(h.x + Math.cos(inward) * 120, h.y + Math.sin(inward) * 120, 60);
        // Brand labels outward of brands
        brands.forEach((b) => {
          const ang = b.angle != null ? b.angle : Math.atan2(b.y - h.y, b.x - h.x);
          grow(b.x + Math.cos(ang) * 90, b.y + Math.sin(ang) * 90, 50);
        });
      } else {
        grow(Math.cos(h.outAngle) * R_TITLE, Math.sin(h.outAngle) * R_TITLE, 70);
      }
    });
    if (!Number.isFinite(minX)) return fullExtent();
    const pad = 40;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  function fitTransform(bbox, centerNode) {
    const reserveDrawer = !!(centerNode && centerNode.type !== 'enterprise');
    const fit = viewportFitRect({ reserveDrawer });
    const W = fit.W;
    const H = fit.H;
    const kx = (fit.w * FIT) / Math.max(bbox.w, 1);
    const ky = (fit.h * FIT) / Math.max(bbox.h, 1);
    let k = Math.max(0.15, Math.min(36, Math.min(kx, ky)));
    // Full ring: outer titles reach ~90% of stage height (and width)
    if (centerNode?.type === 'enterprise') {
      if (LAYOUT === 'countryTree') {
        // Fit hubs + KW brands + titles with ~10% screen margin (core shifts naturally)
        const ext = overviewContentExtent();
        const margin = 0.10;
        const fitW = W * (1 - 2 * margin);
        const fitH = H * (1 - 2 * margin);
        k = Math.min(fitW / Math.max(ext.w, 1), fitH / Math.max(ext.h, 1));
        k = Math.max(0.12, Math.min(k, 1.2));
        const cx = ext.x + ext.w / 2;
        const cy = ext.y + ext.h / 2;
        return d3.zoomIdentity.translate(fit.cx, fit.cy).scale(k).translate(-cx, -cy);
      } else {
        k = Math.min((0.92 * H) / (2 * R_TITLE), (0.92 * W) / (2 * R_TITLE));
      }
      return d3.zoomIdentity.translate(fit.cx, fit.cy).scale(k);
    }
    let cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    let cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
    if (centerNode?.type === 'hub' || centerNode?.type === 'country') {
      // Frame focus + children + ancestor spine in the usable (drawer-aware) area.
      const margin = 0.08;
      const fitW = fit.w * (1 - 2 * margin);
      const fitH = fit.h * (1 - 2 * margin);
      k = Math.min(fitW / Math.max(bbox.w, 1), fitH / Math.max(bbox.h, 1));
      const fanR = LAYOUT === 'countryTree'
        ? TREE.area + TREE.location + TREE.machine * 0.35
        : TREE.area + TREE.location * 0.85;
      const kFan = (0.70 * Math.min(fit.w, fit.h)) / (fanR + 40);
      k = Math.min(k, kFan);
      k = Math.max(0.28, Math.min(k, 6));
      cx = bbox.x + bbox.w / 2;
      cy = bbox.y + bbox.h / 2;
      const along = centerNode.outAngle || -Math.PI / 2;
      const bias = Math.min(bbox.w, bbox.h) * 0.08;
      cx += Math.cos(along) * bias;
      cy += Math.sin(along) * bias;
      return d3.zoomIdentity.translate(fit.cx, fit.cy).scale(k).translate(-cx, -cy);
    }
    if (centerNode && (centerNode.type === 'client' || centerNode.type === 'area' || centerNode.type === 'location' || centerNode.type === 'machine')) {
      // Prioritise focus + children + local ghosts, centred in the usable viewport (minus drawer).
      const locals = focusFrameNodes(centerNode);
      let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity;
      const growLocal = (x, y) => {
        lMinX = Math.min(lMinX, x); lMaxX = Math.max(lMaxX, x);
        lMinY = Math.min(lMinY, y); lMaxY = Math.max(lMaxY, y);
      };
      (locals.length ? locals : [centerNode]).forEach((n) => growLocal(n.x, n.y));
      const localIds = new Set(locals.map((n) => n.id));
      links.forEach((L) => {
        if (L.kind === 'signal') return;
        if (!localIds.has(L.source) || !localIds.has(L.target)) return;
        const s = nodeById.get(L.source);
        const t = nodeById.get(L.target);
        if (!s || !t) return;
        const cc = curveControls(s, t, L.kind);
        sampleCubic(s.x, s.y, cc.c1x, cc.c1y, cc.c2x, cc.c2y, t.x, t.y, 6).forEach((p) => growLocal(p[0], p[1]));
      });
      // Room for branch/child labels around discs
      const labelPad = centerNode.type === 'machine' ? 64 : 48;
      const localW = Math.max(36, (lMaxX - lMinX) + labelPad * 2);
      const localH = Math.max(36, (lMaxY - lMinY) + labelPad * 2 + 48);
      const kLocal = Math.min(fit.w * 0.82 / localW, fit.h * 0.82 / localH);
      // Stay above ZOOM_MIN_K thresholds so reconcileViewState does not walk focus up
      const prefer = centerNode.type === 'machine' ? 2.85
        : centerNode.type === 'location' ? 2.45
        : centerNode.type === 'area' ? 1.95
        : 1.6;
      // Short viewports: do not force a zoom that pushes child labels out of the usable frame.
      const floor = centerNode.type === 'machine' ? 1.7
        : centerNode.type === 'location' ? 1.8
        : centerNode.type === 'area' ? 1.45
        : 1.25;
      const lo = kLocal + 0.05 < prefer ? floor : prefer;
      k = Math.max(lo, Math.min(kLocal, 80));
      const midX = (lMinX + lMaxX) / 2;
      // Focus title stack (~title + subtitle) below the focus disc
      const titleBottom = 148 / k;
      const blockMaxY = Math.max(lMaxY, centerNode.y + titleBottom);
      const blockMinY = Math.min(lMinY, centerNode.y) - labelPad / k;
      const midY = (blockMinY + blockMaxY) / 2;
      cx = midX;
      cy = midY;
      // If children sit all to one side, pull the focus back toward the usable centre.
      const estDx = Math.abs(centerNode.x - cx) * k / Math.max(fit.w, 1);
      const estDy = Math.abs(centerNode.y - cy) * k / Math.max(fit.h, 1);
      if (estDx > 0.16) cx += (centerNode.x - cx) * ((estDx - 0.14) / estDx);
      if (estDy > 0.16) cy += (centerNode.y - cy) * ((estDy - 0.14) / estDy);
      return d3.zoomIdentity.translate(fit.cx, fit.cy).scale(k).translate(-cx, -cy);
    }
    return d3.zoomIdentity.translate(fit.cx, fit.cy).scale(k).translate(-cx, -cy);
  }

  let flyGen = 0;
  /** Exact prior camera + focus. Esc / back / breadcrumb pop this, they do not refit. */
  const viewStack = [];

  function captureView() {
    return {
      focusId: focusNodeId,
      overview: !!overviewMode,
      k: transform.k,
      x: transform.x,
      y: transform.y,
    };
  }

  function pushView() {
    const s = captureView();
    if (![s.k, s.x, s.y].every(Number.isFinite)) return;
    const top = viewStack[viewStack.length - 1];
    if (top && top.focusId === s.focusId && top.overview === s.overview
      && Math.abs(top.k - s.k) < 0.002
      && Math.abs(top.x - s.x) < 0.4
      && Math.abs(top.y - s.y) < 0.4) return;
    viewStack.push(s);
    if (viewStack.length > 32) viewStack.shift();
  }

  function applyFocusState(focusId, overview) {
    if (overview || !focusId || focusId === DATA.enterprise.id) setOverviewExpansion();
    else setExpandedTo(focusId);
    focusPinned = true;
  }

  function restoreView(s) {
    closeLeafCard();
    closeTask();
    applyFocusState(s.focusId, s.overview);
    applyLod();
    const t = d3.zoomIdentity.translate(s.x, s.y).scale(s.k);
    flyToTransform(t);
  }

  function flyToTransform(target, done) {
    flyGen += 1;
    const myGen = flyGen;
    // Interrupt any prior flight first; only then mark flying so waitForIdle
    // cannot resolve against a stale interrupt clearing the flag.
    svg.interrupt('fly');
    flying = true;
    // Interpolate about the same usable-frame centre the target was fitted into.
    // Log-scale and the world point under that centre move monotonically (no overshoot).
    const focus = nodeById.get(focusNodeId);
    const fit = viewportFitRect({
      reserveDrawer: !!(focus && focus.type !== 'enterprise' && !overviewMode),
    });
    const sx = fit.cx;
    const sy = fit.cy;
    const k0 = Math.max(transform.k || 1, 1e-4);
    const k1 = Math.max(target.k || 1, 1e-4);
    const w0x = (sx - transform.x) / k0;
    const w0y = (sy - transform.y) / k0;
    const w1x = (sx - target.x) / k1;
    const w1y = (sy - target.y) / k1;
    if (FLY_MS === 0) {
      transform = target;
      targetTransform = target;
      svg.call(zoomBehavior.transform, transform);
      applyLod();
      applyLabelCounterScale();
      renderBreadcrumb(focusNodeId);
      if (myGen === flyGen) flying = false;
      if (done) done();
      return;
    }
    const pullingOut = k1 < k0 * 0.92;
    const log0 = Math.log(k0);
    const log1 = Math.log(k1);
    svg
      .transition('fly')
      .duration(pullingOut ? PULL_MS : FLY_MS)
      .ease(d3.easeCubicOut)
      .tween('cam', () => (t) => {
        if (myGen !== flyGen) return;
        const k = Math.exp(log0 + (log1 - log0) * t);
        const wx = w0x + (w1x - w0x) * t;
        const wy = w0y + (w1y - w0y) * t;
        transform = d3.zoomIdentity.translate(sx, sy).scale(k).translate(-wx, -wy);
        gRoot.attr('transform', transform);
        applyLod();
        applyLabelCounterScale();
      })
      .on('interrupt', () => {
        // Only the active generation may clear flying — a newer flyTo already owns it
        if (myGen === flyGen) flying = false;
      })
      .on('end', () => {
        if (myGen !== flyGen) return;
        transform = target;
        targetTransform = target;
        svg.call(zoomBehavior.transform, transform);
        applyLod();
        applyLabelCounterScale();
        renderBreadcrumb(focusNodeId);
        flying = false;
        if (done) done();
      });
  }

  function flyToNode(node) {
    if (!node) return;
    if (pinnedIncident && node.id !== pinnedIncident.machineId) pinnedIncident = null;
    if (node.type === 'enterprise') {
      flyToGalaxy();
      return;
    }
    if (node.id !== focusNodeId || overviewMode) pushView();
    setExpandedTo(node.id);
    focusPinned = true;
    closeLeafCard();
    applyLod();
    growFocusedChildren(node);
    flyToTransform(fitTransform(subtreeExtent(node), node));
  }

  function flyToGalaxy(_geminiInsp) {
    pinnedIncident = null;
    viewStack.length = 0;
    setOverviewExpansion();
    focusPinned = true;
    closeLeafCard();
    closeTask();
    applyLod();
    flyToTransform(fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id)));
  }

  function drillDeeper(node) {
    if (!node) return;
    const kids = (childrenOf.get(node.id) || []).filter(
      (c) => c.type !== 'branch' && c.type !== 'artic' && c.status !== 'future' && !c.pad
    );
    if (kids[0]) {
      flyToNode(kids[0]);
      return;
    }
    if (node.type === 'machine') {
      const br = (childrenOf.get(node.id) || [])[0];
      if (br) onNodeClick(br);
      return;
    }
    if (node.id !== focusNodeId) flyToNode(node);
  }

  function flyOut() {
    if (!leafCard.hidden) {
      closeLeafCard();
      return;
    }
    if (!taskOverlay.hidden) {
      closeTask();
      return;
    }
    if (viewStack.length) {
      restoreView(viewStack.pop());
      return;
    }
    const cur = nodeById.get(focusNodeId);
    if (!cur?.parentId || cur.type === 'hub' || cur.type === 'country') {
      flyToGalaxy();
      return;
    }
    flyToNode(nodeById.get(cur.parentId));
  }

  function nearestCenterNodeId() {
    let best = null;
    let bestScore = Infinity;
    nodes.forEach((n) => {
      if (!n.draw || n.type === 'branch' || n.type === 'artic') return;
      const d = nodeScreenDistToCenter(n);
      const score = d - n.depth * 24;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    });
    return best?.id || DATA.enterprise.id;
  }

  function jumpToAncestor(n) {
    if (!n) return;
    let idx = -1;
    for (let i = viewStack.length - 1; i >= 0; i--) {
      if (viewStack[i].focusId === n.id) { idx = i; break; }
    }
    if (idx >= 0) {
      const s = viewStack[idx];
      viewStack.length = idx;
      restoreView(s);
      return;
    }
    if (n.type === 'enterprise') flyToGalaxy();
    else flyToNode(n);
  }

  function renderBreadcrumb(id) {
    const path = pathToRoot(id).reverse();
    crumbList.replaceChildren();
    path.forEach((nid) => {
      const n = nodeById.get(nid);
      if (!n || n.type === 'artic') return;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.nid = nid;
      btn.textContent = n.type === 'enterprise' ? 'APOS' : n.label;
      const fleetNow = currentFleet();
    if (crumbList) crumbList.dataset.offline = String(fleetNow.offline || 0);
    const issues = n.type === 'machine' ? (n.alert ? 1 : 0) : (n.rollup?.alerts || n.alertCount || 0);
      if (issues > 0) {
        const mark = document.createElement('em');
        mark.className = 'crumb-count';
        mark.textContent = String(issues);
        btn.appendChild(mark);
      }
      btn.addEventListener('click', () => jumpToAncestor(n));
      btn.addEventListener('mouseenter', () => {
        crumbHoverId = nid;
        paintLod();
      });
      btn.addEventListener('mouseleave', () => {
        crumbHoverId = null;
        paintLod();
      });
      btn.addEventListener('focus', () => {
        crumbHoverId = nid;
        paintLod();
      });
      btn.addEventListener('blur', () => {
        crumbHoverId = null;
        paintLod();
      });
      li.appendChild(btn);
      crumbList.appendChild(li);
    });
    const prev = document.querySelector('.nav-chevron[data-dir="prev"]');
    if (prev) prev.disabled = overviewMode && leafCard.hidden;
  }

  /** Zoom thresholds — collapse depth cleanly; pan never mutates focus/expansion */
  const ZOOM_OVERVIEW_K = 0.62;
  const ZOOM_MIN_K = {
    hub: 1.05,
    country: 1.05,
    client: 1.55,
    area: 1.85,
    location: 2.35,
    machine: 2.15,
    branch: 2.15,
  };

  function reconcileViewState(reason) {
    const k = transform.k;
    // Hard overview floor
    if (k < ZOOM_OVERVIEW_K) {
      if (!overviewMode || focusNodeId !== DATA.enterprise.id) {
        setOverviewExpansion();
        focusPinned = false;
      }
      return;
    }
    if (reason === 'pan') {
      // Pan: keep pinned focus + expansion; only LOD/labels refresh
      return;
    }
    // Zoom: walk focus up while below level threshold
    if (overviewMode) return;
    let guard = 0;
    while (guard++ < 8) {
      const focus = nodeById.get(focusNodeId);
      if (!focus || focus.type === 'enterprise') {
        setOverviewExpansion();
        focusPinned = false;
        return;
      }
      const need = ZOOM_MIN_K[focus.type] || 1.2;
      if (k >= need * 0.72) break;
      if (focus.type === 'hub' || !focus.parentId) {
        setOverviewExpansion();
        focusPinned = false;
        return;
      }
      const parent = nodeById.get(focus.parentId);
      if (!parent || parent.type === 'enterprise') {
        setOverviewExpansion();
        focusPinned = false;
        return;
      }
      setExpandedTo(parent.id);
      focusPinned = true;
    }
  }

  function updateBreadcrumbFromView() {
    if (flying) {
      renderBreadcrumb(focusNodeId);
      return;
    }
    renderBreadcrumb(overviewMode ? DATA.enterprise.id : focusNodeId);
  }

  function growFocusedChildren(node) {
    if (reduceMotion || !gNodes) return;
    // Spec §6.2 + springier bloom: stagger in with slight overshoot then settle
    const kids = (childrenOf.get(node.id) || []).filter((c) => c.type !== 'branch' && c.type !== 'artic');
    const deep = [];
    kids.forEach((c) => {
      deep.push(c);
      (childrenOf.get(c.id) || []).forEach((g) => {
        if (g.type !== 'branch' && g.type !== 'artic') deep.push(g);
      });
    });
    deep.forEach((c, i) => {
      c.grow = 0.28;
      const start = performance.now() + 80 + i * 38;
      const dur = 320;
      const anim = (now) => {
        const t = Math.max(0, Math.min(1, (now - start) / dur));
        const e = d3.easeCubicOut(t);
        c.grow = 0.28 + 0.72 * e;
        if (t < 1) requestAnimationFrame(anim);
        else c.grow = 1;
      };
      requestAnimationFrame(anim);
    });
  }

  function showStatusCard(hub) {
    const title = document.getElementById(DOM.leafCardTitle);
    const body = document.getElementById(DOM.leafCardBody);
    title.textContent = hub.bgLabel || hub.label;
    body.replaceChildren();
    const childCount = (childrenOf.get(hub.id) || []).filter((c) => c.type === 'area' || c.type === 'location').length;
    const rows = hub.comingSoon
      ? [
          ['Status', 'Coming soon'],
          ['Sites', String(childCount || 'reserved')],
          ['Note', 'Pilot hardware reserved — go-live pending'],
        ]
      : [
          ['Status', 'Planned'],
          ['Note', 'Expansion roadmap — no live machines yet'],
        ];
    rows.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'card-row';
      const kk = document.createElement('span');
      kk.className = 'k';
      kk.textContent = k;
      const vv = document.createElement('span');
      vv.className = 'v';
      vv.textContent = v;
      row.append(kk, vv);
      body.appendChild(row);
    });
    document.getElementById(DOM.leafCardTask).hidden = true;
    leafCard.hidden = false;
    leafCard.dataset.accent = hub.ring || 'teal';
  }

  function showRollupCard(node) {
    if (!UTILS) return;
    const r = UTILS.rollup(node, childrenOf);
    const title = document.getElementById(DOM.leafCardTitle);
    const body = document.getElementById(DOM.leafCardBody);
    title.textContent = node.label || node.bgLabel;
    body.replaceChildren();
    UTILS.kpiRows(r).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'card-row';
      const kk = document.createElement('span');
      kk.className = 'k';
      kk.textContent = k;
      const vv = document.createElement('span');
      vv.className = 'v';
      vv.textContent = v;
      row.append(kk, vv);
      body.appendChild(row);
    });
    document.getElementById(DOM.leafCardTask).hidden = true;
    leafCard.hidden = false;
    const hubId = node.type === 'hub' ? node.id : node.hubId;
    leafCard.dataset.accent = (UTILS.HUB_ACCENT[hubId] || node.ring || 'teal');
  }

  function onNodeClick(d) {
    // Interruptible: allow click mid-flight to redirect
    if (d.status === 'future' && d.type !== 'hub') return;
    if (d.type === 'branch') {
      setExpandedTo(d.machineId);
      focusPinned = true;
      applyLod();
      showLeafCard(d);
      renderBreadcrumb(d.machineId);
      return;
    }
    if (d.type === 'hub' && (d.comingSoon || d.planned || d.status === 'future')) {
      flyToNode(d);
      return;
    }
    if (d.type === 'area' || d.type === 'location' || d.type === 'hub') {
      flyToNode(d);
      if (d.type !== 'hub' || d.status === 'active') showRollupCard(d);
      return;
    }
    flyToNode(d);
  }

  // ——— card / task ———
  function showLeafCard(branchNode) {
    const m = branchNode.machine || nodeById.get(branchNode.machineId);
    document.getElementById(DOM.leafCardTitle).textContent = `${m.label} · ${branchNode.label}`;
    const body = document.getElementById(DOM.leafCardBody);
    body.replaceChildren();
    branchRows(branchNode.branchKey, m).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'card-row';
      const kk = document.createElement('span');
      kk.className = 'k';
      kk.textContent = k;
      const vv = document.createElement('span');
      vv.className = 'v';
      vv.textContent = v;
      row.append(kk, vv);
      body.appendChild(row);
    });
    const taskBtn = document.getElementById(DOM.leafCardTask);
    taskBtn.hidden = false;
    taskBtn.onclick = () =>
      openTask(m, branchNode.branchKey === 'technical' ? 'technician' : 'operator');
    leafCard.hidden = false;
    openBranchId = branchNode.id;
    const hubId = branchNode.hubId || m?.hubId;
    leafCard.dataset.accent = (UTILS && UTILS.HUB_ACCENT[hubId]) || 'teal';
    positionLeafCard(branchNode);
    // Re-measure after paint (double rAF) so cardH is real and discs are avoided
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (openBranchId === branchNode.id && !leafCard.hidden) positionLeafCard(branchNode);
      });
    });
    syncDomLabels();
  }

  /** Place card near the clicked node; thin leader; never cover any node disc */
  function positionLeafCard(branchNode) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    // Card is a sibling of the stage under the app shell — convert stage→app coords
    const stageRect = stage.getBoundingClientRect();
    const app = leafCard.offsetParent || leafCard.parentElement || document.body;
    const appRect = app.getBoundingClientRect();
    const ox = stageRect.left - appRect.left;
    const oy = stageRect.top - appRect.top;
    const s0 = worldToScreen(branchNode.x, branchNode.y);
    const s = { x: s0.x, y: s0.y }; // stage-local for collision + leader
    const cardW = Math.min(340, W - 32);
    const cardH = Math.min(320, Math.max(160, leafCard.offsetHeight || 220));
    // Visible disc + soft glow halo — card must clear the glowing orb, not just the core
    const CLEAR = 28;
    const discs = [];
    nodes.forEach((n) => {
      if (!n.draw || n.ancestorOnly || n.lodAlpha < 0.05 || n.pad) return;
      const p = worldToScreen(n.x, n.y);
      // Skip far off-stage discs (collapsed/unfocused machines)
      if (p.x < -80 || p.y < -80 || p.x > W + 80 || p.y > H + 80) return;
      const core = nodeScreenRadius(n) * (n.grow == null ? 1 : n.grow);
      const rr = Math.max(22, core + CLEAR);
      discs.push({ x: p.x, y: p.y, r: rr, id: n.id });
    });
    function discHits(left, top) {
      let hits = 0;
      let near = 0;
      discs.forEach((d) => {
        const cx = Math.max(left, Math.min(d.x, left + cardW));
        const cy = Math.max(top, Math.min(d.y, top + cardH));
        const dist = Math.hypot(d.x - cx, d.y - cy);
        if (dist < d.r) hits += 1;
        else if (dist < d.r + 22) near += 1;
      });
      return { hits, near };
    }
    function score(left, top) {
      const { hits, near } = discHits(left, top);
      // Hard preference: zero disc intersections
      let sc = hits === 0 ? 10000 : -hits * 2000;
      sc -= near * 120;
      if (left < 12 || left + cardW > W - 12) sc -= 200;
      if (top < 12 || top + cardH > H - 12) sc -= 200;
      // Prefer near the branch (short leader) and inward of the fan
      const ccx = left + cardW / 2;
      const ccy = top + cardH / 2;
      sc -= Math.hypot(ccx - s.x, ccy - s.y) * 0.15;
      return sc;
    }
    const parent = branchNode.parentId ? nodeById.get(branchNode.parentId) : null;
    const pScreen = parent ? worldToScreen(parent.x, parent.y) : null;
    const inwardLeft = pScreen ? pScreen.x < s.x : true;
    const gaps = [56, 72, 96, 128, 168, 210];
    const candidates = [];
    gaps.forEach((gap) => {
      const sides = inwardLeft
        ? [
            { left: s.x - cardW - gap, top: s.y - cardH / 2 },
            { left: s.x - cardW - gap, top: s.y - cardH - gap * 0.35 },
            { left: s.x - cardW - gap, top: s.y + gap * 0.35 },
            { left: s.x + gap, top: s.y - cardH / 2 },
          ]
        : [
            { left: s.x + gap, top: s.y - cardH / 2 },
            { left: s.x + gap, top: s.y - cardH - gap * 0.35 },
            { left: s.x + gap, top: s.y + gap * 0.35 },
            { left: s.x - cardW - gap, top: s.y - cardH / 2 },
          ];
      sides.forEach((c) => candidates.push(c));
      candidates.push(
        { left: s.x - cardW / 2, top: s.y - cardH - gap },
        { left: s.x - cardW / 2, top: s.y + gap },
        { left: s.x + gap, top: s.y - cardH - gap },
        { left: s.x - cardW - gap, top: s.y - cardH - gap },
        { left: s.x + gap, top: s.y + gap },
        { left: s.x - cardW - gap, top: s.y + gap }
      );
    });
    // Dense grid fallback around the node (covers crowded branch fans)
    for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 10) {
      for (let rad = 80; rad <= 260; rad += 40) {
        candidates.push({
          left: s.x + Math.cos(ang) * rad - cardW / 2,
          top: s.y + Math.sin(ang) * rad - cardH / 2,
        });
      }
    }
    let best = candidates[0];
    let bestScore = -Infinity;
    candidates.forEach((c) => {
      c.left = Math.max(12, Math.min(W - cardW - 12, c.left));
      c.top = Math.max(12, Math.min(H - cardH - 12, c.top));
      const sc = score(c.left, c.top);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    });
    // Write in app-shell coordinates (header offset)
    leafCard.style.left = `${best.left + ox}px`;
    leafCard.style.top = `${best.top + oy}px`;
    leafCard.style.transform = 'none';
    leafCard.style.width = `${cardW}px`;
    // Leader line from node to nearest card edge (stage-local)
    let leader = document.getElementById('leaf-card-leader');
    if (!leader) {
      leader = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      leader.id = 'leaf-card-leader';
      leader.setAttribute('class', 'leaf-card-leader');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'leaf-card-leader-line');
      leader.appendChild(line);
      stage.appendChild(leader);
    }
    leader.setAttribute('width', String(W));
    leader.setAttribute('height', String(H));
    leader.style.display = '';
    const line = leader.querySelector('line');
    // Target: mid of nearest card side
    const cx = best.left + cardW / 2;
    const cy = best.top + cardH / 2;
    let tx = best.left;
    let ty = cy;
    if (Math.abs(s.x - (best.left + cardW)) < Math.abs(s.x - best.left)) tx = best.left + cardW;
    if (Math.abs(s.y - best.top) < Math.abs(s.y - (best.top + cardH)) && Math.abs(s.y - best.top) < Math.abs(s.x - tx)) {
      tx = cx;
      ty = best.top;
    } else if (Math.abs(s.y - (best.top + cardH)) < Math.abs(s.x - tx)) {
      tx = cx;
      ty = best.top + cardH;
    }
    line.setAttribute('x1', String(s.x));
    line.setAttribute('y1', String(s.y));
    line.setAttribute('x2', String(tx));
    line.setAttribute('y2', String(ty));
  }

  function branchRows(key, m) {
    if (key === 'revenue') {
      return [
        ['Today', `${m.revenue.today} KWD`],
        ['Daily avg', `${m.revenue.dailyAvg} KWD`],
        ['Monthly', `${m.revenue.monthly} KWD`],
        ['Cash / Digital', `${m.revenue.cashPct}% / ${m.revenue.digitalPct}%`],
      ];
    }
    if (key === 'operators') {
      const p = people[m.operatorId];
      return [
        ['Operator', p?.name || '—'],
        ['Contact', p?.phone || '—'],
        ['Last visit', m.operators?.lastVisit || '—'],
      ];
    }
    if (key === 'technical') {
      const p = people[m.technicianId];
      return [
        ['Technician', p?.name || '—'],
        ['Open tickets', String(m.technical?.openTickets ?? 0)],
        ['Last maintenance', m.technical?.lastMaintenance || '—'],
      ];
    }
    if (key === 'stock') {
      return [
        ['Fill', `${m.stock.fillPct}%`],
        ['Top products', (m.stock.topProducts || []).join(', ')],
        ['Peak hours', m.stock.peakHours || '—'],
      ];
    }
    if (key === 'contract') {
      return [
        ['Vendor', m.contract.vendor],
        ['Lease', m.contract.lease],
        ['Renewal', m.contract.renewal],
      ];
    }
    return [];
  }

  function closeLeafCard() {
    leafCard.hidden = true;
    openBranchId = null;
    const leader = document.getElementById('leaf-card-leader');
    if (leader) leader.style.display = 'none';
    syncDomLabels();
  }

  let taskCtx = {};
  function openTask(machine, role) {
    closeLeafCard();
    const personId = role === 'technician' ? machine.technicianId : machine.operatorId;
    const person = people[personId];
    taskCtx = { person, machine, role };
    const assigneeEl = document.getElementById(DOM.taskAssignee);
    if (assigneeEl) {
      if ('value' in assigneeEl && assigneeEl.tagName !== 'SPAN') assigneeEl.value = person?.name || 'unassigned';
      else assigneeEl.textContent = person?.name || 'unassigned';
    }
    const descEl = document.getElementById(DOM.taskDesc);
    if (descEl) descEl.value = '';
    const logEl = document.getElementById(DOM.taskLog);
    if (logEl) logEl.textContent = '';
    taskOverlay.hidden = false;
    if (descEl) descEl.focus();
  }
  function closeTask() {
    taskOverlay.hidden = true;
  }
  async function sendTask() {
    const text = document.getElementById(DOM.taskDesc).value.trim();
    const log = document.getElementById(DOM.taskLog);
    if (!text) {
      log.textContent = 'Write a plain-language task first.';
      return;
    }
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeId: taskCtx.person?.id,
          assigneeName: taskCtx.person?.name,
          machineId: taskCtx.machine?.id,
          role: taskCtx.role,
          task: text,
        }),
      });
    } catch {
      /* mock */
    }
    log.textContent = TASK_UI === 'terminal'
      ? `> task dispatched to ${(taskCtx.person?.name || 'assignee')}'s mobile inbox`
      : `Task dispatched to ${(taskCtx.person?.name || 'assignee')}'s mobile inbox`;
  }

  // ——— particle core (~2.5× larger galaxy + spiral drift) ———
  let pctx;
  let coreParticles = [];
  let dust = [];
  let nebulae = [];
  let lastTs = 0;
  const aposWordmark = new Image();
  aposWordmark.src = 'assets/apos-wordmark.png';
  let aposWordmarkReady = false;
  aposWordmark.onload = () => { aposWordmarkReady = true; };

  function resizeParticles() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    particleCanvas.width = Math.floor(w * dpr);
    particleCanvas.height = Math.floor(h * dpr);
    particleCanvas.style.width = `${w}px`;
    particleCanvas.style.height = `${h}px`;
    pctx = particleCanvas.getContext('2d');
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Galaxy stays inside hub ring; ~18–22% screen but never past CORE_WORLD_R
    const coreR = Math.min(CORE_WORLD_R, Math.max(72, Math.min(w, h) * 0.18));
    coreParticles = [];
    const nCore = GEMINI ? 120 : Math.floor(980 + coreR * 4);
    for (let i = 0; i < nCore; i++) {
      if (GEMINI) {
        // Spec: r 32–68 screen-ish → world via coreR scale; log-spiral + Brownian
        const t = i / Math.max(nCore - 1, 1);
        const rad = coreR * (0.28 + 0.55 * t);
        const spiral = t * Math.PI * 4 + (i % 5) * 0.35;
        coreParticles.push({
          ox: Math.cos(spiral) * rad,
          oy: Math.sin(spiral) * rad,
          oz: (Math.random() - 0.5) * coreR * 0.2,
          r: 0.55 + Math.random() * 1.2,
          tint: (() => {
            if (THEME === 'space') return Math.random() < 0.3 ? 'mint' : 'cyan';
            return Math.random() < 0.3 ? 'pink' : 'white';
          })(),
          pink: false,
          phase: Math.random() * Math.PI * 2,
          speed: 0.015,
          spin: 0.015,
          brown: 0.4,
          arm0: spiral,
          rad0: rad,
        });
      } else {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const arm = (i % 3) * ((2 * Math.PI) / 3);
        const spiral = arm + theta * 0.35;
        const rad = Math.pow(Math.random(), 0.55) * coreR;
        coreParticles.push({
          ox: rad * Math.sin(phi) * Math.cos(spiral),
          oy: rad * Math.sin(phi) * Math.sin(spiral),
          oz: rad * Math.cos(phi) * 0.55,
          r: 0.45 + Math.random() * 1.55,
          pink: Math.random() < 0.2,
          phase: Math.random() * Math.PI * 2,
          speed: 0.12 + Math.random() * 0.32,
          spin: 0.08 + Math.random() * 0.18,
          arm0: spiral,
          rad0: rad,
        });
      }
    }
    dust = [];
    nebulae = [];
    // Tree: soft dust. Space: multi-layer parallax starfield
    if (THEME === 'space') {
      // Gemini: ~250 stars on a 2× plane, parallax ~0.2× camera
      const layers = [
        { n: 90, r: [0.3, 0.9], a: [0.15, 0.35], parallax: 0.12 },
        { n: 100, r: [0.4, 1.15], a: [0.18, 0.42], parallax: 0.2 },
        { n: 60, r: [0.55, 1.5], a: [0.22, 0.5], parallax: 0.28 },
      ];
      layers.forEach((L, li) => {
        for (let i = 0; i < L.n; i++) {
          dust.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: L.r[0] + Math.random() * (L.r[1] - L.r[0]),
            a: L.a[0] + Math.random() * (L.a[1] - L.a[0]),
            tw: Math.random() * Math.PI * 2,
            twSpeed: 0.25 + Math.random() * 0.7,
            parallax: L.parallax,
            layer: li,
          });
        }
      });
      // Muted indigo / teal nebulae
      nebulae.push(
        { x: w * 0.22, y: h * 0.32, rx: w * 0.28, ry: h * 0.22, rgb: [55, 70, 130], a: 0.14 },
        { x: w * 0.74, y: h * 0.58, rx: w * 0.26, ry: h * 0.2, rgb: [30, 90, 100], a: 0.11 },
        { x: w * 0.48, y: h * 0.72, rx: w * 0.22, ry: h * 0.16, rgb: [60, 45, 110], a: 0.09 }
      );
    } else {
      const n = Math.min(180, Math.max(120, Math.floor((w * h) / 11000)));
      for (let i = 0; i < n; i++) {
        dust.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.2,
          a: 0.12 + Math.random() * 0.4,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.4 + Math.random() * 0.9,
          parallax: 0.1 + Math.random() * 0.14,
        });
      }
    }
  }

  
  function accentRgb(key) {
    const m = { teal:[110,212,208], violet:[184,160,232], rose:[232,160,184], pink:[232,160,184], amber:[232,192,120], sky:[126,200,232] };
    return m[key] || m.teal;
  }

  function finitePos(n) {
    return !!(n && Number.isFinite(n.x) && Number.isFinite(n.y));
  }

  /** Core is on the first paint; children bloom in and finish by ~1.2s. */
  function revealScale(n) {
    if (reduceMotion || !n || n.type === 'enterprise') return 1;
    const delay = 120 + (n.depth || 1) * 150 + (hash(String(n.id)) % 5) * 26;
    const dur = 260;
    const t = performance.now() - (revealT0 || 0);
    if (t >= delay + dur || t >= 1400) return 1;
    if (t < delay) return 0;
    const u = Math.min(1, (t - delay) / dur);
    const e = 1 - Math.pow(1 - u, 3);
    return 0.28 + 0.72 * e;
  }

  function screenOf(n) {
    const s = { x: n.x * transform.k + transform.x, y: n.y * transform.k + transform.y };
    // Gentle bob in screen pixels only — world layout, links' topology, and fit stay put
    if (!reduceMotion && n && n.id && n.type && n.type !== 'enterprise' && n.type !== 'packet') {
      const ph = (hash(String(n.id)) % 628) / 100;
      const t = (lastTs || 0) / 1000;
      s.x += Math.cos(t * 0.63 + ph) * 2.2;
      s.y += Math.sin(t * 0.85 + ph * 1.17) * 2.6;
    }
    return s;
  }

  function cachedCubic(s, t, cc, steps, dir) {
    const key = `${s.id}|${t.id}|${dir || 'f'}|${steps}|${s.x | 0}|${s.y | 0}|${t.x | 0}|${t.y | 0}`;
    let pts = cubicCache.get(key);
    if (!pts) {
      pts = sampleCubic(s.x, s.y, cc.c1x, cc.c1y, cc.c2x, cc.c2y, t.x, t.y, steps);
      if (cubicCache.size > 480) cubicCache.clear();
      cubicCache.set(key, pts);
    }
    return pts;
  }

  function nodeMatchesFilter(n) {
    if (!n || n.type !== 'machine') return false;
    if (filterMode === 'alerts') return !!n.alert;
    if (filterMode === 'offline') return n.status === 'offline' || (n.offlineHours || 0) >= (THRESH?.offlineHours || 2);
    if (filterMode === 'lowstock') return n.status !== 'unknown' && !n.stale && (n.stock?.fillPct ?? 100) < (THRESH?.stockLowPct || 15);
    if (filterMode === 'unknown') return n.status === 'unknown' || !!n.stale;
    if (filterMode === 'critical') return n.status === 'offline' || n.alert === 'red';
    return true;
  }

  function refreshFilter() {
    filterHot = new Set();
    if (filterMode === 'all') return;
    nodes.forEach((n) => {
      if (!nodeMatchesFilter(n)) return;
      pathToRoot(n.id).forEach((id) => filterHot.add(id));
    });
  }

  function filterFade(id) {
    if (filterMode === 'all') return 1;
    return filterHot.has(id) ? 1 : 0.2;
  }

  function shownRevenue(n) {
    if (!n) return null;
    if (n.revenue && n.revenue.today != null) {
      if (!n._revT0 || reduceMotion) return n.revenue.today;
      const u = Math.min(1, (performance.now() - n._revT0) / 640);
      const from = n._revFrom != null ? n._revFrom : n.revenue.today;
      return Math.round((from + (n.revenue.today - from) * u) * 10) / 10;
    }
    return n.rollup?.revenueToday ?? null;
  }

  function shownStock(n) {
    if (n?.stock?.fillPct != null) return n.stock.fillPct;
    if (n?.type === 'machine' || !UTILS) return null;
    const ms = UTILS.walkMachines(n, childrenOf);
    if (!ms.length) return null;
    const avg = ms.reduce((s, m) => s + (m.stock?.fillPct ?? 0), 0) / ms.length;
    return Math.round(avg);
  }

  function pathLabel(n) {
    const parts = [];
    let c = n;
    while (c) {
      if (c.type !== 'enterprise') parts.unshift(c.label || c.bgLabel || c.id);
      c = c.parentId ? nodeById.get(c.parentId) : null;
    }
    return parts.join(' · ');
  }

  let dataRefreshedAt = Date.now();
  let pinnedIncident = null;
  let healthRingParts = [];

  function currentFleet() {
    const snap = UTILS
      ? UTILS.fleetSnapshot(machines, liveLog)
      : { online: 0, offline: 0, low: 0, unknown: 0, critical: 0, revenueToday: 0, availability: 100, openIncidents: [], machinesOfflineNow: [], history: liveLog };
    healthRingParts = [
      { key: 'online', n: snap.online || 0, color: '94, 214, 176' },
      { key: 'offline', n: snap.offline || 0, color: '255, 107, 122' },
      { key: 'low', n: snap.low || 0, color: '232, 192, 120' },
      { key: 'unknown', n: snap.unknown || 0, color: '148, 163, 184' },
    ].filter((seg) => seg.n > 0);
    return snap;
  }

  function publishFleet() {
    const snap = currentFleet();
    const crumb = document.getElementById('crumb-list');
    if (crumb) crumb.dataset.offline = String(snap.offline || 0);
    try { stage?.dispatchEvent(new CustomEvent('apos-fleet-sync', { detail: snap })); } catch (_) { /* paint */ }
    return snap;
  }

  function statusLabel(n) {
    if (!n) return '—';
    if (n.status === 'unknown' || n.stale) return 'unknown';
    if (n.alert === 'red' || n.status === 'offline') return 'offline';
    if (n.alert) return 'alert';
    if ((n.stock?.fillPct ?? 100) < (THRESH?.stockLowPct || 15)) return 'low stock';
    if (n.status === 'future' || n.planned) return 'planned';
    if (n.comingSoon) return 'soon';
    return n.status || 'ok';
  }

  /** Clip a screen-space segment to the stage; returns endpoints + which end hit the edge. */
  function clipLineToStage(x0, y0, x1, y1, pad = 28) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const L = pad, R = w - pad, T = pad + 48, B = h - pad - 40;
    const inside = (x, y) => x >= L && x <= R && y >= T && y <= B;
    if (inside(x0, y0) && inside(x1, y1)) {
      return { ax: x0, ay: y0, bx: x1, by: y1, clipped: false, edgeHit: null };
    }
    // Parametric clip against padded rect (Liang-Barsky-ish)
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const clips = [
      [-dx, x0 - L], [dx, R - x0], [-dy, y0 - T], [dy, B - y0],
    ];
    for (let i = 0; i < 4; i++) {
      const p = clips[i][0], q = clips[i][1];
      if (p === 0) {
        if (q < 0) return null;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
    const ax = x0 + t0 * dx, ay = y0 + t0 * dy;
    const bx = x0 + t1 * dx, by = y0 + t1 * dy;
    let edgeHit = null;
    const near = (x, y) => {
      if (Math.abs(x - L) < 1.5) return 'left';
      if (Math.abs(x - R) < 1.5) return 'right';
      if (Math.abs(y - T) < 1.5) return 'top';
      if (Math.abs(y - B) < 1.5) return 'bottom';
      return null;
    };
    if (!inside(x0, y0)) edgeHit = { x: ax, y: ay, side: near(ax, ay) || 'edge', towardCore: true };
    else if (!inside(x1, y1)) edgeHit = { x: bx, y: by, side: near(bx, by) || 'edge', towardCore: true };
    return { ax, ay, bx, by, clipped: true, edgeHit };
  }

  function ensureAposEdgeChip() {
    let el = document.getElementById('apos-edge-chip');
    if (el) return el;
    el = document.createElement('button');
    el.id = 'apos-edge-chip';
    el.type = 'button';
    el.className = 'apos-edge-chip';
    el.textContent = 'APOS';
    el.title = 'Fly to APOS';
    el.hidden = true;
    el.addEventListener('click', () => {
      const core = nodeById.get(DATA.enterprise.id);
      if (core) flyToNode(core);
      else flyToGalaxy();
    });
    (stage || document.body).appendChild(el);
    return el;
  }

  function syncAposEdgeChip() {
    const el = ensureAposEdgeChip();
    if (overviewMode || !aposEdgeHint) {
      el.hidden = true;
      return;
    }
    // Never glue an APOS pill under the focused node — require a real spine run
    const focus = nodeById.get(focusNodeId);
    if (focus) {
      const fp = screenOf(focus);
      const dist = Math.hypot(aposEdgeHint.x - fp.x, aposEdgeHint.y - fp.y);
      if (dist < 96) {
        el.hidden = true;
        return;
      }
    }
    el.hidden = false;
    el.style.left = `${aposEdgeHint.x}px`;
    el.style.top = `${aposEdgeHint.y}px`;
  }

  /** Sample a screen-space cubic and find where it leaves the padded stage (for edge chip). */
  function curveEdgeExit(x0, y0, c1x, c1y, c2x, c2y, x1, y1, pad = 28) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const L = pad, R = w - pad, T = pad + 48, B = h - pad - 40;
    const inside = (x, y) => x >= L && x <= R && y >= T && y <= B;
    const steps = 36;
    let prevIn = inside(x0, y0);
    let px = x0, py = y0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
      const y = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
      const nowIn = inside(x, y);
      if (prevIn && !nowIn) {
        // Lerp to the padded boundary
        let ax = px, ay = py, bx = x, by = y;
        for (let j = 0; j < 8; j++) {
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (inside(mx, my)) { ax = mx; ay = my; }
          else { bx = mx; by = my; }
        }
        const hx = (ax + bx) / 2, hy = (ay + by) / 2;
        let side = 'edge';
        if (Math.abs(hx - L) <= Math.abs(hx - R) && Math.abs(hx - L) <= Math.abs(hy - T) && Math.abs(hx - L) <= Math.abs(hy - B)) side = 'left';
        else if (Math.abs(hx - R) <= Math.abs(hy - T) && Math.abs(hx - R) <= Math.abs(hy - B)) side = 'right';
        else if (Math.abs(hy - T) <= Math.abs(hy - B)) side = 'top';
        else side = 'bottom';
        return { x: hx, y: hy, side };
      }
      prevIn = nowIn;
      px = x; py = y;
    }
    return null;
  }


  const HEALTH_RGB = {
    healthy: '94, 214, 176',
    warning: '232, 192, 120',
    critical: '255, 107, 122',
    offline: '255, 107, 122',
    unknown: '148, 163, 184',
    planned: '154, 168, 188',
  };

  function traceTypeShape(ctx, x, y, r, type) {
    ctx.beginPath();
    if (type === 'client') {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.86, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.86, y);
      ctx.closePath();
    } else if (type === 'area') {
      ctx.rect(x - r * 0.82, y - r * 0.82, r * 1.64, r * 1.64);
    } else if (type === 'location') {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  function strokeStatusRing(ctx, x, y, r, n, alpha, ts) {
    const health = UTILS ? UTILS.healthOf(n) : 'healthy';
    const col = HEALTH_RGB[health] || HEALTH_RGB.unknown;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = health === 'planned' ? 1.2 : 2;
    if (health === 'planned') ctx.setLineDash([3, 3]);
    ctx.strokeStyle = `rgba(${col}, ${(health === 'healthy' ? 0.8 : 0.95) * alpha})`;
    ctx.stroke();
    ctx.setLineDash([]);
    if ((health === 'critical' || health === 'offline') && !reduceMotion) {
      const beat = 0.5 + 0.5 * Math.sin((ts || 0) / 520 + (hash(n.id) % 20));
      ctx.beginPath();
      ctx.arc(x, y, r + 3 + beat * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col}, ${(0.15 + 0.35 * (1 - beat)) * alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function pillTextFor(n) {
    if (!n || !n.draw || n.preview || n.pad || n.type === 'enterprise' || n.type === 'branch') return '';
    const health = UTILS ? UTILS.healthOf(n) : 'healthy';
    if (n.type === 'machine') {
      if (health === 'offline') return 'OFFLINE';
      if (health === 'unknown') return 'UNKNOWN';
      if (health === 'warning') return 'LOW';
      if (health === 'critical') return 'ALERT';
      return '';
    }
    if (health === 'planned') {
      if (n.summary) return '';
      if (n.type === 'country' || n.type === 'hub' || n.type === 'client') return 'Planned';
      return '';
    }
    if ((n.alertCount || 0) > 0) return String(n.alertCount);
    return '';
  }

  /** Simple white line icons inside hub discs (brand glyphs) */
  function drawHubGlyph(ctx, x, y, s, hubId, alpha) {
    ctx.save();
    s = s * 1.15;
    ctx.strokeStyle = `rgba(255,255,255,${0.98 * alpha})`;
    ctx.fillStyle = `rgba(255,255,255,${0.98 * alpha})`;
    ctx.lineWidth = Math.max(1.8, s * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const id = (hubId || '').toLowerCase();
    ctx.beginPath();
    if (id.includes('leet')) {
      // building / club
      const w = s * 0.7, h = s * 0.75;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.moveTo(x - w * 0.18, y + h / 2); ctx.lineTo(x - w * 0.18, y + h * 0.05);
      ctx.moveTo(x + w * 0.18, y + h / 2); ctx.lineTo(x + w * 0.18, y + h * 0.05);
      ctx.moveTo(x - w * 0.28, y - h * 0.15); ctx.lineTo(x - w * 0.08, y - h * 0.15);
      ctx.moveTo(x + w * 0.08, y - h * 0.15); ctx.lineTo(x + w * 0.28, y - h * 0.15);
    } else if (id.includes('ee') || id.includes('retail')) {
      // storefront
      ctx.moveTo(x - s * 0.4, y + s * 0.35);
      ctx.lineTo(x - s * 0.4, y - s * 0.05);
      ctx.lineTo(x, y - s * 0.4);
      ctx.lineTo(x + s * 0.4, y - s * 0.05);
      ctx.lineTo(x + s * 0.4, y + s * 0.35);
      ctx.closePath();
      ctx.moveTo(x - s * 0.12, y + s * 0.35); ctx.lineTo(x - s * 0.12, y + s * 0.05);
      ctx.lineTo(x + s * 0.12, y + s * 0.05); ctx.lineTo(x + s * 0.12, y + s * 0.35);
    } else if (id.includes('park')) {
      // tree
      ctx.moveTo(x, y + s * 0.4); ctx.lineTo(x, y - s * 0.05);
      ctx.moveTo(x, y - s * 0.05);
      ctx.lineTo(x - s * 0.32, y + s * 0.15);
      ctx.moveTo(x, y - s * 0.05);
      ctx.lineTo(x + s * 0.32, y + s * 0.15);
      ctx.moveTo(x, y - s * 0.2);
      ctx.arc(x, y - s * 0.28, s * 0.22, 0.2 * Math.PI, 0.8 * Math.PI);
    } else if (id.includes('sa')) {
      // dunes / planned
      ctx.moveTo(x - s * 0.4, y + s * 0.2);
      ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.15, x + s * 0.15, y + s * 0.1);
      ctx.quadraticCurveTo(x + s * 0.3, y + s * 0.25, x + s * 0.42, y + s * 0.05);
      ctx.moveTo(x - s * 0.2, y + s * 0.35);
      ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.1, x + s * 0.35, y + s * 0.3);
    } else {
      // AE / default: landmark pin
      ctx.arc(x, y - s * 0.12, s * 0.22, 0, Math.PI * 2);
      ctx.moveTo(x, y + s * 0.1); ctx.lineTo(x, y + s * 0.38);
      ctx.moveTo(x - s * 0.18, y + s * 0.38); ctx.lineTo(x + s * 0.18, y + s * 0.38);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Spec §4–6: canvas composite of links, nodes, badges, glow on the world canvas */
  let linkDrawStats = { count: 0, minOp: 1, maxOp: 0 };

  function drawBranchGlyph(ctx, x, y, s, key, alpha) {
    ctx.save();
    // Dark line icons on white discs (white-on-white was invisible)
    ctx.strokeStyle = `rgba(36, 32, 68,${0.92 * alpha})`;
    ctx.fillStyle = `rgba(36, 32, 68,${0.92 * alpha})`;
    ctx.lineWidth = Math.max(1.6, s * 0.18);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (key === 'revenue') {
      ctx.moveTo(x - s * 0.35, y + s * 0.3);
      ctx.lineTo(x - s * 0.1, y - s * 0.05);
      ctx.lineTo(x + s * 0.05, y + s * 0.1);
      ctx.lineTo(x + s * 0.35, y - s * 0.3);
    } else if (key === 'operators') {
      ctx.arc(x, y - s * 0.18, s * 0.18, 0, Math.PI * 2);
      ctx.moveTo(x - s * 0.32, y + s * 0.35);
      ctx.quadraticCurveTo(x, y + s * 0.05, x + s * 0.32, y + s * 0.35);
    } else if (key === 'technical') {
      ctx.moveTo(x - s * 0.25, y + s * 0.25);
      ctx.lineTo(x + s * 0.1, y - s * 0.1);
      ctx.arc(x + s * 0.18, y - s * 0.18, s * 0.16, 0.2 * Math.PI, 1.6 * Math.PI);
    } else if (key === 'stock') {
      ctx.strokeRect(x - s * 0.28, y - s * 0.22, s * 0.56, s * 0.5);
      ctx.moveTo(x - s * 0.28, y - s * 0.05); ctx.lineTo(x + s * 0.28, y - s * 0.05);
    } else {
      // contract
      ctx.strokeRect(x - s * 0.28, y - s * 0.32, s * 0.56, s * 0.64);
      ctx.moveTo(x - s * 0.14, y - s * 0.1); ctx.lineTo(x + s * 0.14, y - s * 0.1);
      ctx.moveTo(x - s * 0.14, y + s * 0.08); ctx.lineTo(x + s * 0.18, y + s * 0.08);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFlowEvents(ts) {
    if (reduceMotion || !flowEvents.length || !pctx) return;
    for (let i = flowEvents.length - 1; i >= 0; i--) {
      const ev = flowEvents[i];
      ev.u += ev.speed;
      if (ev.u >= 1) { flowEvents.splice(i, 1); continue; }
      const path = ev.path;
      const hops = path.length - 1;
      if (hops < 1) continue;
      const f = ev.u * hops;
      const hi = Math.min(hops - 1, Math.floor(f));
      const local = f - hi;
      const a = nodeById.get(path[hi]);
      const b = nodeById.get(path[hi + 1]);
      if (!finitePos(a) || !finitePos(b)) continue;
      const cc = curveControls(a, b, 'tree');
      const pts = cachedCubic(a, b, cc, 16, 'ev');
      const idx = Math.min(pts.length - 1, Math.floor(local * (pts.length - 1)));
      const sx = pts[idx][0] * transform.k + transform.x;
      const sy = pts[idx][1] * transform.k + transform.y;
      const rgb = ev.rgb;
      pctx.beginPath();
      pctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
      pctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.96)`;
      pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.85)`;
      pctx.shadowBlur = 10;
      pctx.fill();
      pctx.shadowBlur = 0;
    }
  }

  function drawWorldScene(ts) {
    if (!pctx || !particleCanvas) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    pctx.save();
    const focus = nodeById.get(focusNodeId);
    if (!overviewMode && focus && focus.type !== 'enterprise') {
      const usable = viewportFitRect({ reserveDrawer: true });
      pctx.beginPath();
      pctx.rect(0, 0, usable.x + usable.w, h);
      pctx.clip();
    }
    const focusPath = new Set(pathToRoot(focusNodeId));
    const focusHubId = focus?.type === 'hub' ? focus.id : focus?.hubId;
    const accent = focusHubId ? accentRgb((UTILS && UTILS.HUB_ACCENT[focusHubId]) || nodeById.get(focusHubId)?.ring || 'teal') : null;
    const localIds = new Set((focus ? localFrameNodes(focus) : []).map((n) => n.id));

    // ——— Curved links: continuous ancestor path + dimmed context (no broken stubs) ———
    linkDrawStats = { count: 0, minOp: 1, maxOp: 0 };
    aposEdgeHint = null;
    const hoverHotDraw = hoverId ? hoverRelatedIds(hoverId) : null;
    const crumbHot = crumbHoverId ? new Set(pathToRoot(crumbHoverId)) : null;
    const restore = contextRestoreT();
    const pathPackets = [];
    links.forEach((L) => {
      const s = nodeById.get(L.source);
      const t = nodeById.get(L.target);
      if (!finitePos(s) || !finitePos(t)) return;
      if (L.kind === 'signal') return; // drawn in signal pass
      if (revealScale(s) <= 0 || revealScale(t) <= 0) return;
      // Hex mode: no tree/spine/leaf links at all unless hovering a related path
      if (layoutMode === 'hex') {
        if (!hoverId || !hoverHotDraw) return;
        if (!(hoverHotDraw.has(L.source) && hoverHotDraw.has(L.target))) return;
        if (L.kind === 'spine') return;
      }

      const onPath = focusPath.has(L.source) && focusPath.has(L.target);
      // Ghost siblings are outlines only — a spoke through them reads as a line under the label.
      if (s.ghost || t.ghost) return;
      if (focus?.type === 'machine' && onPath) {
        const siteId = focus.parentId;
        const near = (id) => id === focus.id || id === siteId;
        if (!(near(s.id) && near(t.id))) return;
      }
      const crumbPath = !!(crumbHot && crumbHot.has(L.source) && crumbHot.has(L.target));
      // Always draw the focus→…→APOS chain; context links when both ends are drawn
      if (!onPath && !crumbPath) {
        if (!s.draw || !t.draw) return;
        // Skip deep-deep context noise (branch links of non-focus)
        if (L.kind === 'leaf' || s.type === 'branch' || t.type === 'branch') return;
      }

      const a0 = screenOf(s);
      const b0 = screenOf(t);
      const preview = !!(s.preview || t.preview) && !onPath;
      const future = s.status === 'future' || t.status === 'future';

      let op;
      if (overviewMode) {
        // Overview stays bright (prior constellation look)
        op = onPath ? 0.9 : preview ? 0.28 : (L.kind === 'spine' ? 0.42 : 0.55);
        if (future && !onPath) op = Math.min(op, 0.35);
      } else if (onPath || crumbPath) {
        op = crumbPath && !onPath ? 0.95 : 0.92;
      } else if (preview) {
        // Match space map dimmed context (~0.25)
        op = 0.25 + 0.2 * restore;
      } else {
        op = (L.kind === 'spine' ? 0.28 : 0.22) + 0.3 * restore;
      }
      if (future && !onPath && !overviewMode) op = Math.min(op, 0.28);
      if (hoverHotDraw && !(hoverHotDraw.has(L.source) && hoverHotDraw.has(L.target)) && !onPath) {
        op = Math.min(op, 0.05);
      }
      if (filterMode !== 'all' && !filterHot.has(s.id) && !filterHot.has(t.id)) op *= 0.22;
      if (op < 0.04) return;

      linkDrawStats.count++;
      linkDrawStats.minOp = Math.min(linkDrawStats.minOp, op);
      linkDrawStats.maxOp = Math.max(linkDrawStats.maxOp, op);

      const cc = curveControls(s, t, L.kind);
      // Always draw the full cubic — canvas clips visually; keeps a continuous curve to the edge
      const ax = a0.x, ay = a0.y, bx = b0.x, by = b0.y;
      const c1x = cc.c1x * transform.k + transform.x;
      const c1y = cc.c1y * transform.k + transform.y;
      const c2x = cc.c2x * transform.k + transform.x;
      const c2y = cc.c2y * transform.k + transform.y;

      // Edge chip at the true curve exit toward APOS (prefer the core-most hop)
      if (onPath && !overviewMode) {
        const coreIsS = s.type === 'enterprise' || (s.depth != null && t.depth != null && s.depth < t.depth);
        const touchesCore = s.type === 'enterprise' || t.type === 'enterprise';
        const exit = coreIsS
          ? curveEdgeExit(bx, by, c2x, c2y, c1x, c1y, ax, ay, 32)
          : curveEdgeExit(ax, ay, c1x, c1y, c2x, c2y, bx, by, 32);
        if (exit) {
          const depthRank = Math.min(s.depth ?? 99, t.depth ?? 99);
          const prevRank = aposEdgeHint?.depthRank ?? 99;
          if (touchesCore || depthRank <= prevRank) {
            aposEdgeHint = { x: exit.x, y: exit.y, side: exit.side, depthRank: touchesCore ? -1 : depthRank };
          }
        }
      }

      const fromHub = s.type === 'hub' || t.type === 'hub' || s.type === 'country' || t.type === 'country';
      const hubNode = (s.type === 'hub' || s.type === 'country') ? s : ((t.type === 'hub' || t.type === 'country') ? t : null);
      const firstHopRgb = hubNode ? accentRgb(hubNode.ring || 'teal') : null;
      let rgb = [226, 236, 248];
      const depthRank = Math.min(s.depth ?? 0, t.depth ?? 0);
      const byLevel = [2.7, 2.15, 1.55, 1.05, 0.7, 0.45];
      let lineW = byLevel[Math.min(depthRank, byLevel.length - 1)];
      if (onPath || crumbPath) {
        rgb = accent || [0, 210, 230];
        lineW += 0.55;
      } else if (fromHub && firstHopRgb && L.kind === 'tree' && !preview) {
        rgb = firstHopRgb;
      }

      pctx.beginPath();
      pctx.moveTo(ax, ay);
      pctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
      pctx.lineWidth = lineW;
      pctx.lineCap = 'round';
      pctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${op})`;
      const alertLink = !!(s.alert || t.alert || s.status === 'offline' || t.status === 'offline');
      if (future) pctx.setLineDash([5, 4]);
      else pctx.setLineDash([]);
      if ((onPath || crumbPath) || alertLink) {
        pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alertLink && !onPath ? 0.35 : 0.45})`;
        pctx.shadowBlur = onPath || crumbPath ? 6 : 4;
      } else {
        pctx.shadowBlur = 0;
      }
      pctx.stroke();
      pctx.setLineDash([]);
      pctx.shadowBlur = 0;

      // Flowing packet toward APOS along the ancestor path
      if ((onPath || crumbPath) && !reduceMotion) {
        pathPackets.push({ s, t, cc, towardCore: true, rgb });
      }
    });
    if (!linkDrawStats.count) linkDrawStats.minOp = 0;

    // Path packets: travel toward the core every frame
    if (pathPackets.length && !reduceMotion) {
      const tSec = (ts || 0) / 1000;
      pathPackets.forEach(({ s, t, cc }, si) => {
        // Orient packet toward enterprise (lower depth). Teal = revenue, amber/red = alerts.
        const coreIsS = s.type === 'enterprise' || (s.depth != null && t.depth != null && s.depth < t.depth);
        const from = coreIsS ? t : s;
        const to = coreIsS ? s : t;
        const ccDir = coreIsS
          ? { c1x: cc.c2x, c1y: cc.c2y, c2x: cc.c1x, c2y: cc.c1y }
          : cc;
        const pts = cachedCubic(from, to, ccDir, 24, coreIsS ? 'core' : 'out');
        const alertish = !!(s.alert || t.alert);
        const pkt = alertish
          ? ((s.alert === 'red' || t.alert === 'red' || s.status === 'offline' || t.status === 'offline')
            ? [255, 107, 122] : [232, 192, 120])
          : [0, 210, 200];
        const activity = (s.revenue?.today || t.revenue?.today || 0);
        const hops = activity > 180 ? 2 : 1;
        for (let k = 0; k < hops; k++) {
          const u = (tSec * 0.42 + si * 0.18 + k * 0.5) % 1;
          const idx = Math.min(pts.length - 1, Math.floor(u * (pts.length - 1)));
          const sp = screenOf({ x: pts[idx][0], y: pts[idx][1] });
          pctx.beginPath();
          pctx.arc(sp.x, sp.y, 2.6, 0, Math.PI * 2);
          pctx.fillStyle = `rgba(${pkt[0]},${pkt[1]},${pkt[2]},0.95)`;
          pctx.shadowColor = `rgba(${pkt[0]},${pkt[1]},${pkt[2]},0.7)`;
          pctx.shadowBlur = 8;
          pctx.fill();
          pctx.shadowBlur = 0;
        }
      });
    }
    drawFlowEvents(ts);
    syncAposEdgeChip();

    // ——— Gemini signal arcs: calm cyan, max ~5, smooth core-bow Béziers ———
    if (layoutMode !== 'hex' || hoverId) {
      const signalCandidates = [];
      links.forEach((L) => {
        if (L.kind !== 'signal') return;
        const s = nodeById.get(L.source);
        const t = nodeById.get(L.target);
        if (!finitePos(s) || !finitePos(t)) return;
        if (revealScale(s) <= 0 || revealScale(t) <= 0) return;
        // Hex: only when hovering a related endpoint
        if (layoutMode === 'hex') {
          if (!hoverId) return;
          if (hoverId !== s.id && hoverId !== t.id && !hoverHotDraw?.has(s.id) && !hoverHotDraw?.has(t.id)) return;
        }
        if (L.overview || L.soft) {
          if (!overviewMode && layoutMode !== 'hex') return;
          // Overview: only reveal cross-signal arcs on hover (no idle spaghetti)
          if (overviewMode && !hoverId) return;
          if (!s.draw || !t.draw || s.ancestorOnly || t.ancestorOnly) return;
        } else if (L.drill) {
          if (overviewMode) return;
          // Live relations for focus: local frame OR along the ancestor path to APOS
          const onPathEnds = focusPath.has(s.id) && focusPath.has(t.id);
          if (!(localIds.has(s.id) && localIds.has(t.id)) && !onPathEnds) return;
        } else {
          return;
        }
        if (hoverHotDraw && !(hoverHotDraw.has(s.id) || hoverHotDraw.has(t.id))) {
          // keep quiet unless related to hover
          if (hoverId) return;
        }
        const dist = Math.hypot(t.x - s.x, t.y - s.y);
        if (dist < 40) return; // avoid tiny loops
        signalCandidates.push({ L, s, t, dist });
      });
      // Cap visible arcs
      signalCandidates.sort((a, b) => b.dist - a.dist);
      const shown = signalCandidates.slice(0, hoverId ? 5 : 4);
      const rgb = THEME === 'space' ? [0, 210, 230] : [140, 160, 220];
      shown.forEach(({ L, s, t }, si) => {
        const cc = curveControls(s, t, 'signal');
        const a0 = screenOf(s);
        const b0 = screenOf(t);
        const c1x = cc.c1x * transform.k + transform.x;
        const c1y = cc.c1y * transform.k + transform.y;
        const c2x = cc.c2x * transform.k + transform.x;
        const c2y = cc.c2y * transform.k + transform.y;
        const hot = !!(hoverHotDraw && (hoverHotDraw.has(s.id) || hoverHotDraw.has(t.id)));
        const op = hot ? 0.75 : overviewMode ? 0.38 : 0.5;
        pctx.beginPath();
        pctx.moveTo(a0.x, a0.y);
        pctx.bezierCurveTo(c1x, c1y, c2x, c2y, b0.x, b0.y);
        pctx.lineWidth = hot ? 2 : 1.6;
        pctx.lineCap = 'round';
        pctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${op})`;
        pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`;
        pctx.shadowBlur = hot ? 10 : 6;
        pctx.stroke();
        pctx.shadowBlur = 0;
        if (!reduceMotion) {
          const tSec = (ts || 0) / 1000;
          const pts = cachedCubic(s, t, cc, 16, 'sig');
          const u = (tSec * 0.35 + si * 0.22) % 1;
          const idx = Math.min(pts.length - 1, Math.floor(u * (pts.length - 1)));
          const sp = screenOf({ x: pts[idx][0], y: pts[idx][1] });
          pctx.beginPath();
          pctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
          pctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`;
          pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.7)`;
          pctx.shadowBlur = 6;
          pctx.fill();
          pctx.shadowBlur = 0;
        }
      });
    }

    // ——— Overview depth clusters: soft compact dots only (no hairlines) ———
    if (overviewMode && layoutMode !== 'hex') {
      nodes.forEach((n) => {
        if (n.type !== 'area' || !n.draw) return;
        const p = screenOf(n);
        const ang = n.angle != null ? n.angle : Math.atan2(n.y, n.x);
        const mc = n.machineCount || 2;
        const nDots = Math.min(10, Math.max(3, Math.round(2 + Math.sqrt(mc) * 1.4)));
        // Soft round halo (no lines)
        const hx = p.x + Math.cos(ang) * 14;
        const hy = p.y + Math.sin(ang) * 14;
        const halo = pctx.createRadialGradient(hx, hy, 1, hx, hy, 22);
        halo.addColorStop(0, 'rgba(255,255,255,0.10)');
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = halo;
        pctx.beginPath();
        pctx.arc(hx, hy, 22, 0, Math.PI * 2);
        pctx.fill();
        for (let i = 0; i < nDots; i++) {
          const t = (i + 0.5) / nDots - 0.5;
          const a = ang + t * 0.85;
          const dist = 10 + (hash(n.id + ':' + i) % 5) * 1.6; // compact ≤ ~18px
          const jitter = ((hash(n.id + 'j' + i) % 5) - 2) * 0.8;
          const x = p.x + Math.cos(a) * dist + Math.cos(a + Math.PI / 2) * jitter;
          const y = p.y + Math.sin(a) * dist + Math.sin(a + Math.PI / 2) * jitter;
          pctx.beginPath();
          pctx.arc(x, y, 1.15 + (i % 3) * 0.25, 0, Math.PI * 2);
          pctx.fillStyle = `rgba(255,255,255,${0.16 + (i % 4) * 0.04})`;
          pctx.fill();
        }
      });
    }

    // ——— Gentle signal particles along visible curves ———
    if (!reduceMotion && layoutMode !== 'hex') {
      const tSec = (ts || 0) / 1000;
      links.forEach((L, li) => {
        const s = nodeById.get(L.source);
        const t = nodeById.get(L.target);
        if (!s?.draw || !t?.draw || s.preview || t.preview || s.ancestorOnly || t.ancestorOnly) return;
        if (L.kind === 'spine' && !overviewMode) return;
        if (!overviewMode && (s.type === 'enterprise' || t.type === 'enterprise')) return;
        if (!overviewMode && !(localIds.has(s.id) && localIds.has(t.id))) return;
        const cc = curveControls(s, t, L.kind);
        const phase = (tSec * 0.35 + (hash(L.source + L.target) % 100) * 0.01) % 1;
        const pts = cachedCubic(s, t, cc, 16, 'flow');
        for (let k = 0; k < 2; k++) {
          const u = (phase + k * 0.45) % 1;
          const idx = Math.min(pts.length - 1, Math.floor(u * (pts.length - 1)));
          const sp = screenOf({ x: pts[idx][0], y: pts[idx][1] });
          pctx.beginPath();
          pctx.arc(sp.x, sp.y, overviewMode ? 1.8 : 1.5, 0, Math.PI * 2);
          pctx.fillStyle = `rgba(230,245,255,${0.4 + 0.3 * Math.sin(tSec * 3 + li)})`;
          pctx.fill();
        }
      });
      // Legacy pulses — never draw core/spine segments when drilled (causes edge “spine”)
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t > 1.15) { pulses.splice(i, 1); continue; }
        if (p.t < 0) continue;
        if (!overviewMode) {
          const nearCore = Math.hypot(p.x0, p.y0) < 40 || Math.hypot(p.x1, p.y1) < 40;
          if (nearCore) continue;
        }
        const u = Math.max(0, Math.min(1, p.t));
        const x = p.x0 + (p.x1 - p.x0) * u;
        const y = p.y0 + (p.y1 - p.y0) * u;
        const sp = screenOf({ x, y });
        pctx.beginPath();
        pctx.arc(sp.x, sp.y, p.bright ? 2.4 : 1.6, 0, Math.PI * 2);
        pctx.fillStyle = p.color;
        pctx.fill();
      }
    }

    // ——— Hex: world-locked grid + cell outlines ———
    if (layoutMode === 'hex') {
      const Rhex = Number(stage.dataset.hexR) || Math.max(200, R_HUB * 0.38);
      const k = transform.k || 1;
      // World-locked hex grid (centers on axial lattice around origin)
      const maxRing = 4;
      pctx.save();
      pctx.strokeStyle = 'rgba(0, 242, 254, 0.10)';
      pctx.lineWidth = 1;
      for (let q = -maxRing; q <= maxRing; q++) {
        for (let r = -maxRing; r <= maxRing; r++) {
          if (Math.abs(q + r) > maxRing) continue;
          const wx = Rhex * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
          const wy = Rhex * ((3 / 2) * r);
          const sx = wx * k + transform.x;
          const sy = wy * k + transform.y;
          const rad = Rhex * k * 0.95;
          pctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i + Math.PI / 6;
            const x = sx + Math.cos(a) * rad;
            const y = sy + Math.sin(a) * rad;
            if (i === 0) pctx.moveTo(x, y); else pctx.lineTo(x, y);
          }
          pctx.closePath();
          pctx.stroke();
        }
      }
      // Emphasize occupied country + brand cells (AE/SA = equal dim planned cells)
      const seatIds = new Set(hubs.filter((h) => !h.pad).map((h) => h.id));
      nodes.forEach((n) => {
        const isCountry = seatIds.has(n.id);
        const isBrand = n.type === 'client' && n.draw;
        if (!isCountry && !isBrand) return;
        const p = screenOf(n);
        const rad = Rhex * k * 0.95;
        const dim = n.status === 'future' || n.comingSoon || n.planned;
        pctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const x = p.x + Math.cos(a) * rad;
          const y = p.y + Math.sin(a) * rad;
          if (i === 0) pctx.moveTo(x, y); else pctx.lineTo(x, y);
        }
        pctx.closePath();
        pctx.strokeStyle = dim ? 'rgba(125, 147, 178, 0.42)' : 'rgba(0, 242, 254, 0.32)';
        pctx.lineWidth = dim ? 1.15 : 1.4;
        pctx.stroke();
        pctx.fillStyle = dim ? 'rgba(125, 147, 178, 0.06)' : 'rgba(0, 242, 254, 0.055)';
        pctx.fill();
      });
      pctx.restore();
    }

    // ——— Nodes ———
    nodes.forEach((n) => {
      if (!n.draw || n.lodAlpha < 0.05 || n.ancestorOnly) return;
      if (revealScale(n) <= 0) return;
      const p = screenOf(n);
      const grow = n.grow == null ? 1 : n.grow;
      const deep = !overviewMode;
      let r;
      if (n.type === 'hub' || n.type === 'country') r = deep ? DEEP_HUB_R : HUB_SCREEN_R;
      else if (n.type === 'enterprise') r = 0;
      else if (n.type === 'branch') r = deep ? (DEEP_NODE_R.branch || 14) : 5;
      else r = deep ? (DEEP_NODE_R[n.type] || 11) : (NODE_R_BY_TYPE[n.type] || NODE_SCREEN_R);
      r *= grow * revealScale(n);
      const springTarget = hoverId === n.id ? 1.16 : (hoverHotDraw && hoverHotDraw.has(n.id) ? 1.045 : 1);
      const springK = reduceMotion ? 1 : 0.18;
      n._spring = n._spring == null ? 1 : n._spring + (springTarget - n._spring) * springK;
      r *= n._spring;
      const alpha = (n.lodAlpha || 1) * (n.preview ? 0.85 : 1) * filterFade(n.id);
      if (n.type === 'enterprise') {
        // Soft disc echo of the textured stamp motif behind the galaxy wordmark
        const discR = Math.max(28, Math.min(stage.clientWidth, stage.clientHeight) * 0.045) * Math.max(0.85, Math.min(1.35, transform.k));
        const grd = pctx.createRadialGradient(p.x, p.y, discR * 0.15, p.x, p.y, discR * 2.2);
        grd.addColorStop(0, 'rgba(255,255,255,0.42)');
        grd.addColorStop(0.4, 'rgba(210,200,255,0.14)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = grd;
        pctx.beginPath();
        pctx.arc(p.x, p.y, discR * 2.2, 0, Math.PI * 2);
        pctx.fill();
        // Drilled: keep a faint galaxy peek when core sits at the frame edge
        const onStage = p.x > -40 && p.x < stage.clientWidth + 40
          && p.y > -40 && p.y < stage.clientHeight + 40;
        pctx.globalAlpha = overviewMode ? 0.95 : (onStage ? 0.42 : 0);
        if (aposWordmarkReady && aposWordmark.naturalWidth) {
          const targetH = Math.max(48, Math.min(64, Math.min(stage.clientWidth, stage.clientHeight) * 0.055));
          const aspect = aposWordmark.naturalWidth / aposWordmark.naturalHeight;
          const tw = targetH * aspect;
          const th = targetH;
          pctx.save();
          pctx.filter = 'invert(1)';
          pctx.drawImage(aposWordmark, p.x - tw / 2, p.y - th / 2, tw, th);
          pctx.restore();
        } else {
          pctx.fillStyle = 'rgba(255,255,255,0.96)';
          pctx.font = '700 56px Manrope, "Segoe UI", system-ui, sans-serif';
          pctx.textAlign = 'center';
          pctx.textBaseline = 'middle';
          pctx.fillText('apos', p.x, p.y);
        }
        pctx.globalAlpha = 1;
        if (UTILS && overviewMode) {
          currentFleet();
          const parts = healthRingParts;
          const sum = parts.reduce((s, seg) => s + seg.n, 0) || 1;
          const ringR = discR * 1.35;
          let a0 = -Math.PI / 2;
          pctx.lineWidth = 2.25;
          pctx.lineCap = 'butt';
          parts.forEach((seg) => {
            const sweep = (seg.n / sum) * Math.PI * 2;
            pctx.beginPath();
            pctx.arc(p.x, p.y, ringR, a0, a0 + sweep - 0.03);
            pctx.strokeStyle = `rgba(${seg.color}, 0.95)`;
            pctx.stroke();
            a0 += sweep;
          });
        }
        return;
      }
      if (n.type === 'hub' || n.type === 'country') {
        const rgb = accentRgb(n.ring || 'teal');
        const breathe = reduceMotion ? 1 : 1 + Math.sin(ts / 1100 + (n.angle || 0)) * 0.028;
        const rr = (deep ? DEEP_HUB_R : HUB_SCREEN_R) * breathe;
        const focusedHub = focusNodeId === n.id || (!overviewMode && n.id === focusHubId);
        const plannedNode = n.status === 'future' || n.planned;
        const hot = focusedHub || (UTILS && (UTILS.healthOf(n) === 'critical' || UTILS.healthOf(n) === 'offline'));
        if (hot && !plannedNode) {
          const bloom = pctx.createRadialGradient(p.x, p.y, rr * 0.2, p.x, p.y, rr + 18);
          bloom.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.45 * alpha})`);
          bloom.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
          pctx.fillStyle = bloom;
          pctx.beginPath();
          pctx.arc(p.x, p.y, rr + 18, 0, Math.PI * 2);
          pctx.fill();
        }
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        if (plannedNode) {
          pctx.setLineDash([4, 3]);
          pctx.strokeStyle = `rgba(154, 168, 188, ${0.92 * alpha})`;
          pctx.lineWidth = 1.5;
          pctx.stroke();
          pctx.setLineDash([]);
        } else {
          pctx.fillStyle = `rgba(8, 16, 28, ${0.72 * alpha})`;
          pctx.fill();
          pctx.lineWidth = focusedHub ? 2.6 : 1.8;
          pctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(focusedHub ? 0.95 : 0.8) * alpha})`;
          pctx.stroke();
          drawHubGlyph(pctx, p.x, p.y, rr * 0.55, n.id, alpha);
        }
        strokeStatusRing(pctx, p.x, p.y, rr + 4, n, alpha, ts);
      } else if (n.ghost) {
        traceTypeShape(pctx, p.x, p.y, r, n.type);
        pctx.save();
        pctx.globalAlpha = 0.2;
        pctx.strokeStyle = 'rgba(226, 236, 248, 0.95)';
        pctx.lineWidth = 1.35;
        pctx.setLineDash([3, 3]);
        pctx.stroke();
        pctx.restore();
      } else if (n.type !== 'branch') {
        const rr = r;
        const plannedNode = n.status === 'future' || n.planned;
        traceTypeShape(pctx, p.x, p.y, rr, n.type);
        if (plannedNode) {
          pctx.setLineDash([3, 3]);
          pctx.strokeStyle = `rgba(154, 168, 188, ${0.9 * alpha})`;
          pctx.lineWidth = 1.25;
          pctx.stroke();
          pctx.setLineDash([]);
        } else {
          pctx.fillStyle = `rgba(10, 18, 32, ${0.88 * alpha})`;
          pctx.fill();
          traceTypeShape(pctx, p.x, p.y, rr, n.type);
          pctx.strokeStyle = `rgba(226, 236, 248, ${0.72 * alpha})`;
          pctx.lineWidth = 1.15;
          pctx.stroke();
        }
        strokeStatusRing(pctx, p.x, p.y, rr + 3.2, n, alpha, ts);
        if (hoverId === n.id || focusNodeId === n.id) {
          traceTypeShape(pctx, p.x, p.y, rr + 5, n.type);
          pctx.strokeStyle = 'rgba(255,255,255,0.55)';
          pctx.lineWidth = 1.2;
          pctx.stroke();
        }
      }
      // Collapsed deep-subtree count on dimmed parents
      if (n.collapsedCount > 0 && n.draw && n.preview) {
        const txt = `+${n.collapsedCount}`;
        const bx = p.x + r * 0.7 + 8;
        const by = p.y + r * 0.55 + 4;
        pctx.font = '600 9px Manrope, sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        const tw = Math.max(18, 8 + txt.length * 5.5);
        pctx.fillStyle = `rgba(125,147,178,${0.55 * alpha})`;
        pctx.beginPath();
        pctx.roundRect?.(bx - tw / 2, by - 6, tw, 12, 5);
        if (!pctx.roundRect) {
          pctx.rect(bx - tw / 2, by - 6, tw, 12);
        }
        pctx.fill();
        pctx.fillStyle = `rgba(200,220,240,${0.85 * alpha})`;
        pctx.fillText(txt, bx, by + 0.5);
      }
      if (n._revT0 && n.revenue && !reduceMotion) {
        const u = Math.min(1, ((ts || performance.now()) - n._revT0) / 900);
        if (u < 1) {
          const shown = shownRevenue(n);
          pctx.globalAlpha = 1 - u;
          pctx.fillStyle = 'rgba(0, 210, 200, 0.95)';
          pctx.font = '600 10px Manrope, sans-serif';
          pctx.textAlign = 'center';
          pctx.fillText(String(shown), p.x, p.y - r - 10 - u * 8);
          pctx.globalAlpha = 1;
        }
      }
    });
    if (!reduceMotion) {
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = ((ts || 0) - rp.t0) / (rp.restrained ? 1100 : 680);
        if (age < 0) continue;
        if (age > 1) { ripples.splice(i, 1); continue; }
        const n = nodeById.get(rp.id);
        if (!n?.draw && n?.lodAlpha < 0.04) continue;
        if (!n) continue;
        const p = screenOf(n);
        const amp = rp.restrained ? 0.22 : 0.55;
        const radius = rp.restrained ? 5 + age * 22 : 6 + age * 34;
        pctx.beginPath();
        pctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        pctx.strokeStyle = `rgba(0, 210, 200, ${(1 - age) * amp})`;
        pctx.lineWidth = rp.restrained ? 1 : 1.4;
        pctx.stroke();
      }
    }
    pctx.restore();
  }


  function drawOrbitGuides(ts) {
    if (!pctx || !GEMINI || !overviewMode) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const cx = transform.x;
    const cy = transform.y;
    const k = transform.k;
    // Three dotted concentric rings in world→screen (hub / mid / outer)
    const rings = [R_HUB * 0.55, R_HUB * 0.92, R_HUB * 1.28];
    pctx.save();
    pctx.setLineDash([2, 4]);
    pctx.lineWidth = 1;
    pctx.strokeStyle = THEME === 'space' ? 'rgba(200,220,255,0.14)' : 'rgba(255,255,255,0.12)';
    pctx.lineWidth = 1.15;
    rings.forEach((rw) => {
      const rr = rw * k;
      if (rr < 12 || rr > Math.max(w, h) * 1.35) return;
      pctx.beginPath();
      pctx.arc(cx, cy, rr, 0, Math.PI * 2);
      pctx.stroke();
    });
    pctx.setLineDash([]);
    // Core reticle — dual rotating dashed rings
    const t = (ts || 0) / 1000;
    const outer = Math.min(48, Math.max(28, Math.min(w, h) * 0.045));
    pctx.lineWidth = 1.4;
    pctx.strokeStyle = THEME === 'space' ? 'rgba(0, 242, 254, 0.35)' : 'rgba(255,255,255,0.28)';
    pctx.setLineDash([3, 5]);
    pctx.beginPath();
    pctx.arc(cx, cy, outer, t * 0.15, t * 0.15 + Math.PI * 2);
    pctx.stroke();
    pctx.strokeStyle = THEME === 'space' ? 'rgba(5, 255, 161, 0.22)' : 'rgba(200,180,255,0.22)';
    pctx.beginPath();
    pctx.arc(cx, cy, outer * 0.72, -t * 0.09, -t * 0.09 + Math.PI * 2);
    pctx.stroke();
    pctx.setLineDash([]);
    // Crosshair ticks
    pctx.strokeStyle = THEME === 'space' ? 'rgba(0, 242, 254, 0.4)' : 'rgba(255,255,255,0.3)';
    pctx.lineWidth = 1;
    const tick = 6;
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
      pctx.beginPath();
      pctx.moveTo(cx + dx * (outer + 2), cy + dy * (outer + 2));
      pctx.lineTo(cx + dx * (outer + 2 + tick), cy + dy * (outer + 2 + tick));
      pctx.stroke();
    });
    pctx.restore();
  }

    function drawParticles(ts) {
    if (!pctx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    pctx.clearRect(0, 0, w, h);
    const tDust = (ts || 0) / 1000;
    // Nebulae (space theme) — screen-fixed, subtle
    if (THEME === 'space') {
      nebulae.forEach((nb) => {
        const g = pctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, Math.max(nb.rx, nb.ry));
        g.addColorStop(0, `rgba(${nb.rgb[0]},${nb.rgb[1]},${nb.rgb[2]},${nb.a})`);
        g.addColorStop(1, `rgba(${nb.rgb[0]},${nb.rgb[1]},${nb.rgb[2]},0)`);
        pctx.fillStyle = g;
        pctx.beginPath();
        pctx.ellipse(nb.x, nb.y, nb.rx, nb.ry, 0, 0, Math.PI * 2);
        pctx.fill();
      });
    }
    const panX = (transform.x - w / 2) * 0.2;
    const panY = (transform.y - h / 2) * 0.2;
    const mx = (pointerNX || 0) * 16;
    const my = (pointerNY || 0) * 11;
    for (const d of dust) {
      const twinkle = reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(tDust * d.twSpeed + d.tw);
      const px = d.parallax || 0.14;
      const sx = d.x + panX * px + mx * px;
      const sy = d.y + panY * px + my * px;
      pctx.beginPath();
      pctx.fillStyle = THEME === 'space'
        ? `rgba(200, 220, 245,${d.a * twinkle})`
        : `rgba(220, 230, 255,${d.a * twinkle})`;
      pctx.arc(sx, sy, d.r, 0, Math.PI * 2);
      pctx.fill();
    }

    // Core galaxy stays alive whenever it is on stage (overview, or a drilled edge peek)
    const coreNode = nodeById.get(DATA.enterprise.id);
    const coreScreen = coreNode ? screenOf(coreNode) : { x: transform.x, y: transform.y };
    const coreOnStage = coreScreen.x > -80 && coreScreen.x < w + 80 && coreScreen.y > -80 && coreScreen.y < h + 80;
    if (!overviewMode && !coreOnStage) return;

    const t = (ts || 0) / 1000;
    const cx = overviewMode ? transform.x : coreScreen.x;
    const cy = overviewMode ? transform.y : coreScreen.y;
    const k = overviewMode ? transform.k : Math.max(0.55, Math.min(transform.k, 1.4));
    const coreR = Math.min(CORE_WORLD_R, Math.max(72, Math.min(w, h) * 0.18)) * (overviewMode ? 1 : 0.62);
    // Soft bloom behind galaxy — kept inside hub ring
    pctx.beginPath();
    const bloomR = coreR * 1.15 * Math.max(0.9, Math.min(1.4, k));
    const coreBloom = pctx.createRadialGradient(cx, cy, 6, cx, cy, bloomR);
    coreBloom.addColorStop(0, 'rgba(255,255,255,0.32)');
    coreBloom.addColorStop(0.35, 'rgba(200,190,255,0.14)');
    coreBloom.addColorStop(1, 'rgba(255,255,255,0)');
    pctx.fillStyle = coreBloom;
    pctx.arc(cx, cy, bloomR, 0, Math.PI * 2);
    pctx.fill();
    for (const p of coreParticles) {
      // Soft spiral drift: rotate in-plane + gentle radial breathe
      const spin = t * 0.11 + (p.spin || 0.12) + p.phase;
      const breathe = (1 + Math.sin(t * 0.7) * 0.035) * (1 + Math.sin(t * p.speed + p.phase) * 0.04);
      const cos = Math.cos(spin * 0.55);
      const sin = Math.sin(spin * 0.55);
      const x0 = p.ox * breathe;
      const y0 = p.oy * breathe;
      const x = x0 * cos - y0 * sin;
      const y = x0 * sin + y0 * cos + Math.sin(t * p.speed + p.phase) * 1.2;
      const z = p.oz * Math.cos(spin * 0.25);
      const sx = (x - z * 0.15) * k + cx;
      const sy = y * k + cy;
      const dist = Math.hypot(p.ox, p.oy, p.oz);
      const alpha = 0.35 + 0.55 * (1 - Math.min(1, dist / (coreR * 0.95)));
      pctx.beginPath();
      const tint = p.tint || (p.pink ? 'pink' : 'white');
      const col =
        tint === 'cyan' ? [0, 242, 254] :
        tint === 'mint' ? [5, 255, 161] :
        tint === 'pink' ? [240, 170, 200] :
        [255, 255, 255];
      pctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha})`;
      pctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.45)`;
      pctx.shadowBlur = 2.5;
      pctx.arc(sx, sy, Math.max(0.65, p.r * Math.min(1.6, 0.7 + k * 0.2)), 0, Math.PI * 2);
      pctx.fill();
      pctx.shadowBlur = 0;
    }
  }

  function wireUi() {
    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        document.getElementById(DOM.dashboards).hidden = btn.dataset.view !== 'dashboards';
      });
    });
    document.querySelectorAll('.zoom-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        if (a === 'zoom-in') svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.3);
        else if (a === 'zoom-out') svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.75);
        else if (a === 'reset') flyToGalaxy();
      });
    });
    // Spec §6.3: ‹ › cycle sibling hubs (same interruptible ~900ms fly)
    function cycleHub(dir) {
      const cur = nodeById.get(focusNodeId);
      const hubId = overviewMode
        ? (hubs.find((h) => h.status === 'active')?.id || hubs[0]?.id)
        : (cur?.type === 'hub' ? cur.id : cur?.hubId);
      const idx = Math.max(0, hubs.findIndex((h) => h.id === hubId));
      const next = hubs[(idx + dir + hubs.length) % hubs.length];
      if (next) flyToNode(next);
    }
    document.querySelector('.nav-chevron[data-dir="prev"]').addEventListener('click', () => cycleHub(-1));
    document.querySelector('.nav-chevron[data-dir="next"]').addEventListener('click', () => cycleHub(1));
    document.getElementById(DOM.leafCardClose).addEventListener('click', closeLeafCard);
    document.getElementById(DOM.taskClose).addEventListener('click', closeTask);
    taskOverlay.addEventListener('click', (e) => {
      if (e.target === taskOverlay) closeTask();
    });
    document.getElementById(DOM.taskSend).addEventListener('click', sendTask);
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      pointerNX = ((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1;
      pointerNY = ((e.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1;
    });
    stage.addEventListener('pointerleave', () => { pointerNX = 0; pointerNY = 0; });
    document.addEventListener('visibilitychange', () => {
      pageHidden = document.hidden;
      if (!pageHidden) requestAnimationFrame(loop);
    });
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (!taskOverlay.hidden) {
          closeTask();
          return;
        }
        flyOut();
        return;
      }
      if (e.key === 'Enter') {
        const cur = nodeById.get(focusNodeId);
        const kids = (childrenOf.get(focusNodeId) || []).filter((c) => c.status !== 'future' && c.type !== 'branch');
        if (kids[0]) flyToNode(kids[0]);
        else if (cur?.type === 'machine') {
          const br = (childrenOf.get(cur.id) || [])[0];
          if (br) onNodeClick(br);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = nodeById.get(focusNodeId);
        if (!cur) return;
        if (cur.type === 'hub' || overviewMode) {
          const idx = hubs.findIndex((h) => h.id === (cur.type === 'hub' ? cur.id : focusNodeId));
          const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
          const next = hubs[(idx + dir + hubs.length) % hubs.length];
          if (next) flyToNode(next);
          return;
        }
        const siblings = (childrenOf.get(cur.parentId) || []).filter((c) => c.type === cur.type);
        const si = siblings.findIndex((s) => s.id === cur.id);
        if (si < 0 || siblings.length < 2) return;
        const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        const nxt = siblings[(si + dir + siblings.length) % siblings.length];
        if (nxt) flyToNode(nxt);
      }
    });
    window.addEventListener('resize', () => {
      resizeParticles();
      if (signalRunner) signalRunner.resize();
      if (!flying) {
        if (overviewMode) {
          transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
          svg.call(zoomBehavior.transform, transform);
        }
        applyLod();
      }
    });
  }

  const tooltipEl = document.getElementById(DOM.tooltip);
  function showTooltip(event, d) {
    if (!tooltipEl || !d || d.type === 'enterprise') return;
    const rev = d.revenue?.today != null ? d.revenue.today : (d.rollup?.revenueToday ?? null);
    const stock = shownStock(d);
    const alerts = d.type === 'machine' ? (d.alert ? 1 : 0) : (d.alertCount || 0);
    const offline = d.type === 'machine' ? (d.status === 'offline' ? 1 : 0) : (d.rollup?.offline || 0);
    const stat = [
      rev == null ? null : `${rev} KWD today`,
      stock == null ? null : `stock ${stock}%`,
      `alerts ${alerts}`,
      `offline ${offline}`,
      statusLabel(d),
      (d.status === 'unknown' || d.stale) ? `last seen ${d.lastSeen || '—'}` : null,
    ].filter(Boolean).join(' · ');
    tooltipEl.hidden = false;
    tooltipEl.innerHTML = `<strong>${d.label || d.bgLabel || d.id}</strong>${stat ? `<span>${stat}</span>` : ''}`;
    const stageBox = stage.getBoundingClientRect();
    tooltipEl.style.left = `${event.clientX - stageBox.left + 12}px`;
    tooltipEl.style.top = `${event.clientY - stageBox.top + 12}px`;
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  // Signals along machine → root
  const signalCanvas = document.getElementById(DOM.world) || document.getElementById(DOM.world);
  const labelLayerEl = document.getElementById(DOM.labelLayer);
  let signalRunner = null;
  const pulses = [];
  if (signalCanvas && POLISH && signalCanvas !== particleCanvas) {
    signalRunner = POLISH.createSignalRunner({
      canvas: signalCanvas,
      getNode: (id) => nodeById.get(id),
      worldToScreen: (x, y) => worldToScreen(x, y),
      reduceMotion,
    });
  }

  function packetRgb(kind) {
    if (kind === 'alert' || kind === 'offline') return [255, 107, 122];
    if (kind === 'lowstock' || kind === 'task') return [232, 192, 120];
    return [0, 210, 200];
  }

  function spawnFlow(machineId, kind) {
    const path = pathToRoot(machineId);
    if (path.length < 2) return;
    if (flowEvents.length > 6) flowEvents.shift();
    flowEvents.push({ path, u: 0, speed: 0.012, rgb: packetRgb(kind), kind });
  }

  function refreshAlertRollups() {
    if (!UTILS) return;
    const now = performance.now();
    machines.forEach((m) => {
      if (m._offlineUntil && now >= m._offlineUntil) {
        m.status = m._baseStatus || 'active';
        m.offlineHours = m._baseOfflineHours || 0;
        m._offlineUntil = 0;
      }
      if (m._lowUntil && now >= m._lowUntil && m.stock && m._baseFill != null) {
        m.stock.fillPct = m._baseFill;
        m._lowUntil = 0;
      }
      m.alert = UTILS.computeAlert(m);
      m.alertCount = m.alert ? 1 : 0;
    });
    nodes.forEach((n) => {
      if (n.type === 'machine' || n.type === 'branch' || n.type === 'artic' || n.pad) return;
      const r = UTILS.rollup(n, childrenOf);
      n.alertCount = r.alerts;
      n.rollup = r;
    });
    refreshFilter();
  }

  function emitLive(ev) {
    const m0 = nodeById.get(ev.machineId);
    if (m0) {
      ev.path = pathLabel(m0);
      ev.severity = ev.kind === 'offline' ? 'critical' : (ev.kind === 'lowstock' ? 'warning' : 'info');
      const mins = Math.max(30, Math.round((m0.offlineHours || 0.5) * 60));
      ev.happened = ev.kind === 'offline' ? `Offline >${mins}m`
        : ev.kind === 'lowstock' ? 'Low stock'
        : ev.kind === 'task' ? 'Task assigned'
        : 'Sale recorded';
      ev.at = ev.at || Date.now();
    }
    dataRefreshedAt = Date.now();
    liveLog.push(ev);
    if (liveLog.length > 16) liveLog.shift();
    const m = nodeById.get(ev.machineId);
    if (m?.revenue && ev.deltaRev) {
      m._revFrom = shownRevenue(m);
      m.revenue.today = Math.round((m.revenue.today + ev.deltaRev) * 10) / 10;
      m._revT0 = performance.now();
      let id = m.parentId;
      while (id) {
        const n = nodeById.get(id);
        if (!n) break;
        if (n.rollup && UTILS) n.rollup.revenueToday = UTILS.rollup(n, childrenOf).revenueToday;
        id = n.parentId;
      }
    }
    if (m?.stock && ev.deltaStock) {
      m.stock.fillPct = Math.max(0, Math.min(100, Math.round((m.stock.fillPct || 0) + ev.deltaStock)));
    }
    if (m && ev.kind === 'offline') {
      if (!m._offlineUntil) m._baseStatus = m._baseStatus || m.status;
      m.status = 'offline';
      m.offlineHours = Math.max(m.offlineHours || 0, (THRESH?.offlineHours || 2) + 1);
      m._offlineUntil = performance.now() + 9000;
      m._offlineAt = ev.at || Date.now();
    }
    if (m && ev.kind === 'lowstock' && m.stock) {
      const floor = (THRESH?.stockLowPct || 15) - 1;
      if (m._baseFill == null) m._baseFill = m.stock.fillPct;
      if (m.stock.fillPct > floor) m.stock.fillPct = floor;
      m._lowUntil = performance.now() + 9000;
    }
    if (m && (ev.kind === 'offline' || ev.kind === 'lowstock' || ev.deltaStock || ev.deltaRev)) {
      refreshAlertRollups();
    }
    spawnFlow(ev.machineId, ev.kind);
    spawnPathRipple(ev.machineId);
    stage?.dispatchEvent(new CustomEvent('apos-live', { detail: ev }));
  }

  function spawnPathRipple(machineId) {
    if (reduceMotion) return;
    const path = pathToRoot(machineId);
    const now = performance.now();
    path.forEach((nid, i) => {
      ripples.push({ id: nid, t0: now + i * 160, restrained: true });
    });
  }

  function spawnPathSignal(machineId, kind) {
    spawnFlow(machineId, kind === 'alert' ? 'alert' : 'sale');
    const pathIds = pathToRoot(machineId);
    const color = kind === 'alert' ? 'rgba(255,107,122,0.95)' : 'rgba(0,210,200,0.95)';
    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = nodeById.get(pathIds[i]);
      const b = nodeById.get(pathIds[i + 1]);
      if (!a || !b) continue;
      if (!overviewMode && (a.type === 'enterprise' || b.type === 'enterprise')) continue;
      pulses.push({
        x0: a.x, y0: a.y, x1: b.x, y1: b.y,
        t: -i * 0.08, speed: 0.014, color, bright: true,
      });
    }
    if (signalRunner && overviewMode) signalRunner.spawnPath(pathIds, color, true);
  }

  let liveTimer = 0;
  function startSignalTimers() {
    if (reduceMotion || liveTimer) return;
    const kinds = [
      { id: 'sale', label: 'Sale', deltaRev: [1.5, 6.5] },
      { id: 'lowstock', label: 'Low stock', deltaStock: -1 },
      { id: 'offline', label: 'Machine offline' },
      { id: 'task', label: 'Task assigned' },
    ];
    liveTimer = setInterval(() => {
      if (pageHidden || !machines.length) return;
      const live = machines.filter((m) => m.status !== 'planned' && m.status !== 'future');
      if (!live.length) return;
      const weights = live.map((m) => 12 + Math.min(80, m.revenue?.today || 0) / 8 + (m.alert ? 18 : 0));
      let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
      let m = live[0];
      for (let i = 0; i < live.length; i++) {
        pick -= weights[i];
        if (pick <= 0) { m = live[i]; break; }
      }
      const kind = m.alert && Math.random() < 0.5 ? kinds[2] : kinds[Math.floor(Math.random() * kinds.length)];
      const deltaRev = kind.deltaRev ? kind.deltaRev[0] + Math.random() * (kind.deltaRev[1] - kind.deltaRev[0]) : 0;
      emitLive({
        kind: kind.id,
        label: kind.label,
        machineId: m.id,
        title: m.label,
        body: `${kind.label} · ${m.label}`,
        deltaRev: deltaRev ? Math.round(deltaRev * 10) / 10 : 0,
        deltaStock: kind.deltaStock || 0,
        at: Date.now(),
      });
    }, 3400);
  }
  function setLive(on) {
    if (!on) {
      if (liveTimer) clearInterval(liveTimer);
      liveTimer = 0;
      // Finish simulated offline/stock timers so a later read is not mid-event.
      let dirty = false;
      machines.forEach((m) => {
        if (m._offlineUntil) { m._offlineUntil = 1; dirty = true; }
        if (m._lowUntil) { m._lowUntil = 1; dirty = true; }
      });
      if (dirty) refreshAlertRollups();
      return false;
    }
    startSignalTimers();
    return !!liveTimer;
  }

  function waitForIdle() {
    return new Promise((resolve) => {
      let idleFrames = 0;
      const tick = () => {
        if (!flying) {
          idleFrames += 1;
          if (idleFrames >= 2) resolve();
          else requestAnimationFrame(tick);
        } else {
          idleFrames = 0;
          requestAnimationFrame(tick);
        }
      };
      tick();
    });
  }

  function setZoomK(k) {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const [wx, wy] = transform.invert([W / 2, H / 2]);
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-wx, -wy);
    transform = t;
    // Programmatic scale: collapse levels from k (pan must not)
    reconcileViewState('zoom');
    svg.call(zoomBehavior.transform, t);
    applyLod();
    applyLabelCounterScale();
    updateBreadcrumbFromView();
  }

  function worldToScreen(x, y) {
    return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
  }

  function computeHexTargets() {
    // Honeycomb cluster: country cells around core; KW brand cells adjacent
    const R = Math.max(200, R_HUB * 0.38);
    const targets = new Map();
    const core = nodeById.get(DATA.enterprise.id);
    if (core) targets.set(core.id, { x: 0, y: 0 });

    const axialToXY = (q, r) => ({
      x: R * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
      y: R * ((3 / 2) * r),
    });

    const prefer = ['country-kw', 'country-ae', 'country-sa'];
    const seatHubs = [];
    prefer.forEach((id) => {
      const h = hubs.find((x) => x.id === id && !x.pad);
      if (h) seatHubs.push(h);
    });
    hubs.forEach((h) => {
      if (!h.pad && !seatHubs.includes(h)) seatHubs.push(h);
    });

    const countryAxial = [
      { q: 1, r: -1 },
      { q: -1, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 0 },
      { q: 0, r: -1 },
      { q: -1, r: 1 },
    ];

    seatHubs.forEach((h, i) => {
      const ax = countryAxial[i] || { q: 2, r: -2 };
      const p = axialToXY(ax.q, ax.r);
      targets.set(h.id, { x: p.x, y: p.y });
      h._hexQ = ax.q;
      h._hexR = ax.r;
    });

    const kw = seatHubs.find((h) => h.id === 'country-kw');
    if (kw) {
      const kwA = countryAxial[0];
      const nbr = [
        { q: kwA.q + 1, r: kwA.r },
        { q: kwA.q, r: kwA.r - 1 },
        { q: kwA.q + 1, r: kwA.r - 1 },
      ];
      const kids = (childrenOf.get(kw.id) || []).filter(
        (c) => !c.pad && (c.type === 'client' || c.type === 'area')
      );
      kids.forEach((c, ci) => {
        const ax = nbr[ci] || { q: kwA.q + 2, r: kwA.r - ci };
        const p = axialToXY(ax.q, ax.r);
        targets.set(c.id, { x: p.x, y: p.y });
        const gkids = (childrenOf.get(c.id) || []).filter((g) => !g.pad && g.type !== 'branch');
        gkids.slice(0, 5).forEach((g, gi) => {
          const a = -Math.PI / 2 + ((gi + 0.5) / 5) * Math.PI * 2;
          targets.set(g.id, {
            x: p.x + Math.cos(a) * R * 0.2,
            y: p.y + Math.sin(a) * R * 0.2,
          });
        });
      });
    }

    seatHubs.forEach((h) => {
      if (h.id === 'country-kw') return;
      const hp = targets.get(h.id);
      if (!hp) return;
      (childrenOf.get(h.id) || [])
        .filter((c) => !c.pad && (c.type === 'client' || c.type === 'area'))
        .forEach((c, ci, arr) => {
          if (targets.has(c.id)) return;
          const a = -Math.PI / 2 + ((ci + 0.5) / Math.max(arr.length, 1)) * Math.PI * 2;
          targets.set(c.id, {
            x: hp.x + Math.cos(a) * R * 0.25,
            y: hp.y + Math.sin(a) * R * 0.25,
          });
        });
    });

    nodes.forEach((n) => {
      if (targets.has(n.id)) return;
      if (n.type === 'enterprise') { targets.set(n.id, { x: 0, y: 0 }); return; }
      const p = n.parentId ? targets.get(n.parentId) : null;
      if (p) {
        const a = (hash(n.id) % 360) * (Math.PI / 180);
        targets.set(n.id, { x: p.x + Math.cos(a) * R * 0.08, y: p.y + Math.sin(a) * R * 0.08 });
      } else {
        targets.set(n.id, { x: 0, y: 0 });
      }
    });

    stage.dataset.hexR = String(R);
    return targets;
  }

  function tweenLayoutTo(mode, ms) {
    const dur = reduceMotion ? 0 : (ms || 600);
    const from = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    let to;
    if (mode === 'hex') {
      to = computeHexTargets();
    } else {
      to = new Map(nodes.map((n) => [n.id, { x: n.radialX ?? n.x, y: n.radialY ?? n.y }]));
    }
    layoutMode = mode;
    if (dur === 0) {
      nodes.forEach((n) => {
        const p = to.get(n.id);
        if (p) { n.x = p.x; n.y = p.y; }
      });
      gNodes.selectAll('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
      applyLod();
      return;
    }
    const t0 = performance.now();
    layoutTween = { t0, dur, from, to };
    function easeInOutCubic(u) {
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    }
    function step(now) {
      if (!layoutTween || layoutTween.t0 !== t0) return;
      const u = Math.min(1, (now - t0) / dur);
      const e = easeInOutCubic(u);
      nodes.forEach((n) => {
        const a = from.get(n.id);
        const b = to.get(n.id);
        if (!a || !b) return;
        n.x = a.x + (b.x - a.x) * e;
        n.y = a.y + (b.y - a.y) * e;
      });
      gNodes.selectAll('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
      applyLod();
      if (u < 1) requestAnimationFrame(step);
      else {
        layoutTween = null;
        if (overviewMode) {
          const t = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
          targetTransform = t;
          if (!GEMINI || reduceMotion) {
            transform = t;
            gRoot.attr('transform', transform);
            svg.call(zoomBehavior.transform, transform);
          }
        }
        applyLod();
      }
    }
    requestAnimationFrame(step);
  }

  const api = {
    getFocus: () => {
      const n = nodeById.get(focusNodeId);
      return {
        id: focusNodeId,
        type: n?.type,
        level: n?.depth ?? 0,
        machineId: n?.type === 'machine' ? n.id : n?.machineId,
        locationId: n?.locationId,
        hubId: n?.hubId || (n?.type === 'hub' ? n.id : undefined),
        countryId: n?.countryId || (n?.type === 'country' ? n.id : undefined),
        clientId: n?.clientId || (n?.type === 'client' ? n.id : undefined),
        overview: overviewMode,
      };
    },
    goBack: flyOut,
    reset: () => flyToGalaxy(),
    waitForIdle,
    flyTo: (id) => {
      const n = nodeById.get(id);
      if (n) flyToNode(n);
    },
    setZoomK,
    getTransform: () => ({ k: transform.k, x: transform.x, y: transform.y }),
    nodeScreenPos: (id) => {
      const n = nodeById.get(id);
      return n ? worldToScreen(n.x, n.y) : null;
    },
    isNodeDrawn: (id) => {
      const n = nodeById.get(id);
      return !!(n && n.draw && n.lodAlpha > 0.05);
    },
    getNodeAlpha: (id) => nodeById.get(id)?.lodAlpha || 0,
    visibleDrawnTypes: () => {
      const types = {};
      nodes.forEach((n) => {
        if (n.draw && n.lodAlpha > 0.1) types[n.type] = (types[n.type] || 0) + 1;
      });
      return types;
    },
    getExpandedPath: () => [...expandedPath],
    getHubCount: () => hubs.length,
    openTask: (machineId, role) => {
      const m = nodeById.get(machineId);
      if (m) openTask(m, role || 'operator');
    },
    closeTask,
    closeLeafCard,
    isTaskOpen: () => !taskOverlay.hidden,
    isLeafCardOpen: () => !leafCard.hidden,
    machineCount: () => machines.length,
    LOD,
    getLinkDrawStats: () => ({ ...linkDrawStats }),
    /** Screen endpoints for a parent→child link (node centres). Null if either missing. */
    getLinkScreenEndpoints: (sourceId, targetId) => {
      const s = nodeById.get(sourceId);
      const t = nodeById.get(targetId);
      if (!s || !t) return null;
      return { source: worldToScreen(s.x, s.y), target: worldToScreen(t.x, t.y), sourceId, targetId };
    },
    /** Drawn tree links incident to a node (continuous path — no stubs). */
    getIncidentDrawnLinks: (nodeId) => {
      const out = [];
      const focusPath = new Set(pathToRoot(focusNodeId));
      links.forEach((L) => {
        if (L.source !== nodeId && L.target !== nodeId) return;
        if (L.kind === 'signal') return;
        const s = nodeById.get(L.source);
        const t = nodeById.get(L.target);
        if (!s || !t) return;
        const onPath = focusPath.has(L.source) && focusPath.has(L.target);
        if (!onPath && !(s.draw && t.draw)) return;
        out.push({
          source: L.source,
          target: L.target,
          kind: L.kind,
          sourceScreen: worldToScreen(s.x, s.y),
          targetScreen: worldToScreen(t.x, t.y),
          sourceLocal: !!s.draw,
          targetLocal: !!t.draw,
          onPath,
          stub: false,
        });
      });
      return out;
    },
    /** True when every hop focus→…→APOS is a drawn continuous link. */
    pathLinksVisible: (fromId) => {
      const path = pathToRoot(fromId || focusNodeId);
      if (path.length < 2) return true;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const hit = links.some((L) =>
          (L.source === a && L.target === b) || (L.source === b && L.target === a)
        );
        if (!hit) return false;
        const na = nodeById.get(a), nb = nodeById.get(b);
        if (!na?.draw || !nb?.draw) return false;
      }
      return true;
    },
    getContextRestoreT: () => contextRestoreT(),
    getAposEdgeHint: () => (aposEdgeHint ? { ...aposEdgeHint } : null),
    snapshotOverviewState: () => {
      applyLod();
      const drawn = nodes
        .filter((n) => n.draw && !n.preview && !n.ancestorOnly && n.lodAlpha > 0.05)
        .map((n) => n.id)
        .sort();
      const labels = [];
      nodes.forEach((n) => {
        if (!n.labelOn || !n.draw || !n.label || n.ancestorOnly) return;
        const node = worldToScreen(n.x, n.y);
        const lx = n._labelSx != null ? n._labelSx : node.x;
        const ly = n._labelSy != null ? n._labelSy : node.y + 18;
        labels.push({
          id: n.id,
          text: n.label,
          x: Math.round(lx),
          y: Math.round(ly),
          nx: Math.round(node.x),
          ny: Math.round(node.y),
          ox: Math.round(lx - node.x),
          oy: Math.round(ly - node.y),
        });
      });
      // Hub titles (overview)
      document.querySelectorAll('.hub-title-dom').forEach((el) => {
        if (el.style.display === 'none' || el.hidden) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1) return;
        labels.push({
          id: el.dataset.id || `hub-title:${(el.textContent || '').trim()}`,
          text: (el.textContent || '').trim(),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        });
      });
      labels.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return {
        overview: overviewMode,
        focus: focusNodeId,
        k: +transform.k.toFixed(4),
        x: +transform.x.toFixed(2),
        y: +transform.y.toFixed(2),
        drawn,
        labels,
      };
    },
    countLinkCrossings: () => countLinkCrossings(),
    countDrawnOfType: (type) => nodes.filter((n) => n.type === type && n.draw && !n.preview && !n.ancestorOnly && n.lodAlpha > 0.05).length,
    isOverview: () => overviewMode,
    getAlertCount: (id) => nodeById.get(id)?.alertCount || 0,
    getRollup: (id) => nodeById.get(id)?.rollup || null,
    listNodes: () => nodes
      .filter((n) => !n.pad && n.type !== 'artic')
      .map((n) => ({ id: n.id, type: n.type, label: n.label || '', parentId: n.parentId || null, depth: n.depth })),
    getUsableFrame: () => {
      const focus = nodeById.get(focusNodeId);
      const reserve = !!(focus && focus.type !== 'enterprise' && !overviewMode);
      return viewportFitRect({ reserveDrawer: reserve || undefined });
    },
    nodeFacts: (id) => {
      const n = nodeById.get(id);
      if (!n) return null;
      const rev = n.revenue?.today != null ? n.revenue.today : (n.rollup?.revenueToday ?? null);
      const stock = shownStock(n);
      const alerts = n.type === 'machine' ? (n.alert ? 1 : 0) : (n.alertCount || 0);
      const offline = n.type === 'machine' ? (n.status === 'offline' ? 1 : 0) : (n.rollup?.offline || 0);
      return {
        id: n.id,
        label: n.label || n.bgLabel || '',
        type: n.type,
        status: statusLabel(n),
        revenueToday: rev,
        stockPct: stock,
        alerts,
        offline,
        badge: n.alertCount || 0,
        health: UTILS ? UTILS.healthOf(n) : statusLabel(n),
        lastSeen: n.lastSeen || n.operators?.lastVisit || null,
        path: pathLabel(n),
        sections: UTILS ? UTILS.inspectorSections(n, people, pinnedIncident) : [],
      };
    },
    auditData: () => {
      const issues = [];
      const sumOf = (n, key) => {
        if (n.type === 'machine') {
          if (key === 'revenueToday') return n.revenue?.today || 0;
          if (key === 'alerts') return n.alert ? 1 : 0;
          if (key === 'offline') return n.status === 'offline' ? 1 : 0;
        }
        return (childrenOf.get(n.id) || [])
          .filter((c) => c.type !== 'branch' && c.type !== 'artic' && !c.pad)
          .reduce((s, c) => s + sumOf(c, key), 0);
      };
      nodes.forEach((n) => {
        if (!n.label && n.type !== 'enterprise') issues.push(`${n.id}: empty label`);
        if (n.type === 'machine') {
          const fill = n.stock?.fillPct;
          if (fill != null && (!(fill >= 0) || fill > 100)) issues.push(`${n.id}: fill ${fill}`);
          const rev = n.revenue?.today;
          if (rev != null && !Number.isFinite(rev)) issues.push(`${n.id}: revenue ${rev}`);
          if (rev != null && rev < 0) issues.push(`${n.id}: negative revenue`);
        }
        if (n.type === 'branch' || n.type === 'artic' || n.pad) return;
        if (!UTILS) return;
        const r = UTILS.rollup(n, childrenOf);
        const badge = n.type === 'machine' ? (n.alert ? 1 : 0) : (n.alertCount || 0);
        if (Math.abs((r.revenueToday || 0) - sumOf(n, 'revenueToday')) > 0.15) {
          issues.push(`${n.id}: revenue ${r.revenueToday} != children`);
        }
        if (r.alerts !== sumOf(n, 'alerts')) issues.push(`${n.id}: alerts ${r.alerts} != ${sumOf(n, 'alerts')}`);
        if ((r.offline || 0) !== sumOf(n, 'offline')) issues.push(`${n.id}: offline ${r.offline} != children`);
        if (n.type !== 'machine' && badge !== r.alerts) issues.push(`${n.id}: badge ${badge} != rollup ${r.alerts}`);
        if (n.rollup && n.type !== 'machine') {
          if (Math.abs((n.rollup.revenueToday || 0) - r.revenueToday) > 0.15) issues.push(`${n.id}: stored revenue drift`);
          if ((n.rollup.alerts || 0) !== r.alerts) issues.push(`${n.id}: stored alerts drift`);
          if ((n.rollup.offline || 0) !== r.offline) issues.push(`${n.id}: stored offline drift`);
        }
      });
      return issues;
    },
    viewDepth: () => viewStack.length,


    prefersReducedMotion: () => reduceMotion,
    getMotionState: () => ({
      reduceMotion: !!reduceMotion,
      running: !pageHidden,
      hidden: pageHidden,
      filter: filterMode,
      bobAmp: reduceMotion ? 0 : 2.6,
      packets: flowEvents.length,
    }),
    getFrameStats: () => {
      const s = frameSamples.slice().sort((a, b) => a - b);
      const mid = s.length ? s[Math.floor(s.length / 2)] : 0;
      const p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
      return { median: Math.round(mid * 10) / 10, p95: Math.round(p95 * 10) / 10, n: s.length };
    },
    setFilter: (mode) => {
      filterMode = ['alerts', 'offline', 'lowstock', 'unknown', 'critical'].includes(mode) ? mode : 'all';
      refreshFilter();
      paintLod();
      return filterMode;
    },
    fleetKpis: () => Object.assign(publishFleet(), { refreshedAt: dataRefreshedAt }),
    fleetSnapshot: () => Object.assign(publishFleet(), { refreshedAt: dataRefreshedAt }),
    getHealthRing: () => healthRingParts.map((p) => ({ key: p.key, n: p.n, color: p.color })),
    focusIncident: (ev) => { pinnedIncident = ev || null; return pinnedIncident; },
    countLabelLinkHits: () => countLabelLinkHits(),
    getFilter: () => filterMode,
    getFilterDimmedCount: () => {
      if (filterMode === 'all') return 0;
      return nodes.filter((n) => n.draw && n.lodAlpha > 0.05 && n.type !== 'enterprise' && !filterHot.has(n.id)).length;
    },
    searchNodes: (q) => {
      const s = String(q || '').trim().toLowerCase();
      if (!s) return [];
      return nodes
        .filter((n) => n.type !== 'artic' && n.type !== 'branch' && ((n.label || '') + ' ' + (n.bgLabel || '') + ' ' + pathLabel(n)).toLowerCase().includes(s))
        .slice(0, 8)
        .map((n) => ({ id: n.id, label: n.label || n.bgLabel || n.id, type: n.type, path: pathLabel(n) }));
    },
    getLiveLog: () => liveLog.slice(-8),
    setLive,
    emitTestEvent: (machineId, kind) => {
      const m = nodeById.get(machineId) || machines[0];
      if (!m) return null;
      const k = kind || 'sale';
      const label = k === 'offline' ? 'Machine offline' : k === 'lowstock' ? 'Low stock' : 'Sale';
      emitLive({
        kind: k,
        label,
        machineId: m.id,
        title: m.label,
        body: `${label} · ${m.label}`,
        deltaRev: k === 'sale' ? 2.5 : 0,
        deltaStock: k === 'lowstock' ? -4 : 0,
        at: Date.now(),
      });
      return m.id;
    },
    setInspectorOpen: (open) => {
      if (!stage) return;
      const was = stage.classList.contains('inspector-open');
      const want = !!open && !overviewMode;
      stage.classList.toggle('inspector-open', want);
      document.body.classList.toggle('inspector-open', want);
      // Framing already reserves drawer width on drill (viewportFitRect) — no half-nudge
      if (was === want) return;
      if (!want) {
        const d = document.getElementById('inspector-drawer');
        if (d) d.classList.remove('is-open');
        document.body.classList.remove('inspector-open');
      }
    },
    setLayoutMode: (mode) => {
      const m = mode === 'hex' ? 'hex' : 'radial';
      if (stage) stage.dataset.layoutMode = m;
      if (THEME === 'space') tweenLayoutTo(m, 600);
    },
    getLayoutMode: () => layoutMode,
    isFlying: () => flying,
    spawnPathSignal,
    labelsOverlap: () => {
      if (!POLISH) return false;
      // Only live node labels — SVG bg-labels are permanently hidden (DOM titles)
      const els = [...document.querySelectorAll('text.node-label')].filter((el) => {
        if (!el.textContent || !String(el.textContent).trim()) return false;
        let p = el;
        while (p) {
          const st = window.getComputedStyle(p);
          if (st.display === 'none' || Number(st.opacity) < 0.15) return false;
          p = p.parentElement;
          if (p && (p.id === 'tree-svg' || p.id === 'space-svg' || p.tagName === 'svg')) break;
        }
        return true;
      });
      return POLISH.labelBBoxOverlaps(els, 2);
    },
    sampleLabelOverlaps: async (ks) => {
      const out = [];
      for (const k of ks || [0.45, 1.0, 2.2]) {
        setZoomK(k);
        await new Promise((r) => requestAnimationFrame(r));
        out.push({ k, overlap: api.labelsOverlap() });
      }
      return out;
    },
  };

  buildWorld();
  initSvg();
  wireUi();
  resizeParticles();
  if (signalRunner) signalRunner.resize();
  setOverviewExpansion();
  transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
  targetTransform = transform;
  // Gemini zoom handler defers the SVG group until the camera lerps.
  // Set it now so world-origin strokes are not pinned to the stage corner.
  gRoot.attr('transform', transform);
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  syncHubTitles();
  revealT0 = performance.now();
  // Synchronous first paint — core is on the canvas before the first frame returns.
  if (typeof paintWorldOnce === 'function') paintWorldOnce();
  drawParticles(performance.now());
  drawWorldScene(performance.now());
  if (typeof drawOrbitGuides === 'function') drawOrbitGuides(performance.now());
  renderBreadcrumb(DATA.enterprise.id);
  startSignalTimers();
  window[API_NAME] = api;
  // Back-compat aliases for shared tests / tooling
  if (THEME === 'tree') window.APOS_TREE_MAP = api;
  if (THEME === 'space') {
    window.APOS_SPACE_MAP = api;
    api.openTerminal = (machineId, role) => api.openTask(machineId, role);
    api.closeTerminal = () => api.closeTask();
    api.isTerminalOpen = () => api.isTaskOpen();
    api.isBranchCardOpen = () => api.isLeafCardOpen();
    api.closeBranchCard = () => api.closeLeafCard();
    api.spawnTestPulse = () => {
      const m = machines.find((x) => x.alert) || machines[0];
      if (m) api.spawnPathSignal(m.id, m.alert ? 'alert' : 'ok');
    };
    api.pulseCount = () => pulses.length + (signalRunner?.pulseCount?.() || 0);
  }
  window[READY_FLAG] = true;
  window.__APOS_MAP_READY__ = true;

  function loop(ts) {
    if (pageHidden) return;
    const workT0 = performance.now();
    lastTs = ts;
    if (inertia && !flying && !reduceMotion) {
      inertia.vx *= 0.9;
      inertia.vy *= 0.9;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.25) inertia = null;
      else {
        const base = targetTransform || transform;
        const t = d3.zoomIdentity.translate(base.x + inertia.vx, base.y + inertia.vy).scale(base.k);
        inertiaPan = true;
        svg.call(zoomBehavior.transform, t);
        inertiaPan = false;
      }
    }
    // Gemini camera damping toward targetTransform
    if (GEMINI && !flying && targetTransform && !reduceMotion) {
      const dx = targetTransform.x - transform.x;
      const dy = targetTransform.y - transform.y;
      const dk = targetTransform.k - transform.k;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dk) * 40 > 0.02) {
        const nx = transform.x + dx * CAM_LERP;
        const ny = transform.y + dy * CAM_LERP;
        const nk = transform.k + dk * CAM_LERP;
        transform = d3.zoomIdentity.translate(nx, ny).scale(nk);
        gRoot.attr('transform', transform);
        applyLod();
        applyLabelCounterScale();
      } else if (Math.abs(dx) + Math.abs(dy) + Math.abs(dk) > 0) {
        transform = targetTransform;
        gRoot.attr('transform', transform);
        applyLod();
        applyLabelCounterScale();
      }
    }
    if (machines.some((m) => (m._offlineUntil && performance.now() >= m._offlineUntil) || (m._lowUntil && performance.now() >= m._lowUntil))) refreshAlertRollups();
    drawParticles(ts);
    drawWorldScene(ts);
    drawOrbitGuides(ts);
    if (!flying) syncHubTitles();
    if (signalRunner) signalRunner.tick(ts);
    const work = performance.now() - workT0;
    if (work > 0 && work < 80) {
      frameSamples.push(work);
      if (frameSamples.length > 90) frameSamples.shift();
    }
    // subtle node breathe
    if (!reduceMotion && gNodes && overviewMode) {
      const breathe = 1 + Math.sin(ts / 1400) * 0.012;
      gNodes.selectAll('g.node-hub g.hub-visual').attr('transform', function () {
        const inv = 1 / (transform.k || 1);
        return `scale(${inv * breathe})`;
      });
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return api;
  } // mount

  window.APOS_MAP_ENGINE = { mount };
})();
