import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { MachineSearchSelect } from '@/components/MachineSearchSelect';

type PerfDay = {
  date: string;
  weekday?: string;
  locationKwd: number;
  productCups: number;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  locationGrowthPct?: number | null;
  productGrowthPct?: number | null;
  locationPctOfTarget?: number | null;
  productPctOfTarget?: number | null;
};

type PerfPayload = {
  machineId: string;
  machineName: string;
  productName: string;
  targetPeriod?: string;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  locationSxPct?: number | null;
  productSxPct?: number | null;
  days?: PerfDay[];
  error?: string;
};

type MachineRow = { id: string; name: string };

function RevenueTrajectoryChart({
  days,
  mode,
}: {
  days: PerfDay[];
  mode: 'location' | 'product';
}) {
  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  const maxVal = Math.max(
    1,
    ...days.map((d) =>
      mode === 'location'
        ? Math.max(d.locationKwd, Number(d.locationTargetKd) || 0)
        : Math.max(d.productCups, Number(d.productTargetCups) || 0),
    ),
  );
  const h = 120;
  const gap = 4;
  const barW = Math.max(10, Math.min(28, Math.floor(560 / days.length) - gap));

  return (
    <div className="perfChartScroll" role="img" aria-label={mode === 'location' ? 'Revenue Trajectory' : 'Product cups trajectory'}>
      <svg className="perfChartSvg" viewBox={`0 0 ${days.length * (barW + gap) + 8} ${h + 28}`} width="100%">
        {days.map((d, i) => {
          const x = 4 + i * (barW + gap);
          const actual = mode === 'location' ? d.locationKwd : d.productCups;
          const target =
            mode === 'location' ? Number(d.locationTargetKd) || 0 : Number(d.productTargetCups) || 0;
          const actualH = Math.round((actual / maxVal) * h);
          const targetH = target > 0 ? Math.round((target / maxVal) * h) : 0;
          const remH = Math.max(0, targetH - actualH);
          return (
            <g key={d.date}>
              {targetH > 0 ? (
                <rect
                  x={x}
                  y={h - targetH}
                  width={barW}
                  height={targetH}
                  rx={3}
                  className="perfBarTarget"
                />
              ) : null}
              <rect
                x={x}
                y={h - actualH}
                width={barW}
                height={actualH}
                rx={3}
                className="perfBarActual"
              />
              {remH > 0 ? (
                <rect
                  x={x}
                  y={h - targetH}
                  width={barW}
                  height={remH}
                  rx={3}
                  className="perfBarRemain"
                />
              ) : null}
              <text x={x + barW / 2} y={h + 12} textAnchor="middle" className="perfBarLabel">
                {(d.weekday || d.date.slice(5)).slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="perfChartLegend">
        <span>
          <i className="perfDot perfDotActual" /> Achieved
        </span>
        <span>
          <i className="perfDot perfDotRemain" /> To target
        </span>
      </div>
    </div>
  );
}

export function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const machineId = (params.get('machineId') || params.get('machine') || '').trim();
  const [days, setDays] = useState(14);

  const machinesQ = useQuery({
    queryKey: ['alert-machines-perf'],
    queryFn: () => apiGet<{ machines?: MachineRow[]; rows?: MachineRow[] }>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });

  const machineRows = useMemo(() => {
    const raw = machinesQ.data?.machines || machinesQ.data?.rows || [];
    return raw
      .map((m) => ({ id: String(m.id), name: String(m.name || m.id) }))
      .filter((m) => m.id);
  }, [machinesQ.data]);

  const machineNames = useMemo(() => machineRows.map((m) => m.name), [machineRows]);
  const idByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of machineRows) map.set(m.name, m.id);
    return map;
  }, [machineRows]);
  const selectedName = useMemo(
    () => machineRows.find((m) => m.id === machineId)?.name || '',
    [machineRows, machineId],
  );

  const perfQ = useQuery({
    queryKey: ['alert-performance', machineId, days],
    queryFn: () =>
      apiGet<PerfPayload>(
        `/api/alert/performance/machine-detail?machineId=${encodeURIComponent(machineId)}&days=${days}`,
      ),
    enabled: Boolean(machineId),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });

  const data = perfQ.data;
  const dayRows = data?.days || [];

  return (
    <div className="perfPage">
      <StitchOpsPanel
        title="Performance"
        subtitle="Location + product sales vs targets · Revenue Trajectory · Sales Acceleration"
        iconName="performance"
      >
        <div className="perfToolbar">
          <MachineSearchSelect
            label="Location"
            machines={machineNames}
            value={selectedName}
            disabled={machinesQ.isLoading}
            onSelect={(name) => {
              const id = idByName.get(name) || '';
              const next = new URLSearchParams(params);
              if (id) next.set('machineId', id);
              else next.delete('machineId');
              setParams(next, { replace: true });
            }}
            placeholder="Search machine…"
          />
          <label className="perfField">
            <span>Days</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
            </select>
          </label>
          <Link className="perfBackLink" to="/red-flags">
            ← Red Flags
          </Link>
        </div>

        {!machineId ? (
          <p className="perfMuted">Select a location (or tap SX on Red Flags) to open Performance.</p>
        ) : null}

        {machineId && perfQ.isLoading ? <p className="perfMuted">Loading trajectory…</p> : null}
        {machineId && perfQ.isError ? (
          <p className="perfError">{(perfQ.error as Error).message}</p>
        ) : null}
        {data?.error ? <p className="perfError">{data.error}</p> : null}

        {data && !data.error ? (
          <>
            <div className="perfKpiRow">
              <div className="perfKpi">
                <span className="perfKpiLabel">Location</span>
                <strong>{data.machineName}</strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Product</span>
                <strong>{data.productName || 'Americano Max'}</strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Period</span>
                <strong>{data.targetPeriod || 'daily'}</strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Loc SX</span>
                <strong className={Number(data.locationSxPct) >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                  {data.locationSxPct != null ? formatSalesTrendPct(Number(data.locationSxPct)).replace(/%$/, ' pts') : '—'}
                </strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Prod SX</span>
                <strong className={Number(data.productSxPct) >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                  {data.productSxPct != null ? formatSalesTrendPct(Number(data.productSxPct)).replace(/%$/, ' pts') : '—'}
                </strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Loc target</span>
                <strong>{data.locationTargetKd != null ? formatKwd(Number(data.locationTargetKd)) : '—'}</strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Prod target</span>
                <strong>
                  {data.productTargetCups != null ? `${Math.round(Number(data.productTargetCups))} cups` : '—'}
                </strong>
              </div>
            </div>

            <section className="perfSection" aria-label="Revenue Trajectory">
              <h3 className="perfSectionTitle">Revenue Trajectory</h3>
              <p className="perfSectionHint">Daily location KD — filled = achieved, hollow grey = remaining to daily target.</p>
              <RevenueTrajectoryChart days={dayRows} mode="location" />
            </section>

            <section className="perfSection" aria-label="Product trajectory">
              <h3 className="perfSectionTitle">Product Trajectory · {data.productName}</h3>
              <p className="perfSectionHint">Daily cups for the promoted product vs product target.</p>
              <RevenueTrajectoryChart days={dayRows} mode="product" />
            </section>

            <section className="perfSection" aria-label="Growth table">
              <h3 className="perfSectionTitle">Day growth rates</h3>
              <div className="perfTableWrap">
                <table className="stitchOpsTable opsFleetTable perfTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Loc KD</th>
                      <th>Loc G%</th>
                      <th>vs target</th>
                      <th>Prod cups</th>
                      <th>Prod G%</th>
                      <th>vs target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dayRows].reverse().map((d) => (
                      <tr key={d.date}>
                        <td data-mono="true">
                          {d.weekday} {d.date}
                        </td>
                        <td data-mono="true">{formatKwd(d.locationKwd)}</td>
                        <td data-mono="true">
                          {d.locationGrowthPct != null ? formatSalesTrendPct(d.locationGrowthPct) : '—'}
                        </td>
                        <td data-mono="true">
                          {d.locationPctOfTarget != null ? `${d.locationPctOfTarget}%` : '—'}
                        </td>
                        <td data-mono="true">{d.productCups}</td>
                        <td data-mono="true">
                          {d.productGrowthPct != null ? formatSalesTrendPct(d.productGrowthPct) : '—'}
                        </td>
                        <td data-mono="true">
                          {d.productPctOfTarget != null ? `${d.productPctOfTarget}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </StitchOpsPanel>
    </div>
  );
}
