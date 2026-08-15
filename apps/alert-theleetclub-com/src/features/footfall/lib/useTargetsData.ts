import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import {
  fetchPeriodSales,
  fetchReport,
  fetchTodaySales,
  readSessionReport,
  writeSessionReport,
} from '@/features/footfall/lib/api';
import type { LocationReport, OwnerSegment, ReportPayload, ReportQuery } from '@/features/footfall/lib/types';
import { cameraFootfallTotal, displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import {
  WINDOW_KU_JUL,
  WINDOW_MOH_O2_MAY,
  defaultWindowForSegment,
  type ReportWindow,
  type SegmentId,
} from '@/features/footfall/lib/segments';
import { applyUniqueFootfallToLocation, stripCompare } from '@/features/footfall/lib/uniqueFootfall';
import { applyKuFootfallEstimateIfNeeded } from '@/features/footfall/lib/kuFootfallEstimate';
import { applyRawCameraFootfall } from '@/features/footfall/lib/rawCameraFootfall';
import { useFootfallViewMode } from '@/features/footfall/FootfallViewMode';
import { kuwaitBusinessContext } from '@/features/footfall/lib/kuwaitBusinessDay';
import { resolveTodaySales, type TodaySalesRow } from '@/features/footfall/lib/todaySales';
import { targetsBenchmarkPctForSegment } from '@/features/footfall/lib/targetsBenchmark';
import {
  compareSelectionToLiveSalesRange,
  liveSalesPeriodLabel,
  windowToReportQuery,
} from '@/features/footfall/lib/footfallCompareQuery';
import {
  fetchLocationTargetsMap,
  type LocationAdminTarget,
} from '@/features/footfall/lib/locationAdminTargets';

const REALTIME_MS = 90_000;

function toQuery(w: ReportWindow): ReportQuery {
  return windowToReportQuery(w);
}

/**
 * Hybrid like target.theleetclub.com:
 * - Heavy footfall from fixed Jul (KU) + May (MOH/O2) caches
 * - Live Vendon for Achievement / Daily Target (Alert preset picks the live window)
 */
export function useTargetsData(segmentId: SegmentId, compare: CompareSelection) {
  const viewMode = useFootfallViewMode();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState('');
  const refreshNext = useRef(false);
  const business = useMemo(() => kuwaitBusinessContext(), []);

  const liveRange = useMemo(() => compareSelectionToLiveSalesRange(compare), [compare]);
  const livePeriodLabel = useMemo(() => liveSalesPeriodLabel(compare), [compare]);
  const liveIsSingleDay = liveRange.startDate === liveRange.endDate;

  const windowsNeeded = useMemo<ReportWindow[]>(() => {
    if (segmentId === 'KU') return [WINDOW_KU_JUL, WINDOW_MOH_O2_MAY];
    if (segmentId === 'MOH' || segmentId === 'O2') return [WINDOW_MOH_O2_MAY];
    return [WINDOW_KU_JUL, WINDOW_MOH_O2_MAY];
  }, [segmentId]);

  const reportQueries = useQueries({
    queries: windowsNeeded.map((w) => {
      const q = toQuery(w);
      return {
        queryKey: ['targets-report-fixed', w.id],
        queryFn: async () => {
          setLoadStatus(`Loading ${w.shortLabel}…`);
          try {
            const data = await fetchReport(q, refreshNext.current, setLoadStatus);
            writeSessionReport(q, data);
            return data;
          } finally {
            refreshNext.current = false;
          }
        },
        initialData: () => readSessionReport(q),
        staleTime: 5 * 60_000,
        gcTime: 6 * 3600 * 1000,
        retry: false,
        refetchInterval: (query: { state: { data?: unknown; error?: unknown } }) =>
          query.state.data && !query.state.error ? REALTIME_MS : false,
      };
    }),
  });

  const targetsMapQuery = useQuery({
    queryKey: ['alert-location-targets-map'],
    queryFn: fetchLocationTargetsMap,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const loading = reportQueries.some((q) => q.isLoading && !q.data);
  const loadError = reportQueries
    .map((q) => q.error)
    .find(Boolean);
  const loadErrorMessage =
    loadError instanceof Error
      ? loadError.message
      : loadError
        ? String(loadError)
        : null;

  useEffect(() => {
    if (!loading) setLoadStatus('');
  }, [loading]);

  const merged = useMemo(() => {
    const payloads: { window: ReportWindow; payload: ReportPayload }[] = [];
    reportQueries.forEach((q, idx) => {
      if (q.data) payloads.push({ window: windowsNeeded[idx]!, payload: q.data });
    });
    if (payloads.length === 0) return null;

    const benchmark =
      payloads.find((p) => p.payload.benchmarkConversionPct != null)?.payload
        .benchmarkConversionPct ?? 6.2;
    const generatedAt = payloads
      .map((p) => p.payload.generatedAt)
      .sort()
      .at(-1)!;

    const seen = new Set<string>();
    const out: LocationReport[] = [];
    const referenceFleet: LocationReport[] = [];
    const rawByMachineId: Record<string, LocationReport> = {};

    for (const item of payloads) {
      const win = item.window;
      const refOnlyForKu = segmentId === 'KU' && win.id === WINDOW_MOH_O2_MAY.id;
      const owners: OwnerSegment[] =
        win.id === WINDOW_MOH_O2_MAY.id ? ['MOH', 'O2'] : ['KU'];

      for (const loc of item.payload.locations) {
        const owner = inferOwnerSegment(loc);
        if (!owners.includes(owner)) continue;

        const transformed =
          viewMode === 'raw'
            ? applyRawCameraFootfall(stripCompare(loc))
            : applyUniqueFootfallToLocation(stripCompare(loc), owner, benchmark);

        const ff =
          transformed.daily.projectedFootfall ?? transformed.daily.totalFootfall;
        if (viewMode === 'adjusted' && ff > 0 && transformed.daily.totalCups > 0) {
          if (!referenceFleet.some((r) => r.machineId === transformed.machineId)) {
            referenceFleet.push(transformed);
          }
        }

        if (refOnlyForKu) continue;

        if (segmentId === 'KU' && owner !== 'KU') continue;
        if (segmentId === 'MOH' && owner !== 'MOH') continue;
        if (segmentId === 'O2' && owner !== 'O2') continue;
        if (segmentId === 'ALL' && owner === 'OTHER') {
          /* keep OTHER in All */
        }
        if (seen.has(loc.machineId)) continue;
        seen.add(loc.machineId);

        transformed.reportWindowShortLabel = win.shortLabel;
        out.push(transformed);
        rawByMachineId[loc.machineId] = loc;
      }
    }

    if (viewMode === 'adjusted') {
      for (let i = 0; i < out.length; i++) {
        out[i] = applyKuFootfallEstimateIfNeeded(
          out[i]!,
          referenceFleet,
          targetsBenchmarkPctForSegment('KU'),
        );
      }
    }

    out.sort(
      (a, b) =>
        cameraFootfallTotal(b) - cameraFootfallTotal(a) ||
        displayFootfallTotal(b) - displayFootfallTotal(a),
    );

    const primaryWindow = defaultWindowForSegment(segmentId, WINDOW_KU_JUL.id);

    return {
      periodLabel: primaryWindow.shortLabel,
      livePeriodLabel,
      primaryWindow,
      benchmark,
      generatedAt,
      locations: out,
      rawByMachineId,
    };
  }, [reportQueries, windowsNeeded, segmentId, viewMode, livePeriodLabel]);

  const machineIdsKey = useMemo(
    () => (merged?.locations ?? []).map((l) => l.machineId).join(','),
    [merged?.locations],
  );

  const todayQuery = useQuery({
    queryKey: [
      'targets-live-sales',
      liveRange.startDate,
      liveRange.endDate,
      segmentId,
      machineIdsKey,
    ],
    queryFn: async () => {
      const ids = (merged?.locations ?? []).map((l) => l.machineId);
      if (liveIsSingleDay) {
        return fetchTodaySales(liveRange.startDate, ids);
      }
      return fetchPeriodSales(liveRange.startDate, liveRange.endDate, ids);
    },
    enabled: Boolean(merged?.locations.length),
    staleTime: 20_000,
    refetchInterval: REALTIME_MS,
    retry: 2,
  });

  const fetching =
    reportQueries.some((q) => q.isFetching) || todayQuery.isFetching;

  const todayByMachine = useMemo(() => {
    const map = new Map<string, TodaySalesRow>();
    if (!merged) return map;
    const liveLoaded = todayQuery.isSuccess;
    for (const loc of merged.locations) {
      map.set(
        loc.machineId,
        resolveTodaySales(
          loc.machineId,
          loc,
          todayQuery.data ?? undefined,
          liveIsSingleDay ? liveRange.startDate : business.salesYmd,
          liveLoaded,
        ),
      );
    }
    return map;
  }, [
    merged,
    todayQuery.data,
    todayQuery.isSuccess,
    liveIsSingleDay,
    liveRange.startDate,
    business.salesYmd,
  ]);

  const adminTargetsByMachine = useMemo(() => {
    return (targetsMapQuery.data ?? {}) as Record<string, LocationAdminTarget>;
  }, [targetsMapQuery.data]);

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

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    const id = selectedId || filtered[0]?.machineId;
    return filtered.find((l) => l.machineId === id) ?? filtered[0];
  }, [filtered, selectedId]);

  const reportForDetail = useMemo<ReportPayload | null>(() => {
    if (!merged) return null;
    const firstPayload = reportQueries.find((q) => q.data)?.data;
    if (!firstPayload) return null;
    return {
      ...firstPayload,
      generatedAt: merged.generatedAt,
      benchmarkConversionPct: merged.benchmark,
      primaryPeriod: [merged.primaryWindow.startDate, merged.primaryWindow.endDate],
      locations: merged.locations,
      locationCount: merged.locations.length,
    };
  }, [merged, reportQueries]);

  const counts = useMemo<Partial<Record<SegmentId, number>>>(() => {
    const c: Record<OwnerSegment, number> = { KU: 0, MOH: 0, O2: 0, OTHER: 0 };
    for (const loc of merged?.locations ?? []) {
      c[inferOwnerSegment(loc)]++;
    }
    return { ALL: c.KU + c.MOH + c.O2 + c.OTHER, KU: c.KU, MOH: c.MOH, O2: c.O2 };
  }, [merged]);

  const retryLoad = () => {
    refreshNext.current = false;
    void Promise.all(reportQueries.map((q) => q.refetch()));
  };

  return {
    loading,
    fetching,
    loadStatus,
    loadError: loadErrorMessage,
    retryLoad,
    merged,
    filtered,
    selected,
    reportForDetail,
    counts,
    filter,
    setFilter,
    setSelectedId,
    business,
    todayByMachine,
    todaySalesLoading: todayQuery.isLoading || todayQuery.isFetching,
    todaySalesReady: todayQuery.isSuccess,
    /** Live sales day for Achievement (preset period, else Kuwait business day). */
    liveSalesYmd: liveIsSingleDay ? liveRange.startDate : business.salesYmd,
    livePeriodLabel,
    adminTargetsByMachine,
    periodLabel: merged?.periodLabel ?? defaultWindowForSegment(segmentId, WINDOW_KU_JUL.id).shortLabel,
    refreshNext,
  };
}
