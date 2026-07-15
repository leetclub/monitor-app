import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { RevenueTrajectoryChart } from '@/features/performance/PerformanceCharts';
import type { FleetPayload, PerfPreset } from '@/features/performance/perfTypes';
import { formatKwd } from '@/lib/salesDisplay';
import {
  V2EmptyState,
  V2KpiCard,
  V2Panel,
  V2ProgressBar,
  V2SectionHead,
} from '@/features/v2/v2Ui';

const PRESETS: Array<{ id: PerfPreset; label: string }> = [
  { id: 'rolling', label: '30 days' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];

/** Pure Manus Performance trajectory. */
export function V2PerformancePage() {
  const [preset, setPreset] = useState<PerfPreset>('rolling');

  const fleetQ = useQuery({
    queryKey: ['alert-performance-fleet', 'v2-manus', preset],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('preset', preset);
      qs.set('includeProducts', '0');
      return apiGet<FleetPayload>(`/api/alert/performance/fleet?${qs.toString()}`);
    },
    staleTime: 90_000,
  });

  const kpis = fleetQ.data?.kpis;
  const days = fleetQ.data?.aggregateDays || [];
  const actual = kpis?.periodActualKd ?? 0;
  const target = kpis?.periodTargetKd ?? 0;
  const ach = kpis?.achievementRatePct ?? (target > 0 ? (actual / target) * 100 : 0);
  const onTarget = kpis?.machinesOnTarget ?? 0;
  const withTarget = kpis?.machinesWithTarget ?? 0;
  const activeDays = useMemo(
    () => days.reduce((n, d) => n + (Number(d.locationKwd) > 0 ? 1 : 0), 0),
    [days],
  );

  const top = useMemo(() => {
    const list = [...(fleetQ.data?.machines || [])];
    list.sort((a, b) => (b.periodPctOfTarget ?? 0) - (a.periodPctOfTarget ?? 0));
    return list.slice(0, 8);
  }, [fleetQ.data?.machines]);

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Performance intelligence"
        title="Trajectory"
        description="Revenue, target attainment, and fleet trajectory — Manus command view."
        actions={
          <select
            className="v2Select"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PerfPreset)}
            aria-label="Period"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard
          label="Revenue"
          value={formatKwd(actual)}
          detail={`${Number(ach || 0).toFixed(0)}% of target`}
          tone="teal"
          icon="performance"
        />
        <V2KpiCard
          label="Active days"
          value={activeDays}
          detail={PRESETS.find((p) => p.id === preset)?.label || 'period'}
          tone="blue"
          icon="overall"
        />
        <V2KpiCard
          label="On target"
          value={onTarget}
          detail={`of ${withTarget} with targets`}
          tone="teal"
          icon="admin"
        />
        <V2KpiCard
          label="Growth"
          value={
            kpis?.growthRatePct != null && Number.isFinite(kpis.growthRatePct)
              ? `${kpis.growthRatePct.toFixed(1)}%`
              : '—'
          }
          detail="vs prior period"
          tone="amber"
          icon="performance"
        />
      </div>

      <V2Panel title="Revenue trajectory" subtitle="Actual vs location targets">
        {fleetQ.isLoading ? (
          <V2EmptyState title="Loading trajectory…" description="Fetching fleet performance." />
        ) : days.length === 0 ? (
          <V2EmptyState title="No performance records" description="No measurements for this window." />
        ) : (
          <div className="v2ChartHost">
            <RevenueTrajectoryChart days={days} />
          </div>
        )}
      </V2Panel>

      <div className="v2Split50">
        <V2Panel title="Target attainment" subtitle="Period health">
          <div className="v2AttainList">
            <V2ProgressBar
              label="Revenue"
              pct={Number(ach) || 0}
              valueLabel={`${formatKwd(actual)} · ${Number(ach || 0).toFixed(0)}%`}
            />
            <V2ProgressBar
              label="Machines on target"
              pct={withTarget ? (onTarget / withTarget) * 100 : 0}
              valueLabel={`${onTarget} / ${withTarget}`}
            />
          </div>
        </V2Panel>
        <V2Panel title="Leaders" subtitle="Highest % of target">
          {top.length === 0 ? (
            <V2EmptyState title="No rankings" description="Fleet performance empty for this period." />
          ) : (
            <ul className="v2LeaderList">
              {top.map((m, i) => (
                <li key={m.machineId}>
                  <span className="v2LeaderRank">{i + 1}</span>
                  <div>
                    <strong>{m.machineName}</strong>
                    <span>{formatKwd(m.totalLocationKwd)}</span>
                  </div>
                  <em>{m.periodPctOfTarget != null ? `${m.periodPctOfTarget.toFixed(0)}%` : '—'}</em>
                </li>
              ))}
            </ul>
          )}
        </V2Panel>
      </div>
    </div>
  );
}
