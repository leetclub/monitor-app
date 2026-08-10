import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { InfoTip } from '@/components/InfoTip';
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

const GRAIN_HELP =
  'Day = today. Week = this week to date (WTD). Month = this month to date (MTD). All dates use Asia/Kuwait. Tap ? on column headers for KD / Prior / LY / YoY (works on iPad — tap to pin).';

function columnHelp(grain: GrainKey): Record<SortKey, string> {
  const period =
    grain === 'day' ? 'today' : grain === 'week' ? 'this week (WTD)' : 'this month (MTD)';
  const prior =
    grain === 'day'
      ? 'yesterday'
      : grain === 'week'
        ? 'the matching prior-week window'
        : 'the matching prior-month window';
  const ly =
    grain === 'day'
      ? 'the same calendar date last year'
      : grain === 'week'
        ? 'the same week dates one year earlier'
        : 'the same month-to-date dates one year earlier';
  return {
    name: 'Drink / product name from Vendon sales.',
    revenue: `Sales revenue (KD) for ${period}. Top / lowest lists and default sort use this.`,
    prevRevenue: `Prior KD — sales revenue for ${prior}. Not last year.`,
    trendPct: `Trend vs prior = (this period KD − Prior KD) ÷ Prior KD. Positive means up vs ${prior}.`,
    yoyRevenue: `LY KD = last-year KD — sales for ${ly}. Not a full-year total.`,
    yoyTrendPct:
      'YoY = (this period KD − LY KD) ÷ LY KD. Example: 3.90 vs 16.30 LY ≈ −76% vs last year.',
    cups: 'Cup count for this period only — secondary to KD ranking.',
  };
}

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
  help,
}: {
  label: string;
  col: SortKey;
  sort: ColumnSortState<SortKey>;
  onSort: (k: SortKey) => void;
  help?: string;
}) {
  const dir = sortDirForColumn(sort, col);
  const glyph = dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '⇅';
  return (
    <th>
      <span className="perfSortThWithTip">
        <button type="button" className="perfSortThBtn" onClick={() => onSort(col)}>
          {label} {glyph}
        </button>
        {help ? <InfoTip text={help} label={`${label} — help`} /> : null}
      </span>
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

function YoySortTh({
  label,
  col,
  sort,
  onSort,
  help,
}: {
  label: string;
  col: YoySortKey;
  sort: ColumnSortState<YoySortKey>;
  onSort: (k: YoySortKey) => void;
  help: string;
}) {
  const dir = sortDirForColumn(sort, col);
  const glyph = dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '⇅';
  return (
    <th>
      <span className="perfSortThWithTip">
        <button type="button" className="perfSortThBtn" onClick={() => onSort(col)}>
          {label} {glyph}
        </button>
        <InfoTip text={help} label={`${label} — help`} />
      </span>
    </th>
  );
}

function YoyCompareTable({
  rows,
  grain,
}: {
  rows: Array<{
    name?: string | null;
    revenueKwd?: number | null;
    yoyRevenueKwd?: number | null;
    yoyTrendPct?: number | null;
  }>;
  grain: GrainKey;
}) {
  const [sort, setSort] = useState<ColumnSortState<YoySortKey>>({ column: 'revenue', dir: 'desc' });
  const help = columnHelp(grain);
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
      <h3 className="salesHistoryCompareTitle pageHeroRow">
        Top 5 vs last year · KD
        <InfoTip text="Compares this period’s top sellers to the same dates last year. Tap ? on a column (works on iPad) for definitions." label="Top 5 vs last year — help" />
      </h3>
      <p className="salesHistoryNote" style={{ marginTop: 0 }}>
        Ranked by sales revenue. Tap headers to sort · tap ? for help.
      </p>
      <div className="perfGrowthTableWrap">
        <table className="perfGrowthTable">
          <thead>
            <tr>
              <YoySortTh
                label="Product"
                col="name"
                sort={sort}
                help={help.name}
                onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
              />
              <YoySortTh
                label="KD"
                col="revenue"
                sort={sort}
                help={help.revenue}
                onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
              />
              <YoySortTh
                label="LY KD"
                col="yoyRevenue"
                sort={sort}
                help={help.yoyRevenue}
                onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
              />
              <YoySortTh
                label="YoY"
                col="yoyTrendPct"
                sort={sort}
                help={help.yoyTrendPct}
                onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
              />
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
  const tips = useMemo(() => columnHelp(grain), [grain]);

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

          <div className="productMixGrainRow">
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
            <InfoTip text={GRAIN_HELP} label="Period tabs — help" />
          </div>

          <p className="salesHistoryNote">
            {label}
            {slice?.window?.start && slice?.window?.end
              ? ` · ${slice.window.start} → ${slice.window.end}`
              : ''}
            {' · '}
            Ranked by KD sales (not cups). Tap ? on columns for Prior / LY / YoY (iPad: tap to open).
          </p>

          {q.isLoading ? <p className="salesHistoryNote">Loading product mix…</p> : null}
          {q.isError ? <p className="perfError">{(q.error as Error).message}</p> : null}
          {q.data?.error ? <p className="perfError">{q.data.error}</p> : null}

          <div className="productMixPanels">
            <NameList title="Top 5 · KD" items={top5} empty="No top products yet." />
            <NameList title="Lowest 5 · KD" items={lowest5} empty="No low products yet." />
          </div>

          <YoyCompareTable rows={yoyCompare} grain={grain} />
          <section className="productMixPanel" style={{ marginTop: 12 }}>
            <NameList title="Top 5 last year · KD" items={top5Yoy} empty="No last-year mix." />
          </section>

          <section className="productMixPanel" style={{ marginTop: 12 }}>
            <h3 className="salesHistoryCompareTitle pageHeroRow">
              All products · revenue
              <InfoTip
                text="Full mix for the selected Day/Week/Month. Prior = previous period; LY KD = same dates last year; YoY uses LY KD. Tap ? next to each header (iPad-friendly)."
                label="All products — help"
              />
            </h3>
            <p className="salesHistoryNote" style={{ marginTop: 0 }}>
              Tap headers to sort. Tap ? for column tips.
            </p>
            <div className="perfGrowthTableWrap machineProductTableWrap">
              <table className="perfGrowthTable">
                <thead>
                  <tr>
                    <SortTh
                      label="Product"
                      col="name"
                      sort={sort}
                      help={tips.name}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="KD"
                      col="revenue"
                      sort={sort}
                      help={tips.revenue}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="Prior KD"
                      col="prevRevenue"
                      sort={sort}
                      help={tips.prevRevenue}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="Trend"
                      col="trendPct"
                      sort={sort}
                      help={tips.trendPct}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="LY KD"
                      col="yoyRevenue"
                      sort={sort}
                      help={tips.yoyRevenue}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="YoY"
                      col="yoyTrendPct"
                      sort={sort}
                      help={tips.yoyTrendPct}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
                    <SortTh
                      label="Cups"
                      col="cups"
                      sort={sort}
                      help={tips.cups}
                      onSort={(k) => setSort((s) => cycleColumnSort(s, k))}
                    />
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
