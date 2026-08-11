import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchReport, fetchTodaySales, readSessionReport, writeSessionReport } from '@/features/footfall/lib/api';
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

function toQuery(w: ReportWindow): ReportQuery {
  return {
    startDate: w.startDate,
    endDate: w.endDate,
    enableCompare: false,
  };
}

const REALTIME_MS = 90_000;

export function useTargetsData(segmentId: SegmentId, kuWindowId: string) {
  const viewMode = useFootfallViewMode();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshNext = useRef(false);
  const business = useMemo(() => kuwaitBusinessContext(), []);

  const kuWindow = WINDOW_KU_JUL;

  const windowsNeeded = useMemo<ReportWindow[]>(() => {
    if (segmentId === 'KU') return [kuWindow, WINDOW_MOH_O2_MAY];
    if (segmentId === 'MOH' || segmentId === 'O2') return [WINDOW_MOH_O2_MAY];
    return [kuWindow, WINDOW_MOH_O2_MAY];
  }, [segmentId, kuWindow]);

  const reportQueries = useQueries({
    queries: windowsNeeded.map((w) => {
      const q = toQuery(w);
      return {
        queryKey: ['targets-report', w.id],
        queryFn: async () => {
          const data = await fetchReport(q, refreshNext.current);
          writeSessionReport(q, data);
          return data;
        },
        initialData: () => readSessionReport(q),
        staleTime: 30_000,
        gcTime: 6 * 3600 * 1000,
        retry: false,
        refetchInterval: REALTIME_MS,
      };
    }),
  });

  const loading = reportQueries.some((q) => q.isLoading && !q.data);

  const merged = useMemo(() => {
    const payloads: { window: ReportWindow; payload: ReportPayload }[] = [];
    reportQueries.forEach((q, idx) => {
      if (q.data) payloads.push({ window: windowsNeeded[idx], payload: q.data });
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
    const raw: Record<string, LocationReport> = {};

    for (const item of payloads) {
      const win = item.window;
      const refOnlyForKu =
        segmentId === 'KU' && win.id === WINDOW_MOH_O2_MAY.id;
      const owners: OwnerSegment[] =
        win.id === WINDOW_MOH_O2_MAY.id ? ['MOH', 'O2'] : ['KU'];
      for (const loc of item.payload.locations) {
        const owner = inferOwnerSegment(loc);
        if (!owners.includes(owner)) continue;

        const baseLoc = stripCompare(loc);
        const transformed =
          viewMode === 'raw'
            ? applyRawCameraFootfall(baseLoc)
            : applyUniqueFootfallToLocation(baseLoc, owner, benchmark);
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
        if (seen.has(loc.machineId)) continue;
        seen.add(loc.machineId);

        transformed.reportWindowShortLabel = win.shortLabel;
        out.push(transformed);
        raw[loc.machineId] = loc;
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

    return {
      primaryWindow: defaultWindowForSegment(segmentId, kuWindowId),
      benchmark,
      generatedAt,
      locations: out,
      rawByMachineId: raw,
    };
  }, [reportQueries, windowsNeeded, segmentId, kuWindowId, viewMode]);

  const machineIdsKey = useMemo(
    () => (merged?.locations ?? []).map((l) => l.machineId).join(','),
    [merged?.locations],
  );

  const todayQuery = useQuery({
    queryKey: ['targets-today-sales', business.salesYmd, segmentId, machineIdsKey],
    queryFn: async () =>
      fetchTodaySales(
        business.salesYmd,
        (merged?.locations ?? []).map((l) => l.machineId),
      ),
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
          business.salesYmd,
          liveLoaded,
        ),
      );
    }
    return map;
  }, [merged, todayQuery.data, todayQuery.isSuccess, business.salesYmd]);

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
    return {
      generatedAt: merged.generatedAt,
      benchmarkConversionPct: merged.benchmark,
      primaryPeriod: [merged.primaryWindow.startDate, merged.primaryWindow.endDate],
      fallbackPeriod: [WINDOW_MOH_O2_MAY.startDate, WINDOW_MOH_O2_MAY.endDate],
      comparePeriod: null,
      currency: 'KD',
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
  }, [merged]);

  const counts = useMemo<Partial<Record<SegmentId, number>>>(() => {
    const c: Record<OwnerSegment, number> = { KU: 0, MOH: 0, O2: 0, OTHER: 0 };
    reportQueries.forEach((q, idx) => {
      const w = windowsNeeded[idx];
      if (!q.data || !w) return;
      const owners = w.id === WINDOW_MOH_O2_MAY.id ? ['MOH', 'O2'] : ['KU'];
      for (const loc of q.data.locations) {
        const own = inferOwnerSegment(loc);
        if (owners.includes(own)) c[own]++;
      }
    });
    return { ALL: c.KU + c.MOH + c.O2, KU: c.KU, MOH: c.MOH, O2: c.O2 };
  }, [reportQueries, windowsNeeded]);

  return {
    loading,
    fetching,
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
    refreshNext,
  };
}
