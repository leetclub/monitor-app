import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import {
  fetchPeriodSales,
  fetchReport,
  fetchTodaySales,
  readSessionReport,
  writeSessionReport,
} from '@/features/footfall/lib/api';
import type { LocationReport, OwnerSegment, ReportPayload } from '@/features/footfall/lib/types';
import { cameraFootfallTotal, displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import type { SegmentId } from '@/features/footfall/lib/segments';
import { applyUniqueFootfallToLocation } from '@/features/footfall/lib/uniqueFootfall';
import { applyKuFootfallEstimateIfNeeded } from '@/features/footfall/lib/kuFootfallEstimate';
import { applyRawCameraFootfall } from '@/features/footfall/lib/rawCameraFootfall';
import { useFootfallViewMode } from '@/features/footfall/FootfallViewMode';
import { kuwaitBusinessContext } from '@/features/footfall/lib/kuwaitBusinessDay';
import { resolveTodaySales, type TodaySalesRow } from '@/features/footfall/lib/todaySales';
import { targetsBenchmarkPctForSegment } from '@/features/footfall/lib/targetsBenchmark';
import {
  comparePeriodShortLabel,
  compareSelectionToLiveSalesRange,
  compareSelectionToReportQuery,
} from '@/features/footfall/lib/footfallCompareQuery';
import {
  fetchLocationTargetsMap,
  type LocationAdminTarget,
} from '@/features/footfall/lib/locationAdminTargets';

const REALTIME_MS = 90_000;

/**
 * Footfall report + live sales both follow the user's Alert Period dates.
 * Server skips May fallback on calendar builds; warm cron still prebuilds
 * weekly Sun–Thu windows so many presets hit cache.
 */
export function useTargetsData(segmentId: SegmentId, compare: CompareSelection) {
  const viewMode = useFootfallViewMode();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState('');
  const refreshNext = useRef(false);
  const business = useMemo(() => kuwaitBusinessContext(), []);

  const reportQ = useMemo(() => compareSelectionToReportQuery(compare), [compare]);
  const periodLabel = useMemo(() => comparePeriodShortLabel(compare), [compare]);
  const liveRange = useMemo(() => compareSelectionToLiveSalesRange(compare), [compare]);
  const liveIsSingleDay = liveRange.startDate === liveRange.endDate;

  const reportQuery = useQuery({
    queryKey: [
      'targets-report',
      reportQ.startDate,
      reportQ.endDate,
      reportQ.compareStartDate ?? '',
      reportQ.compareEndDate ?? '',
      reportQ.enableCompare ? 'cmp' : 'primary',
      reportQ.calendarDays ? 'cal' : 'biz',
    ],
    queryFn: async () => {
      setLoadStatus('Loading report…');
      try {
        const data = await fetchReport(reportQ, refreshNext.current, setLoadStatus);
        writeSessionReport(reportQ, data);
        refreshNext.current = false;
        setLoadStatus('');
        return data;
      } catch (e) {
        refreshNext.current = false;
        setLoadStatus('');
        throw e;
      }
    },
    initialData: () => readSessionReport(reportQ),
    staleTime: 60_000,
    gcTime: 6 * 3600 * 1000,
    retry: false,
    refetchInterval: (q) => (q.state.data && !q.state.error ? REALTIME_MS : false),
  });

  const targetsMapQuery = useQuery({
    queryKey: ['alert-location-targets-map'],
    queryFn: fetchLocationTargetsMap,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const loading = reportQuery.isLoading && !reportQuery.data;
  const loadError =
    reportQuery.error instanceof Error
      ? reportQuery.error.message
      : reportQuery.error
        ? String(reportQuery.error)
        : null;

  const merged = useMemo(() => {
    const payload = reportQuery.data;
    if (!payload) return null;

    const benchmark = payload.benchmarkConversionPct ?? 6.2;
    const generatedAt = payload.generatedAt;
    const out: LocationReport[] = [];
    const referenceFleet: LocationReport[] = [];
    const rawByMachineId: Record<string, LocationReport> = {};

    for (const loc of payload.locations) {
      const owner = inferOwnerSegment(loc);
      if (segmentId === 'KU' && owner !== 'KU') continue;
      if (segmentId === 'MOH' && owner !== 'MOH') continue;
      if (segmentId === 'O2' && owner !== 'O2') continue;

      const transformed =
        viewMode === 'raw'
          ? applyRawCameraFootfall(loc)
          : applyUniqueFootfallToLocation(loc, owner, benchmark);

      const ff =
        transformed.daily.projectedFootfall ?? transformed.daily.totalFootfall;
      if (viewMode === 'adjusted' && ff > 0 && transformed.daily.totalCups > 0) {
        if (!referenceFleet.some((r) => r.machineId === transformed.machineId)) {
          referenceFleet.push(transformed);
        }
      }

      transformed.reportWindowShortLabel = periodLabel;
      out.push(transformed);
      rawByMachineId[loc.machineId] = loc;
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

    return {
      periodLabel,
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
      rawByMachineId,
    };
  }, [reportQuery.data, segmentId, viewMode, periodLabel, reportQ.startDate, reportQ.endDate]);

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

  const fetching = reportQuery.isFetching || todayQuery.isFetching;

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
    if (!merged || !reportQuery.data) return null;
    return {
      ...reportQuery.data,
      generatedAt: merged.generatedAt,
      benchmarkConversionPct: merged.benchmark,
      primaryPeriod: [merged.primaryWindow.startDate, merged.primaryWindow.endDate],
      locations: merged.locations,
      locationCount: merged.locations.length,
    };
  }, [merged, reportQuery.data]);

  const counts = useMemo<Partial<Record<SegmentId, number>>>(() => {
    const c: Record<OwnerSegment, number> = { KU: 0, MOH: 0, O2: 0, OTHER: 0 };
    const payload = reportQuery.data;
    if (!payload) return { ALL: 0, KU: 0, MOH: 0, O2: 0 };
    for (const loc of payload.locations) {
      c[inferOwnerSegment(loc)]++;
    }
    return { ALL: c.KU + c.MOH + c.O2 + c.OTHER, KU: c.KU, MOH: c.MOH, O2: c.O2 };
  }, [reportQuery.data]);

  const retryLoad = () => {
    refreshNext.current = false;
    void reportQuery.refetch();
  };

  return {
    loading,
    fetching,
    loadStatus,
    loadError,
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
    liveSalesYmd: liveIsSingleDay ? liveRange.startDate : business.salesYmd,
    livePeriodLabel: periodLabel,
    adminTargetsByMachine,
    periodLabel,
    refreshNext,
  };
}
