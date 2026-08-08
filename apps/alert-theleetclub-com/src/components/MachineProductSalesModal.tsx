import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  formatCupsN,
  productCups,
  productDisplayName,
  type MachineProductGrain,
  type MachineProductRow,
  type MachineProductsResponse,
} from '@/lib/productMixDisplay';
import { formatSalesTrendPct } from '@/lib/salesDisplay';
import {
  compareNumbers,
  compareStrings,
  cycleColumnSort,
  sortDirForColumn,
  type ColumnSortState,
} from '@/lib/tableColumnSort';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

type GrainKey = 'day' | 'week' | 'month';
type SortKey = 'name' | 'cups' | 'prevCups' | 'trendPct' | 'yoyCups' | 'yoyTrendPct';

const GRAIN_TABS: Array<{ id: GrainKey; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

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
  items: Array<{ name: string; cups?: number }>;
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
              {p.cups != null ? <span className="productMixCups">{formatCupsN(p.cups)}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="salesHistoryNote">{empty}</p>
      )}
    </section>
  );
}

type YoySortKey = 'name' | 'cups' | 'yoyCups' | 'yoyTrendPct';

function YoyCompareTable({
  rows,
}: {
  rows: Array<{
    name?: string | null;
    cups?: number | null;
    yoyCups?: number | null;
    yoyTrendPct?: number | null;
  }>;
}) {
  const [sort, setSort] = useState<ColumnSortState<YoySortKey>>({ column: 'cups', dir: 'desc' });
  const sorted = useMemo(() => {
    const out = [...rows];
    const col = sort.column;
    const dir = sort.dir;
    if (!col || !dir) return out;
    out.sort((a, b) => {
      switch (col) {
        case 'name':
          return compareStrings(productDisplayName(a), productDisplayName(b), dir);
        case 'cups':
          return compareNumbers(a.cups, b.cups, dir);
        case 'yoyCups':
          return compareNumbers(a.yoyCups, b.yoyCups, dir);
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
      <h3 className="salesHistoryCompareTitle">Top 5 vs last year</h3>
      <p className="salesHistoryNote" style={{ marginTop: 0 }}>
        This period’s top sellers with cups last year and YoY trend. Tap headers to sort.
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
                  Product {sortDirForColumn(sort, 'name') === 'desc' ? '▼' : sortDirForColumn(sort, 'name') === 'asc' ? '▲' : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'cups'))}
                >
                  Cups {sortDirForColumn(sort, 'cups') === 'desc' ? '▼' : sortDirForColumn(sort, 'cups') === 'asc' ? '▲' : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'yoyCups'))}
                >
                  LY cups {sortDirForColumn(sort, 'yoyCups') === 'desc' ? '▼' : sortDirForColumn(sort, 'yoyCups') === 'asc' ? '▲' : '⇅'}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="perfSortThBtn"
                  onClick={() => setSort((s) => cycleColumnSort(s, 'yoyTrendPct'))}
                >
                  YoY {sortDirForColumn(sort, 'yoyTrendPct') === 'desc' ? '▼' : sortDirForColumn(sort, 'yoyTrendPct') === 'asc' ? '▲' : '⇅'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length ? (
              sorted.map((p) => (
                <tr key={`yoy-${p.name}`}>
                  <td>{productDisplayName(p)}</td>
                  <td>{formatCupsN(p.cups)}</td>
                  <td>{formatCupsN(p.yoyCups)}</td>
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
  machineId,
  machineName,
  onClose,
}: {
  machineId: string;
  machineName: string;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const [grain, setGrain] = useState<GrainKey>('day');
  const [sort, setSort] = useState<ColumnSortState<SortKey>>({ column: 'cups', dir: 'desc' });

  const q = useQuery({
    queryKey: ['alert-machine-products', machineId],
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
    const rows = [...(slice?.products || [])] as MachineProductRow[];
    const col = sort.column;
    const dir = sort.dir;
    if (!col || !dir) {
      rows.sort((a, b) => b.cups - a.cups || a.name.localeCompare(b.name));
      return rows;
    }
    rows.sort((a, b) => {
      switch (col) {
        case 'name':
          return compareStrings(a.name, b.name, dir);
        case 'cups':
          return compareNumbers(a.cups, b.cups, dir);
        case 'prevCups':
          return compareNumbers(a.prevCups, b.prevCups, dir);
        case 'trendPct':
          return compareNumbers(a.trendPct, b.trendPct, dir);
        case 'yoyCups':
          return compareNumbers(a.yoyCups, b.yoyCups, dir);
        case 'yoyTrendPct':
          return compareNumbers(a.yoyTrendPct, b.yoyTrendPct, dir);
        default:
          return 0;
      }
    });
    return rows;
  }, [slice?.products, sort]);

  const top5 = (slice?.top5 || [])
    .map((p) => ({ name: productDisplayName(p), cups: productCups(p) }))
    .filter((p) => p.name);
  const lowest5 = (slice?.lowest5 || [])
    .map((p) => ({ name: productDisplayName(p), cups: productCups(p) }))
    .filter((p) => p.name);
  const top5Yoy = (slice?.top5Yoy || [])
    .map((p) => ({ name: productDisplayName(p), cups: productCups(p) }))
    .filter((p) => p.name);
  const yoyCompare = slice?.yoyCompare || [];

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
            <p className="salesHistoryEyebrow">Product mix · cups + trends</p>
            <h2 id="machine-products-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

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
        </p>

        {q.isLoading ? <p className="salesHistoryNote">Loading product mix…</p> : null}
        {q.isError ? <p className="perfError">{(q.error as Error).message}</p> : null}
        {q.data?.error ? <p className="perfError">{q.data.error}</p> : null}

        <div className="productMixPanels">
          <NameList title="Top 5" items={top5} empty="No top products yet." />
          <NameList title="Lowest 5" items={lowest5} empty="No low products yet." />
        </div>

        <YoyCompareTable rows={yoyCompare} />
        <section className="productMixPanel" style={{ marginTop: 12 }}>
          <NameList title="Top 5 last year" items={top5Yoy} empty="No last-year mix." />
        </section>

        <section className="productMixPanel" style={{ marginTop: 12 }}>
          <h3 className="salesHistoryCompareTitle">All products</h3>
          <p className="salesHistoryNote" style={{ marginTop: 0 }}>
            Tap column headers to sort. Trend = vs prior {grain}; YoY = vs same dates last year.
          </p>
          <div className="perfGrowthTableWrap" style={{ maxHeight: 280 }}>
            <table className="perfGrowthTable">
              <thead>
                <tr>
                  <SortTh label="Product" col="name" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  <SortTh label="Cups" col="cups" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  <SortTh label="Prior" col="prevCups" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  <SortTh label="Trend" col="trendPct" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  <SortTh label="LY" col="yoyCups" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                  <SortTh label="YoY" col="yoyTrendPct" sort={sort} onSort={(k) => setSort((s) => cycleColumnSort(s, k))} />
                </tr>
              </thead>
              <tbody>
                {sortedProducts.length ? (
                  sortedProducts.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{formatCupsN(p.cups)}</td>
                      <td>{formatCupsN(p.prevCups)}</td>
                      <td className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</td>
                      <td>{formatCupsN(p.yoyCups)}</td>
                      <td className={trendClass(p.yoyTrendPct)}>{trendText(p.yoyTrendPct)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>{q.isLoading ? '…' : 'No product cups for this period.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
