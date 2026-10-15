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

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THRESH = DATA.thresholds;
  const FLY_MS = reduceMotion ? 0 : 820;
  const FIT = 0.82;

  // World geometry (camera fitted so hub ring ≈ 22% of viewport half-min)
  const R_HUB = 210;
  const HUB_SCREEN_R = 6; // ~12px diameter on screen via counter-scale
  const TREE = {
    area: 110,
    location: 88,
    machine: 64,
    branch: 34,
  };

  const LOD = {
    enterprise: { draw: 0.02, label: 0.05, labelMax: 2 },
    hub: { draw: 0.02, label: 0.05, labelMax: 8 },
    area: { draw: 0.08, label: 0.55, labelMax: 10 },
    location: { draw: 0.12, label: 1.1, labelMax: 16 },
    machine: { draw: 0.18, label: 2.4, labelMax: 28 },
    branch: { draw: 3.8, label: 5.0, labelMax: 48 },
    artic: { draw: 0.08, label: 99, labelMax: 99 },
  };

  const RING_COLORS = ['teal', 'violet', 'pink', 'teal', 'violet', 'pink', 'teal'];

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
    const stockLow = (m.stock?.fillPct ?? 100) < THRESH.stockLowPct;
    const offlineLong = m.status === 'offline' && (m.offlineHours || 0) > THRESH.offlineHours;
    const revBase = m.revenue?.baseline || 1;
    const revLow = ((m.revenue?.today ?? revBase) / revBase) * 100 < THRESH.revenueBelowBaselinePct;
    if (offlineLong || m.status === 'offline') return 'red';
    if (stockLow || revLow || m.status === 'maintenance') return 'amber';
    return null;
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function placeFan(parent, kids, dist, spread, baseAngle) {
    const n = kids.length;
    if (!n) return;
    const sweep = Math.min(spread, 0.4 + n * 0.32);
    kids.forEach((c, i) => {
      const a = baseAngle + ((i + 0.5) / n - 0.5) * sweep;
      const jitter = ((hash(c.id) % 9) - 4) * 0.014;
      const dJ = dist * (0.92 + (hash(c.id + 'd') % 5) * 0.025);
      c.x = parent.x + Math.cos(a + jitter) * dJ;
      c.y = parent.y + Math.sin(a + jitter) * dJ;
      c.angle = a + jitter;
    });
  }

  function addArticulations(sId, tId) {
    const s = nodeById.get(sId);
    const t = nodeById.get(tId);
    if (!s || !t) return;
    const steps = 3 + (hash(sId + tId) % 4);
    for (let i = 1; i <= steps; i++) {
      const u = i / (steps + 1);
      const wobble = Math.sin(u * Math.PI) * 10 * (((hash(sId + i) % 7) - 3) / 3);
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const nx = -dy;
      const ny = dx;
      const len = Math.hypot(nx, ny) || 1;
      articulations.push({
        id: `art-${sId}-${tId}-${i}`,
        type: 'artic',
        x: s.x + dx * u + (nx / len) * wobble,
        y: s.y + dy * u + (ny / len) * wobble,
        r: 2.2 + (hash(sId + i) % 4) * 0.55,
        parentId: sId,
        hubId: t.hubId || s.hubId || s.id,
        depth: Math.min(s.depth, t.depth) + 0.5,
        status: 'active',
      });
    }
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
        subtitle: isFuture
          ? client.status === 'future'
            ? 'coming soon'
            : 'testing zone'
          : (client.brand || client.label).toLowerCase() + ' · sites · machines',
        status: isFuture ? 'future' : 'active',
        areas,
        clientId: client.id,
        countryId: kw.id,
        bgLabel: client.label.toUpperCase(),
      });
    });
    DATA.countries
      .filter((c) => c.status === 'future')
      .forEach((c) => {
        hubDefs.push({
          id: c.id,
          label: c.label.toUpperCase(),
          subtitle: 'future market',
          status: 'future',
          areas: [],
          clientId: null,
          countryId: c.id,
          bgLabel: (c.code || c.label).toUpperCase(),
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
        ring: RING_COLORS[i % RING_COLORS.length],
        outAngle: a,
        x: Math.cos(a) * R_HUB,
        y: Math.sin(a) * R_HUB,
      };
      addNode(hub);
      hubs.push(hub);
      links.push({ source: core.id, target: hub.id, kind: 'spine' });

      if (def.status === 'future' || !def.areas.length) {
        // Dim placeholder twigs so future hubs still read as trees on the ring
        const twigs = 4 + (hash(def.id) % 3);
        for (let i = 0; i < twigs; i++) {
          const a = hub.outAngle + ((i + 0.5) / twigs - 0.5) * 0.7;
          const dist = 55 + (hash(def.id + i) % 40);
          const id = `future-twig-${def.id}-${i}`;
          addNode({
            id,
            type: 'area',
            label: '',
            parentId: hub.id,
            hubId: hub.id,
            depth: 2,
            status: 'future',
            r: 2.2,
            x: hub.x + Math.cos(a) * dist,
            y: hub.y + Math.sin(a) * dist,
            angle: a,
          });
          links.push({ source: hub.id, target: id, kind: 'tree' });
          const tips = 2 + (hash(id) % 2);
          for (let j = 0; j < tips; j++) {
            const a2 = a + ((j + 0.5) / tips - 0.5) * 0.55;
            const id2 = `${id}-t${j}`;
            addNode({
              id: id2,
              type: 'location',
              label: '',
              parentId: id,
              hubId: hub.id,
              depth: 3,
              status: 'future',
              r: 1.8,
              x: hub.x + Math.cos(a) * dist + Math.cos(a2) * 36,
              y: hub.y + Math.sin(a) * dist + Math.sin(a2) * 36,
              angle: a2,
            });
            links.push({ source: id, target: id2, kind: 'tree' });
          }
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
            status: 'active',
            r: 3.8,
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
            status: 'active',
            r: 3.4,
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
              r: 3.0,
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
                r: 2.5,
                machine: mn,
              });
              links.push({ source: m.id, target: id, kind: 'leaf' });
            });
          });
        });
      });

      // Place tree growing OUTWARD from hub (organic fans)
      const firstKids = childrenOf.get(hub.id) || [];
      placeFan(hub, firstKids, TREE.area, Math.PI * 1.05, hub.outAngle);
      firstKids.forEach((kid) => {
        const next = childrenOf.get(kid.id) || [];
        placeFan(kid, next, TREE.location, Math.PI * 0.95, kid.angle ?? hub.outAngle);
        next.forEach((loc) => {
          const ms = childrenOf.get(loc.id) || [];
          placeFan(loc, ms, TREE.machine, Math.PI * 1.0, loc.angle ?? hub.outAngle);
          ms.forEach((m) => {
            const brs = childrenOf.get(m.id) || [];
            brs.forEach((b, bi) => {
              const ang = -Math.PI / 2 + ((bi + 0.5) / Math.max(brs.length, 1)) * Math.PI * 2;
              b.x = m.x + Math.cos(ang) * TREE.branch;
              b.y = m.y + Math.sin(ang) * TREE.branch;
            });
          });
        });
      });
    });

    // Decorative articulation dots along tree links (+ light side twigs for density)
    links.forEach((l) => {
      if (l.kind === 'spine' || l.kind === 'leaf') return;
      addArticulations(l.source, l.target);
      const s = nodeById.get(l.source);
      const t = nodeById.get(l.target);
      if (!s || !t || t.type === 'machine') return;
      const twigs = 1 + (hash(l.target) % 2);
      for (let i = 0; i < twigs; i++) {
        const u = 0.35 + i * 0.25;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const side = i % 2 === 0 ? 1 : -1;
        const bx = s.x + dx * u;
        const by = s.y + dy * u;
        const tw = 14 + (hash(l.target + i) % 10);
        articulations.push({
          id: `twig-${l.target}-${i}`,
          type: 'artic',
          x: bx + px * side * tw,
          y: by + py * side * tw,
          r: 2.0 + (hash(l.target + 't' + i) % 3) * 0.5,
          parentId: s.id,
          hubId: t.hubId || s.hubId || s.id,
          depth: (s.depth + t.depth) / 2,
          status: 'active',
        });
        articulations.push({
          id: `twigm-${l.target}-${i}`,
          type: 'artic',
          x: bx + px * side * tw * 0.5,
          y: by + py * side * tw * 0.5,
          r: 1.5,
          parentId: s.id,
          hubId: t.hubId || s.hubId || s.id,
          depth: (s.depth + t.depth) / 2,
          status: 'active',
        });
      }
    });
  }

  // ——— DOM ———
  const stage = document.getElementById('tree-stage');
  const svg = d3.select('#tree-svg');
  const particleCanvas = document.getElementById('tree-particles');
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
    expandedPath = new Set([DATA.enterprise.id, ...allHubIds()]);
    // also expand one level under each hub so locations+machines show in overview
    hubs.forEach((h) => {
      (childrenOf.get(h.id) || []).forEach((c) => {
        expandedPath.add(c.id);
        (childrenOf.get(c.id) || []).forEach((c2) => expandedPath.add(c2.id));
      });
    });
    focusNodeId = DATA.enterprise.id;
  }

  function setExpandedTo(nodeId) {
    overviewMode = false;
    expandedPath = new Set(pathToRoot(nodeId));
    focusNodeId = nodeId;
    // Expand descendants of the clicked node only (not siblings of ancestors)
    const focus = nodeById.get(nodeId);
    if (!focus || focus.type === 'machine' || focus.type === 'branch') return;
    const walk = (id) => {
      (childrenOf.get(id) || []).forEach((c) => {
        if (c.type === 'branch') return;
        expandedPath.add(c.id);
        if (c.type !== 'machine') walk(c.id);
      });
    };
    walk(nodeId);
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

  function applyLod() {
    const k = transform.k;

    nodes.forEach((n) => {
      const lod = LOD[n.type] || LOD.location;
      const kOk = k >= lod.draw;
      n.preview = false;

      if (n.type === 'enterprise' || n.type === 'hub') {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? 0.35 : 1;
        n.labelOn = false; // hub names are bg-labels
        return;
      }

      if (n.type === 'branch') {
        const parentOnPath = expandedPath.has(n.parentId);
        n.draw = kOk && parentOnPath && !overviewMode;
        n.lodAlpha = n.draw ? 1 : 0;
        n.labelOn = n.draw && k >= lod.label && k <= lod.labelMax;
        return;
      }

      const onPath = expandedPath.has(n.id);
      const parentOnPath = n.parentId && expandedPath.has(n.parentId);

      if (onPath || parentOnPath) {
        n.draw = kOk;
        n.lodAlpha = n.status === 'future' ? 0.28 : 1;
        const near = nodeScreenDistToCenter(n) < Math.min(stage.clientWidth, stage.clientHeight) * 0.5;
        n.labelOn =
          n.draw &&
          n.status !== 'future' &&
          !!n.label &&
          k >= lod.label &&
          k <= lod.labelMax &&
          (near || onPath || overviewMode);
        if (overviewMode && n.type === 'machine') n.labelOn = k >= 1.2 && near;
        return;
      }

      // faint one-level preview under collapsed hubs when drilled elsewhere
      const parent = n.parentId ? nodeById.get(n.parentId) : null;
      if (parent?.type === 'hub' && k >= lod.draw && n.type !== 'machine') {
        n.draw = true;
        n.preview = true;
        n.lodAlpha = 0.2;
        n.labelOn = false;
        return;
      }

      n.draw = false;
      n.lodAlpha = 0;
      n.labelOn = false;
    });

    // articulations follow their hub's visibility
    articulations.forEach((a) => {
      const hubExpanded = expandedPath.has(a.hubId) || overviewMode;
      a.draw = hubExpanded && k >= LOD.artic.draw;
      a.lodAlpha = overviewMode ? 0.85 : expandedPath.has(a.hubId) ? 0.9 : 0.15;
    });

    paintLod();
  }

  function hubLabelWorld(d) {
    // Overview: labels beyond the tree (outer ring). Drill-in on this hub: under hub (inward).
    const focused = !overviewMode && expandedPath.has(d.id) && focusNodeId === d.id;
    if (focused) {
      const inward = d.outAngle + Math.PI;
      return {
        x: d.x + Math.cos(inward) * 42,
        y: d.y + Math.sin(inward) * 42,
      };
    }
    const labelR = R_HUB + 260;
    return {
      x: Math.cos(d.outAngle) * labelR,
      y: Math.sin(d.outAngle) * labelR,
    };
  }

  function applyLabelCounterScale() {
    const inv = 1 / (transform.k || 1);
    gNodes.selectAll('g.label-layer').attr('transform', `scale(${inv})`);
    gNodes.selectAll('text.core-wordmark').attr('transform', `scale(${inv})`);
    // Keep hub orbs ~12px on screen
    gNodes.selectAll('g.node-hub').each(function () {
      d3.select(this).select('g.hub-visual').attr('transform', `scale(${inv})`);
    });
    // Soft-cap node screen size when deeply zoomed
    const soft = transform.k > 2 ? 2 / transform.k : 1;
    gNodes.selectAll('g.node-area, g.node-location, g.node-machine, g.node-branch').each(function () {
      const g = d3.select(this);
      g.select('circle.star-core').attr('transform', soft === 1 ? null : `scale(${soft})`);
      g.select('circle.pulse-ring').attr('transform', soft === 1 ? null : `scale(${soft})`);
    });
    gArts.selectAll('circle.art-dot').attr('r', (d) => d.r * soft);
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
        g.select('.bg-label').text(d.bgLabel || d.label);
        const sub = (d.subtitle || '').toLowerCase().replace(/\s+/g, ' ');
        g.select('.bg-sub').text(sub);
      });

    gLinks
      .selectAll('path.link')
      .data(links, (d) => `${d.source}->${d.target}`)
      .join('path')
      .attr('class', (d) => `link ${d.kind || ''}`)
      .attr('d', (d) => {
        const s = nodeById.get(d.source);
        const t = nodeById.get(d.target);
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const bend = d.kind === 'spine' ? 0.02 : 0.12 + (hash(d.target) % 5) * 0.02;
        const mx = (s.x + t.x) / 2 - dy * bend;
        const my = (s.y + t.y) / 2 + dx * bend;
        return `M${s.x},${s.y}Q${mx},${my} ${t.x},${t.y}`;
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
        .on('mouseenter', (_, d) => {
          hoverId = d.id;
          rootPathIds = new Set(pathToRoot(d.id));
          paintLod();
        })
        .on('mouseleave', () => {
          hoverId = null;
          rootPathIds = new Set();
          paintLod();
        });

      g.each(function (d) {
        const el = d3.select(this);
        if (d.type === 'enterprise') {
          el.append('text').attr('class', 'core-wordmark').text('APOS');
          el.append('circle').attr('class', 'hit-target').attr('r', 36);
        } else if (d.type === 'hub') {
          const hv = el.append('g').attr('class', 'hub-visual');
          hv.append('circle').attr('class', `hub-ring ${d.ring}`).attr('r', HUB_SCREEN_R + 4);
          hv.append('circle').attr('class', 'hub-disk').attr('r', HUB_SCREEN_R);
          el.append('circle').attr('class', 'hit-target').attr('r', 22);
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
            .attr('y', d.r + 12)
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
    gNodes.selectAll('g.node').each(function (d) {
      const g = d3.select(this);
      g.style('display', d.draw ? null : 'none');
      g.style('opacity', d.draw ? d.lodAlpha : 0);
      g.classed('is-focus', focusNodeId === d.id || (!overviewMode && expandedPath.has(d.id) && d.type === 'hub'));
      g.classed('is-hover', hoverId === d.id);
      const label = g.select('text.node-label');
      if (!label.empty()) {
        label.style('opacity', d.labelOn ? 1 : 0).style('display', d.labelOn ? null : 'none');
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
      const show = s?.draw && t?.draw;
      const onPath = rootPathIds.has(d.source) && rootPathIds.has(d.target);
      d3.select(this)
        .style('display', show ? null : 'none')
        .classed('on-path', onPath)
        .classed('dim', !!(s?.preview || t?.preview))
        .style('opacity', show ? Math.min(s.lodAlpha, t.lodAlpha) : 0);
    });

    gArts.selectAll('circle.art-dot').each(function (d) {
      d3.select(this)
        .style('display', d.draw ? null : 'none')
        .attr('opacity', d.draw ? d.lodAlpha : 0);
    });

    gBg.selectAll('g.bg-group').style('opacity', (d) => {
      if (d.status === 'future') return 0.28;
      if (!overviewMode && !expandedPath.has(d.id) && transform.k > 1.4) return 0.15;
      return 1;
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
    const depth = node.type === 'hub' ? 4 : node.type === 'machine' ? 1 : 3;
    const kids = collectDescendants(node, depth).filter((c) => c.type !== 'branch' || node.type === 'machine');
    const pts = [node, ...kids];
    if (node.type === 'hub') {
      // tree tip along outAngle + label under hub
      const tipR = TREE.area + TREE.location + TREE.machine * 0.6;
      pts.push({
        x: node.x + Math.cos(node.outAngle) * tipR,
        y: node.y + Math.sin(node.outAngle) * tipR,
        r: 12,
      });
      const lbl = hubLabelWorld(node);
      pts.push({ x: lbl.x, y: lbl.y, r: 28 });
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((n) => {
      const pad = (n.r || 4) + 22;
      minX = Math.min(minX, n.x - pad);
      maxX = Math.max(maxX, n.x + pad);
      minY = Math.min(minY, n.y - pad);
      maxY = Math.max(maxY, n.y + pad);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fullExtent() {
    const pad = R_HUB + 300;
    return { x: -pad, y: -pad, w: pad * 2, h: pad * 2 };
  }

  function fitTransform(bbox, centerNode) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const kx = (W * FIT) / Math.max(bbox.w, 1);
    const ky = (H * FIT) / Math.max(bbox.h, 1);
    let k = Math.max(0.2, Math.min(36, Math.min(kx, ky)));
    // Galaxy: force hub ring ≈ 22% of viewport half-min
    if (centerNode?.type === 'enterprise') {
      const halfMin = Math.min(W, H) / 2;
      k = (0.22 * halfMin) / R_HUB;
      return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(0, 0);
    }
    // Hub drill-in: bias so hub sits lower and tree fills the view (like compare-hub)
    let cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    let cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
    if (centerNode?.type === 'hub') {
      const tipR = TREE.area + TREE.location * 0.55;
      cx = centerNode.x + Math.cos(centerNode.outAngle) * tipR * 0.45;
      cy = centerNode.y + Math.sin(centerNode.outAngle) * tipR * 0.45;
      k = Math.min(k, 2.8);
    }
    return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
  }

  function flyToTransform(target, done) {
    if (FLY_MS === 0) {
      transform = target;
      svg.call(zoomBehavior.transform, transform);
      applyLod();
      applyLabelCounterScale();
      renderBreadcrumb(focusNodeId);
      if (done) done();
      return;
    }
    flying = true;
    const start = { k: transform.k, x: transform.x, y: transform.y };
    const end = { k: target.k, x: target.x, y: target.y };
    const zt = d3.interpolate(start, end);
    svg
      .transition('fly')
      .duration(FLY_MS)
      .ease(d3.easeCubicInOut)
      .tween('cam', () => (t) => {
        const v = zt(t);
        transform = d3.zoomIdentity.translate(v.x, v.y).scale(v.k);
        gRoot.attr('transform', transform);
        applyLod();
        applyLabelCounterScale();
      })
      .on('end interrupt', () => {
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
    setExpandedTo(node.id);
    focusPinned = true;
    closeLeafCard();
    applyLod();
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

  function onNodeClick(d) {
    if (flying) return;
    if (d.status === 'future') return;
    if (d.type === 'branch') {
      setExpandedTo(d.machineId);
      focusPinned = true;
      applyLod();
      showLeafCard(d);
      renderBreadcrumb(d.machineId);
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
    document.getElementById('leaf-card-task').onclick = () =>
      openTask(m, branchNode.branchKey === 'technical' ? 'technician' : 'operator');
    leafCard.hidden = false;
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
    const n = Math.min(80, Math.floor((w * h) / 22000));
    for (let i = 0; i < n; i++) {
      dust.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random(),
        a: 0.04 + Math.random() * 0.08,
      });
    }
  }

  function drawParticles(ts) {
    if (!pctx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    pctx.clearRect(0, 0, w, h);
    for (const d of dust) {
      pctx.beginPath();
      pctx.fillStyle = `rgba(255,255,255,${d.a})`;
      pctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      pctx.fill();
    }

    // project core particles through current zoom (core at world 0,0)
    const t = (ts || 0) / 1000;
    const cx = transform.x;
    const cy = transform.y;
    const k = transform.k;
    for (const p of coreParticles) {
      const ang = t * p.speed + p.phase;
      const x = p.ox * Math.cos(ang * 0.3) - p.oz * Math.sin(ang * 0.3);
      const y = p.oy + Math.sin(ang) * 1.5;
      const sx = x * k + cx;
      const sy = y * k + cy;
      const alpha = 0.35 + 0.55 * (1 - Math.min(1, Math.hypot(p.ox, p.oy, p.oz) / 40));
      pctx.beginPath();
      pctx.fillStyle = p.pink
        ? `rgba(240, 170, 200, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      pctx.arc(sx, sy, Math.max(0.6, p.r * Math.min(1.4, 0.55 + k * 0.15)), 0, Math.PI * 2);
      pctx.fill();
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
    document.querySelector('.nav-chevron[data-dir="prev"]').addEventListener('click', flyOut);
    document.querySelector('.nav-chevron[data-dir="next"]').addEventListener('click', () => {
      if (overviewMode) {
        const active = hubs.find((h) => h.status === 'active');
        if (active) flyToNode(active);
        return;
      }
      const kids = (childrenOf.get(focusNodeId) || []).filter((c) => c.status !== 'future');
      if (kids[0]) flyToNode(kids[0]);
    });
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
      }
    });
    window.addEventListener('resize', () => {
      resizeParticles();
      if (!flying) {
        if (overviewMode) {
          transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
          svg.call(zoomBehavior.transform, transform);
        }
        applyLod();
      }
    });
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
  };

  buildWorld();
  initSvg();
  wireUi();
  resizeParticles();
  paintWorldOnce();
  setOverviewExpansion();
  transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  renderBreadcrumb(DATA.enterprise.id);

  requestAnimationFrame(function loop(ts) {
    lastTs = ts;
    drawParticles(ts);
    requestAnimationFrame(loop);
  });
})();
