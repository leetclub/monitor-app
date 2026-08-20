import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { apiGet } from '@/lib/api';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { SERIES_PALETTE, type MachineRow } from '@/features/performance/perfTypes';
import { downloadWeeklyProductReport } from '@/features/performance/exportWeeklyProductReport';

export const PERF_PRODUCTS_MAX_LOCATIONS = 8;
export const PERF_PRODUCTS_MAX_SKUS = 8;

type ProductPeriod =
  | 'today'
  | 'yesterday'
  | 'wtd'
  | 'this_week'
  | 'wtd_vs_ly'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom_vs_custom'
  | 'custom_single';

type TargetType = 'product' | 'machine' | 'both';
type TargetUnit = 'cups' | 'revenue';

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

const PERIOD_OPTIONS: { id: ProductPeriod; label: string; hint: string }[] = [
  { id: 'today', label: 'Today vs yesterday', hint: 'Single day vs prior day' },
  { id: 'yesterday', label: 'Yesterday vs day before', hint: 'Closed day vs day before' },
  { id: 'wtd', label: 'Week to date (WTD)', hint: 'This week only — no comparison' },
  { id: 'this_week', label: 'WTD vs WTD', hint: 'This week vs last week, same days' },
  { id: 'wtd_vs_ly', label: 'WTD vs LY', hint: 'This week vs same week last year' },
  { id: 'last_week', label: 'Last week vs week before', hint: 'Closed week vs prior week' },
  { id: 'this_month', label: 'This month vs last', hint: 'MTD vs prior month same days' },
  { id: 'last_month', label: 'Last month vs month before', hint: 'Closed month vs prior' },
  { id: 'custom_vs_custom', label: 'Custom date vs custom date', hint: 'Pick two ranges to compare' },
  { id: 'custom_single', label: 'Custom date (no comparison)', hint: 'One range only' },
];

const COMPARE_BATCH = 80;
const TOP_LOW = 5;

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

function SkuMultiDropdown({
  options,
  selected,
  onToggle,
  onClear,
  onSelectTop,
}: {
  options: { name: string; kd: number }[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  onSelectTop: () => void;
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
    : `No drink filter · graph top ${PERF_PRODUCTS_MAX_SKUS}`;

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
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <section className="perfMachineFilter perfMachineFilterBar" aria-label="Filter drinks">
      <div className="perfLocBarMain" ref={rootRef}>
        <div className="perfLocBarLabel">
          <h3 className="perfMachineFilterTitle">Products</h3>
          <span className="perfMachineFilterCount">
            {selected.length}/{PERF_PRODUCTS_MAX_SKUS} max
          </span>
        </div>
        <div className="perfLocSelect">
          <button
            type="button"
            className={`perfLocSelectTrigger ${open ? 'open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <span className="perfLocSelectSummary">{summary}</span>
            <span className="perfLocSelectChevron" aria-hidden>
              ▾
            </span>
          </button>
          {open ? (
            <div className="perfLocDropdown" role="listbox">
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
                    No filter
                  </button>
                  <button
                    type="button"
                    className={`perfSegPill ${selected.length === PERF_PRODUCTS_MAX_SKUS ? 'active' : ''}`}
                    onClick={() => {
                      onSelectTop();
                      setAtCapHint(false);
                    }}
                  >
                    Select {PERF_PRODUCTS_MAX_SKUS}
                  </button>
                </div>
              </div>
              <div className="perfLocDropdownList">
                {filtered.length === 0 ? (
                  <p className="perfMuted">No matches.</p>
                ) : (
                  filtered.map((o) => {
                    const checked = selectedSet.has(o.name);
                    return (
                      <label key={o.name} className={`perfLocRow ${checked ? 'perfLocRowSolo' : ''}`}>
                        <span className="perfLocRowMain">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && atCap}
                            onChange={() => {
                              if (!checked && atCap) {
                                setAtCapHint(true);
                                return;
                              }
                              setAtCapHint(false);
                              onToggle(o.name);
                            }}
                          />
                          <span className="perfLocRowName" title={o.name}>
                            {o.name}
                          </span>
                        </span>
                        <span className="perfSkuKd">{formatKwd(o.kd)}</span>
                      </label>
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
          : `No filter = table lists every drink; graph plots the top ${PERF_PRODUCTS_MAX_SKUS} by KD.`}
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
              lines.push(
                `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span><b>${p.seriesName}</b>: ${fmt(Number(p.value))}</div>`,
              );
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

function daySkuKwd(day: ProductDay | undefined, sku: string): number {
  if (!day) return 0;
  const hit = (day.products || []).find((p) => p.name === sku);
  return Number(hit?.revenueKwd || 0);
}

function daySkuPrevKwd(day: ProductDay | undefined, sku: string): number {
  if (!day) return 0;
  const hit = (day.products || []).find((p) => p.name === sku);
  if (hit?.prevRevenueKwd != null) return Number(hit.prevRevenueKwd || 0);
  return 0;
}

function daySkuCups(day: ProductDay | undefined, sku: string): number {
  if (!day) return 0;
  const hit = (day.products || []).find((p) => p.name === sku);
  return Number(hit?.cups || 0);
}

function daySkuPrevCups(day: ProductDay | undefined, sku: string): number {
  if (!day) return 0;
  const hit = (day.products || []).find((p) => p.name === sku);
  if (hit?.prevCups != null) return Number(hit.prevCups || 0);
  return 0;
}

function daySkuValue(day: ProductDay | undefined, sku: string, unit: TargetUnit): number {
  return unit === 'cups' ? daySkuCups(day, sku) : daySkuKwd(day, sku);
}

function daySkuPrevValue(day: ProductDay | undefined, sku: string, unit: TargetUnit): number {
  return unit === 'cups' ? daySkuPrevCups(day, sku) : daySkuPrevKwd(day, sku);
}

function dayTotalValue(day: ProductDay | undefined, unit: TargetUnit): number {
  if (!day) return 0;
  return unit === 'cups' ? Number(day.cups || 0) : Number(day.revenueKwd || 0);
}

function dayPrevTotalValue(day: ProductDay | undefined, unit: TargetUnit): number {
  if (!day) return 0;
  return unit === 'cups' ? Number(day.prevCups || 0) : Number(day.prevRevenueKwd || 0);
}

/** Spread period target evenly across X points (daily/hourly pace line). */
function paceLine(periodTarget: number, n: number): number[] {
  if (n <= 0 || !(periodTarget > 0)) return Array.from({ length: Math.max(0, n) }, () => 0);
  const pace = periodTarget / n;
  return Array.from({ length: n }, () => pace);
}

type TrajSeries = { name: string; data: number[]; dashed?: boolean; dotted?: boolean };

type Props = {
  machines: MachineRow[];
  selectedIds: string[];
  allSelected: boolean;
  fleetIds: string[];
};

export function PerfProductsSection({ machines, selectedIds, allSelected, fleetIds }: Props) {
  const [period, setPeriod] = useState<ProductPeriod>('this_week');
  const [aStart, setAStart] = useState(() => addDaysIso(kuwaitIsoToday(), -6));
  const [aEnd, setAEnd] = useState(() => kuwaitIsoToday());
  const [bStart, setBStart] = useState(() => addDaysIso(kuwaitIsoToday(), -13));
  const [bEnd, setBEnd] = useState(() => addDaysIso(kuwaitIsoToday(), -7));
  const [customStart, setCustomStart] = useState(() => addDaysIso(kuwaitIsoToday(), -7));
  const [customEnd, setCustomEnd] = useState(() => addDaysIso(kuwaitIsoToday(), -1));
  const [skus, setSkus] = useState<string[]>([]);
  const [targetType, setTargetType] = useState<TargetType>('both');
  const [targetUnit, setTargetUnit] = useState<TargetUnit>('cups');

  const locNone = !allSelected && selectedIds.length === 0;
  const ids = useMemo(() => {
    if (locNone) return [];
    if (allSelected) return machines.slice(0, PERF_PRODUCTS_MAX_LOCATIONS).map((m) => m.id);
    return selectedIds.slice(0, PERF_PRODUCTS_MAX_LOCATIONS);
  }, [allSelected, locNone, machines, selectedIds]);

  const idsKey = ids.slice().sort().join(',');

  const compareOpts = useMemo((): CompareOpts | null => {
    if (period === 'custom_vs_custom') {
      if (!(aStart && aEnd && bStart && bEnd && aStart <= aEnd && bStart <= bEnd)) return null;
      return { preset: 'custom_vs_custom', aStart, aEnd, bStart, bEnd };
    }
    if (period === 'custom_single') {
      if (!(customStart && customEnd && customStart <= customEnd)) return null;
      return { preset: 'custom_single', start: customStart, end: customEnd, compare: false };
    }
    if (period === 'wtd') return { preset: 'wtd', compare: false };
    return { preset: period };
  }, [period, aStart, aEnd, bStart, bEnd, customStart, customEnd]);

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
    queryFn: () => apiGet<ProductComparePayload>(productComparePath(ids, compareOpts!)),
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
  const compareOn = (fleetQ.data?.compare ?? compareQ.data?.compare) !== false && period !== 'wtd' && period !== 'custom_single';
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
  }, [skuCatalog, skus]);

  const toggleSku = useCallback((name: string) => {
    setSkus((prev) => {
      if (prev.includes(name)) return prev.filter((x) => x !== name);
      if (prev.length >= PERF_PRODUCTS_MAX_SKUS) return prev;
      return [...prev, name];
    });
  }, []);

  const multiLoc = ids.length > 1;
  const compareSkus = useMemo(() => {
    if (skus.length) return skus;
    if (!multiLoc) return [];
    return skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name);
  }, [skus, multiLoc, skuCatalog]);

  const skuSet = useMemo(() => new Set(skus), [skus]);

  const inLocationRows = useMemo(() => {
    if (!skus.length) return mixedRows;
    return mixedRows.filter((p) => skuSet.has(p.name));
  }, [mixedRows, skus, skuSet]);

  const acrossByLocation = useMemo(() => {
    if (!compareSkus.length) return [];
    return payloadMachines.map((m) => {
      const byName = new Map((m.products || []).map((p) => [String(p.name || '').trim(), p] as const));
      const cells = compareSkus.map((name) => {
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
  }, [payloadMachines, compareSkus]);

  const fleetDays = useMemo(
    () =>
      (fleetQ.data?.days?.length
        ? fleetQ.data.days
        : rollupDaysFromMachines(fleetMachinesNamed)) as ProductDay[],
    [fleetQ.data?.days, fleetMachinesNamed],
  );

  const selectedDays = useMemo(
    () =>
      (compareQ.data?.days?.length
        ? compareQ.data.days
        : rollupDaysFromMachines(payloadMachines)) as ProductDay[],
    [compareQ.data?.days, payloadMachines],
  );

  const showProductTargets = targetType === 'product' || targetType === 'both';
  const showMachineTargets = targetType === 'machine' || targetType === 'both';
  const chartUnit: 'kd' | 'cups' = targetUnit === 'cups' ? 'cups' : 'kd';

  const machineLocTarget = useCallback(
    (m: ProductMachine): number => {
      return targetUnit === 'cups'
        ? Number(m.locationTargetCups || 0)
        : Number(m.locationTargetKd || 0);
    },
    [targetUnit],
  );

  const selectedTrajectorySeries = useMemo(() => {
    const series: TrajSeries[] = [];
    const n = selectedDays.length;
    if (skus.length === 1) {
      const sku = skus[0];
      for (const m of payloadMachines) {
        const days = m.days?.length ? m.days : selectedDays;
        series.push({
          name: m.machineName,
          data: days.map((d) => daySkuValue(d, sku, targetUnit)),
        });
      }
      if (showProductTargets) {
        for (const m of payloadMachines) {
          const cell = skuOnMachine(m, [sku]);
          const tgt =
            targetUnit === 'cups'
              ? cell.hasTarget
                ? cell.target
                : 0
              : cell.hasTargetRev
                ? cell.targetRev
                : 0;
          if (tgt > 0) {
            const pts = (m.days?.length ? m.days : selectedDays).length;
            series.push({
              name: `Target · ${m.machineName}`,
              data: paceLine(tgt, pts || n),
              dotted: true,
            });
          }
        }
      }
      return series;
    }
    const want = skus.length ? skus : compareSkus.slice(0, PERF_PRODUCTS_MAX_SKUS);
    if (want.length) {
      for (const name of want) {
        series.push({
          name,
          data: selectedDays.map((d) => daySkuValue(d, name, targetUnit)),
        });
      }
      if (showProductTargets) {
        for (const name of want) {
          let tgt = 0;
          for (const m of payloadMachines) {
            const cell = skuOnMachine(m, [name]);
            tgt +=
              targetUnit === 'cups'
                ? cell.hasTarget
                  ? cell.target
                  : 0
                : cell.hasTargetRev
                  ? cell.targetRev
                  : 0;
          }
          if (tgt > 0) {
            series.push({
              name: `Target · ${name}`,
              data: paceLine(tgt, n),
              dotted: true,
            });
          }
        }
      }
      return series;
    }
    series.push({
      name: 'Selected sites',
      data: selectedDays.map((d) => dayTotalValue(d, targetUnit)),
    });
    if (compareOn) {
      series.push({
        name: 'Prior · selected',
        data: selectedDays.map((d) => dayPrevTotalValue(d, targetUnit)),
        dashed: true,
      });
    }
    if (showMachineTargets) {
      const locSum = payloadMachines.reduce((s, m) => s + machineLocTarget(m), 0);
      if (locSum > 0) {
        series.push({
          name: 'Target · locations',
          data: paceLine(locSum, n),
          dotted: true,
        });
      }
    }
    return series;
  }, [
    skus,
    payloadMachines,
    selectedDays,
    compareSkus,
    compareOn,
    targetUnit,
    showProductTargets,
    showMachineTargets,
    machineLocTarget,
  ]);

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

  const rankedForSku = useMemo(() => {
    if (!skus.length) return [];
    return fleetMachinesNamed
      .map((m) => {
        const cell = skuOnMachine(m, skus);
        return { machineId: m.machineId, machineName: m.machineName, ...cell };
      })
      .filter((r) => r.revenue > 0 || (r.prev != null && r.prev > 0));
  }, [fleetMachinesNamed, skus]);

  const topMachines = useMemo(
    () =>
      [...rankedForSku]
        .sort((a, b) => b.revenue - a.revenue || a.machineName.localeCompare(b.machineName))
        .slice(0, TOP_LOW),
    [rankedForSku],
  );
  const lowMachines = useMemo(
    () =>
      [...rankedForSku]
        .sort((a, b) => a.revenue - b.revenue || a.machineName.localeCompare(b.machineName))
        .slice(0, TOP_LOW),
    [rankedForSku],
  );

  const periodMeta = PERIOD_OPTIONS.find((p) => p.id === period);

  const onExportReport = useCallback(() => {
    downloadWeeklyProductReport({
      periodLabel,
      priorLabel,
      windowStart: win?.start,
      windowEnd: win?.end,
      fleetProducts: fleetMix,
      machines: fleetMachinesNamed,
      focusProduct: skus[0] || null,
      compare: compareOn,
    });
  }, [periodLabel, priorLabel, win, fleetMix, fleetMachinesNamed, skus, compareOn]);

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
                <td colSpan={8}>Select locations above (max {PERF_PRODUCTS_MAX_LOCATIONS}).</td>
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
              {compareSkus.length > 1 ? <th>Drink</th> : null}
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
                <td colSpan={8}>Select locations above (max {PERF_PRODUCTS_MAX_LOCATIONS}).</td>
              </tr>
            ) : !compareSkus.length ? (
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
                      {compareSkus.length > 1 ? <td>{c.name}</td> : null}
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
                <strong>1. Period</strong> — choose a preset or custom dates below.
              </li>
              <li className={!locNone ? 'active' : undefined}>
                <strong>2. Locations</strong> — pick up to {PERF_PRODUCTS_MAX_LOCATIONS} in the bar
                above (scroll if needed).
              </li>
              <li className={skus.length > 0 ? 'active' : undefined}>
                <strong>3. Products + target type</strong> — filter drinks, then read the line charts.
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
          <span>Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ProductPeriod)}
            aria-label="Compare period"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {periodMeta ? <small>{periodMeta.hint}</small> : null}
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
          <small>Product and/or location targets draw as dotted lines on the graphs.</small>
        </label>

        <label className="perfProductsCriteriaField">
          <span>Target unit</span>
          <select
            value={targetUnit}
            onChange={(e) => setTargetUnit(e.target.value as TargetUnit)}
            aria-label="Target unit cups or revenue"
          >
            <option value="cups">Cups</option>
            <option value="revenue">Revenue (KD)</option>
          </select>
          <small>Y-axis and target lines use this unit.</small>
        </label>
      </div>

      {period === 'custom_vs_custom' ? (
        <div className="perfProductsCustomRange">
          <label>
            Period A from
            <input type="date" value={aStart} max={aEnd || kuwaitIsoToday()} onChange={(e) => setAStart(e.target.value)} />
          </label>
          <label>
            Period A to
            <input type="date" value={aEnd} min={aStart} max={kuwaitIsoToday()} onChange={(e) => setAEnd(e.target.value)} />
          </label>
          <label>
            Period B from
            <input type="date" value={bStart} max={bEnd || kuwaitIsoToday()} onChange={(e) => setBStart(e.target.value)} />
          </label>
          <label>
            Period B to
            <input type="date" value={bEnd} min={bStart} max={kuwaitIsoToday()} onChange={(e) => setBEnd(e.target.value)} />
          </label>
        </div>
      ) : null}
      {period === 'custom_single' ? (
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
          <p className="perfSectionHint">Single range — no prior comparison lines or rising/falling.</p>
        </div>
      ) : null}

      {!compareOpts ? <p className="perfError">Fix the custom dates (from ≤ to) to load charts.</p> : null}

      <SkuMultiDropdown
        options={skuCatalog}
        selected={skus}
        onToggle={toggleSku}
        onClear={() => setSkus([])}
        onSelectTop={() => setSkus(skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name))}
      />

      {locNone ? <p className="perfMuted">Pick at least one location above (max {PERF_PRODUCTS_MAX_LOCATIONS}).</p> : null}
      {compareQ.isError ? <p className="perfError">{(compareQ.error as Error).message}</p> : null}
      {compareQ.data?.error ? <p className="perfError">{compareQ.data.error}</p> : null}

      <section className="perfProductsBlock" aria-labelledby="perf-products-selected">
        <h4 id="perf-products-selected" className="perfSectionTitle">
          1. Selected locations
        </h4>
        <p className="perfSectionHint">
          Follows your Locations pick (max {PERF_PRODUCTS_MAX_LOCATIONS}).{' '}
          {xAxisKind === 'hourly' ? 'Hours on X' : 'Dates on X'}.{' '}
          {compareOn ? 'Dashed = prior. ' : ''}
          Dotted = target pace ({targetUnit === 'cups' ? 'cups' : 'KD'}).
        </p>
        {compareQ.isLoading && ids.length > 0 ? <p className="perfMuted">Loading selected mix…</p> : null}
        <DateTrajectoryChart
          days={selectedDays}
          series={selectedTrajectorySeries}
          unit={chartUnit}
          onSeriesClick={toggleSku}
          exportName="product-selected-trajectory"
          ariaLabel="Selected locations product trajectory"
        />
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

      <section className="perfProductsBlock" aria-labelledby="perf-products-per-machine">
        <h4 id="perf-products-per-machine" className="perfSectionTitle">
          2. Per location
        </h4>
        <p className="perfSectionHint">
          Same window, {xAxisKind === 'hourly' ? 'hourly' : 'daily'} trajectory per selected
          site. Dotted = product target pace when configured.
        </p>
        {locNone ? (
          <p className="perfMuted">Select locations above.</p>
        ) : (
          <div className="perfProductsMachineGrid">
            {payloadMachines.map((m) => {
              const days = m.days || [];
              const want = skus.length
                ? skus
                : (m.products || []).slice(0, PERF_PRODUCTS_MAX_SKUS).map((p) => p.name);
              const series: TrajSeries[] = want.map((name) => ({
                name,
                data: days.map((d) => daySkuValue(d, name, targetUnit)),
              }));
              if (showProductTargets) {
                for (const name of want) {
                  const cell = skuOnMachine(m, [name]);
                  const tgt =
                    targetUnit === 'cups'
                      ? cell.hasTarget
                        ? cell.target
                        : 0
                      : cell.hasTargetRev
                        ? cell.targetRev
                        : 0;
                  if (tgt > 0) {
                    series.push({
                      name: `Target · ${name}`,
                      data: paceLine(tgt, days.length),
                      dotted: true,
                    });
                  }
                }
              }
              if (!series.length) {
                series.push({
                  name: 'All products',
                  data: days.map((d) => dayTotalValue(d, targetUnit)),
                });
                if (showMachineTargets) {
                  const loc = machineLocTarget(m);
                  if (loc > 0) {
                    series.push({
                      name: 'Target · location',
                      data: paceLine(loc, days.length),
                      dotted: true,
                    });
                  }
                }
              }
              return (
                <article key={m.machineId} className="perfProductsMachineCard">
                  <h5 className="perfProductsMachineName">{m.machineName}</h5>
                  <DateTrajectoryChart
                    days={days}
                    series={series}
                    unit={chartUnit}
                    compact
                    exportName={`product-mix-${m.machineId}`}
                    ariaLabel={`Daily product mix at ${m.machineName}`}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="perfProductsBlock" aria-labelledby="perf-products-toplow">
        <h4 id="perf-products-toplow" className="perfSectionTitle">
          3. Top and lowest sites
        </h4>
        <p className="perfSectionHint">
          Whole fleet ranking for the drink you pick (Locations filter does not apply here).
        </p>
        {!skus.length ? (
          <p className="perfMuted">Select a drink above to see top and lowest locations.</p>
        ) : (
          <div className="perfProductsTopLow">
            <div>
              <h5 className="perfProductsTrendHead">Top {TOP_LOW}</h5>
              <DateTrajectoryChart
                days={selectedDays.length ? selectedDays : fleetDays}
                series={topMachines.map((m) => {
                  const row = fleetMachinesNamed.find((x) => x.machineId === m.machineId);
                  const days = row?.days || fleetDays;
                  return {
                    name: m.machineName,
                    data: days.map((d) => daySkuValue(d, skus[0], targetUnit)),
                  };
                })}
                unit={chartUnit}
                compact
                exportName="product-top-sites"
                ariaLabel="Top performing locations daily"
              />
            </div>
            <div>
              <h5 className="perfProductsTrendHead">Lowest {TOP_LOW}</h5>
              <DateTrajectoryChart
                days={selectedDays.length ? selectedDays : fleetDays}
                series={lowMachines.map((m) => {
                  const row = fleetMachinesNamed.find((x) => x.machineId === m.machineId);
                  const days = row?.days || fleetDays;
                  return {
                    name: m.machineName,
                    data: days.map((d) => daySkuValue(d, skus[0], targetUnit)),
                  };
                })}
                unit={chartUnit}
                compact
                exportName="product-low-sites"
                ariaLabel="Lowest performing locations daily"
              />
            </div>
          </div>
        )}
      </section>

      <section className="perfProductsBlock" aria-labelledby="perf-products-table">
        <h4 id="perf-products-table" className="perfSectionTitle">
          4. Selected locations — detail table
        </h4>
        <p className="perfSectionHint">
          Numbers behind chart 1. Targets are dotted lines on graphs 1–2.
        </p>
        {detailTable}
      </section>
    </section>
  );
}
