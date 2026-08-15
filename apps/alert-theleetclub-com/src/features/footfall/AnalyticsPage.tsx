import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import {
  csvExportUrl,
  fetchReport,
  readSessionReport,
  reloadAllCaches,
  writeSessionReport,
} from '@/features/footfall/lib/api';
import type { LocationReport, OwnerSegment, ReportPayload } from '@/features/footfall/lib/types';
import { cameraFootfallTotal, displayFootfallTotal, isEstimatedFootfall } from '@/features/footfall/lib/footfallMetrics';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import type { SegmentId } from '@/features/footfall/lib/segments';
import { applyUniqueFootfallToLocation } from '@/features/footfall/lib/uniqueFootfall';
import { applyRawCameraFootfall } from '@/features/footfall/lib/rawCameraFootfall';
import { useFootfallViewMode } from '@/features/footfall/FootfallViewMode';
import {
  comparePeriodShortLabel,
  compareSelectionToReportQuery,
} from '@/features/footfall/lib/footfallCompareQuery';
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

export function AnalyticsPage({ compare }: { compare: CompareSelection }) {
  const qc = useQueryClient();
  const viewMode = useFootfallViewMode();
  const [segmentId, setSegmentId] = useState<SegmentId>('ALL');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState('');
  const refreshNext = useRef(false);

  const reportQ = useMemo(() => compareSelectionToReportQuery(compare), [compare]);
  const periodLabel = useMemo(() => comparePeriodShortLabel(compare), [compare]);

  const reportQuery = useQuery({
    queryKey: [
      'targets-report',
      reportQ.startDate,
      reportQ.endDate,
      reportQ.compareStartDate,
      reportQ.compareEndDate,
      reportQ.calendarDays ? 'cal' : 'biz',
    ],
    queryFn: async () => {
      const data = await fetchReport(reportQ, refreshNext.current, setLoadStatus);
      writeSessionReport(reportQ, data);
      setLoadStatus('');
      return data;
    },
    initialData: () => readSessionReport(reportQ),
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 3600 * 1000,
    retry: false,
  });

  const loading = reportQuery.isLoading && !reportQuery.data;
  const fetching = reportQuery.isFetching;
  const error = reportQuery.error as Error | undefined;
  useEffect(() => {
    if (!fetching) refreshNext.current = false;
  }, [fetching]);

  /** Merge reports + apply unique-footfall transform to every location. */
  const merged = useMemo<{
    primaryWindow: { id: string; label: string; shortLabel: string; startDate: string; endDate: string };
    benchmark: number;
    generatedAt: string;
    locations: LocationReport[];
    rawByMachineId: Record<string, LocationReport>;
  } | null>(() => {
    const payload = reportQuery.data;
    if (!payload) return null;

    const benchmark = payload.benchmarkConversionPct ?? 6.2;
    const generatedAt = payload.generatedAt;
    const out: LocationReport[] = [];
    const raw: Record<string, LocationReport> = {};

    for (const loc of payload.locations) {
      const owner = inferOwnerSegment(loc);
      if (segmentId === 'KU' && owner !== 'KU') continue;
      if (segmentId === 'MOH' && owner !== 'MOH') continue;
      if (segmentId === 'O2' && owner !== 'O2') continue;

      const transformed =
        viewMode === 'raw'
          ? applyRawCameraFootfall(loc)
          : applyUniqueFootfallToLocation(loc, owner, benchmark);
      transformed.reportWindowShortLabel = periodLabel;
      out.push(transformed);
      raw[loc.machineId] = loc;
    }

    out.sort(
      (a, b) =>
        cameraFootfallTotal(b) - cameraFootfallTotal(a) ||
        displayFootfallTotal(b) - displayFootfallTotal(a),
    );

    return {
      primaryWindow: {
        id: `${reportQ.startDate}_${reportQ.endDate}`,
        label: periodLabel,
        shortLabel: periodLabel,
        startDate: reportQ.startDate,
        endDate: reportQ.endDate,
      },
      benchmark,
      generatedAt,
      locations: out,
      rawByMachineId: raw,
    };
  }, [reportQuery.data, segmentId, viewMode, periodLabel, reportQ.startDate, reportQ.endDate]);

  /** Synthetic ReportPayload that the existing components consume. */
  const reportForDetail = useMemo<ReportPayload | null>(() => {
    if (!merged || !reportQuery.data) return null;
    return {
      ...reportQuery.data,
      generatedAt: merged.generatedAt,
      benchmarkConversionPct: merged.benchmark,
      primaryPeriod: [merged.primaryWindow.startDate, merged.primaryWindow.endDate],
      locations: merged.locations,
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
  }, [merged, reportQuery.data]);

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
    const payload = reportQuery.data;
    if (!payload) return { ALL: 0, KU: 0, MOH: 0, O2: 0 };
    for (const loc of payload.locations) {
      c[inferOwnerSegment(loc)]++;
    }
    return { ALL: c.KU + c.MOH + c.O2 + c.OTHER, KU: c.KU, MOH: c.MOH, O2: c.O2 };
  }, [reportQuery.data]);

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
      const data = await reloadAllCaches(reportQ, setLoadStatus);
      qc.setQueryData(
        [
          'targets-report',
          reportQ.startDate,
          reportQ.endDate,
          reportQ.compareStartDate,
          reportQ.compareEndDate,
          reportQ.calendarDays ? 'cal' : 'biz',
        ],
        data,
      );
      writeSessionReport(reportQ, data);
    } finally {
      setLoadStatus('');
      setCacheReloading(false);
    }
  };

  const exportLocationCsv = () => {
    if (!selected) return;
    window.open(csvExportUrl(reportQ, selected.machineId), '_blank', 'noopener');
  };

  const exportAllCsv = () => {
    if (!merged) return;
    window.open(csvExportUrl(reportQ), '_blank', 'noopener');
  };

  const primaryWindow = merged?.primaryWindow ?? {
    id: `${reportQ.startDate}_${reportQ.endDate}`,
    label: periodLabel,
    shortLabel: periodLabel,
    startDate: reportQ.startDate,
    endDate: reportQ.endDate,
  };

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
            Uses the same Alert date preset as Targets. Default footfall is{' '}
            <strong>as measured</strong> (raw camera). Turn on <strong>Mirror &amp; adjust</strong>{' '}
            for mirrored / unique-ratio footfall. Sales unchanged.
          </p>
        </div>
        <div className="topActions">
          <button
            type="button"
            className="btnSecondary"
            onClick={reloadCaches}
            disabled={loading || cacheReloading || fetching}
            title="Rebuild the report on the server for the selected dates"
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
        <span className="targetsPeriodTag">Selected period</span>
        <strong>{primaryWindow.label}</strong>
        <span className="targetsPeriodSeparator">·</span>
        <span>
          {primaryWindow.startDate === primaryWindow.endDate
            ? primaryWindow.startDate
            : `${primaryWindow.startDate} → ${primaryWindow.endDate}`}
        </span>
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

      {cacheReloading ? (
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
              void reportQuery.refetch();
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
            <p className="periodBadge">{primaryWindow.shortLabel}</p>
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

