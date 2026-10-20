/**
 * Leet Alerts map snapshot.
 * Categories use production Red Flags / workbook language.
 * Concrete items are derived from the Leet fleet in APOS_SPACE_DATA (areas Shadadiya, Zahra, Salmiya).
 */
(function () {
  const CATEGORIES = [
    {
      id: 'offline',
      label: 'OFFLINE',
      subtitle: 'machines · heartbeat · connectivity',
      color: '#f87171',
      icon: 'offline',
      action: 'Assign technician →',
    },
    {
      id: 'lowstock',
      label: 'LOW STOCK',
      subtitle: 'fill · restock · products',
      color: '#fbbf24',
      icon: 'stock',
      action: 'Schedule restock →',
    },
    {
      id: 'revenue',
      label: 'REVENUE',
      subtitle: 'last tx · stale sale · sales',
      color: '#34d399',
      icon: 'revenue',
      action: 'Open sales detail →',
    },
    {
      id: 'tasks',
      label: 'TASKS',
      subtitle: 'GO CHECK · maintenance · tech visit',
      color: '#60a5fa',
      icon: 'tasks',
      action: 'Create GO CHECK →',
    },
    {
      id: 'support',
      label: 'SUPPORT',
      subtitle: 'tickets · Call OP · Call AM',
      color: '#c084fc',
      icon: 'support',
      action: 'Open ticket →',
    },
    {
      id: 'cleaning',
      label: 'CLEANING',
      subtitle: 'overdue · schedule · windows',
      color: '#22d3ee',
      icon: 'cleaning',
      action: 'Flag cleaning overdue →',
    },
    {
      id: 'unknown',
      label: 'UNKNOWN',
      subtitle: 'no heartbeat · stale · telemetry',
      color: '#a1a1aa',
      icon: 'unknown',
      action: 'Investigate telemetry →',
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
            area: area.label,
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
            operatorId: m.operatorId,
            technicianId: m.technicianId,
          });
        });
      });
    });
    return out;
  }

  function ladder(current) {
    const steps = [
      { id: 'detected', label: 'DETECTED', copy: 'Signal crossed the Red Flags board rule.' },
      { id: 'acknowledged', label: 'ACKNOWLEDGED', copy: 'Ops saw the alert and claimed ownership.' },
      { id: 'in_progress', label: 'IN PROGRESS', copy: 'Technician or operator is working the site.' },
      { id: 'resolved', label: 'RESOLVED', copy: 'Machine cleared the board criteria.' },
    ];
    return steps.map((s) => ({ ...s, current: s.id === current }));
  }

  function buildAlerts(machines) {
    const alerts = [];
    const push = (a) => alerts.push(a);

    machines.forEach((m) => {
      if (m.status === 'offline') {
        push({
          id: `off-${m.machineId}`,
          categoryId: 'offline',
          subtype: 'KNet/Machine OFF ≥30 min',
          state: 'CRITICAL',
          title: `${m.machine} offline now`,
          description: `${m.machine} at ${m.site} has been offline for ${m.offlineHours || 3}+ hours. Heartbeat and KNet status are down.`,
          machine: m,
          impactPerHour: Math.max(8, Math.round((m.dailyAvg || 90) / 10)),
          ladder: 'in_progress',
          action: 'Assign technician →',
        });
      }
      if (m.status === 'unknown' || m.stale) {
        push({
          id: `unk-${m.machineId}`,
          categoryId: 'unknown',
          subtype: 'No heartbeat',
          state: 'WARNING',
          title: `${m.machine} no heartbeat`,
          description: `Telemetry for ${m.machine} is stale. Last visit ${m.lastVisit || 'unknown'}.`,
          machine: m,
          impactPerHour: Math.max(5, Math.round((m.dailyAvg || 70) / 14)),
          ladder: 'acknowledged',
          action: 'Investigate telemetry →',
        });
      }
      if ((m.fillPct || 100) <= 25) {
        push({
          id: `stock-${m.machineId}`,
          categoryId: 'lowstock',
          subtype: 'Fill ≤25%',
          state: 'WARNING',
          title: `${m.machine} low stock`,
          description: `${m.machine} is at ${m.fillPct}% fill. Top product ${m.topProduct}.`,
          machine: m,
          impactPerHour: Math.max(4, Math.round((m.dailyAvg || 80) / 16)),
          ladder: 'detected',
          action: 'Schedule restock →',
        });
      }
      if (m.status === 'active' && (m.revenueToday || 0) < (m.dailyAvg || 0) * 0.55 && (m.dailyAvg || 0) >= 80) {
        push({
          id: `rev-${m.machineId}`,
          categoryId: 'revenue',
          subtype: 'Last tx ≥30 min',
          state: 'WARNING',
          title: `${m.machine} stale sale`,
          description: `Sales today ${m.revenueToday.toFixed(1)} KWD vs daily avg ${m.dailyAvg}. Likely a stale-sale gap.`,
          machine: m,
          impactPerHour: Math.max(6, Math.round((m.dailyAvg || 100) / 12)),
          ladder: 'detected',
          action: 'Open sales detail →',
        });
      }
      if (m.status === 'maintenance' || (m.openTickets || 0) >= 2) {
        push({
          id: `task-${m.machineId}`,
          categoryId: 'tasks',
          subtype: 'GO CHECK / maintenance',
          state: m.status === 'maintenance' ? 'CRITICAL' : 'OPEN',
          title: `${m.machine} needs GO CHECK`,
          description: `Maintenance open on ${m.machine}. Last maintenance ${m.lastMaintenance || '—'}.`,
          machine: m,
          impactPerHour: Math.max(7, Math.round((m.dailyAvg || 120) / 11)),
          ladder: 'in_progress',
          action: 'Create GO CHECK →',
        });
      }
      if ((m.openTickets || 0) >= 1) {
        push({
          id: `sup-${m.machineId}`,
          categoryId: 'support',
          subtype: 'Technical issue',
          state: 'OPEN',
          title: `${m.machine} open ticket`,
          description: `${m.openTickets} open technical ticket(s) on ${m.machine} · ${m.site}.`,
          machine: m,
          impactPerHour: Math.max(5, Math.round((m.dailyAvg || 90) / 15)),
          ladder: 'acknowledged',
          action: 'Open ticket →',
        });
      }
    });

    // Cleaning overdue examples grounded in real workflow language (mock timing).
    const cleanTargets = machines.filter((m) => ['m-mew-2', 'm-ku-2', 'm-jg6-1'].includes(m.machineId));
    cleanTargets.forEach((m) => {
      push({
        id: `clean-${m.machineId}`,
        categoryId: 'cleaning',
        subtype: 'Cleaning overdue (15h)',
        state: 'WARNING',
        title: `${m.machine} cleaning overdue`,
        description: `CLEANING OVERDUE on ${m.machine}. Last clean window missed the 15h rule.`,
        machine: m,
        impactPerHour: 3,
        ladder: 'detected',
        action: 'Flag cleaning overdue →',
      });
    });

    return alerts;
  }

  function buildSnapshot() {
    const machines = leetMachines();
    const alerts = buildAlerts(machines);
    const byCat = Object.fromEntries(CATEGORIES.map((c) => [c.id, []]));
    alerts.forEach((a) => {
      if (byCat[a.categoryId]) byCat[a.categoryId].push(a);
    });

    const counts = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, (byCat[c.id] || []).length])
    );
    const critical = alerts.filter((a) => a.state === 'CRITICAL').length;
    const warning = alerts.filter((a) => a.state === 'WARNING').length;
    const open = alerts.filter((a) => a.state === 'OPEN' || a.state === 'CRITICAL' || a.state === 'WARNING').length;
    const revenueAtRisk = alerts.reduce((s, a) => s + (a.impactPerHour || 0), 0);

    return {
      brand: 'Leet',
      brandId: 'client-leet',
      generatedAt: new Date().toISOString(),
      categories: CATEGORIES.map((c) => ({
        ...c,
        count: counts[c.id] || 0,
        alerts: (byCat[c.id] || []).map((a) => ({
          ...a,
          ladderSteps: ladder(a.ladder),
        })),
      })),
      machines,
      alerts: alerts.map((a) => ({ ...a, ladderSteps: ladder(a.ladder) })),
      counters: {
        machines: machines.length,
        open,
        critical,
        warning,
        revenueAtRisk,
        byCategory: counts,
      },
    };
  }

  window.LEET_ALERTS_DATA = {
    CATEGORIES,
    buildSnapshot,
    ladder,
  };
})();
