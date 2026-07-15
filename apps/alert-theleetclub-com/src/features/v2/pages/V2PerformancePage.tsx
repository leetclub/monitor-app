import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'rolling', label: '30 days' },
];

export function V2PerformancePage() {
  const [preset, setPreset] = useState<PerfPreset>('rolling');

  const fleetQ = useQuery({
    queryKey: ['alert-performance-fleet', 'v2', preset],
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
  const txProxy = useMemo(
    () => days.reduce((n, d) => n + (Number(d.locationKwd) > 0 ? 1 : 0), 0),
    [days],
  );

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Performance intelligence"
        title="Trajectory"
        description="Revenue, target attainment, and fleet trajectory — same live Performance APIs as Classic."
        actions={
          <div className="v2SectionActions">
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
            <span className="v2ReadyPill">Fleet aggregate</span>
          </div>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard
          label="Revenue"
          value={formatKwd(actual)}
          detail={`${Number.isFinite(ach) ? ach.toFixed(0) : 0}% of target`}
          tone="teal"
          icon="performance"
        />
        <V2KpiCard
          label="Active days"
          value={txProxy}
          detail={`recorded over ${PRESETS.find((p) => p.id === preset)?.label || 'period'}`}
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

      <V2Panel
        title="Revenue trajectory"
        subtitle="Actual vs location targets"
        meta={
          <div className="v2Legend">
            <span>
              <i className="v2DotTeal" /> Actual
            </span>
            <span>
              <i className="v2DotSlate" /> Target
            </span>
          </div>
        }
      >
        {fleetQ.isLoading ? (
          <V2EmptyState title="Loading trajectory…" description="Fetching fleet performance." />
        ) : fleetQ.isError ? (
          <V2EmptyState
            title="Performance unavailable"
            description={(fleetQ.error as Error)?.message || 'Fleet performance failed.'}
            icon="red_flags"
          />
        ) : days.length === 0 ? (
          <V2EmptyState
            title="No performance records"
            description="No measurements were recorded for this window."
          />
        ) : (
          <div className="v2ChartHost">
            <RevenueTrajectoryChart days={days} />
          </div>
        )}
      </V2Panel>

      <div className="v2Split50">
        <V2Panel title="Quality and availability" subtitle="Daily quality score and uptime percentage">
          <V2EmptyState
            title="Trend unavailable"
            description="Quality/uptime daily series is not in the fleet payload yet — use Classic Performance for full charts."
            icon="qa_visit"
          />
        </V2Panel>
        <V2Panel title="Target attainment" subtitle="Current period health against standards">
          <div className="v2AttainList">
            <V2ProgressBar
              label="Revenue"
              pct={Number(ach) || 0}
              valueLabel={`${formatKwd(actual)} · ${Number(ach || 0).toFixed(0)}% of ${formatKwd(target)}`}
            />
            <V2ProgressBar
              label="Machines on target"
              pct={withTarget ? (onTarget / withTarget) * 100 : 0}
              valueLabel={`${onTarget} / ${withTarget}`}
            />
            <V2ProgressBar
              label="Prior growth"
              pct={Math.max(0, Math.min(100, Number(kpis?.growthRatePct) || 0))}
              valueLabel={
                kpis?.growthRatePct != null ? `${kpis.growthRatePct.toFixed(1)}%` : 'n/a'
              }
            />
          </div>
          <Link className="v2LinkBtn" to="/performance">
            Open classic Performance →
          </Link>
        </V2Panel>
      </div>
    </div>
  );
}
