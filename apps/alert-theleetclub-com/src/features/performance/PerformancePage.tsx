import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import { MachineProductSalesModal } from '@/components/MachineProductSalesModal';
import { formatSalesTrendPct } from '@/lib/salesDisplay';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { V2Panel } from '@/features/v2/v2Ui';
import { PromoSwipeDeck } from '@/features/performance/PromoSwipeDeck';
import { PerfMachineFilter } from '@/features/performance/PerfMachineFilter';
import { PerfOverviewSection } from '@/features/performance/PerfOverviewSection';
import { fetchFleetBatched } from '@/features/performance/fetchFleetBatched';
import { rebuildFleetKpis } from '@/features/performance/rebuildFleetKpis';
import {
  FleetCompareChart,
  FleetPerformanceOverview,
  GrowthRateChart,
  ProductTrajectoryChart,
  RevenueTrajectoryChart,
} from '@/features/performance/PerformanceCharts';
import { PerfProductsSection, PERF_PRODUCTS_MAX_LOCATIONS } from '@/features/performance/PerfProductsSection';
import type {
  FleetPayload,
  MachineRow,
  PerfDay,
  PerfPreset,
} from '@/features/performance/perfTypes';

type PerfWorkspace = 'location' | 'products';

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
    .filter(Boolean);
}

/** Hide junk / test rows: names starting with a digit or with * (e.g. "*8 …"). */
function isExcludedLocationName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return /^\d/.test(n) || n.startsWith('*');
}

function writeMachineParams(p: URLSearchParams, next: Set<string> | null) {
  if (next === null) {
    p.delete('machineIds');
    p.delete('machineId');
  } else if (next.size === 1) {
    p.set('machineId', [...next][0]);
    p.delete('machineIds');
  } else if (next.size > 1) {
    p.set('machineIds', [...next].join(','));
    p.delete('machineId');
  } else {
    p.delete('machineIds');
    p.delete('machineId');
  }
}

function capProductsSelection(
  source: Set<string> | null,
  machines: MachineRow[],
  max: number,
): Set<string> {
  const allowed = new Set(machines.map((m) => m.id));
  if (source === null) {
    return new Set(machines.slice(0, max).map((m) => m.id));
  }
  const kept = [...source].filter((id) => allowed.has(id));
  if (!kept.length) return new Set(machines.slice(0, max).map((m) => m.id));
  return new Set(kept.slice(0, max));
}

export function PerformancePage({
  variant = 'classic',
}: {
  variant?: 'classic' | 'manus';
} = {}) {
  const manus = variant === 'manus';
  const [params, setParams] = useSearchParams();
  const focusId = (params.get('machineId') || params.get('machine') || '').trim();
  const urlIds = parseIds(params.get('machineIds'));
  const workspace: PerfWorkspace = params.get('view') === 'products' ? 'products' : 'location';
  const [preset, setPreset] = useState<PerfPreset>('last_week');
  const [showCompare, setShowCompare] = useState(false);
  const [loadProducts, setLoadProducts] = useState(false);
  /** Location tab selection — default All; ignore Products URL machine picks. */
  const [selected, setSelected] = useState<Set<string> | null>(() => {
    if (params.get('view') === 'products') return null;
    if (urlIds.length) return new Set(urlIds);
    if (focusId) return new Set([focusId]);
    return null;
  });
  /** Products keeps its own location picks so Location stays All (or prior Location picks). */
  const [productsSelected, setProductsSelected] = useState<Set<string> | null>(() => {
    if (params.get('view') !== 'products') return null;
    if (urlIds.length) return new Set(urlIds);
    if (focusId) return new Set([focusId]);
    return null;
  });
  const [productMix, setProductMix] = useState<{ machineId: string; machineName: string } | null>(
    null,
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
    const out: MachineRow[] = [];
    for (const m of raw as Array<Record<string, unknown>>) {
      const id = String(m.id ?? m.machineId ?? m.machine_id ?? '').trim();
      if (!id) continue;
      const name = String(m.name ?? m.machineName ?? m.machine_name ?? '').trim();
      out.push({ id, name: name || id });
    }
    return out;
  }, [machinesQ.data]);

  const machineRows = useMemo(() => {
    const byId = new Map<string, MachineRow>();
    for (const m of apiMachines) byId.set(m.id, m);

    const rows = snapQ.data?.rows;
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const id = String(r.machineId ?? r.machine_id ?? '').trim();
        if (!id) continue;
        const snapName = String(r.machineName || '').trim();
        const prev = byId.get(id);
        if (!prev) {
          byId.set(id, { id, name: snapName || id });
        } else if (snapName && (prev.name === prev.id || !prev.name.trim())) {
          byId.set(id, { id, name: snapName });
        }
      }
    }

    const out = [...byId.values()]
      .filter((m) => !isExcludedLocationName(m.name || m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [apiMachines, snapQ.data?.rows]);

  const selectedIds = useMemo(() => {
    if (selected === null) return machineRows.map((m) => m.id);
    return [...selected].filter((id) => machineRows.some((m) => m.id === id));
  }, [selected, machineRows]);

  const selectedKey = useMemo(() => {
    if (selected === null) return `all:${machineRows.map((m) => m.id).sort().join(',')}`;
    return selectedIds.slice().sort().join(',');
  }, [selected, selectedIds, machineRows]);

  const syncUrl = (next: Set<string> | null) => {
    setSelected(next);
    const p = new URLSearchParams(params);
    writeMachineParams(p, next);
    setParams(p, { replace: true });
  };

  const syncProductsUrl = (next: Set<string> | null) => {
    setProductsSelected(next);
    const p = new URLSearchParams(params);
    writeMachineParams(p, next);
    setParams(p, { replace: true });
  };

  const setWorkspace = (next: PerfWorkspace) => {
    const p = new URLSearchParams(params);
    if (next === 'products') {
      p.set('view', 'products');
      const capped = capProductsSelection(
        productsSelected ?? selected,
        machineRows,
        PERF_PRODUCTS_MAX_LOCATIONS,
      );
      setProductsSelected(capped);
      writeMachineParams(p, capped);
    } else {
      p.delete('view');
      // Location default is All unless the user already narrowed it on Location.
      writeMachineParams(p, selected);
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
    queryFn: async (): Promise<FleetPayload> => {
      const ids =
        selected === null
          ? machineRows.map((m) => m.id)
          : selectedIds;
      if (!ids.length) return { machines: [], aggregateDays: [], machineCount: 0 };
      const nameById = Object.fromEntries(machineRows.map((m) => [m.id, m.name]));
      const payload = await fetchFleetBatched({
        machineIds: ids,
        preset,
        includeProducts: loadProducts,
        nameById,
      });
      return {
        ...payload,
        kpis: rebuildFleetKpis(payload.machines || [], payload.kpis),
      };
    },
    enabled:
      workspace === 'location' &&
      ((selected === null && machineRows.length > 0) || selectedIds.length > 0),
    staleTime: 90_000,
    refetchInterval: 3 * 60_000,
  });

  const singleId =
    selected !== null && selectedIds.length === 1
      ? selectedIds[0]
      : focusId && selected !== null && selectedIds.includes(focusId)
        ? focusId
        : '';

  const detailQ = useQuery({
    queryKey: ['alert-performance', singleId, preset],
    queryFn: () =>
      apiGet<PerfPayload>(
        `/api/alert/performance/machine-detail?machineId=${encodeURIComponent(singleId)}&days=14`,
      ),
    enabled: workspace === 'location' && Boolean(singleId),
    staleTime: 60_000,
  });

  const fleetMachines = useMemo(() => {
    const rows = fleetQ.data?.machines || [];
    if (!rows.length || !machineRows.length) return rows;
    const byId = new Map(machineRows.map((m) => [m.id, m.name]));
    return rows.map((m) => {
      const name = byId.get(String(m.machineId));
      return name ? { ...m, machineName: name } : m;
    });
  }, [fleetQ.data?.machines, machineRows]);

  /** Prefer real names for the Locations dropdown (API + snapshot + fleet). */
  const filterMachines = useMemo(() => {
    const byId = new Map(machineRows.map((m) => [m.id, { ...m }]));
    for (const m of fleetMachines) {
      const id = String(m.machineId || '').trim();
      if (!id) continue;
      const fleetName = String(m.machineName || '').trim();
      if (!fleetName || fleetName === id) continue;
      const prev = byId.get(id);
      if (!prev) byId.set(id, { id, name: fleetName });
      else if (!prev.name.trim() || prev.name === id) byId.set(id, { id, name: fleetName });
    }
    return [...byId.values()]
      .filter((m) => !isExcludedLocationName(m.name || m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [machineRows, fleetMachines]);

  const productsSelectedIds = useMemo(() => {
    if (!productsSelected) return [];
    return [...productsSelected].filter((id) => filterMachines.some((m) => m.id === id));
  }, [productsSelected, filterMachines]);

  useEffect(() => {
    if (workspace !== 'products') return;
    if (!filterMachines.length) return;
    if (productsSelected !== null) return;
    const capped = capProductsSelection(selected, filterMachines, PERF_PRODUCTS_MAX_LOCATIONS);
    setProductsSelected(capped);
  }, [workspace, filterMachines, productsSelected, selected]);

  const aggregateDays = fleetQ.data?.aggregateDays || [];
  const kpis = useMemo(() => {
    const base = fleetQ.data?.kpis;
    if (!base?.growthVsPrev && !base?.growthVsYoy) return base;
    const byId = new Map(fleetMachines.map((m) => [String(m.machineId), m.machineName]));
    const fixGroup = (g: typeof base.growthVsPrev) => {
      if (!g) return g;
      const next = { ...g };
      for (const key of Object.keys(next) as Array<keyof typeof next>) {
        const slice = next[key];
        if (!slice?.machines?.length) continue;
        next[key] = {
          ...slice,
          machines: slice.machines.map((row) => {
            const name = byId.get(String(row.machineId));
            return name ? { ...row, machineName: name } : row;
          }),
        };
      }
      return next;
    };
    return {
      ...base,
      growthVsPrev: fixGroup(base.growthVsPrev),
      growthVsYoy: fixGroup(base.growthVsYoy),
    };
  }, [fleetQ.data?.kpis, fleetMachines]);
  const detail = detailQ.data;
  const multi = selected === null || selectedIds.length !== 1;
  const fleetRanking = selected === null || selectedIds.length > 5;
  const selectionLabel =
    selected === null
      ? `All (${filterMachines.length || machineRows.length})`
      : selectedIds.length === 1
        ? '1 location'
        : `${selectedIds.length} locations`;
  const win = fleetQ.data?.window;
  const windowLabel =
    win?.start && win?.end ? `${win.start} → ${win.end}` : undefined;
  const productLabel =
    fleetQ.data?.productName ||
    (fleetQ.data?.productNames?.length === 1 ? fleetQ.data.productNames[0] : undefined) ||
    (fleetMachines.find((m) => m.productName)?.productName ?? undefined) ||
    undefined;

  const hasTargetData = useMemo(() => {
    if (kpis?.machinesWithTarget != null && kpis.machinesWithTarget > 0) return true;
    if ((kpis?.periodTargetKd ?? 0) > 0) return true;
    return (
      fleetMachines.some((m) => (m.periodTargetKd ?? 0) > 0 || (m.periodProductTargetCups ?? 0) > 0) ||
      aggregateDays.some(
        (d) => (d.locationTargetKd ?? 0) > 0 || (d.productTargetCups ?? 0) > 0,
      )
    );
  }, [fleetMachines, aggregateDays, kpis]);

  const boardInner = (
    <>
        <div className="perfToolbar">
          <Link className="perfBackLink" to={manus ? '/v2/red-flags' : '/red-flags'}>
            ← Red Flags
          </Link>
          <div className="perfModePills" role="group" aria-label="Performance workspace">
            <button
              type="button"
              className={`perfSegPill ${workspace === 'location' ? 'active' : ''}`}
              aria-pressed={workspace === 'location'}
              onClick={() => setWorkspace('location')}
            >
              Location
            </button>
            <button
              type="button"
              className={`perfSegPill ${workspace === 'products' ? 'active' : ''}`}
              aria-pressed={workspace === 'products'}
              onClick={() => setWorkspace('products')}
            >
              Products
            </button>
          </div>
          {workspace === 'location' ? (
          <button
            type="button"
            className="perfSegPill perfSegPillEmphasis"
            disabled={!filterMachines.length}
            title="Search any location for product mix (KD by day / week / month)"
            onClick={() => {
              const id =
                (selectedIds.length === 1 ? selectedIds[0] : null) ||
                selectedIds[0] ||
                filterMachines[0]?.id ||
                '';
              if (!id) return;
              const hit = filterMachines.find((m) => m.id === id) || machineRows.find((m) => m.id === id);
              setProductMix({
                machineId: id,
                machineName: hit?.name || id,
              });
            }}
          >
            Product mix…
          </button>
          ) : null}
        </div>

        {machinesQ.isError && !machineRows.length ? (
          <p className="perfError">Could not load machines: {(machinesQ.error as Error).message}</p>
        ) : null}

        <div className="perfLayout">
          <PerfMachineFilter
            machines={filterMachines}
            selected={workspace === 'products' ? productsSelected : selected}
            onChange={workspace === 'products' ? syncProductsUrl : syncUrl}
            maxSelected={workspace === 'products' ? PERF_PRODUCTS_MAX_LOCATIONS : undefined}
            narrowFromAll={workspace === 'products'}
            hint={
              workspace === 'products'
                ? `Select all picks ${PERF_PRODUCTS_MAX_LOCATIONS} locations (the cap). Check more only after unchecking one.`
                : undefined
            }
          />

          <div className="perfMain">
            {((workspace === 'products' ? productsSelected : selected) !== null &&
              (workspace === 'products' ? productsSelected!.size : selected!.size) === 0) ? (
              <p className="perfMuted">Select one or more locations to plot.</p>
            ) : null}

            {workspace === 'products' ? (
              <PerfProductsSection
                machines={filterMachines.length ? filterMachines : machineRows}
                selectedIds={productsSelectedIds}
                allSelected={false}
              />
            ) : (
              <>
            {fleetQ.isError ? <p className="perfError">{(fleetQ.error as Error).message}</p> : null}
            {fleetQ.data?.error ? <p className="perfError">{fleetQ.data.error}</p> : null}

            {fleetMachines.length > 0 && !fleetQ.isLoading && !hasTargetData ? (
              <p className="perfTargetBanner" role="status">
                <strong>No targets on these charts yet.</strong> Sales lines and bars still plot, but
                dashed target lines and gray target bars need a location KD (and optional product cups)
                in <strong>Admin → Targets</strong>, or a matching name in the weekly revenue target
                sheet. Red Flags <strong>Target</strong> column shows today % only — full sales vs
                target graphs live on this tab (scroll to <strong>Performance charts</strong>).
              </p>
            ) : null}

            <PerfOverviewSection
              machines={fleetMachines}
              aggregateDays={aggregateDays}
              kpis={kpis}
              preset={preset}
              onPresetChange={setPreset}
              windowLabel={windowLabel}
              windowMeta={win}
              loading={fleetQ.isLoading}
              fleetRanking={fleetRanking}
              selectionLabel={selectionLabel}
              onOpenMachineProducts={(machineId, machineName) =>
                setProductMix({ machineId, machineName })
              }
            />

            {fleetMachines.length ? (
              <>
                <div className="perfMoreChartsBar" aria-label="Optional charts below">
                  <div className="perfMoreChartsBarText">
                    <h3 className="perfSectionTitle">More charts</h3>
                    <p className="perfSectionHint">
                      Controls for the ranking / daily / product sections below — not for Trajectory
                      above.
                    </p>
                  </div>
                  <div className="perfModePills" role="group" aria-label="Optional lower charts">
                    <button
                      type="button"
                      className={`perfSegPill ${loadProducts ? 'active' : ''}`}
                      onClick={() => setLoadProducts((v) => !v)}
                      title="Product cups need Vendon reads — slower. Leave off for fast location KD."
                    >
                      {loadProducts ? 'Product cups on' : 'Load product cups'}
                    </button>
                    <button
                      type="button"
                      className={`perfSegPill ${showCompare ? 'active' : ''}`}
                      onClick={() => setShowCompare((v) => !v)}
                    >
                      {showCompare ? 'Hide daily compare' : 'Show daily compare lines'}
                    </button>
                  </div>
                </div>

                <FleetPerformanceOverview
                  machines={fleetMachines}
                  aggregateDays={aggregateDays}
                  productLabel={productLabel}
                  productCupsEnabled={loadProducts}
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
                  <button
                    type="button"
                    className="perfKpi perfKpiClick"
                    onClick={() =>
                      setProductMix({
                        machineId: detail.machineId,
                        machineName: detail.machineName,
                      })
                    }
                    title="Open product mix (day / week / month + YoY)"
                  >
                    <span className="perfKpiLabel">Location sales · product mix</span>
                    <strong>{detail.machineName}</strong>
                    <span className="perfKpiHint">Tap for day / week / month products + YoY</span>
                  </button>
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
              </>
            )}
          </div>
        </div>

        {productMix ? (
          <MachineProductSalesModal
            machineId={productMix.machineId}
            machineName={productMix.machineName}
            machines={filterMachines.length ? filterMachines : machineRows}
            onClose={() => setProductMix(null)}
          />
        ) : null}
    </>
  );

  if (manus) {
    return (
      <div className="perfPage v2ManusBoard">
        <V2Panel
          title="Performance workbook"
          subtitle="Same Classic filters — Location graphs or Product compare"
        >
          {boardInner}
        </V2Panel>
      </div>
    );
  }

  return (
    <div className="perfPage">
      <StitchOpsPanel
        title="Performance"
        subtitle="Location vs target · Product compare"
        iconName="performance"
      >
        {boardInner}
      </StitchOpsPanel>
    </div>
  );
}
