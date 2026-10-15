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

  // World geometry — large hub ring so trees fill ~85% height (not a tiny centre clump)
  const R_HUB = 340;
  const HUB_SCREEN_R = 8; // ~16px diameter via counter-scale — readable at full view
  const NODE_SCREEN_R = 3; // ~6px white dots
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

  function placeFan(parent, kids, dist, spread, baseAngle) {
    const n = kids.length;
    if (!n) return;
    // Sparse hubs keep a wide open sweep so the fan reads full-size (not a thin spike)
    const sweep = Math.min(spread, Math.max(0.95, 0.55 + n * 0.38));
    kids.forEach((c, i) => {
      const a = baseAngle + ((i + 0.5) / n - 0.5) * sweep;
      const jitter = ((hash(c.id) % 11) - 5) * 0.018;
      const dJ = dist * (0.9 + (hash(c.id + 'd') % 7) * 0.03);
      c.x = parent.x + Math.cos(a + jitter) * dJ;
      c.y = parent.y + Math.sin(a + jitter) * dJ;
      c.angle = a + jitter;
      c.labelOx = 0;
      c.labelOy = 16;
    });
  }

  /** Scale a hub's subtree so tips reach FAN_TARGET_R — balances Leet / EE / Park fans */
  function normalizeHubFan(hub) {
    const desc = [];
    const walk = (id) => {
      (childrenOf.get(id) || []).forEach((c) => {
        if (c.type === 'branch' || c.type === 'artic') return;
        desc.push(c);
        walk(c.id);
      });
    };
    walk(hub.id);
    if (!desc.length) return;
    let maxD = 0;
    desc.forEach((n) => {
      const d = Math.hypot(n.x - hub.x, n.y - hub.y);
      if (d > maxD) maxD = d;
    });
    if (maxD < 40) return;
    const s = FAN_TARGET_R / maxD;
    if (Math.abs(s - 1) < 0.04) return;
    desc.forEach((n) => {
      n.x = hub.x + (n.x - hub.x) * s;
      n.y = hub.y + (n.y - hub.y) * s;
    });
  }

  /** Extra airy twigs so sparse hubs (EE/Park) fill a similar cone without fake machines */
  function padSparseFan(hub, firstKids) {
    if (hub.status === 'future' && !firstKids.length) return;
    const need = Math.max(0, 5 - firstKids.length);
    if (need <= 0) return;
    // Active hubs get bright structural pads; future hubs stay dim — never real machines
    const padStatus = hub.status === 'active' ? 'active' : 'future';
    for (let i = 0; i < need; i++) {
      const a = hub.outAngle + ((i + 0.5) / need - 0.5) * 1.25;
      const dist = TREE.area * (0.62 + (hash(hub.id + 'pad' + i) % 5) * 0.08);
      const id = `fan-pad-${hub.id}-${i}`;
      addNode({
        id,
        type: 'area',
        label: '',
        parentId: hub.id,
        hubId: hub.id,
        depth: 2,
        status: padStatus,
        r: NODE_SCREEN_R * 0.85,
        x: hub.x + Math.cos(a) * dist,
        y: hub.y + Math.sin(a) * dist,
        angle: a,
        pad: true,
      });
      links.push({ source: hub.id, target: id, kind: 'tree' });
      for (let j = 0; j < 3; j++) {
        const a2 = a + ((j + 0.5) / 3 - 0.5) * 0.62;
        const id2 = `${id}-t${j}`;
        const d2 = TREE.location * (0.55 + (hash(id2) % 4) * 0.08);
        addNode({
          id: id2,
          type: 'location',
          label: '',
          parentId: id,
          hubId: hub.id,
          depth: 3,
          status: padStatus,
          r: NODE_SCREEN_R * 0.75,
          x: hub.x + Math.cos(a) * dist + Math.cos(a2) * d2,
          y: hub.y + Math.sin(a) * dist + Math.sin(a2) * d2,
          angle: a2,
          pad: true,
        });
        links.push({ source: id, target: id2, kind: 'tree' });
        // Decorative tip dots (location type) so the cone fills at overview — not counted as machines
        for (let t = 0; t < 2; t++) {
          const id3 = `${id2}-tip${t}`;
          const a3 = a2 + ((t + 0.5) / 2 - 0.5) * 0.35;
          const d3 = TREE.machine * (0.55 + (hash(id3) % 3) * 0.1);
          addNode({
            id: id3,
            type: 'location',
            label: '',
            parentId: id2,
            hubId: hub.id,
            depth: 4,
            status: padStatus,
            r: NODE_SCREEN_R * 0.7,
            x: hub.x + Math.cos(a) * dist + Math.cos(a2) * d2 + Math.cos(a3) * d3,
            y: hub.y + Math.sin(a) * dist + Math.sin(a2) * d2 + Math.sin(a3) * d3,
            angle: a3,
            pad: true,
          });
          links.push({ source: id2, target: id3, kind: 'tree' });
        }
      }
    }
  }

  /** Sparse mid-edge dots only (no side twigs) — keeps trees airy */
  function addArticulations(sId, tId) {
    const s = nodeById.get(sId);
    const t = nodeById.get(tId);
    if (!s || !t) return;
    // One mid-dot on longer edges only
    const len = Math.hypot(t.x - s.x, t.y - s.y);
    if (len < 90) return;
    const u = 0.45 + (hash(sId + tId) % 3) * 0.05;
    const wobble = (((hash(sId) % 5) - 2) / 2) * 8;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const nx = -dy;
    const ny = dx;
    const nlen = Math.hypot(nx, ny) || 1;
    articulations.push({
      id: `art-${sId}-${tId}`,
      type: 'artic',
      x: s.x + dx * u + (nx / nlen) * wobble,
      y: s.y + dy * u + (ny / nlen) * wobble,
      r: NODE_SCREEN_R,
      parentId: sId,
      hubId: t.hubId || s.hubId || s.id,
      depth: Math.min(s.depth, t.depth) + 0.5,
      status: 'active',
    });
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

      // SA/AE etc: no areas — airy placeholder twigs only
      if ((def.status === 'future' || def.planned) && !def.areas.length) {
        const twigs = 3;
        for (let i = 0; i < twigs; i++) {
          const a = hub.outAngle + ((i + 0.5) / twigs - 0.5) * 1.05;
          const dist = TREE.area * (0.7 + (hash(def.id + i) % 4) * 0.08);
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
            x: hub.x + Math.cos(a) * dist,
            y: hub.y + Math.sin(a) * dist,
            angle: a,
          });
          links.push({ source: hub.id, target: id, kind: 'tree' });
          for (let j = 0; j < 2; j++) {
            const a2 = a + ((j + 0.5) / 2 - 0.5) * 0.55;
            const id2 = `${id}-t${j}`;
            const d2 = TREE.location * (0.65 + (hash(id2) % 3) * 0.08);
            addNode({
              id: id2,
              type: 'location',
              label: '',
              parentId: id,
              hubId: hub.id,
              depth: 3,
              status: 'future',
              r: NODE_SCREEN_R * 0.85,
              x: hub.x + Math.cos(a) * dist + Math.cos(a2) * d2,
              y: hub.y + Math.sin(a) * dist + Math.sin(a2) * d2,
              angle: a2,
            });
            links.push({ source: id, target: id2, kind: 'tree' });
            // one tip machine-dot further out
            const id3 = `${id2}-tip`;
            addNode({
              id: id3,
              type: 'machine',
              label: '',
              parentId: id2,
              hubId: hub.id,
              depth: 4,
              status: 'future',
              r: NODE_SCREEN_R * 0.75,
              x: hub.x + Math.cos(a) * dist + Math.cos(a2) * (d2 + TREE.machine * 0.45),
              y: hub.y + Math.sin(a) * dist + Math.sin(a2) * (d2 + TREE.machine * 0.45),
              angle: a2,
            });
            links.push({ source: id2, target: id3, kind: 'tree' });
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

      // Place tree growing OUTWARD from hub — wide open fans (~25–30% viewport)
      let firstKids = childrenOf.get(hub.id) || [];
      // Pad sparse real trees (EE/Park) before placement so the cone matches Leet's openness
      if (def.areas && def.areas.length) {
        padSparseFan(hub, firstKids);
        firstKids = childrenOf.get(hub.id) || [];
      }
      const sparseBoost = Math.max(1, 3 / Math.max(firstKids.filter((c) => !c.pad).length, 1));
      const distMul = 1 + Math.min(0.28, (sparseBoost - 1) * 0.14);
      placeFan(hub, firstKids, TREE.area * distMul, Math.PI * 1.35, hub.outAngle);
      firstKids.forEach((kid) => {
        const next = childrenOf.get(kid.id) || [];
        placeFan(kid, next, TREE.location * distMul, Math.PI * 1.2, kid.angle ?? hub.outAngle);
        next.forEach((loc) => {
          const ms = childrenOf.get(loc.id) || [];
          placeFan(loc, ms, TREE.machine * distMul, Math.PI * 1.05, loc.angle ?? hub.outAngle);
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
      if (def.areas && def.areas.length) {
        normalizeHubFan(hub);
        // Re-seat leaf branches after fan normalize (walker skips branch nodes)
        (function reseat(id) {
          const host = nodeById.get(id);
          const kids = childrenOf.get(id) || [];
          const brs = kids.filter((c) => c.type === 'branch');
          brs.forEach((b, bi) => {
            const ang = -Math.PI / 2 + ((bi + 0.5) / Math.max(brs.length, 1)) * Math.PI * 2;
            b.x = host.x + Math.cos(ang) * TREE.branch;
            b.y = host.y + Math.sin(ang) * TREE.branch;
          });
          kids.forEach((c) => {
            if (c.type !== 'branch') reseat(c.id);
          });
        })(hub.id);
      }
    });

    // Sparse mid-edge dots only (no side twigs)
    links.forEach((l) => {
      if (l.kind === 'spine' || l.kind === 'leaf') return;
      addArticulations(l.source, l.target);
    });

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
    const focus = nodeById.get(focusNodeId);

    nodes.forEach((n) => {
      const lod = LOD[n.type] || LOD.location;
      const kOk = k >= lod.draw;
      n.preview = false;
      n.labelOx = n.labelOx || 0;
      n.labelOy = n.labelOy || 16;

      if (n.type === 'enterprise') {
        // Hide core when drilled into a hub (no spine/core under the hub label)
        n.draw = overviewMode || focus?.type !== 'hub';
        n.lodAlpha = overviewMode ? 1 : 0.15;
        n.labelOn = false;
        return;
      }
      if (n.type === 'hub') {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? (overviewMode ? 0.62 : 0.4) : 1;
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
        // Overview: hub labels only. Hub/drill: first-level areas + sites; machines on hover/deep zoom.
        const focusedHubId =
          focus?.type === 'hub' ? focus.id : focus?.hubId || null;
        if (!n.label || n.status === 'future' || overviewMode) {
          n.labelOn = false;
        } else if (n.type === 'machine') {
          n.labelOn = hoverId === n.id || (k >= lod.label && k <= lod.labelMax);
        } else if (n.type === 'area') {
          // First-level children of the focused hub
          n.labelOn =
            !!focusedHubId &&
            n.hubId === focusedHubId &&
            n.parentId === focusedHubId &&
            k >= lod.label &&
            k <= lod.labelMax;
        } else if (n.type === 'location') {
          // Sites: when focused on an area, or deeper zoom on a hub
          const parent = nodeById.get(n.parentId);
          n.labelOn =
            !!focusedHubId &&
            n.hubId === focusedHubId &&
            k >= lod.label &&
            k <= lod.labelMax &&
            (focus?.type === 'area' ||
              focus?.type === 'location' ||
              (focus?.type === 'hub' && k >= 1.35) ||
              parent?.type === 'hub');
        } else {
          n.labelOn = false;
        }
        return;
      }

      // Neighbouring hub trees peek at screen edges (compare-hub reference)
      if (!overviewMode && focus?.type === 'hub') {
        const idx = hubs.findIndex((h) => h.id === focus.id);
        if (idx >= 0) {
          const neighborIds = new Set([
            hubs[(idx - 1 + hubs.length) % hubs.length]?.id,
            hubs[(idx + 1) % hubs.length]?.id,
          ]);
          const nHub = n.type === 'hub' ? n.id : n.hubId;
          if (neighborIds.has(nHub) && n.type !== 'branch' && n.status !== 'future') {
            n.draw = n.type === 'hub' || n.type === 'area' || n.type === 'location' || n.type === 'machine';
            n.preview = true;
            n.lodAlpha = n.type === 'hub' ? 0.55 : 0.32;
            n.labelOn = false;
            return;
          }
          if (neighborIds.has(nHub) && n.status === 'future' && n.type !== 'branch') {
            n.draw = true;
            n.preview = true;
            n.lodAlpha = 0.2;
            n.labelOn = false;
            return;
          }
        }
      }

      // faint one-level preview under other collapsed hubs
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

    // articulations: hub view only (keep full view airy — structural nodes only)
    articulations.forEach((a) => {
      const hubExpanded = expandedPath.has(a.hubId);
      a.draw = !overviewMode && hubExpanded && k >= LOD.artic.draw;
      a.lodAlpha = hubExpanded ? 0.75 : 0;
    });

    resolveLabelCollisions();
    paintLod();
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
    // Overview: just outside the tree. Hub drill-in: directly under the hub orb.
    const focused =
      !overviewMode && (focusNodeId === d.id || (expandedPath.has(d.id) && nodeById.get(focusNodeId)?.hubId === d.id));
    if (focused || (!overviewMode && focusNodeId === d.id)) {
      const inward = d.outAngle + Math.PI;
      return {
        x: d.x + Math.cos(inward) * 48,
        y: d.y + Math.sin(inward) * 48,
      };
    }
    return {
      x: Math.cos(d.outAngle) * R_LABEL,
      y: Math.sin(d.outAngle) * R_LABEL,
    };
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
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        // Clean thin lines — slight organic bend, spines nearly straight
        const bend = d.kind === 'spine' ? 0.015 : 0.06 + (hash(d.target) % 4) * 0.015;
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
    const depth = node.type === 'hub' ? 4 : node.type === 'machine' ? 1 : 3;
    const kids = collectDescendants(node, depth).filter((c) => c.type !== 'branch' || node.type === 'machine');
    const pts = [node, ...kids];
    if (node.type === 'hub') {
      const tipR = TREE.area + TREE.location + TREE.machine * 0.45;
      pts.push({
        x: node.x + Math.cos(node.outAngle) * tipR,
        y: node.y + Math.sin(node.outAngle) * tipR,
        r: 12,
      });
      const lbl = hubLabelWorld(node);
      pts.push({ x: lbl.x, y: lbl.y, r: 36 });
      // Include neighbouring hubs so they peek at the edges (compare-hub)
      const idx = hubs.findIndex((h) => h.id === node.id);
      if (idx >= 0) {
        [-1, 1].forEach((di) => {
          const nb = hubs[(idx + di + hubs.length) % hubs.length];
          pts.push({
            x: (node.x + nb.x) * 0.55,
            y: (node.y + nb.y) * 0.55,
            r: 20,
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
    const pad = R_OUTER;
    return { x: -pad, y: -pad, w: pad * 2, h: pad * 2 };
  }

  function fitTransform(bbox, centerNode) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const kx = (W * FIT) / Math.max(bbox.w, 1);
    const ky = (H * FIT) / Math.max(bbox.h, 1);
    let k = Math.max(0.15, Math.min(36, Math.min(kx, ky)));
    // Galaxy: constellation diameter ≈ 85% of stage height
    if (centerNode?.type === 'enterprise') {
      k = (0.455 * H) / R_OUTER;
      return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(0, 0);
    }
    // Hub drill-in: hub lower-centre, tree fills view, core off-screen, neighbours at edges
    let cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    let cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
    if (centerNode?.type === 'hub') {
      const tipR = TREE.area + TREE.location * 0.7;
      // Bias camera into the tree so core/spines leave the frame
      cx = centerNode.x + Math.cos(centerNode.outAngle) * tipR * 0.62;
      cy = centerNode.y + Math.sin(centerNode.outAngle) * tipR * 0.62;
      const treeH = TREE.area + TREE.location + TREE.machine * 0.55 + 40;
      k = Math.min(k * 0.95, (0.82 * H) / treeH);
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
    const kids = (childrenOf.get(node.id) || []).filter((c) => c.type !== 'branch');
    kids.forEach((c, i) => {
      const sel = gNodes.select(`[data-id="${c.id}"]`);
      if (sel.empty()) return;
      sel
        .interrupt()
        .attr('transform', `translate(${c.x},${c.y}) scale(0.4)`)
        .style('opacity', 0)
        .transition()
        .delay(i * 40)
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('transform', `translate(${c.x},${c.y}) scale(1)`)
        .style('opacity', c.lodAlpha ?? 1);
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

    // Core particles only in overview — hide in hub drill-in (no glowing ball under hub)
    if (!overviewMode) return;

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
  const signalCanvas = document.getElementById('tree-signals');
  let signalRunner = null;
  if (signalCanvas && POLISH) {
    signalRunner = POLISH.createSignalRunner({
      canvas: signalCanvas,
      getNode: (id) => nodeById.get(id),
      worldToScreen: (x, y) => worldToScreen(x, y),
      reduceMotion,
    });
  }

  function spawnPathSignal(machineId, kind) {
    if (!signalRunner) return;
    const path = pathToRoot(machineId);
    const color =
      kind === 'alert' ? 'rgba(255, 107, 122, 0.95)' : 'rgba(240, 248, 255, 0.9)';
    signalRunner.spawnPath(path, color, true);
  }

  function startSignalTimers() {
    if (reduceMotion || !signalRunner) return;
    setInterval(() => {
      if (!machines.length) return;
      const m = machines[Math.floor(Math.random() * machines.length)];
      if (m.status === 'planned' || m.status === 'future') return;
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
  paintWorldOnce();
  setOverviewExpansion();
  transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  renderBreadcrumb(DATA.enterprise.id);
  startSignalTimers();

  requestAnimationFrame(function loop(ts) {
    lastTs = ts;
    drawParticles(ts);
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
