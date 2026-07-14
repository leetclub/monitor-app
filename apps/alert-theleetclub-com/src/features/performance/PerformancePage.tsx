import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import { formatSalesTrendPct } from '@/lib/salesDisplay';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { PromoSwipeDeck } from '@/features/performance/PromoSwipeDeck';
import { PerfMachineFilter } from '@/features/performance/PerfMachineFilter';
import { PerfOverviewSection } from '@/features/performance/PerfOverviewSection';
import {
  FleetCompareChart,
  FleetPerformanceOverview,
  GrowthRateChart,
  ProductTrajectoryChart,
  RevenueTrajectoryChart,
} from '@/features/performance/PerformanceCharts';
import type {
  FleetPayload,
  MachineRow,
  PerfDay,
  PerfPreset,
} from '@/features/performance/perfTypes';

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

type Snapshot = { rows?: Array<{ machineId?: string; machine_id?: string; machineName?: string }> };

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 48);
}

export function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const focusId = (params.get('machineId') || params.get('machine') || '').trim();
  const urlIds = parseIds(params.get('machineIds'));
  const [preset, setPreset] = useState<PerfPreset>('last_week');
  const [showCompare, setShowCompare] = useState(false);
  const [loadProducts, setLoadProducts] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(() =>
    urlIds.length ? new Set(urlIds) : focusId ? new Set([focusId]) : null,
  );
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

  const selectedIds = useMemo(() => {
    if (selected === null) return [];
    return [...selected].slice(0, 48);
  }, [selected]);

  const selectedKey = selectedIds.slice().sort().join(',');

  const syncUrl = (next: Set<string> | null) => {
    setSelected(next);
    const p = new URLSearchParams(params);
    if (next === null) {
      p.delete('machineIds');
      p.delete('machineId');
    } else if (next.size === 1) {
      const only = [...next][0];
      p.set('machineId', only);
      p.delete('machineIds');
    } else if (next.size > 1) {
      p.set('machineIds', [...next].join(','));
      p.delete('machineId');
    } else {
      p.delete('machineIds');
      p.delete('machineId');
    }
    setParams(p, { replace: true });
  };

  const fleetQ = useQuery({
    queryKey: [
      'alert-performance-fleet',
      selectedKey || 'auto',
      preset,
      loadProducts ? 'prod' : 'loc',
    ],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('preset', preset);
      qs.set('includeProducts', loadProducts ? '1' : '0');
      if (selected !== null && selectedKey) qs.set('machineIds', selectedKey);
      return apiGet<FleetPayload>(`/api/alert/performance/fleet?${qs.toString()}`);
    },
    enabled: selected === null || selectedIds.length > 0,
    staleTime: 90_000,
    refetchInterval: 3 * 60_000,
  });

  const singleId =
    selectedIds.length === 1 ? selectedIds[0] : focusId && selectedIds.includes(focusId) ? focusId : '';

  const detailQ = useQuery({
    queryKey: ['alert-performance', singleId, preset],
    queryFn: () =>
      apiGet<PerfPayload>(
        `/api/alert/performance/machine-detail?machineId=${encodeURIComponent(singleId)}&days=14`,
      ),
    enabled: Boolean(singleId),
    staleTime: 60_000,
  });

  const fleetMachines = fleetQ.data?.machines || [];
  const aggregateDays = fleetQ.data?.aggregateDays || [];
  const kpis = fleetQ.data?.kpis;
  const detail = detailQ.data;
  const multi = selectedIds.length !== 1;
  const win = fleetQ.data?.window;
  const windowLabel =
    win?.start && win?.end ? `${win.start} → ${win.end}` : undefined;
  const productLabel =
    fleetQ.data?.productName ||
    (fleetQ.data?.productNames?.length === 1 ? fleetQ.data.productNames[0] : undefined) ||
    (fleetMachines.find((m) => m.productName)?.productName ?? undefined) ||
    undefined;

  return (
    <div className="perfPage">
      <StitchOpsPanel
        title="Performance"
        subtitle="Overview trajectory · Target vs actual · Ranking — Targets Areas style"
        iconName="performance"
      >
        <div className="perfToolbar">
          <div className="perfModePills" role="group" aria-label="Extra chart views">
            <button
              type="button"
              className={`perfSegPill ${showCompare ? 'active' : ''}`}
              onClick={() => setShowCompare((v) => !v)}
            >
              {showCompare ? 'Hide compare lines' : 'Daily compare lines'}
            </button>
            <button
              type="button"
              className={`perfSegPill ${loadProducts ? 'active' : ''}`}
              onClick={() => setLoadProducts((v) => !v)}
              title="Product cups need Vendon reads — slower. Leave off for fast location KD."
            >
              {loadProducts ? 'Product cups on' : 'Load product cups'}
            </button>
          </div>
          <Link className="perfBackLink" to="/red-flags">
            ← Red Flags
          </Link>
        </div>

        {machinesQ.isError && !machineRows.length ? (
          <p className="perfError">Could not load machines: {(machinesQ.error as Error).message}</p>
        ) : null}

        <div className="perfLayout">
          <PerfMachineFilter machines={machineRows} selected={selected} onChange={syncUrl} />

          <div className="perfMain">
            {selected !== null && selected.size === 0 ? (
              <p className="perfMuted">Select one or more locations to plot.</p>
            ) : null}

            {fleetQ.isError ? <p className="perfError">{(fleetQ.error as Error).message}</p> : null}
            {fleetQ.data?.error ? <p className="perfError">{fleetQ.data.error}</p> : null}

            <PerfOverviewSection
              machines={fleetMachines}
              aggregateDays={aggregateDays}
              kpis={kpis}
              preset={preset}
              onPresetChange={setPreset}
              windowLabel={windowLabel}
              loading={fleetQ.isLoading}
            />

            {fleetMachines.length ? (
              <>
                <FleetPerformanceOverview
                  machines={fleetMachines}
                  aggregateDays={aggregateDays}
                  productLabel={productLabel}
                />

                {showCompare ? (
                  <section className="perfSection">
                    <h3 className="perfSectionTitle">Daily compare (lines)</h3>
                    <p className="perfSectionHint">
                      Overlay daily location KD for each selected machine (up to 12). Toggle series in
                      the legend.
                    </p>
                    <FleetCompareChart machines={fleetMachines} />
                  </section>
                ) : null}
              </>
            ) : null}

            {!multi && detail && !detail.error ? (
              <>
                <div className="perfKpiRow">
                  <div className="perfKpi">
                    <span className="perfKpiLabel">Location</span>
                    <strong>{detail.machineName}</strong>
                  </div>
                  <div className="perfKpi">
                    <span className="perfKpiLabel">Product</span>
                    <strong>{detail.productName || 'Americano Max'}</strong>
                  </div>
                  <div className="perfKpi">
                    <span className="perfKpiLabel">Loc SX</span>
                    <strong className={Number(detail.locationSxPct) >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                      {detail.locationSxPct != null
                        ? formatSalesTrendPct(Number(detail.locationSxPct)).replace(/%$/, ' pts')
                        : '—'}
                    </strong>
                  </div>
                  <div className="perfKpi">
                    <span className="perfKpiLabel">Prod SX</span>
                    <strong className={Number(detail.productSxPct) >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                      {detail.productSxPct != null
                        ? formatSalesTrendPct(Number(detail.productSxPct)).replace(/%$/, ' pts')
                        : '—'}
                    </strong>
                  </div>
                </div>

                {detail.vendonUserId ? (
                  <PromoSwipeDeck
                    vendonUserId={detail.vendonUserId}
                    vendonUserName={detail.vendonUserName}
                    machineId={detail.machineId}
                    machineName={detail.machineName}
                    productName={detail.productName || 'Americano Max'}
                    onLogged={() => {
                      void qc.invalidateQueries({ queryKey: ['alert-promo-swipe-events'] });
                    }}
                  />
                ) : null}

                <section className="perfSection">
                  <h3 className="perfSectionTitle">Revenue Trajectory</h3>
                  <RevenueTrajectoryChart days={detail.days || []} />
                </section>
                <section className="perfSection">
                  <h3 className="perfSectionTitle">Product Trajectory · {detail.productName}</h3>
                  <ProductTrajectoryChart
                    days={detail.days || []}
                    productName={detail.productName || 'Americano Max'}
                  />
                </section>
                <section className="perfSection">
                  <h3 className="perfSectionTitle">Day growth rates</h3>
                  <GrowthRateChart days={detail.days || []} />
                </section>
              </>
            ) : null}

            {!multi && detailQ.isLoading ? <p className="perfMuted">Loading location detail…</p> : null}
            {!multi && detailQ.isError ? (
              <p className="perfError">{(detailQ.error as Error).message}</p>
            ) : null}
          </div>
        </div>
      </StitchOpsPanel>
    </div>
  );
}
