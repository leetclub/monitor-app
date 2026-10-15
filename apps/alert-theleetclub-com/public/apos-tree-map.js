/**
 * APOS Tree Map — indigo-purple skilltree-style continuous world.
 * Radial hub ring + outward organic trees; expand-only-focused-path when drilled.
 */
(function () {
  'use strict';

  const DATA = window.APOS_SPACE_DATA;
  const BRANCHES = window.APOS_SPACE_BRANCHES;
  if (!DATA || !window.d3) {
    console.error('APOS Tree Map: missing data or d3');
    return;
  }

  const UTILS = window.APOS_MAP_UTILS;
  const POLISH = window.APOS_MAP_POLISH;
  const reduceMotion = POLISH?.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THRESH = DATA.thresholds;
  const FLY_MS = reduceMotion ? 0 : 900;
  const FIT = 0.88;
  const RING_ACCENTS = ['teal', 'violet', 'rose', 'amber', 'sky'];
  const ALERT = '#ff6b7a';

  // World geometry — large hub ring so trees fill ~85% height (not a tiny centre clump)
  const R_HUB = 340;
  // Spec §3–4 + review: overview nodes compact; deep/hub zoom uses large glowing discs ~10–14px
  const HUB_SCREEN_R = 13;
  const NODE_SCREEN_R = 5.5;
  const NODE_R_BY_TYPE = { area: 6.0, location: 5.6, machine: 5.2, branch: 4.6, artic: 3.2 };
  const DEEP_NODE_R = { area: 13.5, location: 12.5, machine: 11.5, branch: 9.5, artic: 5.5 };
  const DEEP_HUB_R = 16;
  const TREE = {
    area: 200,
    location: 165,
    machine: 120,
    branch: 48,
  };
  // Target radial extent so every hub with a real tree fills a similar open fan
  const FAN_TARGET_R = TREE.area + TREE.location + TREE.machine * 0.85;
  // Labels sit just outside machine tips
  const R_LABEL = R_HUB + TREE.area + TREE.location + TREE.machine + 44;
  const R_OUTER = R_LABEL + 20;

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
    const typeDist = {
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
      const wedge = Math.max(0.5, Math.min(1.65, share * usable));
      hub.wedge = wedge;
      layoutHubSector(hub, wedge);
      const seatBranches = (n) => {
        const kids = childrenOf.get(n.id) || [];
        const brs = kids.filter((c) => c.type === 'branch');
        brs.forEach((b, bi) => {
          const ang = (n.angle || hub.outAngle) - 0.55 + ((bi + 0.5) / brs.length) * 1.1;
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
    const a1 = s.angle != null ? s.angle : Math.atan2(y1, x1);
    const a2 = t.angle != null ? t.angle : Math.atan2(y2 - y1, x2 - x1);
    return {
      c1x: x1 + Math.cos(a1) * dist * 0.45,
      c1y: y1 + Math.sin(a1) * dist * 0.45,
      c2x: x2 - Math.cos(a2) * dist * 0.38,
      c2y: y2 - Math.sin(a2) * dist * 0.38,
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
        const twigs = 3;
        for (let i = 0; i < twigs; i++) {
          const id = `future-twig-${def.id}-${i}`;
          addNode({
            id,
            type: 'area',
            label: '',
            parentId: hub.id,
            hubId: hub.id,
            depth: 2,
            status: 'future',
            r: NODE_SCREEN_R,
            stubHint: 2,
          });
          links.push({ source: hub.id, target: id, kind: 'tree' });
        }
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
              r: NODE_SCREEN_R * 0.9,
            };
            mn.alert = computeAlert(mn);
            addNode(mn);
            machines.push(mn);
            links.push({ source: loc.id, target: m.id, kind: 'tree' });

            BRANCHES.forEach((b) => {
              const id = `${m.id}::${b.id}`;
              addNode({
                id,
                type: 'branch',
                branchKey: b.key,
                branchId: b.id,
                label: b.label,
                machineId: m.id,
                parentId: m.id,
                hubId: hub.id,
                depth: mn.depth + 1,
                status: 'active',
                r: NODE_SCREEN_R * 0.85,
                machine: mn,
              });
              links.push({ source: m.id, target: id, kind: 'leaf' });
            });
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

    // Roll up alerts onto sites / areas / hubs
    nodes.forEach((n) => {
      if (n.type === 'machine' || n.type === 'branch' || n.type === 'enterprise' || n.type === 'artic') return;
      if (!UTILS) {
        n.alertCount = 0;
        return;
      }
      const r = UTILS.rollup(n, childrenOf);
      n.alertCount = r.alerts;
      n.rollup = r;
    });
  }

  // ——— DOM ———
  const stage = document.getElementById('tree-stage');
  const svg = d3.select('#tree-svg');
  const particleCanvas = document.getElementById('tree-world') || document.getElementById('tree-particles');
  const crumbList = document.getElementById('crumb-list');
  const leafCard = document.getElementById('leaf-card');
  const taskOverlay = document.getElementById('task-overlay');

  let gRoot;
  let gBg;
  let gLinks;
  let gArts;
  let gNodes;
  let zoomBehavior;
  let transform = d3.zoomIdentity;
  let flying = false;
  let focusPinned = false;
  let hoverId = null;
  let rootPathIds = new Set();
  let focusNodeId = DATA.enterprise.id;
  /** At overview: all hubs expanded. On drill: only clicked path. */
  let expandedPath = new Set();
  let overviewMode = true;

  function allHubIds() {
    return hubs.map((h) => h.id);
  }

  function setOverviewExpansion() {
    overviewMode = true;
    // Progressive: core + hubs + first-level areas only (no sites/machines)
    expandedPath = new Set([DATA.enterprise.id, ...allHubIds()]);
    hubs.forEach((h) => {
      (childrenOf.get(h.id) || []).forEach((c) => {
        if (c.type === 'area' && !c.pad) expandedPath.add(c.id);
      });
    });
    focusNodeId = DATA.enterprise.id;
  }

  function setExpandedTo(nodeId) {
    overviewMode = false;
    expandedPath = new Set(pathToRoot(nodeId));
    focusNodeId = nodeId;
    const focus = nodeById.get(nodeId);
    if (!focus) return;

    // Progressive disclosure by depth:
    // hub → areas + sites; area → sites; location → machines; machine → branches
    if (focus.type === 'hub') {
      (childrenOf.get(focus.id) || []).forEach((area) => {
        if (area.pad || area.type === 'branch') return;
        expandedPath.add(area.id);
        (childrenOf.get(area.id) || []).forEach((loc) => {
          if (!loc.pad && loc.type === 'location') expandedPath.add(loc.id);
        });
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

  function initSvg() {
    svg.selectAll('*').remove();
    gRoot = svg.append('g').attr('class', 'viewport');
    gBg = gRoot.append('g').attr('class', 'bg-labels');
    gLinks = gRoot.append('g').attr('class', 'links');
    gArts = gRoot.append('g').attr('class', 'arts');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.15, 40])
      .filter((event) => {
        if (event.type === 'dblclick') return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        transform = event.transform;
        gRoot.attr('transform', transform);
        if (event.sourceEvent) focusPinned = false;
        applyLod();
        applyLabelCounterScale();
        updateBreadcrumbFromView();
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', (e) => {
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
    const layer = document.getElementById('label-layer');
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
        el.innerHTML = `<div class="hub-title"></div><div class="hub-sub"></div>`;
        root.appendChild(el);
      }
      const title = el.querySelector('.hub-title');
      const sub = el.querySelector('.hub-sub');
      const focused = !overviewMode && (focusHubId === h.id || focusNodeId === h.id);
      title.textContent = h.bgLabel || h.label;
      title.className = `hub-title ${h.ring || ''} ${focused ? 'is-focus' : ''} ${overviewMode ? '' : (focused ? '' : 'muted')}`;
      sub.textContent = h.subtitle || '';
      sub.className = 'hub-sub';
      // Overview: OUTSIDE tree tips on the ray from core (ref: OPERATIONS above, SALES below)
      // Focus: under orb along inward radial
      let wx, wy;
      const inward = h.outAngle + Math.PI;
      if (focused) {
        wx = h.x + Math.cos(inward) * 34;
        wy = h.y + Math.sin(inward) * 34;
      } else {
        // Past area tips only (full view hides deeper levels)
        const titleR = R_HUB + TREE.area + 72;
        wx = Math.cos(h.outAngle) * titleR;
        wy = Math.sin(h.outAngle) * titleR;
      }
      const s = worldToScreen(wx, wy);
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      // Anchor: top hubs → title above point; bottom → below; sides → centered on ray
      const ax = Math.cos(h.outAngle);
      const ay = Math.sin(h.outAngle);
      if (!focused) {
        // push title further along ray in screen px so text box clears the tip nodes
        const push = 8;
        title.style.left = `${s.x + ax * push}px`;
        title.style.top = `${s.y + ay * push}px`;
        title.style.transform = 'translate(-50%, -50%)';
        sub.style.left = `${s.x + ax * push}px`;
        sub.style.top = `${s.y + ay * push + 22}px`;
        sub.style.transform = 'translate(-50%, 0)';
      } else {
        title.style.left = `${s.x}px`;
        title.style.top = `${s.y}px`;
        title.style.transform = 'translate(-50%, 0)';
        sub.style.left = `${s.x}px`;
        sub.style.top = `${s.y + 34}px`;
        sub.style.transform = 'translate(-50%, 0)';
      }
      const op = h.status === 'future' ? (overviewMode ? 0.72 : (focused ? 0.75 : 0.14)) : (overviewMode || focused ? 1 : 0.14);
      el.style.opacity = String(op);
      el.style.display = h.draw === false ? 'none' : '';
    });
  }

  function applyLod() {
    const k = transform.k;
    const focus = nodeById.get(focusNodeId);
    const focusHubId = focus?.type === 'hub' ? focus.id : focus?.hubId || null;

    nodes.forEach((n) => {
      n.preview = false;
      n.labelOx = n.labelOx || 0;
      n.labelOy = n.labelOy || 16;

      if (n.type === 'enterprise') {
        n.draw = overviewMode || focus?.type !== 'hub';
        n.lodAlpha = overviewMode ? 1 : 0.12;
        n.labelOn = false;
        return;
      }
      if (n.type === 'hub') {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? (overviewMode ? 0.65 : 0.35) : 1;
        n.labelOn = false;
        return;
      }
      if (n.pad) {
        n.draw = false;
        n.lodAlpha = 0;
        n.labelOn = false;
        return;
      }
      if (n.type === 'artic') {
        n.draw = false;
        n.lodAlpha = 0;
        n.labelOn = false;
        return;
      }

      // ——— Full view: areas only (plus stub hints drawn separately) ———
      if (overviewMode) {
        if (n.type === 'area' && expandedPath.has(n.id)) {
          n.draw = true;
          n.lodAlpha = n.status === 'future' ? 0.4 : 1;
          n.labelOn = false;
        } else {
          n.draw = false;
          n.lodAlpha = 0;
          n.labelOn = false;
        }
        return;
      }

      // ——— Drilled: progressive path expansion ———
      if (n.type === 'branch') {
        const show = expandedPath.has(n.id) && focus?.type === 'machine' && n.parentId === focus.id;
        n.draw = show;
        n.lodAlpha = show ? 1 : 0;
        n.labelOn = show;
        return;
      }

      const onPath = expandedPath.has(n.id);
      if (onPath) {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? 0.35 : 1;
        if (!n.label || n.status === 'future') n.labelOn = false;
        else if (n.type === 'area') {
          n.labelOn = n.hubId === focusHubId && focus?.type === 'hub';
        } else if (n.type === 'location') {
          n.labelOn =
            n.hubId === focusHubId &&
            (focus?.type === 'hub' ||
              focus?.type === 'area' ||
              focus?.type === 'location' ||
              focus?.id === n.id ||
              focus?.parentId === n.id);
        } else if (n.type === 'machine') {
          n.labelOn = hoverId === n.id || focus?.id === n.id || focus?.parentId === n.id;
        } else n.labelOn = false;
        return;
      }

      // Neighbour hubs: peek areas only (no deep clutter)
      if (focusHubId) {
        const idx = hubs.findIndex((h) => h.id === focusHubId);
        if (idx >= 0) {
          const neighborIds = new Set([
            hubs[(idx - 1 + hubs.length) % hubs.length]?.id,
            hubs[(idx + 1) % hubs.length]?.id,
          ]);
          if (neighborIds.has(n.hubId) && n.type === 'area') {
            n.draw = true;
            n.preview = true;
            n.lodAlpha = 0.28;
            n.labelOn = false;
            return;
          }
        }
      }

      n.draw = false;
      n.lodAlpha = 0;
      n.labelOn = false;
    });

    articulations.forEach((a) => {
      a.draw = false;
      a.lodAlpha = 0;
    });

    resolveLabelCollisions();
    paintLod();
    syncHubTitles();
  }

  /** Nudge first-level labels apart in screen space so they don't overlap */
  function resolveLabelCollisions() {
    const labeled = nodes.filter(
      (n) => n.labelOn && n.draw && (n.type === 'area' || n.type === 'location') && n.label
    );
    labeled.forEach((n) => {
      n.labelOx = 0;
      n.labelOy = 18;
    });
    // Place along outward tangent, then push overlapping ones
    labeled.sort((a, b) => (a.angle || 0) - (b.angle || 0));
    const placed = [];
    labeled.forEach((n, i) => {
      const ang = n.angle ?? Math.atan2(n.y, n.x);
      const side = i % 2 === 0 ? 1 : -1;
      n.labelOx = Math.cos(ang + Math.PI / 2) * side * 10;
      n.labelOy = 16 + (i % 3) * 2;
      let sx = n.x * transform.k + transform.x + n.labelOx;
      let sy = n.y * transform.k + transform.y + n.labelOy * (1 / Math.max(transform.k, 0.01)) * transform.k;
      // label is counter-scaled so offset in world≈screen/k; use screen boxes ~70x14
      for (let guard = 0; guard < 6; guard++) {
        let hit = false;
        for (const p of placed) {
          if (Math.abs(sx - p.sx) < 72 && Math.abs(sy - p.sy) < 16) {
            n.labelOy += 14;
            sy += 14;
            hit = true;
            break;
          }
        }
        if (!hit) break;
      }
      placed.push({ sx, sy });
    });
  }

  function hubLabelWorld(d) {
    const focused =
      !overviewMode && (focusNodeId === d.id || (expandedPath.has(d.id) && nodeById.get(focusNodeId)?.hubId === d.id));
    if (focused || (!overviewMode && focusNodeId === d.id)) {
      const inward = d.outAngle + Math.PI;
      return { x: d.x + Math.cos(inward) * 58, y: d.y + Math.sin(inward) * 58 };
    }
    const titleR = R_HUB + TREE.area + 72;
    return { x: Math.cos(d.outAngle) * titleR, y: Math.sin(d.outAngle) * titleR };
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
          onNodeClick(d);
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
          cv.append('text').attr('class', 'core-wordmark').text('APOS');
          el.append('circle').attr('class', 'hit-target').attr('r', 36);
        } else if (d.type === 'hub') {
          const hv = el.append('g').attr('class', 'hub-visual');
          hv.append('circle').attr('class', `hub-ring ${d.ring}`).attr('r', HUB_SCREEN_R + 5);
          hv.append('circle').attr('class', 'hub-disk').attr('r', HUB_SCREEN_R);
          el.append('circle').attr('class', 'hit-target').attr('r', 24);
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

    gNodes.selectAll('g.node').each(function (d) {
      const g = d3.select(this);
      g.style('display', d.draw ? null : 'none');
      let op = d.draw ? d.lodAlpha : 0;
      // Unrelated branches dim to ~25% when drilled
      if (!overviewMode && d.draw && !focusPath.has(d.id) && !d.preview) {
        const related =
          d.hubId === focusHubId ||
          d.id === focusHubId ||
          (d.parentId && focusPath.has(d.parentId));
        if (!related) op = Math.min(op, 0.25);
      }
      g.style('opacity', op);
      g.classed('is-focus', focusNodeId === d.id || (!overviewMode && expandedPath.has(d.id) && d.type === 'hub'));
      g.classed('is-hover', hoverId === d.id);
      g.classed('has-alert', !!(d.alertCount > 0 || d.alert));
      const label = g.select('text.node-label');
      if (!label.empty()) {
        label.style('opacity', d.labelOn ? 1 : 0).style('display', d.labelOn ? null : 'none');
      }
      // Alert count pill badge (top-right of node)
      let badge = g.select('g.alert-badge-wrap');
      if (d.alertCount > 0 && d.draw && (d.type === 'hub' || d.type === 'area' || d.type === 'location') && !d.pad) {
        if (badge.empty()) {
          badge = g.append('g').attr('class', 'alert-badge-wrap');
          badge.append('rect').attr('class', 'alert-badge-bg').attr('rx', 7).attr('ry', 7);
          badge.append('text').attr('class', 'alert-badge-text');
        }
        const txt = String(d.alertCount);
        const tw = Math.max(14, 8 + txt.length * 6);
        badge.select('rect.alert-badge-bg').attr('width', tw).attr('height', 14).attr('x', -tw / 2).attr('y', -7);
        badge.select('text.alert-badge-text').text(txt);
        badge.style('display', null);
      } else if (!badge.empty()) {
        badge.style('display', 'none');
      }
      if (d.type === 'machine' && d.alert && !reduceMotion) {
        g.select('.pulse-ring').attr('opacity', 0.55);
      } else {
        g.select('.pulse-ring').attr('opacity', 0);
      }
    });

    gLinks.selectAll('path.link').each(function (d) {
      const s = nodeById.get(d.source);
      const t = nodeById.get(d.target);
      // Hide core→hub spines when drilled in (no long line under hub)
      let show = !!(s?.draw && t?.draw);
      if (d.kind === 'spine' && !overviewMode) show = false;
      const onPath = focusPath.has(d.source) && focusPath.has(d.target);
      const el = d3.select(this);
      // Constant screen opacity ~50% for tree lines (CSS stroke is near-white; do not multiply by 0.35)
      let op = 0;
      if (show) {
        if (onPath) op = 0.92;
        else if (d.kind === 'spine') op = 0.5;
        else if (s?.preview || t?.preview) op = 0.34;
        else op = 0.55;
      }
      el.style('display', show ? null : 'none')
        .classed('on-path', onPath)
        .classed('dim', !!(s?.preview || t?.preview) || (!overviewMode && !onPath && show))
        .style('opacity', op);
      if (onPath && accent) el.style('stroke', accent.stroke);
      else el.style('stroke', null);
    });

    gArts.selectAll('circle.art-dot').each(function (d) {
      d3.select(this)
        .style('display', d.draw ? null : 'none')
        .attr('opacity', d.draw ? d.lodAlpha : 0);
    });

    gBg.selectAll('g.bg-group').each(function (d) {
      const g = d3.select(this);
      const focused = !overviewMode && (focusNodeId === d.id || nodeById.get(focusNodeId)?.hubId === d.id);
      let op = 1;
      if (d.status === 'future') op = overviewMode ? 0.38 : 0.1;
      else if (!overviewMode && !expandedPath.has(d.id) && focusNodeId !== d.id) op = 0.1;
      g.style('opacity', op);
      const lab = g.select('.bg-label');
      lab.classed('accent', !!focused).classed('muted', !focused && !overviewMode);
      // Keep ring colour class for accent fills
      RING_ACCENTS.forEach((c) => lab.classed(c, d.ring === c));
    });
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

  function subtreeExtent(node) {
    // Frame only what progressive LOD will show
    const kids = (childrenOf.get(node.id) || []).filter((c) => !c.pad && c.type !== 'artic');
    const showBranches = node.type === 'machine';
    const visibleKids = kids.filter((c) => (c.type !== 'branch') || showBranches);
    const extra = [];
    // Hub: areas + sites; area/location: one more generation
    if (node.type === 'hub' || node.type === 'area' || node.type === 'location') {
      visibleKids.forEach((c) => {
        (childrenOf.get(c.id) || []).forEach((g) => {
          if (!g.pad && g.type !== 'branch' && g.type !== 'artic') {
            if (node.type === 'hub' && g.type !== 'location') return;
            extra.push(g);
          }
        });
      });
    }
    const pts = [node, ...visibleKids, ...extra];
    if (node.type === 'hub') {
      const tipR = FAN_TARGET_R;
      pts.push({
        x: node.x + Math.cos(node.outAngle) * tipR,
        y: node.y + Math.sin(node.outAngle) * tipR,
        r: 16,
      });
      const lbl = hubLabelWorld(node);
      pts.push({ x: lbl.x, y: lbl.y, r: 40 });
      // Light neighbour peek only (don't inflate extent — keeps tree filling ~70%)
      const idx = hubs.findIndex((h) => h.id === node.id);
      if (idx >= 0) {
        [-1, 1].forEach((di) => {
          const nb = hubs[(idx + di + hubs.length) % hubs.length];
          pts.push({
            x: node.x + (nb.x - node.x) * 0.22,
            y: node.y + (nb.y - node.y) * 0.22,
            r: 8,
          });
        });
      }
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((n) => {
      const pad = (n.r || 4) + 28;
      minX = Math.min(minX, n.x - pad);
      maxX = Math.max(maxX, n.x + pad);
      minY = Math.min(minY, n.y - pad);
      maxY = Math.max(maxY, n.y + pad);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fullExtent() {
    // Overview extent: hub ring + area ring + outer titles
    const pad = R_HUB + TREE.area + 140;
    return { x: -pad, y: -pad, w: pad * 2, h: pad * 2 };
  }

  function fitTransform(bbox, centerNode) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const kx = (W * FIT) / Math.max(bbox.w, 1);
    const ky = (H * FIT) / Math.max(bbox.h, 1);
    let k = Math.max(0.15, Math.min(36, Math.min(kx, ky)));
    // Full ring: outer titles reach ~90% of stage height (and width)
    if (centerNode?.type === 'enterprise') {
      const titleR = R_HUB + TREE.area + 72;
      k = Math.min((0.90 * H) / (2 * titleR), (0.90 * W) / (2 * titleR));
      return d3.zoomIdentity.translate(W / 2, H / 2).scale(k);
    }
    let cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    let cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
    if (centerNode?.type === 'hub') {
      // Hub near inward edge; areas+sites fill ~70% of stage
      const fanR = TREE.area + TREE.location * 0.95;
      k = (0.72 * Math.min(W, H)) / (fanR + 36);
      const along = centerNode.outAngle || -Math.PI / 2;
      // Hub near the inward edge; fan fills the centre ~70%+ of the frame
      const hubSX = W / 2 - Math.cos(along) * (Math.min(W, H) * 0.32);
      const hubSY = H / 2 - Math.sin(along) * (Math.min(W, H) * 0.32);
      return d3.zoomIdentity.translate(hubSX, hubSY).scale(k).translate(-centerNode.x, -centerNode.y);
    }
    if (centerNode && (centerNode.type === 'area' || centerNode.type === 'location' || centerNode.type === 'machine')) {
      // Fill ~70% with subtree; keep parent hub peeking if present
      k = Math.min(k, (0.70 * Math.min(W, H)) / Math.max(Math.min(bbox.w, bbox.h), 80));
      k = Math.max(k, 1.8);
    }
    return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
  }

  let flyGen = 0;

  function flyToTransform(target, done) {
    flying = true;
    flyGen += 1;
    const myGen = flyGen;
    svg.interrupt('fly');
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const startView = [(W / 2 - transform.x) / transform.k, (H / 2 - transform.y) / transform.k, W / transform.k];
    const endView = [(W / 2 - target.x) / target.k, (H / 2 - target.y) / target.k, W / target.k];
    if (FLY_MS === 0) {
      transform = target;
      svg.call(zoomBehavior.transform, transform);
      applyLod();
      applyLabelCounterScale();
      renderBreadcrumb(focusNodeId);
      flying = false;
      if (done) done();
      return;
    }
    const iZoom = d3.interpolateZoom(startView, endView);
    svg
      .transition('fly')
      .duration(FLY_MS)
      .ease(d3.easeCubicInOut)
      .tween('cam', () => (t) => {
        if (myGen !== flyGen) return;
        const v = iZoom(t);
        const k = W / v[2];
        transform = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-v[0], -v[1]);
        gRoot.attr('transform', transform);
        applyLod();
        applyLabelCounterScale();
      })
      .on('interrupt', () => {
        flying = false;
      })
      .on('end', () => {
        if (myGen !== flyGen) return;
        transform = target;
        svg.call(zoomBehavior.transform, transform);
        applyLod();
        applyLabelCounterScale();
        renderBreadcrumb(focusNodeId);
        flying = false;
        if (done) done();
      });
  }

  function flyToNode(node) {
    if (node.type === 'enterprise') {
      flyToGalaxy();
      return;
    }
    // Coming soon / planned hubs: show card, still fly
    if (node.type === 'hub' && (node.comingSoon || node.planned || node.status === 'future')) {
      showStatusCard(node);
    }
    setExpandedTo(node.id);
    focusPinned = true;
    if (!(node.comingSoon || node.planned)) closeLeafCard();
    applyLod();
    growFocusedChildren(node);
    flyToTransform(fitTransform(subtreeExtent(node), node));
  }

  function flyToGalaxy() {
    setOverviewExpansion();
    focusPinned = true;
    closeLeafCard();
    closeTask();
    applyLod();
    flyToTransform(fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id)));
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
    const cur = nodeById.get(focusNodeId);
    if (!cur?.parentId || cur.type === 'hub') {
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

  function renderBreadcrumb(id) {
    const path = pathToRoot(id).reverse();
    crumbList.replaceChildren();
    path.forEach((nid) => {
      const n = nodeById.get(nid);
      if (!n || n.type === 'artic') return;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = n.type === 'enterprise' ? 'APOS' : n.label;
      btn.addEventListener('click', () => flyToNode(n));
      li.appendChild(btn);
      crumbList.appendChild(li);
    });
    const prev = document.querySelector('.nav-chevron[data-dir="prev"]');
    if (prev) prev.disabled = overviewMode && leafCard.hidden;
  }

  function updateBreadcrumbFromView() {
    if (flying || focusPinned) {
      renderBreadcrumb(focusNodeId);
      return;
    }
    // When zoomed out enough, treat as overview
    if (transform.k < 0.55) {
      if (!overviewMode) {
        setOverviewExpansion();
        applyLod();
      }
      renderBreadcrumb(DATA.enterprise.id);
      return;
    }
    const id = nearestCenterNodeId();
    focusNodeId = id;
    renderBreadcrumb(id);
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
        const e = d3.easeBackOut.overshoot(1.35)(t); // springy bloom overshoot
        c.grow = 0.28 + 0.72 * e;
        if (t < 1) requestAnimationFrame(anim);
        else c.grow = 1;
      };
      requestAnimationFrame(anim);
    });
  }

  function showStatusCard(hub) {
    const title = document.getElementById('leaf-card-title');
    const body = document.getElementById('leaf-card-body');
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
    document.getElementById('leaf-card-task').hidden = true;
    leafCard.hidden = false;
    leafCard.dataset.accent = hub.ring || 'teal';
  }

  function showRollupCard(node) {
    if (!UTILS) return;
    const r = UTILS.rollup(node, childrenOf);
    const title = document.getElementById('leaf-card-title');
    const body = document.getElementById('leaf-card-body');
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
    document.getElementById('leaf-card-task').hidden = true;
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
    document.getElementById('leaf-card-title').textContent = `${m.label} · ${branchNode.label}`;
    const body = document.getElementById('leaf-card-body');
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
    const taskBtn = document.getElementById('leaf-card-task');
    taskBtn.hidden = false;
    taskBtn.onclick = () =>
      openTask(m, branchNode.branchKey === 'technical' ? 'technician' : 'operator');
    leafCard.hidden = false;
    const hubId = branchNode.hubId || m?.hubId;
    leafCard.dataset.accent = (UTILS && UTILS.HUB_ACCENT[hubId]) || 'teal';
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
  }

  let taskCtx = {};
  function openTask(machine, role) {
    const personId = role === 'technician' ? machine.technicianId : machine.operatorId;
    const person = people[personId];
    taskCtx = { person, machine, role };
    document.getElementById('task-assignee').value = person?.name || 'unassigned';
    document.getElementById('task-desc').value = '';
    document.getElementById('task-log').textContent = '';
    taskOverlay.hidden = false;
    document.getElementById('task-desc').focus();
  }
  function closeTask() {
    taskOverlay.hidden = true;
  }
  async function sendTask() {
    const text = document.getElementById('task-desc').value.trim();
    const log = document.getElementById('task-log');
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
    log.textContent = `Task dispatched to ${(taskCtx.person?.name || 'assignee')}'s mobile inbox`;
  }

  // ——— particle core (~400 dots, slow drift) ———
  let pctx;
  let coreParticles = [];
  let dust = [];
  let lastTs = 0;

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

    coreParticles = [];
    for (let i = 0; i < 460; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const rad = Math.pow(Math.random(), 0.5) * 42;
      coreParticles.push({
        ox: rad * Math.sin(phi) * Math.cos(theta),
        oy: rad * Math.sin(phi) * Math.sin(theta),
        oz: rad * Math.cos(phi),
        r: 0.5 + Math.random() * 1.3,
        pink: Math.random() < 0.22,
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.35,
      });
    }
    dust = [];
    // Spec §1 starfield ≈120–180 on 1920×1080
    const n = Math.min(180, Math.max(120, Math.floor((w * h) / 11000)));
    for (let i = 0; i < n; i++) {
      dust.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.2,
        a: 0.12 + Math.random() * 0.4,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.4 + Math.random() * 0.9,
      });
    }
  }

  
  function accentRgb(key) {
    const m = { teal:[110,212,208], violet:[184,160,232], rose:[232,160,184], pink:[232,160,184], amber:[232,192,120], sky:[126,200,232] };
    return m[key] || m.teal;
  }

  function screenOf(n) {
    return { x: n.x * transform.k + transform.x, y: n.y * transform.k + transform.y };
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
  function drawWorldScene(ts) {
    if (!pctx || !particleCanvas) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    // particles already cleared/drawn; we layer structure with additive glow
    pctx.save();
    const focusPath = new Set(pathToRoot(focusNodeId));
    const focusHubId = nodeById.get(focusNodeId)?.type === 'hub' ? focusNodeId : nodeById.get(focusNodeId)?.hubId;
    const accent = focusHubId ? accentRgb((UTILS && UTILS.HUB_ACCENT[focusHubId]) || nodeById.get(focusHubId)?.ring || 'teal') : null;

    // Curved organic links (cubic Bézier flowing outward)
    linkDrawStats = { count: 0, minOp: 1, maxOp: 0 };
    links.forEach((L) => {
      const s = nodeById.get(L.source);
      const t = nodeById.get(L.target);
      if (!s?.draw || !t?.draw) return;
      if (L.kind === 'spine' && !overviewMode) return;
      const a = screenOf(s);
      const b = screenOf(t);
      const onPath = focusPath.has(L.source) && focusPath.has(L.target);
      const preview = !!(s.preview || t.preview);
      const future = s.status === 'future' || t.status === 'future';
      let op = onPath ? 0.92 : preview ? 0.3 : (L.kind === 'spine' ? 0.45 : 0.52);
      if (future && !onPath) op = Math.min(op, 0.35);
      if (op < 0.05) return;
      if (!preview) {
        linkDrawStats.count++;
        linkDrawStats.minOp = Math.min(linkDrawStats.minOp, op);
        linkDrawStats.maxOp = Math.max(linkDrawStats.maxOp, op);
      }
      const cc = curveControls(s, t, L.kind);
      const c1 = { x: cc.c1x * transform.k + transform.x, y: cc.c1y * transform.k + transform.y };
      const c2 = { x: cc.c2x * transform.k + transform.x, y: cc.c2y * transform.k + transform.y };
      pctx.beginPath();
      pctx.moveTo(a.x, a.y);
      pctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      const fromHub = s.type === 'hub' || t.type === 'hub';
      const hubNode = s.type === 'hub' ? s : (t.type === 'hub' ? t : null);
      const firstHopRgb = hubNode ? accentRgb(hubNode.ring || 'teal') : null;
      if (onPath && accent) {
        pctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${op})`;
        pctx.lineWidth = 2;
        pctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.5)`;
        pctx.shadowBlur = 5;
      } else if (fromHub && firstHopRgb && L.kind === 'tree' && !preview) {
        pctx.strokeStyle = `rgba(${firstHopRgb[0]},${firstHopRgb[1]},${firstHopRgb[2]},${Math.min(0.72, op + 0.12)})`;
        pctx.lineWidth = 1.4;
        pctx.shadowColor = `rgba(${firstHopRgb[0]},${firstHopRgb[1]},${firstHopRgb[2]},0.3)`;
        pctx.shadowBlur = 3;
      } else {
        pctx.strokeStyle = `rgba(255,255,255,${op})`;
        pctx.lineWidth = L.kind === 'spine' ? 1.1 : 1.3;
        pctx.shadowColor = 'rgba(255,255,255,0.22)';
        pctx.shadowBlur = preview ? 0 : 2;
      }
      pctx.lineCap = 'round';
      pctx.stroke();
      pctx.shadowBlur = 0;
    });
    if (!linkDrawStats.count) linkDrawStats.minOp = 0;

    // Overview: faint short stubs beyond areas (hint that more depth exists)
    if (overviewMode) {
      nodes.forEach((n) => {
        if (n.type !== 'area' || !n.draw || !n.stubHint) return;
        const p = screenOf(n);
        const ang = n.angle != null ? n.angle : Math.atan2(n.y, n.x);
        const hint = Math.min(3, n.stubHint | 0);
        for (let i = 0; i < hint; i++) {
          const a = ang + ((i + 0.5) / hint - 0.5) * 0.55;
          const len = 18 + (i % 2) * 8;
          const x2 = p.x + Math.cos(a) * len;
          const y2 = p.y + Math.sin(a) * len;
          const cx = p.x + Math.cos(ang) * len * 0.5;
          const cy = p.y + Math.sin(ang) * len * 0.5;
          pctx.beginPath();
          pctx.moveTo(p.x, p.y);
          pctx.quadraticCurveTo(cx, cy, x2, y2);
          pctx.strokeStyle = 'rgba(255,255,255,0.32)';
          pctx.lineWidth = 1.05;
          pctx.stroke();
          pctx.beginPath();
          pctx.arc(x2, y2, 2.0, 0, Math.PI * 2);
          pctx.fillStyle = 'rgba(255,255,255,0.4)';
          pctx.fill();
        }
      });
    }

    // Nodes
    nodes.forEach((n) => {
      if (!n.draw || n.lodAlpha < 0.05) return;
      const p = screenOf(n);
      const grow = n.grow == null ? 1 : n.grow;
      // Spec §4 + review: deep zoom uses ~10–14px glowing discs
      const deep = !overviewMode;
      let r;
      if (n.type === 'hub') r = deep ? DEEP_HUB_R : HUB_SCREEN_R;
      else if (n.type === 'enterprise') r = 0;
      else r = deep ? (DEEP_NODE_R[n.type] || 11) : (NODE_R_BY_TYPE[n.type] || NODE_SCREEN_R);
      r *= grow;
      const alpha = (n.lodAlpha || 1) * (n.preview ? 0.85 : 1);
      if (n.type === 'enterprise') {
        // dense core already from particles; soft disc
        const grd = pctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 36);
        grd.addColorStop(0, 'rgba(255,255,255,0.55)');
        grd.addColorStop(0.35, 'rgba(255,255,255,0.18)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = grd;
        pctx.beginPath();
        pctx.arc(p.x, p.y, 36, 0, Math.PI * 2);
        pctx.fill();
        pctx.fillStyle = 'rgba(255,255,255,0.95)';
        pctx.font = '600 13px "Cormorant Garamond", Georgia, serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.letterSpacing = '0.28em';
        pctx.globalAlpha = overviewMode ? 0.9 : 0.25;
        pctx.fillText('APOS', p.x, p.y);
        pctx.globalAlpha = 1;
        return;
      }
      if (n.type === 'hub') {
        const rgb = accentRgb(n.ring || 'teal');
        const breathe = reduceMotion ? 1 : 1 + Math.sin(ts / 1400 + (n.angle || 0)) * 0.015;
        const rr = (deep ? DEEP_HUB_R : HUB_SCREEN_R) * breathe;
        const focusedHub = focusNodeId === n.id || (!overviewMode && expandedPath.has(n.id));
        const bloom = pctx.createRadialGradient(p.x, p.y, rr * 0.2, p.x, p.y, rr + 14);
        bloom.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.55 * alpha})`);
        bloom.addColorStop(0.55, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.18 * alpha})`);
        bloom.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        pctx.fillStyle = bloom;
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr + 14, 0, Math.PI * 2);
        pctx.fill();
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr + 4, 0, Math.PI * 2);
        pctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(focusedHub ? 0.95 : 0.8) * alpha})`;
        pctx.lineWidth = focusedHub ? 2.8 : 2.2;
        pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.75)`;
        pctx.shadowBlur = 14;
        pctx.stroke();
        pctx.shadowBlur = 0;
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        pctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.72 * alpha})`;
        pctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.7)`;
        pctx.shadowBlur = 12;
        pctx.fill();
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr * 0.48, 0, Math.PI * 2);
        pctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.92 * alpha})`;
        pctx.shadowBlur = 6;
        pctx.fill();
        pctx.shadowBlur = 0;
        drawHubGlyph(pctx, p.x, p.y, rr * 0.62, n.id, alpha);
      } else {
        const isAlert = !!(n.alert || (n.type === 'machine' && n.alert));
        const hoverScale = hoverId === n.id ? 1.3 : 1;
        const rr = r * hoverScale;
        const areaAccent = n.type === 'area' ? accentRgb(n.ring || nodeById.get(n.hubId)?.ring || 'teal') : null;
        const halo = pctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 2.2);
        if (isAlert) halo.addColorStop(0, 'rgba(255,107,122,0.45)');
        else if (areaAccent) halo.addColorStop(0, `rgba(${areaAccent[0]},${areaAccent[1]},${areaAccent[2]},${0.4 * alpha})`);
        else halo.addColorStop(0, `rgba(255,255,255,${0.35 * alpha})`);
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = halo;
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr * 2.2, 0, Math.PI * 2);
        pctx.fill();
        pctx.beginPath();
        pctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        if (isAlert) {
          pctx.fillStyle = ALERT;
          pctx.shadowColor = 'rgba(255,107,122,0.85)';
        } else if (areaAccent) {
          pctx.fillStyle = `rgba(${areaAccent[0]},${areaAccent[1]},${areaAccent[2]},${0.92 * alpha})`;
          pctx.shadowColor = `rgba(${areaAccent[0]},${areaAccent[1]},${areaAccent[2]},0.7)`;
        } else {
          pctx.fillStyle = `rgba(255,255,255,${0.97 * alpha})`;
          pctx.shadowColor = 'rgba(255,255,255,0.7)';
        }
        pctx.shadowBlur = hoverId === n.id ? 16 : 8;
        pctx.fill();
        pctx.shadowBlur = 0;
        if (hoverId === n.id) {
          pctx.beginPath();
          pctx.arc(p.x, p.y, rr * 1.4, 0, Math.PI * 2);
          pctx.strokeStyle = 'rgba(255,255,255,0.6)';
          pctx.lineWidth = 1.4;
          pctx.stroke();
        }
      }
      // Alert pill badge
      if (n.alertCount > 0 && (n.type === 'hub' || n.type === 'area' || n.type === 'location') && !n.pad) {
        const txt = String(n.alertCount);
        const tw = Math.max(14, 8 + txt.length * 6);
        const bx = p.x + 11;
        const by = p.y - 10;
        pctx.beginPath();
        // round rect
        const x0 = bx - tw / 2, y0 = by - 7, w = tw, h = 14, rad = 7;
        pctx.moveTo(x0 + rad, y0);
        pctx.arcTo(x0 + w, y0, x0 + w, y0 + h, rad);
        pctx.arcTo(x0 + w, y0 + h, x0, y0 + h, rad);
        pctx.arcTo(x0, y0 + h, x0, y0, rad);
        pctx.arcTo(x0, y0, x0 + w, y0, rad);
        pctx.closePath();
        pctx.fillStyle = ALERT;
        pctx.fill();
        pctx.fillStyle = '#fff';
        pctx.font = '700 10px Manrope, sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.fillText(txt, bx, by);
      }
    });
    pctx.restore();
  }


  function drawParticles(ts) {
    if (!pctx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    pctx.clearRect(0, 0, w, h);
    const tDust = (ts || 0) / 1000;
    for (const d of dust) {
      const twinkle = reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(tDust * d.twSpeed + d.tw);
      pctx.beginPath();
      pctx.fillStyle = `rgba(220, 230, 255,${d.a * twinkle})`;
      pctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      pctx.fill();
    }

    // Core particles only in overview — hide glowing ball under hub when drilled
    if (!overviewMode) return;

    const t = (ts || 0) / 1000;
    const cx = transform.x;
    const cy = transform.y;
    const k = transform.k;
    // Soft bloom behind core cloud
    pctx.beginPath();
    const coreBloom = pctx.createRadialGradient(cx, cy, 4 * k, cx, cy, 52 * k);
    coreBloom.addColorStop(0, 'rgba(255,255,255,0.28)');
    coreBloom.addColorStop(0.4, 'rgba(200,190,255,0.12)');
    coreBloom.addColorStop(1, 'rgba(255,255,255,0)');
    pctx.fillStyle = coreBloom;
    pctx.arc(cx, cy, 52 * k, 0, Math.PI * 2);
    pctx.fill();
    for (const p of coreParticles) {
      const ang = t * p.speed + p.phase;
      const x = p.ox * Math.cos(ang * 0.3) - p.oz * Math.sin(ang * 0.3);
      const y = p.oy + Math.sin(ang) * 1.5;
      const sx = x * k + cx;
      const sy = y * k + cy;
      const alpha = 0.4 + 0.55 * (1 - Math.min(1, Math.hypot(p.ox, p.oy, p.oz) / 40));
      pctx.beginPath();
      pctx.fillStyle = p.pink
        ? `rgba(240, 170, 200, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      pctx.shadowColor = p.pink ? 'rgba(240,170,200,0.5)' : 'rgba(255,255,255,0.45)';
      pctx.shadowBlur = 3;
      pctx.arc(sx, sy, Math.max(0.7, p.r * Math.min(1.5, 0.6 + k * 0.18)), 0, Math.PI * 2);
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
        document.getElementById('dashboards-view').hidden = btn.dataset.view !== 'dashboards';
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
    document.getElementById('leaf-card-close').addEventListener('click', closeLeafCard);
    document.getElementById('task-close').addEventListener('click', closeTask);
    taskOverlay.addEventListener('click', (e) => {
      if (e.target === taskOverlay) closeTask();
    });
    document.getElementById('task-send').addEventListener('click', sendTask);
    window.addEventListener('keydown', (e) => {
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
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = nodeById.get(focusNodeId);
        if (!cur) return;
        if (cur.type === 'hub' || overviewMode) {
          const idx = hubs.findIndex((h) => h.id === (cur.type === 'hub' ? cur.id : focusNodeId));
          const next = hubs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + hubs.length) % hubs.length];
          if (next) flyToNode(next);
          return;
        }
        const siblings = (childrenOf.get(cur.parentId) || []).filter((c) => c.type === cur.type);
        const si = siblings.findIndex((s) => s.id === cur.id);
        if (si < 0 || siblings.length < 2) return;
        const nxt = siblings[(si + (e.key === 'ArrowRight' ? 1 : -1) + siblings.length) % siblings.length];
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

  const tooltipEl = document.getElementById('map-tooltip');
  function showTooltip(event, d) {
    if (!tooltipEl || !d || d.type === 'enterprise') return;
    let stat = '';
    if (d.rollup) stat = `${d.rollup.online}/${d.rollup.total} online · ${d.rollup.alerts} alerts`;
    else if (d.type === 'machine') {
      const alert = d.alert ? ` · ${d.alert}` : '';
      stat = `${d.revenue?.today ?? '—'} KWD today${alert}`;
    } else if (d.subtitle) stat = d.subtitle;
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
  const signalCanvas = document.getElementById('tree-world') || document.getElementById('tree-signals');
  const labelLayerEl = document.getElementById('label-layer');
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

  function spawnPathSignal(machineId, kind) {
    const pathIds = pathToRoot(machineId);
    const color = kind === 'alert' ? 'rgba(255,107,122,0.95)' : 'rgba(230,245,255,0.95)';
    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = nodeById.get(pathIds[i]);
      const b = nodeById.get(pathIds[i + 1]);
      if (!a || !b) continue;
      pulses.push({
        x0: a.x, y0: a.y, x1: b.x, y1: b.y,
        t: -i * 0.08, speed: 0.014, color, bright: true,
      });
    }
    if (signalRunner) signalRunner.spawnPath(pathIds, color, true);
  }

  function startSignalTimers() {
    if (reduceMotion) return;
    setInterval(() => {
      if (!machines.length) return;
      const live = machines.filter((m) => m.status !== 'planned' && m.status !== 'future');
      if (!live.length) return;
      const m = live[Math.floor(Math.random() * live.length)];
      const kind = m.alert && Math.random() < 0.45 ? 'alert' : 'transaction';
      spawnPathSignal(m.id, kind);
    }, 2800);
  }

  function waitForIdle() {
    return new Promise((resolve) => {
      const tick = () => {
        if (!flying) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function setZoomK(k) {
    focusPinned = false;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const [wx, wy] = transform.invert([W / 2, H / 2]);
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-wx, -wy);
    transform = t;
    svg.call(zoomBehavior.transform, t);
    applyLod();
    applyLabelCounterScale();
    updateBreadcrumbFromView();
  }

  function worldToScreen(x, y) {
    return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
  }

  window.APOS_TREE_MAP = {
    getFocus: () => {
      const n = nodeById.get(focusNodeId);
      return {
        id: focusNodeId,
        type: n?.type,
        level: n?.depth ?? 0,
        machineId: n?.type === 'machine' ? n.id : n?.machineId,
        locationId: n?.locationId,
        hubId: n?.hubId || (n?.type === 'hub' ? n.id : undefined),
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
    countLinkCrossings: () => countLinkCrossings(),
    countDrawnOfType: (type) => nodes.filter((n) => n.type === type && n.draw && !n.preview && n.lodAlpha > 0.05).length,
    isOverview: () => overviewMode,
    getAlertCount: (id) => nodeById.get(id)?.alertCount || 0,
    getRollup: (id) => nodeById.get(id)?.rollup || null,
    isFlying: () => flying,
    spawnPathSignal,
    labelsOverlap: () => {
      if (!POLISH) return false;
      const els = [
        ...document.querySelectorAll('text.node-label'),
        ...document.querySelectorAll('text.bg-label'),
      ];
      return POLISH.labelBBoxOverlaps(els, 2);
    },
    sampleLabelOverlaps: async (ks) => {
      const out = [];
      for (const k of ks || [0.45, 1.0, 2.2]) {
        setZoomK(k);
        await new Promise((r) => requestAnimationFrame(r));
        out.push({ k, overlap: window.APOS_TREE_MAP.labelsOverlap() });
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
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  syncHubTitles();
  // Synchronous first paint — map visible within first frame (~<300ms), no blank intro
  if (typeof paintWorldOnce === 'function') paintWorldOnce();
  else {
    drawParticles(performance.now());
    drawWorldScene(performance.now());
  }
  renderBreadcrumb(DATA.enterprise.id);
  startSignalTimers();
  window.__APOS_TREE_READY__ = true;

  requestAnimationFrame(function loop(ts) {
    lastTs = ts;
    drawParticles(ts);
    drawWorldScene(ts);
    if (!flying) syncHubTitles();
    if (signalRunner) signalRunner.tick(ts);
    // subtle node breathe
    if (!reduceMotion && gNodes && overviewMode) {
      const breathe = 1 + Math.sin(ts / 1400) * 0.012;
      gNodes.selectAll('g.node-hub g.hub-visual').attr('transform', function () {
        const inv = 1 / (transform.k || 1);
        return `scale(${inv * breathe})`;
      });
    }
    requestAnimationFrame(loop);
  });
})();
