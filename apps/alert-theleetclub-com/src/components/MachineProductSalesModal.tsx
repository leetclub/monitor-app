import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { MachineIdSearchSelect } from '@/components/MachineSearchSelect';
import {
  formatCupsN,
  normalizeProductRow,
  productCups,
  productDisplayName,
  productRevenueKwd,
  type MachineProductGrain,
  type MachineProductRow,
  type MachineProductsResponse,
} from '@/lib/productMixDisplay';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import {
  compareNumbers,
  compareStrings,
  cycleColumnSort,
  sortDirForColumn,
  type ColumnSortState,
} from '@/lib/tableColumnSort';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

type GrainKey = 'day' | 'week' | 'month';
type SortKey = 'name' | 'revenue' | 'prevRevenue' | 'trendPct' | 'yoyRevenue' | 'yoyTrendPct' | 'cups';

const GRAIN_TABS: Array<{ id: GrainKey; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function formatKwdCell(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  return formatKwd(Number(x));
}

function trendClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  return Number(pct) >= 0 ? 'alertSalesUp' : 'alertSalesDown';
}

function trendText(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  return formatSalesTrendPct(Number(pct));
}

function SortTh({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: SortKey;
  sort: ColumnSortState<SortKey>;
  onSort: (k: SortKey) => void;
}) {
  const dir = sortDirForColumn(sort, col);
  const glyph = dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '⇅';
  return (
    <th>
      <button type="button" className="perfSortThBtn" onClick={() => onSort(col)}>
        {label} {glyph}
      </button>
    </th>
  );
}

function NameList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ name: string; revenueKwd?: number }>;
  empty: string;
}) {
  return (
    <section className="productMixPanel">
      <h3 className="salesHistoryCompareTitle">{title}</h3>
      {items.length ? (
        <ol className="productExtremesList">
          {items.map((p) => (
            <li key={`${title}-${p.name}`}>
              <span>{p.name}</span>
              {p.revenueKwd != null ? (
                <span className="productMixCups">{formatKwdCell(p.revenueKwd)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="salesHistoryNote">{empty}</p>
      )}
    </section>
  );
}

type YoySortKey = 'name' | 'revenue' | 'yoyRevenue' | 'yoyTrendPct';

function YoyCompareTable({
  rows,
}: {
  rows: Array<{
    name?: string | null;
    revenueKwd?: number | null;
    yoyRevenueKwd?: number | null;
    yoyTrendPct?: number | null;
  }>;
}) {
  const [sort, setSort] = useState<ColumnSortState<YoySortKey>>({ column: 'revenue', dir: 'desc' });
  const sorted = useMemo(() => {
    const out = [...rows];
    const col = sort.column;
    const dir = sort.dir;
    if (!col || !dir) return out;
    out.sort((a, b) => {
      switch (col) {
        case 'name':
          return compareStrings(productDisplayName(a), productDisplayName(b), dir);
        case 'revenue':
          return compareNumbers(a.revenueKwd, b.revenueKwd, dir);
        case 'yoyRevenue':
          return compareNumbers(a.yoyRevenueKwd, b.yoyRevenueKwd, dir);
        case 'yoyTrendPct':
          return compareNumbers(a.yoyTrendPct, b.yoyTrendPct, dir);
        default:
          return 0;
      }
    });
    return out;
  }, [rows, sort]);

  return (
    <section className="productMixPanel" style={{ marginTop: 12 }}>
      <h3 className="salesHistoryCompareTitle">Top 5 vs last year · KD</h3>
      <p className="salesHistoryNote" style={{ marginTop: 0 }}>
        Ranked by sales revenue. Tap headers to sort.
      </p>
      <div className="perfGrowthTableWrap">
        <table className="perfGrowthTable">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'name'))}
                >
                  Product{' '}
                  {sortDirForColumn(sort, 'name') === 'desc'
                    ? '▼'
                    : sortDirForColumn(sort, 'name') === 'asc'
                      ? '▲'
                      : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'revenue'))}
                >
                  KD{' '}
                  {sortDirForColumn(sort, 'revenue') === 'desc'
                    ? '▼'
                    : sortDirForColumn(sort, 'revenue') === 'asc'
                      ? '▲'
                      : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'yoyRevenue'))}
                >
                  LY KD{' '}
                  {sortDirForColumn(sort, 'yoyRevenue') === 'desc'
                    ? '▼'
                    : sortDirForColumn(sort, 'yoyRevenue') === 'asc'
                      ? '▲'
                      : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'yoyTrendPct'))}
                >
                  YoY{' '}
                  {sortDirForColumn(sort, 'yoyTrendPct') === 'desc'
                    ? '▼'
                    : sortDirForColumn(sort, 'yoyTrendPct') === 'asc'
                      ? '▲'
                      : '⇅'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length ? (
              sorted.map((p) => (
                <tr key={`yoy-${p.name}`}>
                  <td>{productDisplayName(p)}</td>
                  <td>{formatKwdCell(p.revenueKwd)}</td>
                  <td>{formatKwdCell(p.yoyRevenueKwd)}</td>
                  <td className={trendClass(p.yoyTrendPct)}>{trendText(p.yoyTrendPct)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No YoY compare yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MachineProductSalesModal({
  machineId: initialMachineId,
  machineName: initialMachineName,
  machines = [],
  onClose,
}: {
  machineId: string;
  machineName: string;
  /** Full fleet — search any location, not only the growth-compare subset. */
  machines?: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const [grain, setGrain] = useState<GrainKey>('day');
  const [sort, setSort] = useState<ColumnSortState<SortKey>>({ column: 'revenue', dir: 'desc' });
  const [machineId, setMachineId] = useState(initialMachineId);
  const [machineName, setMachineName] = useState(initialMachineName);

  useEffect(() => {
    setMachineId(initialMachineId);
    setMachineName(initialMachineName);
  }, [initialMachineId, initialMachineName]);

  const machineOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const m of machines) {
      const id = String(m.id || '').trim();
      if (!id) continue;
      byId.set(id, { id, name: String(m.name || id).trim() || id });
    }
    if (machineId && !byId.has(machineId)) {
      byId.set(machineId, { id: machineId, name: machineName || machineId });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [machines, machineId, machineName]);

  const q = useQuery({
    queryKey: ['alert-machine-products', machineId, 'revenue'],
    queryFn: () =>
      apiGet<MachineProductsResponse>(
        `/api/alert/performance/machine-products?machineId=${encodeURIComponent(machineId)}&machineName=${encodeURIComponent(machineName)}`,
      ),
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });

  const slice: MachineProductGrain | undefined = q.data?.byGrain?.[grain];
  const label = slice?.label || GRAIN_TABS.find((t) => t.id === grain)?.label || grain;

  const sortedProducts = useMemo(() => {
    const rows = (slice?.products || []).map((p) => normalizeProductRow(p as MachineProductRow));
    const col = sort.column;
    const dir = sort.dir;
    if (!col || !dir) {
      rows.sort((a, b) => b.revenueKwd - a.revenueKwd || a.name.localeCompare(b.name));
      return rows;
    }
    rows.sort((a, b) => {
      switch (col) {
        case 'name':
          return compareStrings(a.name, b.name, dir);
        case 'revenue':
          return compareNumbers(a.revenueKwd, b.revenueKwd, dir);
        case 'prevRevenue':
          return compareNumbers(a.prevRevenueKwd, b.prevRevenueKwd, dir);
        case 'trendPct':
          return compareNumbers(a.trendPct, b.trendPct, dir);
        case 'yoyRevenue':
          return compareNumbers(a.yoyRevenueKwd, b.yoyRevenueKwd, dir);
        case 'yoyTrendPct':
          return compareNumbers(a.yoyTrendPct, b.yoyTrendPct, dir);
        case 'cups':
          return compareNumbers(a.cups, b.cups, dir);
        default:
          return 0;
      }
    });
    return rows;
  }, [slice?.products, sort]);

  const top5 = (slice?.top5 || [])
    .map((p) => ({ name: productDisplayName(p), revenueKwd: productRevenueKwd(p) }))
    .filter((p) => p.name);
  const lowest5 = (slice?.lowest5 || [])
    .map((p) => ({ name: productDisplayName(p), revenueKwd: productRevenueKwd(p) }))
    .filter((p) => p.name);
  const top5Yoy = (slice?.top5Yoy || [])
    .map((p) => ({ name: productDisplayName(p), revenueKwd: productRevenueKwd(p) }))
    .filter((p) => p.name);
  const yoyCompare = (slice?.yoyCompare || []).map((p) => ({
    name: p.name,
    revenueKwd: p.revenueKwd ?? productRevenueKwd(p),
    yoyRevenueKwd: p.yoyRevenueKwd ?? null,
    yoyTrendPct: p.yoyTrendPct,
  }));

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="machine-products-title"
      {...backdrop}
    >
      <div className="salesHistoryModal machineProductSalesModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Product mix · sales revenue (KD)</p>
            <h2 id="machine-products-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
          {machineOptions.length > 1 ? (
            <div className="machineProductPicker">
              <MachineIdSearchSelect
                machines={machineOptions}
                value={machineId}
                allowEmpty={false}
                label="Switch location"
                placeholder="Search any machine…"
                onChange={(id) => {
                  const hit = machineOptions.find((m) => m.id === id);
                  if (!hit) return;
                  setMachineId(hit.id);
                  setMachineName(hit.name);
                }}
              />
            </div>
          ) : null}

          <div className="perfModePills" role="tablist" aria-label="Period grain">
            {GRAIN_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={grain === t.id}
                className={`perfSegPill ${grain === t.id ? 'active' : ''}`}
                onClick={() => setGrain(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="salesHistoryNote">
            {label}
            {slice?.window?.start && slice?.window?.end
              ? ` · ${slice.window.start} → ${slice.window.end}`
              : ''}
            {' · '}
            Ranked by KD sales (not cups).
          </p>

          {q.isLoading ? <p className="salesHistoryNote">Loading product mix…</p> : null}
          {q.isError ? <p className="perfError">{(q.error as Error).message}</p> : null}
          {q.data?.error ? <p className="perfError">{q.data.error}</p> : null}

          <div className="productMixPanels">
            <NameList title="Top 5 · KD" items={top5} empty="No top products yet." />
            <NameList title="Lowest 5 · KD" items={lowest5} empty="No low products yet." />
          </div>

          <YoyCompareTable rows={yoyCompare} />
          <section className="productMixPanel" style={{ marginTop: 12 }}>
            <NameList title="Top 5 last year · KD" items={top5Yoy} empty="No last-year mix." />
          </section>

          <section className="productMixPanel" style={{ marginTop: 12 }}>
            <h3 className="salesHistoryCompareTitle">All products · revenue</h3>
            <p className="salesHistoryNote" style={{ marginTop: 0 }}>
              Tap headers to sort. Trend = vs prior {grain}; YoY = vs same dates last year. Cups are secondary.
            </p>
            <div className="perfGrowthTableWrap machineProductTableWrap">
              <table className="perfGrowthTable">
                <thead>
                  <tr>
                    <SortTh label="Product" col="name" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="KD" col="revenue" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="Prior KD" col="prevRevenue" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="Trend" col="trendPct" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="LY KD" col="yoyRevenue" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="YoY" col="yoyTrendPct" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                    <SortTh label="Cups" col="cups" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.length ? (
                    sortedProducts.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{formatKwdCell(p.revenueKwd)}</td>
                        <td>{formatKwdCell(p.prevRevenueKwd)}</td>
                        <td className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</td>
                        <td>{formatKwdCell(p.yoyRevenueKwd)}</td>
                        <td className={trendClass(p.yoyTrendPct)}>{trendText(p.yoyTrendPct)}</td>
                        <td>{formatCupsN(productCups(p))}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>{q.isLoading ? '…' : 'No product sales for this period.'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
