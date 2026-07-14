import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { MachineSearchSelect } from '@/components/MachineSearchSelect';
import { PromoSwipeDeck } from '@/features/performance/PromoSwipeDeck';
import {
  GrowthRateChart,
  ProductTrajectoryChart,
  RevenueTrajectoryChart,
  type PerfDay,
} from '@/features/performance/PerformanceCharts';

type PerfPayload = {
  machineId: string;
  machineName: string;
  productName: string;
  targetPeriod?: string;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  locationSxPct?: number | null;
  productSxPct?: number | null;
  vendonUserId?: string | null;
  vendonUserName?: string | null;
  days?: PerfDay[];
  error?: string;
};

type MachineRow = { id: string; name: string };
type Snapshot = { rows?: Array<{ machineId?: string; machine_id?: string; machineName?: string }> };

export function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const machineId = (params.get('machineId') || params.get('machine') || '').trim();
  const [days, setDays] = useState(14);
  const qc = useQueryClient();

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines?: MachineRow[]; rows?: MachineRow[] }>('/api/alert/machines'),
    staleTime: 5 * 60_000,
    retry: 2,
  });

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 60_000,
  });

  const apiMachines = useMemo(() => {
    const raw = machinesQ.data?.machines || machinesQ.data?.rows || [];
    return raw
      .map((m) => ({ id: String(m.id), name: String(m.name || m.id) }))
      .filter((m) => m.id);
  }, [machinesQ.data]);

  const machineRows = useMemo(() => {
    if (apiMachines.length > 0) return apiMachines;
    const rows = snapQ.data?.rows;
    if (!Array.isArray(rows) || !rows.length) return [];
    const seen = new Set<string>();
    const out: MachineRow[] = [];
    for (const r of rows) {
      const id = String(r.machineId ?? r.machine_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(r.machineName || id) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [apiMachines, snapQ.data?.rows]);

  const fromSnapshot = machineRows.length > 0 && apiMachines.length === 0;
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
  const machinesLoading = machinesQ.isLoading && snapQ.isLoading;

  return (
    <div className="perfPage">
      <StitchOpsPanel
        title="Performance"
        subtitle="Location + product sales vs targets · Revenue Trajectory · Promo instruments"
        iconName="performance"
      >
        <div className="perfToolbar">
          <MachineSearchSelect
            label="Location"
            machines={machineNames}
            value={selectedName}
            disabled={machinesLoading}
            onSelect={(name) => {
              const id = idByName.get(name) || '';
              const next = new URLSearchParams(params);
              if (id) next.set('machineId', id);
              else next.delete('machineId');
              setParams(next, { replace: true });
            }}
            placeholder={machinesLoading ? 'Loading machines…' : 'Search machine…'}
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

        {machinesQ.isError && !machineRows.length ? (
          <p className="perfError">
            Could not load machines: {(machinesQ.error as Error).message}. Try Refresh on Red Flags, then reopen
            Performance.
          </p>
        ) : null}
        {fromSnapshot ? (
          <p className="perfMuted">Machine list from Red Flags snapshot (Vendon fleet list empty).</p>
        ) : null}
        {!machinesLoading && !machineRows.length ? (
          <p className="perfError">No machines available. Open Red Flags once so the snapshot can seed the list.</p>
        ) : null}
        {machinesLoading ? <p className="perfMuted">Loading machine list…</p> : null}

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
                  {data.locationSxPct != null
                    ? formatSalesTrendPct(Number(data.locationSxPct)).replace(/%$/, ' pts')
                    : '—'}
                </strong>
              </div>
              <div className="perfKpi">
                <span className="perfKpiLabel">Prod SX</span>
                <strong className={Number(data.productSxPct) >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                  {data.productSxPct != null
                    ? formatSalesTrendPct(Number(data.productSxPct)).replace(/%$/, ' pts')
                    : '—'}
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

            {data.vendonUserId ? (
              <PromoSwipeDeck
                vendonUserId={data.vendonUserId}
                vendonUserName={data.vendonUserName}
                machineId={data.machineId}
                machineName={data.machineName}
                productName={data.productName || 'Americano Max'}
                onLogged={() => {
                  void qc.invalidateQueries({ queryKey: ['alert-promo-swipe-events'] });
                }}
              />
            ) : (
              <p className="perfMuted">
                Promo instruments need an area owner on this machine (Admin → Area owners).
              </p>
            )}

            <section className="perfSection" aria-label="Revenue Trajectory">
              <h3 className="perfSectionTitle">Revenue Trajectory</h3>
              <p className="perfSectionHint">
                Daily location KD — teal bars = achieved, hollow stack = remaining to daily target, amber dashed =
                target line.
              </p>
              <RevenueTrajectoryChart days={dayRows} />
            </section>

            <section className="perfSection" aria-label="Product trajectory">
              <h3 className="perfSectionTitle">Product Trajectory · {data.productName}</h3>
              <p className="perfSectionHint">Daily cups for the promoted product vs product target.</p>
              <ProductTrajectoryChart days={dayRows} productName={data.productName || 'Americano Max'} />
            </section>

            <section className="perfSection" aria-label="Growth rates">
              <h3 className="perfSectionTitle">Day growth rates</h3>
              <p className="perfSectionHint">
                Location vs product day-over-day growth % — zero line = flat; used with SX (acceleration).
              </p>
              <GrowthRateChart days={dayRows} />
            </section>

            <section className="perfSection" aria-label="Growth table">
              <h3 className="perfSectionTitle">Day detail</h3>
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
