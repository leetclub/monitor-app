    /**
     * Live taxonomy HUD for alert.theleetclub.com
     * Hydrates from people-api (same-origin /api) and dispatches via Workflow proxies.
     * Hierarchy: Region (Kuwait) → Brand (Leet/EE/Park) → Area → Machine → Revenue|Stock|Contract
     *
     * file:// / off-host: never call fetch('/api/...') — CORS blocks non-http origins.
     */
    const BUILD_STAMP = '20261014-vendon-workflow';
    const ALERT_HOST = 'alert.theleetclub.com';
    const LIVE_HUD_URL = `https://${ALERT_HOST}/constellation-taxonomy-hud.html`;
    const LIVE_LOGIN_URL = `https://${ALERT_HOST}/login`;
    /** Live /api + session cookie only on production Alert host. file:// and other hosts → DEMO. */
    const isHttpOrigin =
      typeof location !== 'undefined' &&
      (location.protocol === 'http:' || location.protocol === 'https:');
    const canUseLiveApis =
      isHttpOrigin && String(location.hostname || '').toLowerCase() === ALERT_HOST;

    const API = {
      me: '/api/me',
      machines: '/api/alert/machines',
      snapshot: '/api/alert/red-flags/snapshot',
      salesElapsed: '/api/alert/overall/daily-sales-elapsed',
      salesSummary: '/api/alert/overall/vendon-sales-summary?preset=today_vs_yesterday',
      lastTx: '/api/alert/overall/last-transactions',
      liveDash: '/api/live-dashboard/snapshot',
      downtime: '/api/alert/overall/downtime-summary?preset=today_vs_yesterday',
      adminProfiles: '/api/alert/overall/admin-profiles',
      areaOwners: '/api/alert/area-owner-map',
      attendanceMap: (ids) =>
        `/api/alert/workflow/machine-attendance-map?machine_ids=${encodeURIComponent(ids)}`,
      cleaningMap: (ids) =>
        `/api/alert/workflow/cleaning-map?machine_ids=${encodeURIComponent(ids)}`,
      techIssuesMap: (ids) =>
        `/api/alert/workflow/technical-issues-map?machine_ids=${encodeURIComponent(ids)}`,
      operatorSchedule: (id) =>
        `/api/alert/workflow/operator-schedule?machine_id=${encodeURIComponent(id)}`,
      techIssues: (id) =>
        `/api/alert/workflow/technical-issues?machine_id=${encodeURIComponent(id)}`,
      goCheck: '/api/alert/workflow/go-check',
      dm: '/api/alert/workflow/dm-operator',
      cleaning: '/api/alert/workflow/cleaning-overdue',
      /** No ?machines= → classic day totals only (lighter than per-id vends resolve). */
      creditsTotals: '/api/alert/remote-credits/today-totals',
    };

    const POLL_MS = 60000;
    const levelColors = {
      root: '#ffffff',
      region: '#00f0ff',
      brand: '#a855f7',
      area: '#ff2a85',
      machine: '#ffb800',
      facet: '#05ffa1',
      revenueDetail: '#00f0ff',
      salesDetail: '#ffb800',
    };

    /** Geographic area hints from real Kuwait fleet naming (extend as needed). */
    const AREA_RULES = [
      { area: 'Shadadiya', re: /shadadiya|shadadiyah|\bku[-_\s]?\d|\bcoba\b|kuwait\s*univ/i },
      { area: 'Zahra', re: /zahra|mew|jaber/i },
      { area: 'Salmiya', re: /salmiya|salmiyah/i },
      { area: 'Hawally', re: /hawally|hawalli/i },
      { area: 'Farwaniya', re: /farwaniya|farwaniyah/i },
      { area: 'Ahmadi', re: /ahmadi/i },
      { area: 'Jahra', re: /jahra/i },
      { area: 'Capital', re: /capital|kuwait\s*city|sharq|mirqab/i },
    ];

    const canvas = document.getElementById('universe');
    const ctx = canvas.getContext('2d');
    let width = 0, height = 0;
    let taxonomyRoot = null;
    let flatNodes = [];
    let flatEdges = [];
    let signals = [];
    let liveBundle = null;
    let lastPollAt = null;
    let usingMock = false;

    let currentTransform = { x: 0, y: 0, scale: 0.75 };
    let targetTransform = { x: 0, y: 0, scale: 0.75 };
    window.currentNode = null;

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      if (!window.currentNode) {
        currentTransform = { x: width / 2, y: height / 2, scale: 0.75 };
        targetTransform = { ...currentTransform };
      }
    }
    window.addEventListener('resize', resize);
    resize();

    function logTrace(msg, ok = true) {
      const box = document.getElementById('trace');
      const t = new Date().toTimeString().slice(0, 8);
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ts">[${t}]</span><span class="${ok ? 'ok' : 'bad'}">${msg}</span>`;
      box.prepend(row);
      while (box.children.length > 7) box.removeChild(box.lastChild);
    }

    function paintBuildStamp() {
      const idEl = document.getElementById('build-stamp-id');
      if (idEl) idEl.textContent = BUILD_STAMP;
      document.documentElement.setAttribute('data-build', BUILD_STAMP);
      const box = document.querySelector('.status-box');
      if (box) box.setAttribute('data-build', BUILD_STAMP);
    }

    async function apiGet(path) {
      if (!canUseLiveApis) {
        const err = new Error('file:// / off-http — open alert.theleetclub.com for live APIs');
        err.code = 'NO_LIVE';
        throw err;
      }
      const res = await fetch(path, { credentials: 'include' });
      if (res.status === 401) {
        const err = new Error('Unauthorized');
        err.code = 401;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return res.json();
    }

    async function apiPost(path, body) {
      if (!canUseLiveApis) {
        const err = new Error('file:// / off-http — open alert.theleetclub.com for live APIs');
        err.code = 'NO_LIVE';
        throw err;
      }
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.payload = data;
        throw err;
      }
      return data;
    }

    function fmtKwd(n) {
      if (n == null || !Number.isFinite(Number(n))) return '—';
      return `${Number(n).toFixed(3)} KD`;
    }

    function fmtHours(n) {
      if (n == null || !Number.isFinite(Number(n))) return '—';
      const h = Number(n);
      if (h < 24) return `${h.toFixed(1)}h`;
      return `${(h / 24).toFixed(1)}d (${h.toFixed(0)}h)`;
    }

    function fmtLastTx(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', hour12: false });
      } catch (_) {
        return String(iso);
      }
    }

    function topProductsList(summary) {
      if (!summary) return [];
      if (Array.isArray(summary.topProducts) && summary.topProducts.length) {
        return summary.topProducts.slice(0, 5).filter((p) => p && (p.name || p.count != null));
      }
      const one = summary.topProduct;
      return one && one.name ? [one] : [];
    }

    function problemRank(m) {
      const v = m.vitals || {};
      return (
        (Number(v.attentionPts) || 0) * 100 +
        (v.cleaningOverdue ? 20 : 0) +
        (Number(v.flags) || 0) * 5 +
        (v.tier === 1 ? 10 : 0) -
        (Number.isFinite(Number(v.todayKd)) ? Math.min(Number(v.todayKd), 50) * 0.01 : 0)
      );
    }

    function topProblemNames(machineNodes, n = 3) {
      return [...machineNodes]
        .filter((m) => problemRank(m) > 0)
        .sort((a, b) => problemRank(b) - problemRank(a))
        .slice(0, n)
        .map((m) => m.machineName || m.label);
    }

    function areaFromMachine(name, location, tag) {
      const hay = `${name || ''} ${location || ''} ${tag || ''}`;
      for (const rule of AREA_RULES) {
        if (rule.re.test(hay)) return rule.area;
      }
      if (location && String(location).trim()) return String(location).trim();
      if (tag && String(tag).trim()) return `Owner · ${String(tag).trim()}`;
      const m = String(name || '').trim();
      const parts = m.split(/[-–|]/);
      if (parts[0] && parts[0].trim().length >= 3) return parts[0].trim();
      return 'Unassigned area';
    }

    function chunk(arr, size) {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }

    async function fetchAttendanceMap(machineIds) {
      const byMachineId = {};
      for (const group of chunk(machineIds, 24)) {
        if (!group.length) continue;
        try {
          const data = await apiGet(API.attendanceMap(group.join(',')));
          Object.assign(byMachineId, data.byMachineId || {});
        } catch (e) {
          logTrace(`attendance batch fail: ${e.message}`, false);
        }
      }
      return byMachineId;
    }

    async function fetchCleaningMap(machineIds) {
      const byMachineId = {};
      for (const group of chunk(machineIds, 24)) {
        if (!group.length) continue;
        try {
          const data = await apiGet(API.cleaningMap(group.join(',')));
          Object.assign(byMachineId, data.byMachineId || {});
        } catch (e) {
          logTrace(`cleaning-map batch fail: ${e.message}`, false);
        }
      }
      return byMachineId;
    }

    async function fetchTechIssuesMap(machineIds) {
      const byMachineId = {};
      for (const group of chunk(machineIds, 24)) {
        if (!group.length) continue;
        try {
          const data = await apiGet(API.techIssuesMap(group.join(',')));
          Object.assign(byMachineId, data.byMachineId || {});
        } catch (e) {
          logTrace(`tech-issues-map batch fail: ${e.message}`, false);
        }
      }
      return byMachineId;
    }

    function indexLiveDash(machines) {
      const byId = {};
      for (const row of machines || []) {
        const id = String(row.machineId || row.machine_id || '').trim();
        if (id) byId[id] = row;
      }
      return byId;
    }

    function fmtSaleAge(min) {
      if (min == null || !Number.isFinite(Number(min))) return '—';
      const m = Number(min);
      if (m < 60) return `${Math.round(m)}m`;
      return `${(m / 60).toFixed(1)}h`;
    }

    function fmtDowntimeSec(sec) {
      if (sec == null || !Number.isFinite(Number(sec))) return '—';
      const s = Math.max(0, Number(sec));
      if (s < 60) return `${Math.round(s)}s`;
      if (s < 3600) return `${(s / 60).toFixed(0)}m`;
      return `${(s / 3600).toFixed(1)}h`;
    }

    function liveAlertCodes(live) {
      const alerts = Array.isArray(live?.alerts) ? live.alerts : [];
      return alerts
        .map((a) => a.code || a.message || a.level)
        .filter(Boolean)
        .slice(0, 6);
    }

    function peakHourLabel(peak) {
      if (peak == null || peak === '') return '—';
      if (typeof peak === 'object') {
        return peak.label || (peak.hour != null ? `H${peak.hour}` : '—');
      }
      return String(peak);
    }

    function buildTaxonomy(bundle) {
      const {
        machines = [],
        snapshotRows = [],
        salesById = {},
        summaryById = {},
        profilesById = {},
        areaOwnerById = {},
        attendanceById = {},
        creditsById = {},
        lastTxById = {},
        liveById = {},
        cleaningById = {},
        techById = {},
        downtimeById = {},
      } = bundle;

      const snapById = {};
      for (const r of snapshotRows) {
        const id = String(r.machineId ?? r.machine_id ?? '').trim();
        if (id) snapById[id] = r;
      }

      const machineList = machines.length
        ? machines
        : Object.keys(snapById).map((id) => ({
            id,
            name: snapById[id].machineName || id,
            vendon_location_owner: null,
          }));

      const areas = new Map();

      for (const m of machineList) {
        const id = String(m.id);
        const name = m.name || id;
        const snap = snapById[id] || {};
        const prof = profilesById[id] || {};
        const sales = salesById[id] || {};
        const summary = summaryById[id] || {};
        const att = attendanceById[id] || {};
        const credits = creditsById[id] || null;
        const live = liveById[id] || {};
        const lastTxRow = lastTxById[id] || null;
        const cleanWf = cleaningById[id] || {};
        const tech = techById[id] || {};
        const down = downtimeById[id] || {};
        const ownerPerson =
          areaOwnerById[id]?.name ||
          areaOwnerById[id]?.ownerName ||
          areaOwnerById[id]?.owner ||
          '';

        const areaName = areaFromMachine(
          name,
          snap.machineLocation,
          m.vendon_location_owner || prof.location_owner,
        );

        if (!areas.has(areaName)) areas.set(areaName, []);

        const todayKwd = sales.todayKwd != null ? Number(sales.todayKwd) : null;
        const yestKwd =
          sales.yesterdaySameElapsedKwd != null
            ? Number(sales.yesterdaySameElapsedKwd)
            : sales.yesterdayKwd != null
              ? Number(sales.yesterdayKwd)
              : null;
        const tops = topProductsList(summary);
        const top = tops[0] || null;
        const opName =
          att.operatorName ||
          snap.operator ||
          snap.operatorName ||
          snap.redAlertOperator ||
          '—';
        const opEmail = att.operatorEmail || snap.strikeOperatorEmail || snap.operatorEmail || '';

        const reasons = Array.isArray(snap.reasons) ? snap.reasons : [];
        const cleaningOverdue = !!snap.cleaningOverdue15h;
        const hoursSinceCleaning =
          snap.hoursSinceCleaning != null && Number.isFinite(Number(snap.hoursSinceCleaning))
            ? Number(snap.hoursSinceCleaning)
            : null;
        const tier = snap.alertPriorityTier != null ? Number(snap.alertPriorityTier) : null;
        let lastTx =
          snap.lastTransactionAtUtc ||
          snap.lastTxAtUtc ||
          snap.lastTransactionAt ||
          sales.lastTransactionAtUtc ||
          null;
        if (!lastTx && lastTxRow?.timestamp) {
          lastTx = new Date(Number(lastTxRow.timestamp) * 1000).toISOString();
        } else if (!lastTx && live.lastVendAt) {
          lastTx = live.lastVendAt;
        }
        const liveCodes = liveAlertCodes(live);
        const techActive =
          tech.activeCount != null
            ? Number(tech.activeCount)
            : Array.isArray(tech.issues)
              ? tech.issues.length
              : null;
        const attStatus = att.attendanceStatusLabel || att.attendanceStatus || att.pill?.label || '';
        const attState = att.state || '';
        const wfLastClean = cleanWf.lastCleaningAt || live.lastCleaningAt || null;
        const shiftLate = !!(live.shift && live.shift.late);
        const locOwner =
          prof.location_owner || m.vendon_location_owner || snap.machineLocationOwner || '—';
        const locHours = prof.location_hours || prof.locationHours || '—';
        const inactive =
          prof.inactiveToday === true ||
          prof.is_active === false ||
          snap.inactiveToday === true;
        const inactiveLabel =
          prof.inactiveLabel || (inactive ? 'INACTIVE' : 'active');
        const flagCount = reasons.length;
        const isTier1 = tier === 1;
        const attentionPts = (isTier1 ? 3 : 0) + (cleaningOverdue ? 2 : 0) + (flagCount ? 1 : 0);
        const attentionTargets =
          (isTier1 ? 1 : 0) + (cleaningOverdue ? 1 : 0) + (flagCount ? 1 : 0);
        const flagged = flagCount > 0 || cleaningOverdue || isTier1;
        const vitals = {
          todayKd: todayKwd,
          yestKd: yestKwd,
          flags: flagCount,
          flagLabels: reasons.slice(0, 5),
          cleaningOverdue,
          hoursSinceCleaning,
          operator: opName,
          operatorEmail: opEmail,
          tier,
          lastTx,
          areaOwner: ownerPerson || '—',
          locationOwner: locOwner,
          locationHours: locHours,
          inactive,
          inactiveLabel,
          attentionPts,
          attentionTargets,
          machineCount: 1,
          flaggedCount: flagged ? 1 : 0,
          overdueCount: cleaningOverdue ? 1 : 0,
          tier1Count: isTier1 ? 1 : 0,
        };

        const creditSent = credits ? Number(credits.credits_sent) || 0 : null;
        const dispenseTests = credits
          ? Number(credits.dispense_tests ?? credits.drink_tests_count) || 0
          : null;
        const creditKd = credits && credits.total_kd != null ? Number(credits.total_kd) : null;

        const detail = {
          todayKd: todayKwd,
          yestKd: yestKwd,
          operator: opName,
          operatorEmail: opEmail || '—',
          reasons,
          cleaningOverdue,
          hoursSinceCleaning,
          tier,
          lastTx,
          lastTxProduct: lastTxRow?.product_name || null,
          lastTxAmount: lastTxRow?.amount != null ? lastTxRow.amount : null,
          areaOwner: ownerPerson || '—',
          locationOwner: locOwner,
          locationHours: locHours,
          inactive,
          inactiveLabel,
          tops,
          aSalesKwd: summary.aSalesKwd != null ? Number(summary.aSalesKwd) : todayKwd,
          bSalesKwd: summary.bSalesKwd != null ? Number(summary.bSalesKwd) : yestKwd,
          aTx: summary.aTx != null ? Number(summary.aTx) : null,
          bTx: summary.bTx != null ? Number(summary.bTx) : null,
          trendPct: summary.trendPct != null ? Number(summary.trendPct) : null,
          peakHour: summary.peakHour != null ? summary.peakHour : null,
          distinctDrinks: summary.distinctDrinksSold != null ? Number(summary.distinctDrinksSold) : null,
          creditsSent: creditSent,
          dispenseTests,
          creditKd,
          hasCreditsRow: !!credits,
          liveCodes,
          saleAgeMinutes: live.saleAgeMinutes != null ? Number(live.saleAgeMinutes) : null,
          maintenanceStatus: live.maintenanceStatus || null,
          shiftLate,
          liveSalesToday: live.salesToday != null ? Number(live.salesToday) : null,
          attendanceStatus: attStatus || null,
          attendanceState: attState || null,
          attendancePill: att.pill?.label || null,
          techActiveCount: techActive,
          techLatest:
            tech.latest?.statusLabel || tech.latest?.status || tech.latest?.description || null,
          wfLastCleaningAt: wfLastClean,
          wfCleaningSource: cleanWf.cleaningSource || null,
          wfHighRisk: !!cleanWf.highRisk,
          downtimeTodaySec: down.todaySec != null ? Number(down.todaySec) : null,
          downtimePeriodSec: down.periodSec != null ? Number(down.periodSec) : null,
        };

        const topProductChildren = tops.map((p, i) => ({
          id: `m-${id}-rev-top-${i}`,
          label: `#${i + 1}: ${p.name || 'Unknown'}`,
          level: 'salesDetail',
          machineId: id,
          machineName: name,
          operatorEmail: opEmail,
          vitals,
          detail,
          metrics: {
            Rank: String(i + 1),
            Qty: p.count != null ? String(p.count) : '—',
            KD: p.salesKwd != null ? fmtKwd(p.salesKwd) : p.kd != null ? fmtKwd(p.kd) : '—',
            Source: 'vendon-sales-summary',
          },
        }));

        const revMetrics = {
          'Today (elapsed)': fmtKwd(todayKwd),
          'Yest same clock': fmtKwd(yestKwd),
          'Summary A KD': fmtKwd(detail.aSalesKwd),
          'Summary B KD': fmtKwd(detail.bSalesKwd),
          'TX A / B':
            detail.aTx != null || detail.bTx != null
              ? `${detail.aTx ?? '—'} / ${detail.bTx ?? '—'}`
              : '—',
        };
        tops.forEach((p, i) => {
          revMetrics[`Top ${i + 1}`] = `${p.name || '?'} ×${p.count ?? '—'}`;
        });
        if (!tops.length) revMetrics['Top products'] = 'none in summary';

        const stockMetrics = credits
          ? {
              'Credits sent today': String(creditSent),
              'Dispense tests': String(dispenseTests),
              'Credits KD': creditKd != null ? fmtKwd(creditKd) : '—',
              'Ingredient stock': 'not in Alert API',
              'Live flags': reasons.length ? reasons.slice(0, 3).join(', ') : 'none',
            }
          : {
              'Ingredient stock': 'not in Alert API',
              'Credits / tests': 'not in API (no remote-credit events today)',
              'Live flags': reasons.length ? reasons.slice(0, 3).join(', ') : 'none',
              'Top drink today': top?.name || '—',
              Hint: 'Open Red Flags Credits column for full board',
            };

        const machineNode = {
          id: `m-${id}`,
          label: name,
          level: 'machine',
          machineId: id,
          machineName: name,
          operatorEmail: opEmail,
          vitals,
          detail,
          metrics: {
            'Today KD': fmtKwd(todayKwd),
            'Yest same clock': fmtKwd(yestKwd),
            Operator: opName,
            Attendance: attStatus || attState || '—',
            'Live codes': liveCodes.length ? liveCodes.join(', ') : 'none',
            Reasons: reasons.length ? reasons.join(', ') : 'none',
            'Tech issues': techActive != null ? String(techActive) : '—',
            'Cleaning 15h': cleaningOverdue ? 'OVERDUE' : 'ok',
            'Sale age': fmtSaleAge(live.saleAgeMinutes),
            Maint: live.maintenanceStatus || '—',
            Tier: tier != null ? String(tier) : '—',
            'Last TX': fmtLastTx(lastTx),
          },
          children: [
            {
              id: `m-${id}-rev`,
              label: 'Revenue',
              level: 'facet',
              machineId: id,
              machineName: name,
              operatorEmail: opEmail,
              vitals,
              detail,
              metrics: revMetrics,
              children: [
                {
                  id: `m-${id}-rev-sales`,
                  label: 'Total Sales To Hour',
                  level: 'revenueDetail',
                  machineId: id,
                  machineName: name,
                  operatorEmail: opEmail,
                  vitals,
                  detail,
                  metrics: {
                    'Today elapsed': fmtKwd(todayKwd),
                    'Yest same clock': fmtKwd(yestKwd),
                    'A sales (summary)': fmtKwd(detail.aSalesKwd),
                    'B sales (summary)': fmtKwd(detail.bSalesKwd),
                    'A TX / B TX': `${detail.aTx ?? '—'} / ${detail.bTx ?? '—'}`,
                    Trend:
                      detail.trendPct != null && Number.isFinite(detail.trendPct)
                        ? `${detail.trendPct.toFixed(1)}%`
                        : '—',
                    'Distinct drinks':
                      detail.distinctDrinks != null ? String(detail.distinctDrinks) : '—',
                    Window: 'Kuwait today through now',
                  },
                  children: topProductChildren,
                },
                {
                  id: `m-${id}-rev-peak`,
                  label: 'Peak Hours',
                  level: 'revenueDetail',
                  machineId: id,
                  machineName: name,
                  operatorEmail: opEmail,
                  vitals,
                  detail,
                  metrics: {
                    'Peak hour (summary)':
                      detail.peakHour != null && detail.peakHour !== ''
                        ? String(detail.peakHour)
                        : '—',
                    Note: detail.peakHour != null ? 'From vendon-sales-summary' : 'Hourly peak wire next',
                    Hint: 'Use Performance tab for cup trajectory',
                  },
                },
                {
                  id: `m-${id}-rev-ops`,
                  label: 'Operators',
                  level: 'revenueDetail',
                  machineId: id,
                  machineName: name,
                  operatorEmail: opEmail,
                  vitals,
                  detail,
                  metrics: {
                    Scheduled: opName,
                    Email: opEmail || '—',
                    'Area owner': ownerPerson || '—',
                    Source: 'Workflow attendance map',
                  },
                },
              ],
            },
            {
              id: `m-${id}-stock`,
              label: 'Stock',
              level: 'facet',
              machineId: id,
              machineName: name,
              operatorEmail: opEmail,
              vitals,
              detail,
              metrics: stockMetrics,
            },
            {
              id: `m-${id}-contract`,
              label: 'Contract',
              level: 'facet',
              machineId: id,
              machineName: name,
              operatorEmail: opEmail,
              vitals,
              detail,
              metrics: {
                location_hours: locHours,
                location_owner: locOwner,
                'Area owner': ownerPerson || '—',
                Inactive: inactive ? inactiveLabel : 'active',
                Source: 'Alert Admin profiles + area-owner-map',
              },
            },
          ],
        };

        areas.get(areaName).push(machineNode);
      }

      function aggregateMetrics(labelExtra, kids, vitals) {
        const problems = topProblemNames(kids, 3);
        const flagged = kids.filter((m) => (m.vitals?.flaggedCount || 0) > 0).length;
        return {
          Machines: String(kids.length),
          Flagged: String(flagged),
          'Cleaning overdue': String(vitals.overdueCount || 0),
          'Sum today KD': fmtKwd(vitals.todayKd),
          'Top problems': problems.length ? problems.join(' · ') : 'none',
          ...labelExtra,
        };
      }

      const areaNodes = [...areas.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([areaName, kids]) => {
          const sorted = kids.sort((a, b) => a.label.localeCompare(b.label));
          const areaVitals = aggregateVitals(sorted);
          const problems = topProblemNames(sorted, 3);
          return {
            id: `area-${areaName}`,
            label: areaName,
            level: 'area',
            vitals: areaVitals,
            detail: {
              scope: 'area',
              machineCount: sorted.length,
              flaggedCount: areaVitals.flaggedCount,
              overdueCount: areaVitals.overdueCount,
              todayKd: areaVitals.todayKd,
              problems,
            },
            metrics: aggregateMetrics({ Brand: 'Leet', 'Tier-1': String(areaVitals.tier1Count) }, sorted, areaVitals),
            children: sorted,
          };
        });

      const allMachines = areaNodes.flatMap((a) => a.children || []);
      const leetMachineCount = allMachines.length;
      const fleetVitals = aggregateVitals(allMachines);
      const fleetToday = Object.values(salesById).reduce(
        (s, r) => s + (Number.isFinite(Number(r.todayKwd)) ? Number(r.todayKwd) : 0),
        0,
      );
      fleetVitals.todayKd = fleetToday;
      const fleetProblems = topProblemNames(allMachines, 3);

      return {
        id: 'root',
        label: 'Almaghreb Ops',
        level: 'root',
        vitals: fleetVitals,
        detail: { scope: 'root', machineCount: leetMachineCount, problems: fleetProblems },
        metrics: {
          Regions: '1',
          Machines: String(leetMachineCount),
          Flagged: String(fleetVitals.flaggedCount || 0),
          'Cleaning overdue': String(fleetVitals.overdueCount || 0),
          'Sum today KD': fmtKwd(fleetToday),
          'Top problems': fleetProblems.length ? fleetProblems.join(' · ') : 'none',
          Source: usingMock ? 'MOCK' : 'alert.theleetclub.com',
        },
        children: [
          {
            id: 'region-kw',
            label: 'Kuwait',
            level: 'region',
            vitals: fleetVitals,
            detail: {
              scope: 'region',
              machineCount: leetMachineCount,
              flaggedCount: fleetVitals.flaggedCount,
              overdueCount: fleetVitals.overdueCount,
              todayKd: fleetToday,
              problems: fleetProblems,
            },
            metrics: aggregateMetrics(
              { Brands: 'Leet · EE · Park', 'Attention targets': String(fleetVitals.attentionTargets) },
              allMachines,
              fleetVitals,
            ),
            children: [
              {
                id: 'brand-leet',
                label: 'Leet',
                level: 'brand',
                vitals: fleetVitals,
                detail: {
                  scope: 'brand',
                  machineCount: leetMachineCount,
                  flaggedCount: fleetVitals.flaggedCount,
                  overdueCount: fleetVitals.overdueCount,
                  todayKd: fleetToday,
                  problems: fleetProblems,
                },
                metrics: aggregateMetrics(
                  { Areas: String(areaNodes.length), 'Tier-1': String(fleetVitals.tier1Count) },
                  allMachines,
                  fleetVitals,
                ),
                children: areaNodes,
              },
              {
                id: 'brand-ee',
                label: 'EE',
                level: 'brand',
                metrics: {
                  Machines: '0',
                  Flagged: '0',
                  'Cleaning overdue': '0',
                  'Sum today KD': '—',
                  'Top problems': 'none',
                  Status: 'ACTIVE · 0 in Alert feed',
                },
                children: [],
              },
              {
                id: 'brand-park',
                label: 'Park (Future)',
                level: 'brand',
                metrics: {
                  Machines: '0',
                  Flagged: '0',
                  'Cleaning overdue': '0',
                  'Sum today KD': '—',
                  'Top problems': 'none',
                  Status: 'PLANNED',
                },
                children: [],
              },
            ],
          },
        ],
      };
    }

    function aggregateVitals(machineNodes) {
      let todayKd = 0;
      let flags = 0;
      let overdueCount = 0;
      let tier1Count = 0;
      let attentionPts = 0;
      let attentionTargets = 0;
      let flaggedCount = 0;
      const ops = new Set();
      for (const m of machineNodes) {
        const v = m.vitals || {};
        if (Number.isFinite(Number(v.todayKd))) todayKd += Number(v.todayKd);
        flags += Number(v.flags) || 0;
        if (v.cleaningOverdue) overdueCount += 1;
        if (v.tier === 1) tier1Count += 1;
        attentionPts += Number(v.attentionPts) || 0;
        attentionTargets += Number(v.attentionTargets) || 0;
        if ((Number(v.flaggedCount) || 0) > 0 || v.cleaningOverdue || v.tier === 1 || (Number(v.flags) || 0) > 0) {
          flaggedCount += 1;
        }
        if (v.operator && v.operator !== '—') ops.add(v.operator);
      }
      return {
        todayKd,
        flags,
        flagLabels: [],
        cleaningOverdue: overdueCount > 0,
        overdueCount,
        tier1Count,
        flaggedCount,
        operator: ops.size === 1 ? [...ops][0] : ops.size ? `${ops.size} operators` : '—',
        tier: tier1Count ? 1 : null,
        attentionPts,
        attentionTargets,
        machineCount: machineNodes.length,
      };
    }

    function resolveVitals(node) {
      if (!node) return null;
      if (node.vitals) return node.vitals;
      let n = node;
      while (n && !n.vitals) n = n.parent;
      return n?.vitals || null;
    }

    function vitalsPanelHtml(node) {
      const v = resolveVitals(node);
      if (!v) return '';
      const showDecision =
        node.level === 'machine' ||
        node.level === 'area' ||
        node.level === 'facet' ||
        node.level === 'revenueDetail' ||
        node.level === 'salesDetail' ||
        (node.machineId && node.level !== 'root');
      if (!showDecision && node.level !== 'brand' && node.level !== 'region') return '';

      const kdHot = Number.isFinite(Number(v.todayKd)) && Number(v.todayKd) < 20;
      const flagsHot = (Number(v.flags) || 0) > 0 || (Number(v.tier1Count) || 0) > 0 || v.tier === 1;
      const cleanHot = !!v.cleaningOverdue || (Number(v.overdueCount) || 0) > 0;
      const flagsLabel =
        node.level === 'machine' || node.machineId
          ? v.flagLabels?.length
            ? v.flagLabels.join(', ')
            : v.flags
              ? String(v.flags)
              : 'none'
          : `${v.flags || 0} open`;
      const cleanLabel =
        node.level === 'machine' || (node.machineId && v.overdueCount == null)
          ? v.cleaningOverdue
            ? 'OVERDUE'
            : 'ok'
          : `${v.overdueCount || 0} overdue`;
      const tierBits =
        node.level === 'machine' || node.machineId
          ? v.tier != null
            ? `T${v.tier}`
            : '—'
          : `${v.tier1Count || 0}× T1`;

      return `
        <div class="decision-cue">DECISION FOCUS · clearable vitals</div>
        <div class="vitals">
          <div class="vital focus-ring ${kdHot ? 'warn' : ''}">
            <span class="k">TODAY KD</span>
            <span class="v">${fmtKwd(v.todayKd)}</span>
          </div>
          <div class="vital focus-ring ${flagsHot ? 'hot' : ''}">
            <span class="k">FLAGS · ${tierBits}</span>
            <span class="v">${flagsLabel}</span>
          </div>
          <div class="vital focus-ring ${cleanHot ? 'hot' : ''}">
            <span class="k">CLEANING 15h</span>
            <span class="v">${cleanLabel}</span>
          </div>
          <div class="vital focus-ring">
            <span class="k">OPERATOR</span>
            <span class="v">${v.operator || '—'}</span>
          </div>
        </div>
      `;
    }

    function updateOpsFocusChip(root) {
      const v = root?.vitals || aggregateVitals([]);
      const pts = Number(v.attentionPts) || 0;
      const targets = Number(v.attentionTargets) || 0;
      const machines = Number(v.machineCount) || 1;
      const maxPts = Math.max(machines * 6, 6);
      const pct = Math.min(100, Math.round((pts / maxPts) * 100));
      const ptsEl = document.getElementById('ops-focus-pts');
      const tgtEl = document.getElementById('ops-focus-targets');
      const barEl = document.getElementById('ops-focus-bar');
      if (ptsEl) ptsEl.textContent = `${pts} pts`;
      if (tgtEl) tgtEl.textContent = `${targets} · T1 ${v.tier1Count || 0} · overdue ${v.overdueCount || 0}`;
      if (barEl) barEl.style.width = `${pct}%`;
    }

    function calculateLayout(node, x, y, angleStart, angleEnd, radius) {
      node.x = x;
      node.y = y;
      if (!node.children?.length) return;
      const angleRange = angleEnd - angleStart;
      const angleStep = angleRange / node.children.length;
      node.children.forEach((child, i) => {
        const childAngle = angleStart + angleStep * i + angleStep / 2;
        const childRadius = radius * 0.85;
        const cx = x + Math.cos(childAngle) * childRadius;
        const cy = y + Math.sin(childAngle) * childRadius;
        let fan = Math.PI * 0.9;
        if (node.children.length === 1) fan = Math.PI * 1.4;
        calculateLayout(child, cx, cy, childAngle - fan / 2, childAngle + fan / 2, radius * 0.62);
      });
    }

    function flatten(node, parent) {
      node.parent = parent;
      node.color = levelColors[node.level] || '#fff';
      flatNodes.push(node);
      if (parent) {
        const dx = node.x - parent.x;
        const dy = node.y - parent.y;
        flatEdges.push({
          source: parent,
          target: node,
          cx: parent.x + dx / 2 - dy * 0.15,
          cy: parent.y + dy / 2 + dx * 0.15,
        });
      }
      (node.children || []).forEach((c) => flatten(c, node));
    }

    function rebuildGraph(root) {
      const keepId = window.currentNode && window.currentNode.id;
      taxonomyRoot = root;
      flatNodes = [];
      flatEdges = [];
      calculateLayout(root, 0, 0, 0, Math.PI * 2, 420);
      flatten(root, null);
      updateOpsFocusChip(root);
      const keep = keepId ? flatNodes.find((n) => n.id === keepId) : null;
      focusNode(keep || root, false);
    }

    function showLocalModeBanner() {
      const el = document.getElementById('local-mode-banner');
      if (!el) return;
      el.classList.remove('hidden');
      const dismiss = document.getElementById('local-mode-dismiss');
      if (dismiss && !dismiss._bound) {
        dismiss._bound = true;
        dismiss.addEventListener('click', () => el.classList.add('hidden'));
      }
    }

    function enterDemoMode(reason) {
      usingMock = true;
      paintBuildStamp();
      const mode = document.getElementById('mode-label');
      if (mode) mode.textContent = 'DEMO · MOCK DATA';
      document.getElementById('live-dot').className = 'dot warn';
      document.getElementById('session-email').textContent = 'DEMO';
      document.getElementById('data-src').textContent = 'DEMO · mock seed (no live APIs)';
      const auth = document.getElementById('auth-banner');
      if (auth) auth.className = 'banner hidden';
      rebuildGraph(buildTaxonomy(demoBundle()));
      lastPollAt = Date.now();
      logTrace(`DEMO MODE: ${reason}`, false);
      updatePollAge();
    }

    async function loadLive() {
      paintBuildStamp();
      if (!canUseLiveApis) {
        showLocalModeBanner();
        enterDemoMode(
          location.protocol === 'file:'
            ? 'opened via file://'
            : `host ${location.hostname || 'none'} is not ${ALERT_HOST}`,
        );
        return;
      }
      document.getElementById('live-dot').className = 'dot warn';
      document.getElementById('data-src').textContent = 'fetching…';
      try {
        const me = await apiGet(API.me);
        const email = me.email || null;
        document.getElementById('session-email').textContent = email || 'not signed in';
        if (!email) {
          document.getElementById('auth-banner').className = 'banner';
          document.getElementById('auth-banner').innerHTML =
            'Sign in required for live Alert data. <a href="/login">Open login</a> then return here.';
          throw Object.assign(new Error('No session'), { code: 401 });
        }
        document.getElementById('auth-banner').className = 'banner hidden';

        const [
          machinesPayload,
          snapshot,
          sales,
          summary,
          lastTxPayload,
          liveDash,
          downtime,
          profiles,
          owners,
          credits,
        ] = await Promise.all([
          apiGet(API.machines),
          apiGet(API.snapshot),
          apiGet(API.salesElapsed).catch((e) => {
            logTrace(`sales-elapsed: ${e.message}`, false);
            return {};
          }),
          apiGet(API.salesSummary).catch((e) => {
            logTrace(`sales-summary: ${e.message}`, false);
            return {};
          }),
          apiGet(API.lastTx).catch((e) => {
            logTrace(`last-tx: ${e.message}`, false);
            return {};
          }),
          apiGet(API.liveDash).catch((e) => {
            logTrace(`live-dashboard: ${e.message}`, false);
            return {};
          }),
          apiGet(API.downtime).catch((e) => {
            logTrace(`downtime: ${e.message}`, false);
            return {};
          }),
          apiGet(API.adminProfiles).catch(() => ({})),
          apiGet(API.areaOwners).catch(() => ({})),
          apiGet(API.creditsTotals).catch((e) => {
            logTrace(`remote-credits: ${e.message}`, false);
            return {};
          }),
        ]);

        const machines = machinesPayload.machines || [];
        const ids = machines.map((m) => String(m.id));
        const [attendanceById, cleaningById, techById] = await Promise.all([
          fetchAttendanceMap(ids),
          fetchCleaningMap(ids),
          fetchTechIssuesMap(ids),
        ]);

        const profilesById = {};
        for (const row of profiles.rows || profiles.profiles || []) {
          const id = String(row.machine_id || row.machineId || '').trim();
          if (id) profilesById[id] = row;
        }
        // admin-profiles shape: { byMachineId: { id: { location_owner, ... }}}
        if (profiles.byMachineId) {
          Object.assign(profilesById, profiles.byMachineId);
        }

        liveBundle = {
          machines,
          snapshotRows: snapshot.rows || [],
          salesById: sales.byMachineId || {},
          summaryById: summary.byMachineId || {},
          profilesById,
          areaOwnerById: owners.byMachineId || {},
          attendanceById,
          cleaningById,
          techById,
          lastTxById: lastTxPayload.byMachineId || {},
          liveById: indexLiveDash(liveDash.machines || []),
          downtimeById: downtime.byMachineId || {},
          creditsById: credits.byMachineId || {},
          fromCache: snapshot.fromCache,
          cacheGeneratedAt: snapshot.cacheGeneratedAt,
        };
        usingMock = false;
        const root = buildTaxonomy(liveBundle);
        rebuildGraph(root);
        lastPollAt = Date.now();
        document.getElementById('live-dot').className = 'dot';
        document.getElementById('data-src').textContent =
          `live · ${machines.length} machines · cache ${snapshot.fromCache ? 'HIT' : 'MISS'}`;
        logTrace(
          `INGEST: machines=${machines.length} snap=${(snapshot.rows || []).length} live=${(liveDash.machines || []).length} att=${Object.keys(attendanceById).length} tech=${Object.keys(techById).length}`,
        );
      } catch (e) {
        document.getElementById('live-dot').className = 'dot err';
        document.getElementById('data-src').textContent = `fallback · ${e.message}`;
        if (e.code === 401) {
          document.getElementById('auth-banner').className = 'banner';
          document.getElementById('auth-banner').innerHTML =
            'Session cookie missing. Open <a href="/login">/login</a> on alert.theleetclub.com, then reload this HUD.';
        }
        logTrace(`LIVE FAIL: ${e.message} — using demo seed`, false);
        usingMock = true;
        rebuildGraph(buildTaxonomy(demoBundle()));
      }
      updatePollAge();
    }

    function demoBundle() {
      return {
        machines: [
          { id: 'demo-ku1', name: 'KU-1 COBA Shadadiya', vendon_location_owner: 'KU' },
          { id: 'demo-mew', name: 'MEW Zahra', vendon_location_owner: 'MOH' },
          { id: 'demo-jg2', name: 'Jaber Gate 2', vendon_location_owner: 'MOH' },
          { id: 'demo-jg6', name: 'Jaber Gate 6', vendon_location_owner: 'MOH' },
        ],
        snapshotRows: [
          {
            machineId: 'demo-ku1',
            machineName: 'KU-1 COBA Shadadiya',
            machineLocation: 'Shadadiya',
            cleaningOverdue15h: false,
            hoursSinceCleaning: 4.2,
            reasons: [],
            operator: 'Demo Op',
            lastTransactionAtUtc: new Date().toISOString(),
          },
          {
            machineId: 'demo-jg6',
            machineName: 'Jaber Gate 6',
            machineLocation: 'Zahra',
            cleaningOverdue15h: true,
            hoursSinceCleaning: 18.5,
            reasons: ['NO_RECENT_SALE', 'LOW_SALES'],
            alertPriorityTier: 1,
            operator: 'Demo Op 2',
            lastTransactionAtUtc: new Date(Date.now() - 3600e3 * 20).toISOString(),
          },
        ],
        salesById: {
          'demo-ku1': { todayKwd: 245.5, yesterdaySameElapsedKwd: 210.0 },
          'demo-mew': { todayKwd: 180.25, yesterdaySameElapsedKwd: 165 },
          'demo-jg2': { todayKwd: 95.0, yesterdaySameElapsedKwd: 110 },
          'demo-jg6': { todayKwd: 12.0, yesterdaySameElapsedKwd: 40 },
        },
        summaryById: {
          'demo-ku1': {
            aSalesKwd: 245.5,
            bSalesKwd: 210,
            aTx: 120,
            bTx: 98,
            trendPct: 16.9,
            topProducts: [
              { name: 'Spanish Latte', count: 84 },
              { name: 'Cappuccino', count: 61 },
              { name: 'Americano', count: 44 },
              { name: 'Flat White', count: 30 },
              { name: 'Espresso', count: 22 },
            ],
          },
        },
        profilesById: {
          'demo-ku1': { location_owner: 'KU', location_hours: '07:00-22:00', inactiveToday: false },
          'demo-jg6': { location_owner: 'MOH', location_hours: '24h', inactiveToday: false },
        },
        areaOwnerById: {
          'demo-ku1': { name: 'Area Lead A' },
          'demo-jg6': { name: 'Area Lead B' },
        },
        attendanceById: {
          'demo-ku1': { operatorName: 'Ahmed', operatorEmail: 'ahmed@example.com' },
          'demo-jg6': { operatorName: 'Sara', operatorEmail: 'sara@example.com' },
        },
        creditsById: {
          'demo-jg6': { credits_sent: 3, dispense_tests: 1, total_kd: 1.5 },
        },
      };
    }

    function resolveDetail(node) {
      if (!node) return null;
      if (node.detail) return node.detail;
      let n = node;
      while (n && !n.detail) n = n.parent;
      return n?.detail || null;
    }

    function kvClass(key, val) {
      const s = String(val ?? '').toUpperCase();
      const k = String(key || '').toLowerCase();
      if (
        s.includes('OVERDUE') ||
        s === 'INACTIVE' ||
        s.includes('FLAGGED') ||
        (k.includes('tier') && (s === '1' || s === 'T1')) ||
        (k.includes('flag') && s !== 'NONE' && s !== '0' && s !== '—')
      ) {
        return 'crit';
      }
      if (
        k.includes('today') &&
        /[\d.]+/.test(s) &&
        Number.parseFloat(s) < 20 &&
        Number.parseFloat(s) >= 0
      ) {
        return 'warn';
      }
      if (s === '—' || s.includes('NOT IN API') || s.includes('NOT IN ALERT')) return 'mute';
      return '';
    }

    function detailRowsFor(node) {
      const level = node.level;
      const v = resolveVitals(node) || {};
      const d = resolveDetail(node) || {};
      const rows = [];
      const push = (k, val, forceClass) => {
        rows.push({ k, v: val == null || val === '' ? '—' : String(val), cls: forceClass || kvClass(k, val) });
      };

      if (level === 'region' || level === 'brand' || level === 'area' || level === 'root') {
        const kids =
          level === 'area'
            ? node.children || []
            : level === 'brand' || level === 'region'
              ? (node.children || []).flatMap((c) =>
                  c.level === 'area' ? c.children || [] : c.level === 'machine' ? [c] : [],
                )
              : [];
        const machines =
          level === 'root'
            ? flatNodes.filter((n) => n.level === 'machine')
            : level === 'area'
              ? kids
              : kids.length
                ? kids
                : flatNodes.filter((n) => n.level === 'machine' && (level !== 'brand' || true));
        const list =
          level === 'area'
            ? node.children || []
            : level === 'brand' && node.id === 'brand-leet'
              ? flatNodes.filter((n) => n.level === 'machine')
              : level === 'region' || level === 'root'
                ? flatNodes.filter((n) => n.level === 'machine')
                : [];
        const problems = d.problems || topProblemNames(list, 3);
        push('machines', d.machineCount ?? v.machineCount ?? list.length);
        push('flagged', d.flaggedCount ?? v.flaggedCount ?? 0, (d.flaggedCount || v.flaggedCount) ? 'crit' : '');
        push('cleaning_overdue', d.overdueCount ?? v.overdueCount ?? 0, (d.overdueCount || v.overdueCount) ? 'crit' : '');
        push('sum_today_kd', fmtKwd(d.todayKd ?? v.todayKd));
        push('tier1_count', v.tier1Count ?? 0, v.tier1Count ? 'crit' : '');
        push('attention_pts', v.attentionPts ?? 0);
        problems.forEach((name, i) => push(`problem_${i + 1}`, name, 'warn'));
        if (!problems.length) push('top_problems', 'none');
        return rows;
      }


      if (level === 'machine' || (node.machineId && (level === 'facet' || level === 'revenueDetail' || level === 'salesDetail'))) {
        const reasons = d.reasons || v.flagLabels || [];
        const liveCodes = d.liveCodes || [];
        const sec = (title) => rows.push({ k: `__SEC__${title}`, v: '', cls: 'sec' });

        if (level === 'machine') {
          sec('VENDON STATUS');
          push('today_kd', fmtKwd(d.todayKd ?? v.todayKd));
          push('yest_same_clock', fmtKwd(d.yestKd ?? v.yestKd));
          push('tier', d.tier != null ? d.tier : v.tier != null ? v.tier : '—', (d.tier === 1 || v.tier === 1) ? 'crit' : '');
          push('reasons', reasons.length ? reasons.join(' | ') : 'none', reasons.length ? 'crit' : '');
          push('live_codes', liveCodes.length ? liveCodes.join(' | ') : 'none', liveCodes.length ? 'crit' : '');
          push('sale_age', fmtSaleAge(d.saleAgeMinutes), Number(d.saleAgeMinutes) > 60 ? 'warn' : '');
          push('maintenance', d.maintenanceStatus || '—', d.maintenanceStatus === 'overdue' ? 'crit' : '');
          push('shift_late', d.shiftLate ? 'LATE / missing clock-in' : 'ok', d.shiftLate ? 'crit' : '');
          push('last_tx', fmtLastTx(d.lastTx ?? v.lastTx));
          if (d.lastTxProduct) push('last_tx_product', d.lastTxProduct);
          if (d.lastTxAmount != null) push('last_tx_amount', d.lastTxAmount);
          push('downtime_today', fmtDowntimeSec(d.downtimeTodaySec), Number(d.downtimeTodaySec) > 0 ? 'warn' : '');
          push(
            'cleaning_overdue_15h',
            (d.cleaningOverdue ?? v.cleaningOverdue) ? 'OVERDUE' : 'ok',
            (d.cleaningOverdue ?? v.cleaningOverdue) ? 'crit' : '',
          );
          push('hours_since_cleaning', fmtHours(d.hoursSinceCleaning ?? v.hoursSinceCleaning));

          sec('WORKFLOW');
          push('scheduled_operator', d.operator ?? v.operator);
          push('operator_email', d.operatorEmail ?? v.operatorEmail ?? node.operatorEmail);
          push('attendance', d.attendanceStatus || d.attendancePill || '—');
          push('attendance_state', d.attendanceState || '—');
          push(
            'open_tech_issues',
            d.techActiveCount != null ? d.techActiveCount : '—',
            Number(d.techActiveCount) > 0 ? 'crit' : '',
          );
          push('latest_tech', d.techLatest || '—', d.techLatest ? 'warn' : 'mute');
          push('wf_last_clean', fmtLastTx(d.wfLastCleaningAt), 'mute');
          push('wf_clean_source', d.wfCleaningSource || '—', 'mute');
          if (d.wfHighRisk) push('wf_high_risk', 'YES', 'crit');
          push('area_owner', d.areaOwner ?? v.areaOwner);

          sec('REVENUE');
          push('a_sales_kwd', fmtKwd(d.aSalesKwd));
          push('b_sales_kwd', fmtKwd(d.bSalesKwd));
          push('a_tx / b_tx', `${d.aTx ?? '—'} / ${d.bTx ?? '—'}`);
          push('trend_pct', d.trendPct != null ? `${Number(d.trendPct).toFixed(1)}%` : '—');
          push('peak_hour', peakHourLabel(d.peakHour));
          push('distinct_drinks', d.distinctDrinks != null ? d.distinctDrinks : '—');
          (d.tops || []).slice(0, 5).forEach((p, i) =>
            push(`top_${i + 1}`, `${p.name || '?'} ×${p.count ?? '—'}`),
          );
          if (!(d.tops || []).length) push('top_products', 'none in vendon-sales-summary', 'mute');
          if (node.machineId) push('vendon_id', node.machineId, 'mute');
          return rows;
        }

        push('today_kd', fmtKwd(d.todayKd ?? v.todayKd));
        push('yest_same_clock', fmtKwd(d.yestKd ?? v.yestKd));
        push('operator', d.operator ?? v.operator);
        push('operator_email', d.operatorEmail ?? v.operatorEmail ?? node.operatorEmail);
        push('reasons', reasons.length ? reasons.join(' | ') : 'none', reasons.length ? 'crit' : '');
        push('live_codes', liveCodes.length ? liveCodes.join(' | ') : 'none', liveCodes.length ? 'crit' : '');
        push(
          'cleaning_overdue_15h',
          (d.cleaningOverdue ?? v.cleaningOverdue) ? 'OVERDUE' : 'ok',
          (d.cleaningOverdue ?? v.cleaningOverdue) ? 'crit' : '',
        );
        push('hours_since_cleaning', fmtHours(d.hoursSinceCleaning ?? v.hoursSinceCleaning));
        push('tier', d.tier != null ? d.tier : v.tier != null ? v.tier : '—', (d.tier === 1 || v.tier === 1) ? 'crit' : '');
        push('last_tx', fmtLastTx(d.lastTx ?? v.lastTx));
        push('area_owner', d.areaOwner ?? v.areaOwner);

        if (level === 'facet' && /revenue/i.test(node.label)) {
          push('a_sales_kwd', fmtKwd(d.aSalesKwd));
          push('b_sales_kwd', fmtKwd(d.bSalesKwd));
          push('a_tx', d.aTx != null ? d.aTx : '—');
          push('b_tx', d.bTx != null ? d.bTx : '—');
          push('trend_pct', d.trendPct != null ? `${Number(d.trendPct).toFixed(1)}%` : '—');
          (d.tops || []).forEach((p, i) =>
            push(`top_product_${i + 1}`, `${p.name || '?'} ×${p.count ?? '—'}`),
          );
          if (!(d.tops || []).length) push('top_products', 'none in vendon-sales-summary', 'mute');
        }

        if (level === 'revenueDetail' || level === 'salesDetail') {
          push('a_sales_kwd', fmtKwd(d.aSalesKwd));
          push('b_sales_kwd', fmtKwd(d.bSalesKwd));
          push('a_tx / b_tx', `${d.aTx ?? '—'} / ${d.bTx ?? '—'}`);
          push('trend_pct', d.trendPct != null ? `${Number(d.trendPct).toFixed(1)}%` : '—');
          push('distinct_drinks', d.distinctDrinks != null ? d.distinctDrinks : '—');
          push('peak_hour', peakHourLabel(d.peakHour));
          (d.tops || []).slice(0, 5).forEach((p, i) =>
            push(`top_${i + 1}`, `${p.name || '?'} qty=${p.count ?? '—'}`),
          );
        }

        if (level === 'facet' && /stock/i.test(node.label)) {
          if (d.hasCreditsRow) {
            push('credits_sent_today', d.creditsSent);
            push('dispense_tests', d.dispenseTests);
            push('credits_kd', fmtKwd(d.creditKd));
          } else {
            push('credits_tests', 'not in API (no remote-credit events today)', 'mute');
          }
          push('ingredient_stock', 'not in Alert API', 'mute');
          push('related_flags', reasons.length ? reasons.join(' | ') : 'none', reasons.length ? 'crit' : '');
        }

        if (level === 'facet' && /contract/i.test(node.label)) {
          push('location_hours', d.locationHours ?? v.locationHours);
          push('location_owner', d.locationOwner ?? v.locationOwner);
          push('area_owner', d.areaOwner ?? v.areaOwner);
          push(
            'inactive',
            d.inactive ? d.inactiveLabel || 'INACTIVE' : 'active',
            d.inactive ? 'crit' : '',
          );
        }

        if (node.machineId) push('vendon_id', node.machineId, 'mute');
        return rows;
      }

      Object.entries(node.metrics || {}).forEach(([k, val]) => push(k, val));
      return rows;
    }

    function tooltipLines(node) {
      const v = resolveVitals(node) || {};
      const d = resolveDetail(node) || {};
      const lines = [];
      const add = (k, val, cls) => lines.push({ k, v: String(val ?? '—'), cls: cls || '' });

      if (node.level === 'region' || node.level === 'brand' || node.level === 'area' || node.level === 'root') {
        add('machines', d.machineCount ?? v.machineCount ?? '—');
        add('flagged', d.flaggedCount ?? v.flaggedCount ?? 0, (d.flaggedCount || v.flaggedCount) ? 'crit' : '');
        add('overdue', d.overdueCount ?? v.overdueCount ?? 0, (d.overdueCount || v.overdueCount) ? 'crit' : '');
        add('today KD', fmtKwd(d.todayKd ?? v.todayKd));
        const p0 = (d.problems && d.problems[0]) || null;
        if (p0) add('top issue', p0, 'warn');
        return lines.slice(0, 5);
      }

      add('today KD', fmtKwd(d.todayKd ?? v.todayKd), Number(d.todayKd ?? v.todayKd) < 20 ? 'warn' : '');
      add('yest clock', fmtKwd(d.yestKd ?? v.yestKd));
      add('operator', d.operator ?? v.operator ?? '—');
      if (d.cleaningOverdue || v.cleaningOverdue) add('cleaning', 'OVERDUE', 'crit');
      else if ((d.reasons || []).length || (v.flags || 0) > 0) {
        add('flags', (d.reasons || v.flagLabels || []).slice(0, 2).join(', ') || v.flags, 'crit');
      } else {
        add('tier', d.tier != null ? `T${d.tier}` : v.tier != null ? `T${v.tier}` : '—');
      }
      if (node.level === 'facet' && /stock/i.test(node.label)) {
        add(
          'credits',
          d.hasCreditsRow ? `${d.creditsSent} sent / ${d.dispenseTests} tests` : 'not in API',
          d.hasCreditsRow ? '' : 'mute',
        );
      }
      if (node.level === 'facet' && /contract/i.test(node.label)) {
        add('hours', d.locationHours || '—');
        add('inactive', d.inactive ? d.inactiveLabel || 'yes' : 'no', d.inactive ? 'crit' : '');
      }
      return lines.slice(0, 5);
    }

    function showTooltip(node, clientX, clientY) {
      const el = document.getElementById('node-tooltip');
      if (!node || !el) {
        if (el) el.className = 'hidden';
        return;
      }
      const lines = tooltipLines(node);
      el.innerHTML =
        `<div class="tt-title" style="color:${node.color || '#fff'}">${node.label}</div>` +
        lines
          .map(
            (r) =>
              `<div class="tt-row ${r.cls || ''}"><span>${r.k}</span><b>${r.v}</b></div>`,
          )
          .join('');
      el.className = '';
      const pad = 14;
      let left = clientX + pad;
      let top = clientY + pad;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) left = clientX - rect.width - pad;
      if (rect.bottom > window.innerHeight - 8) top = clientY - rect.height - pad;
      el.style.left = `${Math.max(8, left)}px`;
      el.style.top = `${Math.max(8, top)}px`;
    }

    function hideTooltip() {
      const el = document.getElementById('node-tooltip');
      if (el) el.className = 'hidden';
    }

    function updateHUD(node) {
      const path = [];
      let curr = node;
      while (curr) {
        path.unshift(curr);
        curr = curr.parent;
      }
      document.getElementById('breadcrumb').innerHTML = path
        .map(
          (n) =>
            `<span class="bc-link" data-id="${n.id}" style="color:${n.color}">${n.label}</span>`,
        )
        .join(' <span style="color:#555">/</span> ');

      const v = resolveVitals(node);
      const focusPts = v ? Number(v.attentionPts) || 0 : 0;
      const metricsHtml = Object.entries(node.metrics || {})
        .map(
          ([k, val]) =>
            `<div><span class="lbl">${k}</span> <span class="val">${val}</span></div>`,
        )
        .join('');
      const detailRows = detailRowsFor(node);
      const detailHtml = detailRows
        .map((r) => {
          if (String(r.k || '').startsWith('__SEC__')) {
            const title = String(r.k).slice(7);
            return `<div class="sec">${title}</div>`;
          }
          return `<div class="kv ${r.cls || ''}"><span class="k">${r.k}</span><span class="v">${r.v}</span></div>`;
        })
        .join('');
      document.getElementById('info-panel').innerHTML = `
        <h3 style="color:${node.color}">${node.label}</h3>
        <div class="badge-row">
          <span class="badge" style="border-color:${node.color}">${node.level.toUpperCase()}</span>
          ${
            focusPts
              ? `<span class="badge" style="border-color:var(--teal);color:var(--teal)">FOCUS +${focusPts}</span>`
              : ''
          }
          ${
            node.machineId
              ? `<span class="badge" style="border-color:#8ea3bf;color:#8ea3bf">#${node.machineId}</span>`
              : ''
          }
        </div>
        ${vitalsPanelHtml(node)}
        <div class="metrics">${metricsHtml || '<span class="lbl">No metrics</span>'}</div>
        <div class="detail-drawer">
          <div class="dh">DETAIL · ${node.level.toUpperCase()}</div>
          ${detailHtml || '<div class="kv mute"><span class="k">—</span><span class="v">no detail</span></div>'}
        </div>
      `;
    }

    async function enrichFocusedMachine(node) {
      if (!canUseLiveApis || usingMock || !node?.machineId || node.level !== 'machine') return;
      const mid = String(node.machineId);
      try {
        const [sched, tech] = await Promise.all([
          apiGet(API.operatorSchedule(mid)).catch(() => null),
          apiGet(API.techIssues(mid)).catch(() => null),
        ]);
        if (!node.detail) node.detail = {};
        if (sched) {
          if (sched.operatorName) {
            node.detail.operator = sched.operatorName;
            if (node.vitals) node.vitals.operator = sched.operatorName;
            node.metrics = { ...(node.metrics || {}), Operator: sched.operatorName };
          }
          if (sched.operatorEmail) {
            node.detail.operatorEmail = sched.operatorEmail;
            node.operatorEmail = sched.operatorEmail;
          }
          if (sched.attendanceStatusLabel || sched.attendanceStatus) {
            node.detail.attendanceStatus = sched.attendanceStatusLabel || sched.attendanceStatus;
          }
          if (sched.state) node.detail.attendanceState = sched.state;
          if (sched.present != null) {
            node.detail.attendancePill = sched.present ? 'present' : 'absent';
          }
        }
        if (tech) {
          node.detail.techActiveCount =
            tech.activeCount != null
              ? Number(tech.activeCount)
              : Array.isArray(tech.issues)
                ? tech.issues.length
                : node.detail.techActiveCount;
          node.detail.techLatest =
            tech.latest?.statusLabel ||
            tech.latest?.status ||
            tech.latest?.description ||
            node.detail.techLatest;
        }
        if (window.currentNode === node) updateHUD(node);
        logTrace(`FOCUS enrich #${mid}: op=${node.detail.operator || '—'} tech=${node.detail.techActiveCount ?? '—'}`);
      } catch (e) {
        logTrace(`FOCUS enrich fail: ${e.message}`, false);
      }
    }

    function focusNode(node, animate = true) {
      window.currentNode = node;
      const scales = {
        root: 0.55,
        region: 0.9,
        brand: 1.5,
        area: 2.6,
        machine: 4.2,
        facet: 6.5,
        revenueDetail: 9,
        salesDetail: 12,
      };
      const s = scales[node.level] || 1;
      const next = {
        x: width / 2 - node.x * s,
        y: height / 2 - node.y * s,
        scale: s,
      };
      if (animate) targetTransform = next;
      else {
        currentTransform = { ...next };
        targetTransform = { ...next };
      }
      updateHUD(node);
      enrichFocusedMachine(node);
    }

    const stars = Array.from({ length: 500 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2,
      a: Math.random() * 0.5 + 0.1,
    }));

    function updateSignals() {
      if (Math.random() < 0.22 && flatEdges.length) {
        signals.push({
          edge: flatEdges[Math.floor(Math.random() * flatEdges.length)],
          progress: 0,
          speed: 0.01 + Math.random() * 0.02,
        });
      }
      signals.forEach((s) => (s.progress += s.speed));
      signals = signals.filter((s) => s.progress < 1);
    }

    function render() {
      currentTransform.x += (targetTransform.x - currentTransform.x) * 0.1;
      currentTransform.y += (targetTransform.y - currentTransform.y) * 0.1;
      currentTransform.scale += (targetTransform.scale - currentTransform.scale) * 0.1;

      ctx.fillStyle = '#010408';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      stars.forEach((s) => {
        ctx.fillStyle = `rgba(255,255,255,${s.a})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      ctx.save();
      ctx.translate(currentTransform.x, currentTransform.y);
      ctx.scale(currentTransform.scale, currentTransform.scale);

      ctx.lineWidth = 1.4 / currentTransform.scale;
      flatEdges.forEach((e) => {
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.quadraticCurveTo(e.cx, e.cy, e.target.x, e.target.y);
        ctx.strokeStyle = `${e.target.color}55`;
        ctx.stroke();
      });

      signals.forEach((s) => {
        const e = s.edge;
        const t = s.progress;
        const bx =
          Math.pow(1 - t, 2) * e.source.x +
          2 * (1 - t) * t * e.cx +
          Math.pow(t, 2) * e.target.x;
        const by =
          Math.pow(1 - t, 2) * e.source.y +
          2 * (1 - t) * t * e.cy +
          Math.pow(t, 2) * e.target.y;
        ctx.beginPath();
        ctx.arc(bx, by, 3 / currentTransform.scale, 0, Math.PI * 2);
        ctx.fillStyle = e.target.color;
        ctx.shadowColor = e.target.color;
        ctx.shadowBlur = 10 / currentTransform.scale;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      flatNodes.forEach((n) => {
        const base = n === window.currentNode ? 11 : 7;
        const r = base / currentTransform.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = (n === window.currentNode ? 22 : 8) / currentTransform.scale;
        ctx.fill();
        ctx.shadowBlur = 0;

        const show =
          currentTransform.scale > 2 ||
          ['root', 'region', 'brand'].includes(n.level) ||
          (currentTransform.scale > 0.9 && n.level === 'area');
        if (show) {
          ctx.fillStyle = '#e2eeff';
          ctx.font = `${12 / currentTransform.scale}px monospace`;
          ctx.textBaseline = 'middle';
          ctx.fillText(n.label, n.x + r + 4 / currentTransform.scale, n.y);
        }
      });

      ctx.restore();
      updateSignals();
      requestAnimationFrame(render);
    }

    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let hover = null;

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastMouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        targetTransform.x += e.clientX - lastMouse.x;
        targetTransform.y += e.clientY - lastMouse.y;
        lastMouse = { x: e.clientX, y: e.clientY };
        return;
      }
      const mx = (e.clientX - currentTransform.x) / currentTransform.scale;
      const my = (e.clientY - currentTransform.y) / currentTransform.scale;
      let closest = null;
      let min = 16 / currentTransform.scale;
      for (const n of flatNodes) {
        const d = Math.hypot(n.x - mx, n.y - my);
        if (d < min) {
          min = d;
          closest = n;
        }
      }
      hover = closest;
      canvas.style.cursor = hover ? 'pointer' : 'default';
      if (hover) showTooltip(hover, e.clientX, e.clientY);
      else hideTooltip();
    });
    canvas.addEventListener('mouseup', () => (isDragging = false));
    canvas.addEventListener('mouseleave', () => {
      isDragging = false;
      hideTooltip();
    });
    canvas.addEventListener('click', () => {
      if (hover) focusNode(hover);
    });
    canvas.addEventListener('dblclick', () => {
      if (taxonomyRoot) focusNode(taxonomyRoot);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const zoom = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const mx = e.clientX;
        const my = e.clientY;
        const wx = (mx - targetTransform.x) / targetTransform.scale;
        const wy = (my - targetTransform.y) / targetTransform.scale;
        targetTransform.scale = Math.min(40, Math.max(0.2, targetTransform.scale * zoom));
        targetTransform.x = mx - wx * targetTransform.scale;
        targetTransform.y = my - wy * targetTransform.scale;
      },
      { passive: false },
    );

    document.getElementById('breadcrumb').addEventListener('click', (e) => {
      if (!e.target.classList.contains('bc-link')) return;
      const id = e.target.getAttribute('data-id');
      const node = flatNodes.find((n) => n.id === id);
      if (node) focusNode(node);
    });

    function nearestMachineContext() {
      let n = window.currentNode;
      while (n && !n.machineId) n = n.parent;
      return n;
    }

    function openTaskModal() {
      const ctxNode = nearestMachineContext() || window.currentNode;
      document.getElementById('task-context').textContent = ctxNode
        ? `TARGET: ${ctxNode.label} (${ctxNode.level})${ctxNode.machineId ? ` · #${ctxNode.machineId}` : ''}`
        : 'TARGET: —';
      if (ctxNode?.operatorEmail) {
        document.getElementById('task-recipient').value = ctxNode.operatorEmail;
      }
      if (ctxNode?.machineName) {
        document.getElementById('task-text').value =
          `Follow-up on ${ctxNode.machineName} from Constellation HUD`;
      }
      document.getElementById('task-modal').classList.remove('hidden');
    }
    function closeTaskModal() {
      document.getElementById('task-modal').classList.add('hidden');
    }

    async function submitTask() {
      const ctxNode = nearestMachineContext();
      if (!ctxNode?.machineId) {
        alert('Zoom into a machine (or a facet under a machine) before dispatching to Workflow.');
        return;
      }
      if (usingMock) {
        alert('Demo mode — sign in on alert.theleetclub.com to send real Workflow tasks.');
        return;
      }
      const action = document.getElementById('task-action').value;
      const message = document.getElementById('task-text').value.trim();
      const errorType = document.getElementById('task-error-type').value.trim() || 'Ops follow-up';
      const recipient = document.getElementById('task-recipient').value.trim();
      if (!message) {
        alert('Message required');
        return;
      }
      const btn = document.getElementById('task-submit');
      btn.disabled = true;
      try {
        let result;
        if (action === 'go-check') {
          result = await apiPost(API.goCheck, {
            machineId: ctxNode.machineId,
            machineName: ctxNode.machineName || ctxNode.label,
            errorType,
            message,
          });
        } else if (action === 'dm') {
          result = await apiPost(API.dm, {
            machineId: ctxNode.machineId,
            operatorEmail: recipient || undefined,
            message,
          });
        } else {
          result = await apiPost(API.cleaning, {
            machineId: ctxNode.machineId,
            message,
          });
        }
        logTrace(
          `WORKFLOW ${action}: ok=${result.ok} delivery=${result.delivery || '—'} taskId=${result.taskId || '—'}`,
          !!result.ok,
        );
        alert(
          result.ok
            ? `Sent via ${result.delivery || 'Workflow'}${result.note ? `\n${result.note}` : ''}`
            : `Failed: ${result.error || result.note || 'unknown'}`,
        );
        if (result.ok) closeTaskModal();
      } catch (e) {
        logTrace(`WORKFLOW FAIL: ${e.message}`, false);
        alert(`Workflow error: ${e.message}`);
      } finally {
        btn.disabled = false;
      }
    }

    function refreshLive() {
      loadLive();
    }

    function updatePollAge() {
      const el = document.getElementById('poll-age');
      if (!lastPollAt) {
        el.textContent = '—';
        return;
      }
      const sec = Math.round((Date.now() - lastPollAt) / 1000);
      el.textContent = `${sec}s ago`;
    }

    function wireUi() {
      const btnRefresh = document.getElementById("btn-refresh");
      const btnAssign = document.getElementById("btn-assign");
      const taskSubmit = document.getElementById("task-submit");
      const taskCancel = document.getElementById("task-cancel");
      if (btnRefresh) btnRefresh.addEventListener("click", refreshLive);
      if (btnAssign) btnAssign.addEventListener("click", openTaskModal);
      if (taskSubmit) taskSubmit.addEventListener("click", submitTask);
      if (taskCancel) taskCancel.addEventListener("click", closeTaskModal);
    }

    function boot() {
      wireUi();
      paintBuildStamp();
      requestAnimationFrame(render);
      if (!canUseLiveApis) {
        showLocalModeBanner();
        enterDemoMode(
          location.protocol === 'file:'
            ? 'opened via file://'
            : `host ${location.hostname || 'none'} is not ${ALERT_HOST}`,
        );
        setInterval(updatePollAge, 1000);
        return;
      }
      loadLive();
      setInterval(loadLive, POLL_MS);
      setInterval(updatePollAge, 1000);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  
