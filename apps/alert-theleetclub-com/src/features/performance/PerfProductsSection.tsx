import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { apiGet } from '@/lib/api';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendHtml, formatSalesTrendPct, salesTrendFromToday } from '@/lib/salesDisplay';
import { SERIES_PALETTE, type MachineRow } from '@/features/performance/perfTypes';
import { downloadWeeklyProductReportPdf } from '@/features/performance/exportWeeklyProductReportPdf';

/** Sites drawn on Graph A per page (‹ ›). */
export const PERF_PRODUCTS_GRAPH_PAGE = 8;
/** @deprecated Alias — machine selection is uncapped; paging uses GRAPH_PAGE. */
export const PERF_PRODUCTS_MAX_LOCATIONS = PERF_PRODUCTS_GRAPH_PAGE;
export const PERF_PRODUCTS_MAX_SKUS = 8;

const PRODUCT_COL_TIPS = {
  periodKd: (label: string) =>
    `Total revenue (KD) for “${label}”. Sum of customer vends only — excludes WEB cashless / remote credit.`,
  priorKd: (label: string) =>
    `Total revenue (KD) for “${label}” in the prior comparison window. Customer sales only.`,
  vsPrior: 'Percent change in revenue KD vs the prior period.',
  cups: 'Total cups sold in the period (customer vends only; excludes remote credit).',
  priorCups: 'Total cups sold in the prior comparison period.',
  lyKd: 'Total revenue KD for the same calendar dates last year.',
  yoy: 'Percent change in revenue KD vs same dates last year.',
  drink: 'Product name from Vendon selection.',
  location: 'Machine / site name.',
} as const;

function ThTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <th title={title} className="perfThTip">
      {children}
    </th>
  );
}

type TimeCriteria =
  | 'single:today'
  | 'single:yesterday'
  | 'single:wtd'
  | 'single:last_week'
  | 'single:this_month'
  | 'single:last_month'
  | 'single:custom'
  | 'compare:today'
  | 'compare:yesterday'
  | 'compare:this_week'
  | 'compare:wtd_vs_ly'
  | 'compare:last_week'
  | 'compare:this_month'
  | 'compare:last_month'
  | 'compare:custom_vs_custom';

type TargetType = 'product' | 'machine' | 'both';
type YMetric = 'revenue' | 'cups';

type ProductRow = {
  name: string;
  revenueKwd: number;
  prevRevenueKwd?: number | null;
  yoyRevenueKwd?: number | null;
  cups?: number | null;
  prevCups?: number | null;
  yoyCups?: number | null;
  trendPct?: number | null;
  cupsTrendPct?: number | null;
  yoyTrendPct?: number | null;
  targetCups?: number | null;
  targetRevenueKwd?: number | null;
  pctOfTarget?: number | null;
  pctOfRevenueTarget?: number | null;
};

type ProductMachine = {
  machineId: string;
  machineName: string;
  periodKd?: number | null;
  periodCups?: number | null;
  prevKd?: number | null;
  locationTargetKd?: number | null;
  locationTargetCups?: number | null;
  pctOfLocationTarget?: number | null;
  pctOfLocationCupsTarget?: number | null;
  products: ProductRow[];
  days?: ProductDay[];
};

type ProductDay = {
  date: string;
  weekday?: string;
  revenueKwd?: number;
  cups?: number;
  prevRevenueKwd?: number | null;
  prevCups?: number | null;
  products?: Array<{
    name: string;
    revenueKwd?: number;
    cups?: number;
    prevRevenueKwd?: number | null;
    prevCups?: number | null;
  }>;
};

type ProductComparePayload = {
  ok?: boolean;
  error?: string;
  preset?: string;
  compare?: boolean;
  granularity?: 'day' | 'hour' | string;
  window?: {
    start?: string;
    end?: string;
    prevStart?: string | null;
    prevEnd?: string | null;
    label?: string;
    prevLabel?: string;
  };
  machines?: ProductMachine[];
  days?: ProductDay[];
};

type HoverPoint = {
  kd: number;
  cups: number;
  priorKd?: number | null;
  priorCups?: number | null;
  target?: number | null;
  pctOfTarget?: number | null;
};

type TrajSeries = {
  name: string;
  data: number[];
  dashed?: boolean;
  dotted?: boolean;
  hover?: HoverPoint[];
};

const SINGLE_OPTIONS: { id: TimeCriteria; label: string }[] = [
  { id: 'single:today', label: 'Today' },
  { id: 'single:yesterday', label: 'Yesterday' },
  { id: 'single:wtd', label: 'Week to date (WTD)' },
  { id: 'single:last_week', label: 'Last week' },
  { id: 'single:this_month', label: 'This month (MTD)' },
  { id: 'single:last_month', label: 'Last month' },
  { id: 'single:custom', label: 'Custom range' },
];

const COMPARE_OPTIONS: { id: TimeCriteria; label: string }[] = [
  { id: 'compare:today', label: 'Today vs yesterday' },
  { id: 'compare:yesterday', label: 'Yesterday vs day before' },
  { id: 'compare:this_week', label: 'WTD vs prior WTD' },
  { id: 'compare:wtd_vs_ly', label: 'WTD vs same week LY' },
  { id: 'compare:last_week', label: 'Last week vs week before' },
  { id: 'compare:this_month', label: 'This month vs last' },
  { id: 'compare:last_month', label: 'Last month vs month before' },
  { id: 'compare:custom_vs_custom', label: 'Custom vs custom' },
];

const COMPARE_BATCH = 80;

function kuwaitIsoToday(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CompareOpts = {
  preset: string;
  compare?: boolean;
  start?: string;
  end?: string;
  aStart?: string;
  aEnd?: string;
  bStart?: string;
  bEnd?: string;
};

function productComparePath(ids: string[], opts: CompareOpts): string {
  const qs = new URLSearchParams();
  qs.set('machineIds', ids.join(','));
  if (opts.aStart && opts.aEnd && opts.bStart && opts.bEnd) {
    qs.set('aStart', opts.aStart);
    qs.set('aEnd', opts.aEnd);
    qs.set('bStart', opts.bStart);
    qs.set('bEnd', opts.bEnd);
  } else if (opts.start && opts.end) {
    qs.set('start', opts.start);
    qs.set('end', opts.end);
    qs.set('compare', opts.compare === false ? '0' : '1');
  } else {
    qs.set('preset', opts.preset);
    if (opts.compare === false) qs.set('compare', '0');
  }
  return `/api/alert/performance/product-compare?${qs.toString()}`;
}

async function fetchProductCompareBatched(
  ids: string[],
  opts: CompareOpts,
): Promise<ProductComparePayload> {
  const unique = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  if (!unique.length) return { machines: [] };
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += COMPARE_BATCH) {
    chunks.push(unique.slice(i, i + COMPARE_BATCH));
  }
  const parts = await Promise.all(
    chunks.map((chunk) => apiGet<ProductComparePayload>(productComparePath(chunk, opts))),
  );
  const first = parts.find((p) => !p.error) || parts[0] || {};
  const machines = parts.flatMap((p) => p.machines || []);
  return {
    ...first,
    machines,
    days: rollupDaysFromMachines(machines),
    error: parts.map((p) => p.error).find(Boolean),
  };
}

function rollupDaysFromMachines(machines: ProductMachine[]): ProductDay[] {
  if (!machines.length) return [];
  const n = Math.max(0, ...machines.map((m) => (m.days || []).length));
  if (!n) return [];
  const out: ProductDay[] = [];
  for (let i = 0; i < n; i++) {
    const sample = (machines[0].days || [])[i];
    const mix = new Map<
      string,
      { revenueKwd: number; cups: number; prevRevenueKwd: number; prevCups: number }
    >();
    let revenueKwd = 0;
    let cups = 0;
    let prevRevenueKwd = 0;
    let prevCups = 0;
    let hasPrev = false;
    for (const m of machines) {
      const day = (m.days || [])[i];
      if (!day) continue;
      revenueKwd += Number(day.revenueKwd || 0);
      cups += Number(day.cups || 0);
      if (day.prevRevenueKwd != null) {
        prevRevenueKwd += Number(day.prevRevenueKwd || 0);
        prevCups += Number(day.prevCups || 0);
        hasPrev = true;
      }
      for (const p of day.products || []) {
        const name = String(p.name || '').trim();
        if (!name) continue;
        const cur = mix.get(name) || { revenueKwd: 0, cups: 0, prevRevenueKwd: 0, prevCups: 0 };
        cur.revenueKwd += Number(p.revenueKwd || 0);
        cur.cups += Number(p.cups || 0);
        if (p.prevRevenueKwd != null) cur.prevRevenueKwd += Number(p.prevRevenueKwd || 0);
        if (p.prevCups != null) cur.prevCups += Number(p.prevCups || 0);
        mix.set(name, cur);
      }
    }
    out.push({
      date: sample?.date || '',
      weekday: sample?.weekday,
      revenueKwd,
      cups,
      prevRevenueKwd: hasPrev ? prevRevenueKwd : null,
      prevCups: hasPrev ? prevCups : null,
      products: [...mix.entries()]
        .map(([name, v]) => ({
          name,
          revenueKwd: v.revenueKwd,
          cups: v.cups,
          prevRevenueKwd: hasPrev ? v.prevRevenueKwd : null,
          prevCups: hasPrev ? v.prevCups : null,
        }))
        .sort((a, b) => b.revenueKwd - a.revenueKwd || a.name.localeCompare(b.name)),
    });
  }
  return out;
}

function trendClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  return Number(pct) >= 0 ? 'alertSalesUp' : 'alertSalesDown';
}

function trendText(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  return formatSalesTrendPct(Number(pct));
}

function readTheme() {
  const dark =
    typeof document === 'undefined'
      ? true
      : document.documentElement.getAttribute('data-mode') === 'dark' ||
        (document.documentElement.getAttribute('data-theme') !== 'pro' &&
          document.documentElement.getAttribute('data-mode') !== 'light');
  if (!dark) {
    return {
      text: '#0f172a',
      muted: '#64748b',
      grid: 'rgba(15, 23, 42, 0.08)',
      axis: '#94a3b8',
      /** Teal reads clearer than white on light chart ink. */
      cross: '#0f766e',
      tipBg: 'rgba(255, 255, 255, 0.98)',
      tipBorder: 'rgba(13, 148, 136, 0.55)',
      tipText: '#0f172a',
    };
  }
  return {
    text: '#e2e8f0',
    muted: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.12)',
    axis: '#64748b',
    /** Cyan > white on dark plots — higher contrast against grid/lines. */
    cross: '#2dd4bf',
    tipBg: 'rgba(8, 18, 28, 0.96)',
    tipBorder: 'rgba(45, 212, 191, 0.55)',
    tipText: '#ecfeff',
  };
}

function trendFrom(period: number, prior: number): number | null {
  if (!(prior > 0)) return null;
  return ((period - prior) / prior) * 100;
}

function aggregateProducts(machines: ProductMachine[]): ProductRow[] {
  const totals = new Map<
    string,
    {
      revenue: number;
      prev: number;
      yoy: number;
      cups: number;
      prevCups: number;
      yoyCups: number;
      target: number;
      targetRev: number;
      hasTarget: boolean;
      hasTargetRev: boolean;
      hasPrev: boolean;
    }
  >();
  for (const m of machines) {
    for (const p of m.products || []) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const cur = totals.get(name) || {
        revenue: 0,
        prev: 0,
        yoy: 0,
        cups: 0,
        prevCups: 0,
        yoyCups: 0,
        target: 0,
        targetRev: 0,
        hasTarget: false,
        hasTargetRev: false,
        hasPrev: false,
      };
      cur.revenue += Number(p.revenueKwd || 0);
      if (p.prevRevenueKwd != null) {
        cur.prev += Number(p.prevRevenueKwd || 0);
        cur.hasPrev = true;
      }
      cur.yoy += Number(p.yoyRevenueKwd || 0);
      cur.cups += Number(p.cups || 0);
      if (p.prevCups != null) cur.prevCups += Number(p.prevCups || 0);
      cur.yoyCups += Number(p.yoyCups || 0);
      if (p.targetCups != null && Number.isFinite(Number(p.targetCups))) {
        cur.target += Number(p.targetCups);
        cur.hasTarget = true;
      }
      if (p.targetRevenueKwd != null && Number.isFinite(Number(p.targetRevenueKwd))) {
        cur.targetRev += Number(p.targetRevenueKwd);
        cur.hasTargetRev = true;
      }
      totals.set(name, cur);
    }
  }
  return [...totals.entries()]
    .map(([name, v]) => ({
      name,
      revenueKwd: v.revenue,
      prevRevenueKwd: v.hasPrev ? v.prev : null,
      yoyRevenueKwd: v.yoy,
      cups: v.cups,
      prevCups: v.hasPrev ? v.prevCups : null,
      yoyCups: v.yoyCups,
      trendPct: v.hasPrev ? trendFrom(v.revenue, v.prev) : null,
      cupsTrendPct: v.hasPrev ? trendFrom(v.cups, v.prevCups) : null,
      yoyTrendPct: trendFrom(v.revenue, v.yoy),
      targetCups: v.hasTarget ? v.target : null,
      targetRevenueKwd: v.hasTargetRev ? v.targetRev : null,
      pctOfTarget: v.hasTarget && v.target > 0 ? (v.cups / v.target) * 100 : null,
      pctOfRevenueTarget: v.hasTargetRev && v.targetRev > 0 ? (v.revenue / v.targetRev) * 100 : null,
    }))
    .sort((a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0) || a.name.localeCompare(b.name));
}

function skuOnMachine(m: ProductMachine, names: string[]) {
  const want = new Set(names.map((n) => n.toLowerCase()));
  let revenue = 0;
  let prev = 0;
  let cups = 0;
  let prevCups = 0;
  let target = 0;
  let targetRev = 0;
  let hasTarget = false;
  let hasTargetRev = false;
  let hasPrev = false;
  for (const p of m.products || []) {
    if (!want.has(String(p.name || '').toLowerCase())) continue;
    revenue += Number(p.revenueKwd || 0);
    cups += Number(p.cups || 0);
    if (p.prevRevenueKwd != null) {
      prev += Number(p.prevRevenueKwd || 0);
      hasPrev = true;
    }
    if (p.prevCups != null) prevCups += Number(p.prevCups || 0);
    if (p.targetCups != null && Number.isFinite(Number(p.targetCups))) {
      target += Number(p.targetCups);
      hasTarget = true;
    }
    if (p.targetRevenueKwd != null && Number.isFinite(Number(p.targetRevenueKwd))) {
      targetRev += Number(p.targetRevenueKwd);
      hasTargetRev = true;
    }
  }
  return {
    revenue,
    prev: hasPrev ? prev : null,
    cups,
    prevCups: hasPrev ? prevCups : null,
    target,
    targetRev,
    hasTarget,
    hasTargetRev,
    trendPct: hasPrev ? trendFrom(revenue, prev) : null,
    pctOfTarget: hasTarget && target > 0 ? (cups / target) * 100 : null,
    pctOfRevenueTarget: hasTargetRev && targetRev > 0 ? (revenue / targetRev) * 100 : null,
  };
}

function daySkuHit(day: ProductDay | undefined, sku: string) {
  if (!day) return undefined;
  return (day.products || []).find((p) => p.name === sku);
}

function daySkuKwd(day: ProductDay | undefined, sku: string): number {
  return Number(daySkuHit(day, sku)?.revenueKwd || 0);
}

function daySkuPrevKwd(day: ProductDay | undefined, sku: string): number {
  const hit = daySkuHit(day, sku);
  return hit?.prevRevenueKwd != null ? Number(hit.prevRevenueKwd || 0) : 0;
}

function daySkuCups(day: ProductDay | undefined, sku: string): number {
  return Number(daySkuHit(day, sku)?.cups || 0);
}

function daySkuPrevCups(day: ProductDay | undefined, sku: string): number {
  const hit = daySkuHit(day, sku);
  return hit?.prevCups != null ? Number(hit.prevCups || 0) : 0;
}

function daySkuValue(day: ProductDay | undefined, sku: string, metric: YMetric): number {
  return metric === 'cups' ? daySkuCups(day, sku) : daySkuKwd(day, sku);
}

function daySkuPrevValue(day: ProductDay | undefined, sku: string, metric: YMetric): number {
  return metric === 'cups' ? daySkuPrevCups(day, sku) : daySkuPrevKwd(day, sku);
}

/** Spread period target evenly across X points (daily/hourly pace line). */
function paceLine(periodTarget: number, n: number): number[] {
  if (n <= 0 || !(periodTarget > 0)) return Array.from({ length: Math.max(0, n) }, () => 0);
  const pace = periodTarget / n;
  return Array.from({ length: n }, () => pace);
}

function SkuMultiDropdown({
  options,
  selected,
  onToggle,
  onClear,
  onSelectTop,
  onSelectLeast,
  embedded,
}: {
  options: { name: string; kd: number }[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  onSelectTop: () => void;
  onSelectLeast: () => void;
  /** Nest inside a graph card toolbar (no outer panel chrome). */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [atCapHint, setAtCapHint] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atCap = selected.length >= PERF_PRODUCTS_MAX_SKUS;
  const summary = selected.length
    ? selected.length === 1
      ? selected[0]
      : `${selected.length} of ${PERF_PRODUCTS_MAX_SKUS} drinks`
    : 'Select drinks…';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 80);
    return options.filter((o) => o.name.toLowerCase().includes(needle)).slice(0, 80);
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const t = window.setTimeout(() => document.addEventListener('click', onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', onDoc);
    };
  }, [open]);

  return (
    <div
      className={`perfProductsSkuPick${embedded ? ' perfProductsSkuPickEmbed' : ''}${open ? ' perfSkuDropdownOpen' : ''}`}
      aria-label="Products for Graph B and heatmap"
    >
      <div className="perfProductsSkuPickMain" ref={rootRef}>
        <div className="perfProductsField">
          <span className="perfProductsFieldLabel">
            Products
            <em>
              {selected.length}/{PERF_PRODUCTS_MAX_SKUS}
            </em>
          </span>
          <div className="perfLocSelect">
            <button
              type="button"
              className={`perfLocSelectTrigger ${open ? 'open' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
              aria-expanded={open}
              aria-haspopup="listbox"
            >
              <span className="perfLocSelectSummary">{summary}</span>
              <span className="perfLocSelectChevron" aria-hidden>
                ▾
              </span>
            </button>
            {open ? (
              <div className="perfLocDropdown" role="listbox" onClick={(e) => e.stopPropagation()}>
                <div className="perfLocDropdownToolbar">
                  <input
                    type="search"
                    className="perfLocSearch"
                    placeholder="Search drink…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    autoFocus
                  />
                  <div className="perfMachineFilterActions">
                    <button
                      type="button"
                      className={`perfSegPill ${selected.length === 0 ? 'active' : ''}`}
                      onClick={() => {
                        onClear();
                        setAtCapHint(false);
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="perfSegPill"
                      onClick={() => {
                        onSelectTop();
                        setAtCapHint(false);
                      }}
                    >
                      Top {PERF_PRODUCTS_MAX_SKUS}
                    </button>
                    <button
                      type="button"
                      className="perfSegPill"
                      onClick={() => {
                        onSelectLeast();
                        setAtCapHint(false);
                      }}
                    >
                      Least {PERF_PRODUCTS_MAX_SKUS}
                    </button>
                  </div>
                </div>
                <div className="perfLocDropdownList">
                  {options.length === 0 ? (
                    <p className="perfMuted">Pick locations first to load drinks.</p>
                  ) : filtered.length === 0 ? (
                    <p className="perfMuted">No matches.</p>
                  ) : (
                    filtered.map((o) => {
                      const checked = selectedSet.has(o.name);
                      return (
                        <div
                          key={o.name}
                          role="option"
                          aria-selected={checked}
                          className={`perfLocRow ${checked ? 'perfLocRowSolo' : ''}`}
                          onClick={() => {
                            if (!checked && atCap) {
                              setAtCapHint(true);
                              return;
                            }
                            setAtCapHint(false);
                            onToggle(o.name);
                          }}
                        >
                          <span className="perfLocRowMain">
                            <input
                              type="checkbox"
                              checked={checked}
                              readOnly
                              tabIndex={-1}
                              disabled={!checked && atCap}
                            />
                            <span className="perfLocRowName" title={o.name}>
                              {o.name}
                            </span>
                          </span>
                          <span className="perfSkuKd" title={`Total revenue (KD) for this drink in the selected scope. Customer sales only.`}>
                            {formatKwd(o.kd)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {selected.length > 0 ? (
          <div className="perfLocChips perfLocChipsUnder" aria-label="Selected products">
            {selected.slice(0, 8).map((name) => (
              <button
                key={name}
                type="button"
                className="perfLocChip"
                onClick={() => onToggle(name)}
                title={`Remove ${name}`}
              >
                {name}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {atCapHint ? (
        <p className="perfProductsFieldHint warn">
          Maximum {PERF_PRODUCTS_MAX_SKUS} drinks. Uncheck one to add another.
        </p>
      ) : null}
    </div>
  );
}

/** Location-style trajectory: calendar dates on X, one line per series. */
function midEllipsis(name: string, max = 18): string {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  const keep = max - 1;
  const left = Math.ceil(keep * 0.55);
  const right = Math.max(1, keep - left);
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function DateTrajectoryChart({
  days,
  series,
  compact,
  unit = 'kd',
  exportName,
  ariaLabel,
  onSeriesClick,
}: {
  days: Array<{ date: string; weekday?: string }>;
  series: Array<TrajSeries>;
  compact?: boolean;
  unit?: 'kd' | 'cups';
  exportName?: string;
  ariaLabel?: string;
  onSeriesClick?: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const [axisTip, setAxisTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    const theme = readTheme();
    const fmt = unit === 'cups' ? (v: number) => String(Math.round(v)) : formatKwd;
    chart.off('click');
    chart.off('mouseover');
    chart.off('mouseout');
    chart.off('globalout');
    setAxisTip(null);
    if (!days.length || !series.length) {
      chart.clear();
      return;
    }
    const labels = days.map((d) => {
      const isHour = Boolean(d.date && /^\d{1,2}:\d{2}$/.test(d.date));
      if (isHour) return d.date;
      const md = d.date.length >= 10 ? d.date.slice(5) : d.date;
      const wd = (d.weekday || '').slice(0, 3);
      return wd ? `${wd} ${md}` : md;
    });
    const byName = new Map(series.map((s) => [s.name, s]));
    const seriesNames = new Set(series.map((s) => s.name));
    const pairNames = (raw: string): string[] => {
      const name = String(raw || '').trim();
      if (!name || name.startsWith('Target ·')) return name ? [name] : [];
      if (name.startsWith('Prior · ')) {
        const base = name.slice('Prior · '.length);
        return [name, base].filter((n) => seriesNames.has(n));
      }
      const prior = `Prior · ${name}`;
      return [name, prior].filter((n) => seriesNames.has(n));
    };
    // Scale Y to actual lines (skip dotted targets) so product series stay readable.
    const scaleVals = series
      .filter((s) => !s.dotted)
      .flatMap((s) => s.data)
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    let yMin: number | undefined;
    let yMax: number | undefined;
    if (scaleVals.length) {
      const lo = Math.min(...scaleVals);
      const hi = Math.max(...scaleVals);
      const span = hi - lo;
      const pad = span > 0 ? span * 0.14 : Math.max(hi * 0.12, unit === 'cups' ? 2 : 0.15);
      yMin = Math.max(0, lo - pad);
      yMax = hi + pad;
      if (yMax <= yMin) yMax = yMin + (unit === 'cups' ? 4 : 0.5);
    }
    // Pair prior (dashed) with the same color as the solid main line.
    const colorByBase = new Map<string, string>();
    let colorIdx = 0;
    for (const s of series) {
      if (s.dashed || s.dotted) continue;
      colorByBase.set(s.name, SERIES_PALETTE[colorIdx % SERIES_PALETTE.length]);
      colorIdx += 1;
    }
    const colorFor = (s: TrajSeries): string => {
      if (s.dashed && s.name.startsWith('Prior · ')) {
        const base = s.name.slice('Prior · '.length);
        return colorByBase.get(base) || SERIES_PALETTE[0];
      }
      if (s.dotted) return '#94a3b8';
      return colorByBase.get(s.name) || SERIES_PALETTE[0];
    };
    const legendBand = compact ? 44 : 52;
    chart.setOption(
      {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          confine: true,
          appendToBody: true,
          axisPointer: {
            type: 'line',
            lineStyle: {
              color: theme.cross,
              type: 'solid',
              width: 1.5,
              shadowBlur: 6,
              shadowColor: theme.cross,
            },
            label: { show: false },
          },
          backgroundColor: theme.tipBg,
          borderColor: theme.tipBorder,
          borderWidth: 1,
          padding: [10, 12],
          textStyle: { color: theme.tipText, fontSize: 12, fontWeight: 600 },
          formatter: (params: unknown) => {
            const arr = params as {
              seriesName?: string;
              value?: number | null;
              dataIndex?: number;
              color?: string;
            }[];
            const i = arr[0]?.dataIndex ?? 0;
            const day = days[i];
            const isHour = Boolean(day?.date && /^\d{1,2}:\d{2}$/.test(day.date));
            const head = day
              ? isHour
                ? day.date
                : `${(day.weekday || '').slice(0, 3)} · ${day.date}`
              : labels[i] || '';
            const lines = [
              `<div style="font-weight:800;margin-bottom:6px;color:${theme.tipText}">${head}</div>`,
            ];
            for (const p of arr) {
              if (p.value == null || !Number.isFinite(Number(p.value))) continue;
              const s = byName.get(String(p.seriesName || ''));
              const h = s?.hover?.[i];
              const name = String(p.seriesName || '');
              const tipBits: string[] = [
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;box-shadow:0 0 0 1px ${theme.tipBorder}"></span>`,
                `<b>${name}</b>: ${fmt(Number(p.value))}`,
              ];
              if (h) {
                tipBits.push(` · KD ${formatKwd(h.kd)} · ${Math.round(h.cups)} cups`);
                if (h.priorKd != null || h.priorCups != null) {
                  tipBits.push(
                    ` · Prior ${formatKwd(Number(h.priorKd || 0))} / ${Math.round(Number(h.priorCups || 0))} cups`,
                  );
                  const cur = unit === 'cups' ? Number(h.cups) : Number(h.kd);
                  const prior =
                    unit === 'cups' ? Number(h.priorCups || 0) : Number(h.priorKd || 0);
                  const trend = salesTrendFromToday(cur, prior);
                  if (trend != null && Number.isFinite(trend)) {
                    tipBits.push(` · ${formatSalesTrendHtml(trend, 'vs prior')}`);
                  }
                } else if (i > 0 && s?.data) {
                  const prevPt = Number(s.data[i - 1]);
                  const curPt = Number(p.value);
                  if (Number.isFinite(prevPt) && Number.isFinite(curPt)) {
                    const dod = salesTrendFromToday(curPt, prevPt);
                    if (dod != null && Number.isFinite(dod)) {
                      tipBits.push(
                        ` · ${formatSalesTrendHtml(dod, isHour ? 'vs prior hour' : 'vs prior day')}`,
                      );
                    }
                  }
                }
                if (h.target != null && Number(h.target) > 0) {
                  const tgtLabel =
                    unit === 'cups' ? `${Math.round(h.target)} cups` : formatKwd(h.target);
                  tipBits.push(` · Target ${tgtLabel}`);
                  if (h.pctOfTarget != null && Number.isFinite(h.pctOfTarget)) {
                    tipBits.push(` (${h.pctOfTarget.toFixed(0)}%)`);
                  }
                }
              }
              lines.push(`<div style="margin-bottom:3px">${tipBits.join('')}</div>`);
            }
            return lines.join('');
          },
        },
        legend: {
          type: 'scroll',
          top: 2,
          left: 8,
          right: 8,
          height: legendBand - 6,
          data: series.map((s) => s.name),
          formatter: (name: string) => midEllipsis(name, compact ? 16 : 20),
          textStyle: { color: theme.muted, fontSize: 10 },
          pageTextStyle: { color: theme.muted },
          pageIconColor: theme.muted,
          tooltip: {
            show: true,
            formatter: (p: { name?: string }) => String(p.name || ''),
          },
        },
        grid: {
          left: 12,
          right: 16,
          top: legendBand + 6,
          bottom: compact ? 40 : 48,
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisLabel: {
            color: theme.axis,
            fontSize: 10,
            hideOverlap: true,
            showMinLabel: true,
            showMaxLabel: true,
            rotate: labels.length > 10 ? 28 : 0,
            width: 56,
            overflow: 'truncate',
          },
        },
        yAxis: {
          type: 'value',
          name: unit === 'cups' ? 'Cups' : 'KD',
          nameLocation: 'middle',
          nameGap: 52,
          nameTextStyle: { color: theme.muted, fontSize: 11, fontWeight: 700 },
          scale: true,
          min: yMin,
          max: yMax,
          axisLabel: {
            color: theme.axis,
            fontSize: 10,
            formatter: (v: number) => fmt(v),
            width: 56,
            overflow: 'truncate',
          },
          splitLine: { lineStyle: { color: theme.grid } },
        },
        series: series.map((s) => {
          const color = colorFor(s);
          const isMain = !s.dashed && !s.dotted;
          return {
            name: s.name,
            type: 'line',
            data: s.data,
            smooth: s.dotted ? false : 0.25,
            showSymbol: days.length <= 14 && !s.dotted,
            symbol: 'circle',
            symbolSize: compact ? 5 : 7,
            clip: !s.dotted,
            itemStyle: { color },
            lineStyle: {
              color,
              width: s.dotted ? 2 : s.dashed ? 2 : 2.4,
              type: s.dotted ? 'dotted' : s.dashed ? 'dashed' : 'solid',
              opacity: s.dotted ? 0.85 : 1,
            },
            // Pairing is handled manually so main + prior glow together
            emphasis: {
              focus: 'none',
              scale: true,
              lineStyle: {
                width: isMain ? 3.8 : 3.2,
                shadowBlur: 14,
                shadowColor: color,
                opacity: 1,
              },
              itemStyle: {
                borderWidth: 2,
                borderColor: '#fff',
                shadowBlur: 12,
                shadowColor: color,
              },
            },
            blur: {
              lineStyle: { opacity: 0.12 },
              itemStyle: { opacity: 0.12 },
            },
          };
        }),
      },
      true,
    );

    const focusPair = (raw: string) => {
      const names = pairNames(raw);
      if (!names.length) return;
      chart.dispatchAction({ type: 'downplay' });
      // Blur everything else by highlighting only the pair
      for (const n of seriesNames) {
        if (!names.includes(n)) {
          chart.dispatchAction({ type: 'downplay', seriesName: n });
        }
      }
      for (const n of names) {
        chart.dispatchAction({ type: 'highlight', seriesName: n });
      }
    };
    const clearFocus = () => {
      chart.dispatchAction({ type: 'downplay' });
      setAxisTip(null);
    };

    chart.on('mouseover', (params: echarts.ECElementEvent) => {
      if (params.componentType === 'legend') {
        const full = String(params.name || '');
        focusPair(full);
        const wrap = wrapRef.current;
        if (wrap && full) {
          const ev = params.event as { offsetX?: number; offsetY?: number } | undefined;
          const x = ev?.offsetX ?? wrap.clientWidth / 2;
          const y = ev?.offsetY ?? 24;
          setAxisTip({ text: full, x, y });
        }
        return;
      }
      if (params.componentType === 'series') {
        focusPair(String(params.seriesName || ''));
        setAxisTip(null);
      }
    });
    chart.on('mouseout', (params: echarts.ECElementEvent) => {
      if (params.componentType === 'legend' || params.componentType === 'series') {
        clearFocus();
      }
    });
    chart.on('globalout', clearFocus);

    if (onSeriesClick) {
      chart.on('click', (params: echarts.ECElementEvent) => {
        const name = String(params.seriesName || '').trim();
        if (!name || name.startsWith('Prior ·') || name.startsWith('Target ·')) return;
        onSeriesClick(name);
      });
    }
  }, [days, series, compact, unit, onSeriesClick]);

  const onExport = useCallback(() => {
    if (!inst.current || !exportName) return;
    downloadChartPng(inst.current, chartFilename([exportName]));
  }, [exportName]);

  const chart = (
    <div ref={wrapRef} className="perfChartWrap" style={{ position: 'relative' }}>
      <div
        ref={ref}
        className={`perfEchart ${compact ? 'perfEchartCompact' : 'perfEchartOverview'}`}
        role="img"
        aria-label={ariaLabel || 'Daily product trajectory'}
      />
      {axisTip ? (
        <div className="perfChartAxisTip" style={{ left: axisTip.x, top: axisTip.y }} role="tooltip">
          {axisTip.text}
        </div>
      ) : null}
    </div>
  );
  if (!exportName) return chart;
  return (
    <ChartExportWrap onExport={onExport} label="PNG">
      {chart}
    </ChartExportWrap>
  );
}

/** Graph C — product × location period totals (teal intensity). */
type HeatCellMeta = {
  machine: string;
  product: string;
  revenueKwd: number;
  cups: number;
  prevRevenueKwd: number | null;
  prevCups: number | null;
  trendPct: number | null;
  cupsTrendPct: number | null;
  yoyTrendPct: number | null;
  pctOfTarget: number | null;
  pctOfRevenueTarget: number | null;
};

function heatCellInsight(meta: HeatCellMeta | undefined, unit: 'kd' | 'cups'): string {
  if (!meta) return '';
  const t = unit === 'cups' ? meta.cupsTrendPct : meta.trendPct;
  if (t == null || !Number.isFinite(t)) return 'No prior window to compare.';
  if (t >= 15) return 'Strong rise vs prior — keep stocked.';
  if (t >= 5) return 'Up vs prior.';
  if (t <= -15) return 'Soft vs prior — check stock / promo.';
  if (t <= -5) return 'Down vs prior.';
  return 'Steady vs prior.';
}

function ProductHeatmapChart({
  rows,
  columns,
  values,
  cellMeta,
  unit,
  exportName,
}: {
  rows: string[];
  columns: string[];
  /** [colIndex, rowIndex, value] */
  values: Array<[number, number, number]>;
  /** Parallel meta keyed by `${ci},${ri}` */
  cellMeta: Map<string, HeatCellMeta>;
  unit: 'kd' | 'cups';
  exportName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const [axisTip, setAxisTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    const theme = readTheme();
    chart.off('mouseover');
    chart.off('mouseout');
    chart.off('globalout');
    setAxisTip(null);
    if (!rows.length || !columns.length) {
      chart.clear();
      return;
    }
    const maxV = Math.max(0, ...values.map((v) => v[2]));
    const fmt = (v: number) => (unit === 'cups' ? String(Math.round(v)) : formatKwd(v));
    const cellFmt = (v: number) =>
      unit === 'cups' ? String(Math.round(v)) : String(Math.round(v));
    const labelColorFor = (v: number) => {
      const t = maxV > 0 ? v / maxV : 0;
      return t >= 0.42 ? '#f8fafc' : '#0f172a';
    };
    const leftPad = Math.min(168, Math.max(100, ...rows.map((r) => Math.min(r.length, 22) * 6.4)));
    const gridRight = 48;
    const gridTop = 28;
    const gridBottom = 84;

    const applyLayout = () => {
      const plotW = Math.max(48, chart.getWidth() - leftPad - gridRight);
      const plotH = Math.max(48, chart.getHeight() - gridTop - gridBottom);
      const cellW = plotW / Math.max(1, columns.length);
      const cellH = plotH / Math.max(1, rows.length);
      const cellMin = Math.min(cellW, cellH);
      // Scale label to ~34% of the smaller cell edge; clamp for readability
      const labelFont = Math.round(Math.min(22, Math.max(11, cellMin * 0.34)));
      const axisFont = Math.round(Math.min(13, Math.max(10, cellMin * 0.22)));
      const showCellLabels = cellMin >= 26;
      chart.setOption(
        {
          backgroundColor: 'transparent',
          tooltip: {
            position: 'top',
            confine: true,
            extraCssText:
              'max-width:280px;white-space:normal;line-height:1.35;padding:10px 12px;border-radius:10px;',
            formatter: (p: {
              data?: [number, number, number] | { value?: [number, number, number] };
            }) => {
              const raw = p.data;
              const d = Array.isArray(raw) ? raw : raw?.value;
              if (!d) return '';
              const [ci, ri, val] = d;
              const meta = cellMeta.get(`${ci},${ri}`);
              const product = meta?.product || columns[ci] || '';
              const machine = meta?.machine || rows[ri] || '';
              const bits: string[] = [
                `<div style="font-weight:700;margin-bottom:4px">${product}</div>`,
                `<div style="opacity:0.85;margin-bottom:6px">${machine}</div>`,
                `<div><b>${unit === 'cups' ? 'Cups' : 'Revenue'}:</b> ${fmt(val)}</div>`,
              ];
              if (meta) {
                bits.push(
                  `<div>KD ${formatKwd(meta.revenueKwd)} · ${Math.round(meta.cups)} cups</div>`,
                );
                if (meta.prevRevenueKwd != null || meta.prevCups != null) {
                  bits.push(
                    `<div>Prior: ${formatKwd(Number(meta.prevRevenueKwd || 0))} · ${Math.round(Number(meta.prevCups || 0))} cups</div>`,
                  );
                }
                if (meta.trendPct != null && Number.isFinite(meta.trendPct)) {
                  bits.push(`<div>${formatSalesTrendHtml(meta.trendPct, 'Trend KD')}</div>`);
                }
                if (meta.cupsTrendPct != null && Number.isFinite(meta.cupsTrendPct)) {
                  bits.push(`<div>${formatSalesTrendHtml(meta.cupsTrendPct, 'Trend cups')}</div>`);
                }
                if (meta.yoyTrendPct != null && Number.isFinite(meta.yoyTrendPct)) {
                  bits.push(`<div>${formatSalesTrendHtml(meta.yoyTrendPct, 'YoY')}</div>`);
                }
                const pct = unit === 'cups' ? meta.pctOfTarget : meta.pctOfRevenueTarget;
                if (pct != null && Number.isFinite(pct)) {
                  bits.push(`<div>${pct.toFixed(0)}% of product target</div>`);
                }
                bits.push(
                  `<div style="margin-top:6px;opacity:0.9">${heatCellInsight(meta, unit)}</div>`,
                );
              }
              return bits.join('');
            },
          },
          grid: { left: leftPad, right: gridRight, top: gridTop, bottom: gridBottom, containLabel: false },
          xAxis: {
            type: 'category',
            data: columns,
            triggerEvent: true,
            splitArea: { show: true },
            axisLabel: {
              color: theme.axis,
              fontSize: axisFont,
              fontWeight: 600,
              rotate: columns.length > 4 ? 32 : 0,
              interval: 0,
              formatter: (v: string) => midEllipsis(String(v), cellW < 56 ? 10 : 14),
            },
          },
          yAxis: {
            type: 'category',
            data: rows,
            triggerEvent: true,
            splitArea: { show: true },
            axisLabel: {
              color: theme.axis,
              fontSize: axisFont,
              fontWeight: 600,
              formatter: (v: string) => midEllipsis(String(v), cellH < 28 ? 12 : 18),
            },
          },
          visualMap: {
            min: 0,
            max: maxV > 0 ? maxV : 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: 8,
            inRange: {
              color: ['#f1f5f9', '#94a3b8', '#64748b', '#0f766e', '#042f2e'],
            },
            textStyle: { color: theme.muted, fontSize: Math.max(10, axisFont - 1) },
            formatter: (v: number) => fmt(Number(v)),
          },
          series: [
            {
              type: 'heatmap',
              data: values.map((d) => ({
                value: d,
                label: { color: labelColorFor(d[2]), fontSize: labelFont },
              })),
              label: {
                show: showCellLabels,
                fontSize: labelFont,
                fontWeight: 800,
                formatter: (p: {
                  data: [number, number, number] | { value: [number, number, number] };
                }) => {
                  const raw = p.data;
                  const d = Array.isArray(raw) ? raw : raw.value;
                  const v = d[2];
                  if (!(v > 0)) return '';
                  return cellFmt(v);
                },
              },
              itemStyle: {
                borderColor: 'rgba(15, 23, 42, 0.12)',
                borderWidth: 1,
              },
              emphasis: {
                itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.28)' },
              },
            },
          ],
        },
        true,
      );
    };

    applyLayout();
    const onResize = () => {
      chart.resize();
      applyLayout();
    };
    window.addEventListener('resize', onResize);

    chart.on('mouseover', (params: echarts.ECElementEvent) => {
      if (params.componentType !== 'xAxis' && params.componentType !== 'yAxis') return;
      const full = String(params.value ?? '');
      if (!full) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const ev = params.event as { offsetX?: number; offsetY?: number } | undefined;
      setAxisTip({
        text: full,
        x: ev?.offsetX ?? wrap.clientWidth / 2,
        y: ev?.offsetY ?? 40,
      });
    });
    chart.on('mouseout', (params: echarts.ECElementEvent) => {
      if (params.componentType === 'xAxis' || params.componentType === 'yAxis') {
        setAxisTip(null);
      }
    });
    chart.on('globalout', () => setAxisTip(null));

    return () => {
      window.removeEventListener('resize', onResize);
      chart.off('mouseover');
      chart.off('mouseout');
      chart.off('globalout');
    };
  }, [rows, columns, values, cellMeta, unit]);

  const onExport = useCallback(() => {
    if (!inst.current || !exportName) return;
    downloadChartPng(inst.current, chartFilename([exportName]));
  }, [exportName]);

  const chart = (
    <div ref={wrapRef} className="perfChartWrap" style={{ position: 'relative' }}>
      <div
        ref={ref}
        className="perfEchart perfEchartOverview perfProductsHeatmap"
        role="img"
        aria-label="Product by location heatmap"
      />
      {axisTip ? (
        <div className="perfChartAxisTip" style={{ left: axisTip.x, top: axisTip.y }} role="tooltip">
          {axisTip.text}
        </div>
      ) : null}
    </div>
  );
  if (!exportName) return chart;
  return (
    <ChartExportWrap onExport={onExport} label="PNG">
      {chart}
    </ChartExportWrap>
  );
}

type Props = {
  machines: MachineRow[];
  selectedIds: string[];
  allSelected: boolean;
  fleetIds: string[];
};

export function PerfProductsSection({ machines, selectedIds, allSelected, fleetIds }: Props) {
  const [timeCriteria, setTimeCriteria] = useState<TimeCriteria>('compare:this_week');
  const [aStart, setAStart] = useState(() => addDaysIso(kuwaitIsoToday(), -6));
  const [aEnd, setAEnd] = useState(() => kuwaitIsoToday());
  const [bStart, setBStart] = useState(() => addDaysIso(kuwaitIsoToday(), -13));
  const [bEnd, setBEnd] = useState(() => addDaysIso(kuwaitIsoToday(), -7));
  const [customStart, setCustomStart] = useState(() => addDaysIso(kuwaitIsoToday(), -7));
  const [customEnd, setCustomEnd] = useState(() => addDaysIso(kuwaitIsoToday(), -1));
  const [skus, setSkus] = useState<string[]>([]);
  const [graphASku, setGraphASku] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('product');
  const [yMetric, setYMetric] = useState<YMetric>('revenue');
  const [graphPage, setGraphPage] = useState(0);
  const [focusLocId, setFocusLocId] = useState('');
  const touchX = useRef<number | null>(null);

  const locNone = !allSelected && selectedIds.length === 0;
  const ids = useMemo(() => {
    if (locNone) return [];
    if (allSelected) return machines.map((m) => m.id);
    return selectedIds.slice();
  }, [allSelected, locNone, machines, selectedIds]);

  const idsKey = ids.slice().sort().join(',');

  const compareOpts = useMemo((): CompareOpts | null => {
    const [kind, key] = timeCriteria.split(':') as ['single' | 'compare', string];
    if (timeCriteria === 'compare:custom_vs_custom') {
      if (!(aStart && aEnd && bStart && bEnd && aStart <= aEnd && bStart <= bEnd)) return null;
      return { preset: 'custom_vs_custom', aStart, aEnd, bStart, bEnd };
    }
    if (timeCriteria === 'single:custom') {
      if (!(customStart && customEnd && customStart <= customEnd)) return null;
      return { preset: 'custom_single', start: customStart, end: customEnd, compare: false };
    }
    if (kind === 'single') {
      // today/yesterday/etc.: API accepts preset + compare=0 (no prior series / trends).
      return { preset: key, compare: false };
    }
    return { preset: key };
  }, [timeCriteria, aStart, aEnd, bStart, bEnd, customStart, customEnd]);

  const compareOptsKey = useMemo(() => {
    if (!compareOpts) return 'invalid';
    if (compareOpts.aStart) {
      return `cvsc:${compareOpts.aStart}:${compareOpts.aEnd}:${compareOpts.bStart}:${compareOpts.bEnd}`;
    }
    if (compareOpts.start) {
      return `c:${compareOpts.start}:${compareOpts.end}:cmp${compareOpts.compare === false ? 0 : 1}`;
    }
    return `p:${compareOpts.preset}:cmp${compareOpts.compare === false ? 0 : 1}`;
  }, [compareOpts]);

  const compareQ = useQuery({
    queryKey: ['alert-performance-product-compare', compareOptsKey, idsKey],
    queryFn: () => fetchProductCompareBatched(ids, compareOpts!),
    enabled: ids.length > 0 && Boolean(compareOpts),
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  const fleetQ = useQuery({
    queryKey: [
      'alert-performance-product-compare-fleet',
      compareOptsKey,
      fleetIds.slice().sort().join(','),
    ],
    queryFn: () => fetchProductCompareBatched(fleetIds, compareOpts!),
    enabled: fleetIds.length > 0 && Boolean(compareOpts),
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  const payloadMachines = useMemo(() => {
    const rows = compareQ.data?.machines || [];
    const byId = new Map(machines.map((m) => [m.id, m.name]));
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows
      .map((m) => {
        const name = byId.get(m.machineId);
        return name ? { ...m, machineName: name } : m;
      })
      .sort((a, b) => (order.get(a.machineId) ?? 99) - (order.get(b.machineId) ?? 99));
  }, [compareQ.data?.machines, machines, ids]);

  const fleetMachinesNamed = useMemo(() => {
    const rows = fleetQ.data?.machines || [];
    const byId = new Map(machines.map((m) => [m.id, m.name]));
    return rows.map((m) => {
      const name = byId.get(m.machineId);
      return name ? { ...m, machineName: name } : m;
    });
  }, [fleetQ.data?.machines, machines]);

  const win = fleetQ.data?.window || compareQ.data?.window;
  const compareOn =
    timeCriteria.startsWith('compare:') &&
    (fleetQ.data?.compare ?? compareQ.data?.compare) !== false;
  const periodLabel = win?.label || 'Period';
  const priorLabel = win?.prevLabel || 'Prior';
  const granularity = (fleetQ.data?.granularity || compareQ.data?.granularity || 'day') as string;
  const xAxisKind = granularity === 'hour' ? 'hourly' : 'daily';
  const windowHint =
    win?.start && win?.end
      ? compareOn && win.prevStart && win.prevEnd
        ? `${periodLabel}: ${win.start} → ${win.end} · ${priorLabel}: ${win.prevStart} → ${win.prevEnd}`
        : `${periodLabel}: ${win.start} → ${win.end} (no comparison)`
      : '';

  const mixedRows = useMemo(() => aggregateProducts(payloadMachines), [payloadMachines]);
  const fleetMix = useMemo(() => aggregateProducts(fleetMachinesNamed), [fleetMachinesNamed]);

  const focusMachine = useMemo(
    () => payloadMachines.find((m) => m.machineId === focusLocId) || null,
    [payloadMachines, focusLocId],
  );

  const skuCatalog = useMemo(() => {
    if (locNone) return [];
    if (focusMachine?.products?.length) {
      return [...focusMachine.products]
        .map((p) => ({ name: p.name, kd: Number(p.revenueKwd || 0) }))
        .sort((a, b) => b.kd - a.kd || a.name.localeCompare(b.name));
    }
    return mixedRows.map((p) => ({ name: p.name, kd: Number(p.revenueKwd || 0) }));
  }, [locNone, focusMachine, mixedRows]);

  useEffect(() => {
    if (!skuCatalog.length) return;
    const keep = skus.filter((s) => skuCatalog.some((c) => c.name === s));
    if (keep.length !== skus.length) setSkus(keep);
    if (graphASku && !skuCatalog.some((c) => c.name === graphASku)) setGraphASku('');
  }, [skuCatalog, skus, graphASku]);

  const toggleSku = useCallback((name: string) => {
    setSkus((prev) => {
      if (prev.includes(name)) return prev.filter((x) => x !== name);
      if (prev.length >= PERF_PRODUCTS_MAX_SKUS) return prev;
      return [...prev, name];
    });
  }, []);

  const selectTopSkus = useCallback(() => {
    setSkus(skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name));
  }, [skuCatalog]);

  const selectLeastSkus = useCallback(() => {
    const sorted = [...skuCatalog].sort((a, b) => a.kd - b.kd || a.name.localeCompare(b.name));
    setSkus(sorted.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name));
  }, [skuCatalog]);

  const focusSku = graphASku;
  /** Graph B needs an explicit location + product picks. */
  const showGraphB = !locNone && ids.length > 0;
  const graphBSkus = skus;
  const graphBReady = Boolean(focusLocId && graphBSkus.length > 0);

  const skuSet = useMemo(() => new Set(skus), [skus]);
  const multiLoc = ids.length > 1;

  useEffect(() => {
    if (!payloadMachines.length) {
      setFocusLocId('');
      return;
    }
    if (focusLocId && !payloadMachines.some((m) => m.machineId === focusLocId)) {
      setFocusLocId('');
    }
  }, [payloadMachines, focusLocId]);

  const inLocationRows = useMemo(() => {
    if (!skus.length) return mixedRows;
    return mixedRows.filter((p) => skuSet.has(p.name));
  }, [mixedRows, skus, skuSet]);

  const acrossByLocation = useMemo(() => {
    const want = skus;
    if (!want.length) return [];
    return payloadMachines.map((m) => {
      const byName = new Map((m.products || []).map((p) => [String(p.name || '').trim(), p] as const));
      const cells = want.map((name) => {
        const hit = byName.get(name);
        return {
          name,
          revenueKwd: Number(hit?.revenueKwd || 0),
          prevRevenueKwd: hit?.prevRevenueKwd ?? null,
          yoyRevenueKwd: Number(hit?.yoyRevenueKwd || 0),
          cups: hit?.cups ?? 0,
          prevCups: hit?.prevCups ?? null,
          trendPct: hit?.trendPct ?? null,
          yoyTrendPct: hit?.yoyTrendPct ?? null,
        };
      });
      const revenueKwd = cells.reduce((s, c) => s + c.revenueKwd, 0);
      return { machineId: m.machineId, machineName: m.machineName, cells, revenueKwd };
    });
  }, [payloadMachines, skus]);

  const selectedDays = useMemo(
    () =>
      (compareQ.data?.days?.length
        ? compareQ.data.days
        : rollupDaysFromMachines(payloadMachines)) as ProductDay[],
    [compareQ.data?.days, payloadMachines],
  );

  const showProductTargets = targetType === 'product' || targetType === 'both';
  const showMachineTargets = targetType === 'machine' || targetType === 'both';
  const chartUnit: 'kd' | 'cups' = yMetric === 'cups' ? 'cups' : 'kd';

  const pageCount = Math.max(1, Math.ceil(payloadMachines.length / PERF_PRODUCTS_GRAPH_PAGE));
  const canPage = payloadMachines.length > PERF_PRODUCTS_GRAPH_PAGE;

  useEffect(() => {
    setGraphPage(0);
  }, [idsKey, compareOptsKey]);

  useEffect(() => {
    setGraphPage((p) => Math.min(p, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  const pageMachines = useMemo(() => {
    const start = graphPage * PERF_PRODUCTS_GRAPH_PAGE;
    return payloadMachines.slice(start, start + PERF_PRODUCTS_GRAPH_PAGE);
  }, [payloadMachines, graphPage]);

  const goPrevPage = useCallback(() => setGraphPage((p) => Math.max(0, p - 1)), []);
  const goNextPage = useCallback(
    () => setGraphPage((p) => Math.min(pageCount - 1, p + 1)),
    [pageCount],
  );

  const onGraphTouchStart = (e: TouchEvent) => {
    touchX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onGraphTouchEnd = (e: TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (start == null || !canPage) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    if (Math.abs(dx) < 48) return;
    if (dx < 0) goNextPage();
    else goPrevPage();
  };

  /** Graph A — focus product across sites on current page. Product targets only (never machine KD). */
  const graphASeries = useMemo(() => {
    const series: TrajSeries[] = [];
    if (!focusSku || !pageMachines.length || !selectedDays.length) return series;
    const n = selectedDays.length;

    for (const m of pageMachines) {
      const machineDays = m.days?.length ? m.days : selectedDays;
      const dayAt = (i: number) => machineDays[i] || selectedDays[i];
      const cell = skuOnMachine(m, [focusSku]);
      const productTgt =
        yMetric === 'cups'
          ? cell.hasTarget
            ? cell.target
            : 0
          : cell.hasTargetRev
            ? cell.targetRev
            : 0;
      const periodTgt = productTgt > 0 ? productTgt : null;
      const hover: HoverPoint[] = selectedDays.map((_, i) => {
        const d = dayAt(i);
        const kd = daySkuKwd(d, focusSku);
        const cups = daySkuCups(d, focusSku);
        const priorKd = compareOn ? daySkuPrevKwd(d, focusSku) : null;
        const priorCups = compareOn ? daySkuPrevCups(d, focusSku) : null;
        const tgt = periodTgt;
        const actual = yMetric === 'cups' ? cups : kd;
        return {
          kd,
          cups,
          priorKd,
          priorCups,
          target: tgt,
          pctOfTarget: tgt != null && tgt > 0 ? (actual / tgt) * 100 : null,
        };
      });
      series.push({
        name: m.machineName,
        data: selectedDays.map((_, i) => daySkuValue(dayAt(i), focusSku, yMetric)),
        hover,
      });
      if (compareOn) {
        series.push({
          name: `Prior · ${m.machineName}`,
          data: selectedDays.map((_, i) => daySkuPrevValue(dayAt(i), focusSku, yMetric)),
          dashed: true,
        });
      }
      // Always show product target pace when configured (useful even if Target type = machine)
      if (productTgt > 0) {
        series.push({
          name: `Target · ${m.machineName}`,
          data: paceLine(productTgt, n),
          dotted: true,
        });
      }
    }
    return series;
  }, [focusSku, pageMachines, selectedDays, yMetric, compareOn]);

  /** Graph B — products at a single focus location. */
  const graphBDays = useMemo(() => {
    if (focusMachine?.days?.length) return focusMachine.days;
    return selectedDays;
  }, [focusMachine, selectedDays]);

  const graphBSeries = useMemo(() => {
    const series: TrajSeries[] = [];
    if (!graphBReady || !graphBSkus.length || !graphBDays.length || !focusMachine) return series;
    const n = graphBDays.length;
    const machineDays = focusMachine.days?.length ? focusMachine.days : graphBDays;
    const dayAt = (i: number) => machineDays[i] || graphBDays[i];

    for (const name of graphBSkus) {
      const cell = skuOnMachine(focusMachine, [name]);
      const productTgt =
        yMetric === 'cups'
          ? cell.hasTarget
            ? cell.target
            : 0
          : cell.hasTargetRev
            ? cell.targetRev
            : 0;
      const hover: HoverPoint[] = graphBDays.map((_, i) => {
        const d = dayAt(i);
        const kd = daySkuKwd(d, name);
        const cups = daySkuCups(d, name);
        const priorKd = compareOn ? daySkuPrevKwd(d, name) : null;
        const priorCups = compareOn ? daySkuPrevCups(d, name) : null;
        const actual = yMetric === 'cups' ? cups : kd;
        const periodTgt = showProductTargets && productTgt > 0 ? productTgt : null;
        return {
          kd,
          cups,
          priorKd,
          priorCups,
          target: periodTgt,
          pctOfTarget: periodTgt != null && periodTgt > 0 ? (actual / periodTgt) * 100 : null,
        };
      });
      series.push({
        name,
        data: graphBDays.map((_, i) => daySkuValue(dayAt(i), name, yMetric)),
        hover,
      });
      if (compareOn) {
        series.push({
          name: `Prior · ${name}`,
          data: graphBDays.map((_, i) => daySkuPrevValue(dayAt(i), name, yMetric)),
          dashed: true,
        });
      }
      if (showProductTargets && productTgt > 0) {
        series.push({
          name: `Target · ${name}`,
          data: paceLine(productTgt, n),
          dotted: true,
        });
      }
    }
    // One machine-location target line (not per product) — Graph B only
    if (showMachineTargets) {
      const locTgt =
        yMetric === 'cups'
          ? Number(focusMachine.locationTargetCups || 0)
          : Number(focusMachine.locationTargetKd || 0);
      if (locTgt > 0) {
        series.push({
          name: 'Target · machine',
          data: paceLine(locTgt, n),
          dotted: true,
        });
      }
    }
    return series;
  }, [
    graphBReady,
    graphBSkus,
    graphBDays,
    focusMachine,
    yMetric,
    compareOn,
    showProductTargets,
    showMachineTargets,
  ]);

  /** Graph C — heatmap columns/rows (period totals only). */
  const heatColumns = useMemo(() => skus.slice(0, PERF_PRODUCTS_MAX_SKUS), [skus]);

  const heatMatrix = useMemo(() => {
    if (!payloadMachines.length || !heatColumns.length) {
      return {
        rows: [] as string[],
        values: [] as Array<[number, number, number]>,
        cellMeta: new Map<string, HeatCellMeta>(),
      };
    }
    const scored = payloadMachines.map((m) => {
      const byName = new Map(
        (m.products || []).map((p) => [String(p.name || '').trim(), p] as const),
      );
      const cells = heatColumns.map((name) => {
        const hit = byName.get(name);
        const revenueKwd = Number(hit?.revenueKwd || 0);
        const cups = Number(hit?.cups || 0);
        const value = yMetric === 'cups' ? cups : revenueKwd;
        const meta: HeatCellMeta = {
          machine: m.machineName,
          product: name,
          revenueKwd,
          cups,
          prevRevenueKwd: hit?.prevRevenueKwd ?? null,
          prevCups: hit?.prevCups ?? null,
          trendPct: hit?.trendPct ?? null,
          cupsTrendPct: hit?.cupsTrendPct ?? null,
          yoyTrendPct: hit?.yoyTrendPct ?? null,
          pctOfTarget: hit?.pctOfTarget ?? null,
          pctOfRevenueTarget: hit?.pctOfRevenueTarget ?? null,
        };
        return { value, meta };
      });
      const total = cells.reduce((s, c) => s + c.value, 0);
      return { machineName: m.machineName, cells, total };
    });
    scored.sort(
      (a, b) => b.total - a.total || a.machineName.localeCompare(b.machineName),
    );
    const rows = scored.map((r) => r.machineName);
    const values: Array<[number, number, number]> = [];
    const cellMeta = new Map<string, HeatCellMeta>();
    scored.forEach((r, ri) => {
      r.cells.forEach((c, ci) => {
        values.push([ci, ri, c.value]);
        cellMeta.set(`${ci},${ri}`, c.meta);
      });
    });
    return { rows, values, cellMeta };
  }, [payloadMachines, heatColumns, yMetric]);

  const paceStrip = useMemo(() => {
    if (!focusSku || !payloadMachines.length) return null;
    let actual = 0;
    let target = 0;
    let hasTarget = false;
    for (const m of payloadMachines) {
      const cell = skuOnMachine(m, [focusSku]);
      actual += yMetric === 'cups' ? cell.cups : cell.revenue;
      if (yMetric === 'cups') {
        if (cell.hasTarget) {
          target += cell.target;
          hasTarget = true;
        }
      } else if (cell.hasTargetRev) {
        target += cell.targetRev;
        hasTarget = true;
      }
    }
    if (!hasTarget || !(target > 0)) {
      return {
        focusSku,
        actual,
        target: null as number | null,
        pct: null as number | null,
        expected: null as number | null,
        delta: null as number | null,
        ahead: null as boolean | null,
      };
    }
    return {
      focusSku,
      actual,
      target,
      pct: (actual / target) * 100,
      expected: target,
      delta: actual - target,
      ahead: actual >= target,
    };
  }, [focusSku, payloadMachines, yMetric]);

  // Better linear pace: use calendar span when window dates exist.
  const paceStripCalibrated = useMemo(() => {
    if (!paceStrip || paceStrip.target == null) return paceStrip;
    const start = win?.start;
    const end = win?.end;
    if (!start || !end) return paceStrip;
    const startMs = Date.parse(`${start}T12:00:00Z`);
    const endMs = Date.parse(`${end}T12:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return paceStrip;
    const spanDays = Math.round((endMs - startMs) / 86400000) + 1;
    const today = kuwaitIsoToday();
    const todayMs = Date.parse(`${today}T12:00:00Z`);
    const elapsedEnd = Math.min(endMs, todayMs);
    const elapsedDays = Math.max(1, Math.round((elapsedEnd - startMs) / 86400000) + 1);
    const expected = paceStrip.target * (elapsedDays / spanDays);
    const delta = paceStrip.actual - expected;
    return {
      ...paceStrip,
      expected,
      delta,
      ahead: delta >= 0,
      pct: (paceStrip.actual / paceStrip.target) * 100,
    };
  }, [paceStrip, win?.start, win?.end]);

  const rising = useMemo(
    () =>
      mixedRows
        .filter((p) => p.trendPct != null && Number(p.trendPct) > 0)
        .sort((a, b) => Number(b.trendPct) - Number(a.trendPct))
        .slice(0, 8),
    [mixedRows],
  );
  const falling = useMemo(
    () =>
      mixedRows
        .filter((p) => p.trendPct != null && Number(p.trendPct) < 0)
        .sort((a, b) => Number(a.trendPct) - Number(b.trendPct))
        .slice(0, 8),
    [mixedRows],
  );

  const onExportReport = useCallback(() => {
    downloadWeeklyProductReportPdf({
      periodLabel,
      priorLabel,
      windowStart: win?.start,
      windowEnd: win?.end,
      fleetProducts: fleetMix,
      machines: fleetMachinesNamed,
      focusProduct: focusSku || null,
      compare: compareOn,
    });
  }, [periodLabel, priorLabel, win, fleetMix, fleetMachinesNamed, focusSku, compareOn]);

  const tableSkus = skus;

  const detailTable = (
    <div className="perfProductsTableWrap">
      {!multiLoc ? (
        <table className="perfProductsTable">
          <thead>
            <tr>
              <ThTip title={PRODUCT_COL_TIPS.drink}>Drink</ThTip>
              <ThTip title={PRODUCT_COL_TIPS.periodKd(periodLabel)}>{periodLabel} KD</ThTip>
              {compareOn ? (
                <ThTip title={PRODUCT_COL_TIPS.priorKd(priorLabel)}>{priorLabel} KD</ThTip>
              ) : null}
              {compareOn ? <ThTip title={PRODUCT_COL_TIPS.vsPrior}>vs prior</ThTip> : null}
              <ThTip title={PRODUCT_COL_TIPS.cups}>Cups</ThTip>
              {compareOn ? <ThTip title={PRODUCT_COL_TIPS.priorCups}>Prior cups</ThTip> : null}
              <ThTip title={PRODUCT_COL_TIPS.lyKd}>LY KD</ThTip>
              <ThTip title={PRODUCT_COL_TIPS.yoy}>YoY</ThTip>
            </tr>
          </thead>
          <tbody>
            {locNone ? (
              <tr>
                <td colSpan={8}>Select locations above.</td>
              </tr>
            ) : inLocationRows.length === 0 ? (
              <tr>
                <td colSpan={8}>No product mix for this selection in the window yet.</td>
              </tr>
            ) : (
              inLocationRows.map((p) => (
                <tr
                  key={p.name}
                  className={skuSet.has(p.name) ? 'perfProductsRowActive' : undefined}
                  onClick={() => toggleSku(p.name)}
                >
                  <td>{p.name}</td>
                  <td>{formatKwd(Number(p.revenueKwd || 0))}</td>
                  {compareOn ? <td>{formatKwd(Number(p.prevRevenueKwd || 0))}</td> : null}
                  {compareOn ? (
                    <td className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</td>
                  ) : null}
                  <td>{p.cups != null ? Math.round(Number(p.cups)) : '—'}</td>
                  {compareOn ? (
                    <td>{p.prevCups != null ? Math.round(Number(p.prevCups)) : '—'}</td>
                  ) : null}
                  <td>{formatKwd(Number(p.yoyRevenueKwd || 0))}</td>
                  <td className={trendClass(p.yoyTrendPct)}>{trendText(p.yoyTrendPct)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : (
        <table className="perfProductsTable">
          <thead>
            <tr>
              <ThTip title={PRODUCT_COL_TIPS.location}>Location</ThTip>
              {tableSkus.length > 1 ? <ThTip title={PRODUCT_COL_TIPS.drink}>Drink</ThTip> : null}
              <ThTip title={PRODUCT_COL_TIPS.periodKd(periodLabel)}>{periodLabel} KD</ThTip>
              {compareOn ? (
                <ThTip title={PRODUCT_COL_TIPS.priorKd(priorLabel)}>{priorLabel} KD</ThTip>
              ) : null}
              {compareOn ? <ThTip title={PRODUCT_COL_TIPS.vsPrior}>vs prior</ThTip> : null}
              <ThTip title={PRODUCT_COL_TIPS.cups}>Cups</ThTip>
              <ThTip title={PRODUCT_COL_TIPS.lyKd}>LY KD</ThTip>
              <ThTip title={PRODUCT_COL_TIPS.yoy}>YoY</ThTip>
            </tr>
          </thead>
          <tbody>
            {locNone ? (
              <tr>
                <td colSpan={8}>Select locations above.</td>
              </tr>
            ) : !tableSkus.length ? (
              <tr>
                <td colSpan={8}>Pick a drink in Products (max {PERF_PRODUCTS_MAX_SKUS}).</td>
              </tr>
            ) : (
              [...acrossByLocation]
                .sort(
                  (a, b) =>
                    b.revenueKwd - a.revenueKwd || a.machineName.localeCompare(b.machineName),
                )
                .flatMap((r) =>
                  r.cells.map((c) => (
                    <tr key={`${r.machineId}:${c.name}`}>
                      <td>{r.machineName}</td>
                      {tableSkus.length > 1 ? <td>{c.name}</td> : null}
                      <td>{formatKwd(c.revenueKwd)}</td>
                      {compareOn ? <td>{formatKwd(Number(c.prevRevenueKwd || 0))}</td> : null}
                      {compareOn ? (
                        <td className={trendClass(c.trendPct)}>{trendText(c.trendPct)}</td>
                      ) : null}
                      <td>{c.cups != null ? Math.round(Number(c.cups)) : '—'}</td>
                      <td>{formatKwd(c.yoyRevenueKwd)}</td>
                      <td className={trendClass(c.yoyTrendPct)}>{trendText(c.yoyTrendPct)}</td>
                    </tr>
                  )),
                )
            )}
          </tbody>
        </table>
      )}
    </div>
  );

  const fmtPace = (v: number) =>
    yMetric === 'cups' ? `${Math.round(v)} cups` : formatKwd(v);

  return (
    <section className="perfProducts" aria-labelledby="perf-products-title">
      <header className="perfProductsHead">
        <div className="perfProductsHeadCopy">
          <h3 id="perf-products-title" className="perfProductsTitle">
            Product performance
          </h3>
          <p className="perfProductsLead">
            Locations above · A = one drink × sites · B &amp; C = drinks you pick · Y-axis ={' '}
            {yMetric === 'cups' ? 'cups' : 'revenue KD'}
          </p>
          {windowHint ? <p className="perfProductsWindow">{windowHint}</p> : null}
        </div>
        <button type="button" className="perfSegPill perfSegPillEmphasis" onClick={onExportReport}>
          Export weekly report
        </button>
      </header>

      <div className="perfProductsWorkspace" aria-label="Workspace criteria">
        <div className="perfProductsToolbar">
          <label className="perfProductsField">
            <span className="perfProductsFieldLabel">Time</span>
            <select
              value={timeCriteria}
              onChange={(e) => setTimeCriteria(e.target.value as TimeCriteria)}
              aria-label="Time criteria"
            >
              <optgroup label="One duration (no comparison)">
                {SINGLE_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Compare two durations">
                {COMPARE_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="perfProductsField">
            <span className="perfProductsFieldLabel">Target type</span>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
              aria-label="Target type"
            >
              <option value="product">Product target</option>
              <option value="machine">Machine target</option>
              <option value="both">Both</option>
            </select>
          </label>

          <div className="perfProductsField" role="group" aria-label="Y-axis metric">
            <span className="perfProductsFieldLabel">Y-axis</span>
            <div className="perfProductsMetricSeg">
              <button
                type="button"
                className={`perfSegPill ${yMetric === 'revenue' ? 'active' : ''}`}
                onClick={() => setYMetric('revenue')}
              >
                Revenue
              </button>
              <button
                type="button"
                className={`perfSegPill ${yMetric === 'cups' ? 'active' : ''}`}
                onClick={() => setYMetric('cups')}
              >
                Cups
              </button>
            </div>
          </div>
        </div>

        {timeCriteria === 'compare:custom_vs_custom' ? (
          <div className="perfProductsCustomRange">
            <label>
              Period A from
              <input
                type="date"
                value={aStart}
                max={aEnd || kuwaitIsoToday()}
                onChange={(e) => setAStart(e.target.value)}
              />
            </label>
            <label>
              Period A to
              <input
                type="date"
                value={aEnd}
                min={aStart}
                max={kuwaitIsoToday()}
                onChange={(e) => setAEnd(e.target.value)}
              />
            </label>
            <label>
              Period B from
              <input
                type="date"
                value={bStart}
                max={bEnd || kuwaitIsoToday()}
                onChange={(e) => setBStart(e.target.value)}
              />
            </label>
            <label>
              Period B to
              <input
                type="date"
                value={bEnd}
                min={bStart}
                max={kuwaitIsoToday()}
                onChange={(e) => setBEnd(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {timeCriteria === 'single:custom' ? (
          <div className="perfProductsCustomRange">
            <label>
              From
              <input
                type="date"
                value={customStart}
                max={customEnd || kuwaitIsoToday()}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={kuwaitIsoToday()}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        ) : null}

        {!compareOpts ? (
          <p className="perfError">Fix the custom dates (from ≤ to) to load charts.</p>
        ) : null}
        {locNone ? <p className="perfMuted">Pick at least one location above.</p> : null}
        {compareQ.isError ? <p className="perfError">{(compareQ.error as Error).message}</p> : null}
        {compareQ.data?.error ? <p className="perfError">{compareQ.data.error}</p> : null}
      </div>

      <section className="perfProductsCard" aria-labelledby="perf-products-graph-a">
        <header className="perfProductsCardHead">
          <div className="perfProductsCardTitleRow">
            <span className="perfProductsCardBadge" aria-hidden>
              A
            </span>
            <div>
              <h4 id="perf-products-graph-a" className="perfProductsCardTitle">
                {focusSku ? `${focusSku} across sites` : 'One product across sites'}
              </h4>
              <p className="perfProductsCardHint">
                One drink · lines = sites on this page
                {xAxisKind === 'hourly' ? ' · hours on X' : ' · dates on X'}
                {compareOn ? ' · dashed = prior' : ''}
                {' · dotted = product target when set'}
              </p>
            </div>
          </div>
        </header>
        <div className="perfProductsCardToolbar">
          <label className="perfProductsField perfProductsFieldGrow">
            <span className="perfProductsFieldLabel">Product</span>
            <select
              value={graphASku}
              onChange={(e) => setGraphASku(e.target.value)}
              aria-label="Product for Graph A"
              disabled={locNone || skuCatalog.length === 0}
            >
              <option value="">Select a product…</option>
              {skuCatalog.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {canPage && focusSku ? (
            <div className="perfProductsPageMeta" aria-live="polite">
              Page {graphPage + 1}/{pageCount} · sites{' '}
              {graphPage * PERF_PRODUCTS_GRAPH_PAGE + 1}–
              {graphPage * PERF_PRODUCTS_GRAPH_PAGE + pageMachines.length} of {payloadMachines.length}
            </div>
          ) : null}
        </div>
        {compareQ.isLoading && ids.length > 0 ? <p className="perfMuted">Loading selected mix…</p> : null}
        {!focusSku ? (
          <p className="perfProductsEmpty">Select a product for this graph.</p>
        ) : (
          <>
            <div
              className="perfGraphStage"
              onTouchStart={onGraphTouchStart}
              onTouchEnd={onGraphTouchEnd}
            >
              <button
                type="button"
                className="perfGraphSideBtn"
                disabled={!canPage || graphPage <= 0}
                onClick={goPrevPage}
                aria-label="Previous graph page"
              >
                ‹
              </button>
              <DateTrajectoryChart
                days={selectedDays}
                series={graphASeries}
                unit={chartUnit}
                exportName="product-across-sites"
                ariaLabel="Focus product across sites"
              />
              <button
                type="button"
                className="perfGraphSideBtn"
                disabled={!canPage || graphPage >= pageCount - 1}
                onClick={goNextPage}
                aria-label="Next graph page"
              >
                ›
              </button>
            </div>
            {paceStripCalibrated ? (
              <div className="perfProductsPace" aria-label="Pace vs target">
                <strong>{paceStripCalibrated.focusSku}</strong>
                <span>
                  Actual {fmtPace(paceStripCalibrated.actual)}
                  {paceStripCalibrated.target != null ? (
                    <>
                      {' '}
                      · Target {fmtPace(paceStripCalibrated.target)}
                      {paceStripCalibrated.pct != null
                        ? ` (${paceStripCalibrated.pct.toFixed(0)}% of target)`
                        : ''}
                    </>
                  ) : (
                    ' · No product target set'
                  )}
                </span>
                {paceStripCalibrated.expected != null && paceStripCalibrated.delta != null ? (
                  <span className={paceStripCalibrated.ahead ? 'alertSalesUp' : 'alertSalesDown'}>
                    {paceStripCalibrated.ahead ? 'Ahead' : 'Behind'} linear pace by{' '}
                    {fmtPace(Math.abs(paceStripCalibrated.delta))} (expected{' '}
                    {fmtPace(paceStripCalibrated.expected)})
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      {showGraphB ? (
        <section className="perfProductsCard" aria-labelledby="perf-products-graph-b">
          <header className="perfProductsCardHead">
            <div className="perfProductsCardTitleRow">
              <span className="perfProductsCardBadge" aria-hidden>
                B
              </span>
              <div>
                <h4 id="perf-products-graph-b" className="perfProductsCardTitle">
                  Products at one location
                </h4>
                <p className="perfProductsCardHint">
                  Pick location + drinks below · Top / Least helpers · not a fleet sum
                  {showMachineTargets ? ' · machine target overlays when set' : ''}
                </p>
              </div>
            </div>
          </header>
          <div className="perfProductsCardToolbar perfProductsCardToolbarPair">
            <label className="perfProductsField perfProductsFieldGrow">
              <span className="perfProductsFieldLabel">Focus location</span>
              <select
                value={focusLocId}
                onChange={(e) => setFocusLocId(e.target.value)}
                aria-label="Focus location for Graph B"
              >
                <option value="">Select a location…</option>
                {payloadMachines.map((m) => (
                  <option key={m.machineId} value={m.machineId}>
                    {m.machineName}
                  </option>
                ))}
              </select>
            </label>
            <SkuMultiDropdown
              embedded
              options={skuCatalog}
              selected={skus}
              onToggle={toggleSku}
              onClear={() => setSkus([])}
              onSelectTop={selectTopSkus}
              onSelectLeast={selectLeastSkus}
            />
          </div>
          {!graphBReady ? (
            <p className="perfProductsEmpty">
              {!focusLocId ? 'Select a focus location. ' : ''}
              {!graphBSkus.length ? 'Select products (or Top / Least).' : ''}
            </p>
          ) : (
            <DateTrajectoryChart
              days={graphBDays}
              series={graphBSeries}
              unit={chartUnit}
              onSeriesClick={toggleSku}
              exportName="product-at-location"
              ariaLabel="Products at focus location"
            />
          )}
          {compareOn ? (
            <div className="perfProductsTrendCols">
              <div className="perfProductsTrendPanel perfProductsTrendPanel--up">
                <h5 className="perfProductsTrendHead">
                  <span className="perfProductsTrendIcon" aria-hidden>
                    ▲
                  </span>
                  Rising
                </h5>
                {rising.length ? (
                  <ul className="perfProductsTrendList perfProductsTrendDetailed">
                    {rising.map((p, idx) => (
                      <li
                        key={p.name}
                        className="perfProductsTrendItem"
                        style={{ animationDelay: `${Math.min(idx, 8) * 45}ms` }}
                      >
                        <button type="button" onClick={() => toggleSku(p.name)}>
                          {p.name}
                        </button>
                        <div className="perfProductsTrendMeta">
                          <strong className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</strong>
                          <span>
                            <b>{formatKwd(Number(p.revenueKwd || 0))}</b>
                            <span className="perfProductsTrendFrom">
                              {' '}
                              from {formatKwd(Number(p.prevRevenueKwd || 0))}
                            </span>
                          </span>
                          <span className={`perfProductsTrendCups ${trendClass(p.cupsTrendPct)}`}>
                            <b className="perfProductsTrendCupsVal">
                              {Math.round(Number(p.cups || 0))} cups
                            </b>{' '}
                            <b className="perfProductsTrendCupsPct">({trendText(p.cupsTrendPct)})</b>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="perfMuted">None up vs prior.</p>
                )}
              </div>
              <div className="perfProductsTrendPanel perfProductsTrendPanel--down">
                <h5 className="perfProductsTrendHead">
                  <span className="perfProductsTrendIcon" aria-hidden>
                    ▼
                  </span>
                  Falling
                </h5>
                {falling.length ? (
                  <ul className="perfProductsTrendList perfProductsTrendDetailed">
                    {falling.map((p, idx) => (
                      <li
                        key={p.name}
                        className="perfProductsTrendItem"
                        style={{ animationDelay: `${Math.min(idx, 8) * 45}ms` }}
                      >
                        <button type="button" onClick={() => toggleSku(p.name)}>
                          {p.name}
                        </button>
                        <div className="perfProductsTrendMeta">
                          <strong className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</strong>
                          <span>
                            <b>{formatKwd(Number(p.revenueKwd || 0))}</b>
                            <span className="perfProductsTrendFrom">
                              {' '}
                              from {formatKwd(Number(p.prevRevenueKwd || 0))}
                            </span>
                          </span>
                          <span className={`perfProductsTrendCups ${trendClass(p.cupsTrendPct)}`}>
                            <b className="perfProductsTrendCupsVal">
                              {Math.round(Number(p.cups || 0))} cups
                            </b>{' '}
                            <b className="perfProductsTrendCupsPct">({trendText(p.cupsTrendPct)})</b>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="perfMuted">None down vs prior.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="perfMuted">Rising / falling need a comparison period.</p>
          )}
        </section>
      ) : null}

      {!locNone ? (
        <section className="perfProductsCard" aria-labelledby="perf-products-graph-c">
          <header className="perfProductsCardHead">
            <div className="perfProductsCardTitleRow">
              <span className="perfProductsCardBadge" aria-hidden>
                C
              </span>
              <div>
                <h4 id="perf-products-graph-c" className="perfProductsCardTitle">
                  Heatmap — products × locations
                </h4>
                <p className="perfProductsCardHint">
                  Uses products from Graph B · cell = period{' '}
                  {yMetric === 'cups' ? 'cups' : 'revenue KD'} · hover for trend
                </p>
              </div>
            </div>
            {skus.length > 0 ? (
              <div className="perfProductsCardMeta">
                {skus.length} drink{skus.length === 1 ? '' : 's'} · sorted by site sales
              </div>
            ) : null}
          </header>
          {heatColumns.length === 0 ? (
            <p className="perfProductsEmpty">Select products in Graph B to draw the heatmap.</p>
          ) : (
            <ProductHeatmapChart
              rows={heatMatrix.rows}
              columns={heatColumns}
              values={heatMatrix.values}
              cellMeta={heatMatrix.cellMeta}
              unit={chartUnit}
              exportName="product-location-heatmap"
            />
          )}
        </section>
      ) : null}

      <section className="perfProductsCard" aria-labelledby="perf-products-table">
        <header className="perfProductsCardHead">
          <div className="perfProductsCardTitleRow">
            <span className="perfProductsCardBadge muted" aria-hidden>
              #
            </span>
            <div>
              <h4 id="perf-products-table" className="perfProductsCardTitle">
                Detail table
              </h4>
              <p className="perfProductsCardHint">Click a drink row to toggle the B/C filter.</p>
            </div>
          </div>
        </header>
        {detailTable}
      </section>
    </section>
  );
}
