import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { apiGet } from '@/lib/api';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { SERIES_PALETTE, type MachineRow } from '@/features/performance/perfTypes';
import { downloadWeeklyProductReportPdf } from '@/features/performance/exportWeeklyProductReportPdf';

/** Sites drawn on Graph A per page (‹ ›). */
export const PERF_PRODUCTS_GRAPH_PAGE = 8;
/** @deprecated Alias — machine selection is uncapped; paging uses GRAPH_PAGE. */
export const PERF_PRODUCTS_MAX_LOCATIONS = PERF_PRODUCTS_GRAPH_PAGE;
export const PERF_PRODUCTS_MAX_SKUS = 8;

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
    return { text: '#0f172a', muted: '#64748b', grid: 'rgba(15, 23, 42, 0.08)', axis: '#94a3b8' };
  }
  return { text: '#e2e8f0', muted: '#94a3b8', grid: 'rgba(148, 163, 184, 0.12)', axis: '#64748b' };
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

function formatHoverValue(metric: YMetric, v: number): string {
  return metric === 'cups' ? String(Math.round(v)) : formatKwd(v);
}

function SkuMultiDropdown({
  options,
  selected,
  onToggle,
  onClear,
  onSelectTop,
  onSelectLeast,
}: {
  options: { name: string; kd: number }[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  onSelectTop: () => void;
  onSelectLeast: () => void;
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
    : 'Select drinks for Graph B & heatmap…';

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
    // Defer so the opening click does not immediately close the panel
    const t = window.setTimeout(() => document.addEventListener('click', onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', onDoc);
    };
  }, [open]);

  return (
    <section
      className={`perfMachineFilter perfMachineFilterBar${open ? ' perfSkuDropdownOpen' : ''}`}
      aria-label="Filter drinks"
    >
      <div className="perfLocBarMain" ref={rootRef}>
        <div className="perfLocBarLabel">
          <h3 className="perfMachineFilterTitle">Products (B & C)</h3>
          <span className="perfMachineFilterCount">
            {selected.length}/{PERF_PRODUCTS_MAX_SKUS} max
          </span>
        </div>
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
            <div
              className="perfLocDropdown"
              role="listbox"
              onClick={(e) => e.stopPropagation()}
            >
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
                        <span className="perfSkuKd">{formatKwd(o.kd)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
        {selected.length > 0 ? (
          <div className="perfLocChips">
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
      <p className="perfMachineFilterHint">
        {atCapHint
          ? `Maximum ${PERF_PRODUCTS_MAX_SKUS} drinks. Uncheck one to add another.`
          : `Used by Graph B and the heatmap. Graph A has its own product picker. Helpers: Top / Least ${PERF_PRODUCTS_MAX_SKUS}.`}
      </p>
    </section>
  );
}

/** Location-style trajectory: calendar dates on X, one line per series. */
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
  const inst = useRef<echarts.ECharts | null>(null);

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
    chart.setOption(
      {
        color: SERIES_PALETTE,
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { type: 'dashed' } },
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
            const lines = [`<div style="font-weight:700;margin-bottom:6px">${head}</div>`];
            for (const p of arr) {
              if (p.value == null || !Number.isFinite(Number(p.value))) continue;
              const s = byName.get(String(p.seriesName || ''));
              const h = s?.hover?.[i];
              const name = String(p.seriesName || '');
              if (h) {
                const bits: string[] = [
                  `<b>${name}</b>: ${formatHoverValue(unit === 'cups' ? 'cups' : 'revenue', Number(p.value))}`,
                ];
                bits.push(`KD ${formatKwd(h.kd)} · ${Math.round(h.cups)} cups`);
                if (h.priorKd != null || h.priorCups != null) {
                  bits.push(
                    `Prior: ${formatKwd(Number(h.priorKd || 0))} · ${Math.round(Number(h.priorCups || 0))} cups`,
                  );
                }
                if (h.target != null && Number(h.target) > 0) {
                  const tgtLabel = unit === 'cups' ? `${Math.round(h.target)} cups` : formatKwd(h.target);
                  bits.push(`Period target: ${tgtLabel}`);
                  if (h.pctOfTarget != null && Number.isFinite(h.pctOfTarget)) {
                    bits.push(`${h.pctOfTarget.toFixed(0)}% of target`);
                  }
                }
                lines.push(
                  `<div style="margin-bottom:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${bits.join('<br/>')}</div>`,
                );
              } else {
                lines.push(
                  `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span><b>${name}</b>: ${fmt(Number(p.value))}</div>`,
                );
              }
            }
            return lines.join('');
          },
        },
        legend: {
          type: 'scroll',
          data: series.map((s) => s.name),
          textStyle: { color: theme.muted, fontSize: 11 },
        },
        grid: { left: 56, right: 52, top: 40, bottom: compact ? 48 : 56, containLabel: false },
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
            alignMinLabel: 'left',
            alignMaxLabel: 'right',
          },
        },
        yAxis: {
          type: 'value',
          name: unit === 'cups' ? 'Cups' : 'KD',
          scale: true,
          min: yMin,
          max: yMax,
          axisLabel: { color: theme.axis, formatter: (v: number) => fmt(v) },
          splitLine: { lineStyle: { color: theme.grid } },
        },
        series: series.map((s) => ({
          name: s.name,
          type: 'line',
          data: s.data,
          smooth: s.dotted ? false : 0.25,
          showSymbol: days.length <= 14 && !s.dotted,
          symbol: 'circle',
          symbolSize: compact ? 5 : 7,
          clip: !s.dotted,
          lineStyle: {
            width: s.dotted ? 2 : 2.4,
            type: s.dotted ? 'dotted' : s.dashed ? 'dashed' : 'solid',
            opacity: s.dotted ? 0.85 : 1,
          },
        })),
      },
      true,
    );
    if (onSeriesClick) {
      chart.on('click', (params: { seriesName?: string }) => {
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
    <div
      ref={ref}
      className={`perfEchart ${compact ? 'perfEchartCompact' : 'perfEchartOverview'}`}
      role="img"
      aria-label={ariaLabel || 'Daily product trajectory'}
    />
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
  const inst = useRef<echarts.ECharts | null>(null);

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
    if (!rows.length || !columns.length) {
      chart.clear();
      return;
    }
    const maxV = Math.max(0, ...values.map((v) => v[2]));
    const fmt = (v: number) => (unit === 'cups' ? String(Math.round(v)) : formatKwd(v));
    const labelColorFor = (v: number) => {
      const t = maxV > 0 ? v / maxV : 0;
      return t >= 0.42 ? '#f8fafc' : '#0f172a';
    };
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
                bits.push(`<div>Trend KD: ${formatSalesTrendPct(meta.trendPct)}</div>`);
              }
              if (meta.cupsTrendPct != null && Number.isFinite(meta.cupsTrendPct)) {
                bits.push(`<div>Trend cups: ${formatSalesTrendPct(meta.cupsTrendPct)}</div>`);
              }
              if (meta.yoyTrendPct != null && Number.isFinite(meta.yoyTrendPct)) {
                bits.push(`<div>YoY: ${formatSalesTrendPct(meta.yoyTrendPct)}</div>`);
              }
              const pct =
                unit === 'cups' ? meta.pctOfTarget : meta.pctOfRevenueTarget;
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
        grid: { left: 120, right: 48, top: 24, bottom: 72, containLabel: false },
        xAxis: {
          type: 'category',
          data: columns,
          splitArea: { show: true },
          axisLabel: {
            color: theme.axis,
            fontSize: 10,
            rotate: columns.length > 4 ? 28 : 0,
            interval: 0,
            width: 88,
            overflow: 'truncate',
          },
        },
        yAxis: {
          type: 'category',
          data: rows,
          splitArea: { show: true },
          axisLabel: {
            color: theme.axis,
            fontSize: 10,
            width: 110,
            overflow: 'truncate',
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
            // Warm slate → deep teal: mid cells stay readable with dark labels
            color: ['#f1f5f9', '#94a3b8', '#64748b', '#0f766e', '#042f2e'],
          },
          textStyle: { color: theme.muted, fontSize: 10 },
          formatter: (v: number) => fmt(Number(v)),
        },
        series: [
          {
            type: 'heatmap',
            data: values.map((d) => ({
              value: d,
              label: { color: labelColorFor(d[2]) },
            })),
            label: {
              show: columns.length * rows.length <= 64,
              fontSize: 9,
              fontWeight: 600,
              formatter: (p: {
                data: [number, number, number] | { value: [number, number, number] };
              }) => {
                const raw = p.data;
                const d = Array.isArray(raw) ? raw : raw.value;
                const v = d[2];
                if (!(v > 0)) return '';
                return unit === 'cups' ? String(Math.round(v)) : formatKwd(v);
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
  }, [rows, columns, values, cellMeta, unit]);

  const onExport = useCallback(() => {
    if (!inst.current || !exportName) return;
    downloadChartPng(inst.current, chartFilename([exportName]));
  }, [exportName]);

  const chart = (
    <div
      ref={ref}
      className="perfEchart perfEchartOverview perfProductsHeatmap"
      role="img"
      aria-label="Product by location heatmap"
    />
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

  const skuCatalog = useMemo(() => {
    const src = fleetMix.length ? fleetMix : mixedRows;
    return src.map((p) => ({ name: p.name, kd: Number(p.revenueKwd || 0) }));
  }, [fleetMix, mixedRows]);

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

  const focusMachine = useMemo(
    () => payloadMachines.find((m) => m.machineId === focusLocId) || null,
    [payloadMachines, focusLocId],
  );

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
      const periodTgt = showProductTargets && productTgt > 0 ? productTgt : null;
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
      if (showProductTargets && productTgt > 0) {
        series.push({
          name: `Target · ${m.machineName}`,
          data: paceLine(productTgt, n),
          dotted: true,
        });
      }
    }
    return series;
  }, [focusSku, pageMachines, selectedDays, yMetric, compareOn, showProductTargets]);

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
              <th>Drink</th>
              <th>{periodLabel} KD</th>
              {compareOn ? <th>{priorLabel} KD</th> : null}
              {compareOn ? <th>vs prior</th> : null}
              <th>Cups</th>
              {compareOn ? <th>Prior cups</th> : null}
              <th>LY KD</th>
              <th>YoY</th>
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
              <th>Location</th>
              {tableSkus.length > 1 ? <th>Drink</th> : null}
              <th>{periodLabel} KD</th>
              {compareOn ? <th>{priorLabel} KD</th> : null}
              {compareOn ? <th>vs prior</th> : null}
              <th>Cups</th>
              <th>LY KD</th>
              <th>YoY</th>
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
        <div>
          <h3 id="perf-products-title" className="perfSectionTitle">
            Product performance
          </h3>
          <aside className="perfProductsGuide" aria-label="How to use product performance">
            <ol className="perfProductsGuideList">
              <li className="active">
                <strong>1. Time</strong> — one duration or compare two durations.
              </li>
              <li className={!locNone ? 'active' : undefined}>
                <strong>2. Locations</strong> — any number; Graph A pages {PERF_PRODUCTS_GRAPH_PAGE}{' '}
                sites at a time.
              </li>
              <li className={graphASku || skus.length > 0 ? 'active' : undefined}>
                <strong>3. Products</strong> — Graph A: pick one drink; B &amp; C: pick up to{' '}
                {PERF_PRODUCTS_MAX_SKUS} (Top / Least helpers).
              </li>
            </ol>
          </aside>
          {windowHint ? <p className="perfSectionHint">{windowHint}</p> : null}
        </div>
        <button type="button" className="perfSegPill perfSegPillEmphasis" onClick={onExportReport}>
          Export weekly report
        </button>
      </header>

      <div className="perfProductsCriteria" aria-label="Product criteria">
        <label className="perfProductsCriteriaField">
          <span>Time criteria</span>
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
          <small>
            {timeCriteria.startsWith('single:')
              ? 'No prior lines or rising/falling.'
              : 'Dashed = prior period.'}{' '}
            Dotted = target pace.
          </small>
        </label>

        <label className="perfProductsCriteriaField">
          <span>Target type</span>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as TargetType)}
            aria-label="Target type"
          >
            <option value="product">Product target</option>
            <option value="machine">Machine target</option>
            <option value="both">Both</option>
          </select>
          <small>
            A uses product targets only. B can overlay product lines and one machine target.
          </small>
        </label>
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
          <p className="perfSectionHint">Single range — no prior comparison.</p>
        </div>
      ) : null}

      {!compareOpts ? <p className="perfError">Fix the custom dates (from ≤ to) to load charts.</p> : null}

      <SkuMultiDropdown
        options={skuCatalog}
        selected={skus}
        onToggle={toggleSku}
        onClear={() => setSkus([])}
        onSelectTop={selectTopSkus}
        onSelectLeast={selectLeastSkus}
      />

      {locNone ? <p className="perfMuted">Pick at least one location above.</p> : null}
      {compareQ.isError ? <p className="perfError">{(compareQ.error as Error).message}</p> : null}
      {compareQ.data?.error ? <p className="perfError">{compareQ.data.error}</p> : null}

      <div className="perfProductsMetricBar" role="group" aria-label="Y-axis metric">
        <span>Y-axis</span>
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
        <small>Axis scales to the plotted lines ({yMetric === 'cups' ? 'cups' : 'KD'}).</small>
      </div>

      <section className="perfProductsBlock" aria-labelledby="perf-products-graph-a">
        <div className="perfProductsBlockHead">
          <h4 id="perf-products-graph-a" className="perfSectionTitle">
            A. {focusSku ? `${focusSku} across sites` : 'One product across sites'}
          </h4>
          <p className="perfSectionHint">
            Pick the drink below. Lines = machines on this page.{' '}
            {xAxisKind === 'hourly' ? 'Hours on X' : 'Dates on X'}.{' '}
            {compareOn ? 'Dashed = prior. ' : ''}
            Dotted = product target (machine targets stay on Graph B).
          </p>
        </div>
        <label className="perfProductsFocusLoc">
          <span>Product for Graph A</span>
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
        {compareQ.isLoading && ids.length > 0 ? <p className="perfMuted">Loading selected mix…</p> : null}
        {!focusSku ? (
          <p className="perfMuted">Select a product to draw Graph A.</p>
        ) : (
          <>
            <div className="perfGraphPageMeta" aria-live="polite">
              {canPage
                ? `Page ${graphPage + 1} / ${pageCount} · sites ${graphPage * PERF_PRODUCTS_GRAPH_PAGE + 1}–${graphPage * PERF_PRODUCTS_GRAPH_PAGE + pageMachines.length} of ${payloadMachines.length}`
                : `${pageMachines.length} site${pageMachines.length === 1 ? '' : 's'} on graph`}
            </div>
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
        <section className="perfProductsBlock" aria-labelledby="perf-products-graph-b">
          <div className="perfProductsBlockHead">
            <h4 id="perf-products-graph-b" className="perfSectionTitle">
              B. Products at one location
            </h4>
            <p className="perfSectionHint">
              Choose focus location and products (or Top / Least helpers above). Not a fleet sum.
            </p>
          </div>
          <div className="perfProductsGraphBControls">
            <label className="perfProductsFocusLoc">
              <span>Focus location</span>
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
            <div className="perfMachineFilterActions" aria-label="Product helpers for Graph B">
              <button type="button" className="perfSegPill" onClick={selectTopSkus}>
                Top {PERF_PRODUCTS_MAX_SKUS}
              </button>
              <button type="button" className="perfSegPill" onClick={selectLeastSkus}>
                Least {PERF_PRODUCTS_MAX_SKUS}
              </button>
              <button type="button" className="perfSegPill" onClick={() => setSkus([])}>
                Clear products
              </button>
            </div>
          </div>
          {!graphBReady ? (
            <p className="perfMuted">
              {!focusLocId ? 'Select a focus location. ' : ''}
              {!graphBSkus.length ? 'Select products (or use Top / Least).' : ''}
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
              <div>
                <h5 className="perfProductsTrendHead">Rising (KD + cups)</h5>
                {rising.length ? (
                  <ul className="perfProductsTrendList perfProductsTrendDetailed">
                    {rising.map((p) => (
                      <li key={p.name}>
                        <button type="button" onClick={() => toggleSku(p.name)}>
                          {p.name}
                        </button>
                        <div className="perfProductsTrendMeta">
                          <span className={trendClass(p.trendPct)}>{trendText(p.trendPct)} KD</span>
                          <span>
                            {formatKwd(Number(p.prevRevenueKwd || 0))} →{' '}
                            {formatKwd(Number(p.revenueKwd || 0))}
                          </span>
                          <span className={trendClass(p.cupsTrendPct)}>
                            {Math.round(Number(p.prevCups || 0))} → {Math.round(Number(p.cups || 0))}{' '}
                            cups ({trendText(p.cupsTrendPct)})
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="perfMuted">None up vs prior for this selection.</p>
                )}
              </div>
              <div>
                <h5 className="perfProductsTrendHead">Falling (KD + cups)</h5>
                {falling.length ? (
                  <ul className="perfProductsTrendList perfProductsTrendDetailed">
                    {falling.map((p) => (
                      <li key={p.name}>
                        <button type="button" onClick={() => toggleSku(p.name)}>
                          {p.name}
                        </button>
                        <div className="perfProductsTrendMeta">
                          <span className={trendClass(p.trendPct)}>{trendText(p.trendPct)} KD</span>
                          <span>
                            {formatKwd(Number(p.prevRevenueKwd || 0))} →{' '}
                            {formatKwd(Number(p.revenueKwd || 0))}
                          </span>
                          <span className={trendClass(p.cupsTrendPct)}>
                            {Math.round(Number(p.prevCups || 0))} → {Math.round(Number(p.cups || 0))}{' '}
                            cups ({trendText(p.cupsTrendPct)})
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="perfMuted">None down vs prior for this selection.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="perfMuted">Rising / falling need a comparison period.</p>
          )}
        </section>
      ) : null}

      {!locNone ? (
        <section className="perfProductsBlock" aria-labelledby="perf-products-graph-c">
          <div className="perfProductsBlockHead">
            <h4 id="perf-products-graph-c" className="perfSectionTitle">
              C. Heatmap — products × locations
            </h4>
            <p className="perfSectionHint">
              Select products above. Sorted by machine sales for the selected set. Cell = period{' '}
              {yMetric === 'cups' ? 'cups' : 'revenue KD'}. Hover a cell for detail + trend.
            </p>
          </div>
          {heatColumns.length === 0 ? (
            <p className="perfMuted">Select products (or Top / Least) to draw the heatmap.</p>
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

      <section className="perfProductsBlock" aria-labelledby="perf-products-table">
        <h4 id="perf-products-table" className="perfSectionTitle">
          Detail table
        </h4>
        <p className="perfSectionHint">Numbers behind the charts. Click a drink row to toggle filter.</p>
        {detailTable}
      </section>
    </section>
  );
}
