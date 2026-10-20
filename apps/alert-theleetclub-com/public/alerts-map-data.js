/**
 * Leet Alerts map — hierarchical snapshot.
 * Category → subtype/rule → area → site → machine leaves.
 * Every Leet machine appears in the tree; open alerts are flagged.
 */
(function () {
  const CATEGORIES = [
    {
      id: 'offline',
      label: 'OFFLINE',
      subtitle: 'machines · heartbeat · connectivity',
      color: '#ff6b8a',
      icon: 'offline',
      action: 'Assign technician →',
      subtypes: [
        { id: 'machine-off', label: 'Machine OFF', match: (m) => m.status === 'offline' },
        { id: 'knet-down', label: 'KNet down', match: (m) => m.status === 'offline' || m.openTickets > 0 },
        { id: 'no-tx', label: 'No tx ≥30 min', match: (m) => m.status === 'active' && m.revenueToday < m.dailyAvg * 0.55 },
        { id: 'hb-stale', label: 'Heartbeat stale', match: (m) => m.status === 'unknown' || m.stale },
      ],
    },
    {
      id: 'lowstock',
      label: 'LOW STOCK',
      subtitle: 'fill · restock · products',
      color: '#f5c15c',
      icon: 'stock',
      action: 'Schedule restock →',
      subtypes: [
        { id: 'fill-critical', label: 'Fill ≤25%', match: (m) => m.fillPct <= 25 },
        { id: 'fill-warn', label: 'Fill ≤40%', match: (m) => m.fillPct > 25 && m.fillPct <= 40 },
        { id: 'top-sku', label: 'Top SKU risk', match: (m) => m.fillPct <= 55 },
        { id: 'restock-due', label: 'Restock due', match: (m) => true },
      ],
    },
    {
      id: 'revenue',
      label: 'REVENUE',
      subtitle: 'last tx · stale sale · sales',
      color: '#5eead4',
      icon: 'revenue',
      action: 'Open sales detail →',
      subtypes: [
        { id: 'stale-sale', label: 'Last tx ≥30 min', match: (m) => m.revenueToday < m.dailyAvg * 0.55 },
        { id: 'below-avg', label: 'Below daily avg', match: (m) => m.revenueToday < m.dailyAvg },
        { id: 'zero-today', label: 'Zero today', match: (m) => m.revenueToday <= 0 },
        { id: 'peak-gap', label: 'Peak gap', match: (m) => true },
      ],
    },
    {
      id: 'tasks',
      label: 'TASKS',
      subtitle: 'GO CHECK · maintenance · tech visit',
      color: '#60a5fa',
      icon: 'tasks',
      action: 'Create GO CHECK →',
      subtypes: [
        { id: 'go-check', label: 'GO CHECK', match: (m) => m.status === 'maintenance' || m.openTickets >= 2 },
        { id: 'maintenance', label: 'Maintenance', match: (m) => m.status === 'maintenance' },
        { id: 'tech-visit', label: 'Tech visit', match: (m) => m.openTickets >= 1 },
        { id: 'follow-up', label: 'Follow-up', match: (m) => true },
      ],
    },
    {
      id: 'support',
      label: 'SUPPORT',
      subtitle: 'tickets · Call OP · Call AM',
      color: '#e879f9',
      icon: 'support',
      action: 'Open ticket →',
      subtypes: [
        { id: 'open-ticket', label: 'Open ticket', match: (m) => m.openTickets >= 1 },
        { id: 'call-op', label: 'Call OP', match: (m) => m.status === 'offline' || m.stale },
        { id: 'call-am', label: 'Call AM', match: (m) => m.status === 'maintenance' },
        { id: 'triage', label: 'Triage queue', match: (m) => true },
      ],
    },
    {
      id: 'cleaning',
      label: 'CLEANING',
      subtitle: 'overdue · schedule · windows',
      color: '#2dd4bf',
      icon: 'cleaning',
      action: 'Flag cleaning overdue →',
      subtypes: [
        { id: 'overdue-15h', label: 'Overdue 15h', match: (m) => ['m-mew-2', 'm-ku-2', 'm-jg6-1'].includes(m.machineId) },
        { id: 'window-now', label: 'Window now', match: (m) => m.fillPct < 50 },
        { id: 'off-schedule', label: 'Off schedule', match: (m) => m.status !== 'active' },
        { id: 'due-today', label: 'Due today', match: (m) => true },
      ],
    },
    {
      id: 'unknown',
      label: 'UNKNOWN',
      subtitle: 'no heartbeat · stale · telemetry',
      color: '#fb7185',
      icon: 'unknown',
      action: 'Investigate telemetry →',
      subtypes: [
        { id: 'no-hb', label: 'No heartbeat', match: (m) => m.status === 'unknown' || m.stale },
        { id: 'stale-tel', label: 'Stale telemetry', match: (m) => m.stale || m.status === 'unknown' },
        { id: 'last-seen', label: 'Last seen gap', match: (m) => m.revenueToday <= 0 },
        { id: 'watch', label: 'Watch list', match: (m) => true },
      ],
    },
  ];

  function leetMachines() {
    const root = window.APOS_SPACE_DATA;
    const out = [];
    if (!root) return out;
    const kw = (root.countries || []).find((c) => c.id === 'country-kw');
    const leet = ((kw && kw.clients) || []).find((c) => c.id === 'client-leet');
    if (!leet) return out;
    (leet.areas || []).forEach((area) => {
      (area.locations || []).forEach((loc) => {
        (loc.machines || []).forEach((m) => {
          out.push({
            machineId: m.id,
            machine: m.label,
            site: loc.label,
            siteId: loc.id,
            area: area.label,
            areaId: area.id,
            status: m.status,
            stale: !!m.stale,
            offlineHours: m.offlineHours || 0,
            fillPct: m.stock?.fillPct ?? 100,
            revenueToday: m.revenue?.today ?? 0,
            dailyAvg: m.revenue?.dailyAvg ?? 0,
            openTickets: m.technical?.openTickets ?? 0,
            lastMaintenance: m.technical?.lastMaintenance || '',
            lastVisit: m.operators?.lastVisit || '',
            topProduct: (m.stock?.topProducts || [])[0] || '—',
          });
        });
      });
    });
    return out;
  }

  function ladder(current) {
    return [
      { id: 'detected', label: 'DETECTED', copy: 'Signal crossed the Red Flags board rule.' },
      { id: 'acknowledged', label: 'ACKNOWLEDGED', copy: 'Ops saw the alert and claimed ownership.' },
      { id: 'in_progress', label: 'IN PROGRESS', copy: 'Technician or operator is working the site.' },
      { id: 'resolved', label: 'RESOLVED', copy: 'Machine cleared the board criteria.' },
    ].map((s) => ({ ...s, current: s.id === current }));
  }

  const WATCH = new Set(['restock-due', 'follow-up', 'triage', 'due-today', 'watch', 'peak-gap', 'top-sku', 'below-avg', 'window-now', 'last-seen', 'knet-down']);

  function alertState(m, subtypeId) {
    // Catch-all / watch paths stay MONITOR unless the machine itself is unhealthy.
    const watch = WATCH.has(subtypeId);
    if (m.status === 'offline' || m.status === 'maintenance') return 'CRITICAL';
    if (m.stale || m.status === 'unknown') return 'WARNING';
    if (subtypeId === 'fill-critical' && m.fillPct <= 25) return 'WARNING';
    if (subtypeId === 'fill-warn' && m.fillPct <= 40) return 'WARNING';
    if (subtypeId === 'stale-sale' && m.revenueToday < m.dailyAvg * 0.55) return 'WARNING';
    if (subtypeId === 'zero-today' && m.revenueToday <= 0) return 'WARNING';
    if (subtypeId === 'go-check' && (m.status === 'maintenance' || m.openTickets >= 2)) return 'CRITICAL';
    if (subtypeId === 'open-ticket' && m.openTickets >= 1) return 'WARNING';
    if (subtypeId === 'overdue-15h' && ['m-mew-2', 'm-ku-2', 'm-jg6-1'].includes(m.machineId)) return 'WARNING';
    if (subtypeId === 'machine-off' && m.status === 'offline') return 'CRITICAL';
    if (subtypeId === 'no-hb' && (m.status === 'unknown' || m.stale)) return 'WARNING';
    if (watch) return 'MONITOR';
    return 'MONITOR';
  }

  function ladderFor(state) {
    if (state === 'CRITICAL') return 'in_progress';
    if (state === 'WARNING') return 'acknowledged';
    if (state === 'MONITOR') return 'detected';
    return 'detected';
  }

  function buildAlert(m, cat, subtype) {
    const state = alertState(m, subtype.id);
    const isHot = state !== 'MONITOR';
    return {
      id: `${cat.id}:${subtype.id}:${m.machineId}`,
      categoryId: cat.id,
      subtypeId: subtype.id,
      subtype: subtype.label,
      state,
      hot: isHot,
      title: isHot ? `${m.machine} · ${subtype.label}` : `${m.machine} monitored`,
      description: isHot
        ? `${subtype.label} on ${m.machine} at ${m.site} (${m.area}). Status ${m.status}, fill ${m.fillPct}%, tickets ${m.openTickets}.`
        : `${m.machine} is on the ${cat.label} watch path under ${subtype.label}.`,
      machine: m,
      impactPerHour: Math.max(2, Math.round((m.dailyAvg || 80) / (isHot ? 12 : 24))),
      ladder: ladderFor(state),
      action: cat.action,
    };
  }

  /** Build geo tree under a subtype: area → site → machines */
  function geoTree(machines, cat, subtype) {
    const byArea = new Map();
    machines.forEach((m) => {
      if (!byArea.has(m.areaId)) byArea.set(m.areaId, { id: m.areaId, label: m.area, sites: new Map() });
      const area = byArea.get(m.areaId);
      if (!area.sites.has(m.siteId)) area.sites.set(m.siteId, { id: m.siteId, label: m.site, machines: [] });
      area.sites.get(m.siteId).machines.push(m);
    });
    return [...byArea.values()].map((area) => ({
      id: `${cat.id}:${subtype.id}:${area.id}`,
      kind: 'area',
      label: area.label,
      children: [...area.sites.values()].map((site) => ({
        id: `${cat.id}:${subtype.id}:${site.id}`,
        kind: 'site',
        label: site.label,
        children: site.machines.map((m) => {
          const alert = buildAlert(m, cat, subtype);
          return {
            id: alert.id,
            kind: 'machine',
            label: m.machine,
            alert,
            children: [],
          };
        }),
      })),
    }));
  }

  function assignMachines(all, subtype, used) {
    const matched = all.filter((m) => subtype.match(m));
    if (matched.length) return matched;
    // Keep crystalline density: unused machines first, else rotate through fleet.
    const fresh = all.filter((m) => !used.has(m.machineId));
    const pool = fresh.length ? fresh : all;
    return pool.slice(0, Math.min(4, pool.length));
  }

  function buildCategoryTree(cat, machines) {
    const used = new Set();
    const subtypeNodes = cat.subtypes.map((subtype) => {
      let ms = assignMachines(machines, subtype, used);
      // Prefer putting every machine somewhere in the category at least once.
      ms.forEach((m) => used.add(m.machineId));
      return {
        id: `${cat.id}:${subtype.id}`,
        kind: 'subtype',
        label: subtype.label,
        subtypeId: subtype.id,
        children: geoTree(ms, cat, subtype),
      };
    });

    // Ensure every Leet machine appears under this category.
    const missing = machines.filter((m) => !used.has(m.machineId));
    if (missing.length) {
      const catchAll = cat.subtypes[cat.subtypes.length - 1];
      const last = subtypeNodes[subtypeNodes.length - 1];
      const extra = geoTree(missing, cat, catchAll);
      // merge areas into last subtype
      extra.forEach((areaNode) => {
        const existing = last.children.find((a) => a.label === areaNode.label);
        if (!existing) last.children.push(areaNode);
        else {
          areaNode.children.forEach((siteNode) => {
            const es = existing.children.find((s) => s.label === siteNode.label);
            if (!es) existing.children.push(siteNode);
            else existing.children.push(...siteNode.children);
          });
        }
      });
    }

    return {
      id: cat.id,
      kind: 'category',
      label: cat.label,
      subtitle: cat.subtitle,
      color: cat.color,
      icon: cat.icon,
      action: cat.action,
      children: subtypeNodes,
    };
  }

  /**
   * Overview tree: category → rule → site leaves (machines aggregated with counts).
   * Keeps ~15–30 nodes per branch so the map can space like Skilltree.
   */
  function toOverviewTree(fullTree) {
    function siteLeaf(siteNode) {
      const machines = siteNode.children || [];
      const hotAlert = machines.find((m) => m.alert && m.alert.hot)?.alert || null;
      const anyAlert = hotAlert || machines[0]?.alert || null;
      const n = machines.length;
      return {
        id: `${siteNode.id}:ov`,
        kind: 'site',
        label: n > 1 ? `${siteNode.label} · ${n}` : siteNode.label,
        count: n,
        alert: anyAlert,
        hot: !!hotAlert,
        children: [],
      };
    }

    function mapSubtype(sub) {
      const sites = [];
      (sub.children || []).forEach((area) => {
        (area.children || []).forEach((site) => {
          sites.push(siteLeaf(site));
        });
      });
      // Cap fan-out per rule so overview stays airy (~Skilltree density)
      const capped = sites.length > 4 ? sites.slice(0, 4) : sites;
      return {
        id: sub.id,
        kind: 'subtype',
        label: sub.label,
        subtypeId: sub.subtypeId,
        icon: sub.icon,
        children: capped,
      };
    }

    // Prefer hotter / earlier rules; keep 3 fans so overview stays airy
    const subs = (fullTree.children || []).map(mapSubtype).slice(0, 3);
    return {
      id: fullTree.id,
      kind: 'category',
      label: fullTree.label,
      subtitle: fullTree.subtitle,
      color: fullTree.color,
      icon: fullTree.icon,
      action: fullTree.action,
      children: subs,
    };
  }

  function walk(node, fn, depth = 0, parent = null) {
    fn(node, depth, parent);
    (node.children || []).forEach((c) => walk(c, fn, depth + 1, node));
  }

  function collectAlerts(tree) {
    const out = [];
    walk(tree, (n) => {
      if (n.kind === 'machine' && n.alert) out.push({ ...n.alert, ladderSteps: ladder(n.alert.ladder) });
    });
    return out;
  }

  function countNodes(tree) {
    let n = 0;
    walk(tree, () => { n += 1; });
    return n;
  }

  function buildSnapshot() {
    const machines = leetMachines();
    const categories = CATEGORIES.map((cat) => {
      const tree = buildCategoryTree(cat, machines);
      const overviewTree = toOverviewTree(tree);
      const alerts = collectAlerts(tree);
      const open = alerts.filter((a) => a.hot).length;
      return {
        id: cat.id,
        label: cat.label,
        subtitle: cat.subtitle,
        color: cat.color,
        icon: cat.icon,
        action: cat.action,
        tree,
        overviewTree,
        alerts,
        count: open,
        nodeCount: countNodes(tree),
        overviewNodeCount: countNodes(overviewTree),
      };
    });

    const allAlerts = categories.flatMap((c) => c.alerts);
    const openAlerts = allAlerts.filter((a) => a.hot);
    // Dedupe impact by machine for the KPI strip.
    const seenMach = new Set();
    let revenueAtRisk = 0;
    openAlerts.forEach((a) => {
      const k = a.machine.machineId;
      if (seenMach.has(k)) return;
      seenMach.add(k);
      revenueAtRisk += a.impactPerHour || 0;
    });
    const critical = openAlerts.filter((a) => a.state === 'CRITICAL').length;
    const warning = openAlerts.filter((a) => a.state === 'WARNING').length;
    const byCategory = Object.fromEntries(categories.map((c) => [c.id, c.count]));

    return {
      brand: 'Leet',
      brandId: 'client-leet',
      generatedAt: new Date().toISOString(),
      categories,
      machines,
      alerts: openAlerts,
      counters: {
        machines: machines.length,
        open: openAlerts.length,
        critical,
        warning,
        revenueAtRisk,
        byCategory,
        totalNodes: categories.reduce((s, c) => s + c.nodeCount, 0),
      },
    };
  }

  window.LEET_ALERTS_DATA = { CATEGORIES, buildSnapshot, ladder, walk };
})();
