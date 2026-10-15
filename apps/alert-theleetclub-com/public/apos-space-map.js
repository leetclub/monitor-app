/**
 * APOS Space Map — deep-space ops constellation.
 * Camera: animated d3 zoom framing. Nodes: expand from parent. Labels: anchored + counter-scale.
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
  const CAM_MS = reduceMotion ? 0 : 820;
  const CAM_EASE = d3.easeCubicInOut;
  const FIT = 0.82; // target content span as fraction of viewport

  const LEVEL = {
    GALAXY: 0,
    COUNTRY: 1,
    CLIENT: 2,
    AREA: 3,
    LOCATION: 4,
    MACHINE: 5,
  };

  /** @type {{level:number, countryId?:string, clientId?:string, areaId?:string, locationId?:string, machineId?:string, branchId?:string}[]} */
  let focusStack = [{ level: LEVEL.GALAXY }];
  const currentFocus = () => focusStack[focusStack.length - 1];

  const people = DATA.people;
  const nodes = [];
  const links = [];
  const nodeById = new Map();
  const machines = [];

  const SIZE = {
    enterprise: 48,
    country: 18,
    client: 12,
    area: 9,
    location: 8,
    machine: 7.5,
    branch: 8,
  };

  // ——— graph ———
  function buildGraph() {
    nodes.length = 0;
    links.length = 0;
    nodeById.clear();
    machines.length = 0;

    addNode({
      id: DATA.enterprise.id,
      type: 'enterprise',
      label: DATA.enterprise.label,
      name: DATA.enterprise.name,
      status: 'active',
      parentId: null,
      depth: 0,
    });

    DATA.countries.forEach((country, ci) => {
      const angle = -Math.PI / 2 + (ci / DATA.countries.length) * Math.PI * 2;
      addNode({
        id: country.id,
        type: 'country',
        label: country.label,
        status: country.status,
        opsManagerId: country.opsManagerId,
        parentId: DATA.enterprise.id,
        depth: 1,
        homeAngle: angle,
        code: country.code,
      });
      links.push({ source: DATA.enterprise.id, target: country.id, kind: 'spine' });

      (country.clients || []).forEach((client, kli) => {
        addNode({
          id: client.id,
          type: 'client',
          label: client.label,
          brand: client.brand,
          status: client.status,
          parentId: country.id,
          countryId: country.id,
          depth: 2,
        });
        links.push({ source: country.id, target: client.id, kind: 'constellation' });

        (client.areas || []).forEach((area) => {
          addNode({
            id: area.id,
            type: 'area',
            label: area.label,
            areaManagerId: area.areaManagerId,
            parentId: client.id,
            countryId: country.id,
            clientId: client.id,
            depth: 3,
            status: 'active',
          });
          links.push({ source: client.id, target: area.id, kind: 'constellation' });

          (area.locations || []).forEach((loc) => {
            addNode({
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
              machineIds: (loc.machines || []).map((m) => m.id),
            });
            links.push({ source: area.id, target: loc.id, kind: 'constellation' });

            (loc.machines || []).forEach((m) => {
              const mNode = {
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
              mNode.alert = computeAlert(mNode);
              addNode(mNode);
              machines.push(mNode);
              links.push({ source: loc.id, target: m.id, kind: 'machine' });
            });
          });
        });
      });
    });
  }

  function addNode(n) {
    n.x = 0;
    n.y = 0;
    n.tx = 0;
    n.ty = 0;
    n.opacity = 1;
    n.visible = false;
    nodes.push(n);
    nodeById.set(n.id, n);
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

  // ——— world layout (origin at focus center; camera frames it) ———
  const WORLD_R = 420;

  function layoutTargets(focus) {
    nodes.forEach((n) => {
      n.wasVisible = n.visible;
      n.visible = false;
      n.labelVisible = false;
      n.labelMode = 'primary';
      n.context = false;
      n.nebulaR = 0;
      n.nebulaTone = 'indigo';
      n.labelOx = 0;
      n.labelOy = 0;
      n.r = SIZE[n.type] || 6;
      n.halo = n.r * 2.6;
    });

    const core = nodeById.get(DATA.enterprise.id);
    core.visible = true;
    core.tx = 0;
    core.ty = 0;
    core.r = focus.level === LEVEL.GALAXY ? SIZE.enterprise : 22;
    core.halo = core.r * 2.8;
    core.labelVisible = false;

    if (focus.level === LEVEL.GALAXY) {
      const active = DATA.countries.filter((c) => c.status === 'active');
      const future = DATA.countries.filter((c) => c.status !== 'active');
      const placed = [...active, ...future];
      placed.forEach((c, i) => {
        const n = nodeById.get(c.id);
        const count = placed.length;
        const a = -Math.PI / 2 + ((i + 0.5) / count - 0.5) * Math.PI * 1.35;
        const r = c.status === 'future' ? WORLD_R * 0.95 : WORLD_R * 0.78;
        n.visible = true;
        n.labelVisible = true;
        n.labelMode = c.status === 'future' ? 'dim' : 'primary';
        n.tx = Math.cos(a) * r;
        n.ty = Math.sin(a) * r;
        n.r = c.status === 'future' ? 12 : SIZE.country;
        n.halo = n.r * 3.2;
        n.nebulaR = c.status === 'future' ? WORLD_R * 0.3 : WORLD_R * 0.5;
        n.nebulaTone = i % 3 === 0 ? 'indigo' : i % 3 === 1 ? 'teal' : 'violet';

        if (c.status === 'active') {
          const clients = nodes.filter((x) => x.type === 'client' && x.countryId === c.id);
          clients.forEach((cl, ki) => {
            const ca = a + ((ki + 0.5) / Math.max(clients.length, 1) - 0.5) * 0.95;
            const cr = n.nebulaR * (0.4 + (ki % 3) * 0.08);
            cl.visible = true;
            cl.context = true;
            cl.labelVisible = true;
            cl.labelMode = 'context';
            cl.tx = n.tx + Math.cos(ca) * cr;
            cl.ty = n.ty + Math.sin(ca) * cr;
            cl.r = SIZE.client * 0.75;
            cl.halo = cl.r * 2.2;

            const areas = nodes.filter((x) => x.type === 'area' && x.clientId === cl.id);
            areas.forEach((ar, ai) => {
              const aa = ca + ((ai + 0.5) / Math.max(areas.length, 1) - 0.5) * 0.55;
              ar.visible = true;
              ar.context = true;
              ar.labelVisible = ai === 0;
              ar.labelMode = 'context';
              ar.tx = n.tx + Math.cos(aa) * n.nebulaR * 0.78;
              ar.ty = n.ty + Math.sin(aa) * n.nebulaR * 0.78;
              ar.r = SIZE.area * 0.7;
              ar.halo = ar.r * 2;
            });
          });
        }
      });
      resolveLabelOffsets();
      return;
    }

    if (focus.level === LEVEL.COUNTRY) {
      const country = nodeById.get(focus.countryId);
      country.visible = true;
      country.labelVisible = true;
      country.labelMode = 'primary';
      country.tx = 0;
      country.ty = -WORLD_R * 0.06;
      country.r = SIZE.country + 5;
      country.halo = country.r * 3.4;
      country.nebulaR = WORLD_R * 0.75;
      country.nebulaTone = 'indigo';

      core.tx = 0;
      core.ty = WORLD_R * 0.78;
      core.r = 20;
      core.halo = 50;

      const clients = nodes.filter((n) => n.type === 'client' && n.countryId === focus.countryId);
      clients.forEach((n, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) / Math.max(clients.length, 1) - 0.5) * Math.PI * 1.55;
        const r = WORLD_R * 0.55;
        n.visible = true;
        n.labelVisible = true;
        n.labelMode = n.status === 'future' ? 'dim' : 'primary';
        n.tx = Math.cos(a) * r;
        n.ty = country.ty + Math.sin(a) * r;
        n.r = n.status === 'future' ? 7 : SIZE.client + 2;
        n.halo = n.r * 2.8;

        const areas = nodes.filter((x) => x.type === 'area' && x.clientId === n.id);
        areas.forEach((ar, ai) => {
          const aa = a + ((ai + 0.5) / Math.max(areas.length, 1) - 0.5) * 0.7;
          ar.visible = true;
          ar.context = true;
          ar.labelVisible = true;
          ar.labelMode = 'context';
          ar.tx = n.tx + Math.cos(aa) * (WORLD_R * 0.22);
          ar.ty = n.ty + Math.sin(aa) * (WORLD_R * 0.22);
          ar.r = SIZE.area;
          ar.halo = ar.r * 2.2;
        });
      });
      resolveLabelOffsets();
      return;
    }

    if (focus.level === LEVEL.CLIENT) {
      placeRadialFocus(nodeById.get(focus.clientId), nodes.filter((n) => n.type === 'area' && n.clientId === focus.clientId), SIZE.area + 3);
      return;
    }
    if (focus.level === LEVEL.AREA) {
      placeRadialFocus(nodeById.get(focus.areaId), nodes.filter((n) => n.type === 'location' && n.areaId === focus.areaId), SIZE.location + 3);
      return;
    }
    if (focus.level === LEVEL.LOCATION) {
      const loc = nodeById.get(focus.locationId);
      loc.visible = true;
      loc.labelVisible = true;
      loc.labelMode = 'primary';
      loc.tx = 0;
      loc.ty = -WORLD_R * 0.1;
      loc.r = SIZE.location + 4;
      loc.halo = loc.r * 3;
      const ms = nodes.filter((n) => n.type === 'machine' && n.locationId === focus.locationId);
      ms.forEach((n, i) => {
        const a = (i / Math.max(ms.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = Math.max(WORLD_R * 0.4, WORLD_R * 0.28 + ms.length * 10);
        n.visible = true;
        n.labelVisible = true;
        n.labelMode = 'primary';
        n.tx = Math.cos(a) * r;
        n.ty = Math.sin(a) * r * 0.92;
        n.r = SIZE.machine + 3;
        n.halo = n.r * 3.2;
      });
      resolveLabelOffsets();
      return;
    }

    if (focus.level === LEVEL.MACHINE) {
      const m = nodeById.get(focus.machineId);
      m.visible = true;
      m.labelVisible = true;
      m.labelMode = 'primary';
      m.tx = 0;
      m.ty = 0;
      m.r = SIZE.machine + 6;
      m.halo = m.r * 3.4;

      BRANCHES.forEach((b, i) => {
        const id = `${m.id}::${b.id}`;
        let bn = nodeById.get(id);
        if (!bn) {
          bn = {
            id,
            type: 'branch',
            branchKey: b.key,
            branchId: b.id,
            label: b.label,
            machineId: m.id,
            parentId: m.id,
            depth: 6,
            status: 'active',
            x: 0,
            y: 0,
            tx: 0,
            ty: 0,
          };
          addNode(bn);
          links.push({ source: m.id, target: id, kind: 'branch' });
        }
        const a = (i / BRANCHES.length) * Math.PI * 2 - Math.PI / 2;
        const r = WORLD_R * 0.52;
        bn.visible = true;
        bn.labelVisible = true;
        bn.labelMode = 'primary';
        bn.tx = Math.cos(a) * r;
        bn.ty = Math.sin(a) * r;
        bn.r = SIZE.branch + 2;
        bn.halo = bn.r * 2.6;
        bn.machine = m;
      });
      resolveLabelOffsets();
    }
  }

  function placeRadialFocus(center, children, childR) {
    center.visible = true;
    center.labelVisible = true;
    center.labelMode = 'primary';
    center.tx = 0;
    center.ty = 0;
    center.r = (SIZE[center.type] || 10) + 4;
    center.halo = center.r * 3;
    children.forEach((n, i) => {
      const a = (i / Math.max(children.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = WORLD_R * 0.58;
      n.visible = true;
      n.labelVisible = true;
      n.labelMode = 'primary';
      n.tx = Math.cos(a) * r;
      n.ty = Math.sin(a) * r;
      n.r = childR;
      n.halo = n.r * 2.8;
    });
    resolveLabelOffsets();
  }

  /** Simple vertical collision offset for labels under nodes */
  function resolveLabelOffsets() {
    const labeled = nodes.filter((n) => n.visible && n.labelVisible && n.type !== 'enterprise');
    labeled.forEach((n) => {
      n.labelOx = 0;
      n.labelOy = (n.halo || n.r * 2) * 0.55 + 16;
    });
    // push apart labels that share similar x and close y
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < labeled.length; i++) {
        for (let j = i + 1; j < labeled.length; j++) {
          const a = labeled[i];
          const b = labeled[j];
          const ax = a.tx + a.labelOx;
          const ay = a.ty + a.labelOy;
          const bx = b.tx + b.labelOx;
          const by = b.ty + b.labelOy;
          const dx = bx - ax;
          const dy = by - ay;
          if (Math.abs(dx) < 90 && Math.abs(dy) < 22) {
            const push = (22 - Math.abs(dy)) / 2 + 2;
            if (ay <= by) {
              a.labelOy -= push / 2;
              b.labelOy += push / 2;
            } else {
              a.labelOy += push / 2;
              b.labelOy -= push / 2;
            }
            // slight horizontal nudge if still tight
            if (Math.abs(dx) < 40) {
              a.labelOx -= 6;
              b.labelOx += 6;
            }
          }
        }
      }
    }
  }

  // ——— DOM ———
  const stage = document.getElementById('space-stage');
  const svgEl = document.getElementById('space-svg');
  const svg = d3.select(svgEl);
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
  let animating = false;

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

    const linkGrad = defs
      .append('linearGradient')
      .attr('id', 'link-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');
    linkGrad.append('stop').attr('offset', '0%').attr('stop-color', '#9ec8e0').attr('stop-opacity', 0.2);
    linkGrad.append('stop').attr('offset', '50%').attr('stop-color', '#d0e8f8').attr('stop-opacity', 0.55);
    linkGrad.append('stop').attr('offset', '100%').attr('stop-color', '#9ec8e0').attr('stop-opacity', 0.2);

    gRoot = svg.append('g').attr('class', 'viewport');
    gNebulae = gRoot.append('g').attr('class', 'nebulae');
    gLinks = gRoot.append('g').attr('class', 'links');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.25, 5])
      .filter((event) => {
        // allow wheel + drag; ignore dblclick (we handle back)
        if (event.type === 'dblclick') return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        transform = event.transform;
        gRoot.attr('transform', transform);
        applyLabelCounterScale();
      })
      .on('start', (event) => {
        if (event.sourceEvent) stage.classList.add('is-panning');
      })
      .on('end', () => stage.classList.remove('is-panning'));

    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);
    svg.on('dblclick', (event) => {
      event.preventDefault();
      goBack();
    });
  }

  function visibleLinks() {
    return links.filter((l) => {
      const s = nodeById.get(typeof l.source === 'string' ? l.source : l.source.id);
      const t = nodeById.get(typeof l.target === 'string' ? l.target : l.target.id);
      return s?.visible && t?.visible;
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

  function nodeClass(d) {
    let cls = `node node-${d.type}`;
    if (d.status === 'future') cls += ' future';
    if (d.context) cls += ' context';
    return cls;
  }

  function contentBBox() {
    const primary = nodes.filter((n) => n.visible && !n.context);
    const pts = primary.length ? primary : nodes.filter((n) => n.visible);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((n) => {
      // Frame stars + labels; only a fraction of nebula so zoom fills the viewport
      const nebPad = n.nebulaR ? n.nebulaR * 0.28 : 0;
      const pad = Math.max(n.halo || n.r * 2.5, nebPad) + (n.labelVisible ? 24 : 10);
      const labelExtra = n.labelVisible ? Math.min(n.labelOy || 20, 36) : 0;
      minX = Math.min(minX, n.tx - pad + (n.labelOx || 0));
      maxX = Math.max(maxX, n.tx + pad + (n.labelOx || 0));
      minY = Math.min(minY, n.ty - pad);
      maxY = Math.max(maxY, n.ty + pad + labelExtra);
    });
    if (!isFinite(minX)) return { x: -200, y: -200, w: 400, h: 400 };
    return { x: minX, y: minY, w: Math.max(maxX - minX, 80), h: Math.max(maxY - minY, 80) };
  }

  function fitTransformForBBox(bbox) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const kx = (W * FIT) / Math.max(bbox.w, 1);
    const ky = (H * FIT) / Math.max(bbox.h, 1);
    const k = Math.max(0.3, Math.min(3.2, Math.min(kx, ky)));
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
  }

  /** Seed positions: new nodes emerge from originParent; survivors keep place */
  function seedMotion(originWorld) {
    const ox = originWorld?.x ?? 0;
    const oy = originWorld?.y ?? 0;
    nodes.forEach((n) => {
      if (!n.visible) {
        n.opacity = 0;
        return;
      }
      if (!n.wasVisible) {
        n.x = ox;
        n.y = oy;
        n.opacity = 0;
        n._emerging = true;
      } else {
        n._emerging = false;
        n.opacity = n.context ? 0.55 : 1;
      }
    });
  }

  function applyLabelCounterScale() {
    const k = transform.k || 1;
    const inv = 1 / k;
    gNodes.selectAll('g.label-layer').attr('transform', `scale(${inv})`);
    gNodes.selectAll('text.core-wordmark').attr('transform', `scale(${inv})`);
  }

  function paintFrame(t) {
    // t in [0,1] during transitions — interpolate x,y,opacity
    const vLinks = visibleLinks();
    const linkSel = gLinks.selectAll('path.link').data(vLinks, (d) => {
      const s = typeof d.source === 'string' ? d.source : d.source.id;
      const tid = typeof d.target === 'string' ? d.target : d.target.id;
      return `${s}->${tid}`;
    });
    linkSel.exit().remove();
    linkSel
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('opacity', 0)
      .merge(linkSel)
      .attr('class', (d) => {
        const s = nodeById.get(typeof d.source === 'string' ? d.source : d.source.id);
        const tgt = nodeById.get(typeof d.target === 'string' ? d.target : d.target.id);
        const ctx = s?.context || tgt?.context ? ' context' : '';
        return `link ${d.kind || ''}${ctx}`;
      })
      .attr('d', (d) => {
        const s = nodeById.get(typeof d.source === 'string' ? d.source : d.source.id);
        const tgt = nodeById.get(typeof d.target === 'string' ? d.target : d.target.id);
        const mx = (s.x + tgt.x) / 2;
        const my = (s.y + tgt.y) / 2;
        const dx = tgt.x - s.x;
        const dy = tgt.y - s.y;
        return `M${s.x},${s.y}Q${mx - dy * 0.08},${my + dx * 0.08} ${tgt.x},${tgt.y}`;
      })
      .attr('opacity', (d) => {
        const s = nodeById.get(typeof d.source === 'string' ? d.source : d.source.id);
        const tgt = nodeById.get(typeof d.target === 'string' ? d.target : d.target.id);
        return Math.min(s.opacity ?? 1, tgt.opacity ?? 1) * (s.context || tgt.context ? 0.7 : 1);
      });

    const nebulaNodes = nodes.filter((n) => n.visible && n.nebulaR > 0);
    const nebSel = gNebulae.selectAll('circle.nebula').data(nebulaNodes, (d) => d.id);
    nebSel.exit().remove();
    nebSel
      .enter()
      .append('circle')
      .attr('class', 'nebula')
      .attr('opacity', 0)
      .merge(nebSel)
      .attr('class', (d) => `nebula nebula-${d.nebulaTone || 'indigo'}`)
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.nebulaR)
      .attr('opacity', (d) => (d.opacity ?? 1) * 0.9);

    const vNodes = nodes.filter((n) => n.visible).sort((a, b) => Number(!!b.context) - Number(!!a.context) || a.depth - b.depth);
    const nodeSel = gNodes.selectAll('g.node').data(vNodes, (d) => d.id);
    nodeSel.exit().remove();

    const enter = nodeSel
      .enter()
      .append('g')
      .attr('class', (d) => nodeClass(d))
      .attr('data-id', (d) => d.id)
      .attr('data-type', (d) => d.type)
      .attr('opacity', 0)
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeClick(d);
      });

    enter.each(function (d) {
      const g = d3.select(this);
      if (d.type === 'enterprise') {
        g.append('circle').attr('class', 'core-outer-glow');
        g.append('circle').attr('class', 'core-mid-glow');
        g.append('circle').attr('class', 'core-body');
        for (let i = 0; i < 8; i++) {
          g.append('circle')
            .attr('class', 'core-spark')
            .attr('r', 1.2)
            .attr('fill', '#e8f6ff')
            .attr('opacity', 0.7)
            .attr('data-i', i);
        }
        g.append('text').attr('class', 'core-wordmark').text('APOS');
        g.append('circle').attr('class', 'hit-target');
      } else {
        g.append('circle').attr('class', 'star-halo');
        g.append('circle').attr('class', 'star-core');
        g.append('circle').attr('class', 'pulse-ring');
        g.append('circle').attr('class', 'hit-target');
        const lab = g.append('g').attr('class', 'label-layer');
        lab.append('text').attr('class', 'node-label');
      }
    });

    const merged = enter.merge(nodeSel);
    merged
      .attr('class', (d) => nodeClass(d))
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('opacity', (d) => d.opacity ?? 1);

    merged.select('.core-outer-glow').attr('r', (d) => (d.type === 'enterprise' ? d.r * 2.6 : 0));
    merged.select('.core-mid-glow').attr('r', (d) => (d.type === 'enterprise' ? d.r * 1.45 : 0));
    merged.select('.core-body').attr('r', (d) => (d.type === 'enterprise' ? d.r : 0));
    merged.select('.core-wordmark').attr('font-size', (d) => (d.r > 30 ? 15 : 11));
    merged.selectAll('.core-spark').attr('transform', function () {
      const i = +this.getAttribute('data-i');
      const parent = d3.select(this.parentNode).datum();
      const rr = (parent?.r || 40) * 1.15;
      const a = (i / 8) * Math.PI * 2;
      return `translate(${Math.cos(a) * rr},${Math.sin(a) * rr})`;
    });

    merged
      .select('.star-halo')
      .attr('r', (d) => d.halo || d.r * 2.4)
      .attr('fill', (d) => machineHaloUrl(d))
      .attr('opacity', (d) => (d.context ? 0.45 : 0.85));

    merged
      .select('.star-core')
      .attr('r', (d) => Math.max(2.2, d.r * 0.45))
      .attr('fill', (d) => machineCoreFill(d));

    merged.select('.hit-target').attr('r', (d) => Math.max((d.halo || d.r) * 0.55, d.r + 12));
    merged.select('.pulse-ring').attr('r', (d) => (d.halo || d.r) + 4);

    // labels: offset in screen pixels via counter-scaled layer
    merged.select('g.label-layer').attr('transform', () => {
      const inv = 1 / (transform.k || 1);
      return `scale(${inv})`;
    });

    merged
      .select('text.node-label')
      .attr('class', (d) => {
        let cls = 'node-label';
        if (d.labelMode === 'primary') cls += ' primary';
        if (d.labelMode === 'context') cls += ' context';
        if (d.labelMode === 'dim' || d.status === 'future') cls += ' dim';
        if (d.type === 'machine' || d.type === 'branch') cls += ' small';
        return cls;
      })
      .attr('x', (d) => d.labelOx || 0)
      .attr('y', (d) => d.labelOy || 20)
      .attr('dy', '0.35em')
      .style('display', (d) => (d.labelVisible ? null : 'none'))
      .text((d) => d.label);

    // wordmark also counter-scaled
    merged.select('text.core-wordmark').attr('transform', () => `scale(${1 / (transform.k || 1)})`);

    if (!reduceMotion) {
      merged.select('.pulse-ring').each(function (d) {
        if (d.type !== 'machine' || !d.alert) {
          d3.select(this).attr('opacity', 0);
          return;
        }
        d3.select(this)
          .attr('stroke', d.alert === 'red' ? '#d66a6a' : '#d4a84b')
          .attr('opacity', 0.55);
      });
    }
  }

  function interpolateNodes(alpha) {
    nodes.forEach((n) => {
      if (!n.visible) return;
      const targetOp = n.context ? 0.55 : 1;
      if (n._emerging) {
        // stagger by angle-ish using id hash
        const stagger = (hashId(n.id) % 8) * 0.04;
        const local = Math.max(0, Math.min(1, (alpha - stagger) / (1 - stagger)));
        const e = CAM_EASE(local);
        n.x = n.x0 + (n.tx - n.x0) * e;
        n.y = n.y0 + (n.ty - n.y0) * e;
        n.opacity = e * targetOp;
      } else {
        n.x = n.x0 + (n.tx - n.x0) * alpha;
        n.y = n.y0 + (n.ty - n.y0) * alpha;
        n.opacity = n.op0 + (targetOp - n.op0) * alpha;
      }
    });
  }

  function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function captureOriginWorld(clickedNode) {
    if (clickedNode) return { x: clickedNode.x, y: clickedNode.y };
    return { x: 0, y: 0 };
  }

  /**
   * Transition to a new focus: layout targets, seed expand-from-parent, animate camera + nodes.
   */
  function transitionToFocus(opts = {}) {
    const { originNode = null, instant = false } = opts;
    const origin = captureOriginWorld(originNode);

    layoutTargets(currentFocus());
    updateBreadcrumb();

    // remember start poses
    nodes.forEach((n) => {
      if (!n.visible) return;
      if (!n.wasVisible) {
        n.x0 = origin.x;
        n.y0 = origin.y;
        n.op0 = 0;
        n.x = origin.x;
        n.y = origin.y;
        n.opacity = 0;
        n._emerging = true;
      } else {
        n.x0 = n.x;
        n.y0 = n.y;
        n.op0 = n.opacity ?? 1;
        n._emerging = false;
      }
    });

    const bbox = contentBBox();
    const targetTransform = fitTransformForBBox(bbox);
    const duration = instant || reduceMotion ? 0 : CAM_MS;

    animating = true;
    const startT = transform;

    const finish = () => {
      nodes.forEach((n) => {
        if (!n.visible) return;
        n.x = n.tx;
        n.y = n.ty;
        n.opacity = n.context ? 0.55 : 1;
        n._emerging = false;
      });
      transform = targetTransform;
      // sync d3-zoom internal state without emitting an extra animated transition
      svg.call(zoomBehavior.transform, transform);
      paintFrame(1);
      applyLabelCounterScale();
      animating = false;
    };

    if (duration === 0) {
      finish();
      return;
    }

    const zt = d3.interpolate(
      { k: startT.k, x: startT.x, y: startT.y },
      { k: targetTransform.k, x: targetTransform.x, y: targetTransform.y }
    );

    svg
      .transition('camera')
      .duration(duration)
      .ease(CAM_EASE)
      .tween('frame', () => (t) => {
        const v = zt(t);
        transform = d3.zoomIdentity.translate(v.x, v.y).scale(v.k);
        gRoot.attr('transform', transform);
        interpolateNodes(t);
        paintFrame(t);
        applyLabelCounterScale();
      })
      .on('end interrupt', finish);
  }

  function renderInstant() {
    layoutTargets(currentFocus());
    nodes.forEach((n) => {
      if (!n.visible) return;
      n.x = n.tx;
      n.y = n.ty;
      n.opacity = n.context ? 0.55 : 1;
      n.wasVisible = true;
    });
    updateBreadcrumb();
    const targetTransform = fitTransformForBBox(contentBBox());
    transform = targetTransform;
    svg.call(zoomBehavior.transform, transform);
    paintFrame(1);
    applyLabelCounterScale();
  }

  // ——— navigation ———
  function pushFocus(next, originNode) {
    focusStack.push(next);
    closeBranchCard();
    transitionToFocus({ originNode });
  }

  function goBack() {
    if (branchCard && !branchCard.hidden) {
      closeBranchCard();
      const f = currentFocus();
      if (f.branchId) {
        const { branchId, ...rest } = f;
        focusStack[focusStack.length - 1] = rest;
        updateBreadcrumb();
      }
      return;
    }
    if (focusStack.length > 1) {
      const leaving = currentFocus();
      const origin = nodeById.get(
        leaving.machineId || leaving.locationId || leaving.areaId || leaving.clientId || leaving.countryId
      );
      focusStack.pop();
      transitionToFocus({ originNode: origin || null });
    }
  }

  function goToIndex(idx) {
    if (idx < 0 || idx >= focusStack.length) return;
    focusStack = focusStack.slice(0, idx + 1);
    closeBranchCard();
    transitionToFocus({});
  }

  function onNodeClick(d) {
    if (animating) return;
    if (d.status === 'future') return;
    const f = currentFocus();

    if (f.level === LEVEL.GALAXY) {
      if (d.type === 'country') {
        pushFocus({ level: LEVEL.COUNTRY, countryId: d.id }, d);
        return;
      }
      if ((d.type === 'client' || d.type === 'area') && d.countryId) {
        pushFocus({ level: LEVEL.COUNTRY, countryId: d.countryId }, d);
        return;
      }
    }
    if (d.type === 'client' && f.level === LEVEL.COUNTRY) {
      pushFocus({ level: LEVEL.CLIENT, countryId: d.countryId, clientId: d.id }, d);
      return;
    }
    if (d.type === 'area' && f.level === LEVEL.CLIENT) {
      pushFocus({ level: LEVEL.AREA, countryId: d.countryId, clientId: d.clientId, areaId: d.id }, d);
      return;
    }
    if (d.type === 'area' && f.level === LEVEL.COUNTRY && d.clientId) {
      pushFocus({ level: LEVEL.CLIENT, countryId: d.countryId, clientId: d.clientId }, d);
      return;
    }
    if (d.type === 'location' && f.level === LEVEL.AREA) {
      pushFocus(
        {
          level: LEVEL.LOCATION,
          countryId: d.countryId,
          clientId: d.clientId,
          areaId: d.areaId,
          locationId: d.id,
        },
        d
      );
      return;
    }
    if (d.type === 'machine' && f.level === LEVEL.LOCATION) {
      pushFocus(
        {
          level: LEVEL.MACHINE,
          countryId: d.countryId,
          clientId: d.clientId,
          areaId: d.areaId,
          locationId: d.locationId,
          machineId: d.id,
        },
        d
      );
      return;
    }
    if (d.type === 'machine' && f.level === LEVEL.MACHINE && d.id === f.machineId) {
      openTerminalForMachine(d, 'operator');
      return;
    }
    if (d.type === 'branch') {
      focusStack[focusStack.length - 1] = { ...f, branchId: d.branchId };
      showBranchCard(d);
      updateBreadcrumb();
      return;
    }
  }

  function updateBreadcrumb() {
    const clean = [{ label: 'Galaxy', index: 0 }];
    for (let i = 1; i < focusStack.length; i++) {
      const f = focusStack[i];
      let label = '';
      if (f.level === LEVEL.COUNTRY) label = nodeById.get(f.countryId)?.label;
      else if (f.level === LEVEL.CLIENT) label = nodeById.get(f.clientId)?.label;
      else if (f.level === LEVEL.AREA) label = nodeById.get(f.areaId)?.label;
      else if (f.level === LEVEL.LOCATION) label = nodeById.get(f.locationId)?.label;
      else if (f.level === LEVEL.MACHINE) {
        label = nodeById.get(f.machineId)?.label;
        if (label) clean.push({ label, index: i });
        if (f.branchId) {
          const b = BRANCHES.find((x) => x.id === f.branchId);
          clean.push({ label: b?.label || f.branchId, index: i });
        }
        continue;
      }
      if (label) clean.push({ label, index: i });
    }

    crumbList.replaceChildren();
    clean.forEach((c) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c.label;
      btn.addEventListener('click', () => goToIndex(c.index));
      li.appendChild(btn);
      crumbList.appendChild(li);
    });

    const prevBtn = document.querySelector('.nav-chevron[data-dir="prev"]');
    if (prevBtn) prevBtn.disabled = focusStack.length <= 1 && branchCard.hidden;
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
    const payload = {
      assigneeId: terminalContext.person?.id,
      assigneeName: terminalContext.person?.name,
      machineId: terminalContext.machine?.id,
      role: terminalContext.role,
      task: text,
    };
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      /* mock success */
    }
    const name = terminalContext.person?.name || 'assignee';
    log.textContent = `> task dispatched to ${name}'s mobile inbox`;
  }

  // ——— canvas starfield + signals ———
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
    const pushLayer = (count, layer, rMin, rMax, aMin, aMax) => {
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
    pushLayer(Math.min(420, Math.floor(dens * 0.55)), 0.15, 0.25, 0.7, 0.12, 0.35);
    pushLayer(Math.min(280, Math.floor(dens * 0.32)), 0.4, 0.4, 1.1, 0.22, 0.55);
    pushLayer(Math.min(140, Math.floor(dens * 0.18)), 0.85, 0.6, 1.6, 0.35, 0.75);
  }

  function drawStarfield(ts) {
    if (!starCtx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    starCtx.clearRect(0, 0, w, h);
    const px = -transform.x * 0.045;
    const py = -transform.y * 0.045;
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
      if (s.r > 1.1) {
        starCtx.beginPath();
        starCtx.fillStyle = `rgba(180, 210, 240, ${alpha * 0.25})`;
        starCtx.arc(x, y, s.r * 2.2, 0, Math.PI * 2);
        starCtx.fill();
      }
    }
  }

  function worldToScreen(x, y) {
    return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
  }

  function spawnPulse(fromId, toId, color, bright) {
    const a = nodeById.get(fromId);
    const b = nodeById.get(toId);
    if (!a?.visible || !b?.visible) return;
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
    const focus = currentFocus();
    const vLinks = visibleLinks().filter((l) => l.kind !== 'branch' || focus.level === LEVEL.MACHINE);
    if (!vLinks.length) return;
    const n = focus.level === LEVEL.GALAXY ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const pick = vLinks[Math.floor(Math.random() * vLinks.length)];
      const s = typeof pick.source === 'string' ? pick.source : pick.source.id;
      const t = typeof pick.target === 'string' ? pick.target : pick.target.id;
      spawnPulse(s, t, 'rgba(210, 230, 250, 0.85)', false);
    }
  }

  function spawnEventPulse(kind, machineId) {
    const m = nodeById.get(machineId);
    if (!m) return;
    const focus = currentFocus();
    const bubble = (color) => {
      if (m.visible) {
        spawnPulse(m.parentId, machineId, color, true);
        return;
      }
      let cur = m;
      while (cur?.parentId) {
        const parent = nodeById.get(cur.parentId);
        if (parent?.visible && parent.parentId && nodeById.get(parent.parentId)?.visible) {
          spawnPulse(parent.parentId, parent.id, color, true);
          return;
        }
        cur = parent;
      }
      spawnAmbientCurrents();
    };
    if (kind === 'transaction' || kind === 'restock') {
      const branchId = `${machineId}::${kind === 'restock' ? 'stock' : 'revenue'}`;
      if (focus.level === LEVEL.MACHINE && focus.machineId === machineId) {
        spawnPulse(machineId, branchId, 'rgba(230, 245, 255, 0.98)', true);
      } else bubble('rgba(220, 240, 255, 0.95)');
    } else if (kind === 'alert') {
      const branchId = `${machineId}::technical`;
      if (focus.level === LEVEL.MACHINE && focus.machineId === machineId) {
        spawnPulse(machineId, branchId, 'rgba(230, 110, 90, 0.98)', true);
      } else bubble('rgba(220, 150, 80, 0.95)');
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
      const r = p.bright ? 3.2 : 2.0;
      signalCtx.beginPath();
      signalCtx.fillStyle = p.color;
      signalCtx.shadowColor = p.color;
      signalCtx.shadowBlur = p.bright ? 12 : 6;
      signalCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
      signalCtx.fill();
      const tx = p.x0 + (p.x1 - p.x0) * Math.max(0, p.t - 0.08);
      const ty = p.y0 + (p.y1 - p.y0) * Math.max(0, p.t - 0.08);
      const ts = worldToScreen(tx, ty);
      signalCtx.beginPath();
      signalCtx.shadowBlur = 0;
      signalCtx.fillStyle = p.color.replace(/[\d.]+\)$/, '0.35)');
      signalCtx.arc(ts.x, ts.y, r * 0.55, 0, Math.PI * 2);
      signalCtx.fill();
    }
    if (currentFocus().level >= LEVEL.LOCATION) {
      machines.forEach((m) => {
        if (!m.visible || !m.alert) return;
        const phase = (performance.now() / 900) % 1;
        const s = worldToScreen(m.x, m.y);
        signalCtx.beginPath();
        signalCtx.strokeStyle =
          m.alert === 'red'
            ? `rgba(214,106,106,${0.5 * (1 - phase)})`
            : `rgba(212,168,75,${0.45 * (1 - phase)})`;
        signalCtx.lineWidth = 1.25;
        signalCtx.arc(s.x, s.y, ((m.halo || m.r) + phase * 16) * transform.k, 0, Math.PI * 2);
        signalCtx.stroke();
      });
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
    setInterval(() => spawnAmbientCurrents(), 1100);
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
        if (action === 'zoom-in') {
          svg.transition().duration(220).call(zoomBehavior.scaleBy, 1.25);
        } else if (action === 'zoom-out') {
          svg.transition().duration(220).call(zoomBehavior.scaleBy, 0.8);
        } else if (action === 'reset') {
          focusStack = [{ level: LEVEL.GALAXY }];
          closeBranchCard();
          closeTerminal();
          transitionToFocus({});
        }
      });
    });

    document.querySelector('.nav-chevron[data-dir="prev"]').addEventListener('click', goBack);
    document.querySelector('.nav-chevron[data-dir="next"]').addEventListener('click', () => {
      if (animating) return;
      const f = currentFocus();
      if (f.level === LEVEL.GALAXY) {
        const kw = DATA.countries.find((c) => c.status === 'active');
        if (kw) pushFocus({ level: LEVEL.COUNTRY, countryId: kw.id }, nodeById.get(kw.id));
      } else if (f.level === LEVEL.COUNTRY) {
        const clients = nodes.filter((n) => n.type === 'client' && n.countryId === f.countryId && n.status === 'active');
        if (clients[0]) pushFocus({ level: LEVEL.CLIENT, countryId: f.countryId, clientId: clients[0].id }, clients[0]);
      } else if (f.level === LEVEL.CLIENT) {
        const areas = nodes.filter((n) => n.type === 'area' && n.clientId === f.clientId);
        if (areas[0])
          pushFocus({ level: LEVEL.AREA, countryId: f.countryId, clientId: f.clientId, areaId: areas[0].id }, areas[0]);
      } else if (f.level === LEVEL.AREA) {
        const locs = nodes.filter((n) => n.type === 'location' && n.areaId === f.areaId);
        if (locs[0])
          pushFocus(
            {
              level: LEVEL.LOCATION,
              countryId: f.countryId,
              clientId: f.clientId,
              areaId: f.areaId,
              locationId: locs[0].id,
            },
            locs[0]
          );
      } else if (f.level === LEVEL.LOCATION) {
        const ms = nodes.filter((n) => n.type === 'machine' && n.locationId === f.locationId);
        if (ms[0])
          pushFocus(
            {
              level: LEVEL.MACHINE,
              countryId: f.countryId,
              clientId: f.clientId,
              areaId: f.areaId,
              locationId: f.locationId,
              machineId: ms[0].id,
            },
            ms[0]
          );
      }
    });

    document.getElementById('branch-card-close').addEventListener('click', () => {
      closeBranchCard();
      const f = currentFocus();
      if (f.branchId) {
        const { branchId, ...rest } = f;
        focusStack[focusStack.length - 1] = rest;
        updateBreadcrumb();
      }
    });
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
        goBack();
      }
    });

    window.addEventListener('resize', () => {
      resizeCanvases();
      if (!animating) {
        const t = fitTransformForBBox(contentBBox());
        svg.transition().duration(reduceMotion ? 0 : 280).call(zoomBehavior.transform, t);
      }
    });
  }

  function waitForIdle() {
    return new Promise((resolve) => {
      const tick = () => {
        if (!animating) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function nodeScreenPos(id) {
    const n = nodeById.get(id);
    if (!n || !n.visible) return null;
    return worldToScreen(n.x, n.y);
  }

  window.APOS_SPACE_MAP = {
    getFocus: () => ({ ...currentFocus() }),
    getFocusStack: () => focusStack.map((f) => ({ ...f })),
    goBack,
    reset: () => {
      focusStack = [{ level: LEVEL.GALAXY }];
      closeBranchCard();
      closeTerminal();
      transitionToFocus({ instant: reduceMotion });
    },
    waitForIdle,
    nodeScreenPos,
    getTransform: () => ({ k: transform.k, x: transform.x, y: transform.y }),
    openTerminal: (machineId, role) => {
      const m = nodeById.get(machineId);
      if (m) openTerminalForMachine(m, role || 'operator');
    },
    closeTerminal,
    isTerminalOpen: () => !terminalOverlay.hidden,
    isBranchCardOpen: () => !branchCard.hidden,
    pulseCount: () => pulses.length,
    machineCount: () => machines.length,
    spawnTestPulse: () => {
      const v = visibleLinks();
      if (v.length) {
        const pick = v[0];
        const s = typeof pick.source === 'string' ? pick.source : pick.source.id;
        const t = typeof pick.target === 'string' ? pick.target : pick.target.id;
        spawnPulse(s, t, 'rgba(220, 240, 255, 0.95)', true);
      } else if (machines[0]) spawnEventPulse('transaction', machines[0].id);
    },
    LEVEL,
  };

  buildGraph();
  initSvg();
  wireUi();
  resizeCanvases();
  renderInstant();
  startEventTimers();
  pollRedFlags();
  setInterval(pollRedFlags, 30000);
  requestAnimationFrame(loop);
})();
