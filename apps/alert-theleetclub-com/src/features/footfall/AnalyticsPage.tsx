import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  csvExportUrl,
  fetchReport,
  readSessionReport,
  reloadAllCaches,
  writeSessionReport,
} from '@/features/footfall/lib/api';
import type { LocationReport, OwnerSegment, ReportPayload, ReportQuery } from '@/features/footfall/lib/types';
import { cameraFootfallTotal, displayFootfallTotal, isEstimatedFootfall } from '@/features/footfall/lib/footfallMetrics';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import {
  WINDOW_KU_JUL,
  WINDOW_MOH_O2_MAY,
  defaultWindowForSegment,
  type ReportWindow,
  type SegmentId,
} from '@/features/footfall/lib/segments';
import { applyUniqueFootfallToLocation, stripCompare } from '@/features/footfall/lib/uniqueFootfall';
import { applyRawCameraFootfall } from '@/features/footfall/lib/rawCameraFootfall';
import { useFootfallViewMode } from '@/features/footfall/FootfallViewMode';
import {
  footfallKpiCopy,
  footfallPerDayAverage,
  footfallPeriodTotal,
} from '@/features/footfall/lib/footfallKpiDisplay';
import {
  footfallPerDayLabel,
  footfallSidebarTag,
  isMirroredFootfall,
} from '@/features/footfall/lib/footfallLabel';
import { HourlyChart } from '@/features/footfall/components/HourlyChart';
import { MetricsTable } from '@/features/footfall/components/MetricsTable';
import { FleetPanel } from '@/features/footfall/components/FleetPanel';
import { DayComparisonTable } from '@/features/footfall/components/DayComparisonTable';
import { ComparisonCharts } from '@/features/footfall/components/ComparisonCharts';
import { DataQualityBanner } from '@/features/footfall/components/DataQualityBanner';
import { InsightsProjectionsPanel } from '@/features/footfall/components/InsightsProjectionsPanel';
import { hasHourlyNetTraffic, hasPeriodNetTraffic, NetTrafficChart } from '@/features/footfall/components/NetTrafficChart';
import { DetailSection } from '@/features/footfall/components/DetailSection';
import { SectionFlyBar, type FlySection } from '@/features/footfall/components/SectionFlyBar';
import { TermLabel } from '@/features/footfall/lib/termHighlight';
import { FleetHeatmap } from '@/features/footfall/components/FleetHeatmap';
import { NET_TRAFFIC_KPI_HINT, NET_TRAFFIC_LABEL } from '@/features/footfall/lib/netTrafficCopy';
import {
  isProxySales,
  salesCupsLabel,
  salesDisplayFor,
  salesMetricColor,
} from '@/features/footfall/lib/salesDisplay';
import { SegmentTabs } from '@/features/footfall/components/SegmentTabs';
import { UniqueFootfallExplainer } from '@/features/footfall/components/UniqueFootfallExplainer';

function toQuery(w: ReportWindow): ReportQuery {
  return {
    startDate: w.startDate,
    endDate: w.endDate,
    enableCompare: false,
  };
}

export function AnalyticsPage() {
  const qc = useQueryClient();
  const viewMode = useFootfallViewMode();
  const [segmentId, setSegmentId] = useState<SegmentId>('ALL');
  const [kuWindowId] = useState<string>(WINDOW_KU_JUL.id);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState('');
  const refreshNext = useRef(false);

  const kuWindow = WINDOW_KU_JUL;

  const windowsNeeded = useMemo<ReportWindow[]>(() => {
    if (segmentId === 'KU') return [kuWindow];
    if (segmentId === 'MOH' || segmentId === 'O2') return [WINDOW_MOH_O2_MAY];
    return [kuWindow, WINDOW_MOH_O2_MAY];
  }, [segmentId, kuWindow]);

  const reportQueries = useQueries({
    queries: windowsNeeded.map((w) => {
      const q = toQuery(w);
      return {
        queryKey: ['targets-report', w.id],
        queryFn: async () => {
          const data = await fetchReport(q, refreshNext.current, setLoadStatus);
          writeSessionReport(q, data);
          setLoadStatus('');
          return data;
        },
        initialData: () => readSessionReport(q),
        staleTime: 30 * 60 * 1000,
        gcTime: 6 * 3600 * 1000,
        retry: false,
      };
    }),
  });

  const loading = reportQueries.some((q) => q.isLoading && !q.data);
  const fetching = reportQueries.some((q) => q.isFetching);
  const error = reportQueries.find((q) => q.error)?.error as Error | undefined;
  const refreshNeeded = refreshNext.current;
  useEffect(() => {
    if (!fetching) refreshNext.current = false;
  }, [fetching]);

  /** Merge reports + apply unique-footfall transform to every location. */
  const merged = useMemo<{
    primaryWindow: ReportWindow;
    benchmark: number;
    generatedAt: string;
    locations: LocationReport[];
    rawByMachineId: Record<string, LocationReport>;
  } | null>(() => {
    if (loading) return null;
    const payloads: { window: ReportWindow; payload: ReportPayload }[] = [];
    reportQueries.forEach((q, idx) => {
      if (q.data) payloads.push({ window: windowsNeeded[idx], payload: q.data });
    });
    if (payloads.length === 0) return null;

    const benchmark =
      payloads.find((p) => p.payload.benchmarkConversionPct != null)?.payload.benchmarkConversionPct ?? 6.2;
    const generatedAt = payloads
      .map((p) => p.payload.generatedAt)
      .sort()
      .at(-1)!;

    const seen = new Set<string>();
    const out: LocationReport[] = [];
    const raw: Record<string, LocationReport> = {};

    for (const item of payloads) {
      const win = item.window;
      const owners: OwnerSegment[] =
        win.id === WINDOW_MOH_O2_MAY.id ? ['MOH', 'O2'] : ['KU'];
      for (const loc of item.payload.locations) {
        const owner = inferOwnerSegment(loc);
        if (!owners.includes(owner)) continue;
        if (segmentId === 'KU' && owner !== 'KU') continue;
        if (segmentId === 'MOH' && owner !== 'MOH') continue;
        if (segmentId === 'O2' && owner !== 'O2') continue;
        if (seen.has(loc.machineId)) continue;
        seen.add(loc.machineId);

        const noCompare = stripCompare(loc);
        const transformed =
          viewMode === 'raw'
            ? applyRawCameraFootfall(noCompare)
            : applyUniqueFootfallToLocation(noCompare, owner, benchmark);
        transformed.reportWindowShortLabel = win.shortLabel;
        out.push(transformed);
        raw[loc.machineId] = loc;
      }
    }

    // Sort by raw camera footfall (highest exposure first), tie-break on display footfall
    out.sort(
      (a, b) =>
        cameraFootfallTotal(b) - cameraFootfallTotal(a) ||
        displayFootfallTotal(b) - displayFootfallTotal(a),
    );

    return {
      primaryWindow: defaultWindowForSegment(segmentId, kuWindowId),
      benchmark,
      generatedAt,
      locations: out,
      rawByMachineId: raw,
    };
  }, [loading, reportQueries, windowsNeeded, segmentId, kuWindowId, viewMode]);

  /** Synthetic ReportPayload that the existing components consume. */
  const reportForDetail = useMemo<ReportPayload | null>(() => {
    if (!merged) return null;
    return {
      generatedAt: merged.generatedAt,
      benchmarkConversionPct: merged.benchmark,
      primaryPeriod: [merged.primaryWindow.startDate, merged.primaryWindow.endDate],
      fallbackPeriod: [WINDOW_MOH_O2_MAY.startDate, WINDOW_MOH_O2_MAY.endDate],
      comparePeriod: null,
      currency: 'KD',
      locations: merged.locations,
      // Rankings are rebuilt client-side by FleetPanel from locations.
      rankings: {
        byFootfall: [],
        byProjectedFootfall: [],
        byRevenue: [],
        byConversion: [],
        byMissedPotential: [],
        byRevenuePerVisitor: [],
      },
      locationCount: merged.locations.length,
    };
  }, [merged]);

  /** Filtered list (search). */
  const filtered = useMemo(() => {
    if (!merged) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return merged.locations;
    return merged.locations.filter((l) => {
      const name = l.locationName?.toLowerCase() || '';
      const owner = (l.locationOwner || '').toLowerCase();
      return name.includes(q) || owner.includes(q);
    });
  }, [merged, filter]);

  useEffect(() => {
    if (selectedId && !filtered.some((l) => l.machineId === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const selected: LocationReport | null = useMemo(() => {
    if (!filtered.length) return null;
    const id = selectedId || filtered[0]?.machineId;
    return filtered.find((l) => l.machineId === id) ?? filtered[0];
  }, [filtered, selectedId]);

  const selectedRaw = selected ? merged?.rawByMachineId[selected.machineId] : undefined;
  const selectedSegment: OwnerSegment | undefined = selected ? inferOwnerSegment(selected) : undefined;

  /** Counts per segment (for the tabs). */
  const counts = useMemo<Partial<Record<SegmentId, number>>>(() => {
    const c: Record<OwnerSegment, number> = { KU: 0, MOH: 0, O2: 0, OTHER: 0 };
    reportQueries.forEach((q, idx) => {
      const w = windowsNeeded[idx];
      if (!q.data || !w) return;
      const owners =
        w.id === WINDOW_MOH_O2_MAY.id ? ['MOH', 'O2'] : ['KU'];
      for (const loc of q.data.locations) {
        const own = inferOwnerSegment(loc);
        if (owners.includes(own)) c[own]++;
      }
    });
    return { ALL: c.KU + c.MOH + c.O2, KU: c.KU, MOH: c.MOH, O2: c.O2 };
  }, [reportQueries, windowsNeeded]);

  /** Section nav (no compare section in targets app). */
  const flySections: FlySection[] = useMemo(() => {
    if (!selected) return [];
    const items: FlySection[] = [
      { id: 'detail-top', label: 'KPIs' },
      { id: 'insights', label: 'Insights' },
    ];
    if (hasPeriodNetTraffic(selected) || hasHourlyNetTraffic(selected)) {
      items.push({ id: 'net-traffic', label: 'Net traffic' });
    }
    items.push(
      { id: 'hourly-profile', label: 'Hourly' },
      { id: 'comparison-charts', label: 'Charts' },
      { id: 'daily-breakdown', label: 'Daily' },
      { id: 'metrics-table', label: 'Table' },
    );
    return items;
  }, [selected]);

  const [focusMode, setFocusMode] = useState(false);
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const focusSection = (id: string) => {
    setFocusMode(true);
    setFocusedSection(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 20;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  };
  const sectionFocus = { focusMode, focusedSection };

  /** Rebuild caches (one click for all active windows). */
  const [cacheReloading, setCacheReloading] = useState(false);
  const reloadCaches = async () => {
    setCacheReloading(true);
    try {
      await Promise.all(
        windowsNeeded.map(async (w) => {
          const q = toQuery(w);
          const data = await reloadAllCaches(q, setLoadStatus);
          qc.setQueryData(['targets-report', w.id], data);
          writeSessionReport(q, data);
        }),
      );
    } finally {
      setLoadStatus('');
      setCacheReloading(false);
    }
  };

  const exportLocationCsv = () => {
    if (!selected || !selectedSegment) return;
    const w = selectedSegment === 'KU' ? kuWindow : WINDOW_MOH_O2_MAY;
    window.open(csvExportUrl(toQuery(w), selected.machineId), '_blank', 'noopener');
  };

  const exportAllCsv = () => {
    if (!merged) return;
    windowsNeeded.forEach((w) => {
      window.open(csvExportUrl(toQuery(w)), '_blank', 'noopener');
    });
  };

  const primaryWindow = merged?.primaryWindow ?? defaultWindowForSegment(segmentId, kuWindowId);

  return (
    <div
      className={[
        'appShell',
        merged && selected && flySections.length > 0 ? 'appShellWithFlyNav' : '',
        focusMode ? 'appShellNightFocus' : '',
        focusMode && !focusedSection ? 'appShellNightFocusPick' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="ffTopBar">
        <div className="ffTopBarMain">
          <h1>Analytics</h1>
          <p className="subtitle">
            One fixed 5-day week per segment. Footfall is either{' '}
            <strong>Mirrored footfall</strong> (no camera) or{' '}
            <strong>Unique footfall</strong> (camera, adjusted for repeat visitors). Raw
            detections stay as a small reference on camera sites.
          </p>
        </div>
        <div className="topActions">
          <button
            type="button"
            className="btnSecondary"
            onClick={reloadCaches}
            disabled={loading || cacheReloading || fetching}
            title="Rebuild the report on the server for this segment's windows"
          >
            {cacheReloading ? 'Rebuilding…' : 'Rebuild report'}
          </button>
          <button type="button" className="btnSecondary" onClick={exportAllCsv} disabled={!merged}>
            Export CSV
          </button>
          <button type="button" className="btnPrimary" onClick={exportLocationCsv} disabled={!selected}>
            Export location CSV
          </button>
        </div>
      </header>

      <SegmentTabs value={segmentId} onChange={setSegmentId} counts={counts} />

      <div className="targetsPeriodBar" role="status">
        <span className="targetsPeriodTag">Reference window</span>
        <strong>
          {primaryWindow.label}
        </strong>
        <span className="targetsPeriodSeparator">·</span>
        <span>5 business days · Sun–Thu</span>
        {segmentId === 'ALL' ? (
          <span className="targetsPeriodSeparator targetsPeriodAlt">
            MOH/O2 use <strong>{WINDOW_MOH_O2_MAY.shortLabel}</strong>
          </span>
        ) : null}
      </div>

      <UniqueFootfallExplainer
        highlight={
          segmentId === 'O2' || segmentId === 'KU' || segmentId === 'MOH' ? segmentId : undefined
        }
        selectedBreakdown={selected?.uniqueFootfallBreakdown}
      />

      {merged ? (
        <div className="filterBar">
          <div className="filterRow filterRowBar">
            <input
              type="search"
              className="searchInput searchInputBar"
              placeholder="Search location name or owner…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter.trim() ? (
              <span className="filterMeta">
                Showing {filtered.length} of {merged.locations.length} locations
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {refreshNeeded || cacheReloading ? (
        <div className="stateBox stateBoxInline">
          <p>Rebuilding report on server…</p>
        </div>
      ) : null}

      {loading && !merged ? (
        <div className="stateBox stateBoxLoading">
          <p className="loadingTitle">Loading targets for {primaryWindow.shortLabel}</p>
          <p>{loadStatus || 'Preparing report…'}</p>
          <p className="hint">First load for a new week can take a few minutes.</p>
        </div>
      ) : null}

      {error ? (
        <div className="stateBox error">
          <p>Could not load report: {error.message}</p>
          <button
            type="button"
            className="btnPrimary"
            onClick={() => {
              refreshNext.current = false;
              reportQueries.forEach((q) => q.refetch());
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {merged && reportForDetail && filtered.length > 0 ? (
        <FleetHeatmap report={reportForDetail} locations={filtered} onSelect={setSelectedId} />
      ) : null}

      {merged && filtered.length === 0 && merged.locations.length > 0 ? (
        <div className="stateBox">
          <p>No locations match the current search.</p>
          <button type="button" className="btnSecondary" onClick={() => setFilter('')}>
            Clear search
          </button>
        </div>
      ) : null}

      {merged && reportForDetail && selected ? (
        <div className="mainGrid">
          <section className="sidebar">
            <p className="periodBadge">
              {primaryWindow.shortLabel}
              {segmentId === 'ALL'
                ? ` · MOH/O2 ${WINDOW_MOH_O2_MAY.shortLabel}`
                : ''}
            </p>
            <ul className="locList">
              {filtered.map((l) => {
                const seg = inferOwnerSegment(l);
                const isAdjusted = l.uniqueAdjusted === true;
                const footTag = footfallSidebarTag(l);
                const ffDisplay = displayFootfallTotal(l);
                const convPct =
                  ffDisplay > 0
                    ? Math.round((l.daily.totalCups / ffDisplay) * 10000) / 100
                    : null;
                return (
                  <li key={l.machineId}>
                    <button
                      type="button"
                      className={selected.machineId === l.machineId ? 'locBtn active' : 'locBtn'}
                      onClick={() => setSelectedId(l.machineId)}
                    >
                      <span className="locName">
                        <span className={`locSegPill locSegPill-${seg}`}>{seg}</span>
                        {l.locationName}
                      </span>
                      <span className="locMeta">
                        {convPct != null ? `${convPct}%` : '—'} ·{' '}
                        {Math.round(ffDisplay).toLocaleString()} {footTag}
                        {' · '}
                        <span
                          style={
                            isProxySales(l)
                              ? { color: salesMetricColor(l), fontWeight: 600 }
                              : undefined
                          }
                        >
                          {formatCups(l.daily.totalCups)} cups
                        </span>{' '}
                        · {l.daily.totalRevenueKd.toFixed(1)} KD
                      </span>
                      {isAdjusted &&
                      l.rawFootfallTotal != null &&
                      !isMirroredFootfall(l) ? (
                        <span className="locRaw" title="Raw detections · 5 days">
                          raw {Math.round(l.rawFootfallTotal).toLocaleString()}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <FleetPanel report={reportForDetail} onSelect={setSelectedId} selectedId={selected.machineId} />
          </section>

          <section className="detail">
            <DataQualityBanner location={selected} />

            <DetailSection id="detail-top" {...sectionFocus}>
              <div className="kpiRow">
                {(() => {
                  const copy = footfallKpiCopy(selected);
                  return (
                    <Kpi
                      label={copy.periodLabel}
                      value={footfallPeriodTotal(selected).toLocaleString()}
                      valueColor={copy.periodValueColor}
                      hint={copy.periodHint}
                    />
                  );
                })()}
                {(() => {
                  const perDay = footfallPerDayAverage(selected);
                  if (perDay == null || !Number.isFinite(perDay)) return null;
                  const copy = footfallKpiCopy(selected);
                  return (
                    <Kpi
                      label={copy.perDayLabel ?? footfallPerDayLabel(selected)}
                      value={`${Math.round(perDay).toLocaleString()}`}
                      valueColor={copy.perDayValueColor ?? copy.periodValueColor}
                      hint="avg over 5 business days"
                    />
                  );
                })()}
                {selected.uniqueAdjusted &&
                selected.rawFootfallTotal != null &&
                !isMirroredFootfall(selected) ? (
                  <Kpi
                    label="Raw detections · 5 days"
                    value={Math.round(selected.rawFootfallTotal).toLocaleString()}
                    hint={
                      selected.rawAvgDailyFootfall != null
                        ? `≈ ${Math.round(selected.rawAvgDailyFootfall).toLocaleString()} / day`
                        : 'reference'
                    }
                  />
                ) : null}
                {selected.daily.totalNet != null &&
                selected.daily.totalIn != null &&
                selected.daily.totalOut != null &&
                selected.daily.totalIn > 0 ? (
                  <Kpi
                    label="Visitors in / out · 5 days"
                    value={`${selected.daily.totalIn.toLocaleString()} in · ${selected.daily.totalOut.toLocaleString()} out`}
                    hint={`net ${selected.daily.totalNet >= 0 ? '+' : ''}${selected.daily.totalNet.toLocaleString()} · ${NET_TRAFFIC_KPI_HINT}`}
                  />
                ) : selected.daily.totalNet != null && (selected.daily.totalIn ?? 0) > 0 ? (
                  <Kpi
                    label={`${NET_TRAFFIC_LABEL} · 5 days`}
                    value={selected.daily.totalNet!.toLocaleString()}
                    hint={NET_TRAFFIC_KPI_HINT}
                  />
                ) : null}
                <Kpi
                  label={`${salesCupsLabel(selected)} · 5 days`}
                  value={formatCups(selected.daily.totalCups)}
                  valueColor={salesMetricColor(selected)}
                  salesProxy={isProxySales(selected)}
                  hint={
                    isProxySales(selected)
                      ? salesDisplayFor(selected)?.label
                      : selected.daily.avgDailyCups != null
                        ? `≈ ${selected.daily.avgDailyCups.toLocaleString()} / day`
                        : undefined
                  }
                />
                <Kpi
                  label={isProxySales(selected) ? 'Revenue · proxy 5 days' : 'Revenue · 5 days'}
                  value={`${selected.daily.totalRevenueKd.toFixed(2)} KD`}
                  valueColor={salesMetricColor(selected)}
                  salesProxy={isProxySales(selected)}
                  hint={
                    selected.daily.totalRevenueKd > 0 && (selected.daily.salesDayCount ?? 5) > 0
                      ? `≈ ${(selected.daily.totalRevenueKd / (selected.daily.salesDayCount ?? 5)).toFixed(2)} KD / day`
                      : undefined
                  }
                />
                {(() => {
                  const estimated = isEstimatedFootfall(selected);
                  const ff = displayFootfallTotal(selected);
                  const cups = selected.daily.totalCups;
                  const hasFf = ff > 0;
                  const convPct = hasFf
                    ? Math.round((cups / ff) * 10000) / 100
                    : null;
                  const kdPerVisit = hasFf
                    ? selected.daily.totalRevenueKd / ff
                    : null;
                  return (
                    <>
                      <Kpi
                        label="Conversion · 5 days"
                        value={
                          hasFf
                            ? `${formatCups(cups)}:${Math.round(ff).toLocaleString()} (${convPct}%)`
                            : '—'
                        }
                        hint={
                          !hasFf
                            ? 'no footfall data'
                            : estimated
                              ? 'cups ÷ mirrored footfall'
                              : 'cups ÷ unique footfall'
                        }
                      />
                      <Kpi
                        label="KD per visit"
                        value={hasFf ? `${kdPerVisit!.toFixed(3)} KD` : '—'}
                        hint={
                          !hasFf
                            ? 'no footfall data'
                            : estimated
                              ? 'KD ÷ mirrored footfall'
                              : 'KD ÷ unique footfall'
                        }
                      />
                    </>
                  );
                })()}
                <Kpi
                  label="Missed potential · 5 days"
                  value={`${selected.daily.illustrativeMissedPotentialKd.toFixed(1)} KD`}
                  accent
                />
                {selected.daily.salesTargetCups != null && selected.daily.salesTargetCups > 0 ? (
                  <Kpi
                    label="Sales target · 5 days"
                    value={`${Math.round(selected.daily.salesTargetCups)} cups`}
                    hint={
                      selected.daily.salesUpliftCups != null && selected.daily.salesUpliftCups > 0
                        ? `+${Math.round(selected.daily.salesUpliftCups)} cups (+${selected.daily.salesUpliftKd?.toFixed(1)} KD) vs actual`
                        : selected.daily.salesTargetNote ?? undefined
                    }
                  />
                ) : null}
              </div>
            </DetailSection>

            <h2 className="locTitle">
              <span className={`locSegPill locSegPill-${selectedSegment ?? 'OTHER'}`}>
                {selectedSegment ?? 'OTHER'}
              </span>
              {selected.locationName}
              {selectedRaw?.locationOwner ? (
                <span className="locTitleOwner">· {selectedRaw.locationOwner}</span>
              ) : null}
            </h2>

            <DetailSection id="insights" {...sectionFocus}>
              <InsightsProjectionsPanel location={selected} benchmarkPct={merged.benchmark} />
            </DetailSection>

            <DetailSection id="net-traffic" {...sectionFocus}>
              <NetTrafficChart location={selected} />
            </DetailSection>

            <DetailSection id="hourly-profile" {...sectionFocus} className="hourlyProfileSection">
              <h3 className="sectionTitle">Hourly · footfall vs cups sold</h3>
              <HourlyChart location={selected} benchmarkPct={merged.benchmark} />
            </DetailSection>

            <DetailSection id="comparison-charts" {...sectionFocus}>
              <ComparisonCharts location={selected} benchmarkPct={merged.benchmark} />
            </DetailSection>

            <DetailSection id="daily-breakdown" {...sectionFocus}>
              <DayComparisonTable location={selected} enableCompare={false} />
            </DetailSection>

            <DetailSection id="metrics-table" {...sectionFocus}>
              <h3 className="sectionTitle">Hourly metrics table</h3>
              <MetricsTable
                location={selected}
                salesColor={isProxySales(selected) ? salesMetricColor(selected) : undefined}
                mirrorNote={
                  selected.mirrorSourceName
                    ? `Mirrored from ${selected.mirrorSourceName}`
                    : null
                }
              />
            </DetailSection>
          </section>
        </div>
      ) : null}

      {!loading && merged && merged.locations.length === 0 ? (
        <div className="stateBox">No locations in this segment for the chosen window.</div>
      ) : null}

      <footer className="footer">
        {merged ? (
          <span>
            {merged.locations.length} locations · Benchmark {merged.benchmark}% · Generated{' '}
            {new Date(merged.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait' })}
          </span>
        ) : null}
      </footer>

      {merged && selected && flySections.length > 0 ? (
        <SectionFlyBar
          sections={flySections}
          focusMode={focusMode}
          focusedSectionId={focusedSection}
          onFocusModeChange={(on) => {
            if (!on) {
              setFocusMode(false);
              setFocusedSection(null);
              return;
            }
            setFocusMode(true);
            setFocusedSection(null);
          }}
          onFocusSection={focusSection}
        />
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  hint,
  valueColor,
  salesProxy,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
  valueColor?: string;
  salesProxy?: boolean;
}) {
  return (
    <div
      className={`kpi ${accent ? 'kpiAccent' : ''} ${salesProxy ? 'kpiSalesProxy' : ''}`}
      style={salesProxy ? { borderColor: valueColor, background: `${valueColor}12` } : undefined}
    >
      <div className="kpiLabel">
        <TermLabel text={label} />
      </div>
      <div className="kpiValue" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {hint ? <div className="kpiHint">{hint}</div> : null}
    </div>
  );
}

