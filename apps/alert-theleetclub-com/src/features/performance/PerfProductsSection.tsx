import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { apiGet } from '@/lib/api';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { SERIES_PALETTE, type MachineRow, type PerfPreset } from '@/features/performance/perfTypes';

export const PERF_PRODUCTS_MAX_LOCATIONS = 8;
export const PERF_PRODUCTS_MAX_SKUS = 8;

type ProductRow = {
  name: string;
  revenueKwd: number;
  prevRevenueKwd?: number | null;
  yoyRevenueKwd?: number | null;
  cups?: number | null;
  trendPct?: number | null;
  yoyTrendPct?: number | null;
  targetCups?: number | null;
  pctOfTarget?: number | null;
};

type ProductMachine = {
  machineId: string;
  machineName: string;
  products: ProductRow[];
};

type ProductComparePayload = {
  ok?: boolean;
  error?: string;
  preset?: string;
  window?: {
    start?: string;
    end?: string;
    prevStart?: string;
    prevEnd?: string;
    label?: string;
    prevLabel?: string;
  };
  machines?: ProductMachine[];
};

const PRODUCT_PRESETS: { id: PerfPreset; label: string }[] = [
  { id: 'today', label: 'Today vs yesterday' },
  { id: 'yesterday', label: 'Yesterday vs day before' },
  { id: 'this_week', label: 'This week vs last' },
  { id: 'last_week', label: 'Last week vs week before' },
  { id: 'last_2_weeks', label: 'Last 2 weeks vs prior' },
  { id: 'this_month', label: 'This month vs last' },
  { id: 'last_month', label: 'Last month vs month before' },
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

function productComparePath(
  ids: string[],
  opts: { preset: string; start?: string; end?: string },
): string {
  const qs = new URLSearchParams();
  qs.set('machineIds', ids.join(','));
  if (opts.start && opts.end) {
    qs.set('start', opts.start);
    qs.set('end', opts.end);
  } else {
    qs.set('preset', opts.preset);
  }
  return `/api/alert/performance/product-compare?${qs.toString()}`;
}

async function fetchProductCompareBatched(
  ids: string[],
  opts: { preset: string; start?: string; end?: string },
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
  return {
    ...first,
    machines: parts.flatMap((p) => p.machines || []),
    error: parts.map((p) => p.error).find(Boolean),
  };
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
    { revenue: number; prev: number; yoy: number; cups: number; target: number; hasTarget: boolean }
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
        target: 0,
        hasTarget: false,
      };
      cur.revenue += Number(p.revenueKwd || 0);
      cur.prev += Number(p.prevRevenueKwd || 0);
      cur.yoy += Number(p.yoyRevenueKwd || 0);
      cur.cups += Number(p.cups || 0);
      if (p.targetCups != null && Number.isFinite(Number(p.targetCups))) {
        cur.target += Number(p.targetCups);
        cur.hasTarget = true;
      }
      totals.set(name, cur);
    }
  }
  return [...totals.entries()]
    .map(([name, v]) => ({
      name,
      revenueKwd: v.revenue,
      prevRevenueKwd: v.prev,
      yoyRevenueKwd: v.yoy,
      cups: v.cups,
      trendPct: trendFrom(v.revenue, v.prev),
      yoyTrendPct: trendFrom(v.revenue, v.yoy),
      targetCups: v.hasTarget ? v.target : null,
      pctOfTarget: v.hasTarget && v.target > 0 ? (v.cups / v.target) * 100 : null,
    }))
    .sort((a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0) || a.name.localeCompare(b.name));
}

function skuOnMachine(m: ProductMachine, names: string[]) {
  const want = new Set(names.map((n) => n.toLowerCase()));
  let revenue = 0;
  let prev = 0;
  let cups = 0;
  let target = 0;
  let hasTarget = false;
  for (const p of m.products || []) {
    if (!want.has(String(p.name || '').toLowerCase())) continue;
    revenue += Number(p.revenueKwd || 0);
    prev += Number(p.prevRevenueKwd || 0);
    cups += Number(p.cups || 0);
    if (p.targetCups != null && Number.isFinite(Number(p.targetCups))) {
      target += Number(p.targetCups);
      hasTarget = true;
    }
  }
  return {
    revenue,
    prev,
    cups,
    target,
    hasTarget,
    trendPct: trendFrom(revenue, prev),
    pctOfTarget: hasTarget && target > 0 ? (cups / target) * 100 : null,
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
          : `No filter = table lists every drink; graph plots the top ${PERF_PRODUCTS_MAX_SKUS} by KD. Select ${PERF_PRODUCTS_MAX_SKUS} checks those drinks.`}
      </p>
    </section>
  );
}

const TOP_LOW = 5;

function PeriodPriorBars({
  categories,
  period,
  prior,
  periodLabel,
  priorLabel,
  onCategoryClick,
  compact,
  tintByTrend,
  unit = 'kd',
  exportName,
  ariaLabel,
}: {
  categories: string[];
  period: number[];
  prior: number[];
  periodLabel: string;
  priorLabel: string;
  onCategoryClick?: (name: string) => void;
  compact?: boolean;
  tintByTrend?: boolean;
  unit?: 'kd' | 'cups';
  exportName?: string;
  ariaLabel?: string;
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
    if (!categories.length) {
      chart.clear();
      return;
    }
    const periodData = categories.map((_, i) => {
      const v = period[i] || 0;
      if (!tintByTrend) return v;
      const prev = prior[i] || 0;
      const up = v >= prev;
      return {
        value: v,
        itemStyle: { color: up ? '#2dd4bf' : '#f87171' },
      };
    });
    chart.setOption(
      {
        color: [SERIES_PALETTE[0], SERIES_PALETTE[1]],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          valueFormatter: (v: number | string) => fmt(Number(v || 0)),
        },
        legend: { data: [periodLabel, priorLabel], textStyle: { color: theme.muted } },
        grid: { left: 56, right: 16, top: 36, bottom: compact ? 56 : 72 },
        xAxis: {
          type: 'category',
          data: categories,
          axisLabel: {
            color: theme.axis,
            rotate: categories.some((c) => c.length > 10) ? 28 : 0,
            width: compact ? 72 : 90,
            overflow: 'truncate',
          },
        },
        yAxis: {
          type: 'value',
          name: unit === 'cups' ? 'Cups' : 'KD',
          axisLabel: { color: theme.axis, formatter: (v: number) => fmt(v) },
          splitLine: { lineStyle: { color: theme.grid } },
        },
        series: [
          { name: periodLabel, type: 'bar', data: periodData, barMaxWidth: compact ? 16 : 22 },
          { name: priorLabel, type: 'bar', data: prior, barMaxWidth: compact ? 16 : 22 },
        ],
      },
      true,
    );
    if (onCategoryClick) {
      chart.on('click', (params: { name?: string }) => {
        const name = String(params.name || '').trim();
        if (name) onCategoryClick(name);
      });
    }
  }, [categories, period, prior, periodLabel, priorLabel, onCategoryClick, compact, tintByTrend, unit]);

  const onExport = useCallback(() => {
    if (!inst.current || !exportName) return;
    downloadChartPng(inst.current, chartFilename([exportName]));
  }, [exportName]);

  const chart = (
    <div
      ref={ref}
      className={`perfEchart ${compact ? 'perfEchartCompact' : 'perfEchartOverview'}`}
      role="img"
      aria-label={ariaLabel || 'Product period vs prior'}
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
  /** All plottable locations (not the 8-cap) for fleet mix + top/low. */
  fleetIds: string[];
};

export function PerfProductsSection({ machines, selectedIds, allSelected, fleetIds }: Props) {
  const [preset, setPreset] = useState<PerfPreset>('today');
  const [customOn, setCustomOn] = useState(false);
  const [customStart, setCustomStart] = useState(() => addDaysIso(kuwaitIsoToday(), -7));
  const [customEnd, setCustomEnd] = useState(() => addDaysIso(kuwaitIsoToday(), -1));
  const [skus, setSkus] = useState<string[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const locNone = !allSelected && selectedIds.length === 0;
  const ids = useMemo(() => {
    if (locNone) return [];
    if (allSelected) return machines.slice(0, PERF_PRODUCTS_MAX_LOCATIONS).map((m) => m.id);
    return selectedIds.slice(0, PERF_PRODUCTS_MAX_LOCATIONS);
  }, [allSelected, locNone, machines, selectedIds]);

  const idsKey = ids.slice().sort().join(',');
  const customValid = customOn && Boolean(customStart && customEnd && customStart <= customEnd);
  const compareOpts = useMemo(
    () =>
      customValid
        ? { preset: 'custom', start: customStart, end: customEnd }
        : { preset },
    [customValid, customStart, customEnd, preset],
  );
  const compareOptsKey = customValid
    ? `custom:${customStart}:${customEnd}`
    : `preset:${preset}`;

  const compareQ = useQuery({
    queryKey: ['alert-performance-product-compare', compareOptsKey, idsKey],
    queryFn: () => apiGet<ProductComparePayload>(productComparePath(ids, compareOpts)),
    enabled: ids.length > 0,
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  const fleetQ = useQuery({
    queryKey: ['alert-performance-product-compare-fleet', compareOptsKey, fleetIds.slice().sort().join(',')],
    queryFn: () => fetchProductCompareBatched(fleetIds, compareOpts),
    enabled: fleetIds.length > 0,
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
  const periodLabel = win?.label || 'Period';
  const priorLabel = win?.prevLabel || 'Prior';
  const windowHint =
    win?.start && win?.end
      ? `${periodLabel}: ${win.start} → ${win.end} · ${priorLabel}: ${win.prevStart} → ${win.prevEnd}`
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

  const compareMode = ids.length > 1;
  const compareSkus = useMemo(() => {
    if (skus.length) return skus;
    if (!compareMode) return [];
    return skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name);
  }, [skus, compareMode, skuCatalog]);

  const skuSet = useMemo(() => new Set(skus), [skus]);

  const inLocationRows = useMemo(() => {
    if (!skus.length) return mixedRows;
    return mixedRows.filter((p) => skuSet.has(p.name));
  }, [mixedRows, skus, skuSet]);

  const acrossByLocation = useMemo(() => {
    if (!compareSkus.length) return [];
    return payloadMachines.map((m) => {
      const byName = new Map(
        (m.products || []).map((p) => [String(p.name || '').trim(), p] as const),
      );
      const cells = compareSkus.map((name) => {
        const hit = byName.get(name);
        return {
          name,
          revenueKwd: Number(hit?.revenueKwd || 0),
          prevRevenueKwd: Number(hit?.prevRevenueKwd || 0),
          yoyRevenueKwd: Number(hit?.yoyRevenueKwd || 0),
          cups: hit?.cups ?? 0,
          trendPct: hit?.trendPct ?? null,
          yoyTrendPct: hit?.yoyTrendPct ?? null,
        };
      });
      const revenueKwd = cells.reduce((s, c) => s + c.revenueKwd, 0);
      return { machineId: m.machineId, machineName: m.machineName, cells, revenueKwd };
    });
  }, [payloadMachines, compareSkus]);

  const chartModel = useMemo(() => {
    if (!compareMode) {
      const top = inLocationRows.slice(0, PERF_PRODUCTS_MAX_SKUS);
      return {
        kind: 'period-prior' as const,
        categories: top.map((p) => p.name),
        series: [
          { name: periodLabel, data: top.map((p) => Number(p.revenueKwd || 0)) },
          { name: priorLabel, data: top.map((p) => Number(p.prevRevenueKwd || 0)) },
        ],
        clickTogglesSku: true,
      };
    }
    const want = compareSkus;
    if (!want.length) {
      return {
        kind: 'period-prior' as const,
        categories: [] as string[],
        series: [] as { name: string; data: number[] }[],
        clickTogglesSku: false,
      };
    }
    const rows = [...acrossByLocation].sort(
      (a, b) => b.revenueKwd - a.revenueKwd || a.machineName.localeCompare(b.machineName),
    );
    const top = rows.slice(0, PERF_PRODUCTS_MAX_LOCATIONS);
    if (want.length <= 1) {
      const skuName = want[0] || '';
      return {
        kind: 'period-prior' as const,
        categories: top.map((r) => r.machineName),
        series: [
          {
            name: periodLabel,
            data: top.map((r) => r.cells.find((c) => c.name === skuName)?.revenueKwd || 0),
          },
          {
            name: priorLabel,
            data: top.map((r) => r.cells.find((c) => c.name === skuName)?.prevRevenueKwd || 0),
          },
        ],
        clickTogglesSku: false,
      };
    }
    return {
      kind: 'grouped' as const,
      categories: top.map((r) => r.machineName),
      series: want.map((name) => ({
        name,
        data: top.map((r) => r.cells.find((c) => c.name === name)?.revenueKwd || 0),
      })),
      clickTogglesSku: true,
    };
  }, [compareMode, inLocationRows, acrossByLocation, compareSkus, periodLabel, priorLabel]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    chartInst.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInst.current;
    if (!chart) return;
    const theme = readTheme();
    const cats = chartModel.categories;
    chart.off('click');
    if (!cats.length) {
      chart.clear();
      return;
    }
    chart.setOption(
      {
        color: SERIES_PALETTE,
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          valueFormatter: (v: number | string) => formatKwd(Number(v || 0)),
        },
        legend: {
          data: chartModel.series.map((s) => s.name),
          textStyle: { color: theme.muted },
        },
        grid: { left: 56, right: 16, top: 36, bottom: 72 },
        xAxis: {
          type: 'category',
          data: cats,
          axisLabel: {
            color: theme.axis,
            rotate: cats.some((c) => c.length > 10) ? 28 : 0,
            width: 90,
            overflow: 'truncate',
          },
        },
        yAxis: {
          type: 'value',
          name: 'KD',
          axisLabel: { color: theme.axis, formatter: (v: number) => formatKwd(v) },
          splitLine: { lineStyle: { color: theme.grid } },
        },
        series: chartModel.series.map((s) => ({
          name: s.name,
          type: 'bar',
          data: s.data,
          barMaxWidth: chartModel.kind === 'grouped' ? 14 : 22,
        })),
      },
      true,
    );
    if (chartModel.clickTogglesSku) {
      chart.on('click', (params: { name?: string; seriesName?: string }) => {
        const fromSeries =
          chartModel.kind === 'grouped' ? String(params.seriesName || '').trim() : '';
        const name =
          fromSeries && fromSeries !== periodLabel && fromSeries !== priorLabel
            ? fromSeries
            : String(params.name || '').trim();
        if (name) toggleSku(name);
      });
    }
  }, [chartModel, periodLabel, priorLabel, toggleSku]);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([
        'product-performance',
        compareMode ? 'across' : 'mix',
        preset,
      ]),
    );
  }, [compareMode, ids.length, preset]);

  const fleetChartRows = useMemo(() => {
    const src = skus.length ? fleetMix.filter((p) => skuSet.has(p.name)) : fleetMix;
    return src.slice(0, PERF_PRODUCTS_MAX_SKUS);
  }, [fleetMix, skus, skuSet]);

  const rising = useMemo(
    () =>
      fleetMix
        .filter((p) => p.trendPct != null && Number(p.trendPct) > 0)
        .sort((a, b) => Number(b.trendPct) - Number(a.trendPct))
        .slice(0, 8),
    [fleetMix],
  );
  const falling = useMemo(
    () =>
      fleetMix
        .filter((p) => p.trendPct != null && Number(p.trendPct) < 0)
        .sort((a, b) => Number(a.trendPct) - Number(b.trendPct))
        .slice(0, 8),
    [fleetMix],
  );

  const rankedForSku = useMemo(() => {
    if (!skus.length) return [];
    return fleetMachinesNamed
      .map((m) => {
        const cell = skuOnMachine(m, skus);
        return {
          machineId: m.machineId,
          machineName: m.machineName,
          ...cell,
        };
      })
      .filter((r) => r.revenue > 0 || r.prev > 0);
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

  const perMachineMix = useMemo(
    () =>
      payloadMachines.map((m) => {
        const rows = aggregateProducts([m]);
        const shown = skus.length ? rows.filter((p) => skuSet.has(p.name)) : rows.slice(0, PERF_PRODUCTS_MAX_SKUS);
        return { machineId: m.machineId, machineName: m.machineName, rows: shown };
      }),
    [payloadMachines, skus, skuSet],
  );

  const fleetTargetRows = useMemo(
    () => fleetMix.filter((p) => p.targetCups != null && Number(p.targetCups) > 0).slice(0, PERF_PRODUCTS_MAX_SKUS),
    [fleetMix],
  );

  const machineTargetRows = useMemo(() => {
    if (!skus.length) return [];
    const out: { label: string; cups: number; target: number }[] = [];
    for (const m of fleetMachinesNamed) {
      const cell = skuOnMachine(m, skus);
      if (!cell.hasTarget) continue;
      out.push({
        label: m.machineName,
        cups: cell.cups,
        target: cell.target,
      });
    }
    return out
      .sort((a, b) => b.target - a.target || b.cups - a.cups)
      .slice(0, 16);
  }, [fleetMachinesNamed, skus]);

  const locNames = useMemo(() => {
    const byId = new Map(machines.map((m) => [m.id, m.name]));
    return ids.map((id) => byId.get(id) || id);
  }, [ids, machines]);

  const showingBlurb = useMemo(() => {
    if (!ids.length) return '';
    const locLabel =
      locNames.length <= 3 ? locNames.join(' + ') : `${locNames.slice(0, 3).join(' + ')} + ${locNames.length - 3} more`;
    if (compareQ.isLoading) return `Loading ${locLabel}…`;
    const graphN = Math.min(PERF_PRODUCTS_MAX_SKUS, skus.length || mixedRows.length);
    const mixN = mixedRows.length;
    if (!compareMode) {
      if (!skus.length) {
        return `Looking at: mix at ${locLabel}. Graph top ${graphN} of ${mixN} drinks · period vs prior.`;
      }
      return `Looking at: ${skus.join(', ')} at ${locLabel}.`;
    }
    const drinkBit = skus.length
      ? skus.join(', ')
      : `top ${compareSkus.length} drinks (no filter)`;
    if (compareSkus.length <= 1) {
      return `Looking at: ${drinkBit} across ${locLabel} — each bar is a location.`;
    }
    return `Looking at: ${drinkBit} across ${locLabel} — one cluster per site, one color per drink.`;
  }, [ids.length, locNames, skus, mixedRows.length, compareMode, compareSkus.length, compareQ.isLoading]);

  return (
    <section className="perfProducts" aria-labelledby="perf-products-title">
      <header className="perfProductsHead">
        <div>
          <h3 id="perf-products-title" className="perfSectionTitle">
            Product performance
          </h3>
          <aside className="perfProductsGuide" aria-label="How to use product performance">
            <ol className="perfProductsGuideList">
              <li>
                <strong>Fleet mix</strong> — all sites summed, no location names.
                <span className="perfProductsGuideWhy">Which drinks are up or down.</span>
              </li>
              <li className={!locNone ? 'active' : undefined}>
                <strong>Selected sites</strong> — mix or compare the {PERF_PRODUCTS_MAX_LOCATIONS}-cap
                pick.
              </li>
              <li className={skus.length > 0 ? 'active' : undefined}>
                <strong>Pick a drink</strong> — top / lowest sites across the whole fleet, plus cup
                targets.
              </li>
            </ol>
          </aside>
          {showingBlurb ? <p className="perfProductsNow">{showingBlurb}</p> : null}
          {windowHint ? <p className="perfSectionHint">{windowHint}</p> : null}
        </div>
      </header>

      <div className="perfModePills" role="group" aria-label="Product compare window">
        {PRODUCT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`perfSegPill ${!customOn && preset === p.id ? 'active' : ''}`}
            onClick={() => {
              setCustomOn(false);
              setPreset(p.id);
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`perfSegPill ${customOn ? 'active' : ''}`}
          onClick={() => setCustomOn(true)}
        >
          Custom range
        </button>
      </div>
      {customOn ? (
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
          <p className="perfSectionHint">Compared with the same number of days immediately before.</p>
        </div>
      ) : null}

      <SkuMultiDropdown
        options={skuCatalog}
        selected={skus}
        onToggle={toggleSku}
        onClear={() => setSkus([])}
        onSelectTop={() => setSkus(skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name))}
      />

      {fleetQ.isError ? <p className="perfError">{(fleetQ.error as Error).message}</p> : null}
      {fleetQ.data?.error ? <p className="perfError">{fleetQ.data.error}</p> : null}

      <section className="perfProductsBlock" aria-labelledby="perf-products-fleet">
        <h4 id="perf-products-fleet" className="perfSectionTitle">
          1. Fleet mix — all locations
        </h4>
        <p className="perfSectionHint">
          Period vs prior for the whole fleet (no site names). Teal = up vs prior, red = down. Click a
          drink to filter.
        </p>
        {fleetQ.isLoading ? <p className="perfMuted">Loading fleet mix…</p> : null}
        <PeriodPriorBars
          categories={fleetChartRows.map((p) => p.name)}
          period={fleetChartRows.map((p) => Number(p.revenueKwd || 0))}
          prior={fleetChartRows.map((p) => Number(p.prevRevenueKwd || 0))}
          periodLabel={periodLabel}
          priorLabel={priorLabel}
          onCategoryClick={toggleSku}
          tintByTrend
          exportName="product-fleet-mix"
          ariaLabel="Fleet product mix period vs prior"
        />
        <div className="perfProductsTrendCols">
          <div>
            <h5 className="perfProductsTrendHead">Rising</h5>
            {rising.length ? (
              <ul className="perfProductsTrendList">
                {rising.map((p) => (
                  <li key={p.name}>
                    <button type="button" onClick={() => toggleSku(p.name)}>
                      {p.name}
                    </button>
                    <span className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="perfMuted">None up vs prior in the top mix.</p>
            )}
          </div>
          <div>
            <h5 className="perfProductsTrendHead">Falling</h5>
            {falling.length ? (
              <ul className="perfProductsTrendList">
                {falling.map((p) => (
                  <li key={p.name}>
                    <button type="button" onClick={() => toggleSku(p.name)}>
                      {p.name}
                    </button>
                    <span className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="perfMuted">None down vs prior in the top mix.</p>
            )}
          </div>
        </div>
      </section>

      {locNone ? <p className="perfMuted">Pick at least one location for the selected-site graphs.</p> : null}

      {compareQ.isError ? <p className="perfError">{(compareQ.error as Error).message}</p> : null}
      {compareQ.data?.error ? <p className="perfError">{compareQ.data.error}</p> : null}

      <section className="perfProductsBlock" aria-labelledby="perf-products-selected">
        <h4 id="perf-products-selected" className="perfSectionTitle">
          2. Selected locations
        </h4>
        {compareQ.isLoading && ids.length > 0 ? <p className="perfMuted">Loading selected mix…</p> : null}
        <ChartExportWrap onExport={exportChart} label="PNG">
          <div
            ref={chartRef}
            className="perfEchart perfEchartOverview"
            role="img"
            aria-label="Selected locations product comparison"
          />
        </ChartExportWrap>
        <p className="perfSectionHint">
          {compareMode
            ? compareSkus.length > 1
              ? 'Grouped bars: one cluster per location, one color per drink (period KD).'
              : 'Each bar group is a location (period KD vs prior).'
            : 'Click a drink bar to include it in the product filter.'}
        </p>

        {!compareMode ? (
          <div className="perfProductsTableWrap">
            <table className="perfProductsTable">
              <thead>
                <tr>
                  <th>Drink</th>
                  <th>{periodLabel} KD</th>
                  <th>{priorLabel} KD</th>
                  <th>vs prior</th>
                  <th>LY KD</th>
                  <th>YoY</th>
                  <th>Cups</th>
                </tr>
              </thead>
              <tbody>
                {locNone ? (
                  <tr>
                    <td colSpan={7}>Select locations above (max {PERF_PRODUCTS_MAX_LOCATIONS}).</td>
                  </tr>
                ) : inLocationRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No product mix for this selection in the window yet.</td>
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
                      <td>{formatKwd(Number(p.prevRevenueKwd || 0))}</td>
                      <td className={trendClass(p.trendPct)}>{trendText(p.trendPct)}</td>
                      <td>{formatKwd(Number(p.yoyRevenueKwd || 0))}</td>
                      <td className={trendClass(p.yoyTrendPct)}>{trendText(p.yoyTrendPct)}</td>
                      <td>{p.cups != null ? Math.round(Number(p.cups)) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="perfProductsTableWrap">
            <table className="perfProductsTable">
              <thead>
                <tr>
                  <th>Location</th>
                  {compareSkus.length > 1 ? <th>Drink</th> : null}
                  <th>{periodLabel} KD</th>
                  <th>{priorLabel} KD</th>
                  <th>vs prior</th>
                  <th>LY KD</th>
                  <th>YoY</th>
                  <th>Cups</th>
                </tr>
              </thead>
              <tbody>
                {locNone ? (
                  <tr>
                    <td colSpan={compareSkus.length > 1 ? 8 : 7}>
                      Select locations above (max {PERF_PRODUCTS_MAX_LOCATIONS}).
                    </td>
                  </tr>
                ) : !compareSkus.length ? (
                  <tr>
                    <td colSpan={7}>Pick a drink in Products (max {PERF_PRODUCTS_MAX_SKUS}).</td>
                  </tr>
                ) : (
                  [...acrossByLocation]
                    .sort((a, b) => b.revenueKwd - a.revenueKwd || a.machineName.localeCompare(b.machineName))
                    .flatMap((r) =>
                      r.cells.map((c) => (
                        <tr key={`${r.machineId}:${c.name}`}>
                          <td>{r.machineName}</td>
                          {compareSkus.length > 1 ? <td>{c.name}</td> : null}
                          <td>{formatKwd(c.revenueKwd)}</td>
                          <td>{formatKwd(c.prevRevenueKwd)}</td>
                          <td className={trendClass(c.trendPct)}>{trendText(c.trendPct)}</td>
                          <td>{formatKwd(c.yoyRevenueKwd)}</td>
                          <td className={trendClass(c.yoyTrendPct)}>{trendText(c.yoyTrendPct)}</td>
                          <td>{c.cups != null ? Math.round(Number(c.cups)) : '—'}</td>
                        </tr>
                      )),
                    )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="perfProductsBlock" aria-labelledby="perf-products-per-machine">
        <h4 id="perf-products-per-machine" className="perfSectionTitle">
          3. Per location
        </h4>
        <p className="perfSectionHint">Same window, one mix chart per selected site.</p>
        {locNone ? (
          <p className="perfMuted">Select locations above.</p>
        ) : (
          <div className="perfProductsMachineGrid">
            {perMachineMix.map((m) => (
              <article key={m.machineId} className="perfProductsMachineCard">
                <h5 className="perfProductsMachineName">{m.machineName}</h5>
                <PeriodPriorBars
                  categories={m.rows.map((p) => p.name)}
                  period={m.rows.map((p) => Number(p.revenueKwd || 0))}
                  prior={m.rows.map((p) => Number(p.prevRevenueKwd || 0))}
                  periodLabel={periodLabel}
                  priorLabel={priorLabel}
                  compact
                  tintByTrend
                  exportName={`product-mix-${m.machineId}`}
                  ariaLabel={`Product mix at ${m.machineName}`}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="perfProductsBlock" aria-labelledby="perf-products-toplow">
        <h4 id="perf-products-toplow" className="perfSectionTitle">
          4. Top and lowest sites
        </h4>
        <p className="perfSectionHint">
          Uses the whole fleet, not the Locations pick. Select a drink (or a few) to rank sites.
        </p>
        {!skus.length ? (
          <p className="perfMuted">Select a drink above to see top and lowest locations.</p>
        ) : (
          <div className="perfProductsTopLow">
            <div>
              <h5 className="perfProductsTrendHead">Top {TOP_LOW}</h5>
              <PeriodPriorBars
                categories={topMachines.map((m) => m.machineName)}
                period={topMachines.map((m) => m.revenue)}
                prior={topMachines.map((m) => m.prev)}
                periodLabel={periodLabel}
                priorLabel={priorLabel}
                compact
                exportName="product-top-sites"
                ariaLabel="Top performing locations for selected drinks"
              />
            </div>
            <div>
              <h5 className="perfProductsTrendHead">Lowest {TOP_LOW}</h5>
              <PeriodPriorBars
                categories={lowMachines.map((m) => m.machineName)}
                period={lowMachines.map((m) => m.revenue)}
                prior={lowMachines.map((m) => m.prev)}
                periodLabel={periodLabel}
                priorLabel={priorLabel}
                compact
                exportName="product-low-sites"
                ariaLabel="Lowest performing locations for selected drinks"
              />
            </div>
          </div>
        )}
      </section>

      <section className="perfProductsBlock" aria-labelledby="perf-products-targets">
        <h4 id="perf-products-targets" className="perfSectionTitle">
          5. Targets achieved
        </h4>
        <p className="perfSectionHint">
          Admin cup targets for the window vs actual cups. Fleet bars have no site names; pick a drink
          for per-location achievement.
        </p>
        {fleetTargetRows.length ? (
          <PeriodPriorBars
            categories={fleetTargetRows.map((p) => p.name)}
            period={fleetTargetRows.map((p) => Number(p.cups || 0))}
            prior={fleetTargetRows.map((p) => Number(p.targetCups || 0))}
            periodLabel="Actual cups"
            priorLabel="Target cups"
            unit="cups"
            exportName="product-fleet-targets"
            ariaLabel="Fleet product cups vs target"
          />
        ) : (
          <p className="perfMuted">No Admin cup targets on the mix for this window.</p>
        )}
        {skus.length ? (
          machineTargetRows.length ? (
            <>
              <h5 className="perfProductsTrendHead">Per location — {skus.join(', ')}</h5>
              <PeriodPriorBars
                categories={machineTargetRows.map((r) => r.label)}
                period={machineTargetRows.map((r) => r.cups)}
                prior={machineTargetRows.map((r) => r.target)}
                periodLabel="Actual cups"
                priorLabel="Target cups"
                unit="cups"
                exportName="product-machine-targets"
                ariaLabel="Location product cups vs target"
              />
            </>
          ) : (
            <p className="perfMuted">
              No cup target on the selected drink(s). Set them under Admin → Targets.
            </p>
          )
        ) : (
          <p className="perfMuted">Select a drink to compare target vs actual at each location.</p>
        )}
      </section>
    </section>
  );
}
