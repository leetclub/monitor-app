/**
 * APOS Space Map — dark operations constellation (D3 + canvas signals).
 * Levels: galaxy → country → client → area → location → machine → branch card.
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
  let currentFocus = () => focusStack[focusStack.length - 1];

  const people = DATA.people;
  const nodes = [];
  const links = [];
  const nodeById = new Map();
  const machines = [];

  // ——— flatten hierarchy into layout nodes ———
  function buildGraph() {
    nodes.length = 0;
    links.length = 0;
    nodeById.clear();
    machines.length = 0;

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

    const countryCount = DATA.countries.length;
    DATA.countries.forEach((country, ci) => {
      const angle = -Math.PI / 2 + (ci / countryCount) * Math.PI * 2;
      const r = 280;
      const cNode = {
        id: country.id,
        type: 'country',
        label: country.label,
        status: country.status,
        opsManagerId: country.opsManagerId,
        parentId: core.id,
        depth: 1,
        homeAngle: angle,
        homeR: r,
        code: country.code,
      };
      addNode(cNode);
      links.push({ source: core.id, target: country.id, kind: 'spine' });

      (country.clients || []).forEach((client, kli) => {
        const clientAngle = angle + (kli - ((country.clients.length - 1) / 2)) * 0.35;
        const clNode = {
          id: client.id,
          type: 'client',
          label: client.label,
          brand: client.brand,
          status: client.status,
          parentId: country.id,
          countryId: country.id,
          depth: 2,
          homeAngle: clientAngle,
          homeR: r + 160,
        };
        addNode(clNode);
        links.push({ source: country.id, target: client.id, kind: 'constellation' });

        (client.areas || []).forEach((area, ai) => {
          const areaAngle = clientAngle + (ai - ((client.areas.length - 1) / 2)) * 0.28;
          const aNode = {
            id: area.id,
            type: 'area',
            label: area.label,
            areaManagerId: area.areaManagerId,
            parentId: client.id,
            countryId: country.id,
            clientId: client.id,
            depth: 3,
            homeAngle: areaAngle,
            homeR: r + 280,
            status: 'active',
          };
          addNode(aNode);
          links.push({ source: client.id, target: area.id, kind: 'constellation' });

          (area.locations || []).forEach((loc, li) => {
            const locAngle = areaAngle + (li - ((area.locations.length - 1) / 2)) * 0.18;
            const lNode = {
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
              homeAngle: locAngle,
              homeR: r + 400,
              status: 'active',
              machineIds: (loc.machines || []).map((m) => m.id),
            };
            addNode(lNode);
            links.push({ source: area.id, target: loc.id, kind: 'constellation' });

            (loc.machines || []).forEach((m, mi) => {
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
                homeAngle: locAngle + (mi - ((loc.machines.length - 1) / 2)) * 0.08,
                homeR: r + 480,
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

  // ——— layout positions based on focus ———
  function layoutPositions(focus) {
    const W = stage.clientWidth || 1200;
    const H = stage.clientHeight || 800;
    const cx = W / 2;
    const cy = H / 2 - 20;

    nodes.forEach((n) => {
      n.visible = false;
      n.labelVisible = false;
      n.x = cx;
      n.y = cy;
      n.r = 4;
    });

    const core = nodeById.get(DATA.enterprise.id);
    core.visible = true;
    core.x = cx;
    core.y = cy;
    core.r = focus.level === LEVEL.GALAXY ? 36 : 18;
    core.labelVisible = focus.level <= LEVEL.COUNTRY;

    if (focus.level === LEVEL.GALAXY) {
      const active = DATA.countries.filter((c) => c.status === 'active');
      const future = DATA.countries.filter((c) => c.status !== 'active');
      // Keep Kuwait as the primary cluster; futures sit dimmed on the rim.
      const placed = [...active, ...future];
      placed.forEach((c, i) => {
        const n = nodeById.get(c.id);
        const count = placed.length;
        // Favor upper-mid arc so labels stay in frame with generous space.
        const a = -Math.PI / 2 + ((i + 0.5) / count - 0.5) * Math.PI * 1.15;
        const r = c.status === 'future' ? 240 : 210;
        n.visible = true;
        n.labelVisible = true;
        n.x = cx + Math.cos(a) * r;
        n.y = cy + Math.sin(a) * r + 30;
        n.r = c.status === 'future' ? 18 : 30;
        n.nebulaR = c.status === 'future' ? 64 : 100;
      });
      return;
    }

    if (focus.level === LEVEL.COUNTRY) {
      const country = nodeById.get(focus.countryId);
      country.visible = true;
      country.labelVisible = true;
      country.x = cx;
      country.y = cy - 40;
      country.r = 28;
      core.y = cy + 200;
      core.x = cx;
      core.labelVisible = true;

      const clients = nodes.filter((n) => n.type === 'client' && n.countryId === focus.countryId);
      clients.forEach((n, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) / Math.max(clients.length, 1)) * Math.PI * 1.4 - 0.7;
        const r = 200;
        n.visible = true;
        n.labelVisible = true;
        n.x = cx + Math.cos(a) * r;
        n.y = cy - 40 + Math.sin(a) * r;
        n.r = n.status === 'future' ? 10 : 16;
      });
      return;
    }

    if (focus.level === LEVEL.CLIENT) {
      const client = nodeById.get(focus.clientId);
      client.visible = true;
      client.labelVisible = true;
      client.x = cx;
      client.y = cy - 60;
      client.r = 20;

      const areas = nodes.filter((n) => n.type === 'area' && n.clientId === focus.clientId);
      areas.forEach((n, i) => {
        const a = (i / Math.max(areas.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = 180;
        n.visible = true;
        n.labelVisible = true;
        n.x = cx + Math.cos(a) * r;
        n.y = cy - 60 + Math.sin(a) * r;
        n.r = 14;
      });
      return;
    }

    if (focus.level === LEVEL.AREA) {
      const area = nodeById.get(focus.areaId);
      area.visible = true;
      area.labelVisible = true;
      area.x = cx;
      area.y = cy - 80;
      area.r = 16;

      const locs = nodes.filter((n) => n.type === 'location' && n.areaId === focus.areaId);
      locs.forEach((n, i) => {
        const a = (i / Math.max(locs.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = 200;
        n.visible = true;
        n.labelVisible = true;
        n.x = cx + Math.cos(a) * r;
        n.y = cy - 80 + Math.sin(a) * r;
        n.r = 12;
      });
      return;
    }

    if (focus.level === LEVEL.LOCATION) {
      const loc = nodeById.get(focus.locationId);
      loc.visible = true;
      loc.labelVisible = true;
      loc.x = cx;
      loc.y = cy - 100;
      loc.r = 14;

      const ms = nodes.filter((n) => n.type === 'machine' && n.locationId === focus.locationId);
      ms.forEach((n, i) => {
        const a = (i / Math.max(ms.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = Math.max(90, 50 + ms.length * 28);
        n.visible = true;
        n.labelVisible = true;
        n.x = cx + Math.cos(a) * r;
        n.y = cy + 20 + Math.sin(a) * r;
        n.r = 18;
      });
      return;
    }

    if (focus.level === LEVEL.MACHINE) {
      const m = nodeById.get(focus.machineId);
      m.visible = true;
      m.labelVisible = true;
      m.x = cx;
      m.y = cy;
      m.r = 22;

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
          };
          addNode(bn);
          links.push({ source: m.id, target: id, kind: 'branch' });
        }
        const a = (i / BRANCHES.length) * Math.PI * 2 - Math.PI / 2;
        const r = 140;
        bn.visible = true;
        bn.labelVisible = true;
        bn.x = cx + Math.cos(a) * r;
        bn.y = cy + Math.sin(a) * r;
        bn.r = 14;
        bn.machine = m;
      });
    }
  }

  // ——— DOM / SVG ———
  const stage = document.getElementById('space-stage');
  const svgEl = document.getElementById('space-svg');
  const svg = d3.select(svgEl);
  const starCanvas = document.getElementById('starfield');
  const signalCanvas = document.getElementById('signal-canvas');
  const crumbList = document.getElementById('crumb-list');
  const branchCard = document.getElementById('branch-card');
  const terminalOverlay = document.getElementById('terminal-overlay');

  let gRoot;
  let gLinks;
  let gNodes;
  let zoomBehavior;
  let transform = d3.zoomIdentity;

  function initSvg() {
    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    const grad = defs.append('radialGradient').attr('id', 'nebula-grad');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#7eb8d4').attr('stop-opacity', 0.35);
    grad.append('stop').attr('offset', '55%').attr('stop-color', '#3a5a78').attr('stop-opacity', 0.12);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#05070c').attr('stop-opacity', 0);

    gRoot = svg.append('g').attr('class', 'viewport');
    gLinks = gRoot.append('g').attr('class', 'links');
    gNodes = gRoot.append('g').attr('class', 'nodes');

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.35, 4])
      .on('zoom', (event) => {
        transform = event.transform;
        gRoot.attr('transform', transform);
      })
      .on('start', () => stage.classList.add('is-panning'))
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

  function render() {
    const focus = currentFocus();
    layoutPositions(focus);
    updateBreadcrumb();

    const vLinks = visibleLinks();
    const linkSel = gLinks.selectAll('path.link').data(vLinks, (d) => {
      const s = typeof d.source === 'string' ? d.source : d.source.id;
      const t = typeof d.target === 'string' ? d.target : d.target.id;
      return `${s}->${t}`;
    });
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('path').attr('class', 'link');
    linkEnter
      .merge(linkSel)
      .attr('class', (d) => `link ${d.kind === 'spine' ? 'active-path' : ''}`)
      .attr('d', (d) => {
        const s = nodeById.get(typeof d.source === 'string' ? d.source : d.source.id);
        const t = nodeById.get(typeof d.target === 'string' ? d.target : d.target.id);
        return `M${s.x},${s.y}L${t.x},${t.y}`;
      });

    const vNodes = nodes.filter((n) => n.visible);
    const nodeSel = gNodes.selectAll('g.node').data(vNodes, (d) => d.id);
    nodeSel.exit().remove();

    const enter = nodeSel
      .enter()
      .append('g')
      .attr('class', (d) => `node node-${d.type}${d.status === 'future' ? ' future' : ''}`)
      .attr('data-id', (d) => d.id)
      .attr('data-type', (d) => d.type)
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeClick(d);
      });

    enter.each(function (d) {
      const g = d3.select(this);
      if (d.type === 'country') {
        g.append('circle').attr('class', 'nebula').attr('r', d.nebulaR || 100);
      }
      if (d.type === 'enterprise') {
        g.append('circle').attr('class', 'core-glow').attr('r', 48);
        g.append('circle').attr('class', 'core-ring').attr('r', 42);
        g.append('circle').attr('class', 'core-disk').attr('r', 28);
      } else if (d.type === 'machine') {
        g.append('circle').attr('class', 'pulse-ring').attr('r', 26);
        g.append('circle').attr('class', 'machine-disk').attr('r', d.r);
      } else if (d.type === 'branch') {
        g.append('circle').attr('class', 'branch-disk').attr('r', d.r);
      } else {
        g.append('circle')
          .attr('class', 'star-disk')
          .attr('r', d.r)
          .attr('fill', '#101824')
          .attr('stroke', 'rgba(180,200,230,0.3)')
          .attr('stroke-width', 1);
      }
      g.append('text').attr('class', 'node-label').attr('dy', (dd) => labelDy(dd));
    });

    const merged = enter.merge(nodeSel);
    merged
      .attr('class', (d) => `node node-${d.type}${d.status === 'future' ? ' future' : ''}`)
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    merged.select('.nebula').attr('r', (d) => d.nebulaR || 100);
    merged.select('.core-disk').attr('r', (d) => (d.type === 'enterprise' ? Math.max(14, d.r * 0.75) : 0));
    merged.select('.core-ring').attr('r', (d) => (d.type === 'enterprise' ? d.r + 6 : 0));
    merged.select('.core-glow').attr('r', (d) => (d.type === 'enterprise' ? d.r + 12 : 0));

    merged.select('.machine-disk').attr('r', (d) => d.r).attr('class', (d) => {
      let cls = 'machine-disk';
      if (d.status === 'offline') cls += ' offline';
      if (d.status === 'maintenance') cls += ' maintenance';
      if (d.alert === 'red') cls += ' alert-red';
      else if (d.alert === 'amber') cls += ' alert-amber';
      return cls;
    });

    merged.select('.pulse-ring').attr('r', (d) => d.r + 8);

    merged.select('.branch-disk').attr('r', (d) => d.r);
    merged.select('.star-disk').attr('r', (d) => d.r);

    merged
      .select('text.node-label')
      .attr('class', (d) => {
        let cls = 'node-label';
        if (d.type === 'machine' || d.type === 'branch') cls += ' small';
        if (d.status === 'future') cls += ' dim';
        return cls;
      })
      .attr('dy', (d) => labelDy(d))
      .style('display', (d) => (d.labelVisible ? null : 'none'))
      .text((d) => d.label);

    // alert pulse animation
    if (!reduceMotion) {
      merged.select('.pulse-ring').each(function (d) {
        if (!d.alert) {
          d3.select(this).attr('opacity', 0);
          return;
        }
        const ring = d3.select(this);
        ring
          .attr('stroke', d.alert === 'red' ? '#c45c5c' : '#c9a227')
          .attr('opacity', 0.6);
      });
    }

    drawSignalsStatic();
  }

  function labelDy(d) {
    if (d.type === 'enterprise') return d.r + 22;
    if (d.type === 'country') return (d.nebulaR || 80) * 0.15 + d.r + 18;
    return d.r + 16;
  }

  // ——— navigation ———
  function pushFocus(next) {
    focusStack.push(next);
    closeBranchCard();
    animateToFocus();
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
      focusStack.pop();
      animateToFocus();
    }
  }

  function goToIndex(idx) {
    if (idx < 0 || idx >= focusStack.length) return;
    focusStack = focusStack.slice(0, idx + 1);
    closeBranchCard();
    animateToFocus();
  }

  function onNodeClick(d) {
    if (d.status === 'future') return;
    const f = currentFocus();

    if (d.type === 'country' && f.level === LEVEL.GALAXY) {
      pushFocus({ level: LEVEL.COUNTRY, countryId: d.id });
      return;
    }
    if (d.type === 'client' && f.level === LEVEL.COUNTRY) {
      pushFocus({ level: LEVEL.CLIENT, countryId: d.countryId, clientId: d.id });
      return;
    }
    if (d.type === 'area' && f.level === LEVEL.CLIENT) {
      pushFocus({
        level: LEVEL.AREA,
        countryId: d.countryId,
        clientId: d.clientId,
        areaId: d.id,
      });
      return;
    }
    if (d.type === 'location' && f.level === LEVEL.AREA) {
      pushFocus({
        level: LEVEL.LOCATION,
        countryId: d.countryId,
        clientId: d.clientId,
        areaId: d.areaId,
        locationId: d.id,
      });
      return;
    }
    if (d.type === 'machine' && f.level === LEVEL.LOCATION) {
      pushFocus({
        level: LEVEL.MACHINE,
        countryId: d.countryId,
        clientId: d.clientId,
        areaId: d.areaId,
        locationId: d.locationId,
        machineId: d.id,
      });
      return;
    }
    if (d.type === 'machine' && f.level === LEVEL.MACHINE && d.id === f.machineId) {
      openTerminalForMachine(d, 'operator');
      return;
    }
    if (d.type === 'branch') {
      // Stay on the same machine level; annotate branch in-place (no duplicate crumb).
      focusStack[focusStack.length - 1] = { ...f, branchId: d.branchId };
      showBranchCard(d);
      updateBreadcrumb();
      return;
    }
  }

  function animateToFocus() {
    const t = reduceMotion ? 0 : 650;
    svg
      .transition()
      .duration(t)
      .ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, d3.zoomIdentity);
    transform = d3.zoomIdentity;
    render();
  }

  function updateBreadcrumb() {
    const crumbs = [{ label: 'APOS', index: 0 }];
    focusStack.forEach((f, i) => {
      if (i === 0) return;
      if (f.countryId) {
        const n = nodeById.get(f.countryId);
        if (f.level === LEVEL.COUNTRY) crumbs.push({ label: n.label, index: i });
      }
      if (f.clientId && f.level >= LEVEL.CLIENT) {
        const n = nodeById.get(f.clientId);
        if (f.level === LEVEL.CLIENT || (f.level > LEVEL.CLIENT && crumbs[crumbs.length - 1]?.label !== n.label)) {
          if (!crumbs.some((c) => c.label === n.label && c._id === n.id)) {
            crumbs.push({ label: n.label, index: i, _id: n.id });
          }
        }
      }
      if (f.areaId && f.level >= LEVEL.AREA) {
        const n = nodeById.get(f.areaId);
        if (f.level === LEVEL.AREA) crumbs.push({ label: n.label, index: i });
      }
      if (f.locationId && f.level >= LEVEL.LOCATION) {
        const n = nodeById.get(f.locationId);
        if (f.level === LEVEL.LOCATION) crumbs.push({ label: n.label, index: i });
      }
      if (f.machineId && f.level >= LEVEL.MACHINE) {
        const n = nodeById.get(f.machineId);
        if (f.level === LEVEL.MACHINE) crumbs.push({ label: n.label, index: i });
      }
      if (f.branchId) {
        const b = BRANCHES.find((x) => x.id === f.branchId);
        crumbs.push({ label: b?.label || f.branchId, index: i });
      }
    });

    // rebuild clean crumbs from stack
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

  // ——— branch card ———
  function showBranchCard(branchNode) {
    const m = branchNode.machine || nodeById.get(branchNode.machineId);
    const title = document.getElementById('branch-card-title');
    const body = document.getElementById('branch-card-body');
    const taskBtn = document.getElementById('branch-card-task');
    title.textContent = `${m.label} · ${branchNode.label}`;
    body.replaceChildren();

    const rows = branchRows(branchNode.branchKey, m);
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

  // ——— terminal ———
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
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // stub: treat network failure as mock success
      if (!res.ok && res.status !== 404) {
        /* still mock success for demos */
      }
    } catch {
      /* mock success */
    }
    const name = terminalContext.person?.name || 'assignee';
    log.textContent = `> task dispatched to ${name}'s mobile inbox`;
  }

  // ——— signals (canvas) ———
  /** @type {{x0:number,y0:number,x1:number,y1:number,t:number,speed:number,color:string,life:number,bright:boolean}[]} */
  const pulses = [];
  let signalCtx;
  let starCtx;
  let stars = [];
  let rafId = 0;
  let lastTs = 0;

  function resizeCanvases() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    [starCanvas, signalCanvas].forEach((c) => {
      c.width = w;
      c.height = h;
    });
    signalCtx = signalCanvas.getContext('2d');
    starCtx = starCanvas.getContext('2d');
    seedStars(w, h);
    drawStarfield();
  }

  function seedStars(w, h) {
    stars = [];
    const n = Math.min(220, Math.floor((w * h) / 9000));
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.45 + 0.1,
      });
    }
  }

  function drawStarfield() {
    if (!starCtx) return;
    const w = starCanvas.width;
    const h = starCanvas.height;
    starCtx.clearRect(0, 0, w, h);
    for (const s of stars) {
      starCtx.beginPath();
      starCtx.fillStyle = `rgba(200, 215, 235, ${s.a})`;
      starCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      starCtx.fill();
    }
  }

  function worldToScreen(x, y) {
    return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
  }

  function spawnPulse(fromId, toId, color, bright) {
    const a = nodeById.get(fromId);
    const b = nodeById.get(toId);
    if (!a?.visible || !b?.visible) {
      // still allow if endpoints exist in current layout
      if (!a || !b) return;
    }
    if (!a.visible || !b.visible) return;
    pulses.push({
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      t: 0,
      speed: bright ? 0.012 : 0.004,
      color,
      life: 1,
      bright: !!bright,
    });
  }

  function spawnAmbientCurrents() {
    const focus = currentFocus();
    const vLinks = visibleLinks().filter((l) => l.kind !== 'branch' || focus.level === LEVEL.MACHINE);
    if (!vLinks.length) return;
    const pick = vLinks[Math.floor(Math.random() * vLinks.length)];
    const s = typeof pick.source === 'string' ? pick.source : pick.source.id;
    const t = typeof pick.target === 'string' ? pick.target : pick.target.id;
    spawnPulse(s, t, 'rgba(200, 220, 240, 0.55)', false);
  }

  function spawnEventPulse(kind, machineId) {
    const m = nodeById.get(machineId);
    if (!m) return;
    if (kind === 'transaction' || kind === 'restock') {
      const branchId = `${machineId}::${kind === 'restock' ? 'stock' : 'revenue'}`;
      if (currentFocus().level === LEVEL.MACHINE && currentFocus().machineId === machineId) {
        spawnPulse(machineId, branchId, 'rgba(220, 240, 255, 0.95)', true);
      } else if (m.visible) {
        spawnPulse(m.parentId, machineId, 'rgba(220, 240, 255, 0.9)', true);
      }
    } else if (kind === 'alert') {
      const branchId = `${machineId}::technical`;
      if (currentFocus().level === LEVEL.MACHINE && currentFocus().machineId === machineId) {
        spawnPulse(machineId, branchId, 'rgba(220, 100, 80, 0.95)', true);
      } else if (m.visible) {
        spawnPulse(m.parentId, machineId, 'rgba(201, 162, 39, 0.9)', true);
      }
    }
  }

  function drawSignalsStatic() {
    /* layout changed — prune pulses tied to old coords by clearing soft */
  }

  function tickSignals(dt) {
    if (!signalCtx || reduceMotion) {
      if (signalCtx) signalCtx.clearRect(0, 0, signalCanvas.width, signalCanvas.height);
      return;
    }
    const w = signalCanvas.width;
    const h = signalCanvas.height;
    signalCtx.clearRect(0, 0, w, h);

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
      const r = p.bright ? 2.4 : 1.2;
      signalCtx.beginPath();
      signalCtx.fillStyle = p.color;
      if (p.bright) {
        signalCtx.shadowColor = p.color;
        signalCtx.shadowBlur = 8;
      } else {
        signalCtx.shadowBlur = 0;
      }
      signalCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
      signalCtx.fill();
      signalCtx.shadowBlur = 0;
    }

    // subtle alert ring pulse on machines
    if (currentFocus().level >= LEVEL.LOCATION) {
      machines.forEach((m) => {
        if (!m.visible || !m.alert) return;
        const phase = (performance.now() / 900) % 1;
        const s = worldToScreen(m.x, m.y);
        signalCtx.beginPath();
        signalCtx.strokeStyle =
          m.alert === 'red'
            ? `rgba(196,92,92,${0.45 * (1 - phase)})`
            : `rgba(201,162,39,${0.4 * (1 - phase)})`;
        signalCtx.lineWidth = 1;
        signalCtx.arc(s.x, s.y, (m.r + 6 + phase * 14) * transform.k, 0, Math.PI * 2);
        signalCtx.stroke();
      });
    }
  }

  function loop(ts) {
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    tickSignals(dt);
    rafId = requestAnimationFrame(loop);
  }

  // ——— mock events + red-flags poll ———
  function startEventTimers() {
    if (reduceMotion) return;
    setInterval(() => spawnAmbientCurrents(), 1800);
    setInterval(() => {
      if (!machines.length) return;
      const m = machines[Math.floor(Math.random() * machines.length)];
      const kinds = ['transaction', 'restock', 'alert'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      // bias: only alert if machine has alert state
      if (kind === 'alert' && !m.alert && m.status === 'active') {
        spawnEventPulse('transaction', m.id);
      } else {
        spawnEventPulse(kind, m.id);
      }
    }, 4200);
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
      /* fail silently */
    }
  }

  // ——— UI wiring ———
  function wireUi() {
    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        const dash = document.getElementById('dashboards-view');
        const isDash = btn.dataset.view === 'dashboards';
        dash.hidden = !isDash;
      });
    });

    document.querySelectorAll('.zoom-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'zoom-in') {
          svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.25);
        } else if (action === 'zoom-out') {
          svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.8);
        } else if (action === 'reset') {
          focusStack = [{ level: LEVEL.GALAXY }];
          closeBranchCard();
          closeTerminal();
          animateToFocus();
        }
      });
    });

    document.querySelector('.nav-chevron[data-dir="prev"]').addEventListener('click', goBack);
    document.querySelector('.nav-chevron[data-dir="next"]').addEventListener('click', () => {
      // advance into first child when possible
      const f = currentFocus();
      if (f.level === LEVEL.GALAXY) {
        const kw = DATA.countries.find((c) => c.status === 'active');
        if (kw) pushFocus({ level: LEVEL.COUNTRY, countryId: kw.id });
      } else if (f.level === LEVEL.COUNTRY) {
        const clients = nodes.filter((n) => n.type === 'client' && n.countryId === f.countryId && n.status === 'active');
        if (clients[0]) pushFocus({ level: LEVEL.CLIENT, countryId: f.countryId, clientId: clients[0].id });
      } else if (f.level === LEVEL.CLIENT) {
        const areas = nodes.filter((n) => n.type === 'area' && n.clientId === f.clientId);
        if (areas[0])
          pushFocus({ level: LEVEL.AREA, countryId: f.countryId, clientId: f.clientId, areaId: areas[0].id });
      } else if (f.level === LEVEL.AREA) {
        const locs = nodes.filter((n) => n.type === 'location' && n.areaId === f.areaId);
        if (locs[0])
          pushFocus({
            level: LEVEL.LOCATION,
            countryId: f.countryId,
            clientId: f.clientId,
            areaId: f.areaId,
            locationId: locs[0].id,
          });
      } else if (f.level === LEVEL.LOCATION) {
        const ms = nodes.filter((n) => n.type === 'machine' && n.locationId === f.locationId);
        if (ms[0])
          pushFocus({
            level: LEVEL.MACHINE,
            countryId: f.countryId,
            clientId: f.clientId,
            areaId: f.areaId,
            locationId: f.locationId,
            machineId: ms[0].id,
          });
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
      render();
    });
  }

  // ——— public test hooks ———
  window.APOS_SPACE_MAP = {
    getFocus: () => ({ ...currentFocus() }),
    getFocusStack: () => focusStack.map((f) => ({ ...f })),
    goBack,
    reset: () => {
      focusStack = [{ level: LEVEL.GALAXY }];
      closeBranchCard();
      closeTerminal();
      animateToFocus();
    },
    drillTo: (path) => {
      focusStack = [{ level: LEVEL.GALAXY }];
      path.forEach((step) => pushFocus(step));
    },
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
      if (machines[0]) spawnEventPulse('transaction', machines[0].id);
    },
    LEVEL,
  };

  // ——— boot ———
  buildGraph();
  initSvg();
  wireUi();
  resizeCanvases();
  render();
  startEventTimers();
  pollRedFlags();
  setInterval(pollRedFlags, 30000);
  if (!reduceMotion) rafId = requestAnimationFrame(loop);
})();
