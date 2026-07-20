import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { RevenueTrajectoryChart } from '@/features/performance/PerformanceCharts';
import type { FleetPayload, PerfPreset } from '@/features/performance/perfTypes';
import { formatKwd } from '@/lib/salesDisplay';
import { V2DataTable } from '@/features/v2/V2DataTable';
import { V2MetricStack } from '@/features/v2/V2MetricStack';
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
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
];

const PERF_COLS = [
  { key: 'rank', label: '#' },
  { key: 'machine', label: 'Machine', sticky: true },
  { key: 'revenue', label: 'Revenue', sub: 'KD', wide: true },
  { key: 'target', label: 'Target', sub: 'KD', wide: true },
  { key: 'pct', label: '% of target', wide: true },
  { key: 'product', label: 'Product' },
  { key: 'cups', label: 'Cups', wide: true },
  { key: 'cupTarget', label: 'Cup target' },
  { key: 'cupPct', label: 'Cup %', wide: true },
  { key: 'sx', label: 'SX', sub: 'Loc', wide: true },
];

/** Pure Manus Performance — full fleet ranking workbook + trajectory. */
export function V2PerformancePage() {
  const [preset, setPreset] = useState<PerfPreset>('rolling');
  const [q, setQ] = useState('');

  const fleetQ = useQuery({
    queryKey: ['alert-performance-fleet', 'v2-full', preset],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('preset', preset);
      qs.set('includeProducts', '1');
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

  const ranked = useMemo(() => {
    const list = [...(fleetQ.data?.machines || [])];
    list.sort((a, b) => (b.periodPctOfTarget ?? -1) - (a.periodPctOfTarget ?? -1));
    const needle = q.trim().toLowerCase();
    return list
      .map((m, i) => ({ m, rank: i + 1 }))
      .filter(({ m }) => !needle || `${m.machineName} ${m.machineId}`.toLowerCase().includes(needle));
  }, [fleetQ.data?.machines, q]);

  const tableRows = ranked.map(({ m, rank }) => {
    const pct = m.periodPctOfTarget;
    const cupPct = m.periodProductPctOfTarget;
    return {
      id: m.machineId,
      cells: {
        rank: <span className="v2LeaderRank">{rank}</span>,
        machine: (
          <div className="v2CellMachine">
            <strong>{m.machineName}</strong>
            <span className="v2CellId">{m.machineId}</span>
          </div>
        ),
        revenue: (
          <V2MetricStack items={[{ label: 'Actual', value: formatKwd(m.totalLocationKwd), tone: 'teal' }]} />
        ),
        target: (
          <V2MetricStack
            items={[
              {
                label: 'Target',
                value: m.periodTargetKd != null ? formatKwd(Number(m.periodTargetKd)) : '—',
                tone: 'muted',
              },
            ]}
          />
        ),
        pct: (
          <V2MetricStack
            items={[
              {
                label: 'Achieved',
                value: pct != null ? `${pct.toFixed(0)}%` : '—',
                tone: pct == null ? 'muted' : pct >= 100 ? 'up' : pct >= 70 ? 'amber' : 'down',
              },
            ]}
          />
        ),
        product: m.productName || '—',
        cups: (
          <V2MetricStack
            items={[
              {
                label: 'Cups',
                value: m.totalProductCups != null ? String(Math.round(Number(m.totalProductCups))) : '—',
                tone: 'teal',
              },
            ]}
          />
        ),
        cupTarget:
          m.periodProductTargetCups != null ? String(Math.round(Number(m.periodProductTargetCups))) : '—',
        cupPct: (
          <V2MetricStack
            items={[
              {
                label: 'Cup %',
                value: cupPct != null ? `${cupPct.toFixed(0)}%` : '—',
                tone: cupPct == null ? 'muted' : cupPct >= 100 ? 'up' : cupPct >= 70 ? 'amber' : 'down',
              },
            ]}
          />
        ),
        sx: (
          <V2MetricStack
            items={[
              {
                label: 'Loc SX',
                value: m.locationSxPct != null ? `${Number(m.locationSxPct).toFixed(1)} pts` : '—',
                tone:
                  m.locationSxPct == null
                    ? 'muted'
                    : Number(m.locationSxPct) > 0
                      ? 'up'
                      : Number(m.locationSxPct) < 0
                        ? 'down'
                        : 'flat',
              },
              {
                label: 'Prod SX',
                value: m.productSxPct != null ? `${Number(m.productSxPct).toFixed(1)} pts` : '—',
                tone:
                  m.productSxPct == null
                    ? 'muted'
                    : Number(m.productSxPct) > 0
                      ? 'up'
                      : Number(m.productSxPct) < 0
                        ? 'down'
                        : 'flat',
              },
            ]}
          />
        ),
      } as Record<string, ReactNode>,
    };
  });

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Performance intelligence"
        title="Trajectory"
        description="Full fleet ranking workbook + revenue trajectory — Classic metrics, Manus look."
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
          label="Machines"
          value={fleetQ.data?.machineCount ?? ranked.length}
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
        <V2Panel title="Deficit" subtitle="Period gap">
          <div className="v2FieldGrid v2FieldGridCompact">
            <div>
              <span>Deficit</span>
              <strong>
                {kpis?.deficitKd != null ? formatKwd(Number(kpis.deficitKd)) : '—'}
              </strong>
            </div>
            <div>
              <span>Prior revenue</span>
              <strong>
                {kpis?.prevPeriodActualKd != null ? formatKwd(Number(kpis.prevPeriodActualKd)) : '—'}
              </strong>
            </div>
          </div>
        </V2Panel>
      </div>

      <V2Panel title="Fleet ranking workbook" subtitle="Every machine · revenue, targets, cups, SX">
        <div className="v2FilterBar">
          <label className="v2Search">
            <span className="srOnly">Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machine…" />
          </label>
        </div>
        <V2DataTable
          columns={PERF_COLS}
          rows={tableRows}
          empty={<V2EmptyState title="No machines" description="No performance rows for this period." />}
          footer="Classic Performance fleet fields · Manus display"
        />
      </V2Panel>
    </div>
  );
}
