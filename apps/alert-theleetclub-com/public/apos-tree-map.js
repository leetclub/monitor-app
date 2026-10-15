/**
 * APOS Tree Map — light lavender continuous semantic-zoom world.
 * Organic hub trees; expand-only-focused-path (same rule as dark space map).
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
  const FLY_MS = reduceMotion ? 0 : 800;
  const FIT = 0.78;

  const LOD = {
    enterprise: { draw: 0.05, label: 0.08, labelMax: 1.4 },
    hub: { draw: 0.05, label: 0.1, labelMax: 3.5 },
    area: { draw: 0.35, label: 0.7, labelMax: 8 },
    location: { draw: 0.9, label: 1.6, labelMax: 14 },
    machine: { draw: 2.0, label: 3.2, labelMax: 24 },
    branch: { draw: 4.2, label: 5.2, labelMax: 48 },
  };

  const people = DATA.people;
  const nodes = [];
  const links = [];
  const nodeById = new Map();
  const childrenOf = new Map();
  const machines = [];
  const hubs = [];

  function addNode(n) {
    n.x = 0;
    n.y = 0;
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

  /** Organic fan: place children along an outward arc from parent */
  function placeFan(parent, kids, dist, spread, baseAngle) {
    const n = kids.length;
    if (!n) return;
    const sweep = Math.min(spread, 0.35 + n * 0.28);
    kids.forEach((c, i) => {
      const a = baseAngle + ((i + 0.5) / n - 0.5) * sweep;
      const jitter = ((hash(c.id) % 7) - 3) * 0.012;
      c.x = parent.x + Math.cos(a + jitter) * dist;
      c.y = parent.y + Math.sin(a + jitter) * dist;
      c.angle = a;
    });
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function buildWorld() {
    nodes.length = 0;
    links.length = 0;
    nodeById.clear();
    childrenOf.clear();
    machines.length = 0;
    hubs.length = 0;

    const core = {
      id: DATA.enterprise.id,
      type: 'enterprise',
      label: DATA.enterprise.label,
      status: 'active',
      parentId: null,
      depth: 0,
      r: 42,
    };
    addNode(core);
    core.x = 0;
    core.y = 40;

    // Hubs = Kuwait brands (+ future countries as dim hubs)
    const kw = DATA.countries.find((c) => c.id === 'country-kw') || DATA.countries[0];
    const brandHubs = (kw?.clients || []).map((cl) => ({
      id: cl.id,
      type: 'hub',
      label: cl.label,
      status: cl.status,
      parentId: core.id,
      countryId: kw.id,
      depth: 1,
      r: cl.status === 'future' ? 18 : 26,
      icon: cl.label === 'EE' ? 'store' : cl.label === 'Park' ? 'building' : 'brand',
      bgLabel: cl.label.toUpperCase(),
      sourceClient: cl,
    }));
    const futureCountries = DATA.countries.filter((c) => c.status === 'future');
    futureCountries.forEach((c) => {
      brandHubs.push({
        id: c.id,
        type: 'hub',
        label: c.label,
        status: 'future',
        parentId: core.id,
        countryId: c.id,
        depth: 1,
        r: 16,
        icon: 'globe',
        bgLabel: c.code || c.label.toUpperCase(),
        sourceClient: null,
      });
    });

    const hubCount = brandHubs.length;
    brandHubs.forEach((h, i) => {
      // Arrange hubs in a wide arc above/around the core (reference: horizontal row of trees)
      const t = hubCount === 1 ? 0.5 : i / (hubCount - 1);
      const a = -Math.PI + 0.35 + t * (Math.PI - 0.7);
      const R = 280;
      h.x = Math.cos(a) * R;
      h.y = Math.sin(a) * R - 40;
      h.outAngle = a; // trees grow further outward
      addNode(h);
      hubs.push(h);
      links.push({ source: core.id, target: h.id, kind: 'spine' });

      const client = h.sourceClient;
      if (!client || client.status === 'future') return;

      (client.areas || []).forEach((area) => {
        const ar = {
          id: area.id,
          type: 'area',
          label: area.label,
          parentId: h.id,
          hubId: h.id,
          countryId: h.countryId,
          clientId: client.id,
          depth: 2,
          status: 'active',
          r: 7,
          areaManagerId: area.areaManagerId,
        };
        addNode(ar);
        links.push({ source: h.id, target: area.id, kind: 'tree' });

        (area.locations || []).forEach((loc) => {
          const ln = {
            id: loc.id,
            type: 'location',
            label: loc.label,
            parentId: area.id,
            hubId: h.id,
            areaId: area.id,
            clientId: client.id,
            countryId: h.countryId,
            depth: 3,
            status: 'active',
            r: 5.5,
            address: loc.address,
          };
          addNode(ln);
          links.push({ source: area.id, target: loc.id, kind: 'tree' });

          (loc.machines || []).forEach((m) => {
            const mn = {
              id: m.id,
              type: 'machine',
              label: m.label,
              parentId: loc.id,
              hubId: h.id,
              locationId: loc.id,
              areaId: area.id,
              clientId: client.id,
              countryId: h.countryId,
              depth: 4,
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
              r: 4.5,
            };
            mn.alert = computeAlert(mn);
            addNode(mn);
            machines.push(mn);
            links.push({ source: loc.id, target: m.id, kind: 'tree' });

            BRANCHES.forEach((b, bi) => {
              const id = `${m.id}::${b.id}`;
              addNode({
                id,
                type: 'branch',
                branchKey: b.key,
                branchId: b.id,
                label: b.label,
                machineId: m.id,
                parentId: m.id,
                hubId: h.id,
                depth: 5,
                status: 'active',
                r: 3.5,
                machine: mn,
              });
              links.push({ source: m.id, target: id, kind: 'leaf' });
            });
          });
        });
      });

      // Place organic tree growing outward from hub
      const areas = childrenOf.get(h.id) || [];
      placeFan(h, areas, 110, Math.PI * 0.95, h.outAngle);
      areas.forEach((ar) => {
        const locs = childrenOf.get(ar.id) || [];
        placeFan(ar, locs, 70, Math.PI * 0.85, ar.angle ?? h.outAngle);
        locs.forEach((loc) => {
          const ms = childrenOf.get(loc.id) || [];
          placeFan(loc, ms, 48, Math.PI * 0.9, loc.angle ?? h.outAngle);
          ms.forEach((m) => {
            const brs = childrenOf.get(m.id) || [];
            brs.forEach((b, i) => {
              const a = -Math.PI / 2 + (i / Math.max(brs.length, 1)) * Math.PI * 2;
              b.x = m.x + Math.cos(a) * 28;
              b.y = m.y + Math.sin(a) * 28;
            });
          });
        });
      });
    });
  }

  // ——— DOM / camera ———
  const stage = document.getElementById('tree-stage');
  const svg = d3.select('#tree-svg');
  const particleCanvas = document.getElementById('tree-particles');
  const crumbList = document.getElementById('crumb-list');
  const leafCard = document.getElementById('leaf-card');
  const taskOverlay = document.getElementById('task-overlay');

  let gRoot;
  let gBg;
  let gLinks;
  let gNodes;
  let zoomBehavior;
  let transform = d3.zoomIdentity;
  let flying = false;
  let focusPinned = false;
  let hoverId = null;
  let rootPathIds = new Set();
  let focusNodeId = DATA.enterprise.id;
  let expandedPath = new Set([DATA.enterprise.id]);

  function initSvg() {
    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    const glow = defs.append('radialGradient').attr('id', 'core-glow');
    glow.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff').attr('stop-opacity', 0.95);
    glow.append('stop').attr('offset', '45%').attr('stop-color', '#d8f6f4').attr('stop-opacity', 0.45);
    glow.append('stop').attr('offset', '100%').attr('stop-color', '#eceaf2').attr('stop-opacity', 0);
    const body = defs.append('radialGradient').attr('id', 'core-body');
    body.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff');
    body.append('stop').attr('offset', '70%').attr('stop-color', '#e8f8f7');
    body.append('stop').attr('offset', '100%').attr('stop-color', '#c5e8e6');

    gRoot = svg.append('g').attr('class', 'viewport');
    gBg = gRoot.append('g').attr('class', 'bg-labels');
    gLinks = gRoot.append('g').attr('class', 'links');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.12, 36])
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

  function pathToRoot(id) {
    const path = [];
    let cur = nodeById.get(id);
    while (cur) {
      path.push(cur.id);
      cur = cur.parentId ? nodeById.get(cur.parentId) : null;
    }
    return path;
  }

  function setExpandedTo(nodeId) {
    expandedPath = new Set(pathToRoot(nodeId));
    focusNodeId = nodeId;
  }

  function nodeScreenDistToCenter(n) {
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    const sx = n.x * transform.k + transform.x;
    const sy = n.y * transform.k + transform.y;
    return Math.hypot(sx - cx, sy - cy);
  }

  function applyLod() {
    const k = transform.k;
    nodes.forEach((n) => {
      const lod = LOD[n.type] || LOD.location;
      const kOk = k >= lod.draw;
      n.preview = false;

      if (n.depth <= 1) {
        n.draw = true;
        n.lodAlpha = n.status === 'future' ? 0.38 : 1;
        const labelOk = k >= lod.label && k <= lod.labelMax;
        n.labelOn = n.draw && labelOk;
        return;
      }

      const onPath = expandedPath.has(n.id);
      const parentOnPath = n.parentId && expandedPath.has(n.parentId);

      if (onPath || parentOnPath) {
        n.draw = kOk;
        let a = 1;
        if (k < lod.draw * 1.3) a = Math.max(0.25, (k - lod.draw * 0.4) / (lod.draw * 0.9));
        n.lodAlpha = a;
        const near = nodeScreenDistToCenter(n) < Math.min(stage.clientWidth, stage.clientHeight) * 0.48;
        n.labelOn = n.draw && k >= lod.label && k <= lod.labelMax && (near || onPath);
        return;
      }

      // one-level faint preview under collapsed siblings of an expanded hub/area
      const parent = n.parentId ? nodeById.get(n.parentId) : null;
      const allowPreview =
        parent &&
        n.type !== 'machine' &&
        n.type !== 'branch' &&
        n.depth <= 3 &&
        (expandedPath.has(parent.parentId) || parent.depth === 1) &&
        k >= lod.draw * 1.2;

      if (allowPreview) {
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
    paintLod();
  }

  function applyLabelCounterScale() {
    const inv = 1 / (transform.k || 1);
    gNodes.selectAll('g.label-layer').attr('transform', `scale(${inv})`);
    gNodes.selectAll('text.core-wordmark').attr('transform', `scale(${inv})`);
    gBg.selectAll('text.bg-label').attr('transform', function (d) {
      return `translate(${d.x},${d.y + 70}) scale(${inv})`;
    });
  }

  function hubIconPath(kind) {
    if (kind === 'store') return 'M4 10h16v10H4zM4 10l2-6h12l2 6M9 20v-4h6v4';
    if (kind === 'building') return 'M6 20V6h12v14M10 9h1M13 9h1M10 12h1M13 12h1M10 15h1M13 15h1';
    if (kind === 'globe') return 'M12 3a9 9 0 100 18 9 9 0 000-18zm-9 9h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18';
    return 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z';
  }

  function paintWorldOnce() {
    gBg
      .selectAll('text.bg-label')
      .data(hubs.filter((h) => h.status !== 'future'), (d) => d.id)
      .join('text')
      .attr('class', 'bg-label')
      .attr('data-hub', (d) => d.id)
      .text((d) => d.bgLabel || d.label);

    gLinks
      .selectAll('path.link')
      .data(links, (d) => `${d.source}->${d.target}`)
      .join('path')
      .attr('class', (d) => `link ${d.kind || ''}`)
      .attr('d', (d) => {
        const s = nodeById.get(d.source);
        const t = nodeById.get(d.target);
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        return `M${s.x},${s.y}Q${mx - dy * 0.06},${my + dx * 0.06} ${t.x},${t.y}`;
      });

    gNodes
      .selectAll('g.node')
      .data(nodes, (d) => d.id)
      .join((enter) => {
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
            el.append('circle').attr('class', 'core-glow').attr('r', d.r * 2.4);
            el.append('circle').attr('class', 'core-body').attr('r', d.r);
            for (let i = 0; i < 14; i++) {
              const a = (i / 14) * Math.PI * 2;
              const rr = d.r * (0.55 + (i % 3) * 0.12);
              el.append('circle')
                .attr('r', 1.1)
                .attr('fill', '#fff')
                .attr('opacity', 0.8)
                .attr('cx', Math.cos(a) * rr)
                .attr('cy', Math.sin(a) * rr);
            }
            el.append('text').attr('class', 'core-wordmark').text('APOS');
            el.append('circle').attr('class', 'hit-target').attr('r', d.r + 16);
          } else if (d.type === 'hub') {
            el.append('circle').attr('class', 'hub-ring').attr('r', d.r + 6);
            el.append('circle').attr('class', 'hub-disk').attr('r', d.r);
            const ig = el.append('g').attr('transform', 'translate(-12,-12)');
            ig.append('path')
              .attr('class', 'hub-icon')
              .attr('d', hubIconPath(d.icon))
              .attr('transform', 'scale(1)');
            el.append('circle').attr('class', 'hit-target').attr('r', d.r + 14);
            const lab = el.append('g').attr('class', 'label-layer');
            lab.append('text').attr('class', 'node-label hub').attr('y', d.r + 22).attr('dy', '0.35em').text(d.label);
          } else {
            el.append('circle').attr('class', 'pulse-ring').attr('r', d.r + 8);
            el.append('circle')
              .attr('class', `star-core${d.alert ? ' alert' : ''}`)
              .attr('r', d.r);
            el.append('circle').attr('class', 'hit-target').attr('r', d.r + 10);
            const lab = el.append('g').attr('class', 'label-layer');
            lab
              .append('text')
              .attr('class', 'node-label small')
              .attr('y', d.r + 14)
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
      const show = d.draw;
      g.style('display', show ? null : 'none');
      g.style('opacity', show ? d.lodAlpha : 0);
      g.classed('is-hover', hoverId === d.id);
      g.classed('is-focus', focusNodeId === d.id || expandedPath.has(d.id) && d.type === 'hub');
      g.classed('on-path', rootPathIds.has(d.id));
      const label = g.select('text.node-label');
      if (!label.empty()) {
        label.style('opacity', d.labelOn ? 1 : 0).style('display', d.labelOn ? null : 'none');
      }
      if (d.type === 'machine' && d.alert && !reduceMotion) {
        g.select('.pulse-ring').attr('opacity', 0.55).attr('stroke', d.alert === 'red' ? '#e11d48' : '#d4a017');
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

    gBg.selectAll('text.bg-label').style('opacity', (d) => {
      if (transform.k > 2.2) return 0;
      return expandedPath.has(d.id) ? 0.14 : 0.07;
    });
  }

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
    const depth = node.type === 'machine' ? 1 : node.type === 'location' ? 1 : 2;
    const kids = collectDescendants(node, depth).filter((c) => {
      // only include kids that would be revealed by expanding this node
      return true;
    });
    const pts = [node, ...kids];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((n) => {
      const pad = (n.r || 6) + 24;
      minX = Math.min(minX, n.x - pad);
      maxX = Math.max(maxX, n.x + pad);
      minY = Math.min(minY, n.y - pad);
      maxY = Math.max(maxY, n.y + pad + 20);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fullExtent() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes
      .filter((n) => n.depth <= 1)
      .forEach((n) => {
        const pad = 160;
        minX = Math.min(minX, n.x - pad);
        maxX = Math.max(maxX, n.x + pad);
        minY = Math.min(minY, n.y - pad);
        maxY = Math.max(maxY, n.y + pad);
      });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fitTransform(bbox, centerNode) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const kx = (W * FIT) / Math.max(bbox.w, 1);
    const ky = (H * FIT) / Math.max(bbox.h, 1);
    const k = Math.max(0.15, Math.min(32, Math.min(kx, ky)));
    const cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    const cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
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
    setExpandedTo(node.id);
    focusPinned = true;
    closeLeafCard();
    applyLod();
    flyToTransform(fitTransform(subtreeExtent(node), node));
  }

  function flyToGalaxy() {
    setExpandedTo(DATA.enterprise.id);
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
    if (!cur?.parentId) {
      flyToGalaxy();
      return;
    }
    flyToNode(nodeById.get(cur.parentId));
  }

  function nearestCenterNodeId() {
    let best = null;
    let bestScore = Infinity;
    nodes.forEach((n) => {
      if (!n.draw || n.type === 'branch') return;
      if (transform.k < (LOD[n.type] || LOD.location).draw) return;
      const d = nodeScreenDistToCenter(n);
      const score = d - n.depth * 26;
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
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = n.type === 'enterprise' ? 'Galaxy' : n.label;
      btn.addEventListener('click', () => flyToNode(n));
      li.appendChild(btn);
      crumbList.appendChild(li);
    });
    const prev = document.querySelector('.nav-chevron[data-dir="prev"]');
    if (prev) prev.disabled = !nodeById.get(id)?.parentId && leafCard.hidden;
  }

  function updateBreadcrumbFromView() {
    if (flying || focusPinned) {
      renderBreadcrumb(focusNodeId);
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
    const taskBtn = document.getElementById('leaf-card-task');
    taskBtn.onclick = () => openTask(m, branchNode.branchKey === 'technical' ? 'technician' : 'operator');
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

  // ——— ambient particles (soft dust, not starfield) ———
  let pctx;
  let dust = [];
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
    dust = [];
    const n = Math.min(120, Math.floor((w * h) / 14000));
    for (let i = 0; i < n; i++) {
      dust.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.4,
        a: 0.08 + Math.random() * 0.18,
      });
    }
  }

  function drawDust() {
    if (!pctx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    pctx.clearRect(0, 0, w, h);
    for (const s of dust) {
      pctx.beginPath();
      pctx.fillStyle = `rgba(255,255,255,${s.a})`;
      pctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
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
      drawDust();
      if (!flying) applyLod();
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
        hubId: n?.hubId,
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
  drawDust();
  paintWorldOnce();
  transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  renderBreadcrumb(DATA.enterprise.id);
  requestAnimationFrame(function loop() {
    drawDust();
    requestAnimationFrame(loop);
  });
})();
