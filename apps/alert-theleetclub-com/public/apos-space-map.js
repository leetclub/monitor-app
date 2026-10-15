/**
 * APOS Space Map — continuous semantic-zoom constellation.
 * One persistent nested radial world; LOD by zoom k. Free pan/zoom; click = fly-to.
 */
(function () {
  'use strict';

  const DATA = window.APOS_SPACE_DATA;
  const BRANCHES = window.APOS_SPACE_BRANCHES;
  if (!DATA || !window.d3) {
    console.error('APOS Space Map: missing data or d3');
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THRESH = DATA.thresholds;
  const FLY_MS = reduceMotion ? 0 : 800;
  const FIT = 0.78;

  // World ring radii (parent → children)
  const RING = {
    country: 720,
    client: 260,
    area: 130,
    location: 85,
    machine: 52,
    branch: 34,
  };

  // Base visual radii
  const SIZE = {
    enterprise: 46,
    country: 16,
    client: 10,
    area: 7.5,
    location: 6.5,
    machine: 5.5,
    branch: 4.5,
  };

  // LOD: min zoom k at which depth is drawn / labeled
  const LOD = {
    enterprise: { draw: 0.05, label: 0.08, labelMax: 1.2 },
    country: { draw: 0.05, label: 0.12, labelMax: 2.2 },
    client: { draw: 0.18, label: 0.35, labelMax: 4 },
    area: { draw: 0.45, label: 0.9, labelMax: 7 },
    location: { draw: 1.1, label: 2.0, labelMax: 12 },
    machine: { draw: 2.2, label: 3.6, labelMax: 22 },
    branch: { draw: 4.6, label: 5.8, labelMax: 48 },
  };

  const DEPTH = {
    enterprise: 0,
    country: 1,
    client: 2,
    area: 3,
    location: 4,
    machine: 5,
    branch: 6,
  };

  const people = DATA.people;
  const nodes = [];
  const links = [];
  const nodeById = new Map();
  const machines = [];
  const childrenOf = new Map(); // parentId → child nodes

  // ——— build persistent nested radial world (once) ———
  function addNode(n) {
    n.x = 0;
    n.y = 0;
    n.r = SIZE[n.type] || 5;
    n.halo = n.r * 2.6;
    n.nebulaR = 0;
    n.draw = true;
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

  function placeChildren(parent, kids, ringR, startAngle) {
    const n = kids.length;
    if (!n) return;
    const sweep = Math.min(Math.PI * 1.85, Math.PI * 0.55 + n * 0.35);
    const base = startAngle != null ? startAngle : -Math.PI / 2;
    kids.forEach((child, i) => {
      const a = base + ((i + 0.5) / n - 0.5) * sweep;
      child.x = parent.x + Math.cos(a) * ringR;
      child.y = parent.y + Math.sin(a) * ringR;
      child.angle = a;
    });
  }

  function buildWorld() {
    nodes.length = 0;
    links.length = 0;
    nodeById.clear();
    machines.length = 0;
    childrenOf.clear();

    const core = {
      id: DATA.enterprise.id,
      type: 'enterprise',
      label: DATA.enterprise.label,
      name: DATA.enterprise.name,
      status: 'active',
      parentId: null,
      depth: 0,
    };
    addNode(core);
    core.x = 0;
    core.y = 0;
    core.r = SIZE.enterprise;
    core.halo = core.r * 2.8;

    const countries = DATA.countries;
    countries.forEach((country, ci) => {
      const a = -Math.PI / 2 + ((ci + 0.5) / countries.length - 0.5) * Math.PI * 1.5;
      const cNode = {
        id: country.id,
        type: 'country',
        label: country.label,
        status: country.status,
        opsManagerId: country.opsManagerId,
        parentId: core.id,
        depth: 1,
        code: country.code,
      };
      addNode(cNode);
      cNode.x = Math.cos(a) * RING.country;
      cNode.y = Math.sin(a) * RING.country;
      cNode.angle = a;
      cNode.r = country.status === 'future' ? 11 : SIZE.country;
      cNode.halo = cNode.r * 3.2;
      cNode.nebulaR = country.status === 'future' ? RING.client * 0.85 : RING.client * 1.35;
      cNode.nebulaTone = ci % 3 === 0 ? 'indigo' : ci % 3 === 1 ? 'teal' : 'violet';
      links.push({ source: core.id, target: country.id, kind: 'spine' });

      const clients = country.clients || [];
      clients.forEach((client) => {
        const cl = {
          id: client.id,
          type: 'client',
          label: client.label,
          brand: client.brand,
          status: client.status,
          parentId: country.id,
          countryId: country.id,
          depth: 2,
        };
        addNode(cl);
        links.push({ source: country.id, target: client.id, kind: 'constellation' });

        (client.areas || []).forEach((area) => {
          const ar = {
            id: area.id,
            type: 'area',
            label: area.label,
            areaManagerId: area.areaManagerId,
            parentId: client.id,
            countryId: country.id,
            clientId: client.id,
            depth: 3,
            status: 'active',
          };
          addNode(ar);
          links.push({ source: client.id, target: area.id, kind: 'constellation' });

          (area.locations || []).forEach((loc) => {
            const ln = {
              id: loc.id,
              type: 'location',
              label: loc.label,
              address: loc.address,
              lat: loc.lat,
              lng: loc.lng,
              parentId: area.id,
              countryId: country.id,
              clientId: client.id,
              areaId: area.id,
              depth: 4,
              status: 'active',
            };
            addNode(ln);
            links.push({ source: area.id, target: loc.id, kind: 'constellation' });

            (loc.machines || []).forEach((m) => {
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
                parentId: loc.id,
                countryId: country.id,
                clientId: client.id,
                areaId: area.id,
                locationId: loc.id,
                depth: 5,
              };
              mn.alert = computeAlert(mn);
              addNode(mn);
              machines.push(mn);
              links.push({ source: loc.id, target: m.id, kind: 'machine' });

              BRANCHES.forEach((b) => {
                const id = `${m.id}::${b.id}`;
                const bn = {
                  id,
                  type: 'branch',
                  branchKey: b.key,
                  branchId: b.id,
                  label: b.label,
                  machineId: m.id,
                  parentId: m.id,
                  depth: 6,
                  status: 'active',
                  machine: mn,
                };
                addNode(bn);
                links.push({ source: m.id, target: id, kind: 'branch' });
              });
            });
          });
        });
      });

      // place nested rings outward from each parent, facing away from core
      const outward = Math.atan2(cNode.y, cNode.x);
      const clientNodes = childrenOf.get(country.id) || [];
      placeChildren(cNode, clientNodes, RING.client, outward);
      clientNodes.forEach((cl) => {
        cl.r = cl.status === 'future' ? 6 : SIZE.client;
        cl.halo = cl.r * 2.6;
        const areas = childrenOf.get(cl.id) || [];
        placeChildren(cl, areas, RING.area, Math.atan2(cl.y - cNode.y, cl.x - cNode.x));
        areas.forEach((ar) => {
          ar.r = SIZE.area;
          ar.halo = ar.r * 2.5;
          const locs = childrenOf.get(ar.id) || [];
          placeChildren(ar, locs, RING.location, Math.atan2(ar.y - cl.y, ar.x - cl.x));
          locs.forEach((loc) => {
            loc.r = SIZE.location;
            loc.halo = loc.r * 2.5;
            const ms = childrenOf.get(loc.id) || [];
            placeChildren(loc, ms, RING.machine, Math.atan2(loc.y - ar.y, loc.x - ar.x));
            ms.forEach((m) => {
              m.r = SIZE.machine;
              m.halo = m.r * 3;
              const brs = childrenOf.get(m.id) || [];
              // full circle for the 5 branches
              brs.forEach((b, i) => {
                const ang = -Math.PI / 2 + (i / Math.max(brs.length, 1)) * Math.PI * 2;
                b.x = m.x + Math.cos(ang) * RING.branch;
                b.y = m.y + Math.sin(ang) * RING.branch;
                b.r = SIZE.branch;
                b.halo = b.r * 2.4;
              });
            });
          });
        });
      });
    });

    resolveLabelOffsets();
  }

  function resolveLabelOffsets() {
    nodes.forEach((n) => {
      n.labelOx = 0;
      n.labelOy = (n.halo || n.r * 2) * 0.55 + 14;
    });
  }

  // ——— DOM / camera ———
  const stage = document.getElementById('space-stage');
  const svg = d3.select('#space-svg');
  const starCanvas = document.getElementById('starfield');
  const signalCanvas = document.getElementById('signal-canvas');
  const crumbList = document.getElementById('crumb-list');
  const branchCard = document.getElementById('branch-card');
  const terminalOverlay = document.getElementById('terminal-overlay');

  let gRoot;
  let gNebulae;
  let gLinks;
  let gNodes;
  let zoomBehavior;
  let transform = d3.zoomIdentity;
  let flying = false;
  let hoverId = null;
  let rootPathIds = new Set();
  let focusNodeId = DATA.enterprise.id;
  /** Ancestors + focus: only these nodes may reveal their full child trees */
  let expandedPath = new Set([DATA.enterprise.id]);

  function initSvg() {
    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    const addRadial = (id, stops) => {
      const g = defs.append('radialGradient').attr('id', id);
      stops.forEach((s) =>
        g.append('stop').attr('offset', s[0]).attr('stop-color', s[1]).attr('stop-opacity', s[2])
      );
    };
    addRadial('nebula-indigo', [
      ['0%', '#5a6eb8', 0.42],
      ['45%', '#2a3a78', 0.18],
      ['100%', '#03050a', 0],
    ]);
    addRadial('nebula-teal', [
      ['0%', '#3a8a9a', 0.4],
      ['50%', '#1a4a58', 0.16],
      ['100%', '#03050a', 0],
    ]);
    addRadial('nebula-violet', [
      ['0%', '#6a5a9a', 0.36],
      ['50%', '#3a2a5a', 0.14],
      ['100%', '#03050a', 0],
    ]);
    addRadial('core-glow-grad', [
      ['0%', '#9fd9f0', 0.45],
      ['40%', '#4a8ab0', 0.18],
      ['100%', '#03050a', 0],
    ]);
    addRadial('core-mid-grad', [
      ['0%', '#e8f6ff', 0.85],
      ['55%', '#7ec8e8', 0.35],
      ['100%', '#1a4060', 0],
    ]);
    addRadial('core-body-grad', [
      ['0%', '#ffffff', 1],
      ['35%', '#d8f0ff', 0.95],
      ['70%', '#6ab0d0', 0.85],
      ['100%', '#1a5070', 0.9],
    ]);
    addRadial('star-halo-grad', [
      ['0%', '#c8e4f8', 0.55],
      ['50%', '#6a9ab8', 0.18],
      ['100%', '#03050a', 0],
    ]);
    addRadial('star-halo-ok', [
      ['0%', '#b8f0d0', 0.55],
      ['55%', '#4a9070', 0.16],
      ['100%', '#03050a', 0],
    ]);
    addRadial('star-halo-amber', [
      ['0%', '#f0d090', 0.55],
      ['55%', '#a07830', 0.18],
      ['100%', '#03050a', 0],
    ]);
    addRadial('star-halo-red', [
      ['0%', '#f0a0a0', 0.55],
      ['55%', '#903030', 0.2],
      ['100%', '#03050a', 0],
    ]);

    gRoot = svg.append('g').attr('class', 'viewport');
    gNebulae = gRoot.append('g').attr('class', 'nebulae');
    gLinks = gRoot.append('g').attr('class', 'links');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.08, 48])
      .filter((event) => {
        if (event.type === 'dblclick') return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        transform = event.transform;
        gRoot.attr('transform', transform);
        // User-driven wheel/drag unlocks free semantic zoom focus tracking
        if (event.sourceEvent) focusPinned = false;
        applyLod();
        applyLabelCounterScale();
        updateBreadcrumbFromView();
      });

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', (event) => {
      event.preventDefault();
      flyOut();
    });
  }

  function machineHaloUrl(d) {
    if (d.type !== 'machine') return 'url(#star-halo-grad)';
    if (d.status === 'offline' || d.alert === 'red') return 'url(#star-halo-red)';
    if (d.status === 'maintenance' || d.alert === 'amber') return 'url(#star-halo-amber)';
    return 'url(#star-halo-ok)';
  }

  function machineCoreFill(d) {
    if (d.type !== 'machine') return '#e8f2fa';
    if (d.status === 'offline' || d.alert === 'red') return '#f0b0b0';
    if (d.status === 'maintenance' || d.alert === 'amber') return '#f0d8a0';
    return '#d8f5e8';
  }

  function viewportCenterWorld() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    return transform.invert([W / 2, H / 2]);
  }

  function nodeScreenDistToCenter(n) {
    const [cx, cy] = [stage.clientWidth / 2, stage.clientHeight / 2];
    const sx = n.x * transform.k + transform.x;
    const sy = n.y * transform.k + transform.y;
    return Math.hypot(sx - cx, sy - cy);
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

  /**
   * LOD + expansion:
   * - Zoom gates how deep you're allowed to see.
   * - Only the expanded path (clicked node + ancestors) reveals full child trees.
   * - Siblings stay collapsed stars; nearby non-expanded parents may show a faint
   *   one-level preview (never a full deep tree).
   */
  function applyLod() {
    const k = transform.k;
    const [vcx, vcy] = viewportCenterWorld();
    const viewR = Math.hypot(stage.clientWidth, stage.clientHeight) / (2 * k);

    nodes.forEach((n) => {
      const lod = LOD[n.type] || LOD.location;
      const dist = Math.hypot(n.x - vcx, n.y - vcy);
      const kOk = k >= lod.draw;
      n.preview = false;

      // Shallow galaxy layer: always zoom-gated, never needs expansion
      if (n.depth <= 2) {
        n.draw = kOk || (n.depth <= 1 && k >= lod.draw * 0.5);
        if (n.status === 'future' && n.depth > 1) n.draw = kOk && k < 4;
        let a = 1;
        if (k < lod.draw * 1.3) a = Math.max(0.2, (k - lod.draw * 0.4) / (lod.draw * 0.9));
        n.lodAlpha = n.status === 'future' ? a * 0.4 : a;
        const labelOk = k >= lod.label && k <= lod.labelMax;
        const near = nodeScreenDistToCenter(n) < Math.min(stage.clientWidth, stage.clientHeight) * 0.45;
        n.labelOn = n.draw && labelOk && (near || n.depth <= 1 || (n.depth === 2 && k < 2.5));
        return;
      }

      const onPath = expandedPath.has(n.id);
      const parentOnPath = n.parentId && expandedPath.has(n.parentId);

      // Full reveal: node itself on path, or direct child of an expanded ancestor
      if (onPath || parentOnPath) {
        n.draw = kOk;
        let a = 1;
        if (k < lod.draw * 1.35) a = Math.max(0.2, (k - lod.draw * 0.45) / (lod.draw * 0.9));
        if (dist > viewR * 1.5) a *= 0.45;
        n.lodAlpha = a;
        const labelOk = k >= lod.label && k <= lod.labelMax;
        const near = nodeScreenDistToCenter(n) < Math.min(stage.clientWidth, stage.clientHeight) * 0.45;
        n.labelOn = n.draw && labelOk && (near || onPath);
        return;
      }

      // One-level faint preview under a visible non-expanded parent (never deep trees)
      const parent = n.parentId ? nodeById.get(n.parentId) : null;
      const parentIsShallowOrExpanded =
        parent && (parent.depth <= 2 || expandedPath.has(parent.parentId) || expandedPath.has(parent.id));
      // Preview only the immediate children of collapsed siblings that sit under an
      // expanded grandparent — and never for machines/branches (those need focus).
      const allowPreview =
        parent &&
        parent.depth >= 2 &&
        parent.depth <= 3 &&
        n.depth <= 4 &&
        n.type !== 'machine' &&
        n.type !== 'branch' &&
        (expandedPath.has(parent.parentId) || parent.depth === 2) &&
        k >= lod.draw * 1.15 &&
        dist < viewR * 1.1;

      if (allowPreview) {
        n.draw = true;
        n.preview = true;
        n.lodAlpha = 0.22;
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
  }

  function setHover(id) {
    hoverId = id;
    rootPathIds = id ? new Set(pathToRoot(id)) : new Set();
    paintLod();
  }

  function paintWorldOnce() {
    // nebulas
    const nebulaNodes = nodes.filter((n) => n.nebulaR > 0);
    gNebulae
      .selectAll('circle.nebula')
      .data(nebulaNodes, (d) => d.id)
      .join('circle')
      .attr('class', (d) => `nebula nebula-${d.nebulaTone || 'indigo'}`)
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.nebulaR);

    // links — all of them, LOD toggles opacity
    gLinks
      .selectAll('path.link')
      .data(links, (d) => `${d.source}->${d.target}`)
      .join('path')
      .attr('class', (d) => `link ${d.kind || ''}`)
      .attr('data-source', (d) => d.source)
      .attr('data-target', (d) => d.target)
      .attr('d', (d) => {
        const s = nodeById.get(d.source);
        const t = nodeById.get(d.target);
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        return `M${s.x},${s.y}Q${mx - dy * 0.08},${my + dx * 0.08} ${t.x},${t.y}`;
      });

    const nodeSel = gNodes
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
          .on('mouseenter', (event, d) => setHover(d.id))
          .on('mouseleave', () => setHover(null));

        g.each(function (d) {
          const el = d3.select(this);
          if (d.type === 'enterprise') {
            el.append('circle').attr('class', 'core-outer-glow').attr('r', d.r * 2.6);
            el.append('circle').attr('class', 'core-mid-glow').attr('r', d.r * 1.45);
            el.append('circle').attr('class', 'core-body').attr('r', d.r);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              el.append('circle')
                .attr('class', 'core-spark')
                .attr('r', 1.2)
                .attr('fill', '#e8f6ff')
                .attr('opacity', 0.7)
                .attr('cx', Math.cos(a) * d.r * 1.15)
                .attr('cy', Math.sin(a) * d.r * 1.15);
            }
            el.append('text').attr('class', 'core-wordmark').text('APOS');
            el.append('circle').attr('class', 'hit-target').attr('r', d.r + 14);
          } else {
            el.append('circle')
              .attr('class', 'star-halo')
              .attr('r', d.halo)
              .attr('fill', machineHaloUrl(d));
            el.append('circle')
              .attr('class', 'star-core')
              .attr('r', Math.max(2, d.r * 0.45))
              .attr('fill', machineCoreFill(d));
            el.append('circle').attr('class', 'pulse-ring').attr('r', d.halo + 4);
            el.append('circle').attr('class', 'hit-target').attr('r', Math.max(d.halo * 0.55, d.r + 10));
            const lab = el.append('g').attr('class', 'label-layer');
            lab
              .append('text')
              .attr('class', 'node-label')
              .attr('x', d.labelOx || 0)
              .attr('y', d.labelOy || 18)
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
    const k = transform.k;

    gNodes.selectAll('g.node').each(function (d) {
      const g = d3.select(this);
      const show = d.draw;
      const alpha = show ? d.lodAlpha : 0;
      const hovered = hoverId === d.id;
      const onPath = rootPathIds.has(d.id);
      g.style('display', show || d.depth <= 1 ? null : alpha < 0.05 ? 'none' : null);
      g.style('opacity', show ? (hovered ? 1 : onPath ? Math.max(alpha, 0.85) : alpha) : 0);
      g.classed('is-hover', hovered);
      g.classed('on-path', onPath && !hovered);

      const label = g.select('text.node-label');
      if (!label.empty()) {
        let cls = 'node-label';
        if (d.depth <= 1) cls += ' primary';
        else if (d.depth <= 3) cls += ' primary';
        else cls += ' small';
        if (d.status === 'future') cls += ' dim';
        if (d.depth >= 3 && k < (LOD[d.type]?.label || 1) * 1.3) cls += ' context';
        label.attr('class', cls).style('opacity', d.labelOn ? 1 : 0).style('display', d.labelOn ? null : 'none');
      }

      if (d.type === 'machine') {
        g.select('.pulse-ring')
          .attr('stroke', d.alert === 'red' ? '#d66a6a' : d.alert === 'amber' ? '#d4a84b' : 'none')
          .attr('opacity', d.alert && !reduceMotion ? 0.5 : 0);
      }
    });

    gLinks.selectAll('path.link').each(function (d) {
      const s = nodeById.get(d.source);
      const t = nodeById.get(d.target);
      const show = s?.draw && t?.draw;
      const onPath = rootPathIds.has(d.source) && rootPathIds.has(d.target);
      const el = d3.select(this);
      el.style('display', show ? null : 'none');
      el.classed('on-path', onPath);
      el.style('opacity', show ? (onPath ? 0.75 : Math.min(s.lodAlpha, t.lodAlpha) * 0.9) : 0);
    });

    gNebulae.selectAll('circle.nebula').style('opacity', (d) => {
      if (!d.draw && d.depth > 1) return 0;
      const fade = Math.max(0.2, Math.min(1, 1.2 / Math.max(transform.k, 0.3)));
      return (d.lodAlpha || 1) * fade * 0.85;
    });
  }

  // ——— framing / fly-to ———
  function subtreeExtent(node) {
    // Machines frame their 5 branches; shallower nodes frame 1–2 child levels.
    const depth = node.type === 'machine' ? 1 : node.type === 'location' ? 1 : 2;
    const kids = collectDescendants(node, depth);
    const pts = [node, ...kids];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((n) => {
      const pad = (n.nebulaR ? n.nebulaR * 0.22 : 0) + (n.halo || n.r) + 18;
      minX = Math.min(minX, n.x - pad);
      maxX = Math.max(maxX, n.x + pad);
      minY = Math.min(minY, n.y - pad);
      maxY = Math.max(maxY, n.y + pad + 22);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

  function fullExtent() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes
      .filter((n) => n.depth <= 2)
      .forEach((n) => {
        const pad = (n.nebulaR || n.halo || 20) + 40;
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
    const k = Math.max(0.1, Math.min(40, Math.min(kx, ky)));
    // Keep the clicked node centered; scale so its subtree fits ~FIT of the view.
    const cx = centerNode ? centerNode.x : bbox.x + bbox.w / 2;
    const cy = centerNode ? centerNode.y : bbox.y + bbox.h / 2;
    return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
  }

  let focusPinned = false;

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
    closeBranchCard();
    applyLod(); // collapse previous sibling trees before camera moves
    const bbox = subtreeExtent(node);
    flyToTransform(fitTransform(bbox, node));
  }

  function flyToGalaxy() {
    setExpandedTo(DATA.enterprise.id);
    focusPinned = true;
    closeBranchCard();
    closeTerminal();
    applyLod();
    flyToTransform(fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id)));
  }

  function flyOut() {
    if (!branchCard.hidden) {
      closeBranchCard();
      return;
    }
    if (!terminalOverlay.hidden) {
      closeTerminal();
      return;
    }
    const cur = nodeById.get(focusNodeId) || nodeById.get(nearestCenterNodeId());
    if (!cur || !cur.parentId) {
      flyToGalaxy();
      return;
    }
    const parent = nodeById.get(cur.parentId);
    flyToNode(parent);
  }

  function nearestCenterNodeId() {
    const k = transform.k;
    let best = null;
    let bestScore = Infinity;
    nodes.forEach((n) => {
      if (!n.draw) return;
      if (n.type === 'branch') return; // breadcrumbs track structural nodes
      const lod = LOD[n.type];
      if (k < lod.draw) return;
      const d = nodeScreenDistToCenter(n);
      // prefer deeper nodes when zoomed in, but keep the nearest overall
      const score = d - n.depth * 28;
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
    const prevBtn = document.querySelector('.nav-chevron[data-dir="prev"]');
    if (prevBtn) {
      const n = nodeById.get(id);
      prevBtn.disabled = !n?.parentId && branchCard.hidden;
    }
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
    if (d.status === 'future' && d.depth > 1) return;
    if (d.type === 'branch') {
      setExpandedTo(d.machineId);
      focusPinned = true;
      applyLod();
      showBranchCard(d);
      renderBreadcrumb(d.machineId);
      return;
    }
    if (d.type === 'machine' && transform.k >= LOD.branch.draw * 0.85) {
      // already deep — open terminal on second intent via branch; first click still flies
    }
    flyToNode(d);
  }

  // ——— branch card / terminal ———
  function showBranchCard(branchNode) {
    const m = branchNode.machine || nodeById.get(branchNode.machineId);
    document.getElementById('branch-card-title').textContent = `${m.label} · ${branchNode.label}`;
    const body = document.getElementById('branch-card-body');
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
    const taskBtn = document.getElementById('branch-card-task');
    const canTask = branchNode.branchKey === 'operators' || branchNode.branchKey === 'technical';
    taskBtn.hidden = !canTask;
    taskBtn.onclick = () => {
      openTerminalForMachine(m, branchNode.branchKey === 'technical' ? 'technician' : 'operator');
    };
    branchCard.hidden = false;
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
        ['Log', (m.operators?.log || []).join(' · ') || '—'],
      ];
    }
    if (key === 'technical') {
      const p = people[m.technicianId];
      return [
        ['Technician', p?.name || '—'],
        ['Open tickets', String(m.technical?.openTickets ?? 0)],
        ['Last maintenance', m.technical?.lastMaintenance || '—'],
        ['History', (m.technical?.history || []).join(' · ') || '—'],
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

  function closeBranchCard() {
    branchCard.hidden = true;
  }

  let terminalContext = { person: null, machine: null };

  function openTerminalForMachine(machine, role) {
    const personId = role === 'technician' ? machine.technicianId : machine.operatorId;
    const person = people[personId];
    terminalContext = { person, machine, role };
    document.getElementById('term-assignee').textContent = person?.name || 'unassigned';
    document.getElementById('term-task').value = '';
    document.getElementById('term-log').textContent = '';
    terminalOverlay.hidden = false;
    document.getElementById('term-task').focus();
  }

  function closeTerminal() {
    terminalOverlay.hidden = true;
  }

  async function sendTask() {
    const text = document.getElementById('term-task').value.trim();
    const log = document.getElementById('term-log');
    if (!text) {
      log.textContent = '> empty task — write a plain-language instruction';
      return;
    }
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeId: terminalContext.person?.id,
          assigneeName: terminalContext.person?.name,
          machineId: terminalContext.machine?.id,
          role: terminalContext.role,
          task: text,
        }),
      });
    } catch {
      /* mock */
    }
    log.textContent = `> task dispatched to ${(terminalContext.person?.name || 'assignee')}'s mobile inbox`;
  }

  // ——— starfield + signals ———
  const pulses = [];
  let signalCtx;
  let starCtx;
  let stars = [];
  let lastTs = 0;

  function resizeCanvases() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [starCanvas, signalCanvas].forEach((c) => {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    signalCtx = signalCanvas.getContext('2d');
    starCtx = starCanvas.getContext('2d');
    seedStars(w, h);
  }

  function seedStars(w, h) {
    stars = [];
    const dens = Math.floor((w * h) / 2800);
    const push = (count, layer, rMin, rMax, aMin, aMax) => {
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: rMin + Math.random() * (rMax - rMin),
          a: aMin + Math.random() * (aMax - aMin),
          layer,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.4 + Math.random() * 1.2,
        });
      }
    };
    push(Math.min(420, Math.floor(dens * 0.55)), 0.15, 0.25, 0.7, 0.12, 0.35);
    push(Math.min(280, Math.floor(dens * 0.32)), 0.4, 0.4, 1.1, 0.22, 0.55);
    push(Math.min(140, Math.floor(dens * 0.18)), 0.85, 0.6, 1.6, 0.35, 0.75);
  }

  function drawStarfield(ts) {
    if (!starCtx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    starCtx.clearRect(0, 0, w, h);
    const px = -transform.x * 0.04;
    const py = -transform.y * 0.04;
    const t = (ts || performance.now()) / 1000;
    for (const s of stars) {
      let x = ((s.x + px * s.layer) % w + w) % w;
      let y = ((s.y + py * s.layer) % h + h) % h;
      const twinkle = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(t * s.twSpeed + s.tw);
      const alpha = s.a * twinkle;
      starCtx.beginPath();
      starCtx.fillStyle = `rgba(210, 225, 245, ${alpha})`;
      starCtx.arc(x, y, s.r, 0, Math.PI * 2);
      starCtx.fill();
    }
  }

  function worldToScreen(x, y) {
    return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
  }

  function spawnPulse(fromId, toId, color, bright) {
    const a = nodeById.get(fromId);
    const b = nodeById.get(toId);
    if (!a?.draw || !b?.draw) return;
    pulses.push({
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      t: 0,
      speed: bright ? 0.014 : 0.0055,
      color,
      bright: !!bright,
    });
  }

  function spawnAmbientCurrents() {
    const drawable = links.filter((l) => nodeById.get(l.source)?.draw && nodeById.get(l.target)?.draw);
    if (!drawable.length) return;
    const n = transform.k < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const pick = drawable[Math.floor(Math.random() * drawable.length)];
      spawnPulse(pick.source, pick.target, 'rgba(210, 230, 250, 0.85)', false);
    }
  }

  function spawnEventPulse(kind, machineId) {
    const m = nodeById.get(machineId);
    if (!m) return;
    if (kind === 'transaction' || kind === 'restock') {
      const branchId = `${machineId}::${kind === 'restock' ? 'stock' : 'revenue'}`;
      if (nodeById.get(branchId)?.draw) spawnPulse(machineId, branchId, 'rgba(230, 245, 255, 0.98)', true);
      else if (m.draw) spawnPulse(m.parentId, machineId, 'rgba(220, 240, 255, 0.95)', true);
      else spawnAmbientCurrents();
    } else if (kind === 'alert') {
      const branchId = `${machineId}::technical`;
      if (nodeById.get(branchId)?.draw) spawnPulse(machineId, branchId, 'rgba(230, 110, 90, 0.98)', true);
      else if (m.draw) spawnPulse(m.parentId, machineId, 'rgba(220, 150, 80, 0.95)', true);
      else spawnAmbientCurrents();
    }
  }

  function tickSignals(dt) {
    if (!signalCtx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    signalCtx.clearRect(0, 0, w, h);
    if (reduceMotion) return;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed * (dt / 16);
      if (p.t >= 1) {
        pulses.splice(i, 1);
        continue;
      }
      const x = p.x0 + (p.x1 - p.x0) * p.t;
      const y = p.y0 + (p.y1 - p.y0) * p.t;
      const s = worldToScreen(x, y);
      const r = p.bright ? 3.2 : 2;
      signalCtx.beginPath();
      signalCtx.fillStyle = p.color;
      signalCtx.shadowColor = p.color;
      signalCtx.shadowBlur = p.bright ? 12 : 6;
      signalCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
      signalCtx.fill();
      signalCtx.shadowBlur = 0;
    }
  }

  function loop(ts) {
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    drawStarfield(ts);
    tickSignals(dt);
    requestAnimationFrame(loop);
  }

  function startEventTimers() {
    if (reduceMotion) return;
    setInterval(spawnAmbientCurrents, 1100);
    setInterval(() => {
      if (!machines.length) return;
      const m = machines[Math.floor(Math.random() * machines.length)];
      const kind = ['transaction', 'restock', 'alert'][Math.floor(Math.random() * 3)];
      if (kind === 'alert' && !m.alert && m.status === 'active') spawnEventPulse('transaction', m.id);
      else spawnEventPulse(kind, m.id);
    }, 3200);
  }

  async function pollRedFlags() {
    try {
      const res = await fetch('/api/alert/red-flags/snapshot', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.items || data?.flags || [];
      items.forEach((item) => {
        const mid = item.machineId || item.machine_id || item.id;
        if (mid && nodeById.has(mid)) spawnEventPulse('alert', mid);
      });
    } catch {
      /* silent */
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
        const action = btn.dataset.action;
        if (action === 'zoom-in') svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.3);
        else if (action === 'zoom-out') svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.75);
        else if (action === 'reset') flyToGalaxy();
      });
    });

    document.querySelector('.nav-chevron[data-dir="prev"]').addEventListener('click', flyOut);
    document.querySelector('.nav-chevron[data-dir="next"]').addEventListener('click', () => {
      const cur = nodeById.get(focusNodeId);
      const kids = (childrenOf.get(focusNodeId) || []).filter((c) => c.status !== 'future');
      if (kids[0]) flyToNode(kids[0]);
      else if (cur) flyToNode(cur);
    });

    document.getElementById('branch-card-close').addEventListener('click', closeBranchCard);
    document.getElementById('terminal-close').addEventListener('click', closeTerminal);
    terminalOverlay.addEventListener('click', (e) => {
      if (e.target === terminalOverlay) closeTerminal();
    });
    document.getElementById('term-send').addEventListener('click', sendTask);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!terminalOverlay.hidden) {
          closeTerminal();
          return;
        }
        flyOut();
      }
    });

    window.addEventListener('resize', () => {
      resizeCanvases();
      if (!flying) {
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

  function visibleDrawnTypes() {
    const types = {};
    nodes.forEach((n) => {
      if (n.draw && n.lodAlpha > 0.1) types[n.type] = (types[n.type] || 0) + 1;
    });
    return types;
  }

  function isNodeDrawn(id) {
    const n = nodeById.get(id);
    return !!(n && n.draw && n.lodAlpha > 0.05);
  }

  window.APOS_SPACE_MAP = {
    getFocus: () => {
      const n = nodeById.get(focusNodeId);
      return {
        id: focusNodeId,
        type: n?.type,
        level: n?.depth ?? 0,
        countryId: n?.countryId,
        clientId: n?.clientId,
        areaId: n?.areaId,
        locationId: n?.locationId,
        machineId: n?.type === 'machine' ? n.id : n?.machineId,
      };
    },
    getFocusStack: () => pathToRoot(focusNodeId).reverse().map((id) => {
      const n = nodeById.get(id);
      return { id, type: n.type, level: n.depth };
    }),
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
      if (!n) return null;
      return worldToScreen(n.x, n.y);
    },
    isNodeDrawn,
    visibleDrawnTypes,
    getExpandedPath: () => [...expandedPath],
    isExpanded: (id) => expandedPath.has(id),
    openTerminal: (machineId, role) => {
      const m = nodeById.get(machineId);
      if (m) openTerminalForMachine(m, role || 'operator');
    },
    closeTerminal,
    closeBranchCard,
    isTerminalOpen: () => !terminalOverlay.hidden,
    isBranchCardOpen: () => !branchCard.hidden,
    pulseCount: () => pulses.length,
    machineCount: () => machines.length,
    spawnTestPulse: () => {
      const drawable = links.filter((l) => nodeById.get(l.source)?.draw && nodeById.get(l.target)?.draw);
      if (drawable[0]) spawnPulse(drawable[0].source, drawable[0].target, 'rgba(220,240,255,0.95)', true);
    },
    LEVEL: {
      GALAXY: 0,
      COUNTRY: 1,
      CLIENT: 2,
      AREA: 3,
      LOCATION: 4,
      MACHINE: 5,
    },
    LOD,
  };

  // ——— boot ———
  buildWorld();
  initSvg();
  wireUi();
  resizeCanvases();
  paintWorldOnce();
  transform = fitTransform(fullExtent(), nodeById.get(DATA.enterprise.id));
  svg.call(zoomBehavior.transform, transform);
  applyLod();
  applyLabelCounterScale();
  renderBreadcrumb(DATA.enterprise.id);
  startEventTimers();
  pollRedFlags();
  setInterval(pollRedFlags, 30000);
  requestAnimationFrame(loop);
})();
