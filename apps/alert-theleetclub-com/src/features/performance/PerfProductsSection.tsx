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

type ProductLens = 'in_location' | 'across_locations';

const PRODUCT_PRESETS: { id: PerfPreset; label: string }[] = [
  { id: 'today', label: 'Today vs yesterday' },
  { id: 'yesterday', label: 'Yesterday vs day before' },
  { id: 'this_week', label: 'This week vs last' },
  { id: 'last_week', label: 'Last week vs week before' },
  { id: 'this_month', label: 'This month vs last' },
  { id: 'last_month', label: 'Last month vs month before' },
];

const GRAPH_MAX = 12;

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
    { revenue: number; prev: number; yoy: number; cups: number }
  >();
  for (const m of machines) {
    for (const p of m.products || []) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const cur = totals.get(name) || { revenue: 0, prev: 0, yoy: 0, cups: 0 };
      cur.revenue += Number(p.revenueKwd || 0);
      cur.prev += Number(p.prevRevenueKwd || 0);
      cur.yoy += Number(p.yoyRevenueKwd || 0);
      cur.cups += Number(p.cups || 0);
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
    }))
    .sort((a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0) || a.name.localeCompare(b.name));
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
    : `No drink filter · graph top ${GRAPH_MAX}`;

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
          : `No filter = every drink in the mix (none of the boxes are a selection). Graph still plots only the top ${GRAPH_MAX} by KD. Select ${PERF_PRODUCTS_MAX_SKUS} checks the highest-KD drinks.`}
      </p>
    </section>
  );
}

type Props = {
  machines: MachineRow[];
  selectedIds: string[];
  allSelected: boolean;
};

export function PerfProductsSection({ machines, selectedIds, allSelected }: Props) {
  const [preset, setPreset] = useState<PerfPreset>('today');
  const [lens, setLens] = useState<ProductLens>('in_location');
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

  const compareQ = useQuery({
    queryKey: ['alert-performance-product-compare', preset, idsKey],
    queryFn: () =>
      apiGet<ProductComparePayload>(
        `/api/alert/performance/product-compare?preset=${encodeURIComponent(preset)}&machineIds=${encodeURIComponent(idsKey)}`,
      ),
    enabled: ids.length > 0,
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

  const win = compareQ.data?.window;
  const periodLabel = win?.label || 'Period';
  const priorLabel = win?.prevLabel || 'Prior';
  const windowHint =
    win?.start && win?.end
      ? `${periodLabel}: ${win.start} → ${win.end} · ${priorLabel}: ${win.prevStart} → ${win.prevEnd}`
      : '';

  const mixedRows = useMemo(() => aggregateProducts(payloadMachines), [payloadMachines]);

  const skuCatalog = useMemo(
    () => mixedRows.map((p) => ({ name: p.name, kd: Number(p.revenueKwd || 0) })),
    [mixedRows],
  );

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

  const skuSet = useMemo(() => new Set(skus), [skus]);

  const inLocationRows = useMemo(() => {
    if (!skus.length) return mixedRows;
    return mixedRows.filter((p) => skuSet.has(p.name));
  }, [mixedRows, skus, skuSet]);

  const acrossByLocation = useMemo(() => {
    if (!skus.length) return [];
    return payloadMachines.map((m) => {
      const byName = new Map(
        (m.products || []).map((p) => [String(p.name || '').trim(), p] as const),
      );
      const cells = skus.map((name) => {
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
  }, [payloadMachines, skus]);

  const chartModel = useMemo(() => {
    if (lens === 'in_location') {
      const top = inLocationRows.slice(0, GRAPH_MAX);
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
    const want = skus;
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
    const top = rows.slice(0, GRAPH_MAX);
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
  }, [lens, inLocationRows, acrossByLocation, skus, periodLabel, priorLabel]);

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
        lens === 'in_location' ? `${ids.length}-loc` : 'across',
        preset,
      ]),
    );
  }, [lens, ids.length, preset]);

  const locNames = useMemo(() => {
    const byId = new Map(machines.map((m) => [m.id, m.name]));
    return ids.map((id) => byId.get(id) || id);
  }, [ids, machines]);

  const showingBlurb = useMemo(() => {
    if (!ids.length) return '';
    const locLabel =
      locNames.length <= 3 ? locNames.join(' + ') : `${locNames.slice(0, 3).join(' + ')} + ${locNames.length - 3} more`;
    const locBit =
      locNames.length === 1 ? locLabel : `${locLabel} (KD summed per drink, not split by site)`;
    if (compareQ.isLoading) return `Loading mix for ${locLabel}…`;
    const graphN = Math.min(GRAPH_MAX, skus.length || mixedRows.length);
    const mixN = mixedRows.length;
    if (lens === 'in_location') {
      if (!skus.length) {
        return `Now showing: combined mix for ${locBit}. Graph: top ${graphN} of ${mixN} drinks by period KD vs prior. Table: every drink. Check drinks (max ${PERF_PRODUCTS_MAX_SKUS}) to limit the mix, or switch to Same drink(s) across locations to compare sites.`;
      }
      return `Now showing: ${skus.join(', ')} at ${locBit}. Graph and table are those drinks only (combined KD if several sites).`;
    }
    if (!skus.length) {
      return `Now showing: pick at least one drink to compare ${locBit} side by side.`;
    }
    if (skus.length === 1) {
      return `Now showing: ${skus[0]} at each of ${locNames.length} location(s) — period KD vs prior.`;
    }
    return `Now showing: ${skus.join(', ')} at each of ${locNames.length} location(s) — grouped bars, period KD.`;
  }, [ids.length, locNames, skus, mixedRows.length, lens, compareQ.isLoading]);

  const acrossSkus = skus;

  return (
    <section className="perfProducts" aria-labelledby="perf-products-title">
      <header className="perfProductsHead">
        <div>
          <h3 id="perf-products-title" className="perfSectionTitle">
            Product performance
          </h3>
          <p className="perfSectionHint">
            Select all locations picks {PERF_PRODUCTS_MAX_LOCATIONS}. Max {PERF_PRODUCTS_MAX_SKUS}{' '}
            drinks. No drink filter = full mix, not eight checked boxes.
          </p>
          {showingBlurb ? <p className="perfProductsNow">{showingBlurb}</p> : null}
          {windowHint ? <p className="perfSectionHint">{windowHint}</p> : null}
        </div>
      </header>

      <div className="perfModePills" role="group" aria-label="Product compare window">
        {PRODUCT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`perfSegPill ${preset === p.id ? 'active' : ''}`}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="perfModePills" role="group" aria-label="Product lens">
        <button
          type="button"
          className={`perfSegPill ${lens === 'in_location' ? 'active' : ''}`}
          onClick={() => setLens('in_location')}
        >
          Drinks in location(s)
        </button>
        <button
          type="button"
          className={`perfSegPill ${lens === 'across_locations' ? 'active' : ''}`}
          onClick={() => setLens('across_locations')}
        >
          Same drink(s) across locations
        </button>
      </div>

      <SkuMultiDropdown
        options={skuCatalog}
        selected={skus}
        onToggle={toggleSku}
        onClear={() => setSkus([])}
        onSelectTop={() => setSkus(skuCatalog.slice(0, PERF_PRODUCTS_MAX_SKUS).map((s) => s.name))}
      />

      {locNone ? <p className="perfMuted">Pick at least one location.</p> : null}

      {compareQ.isError ? <p className="perfError">{(compareQ.error as Error).message}</p> : null}
      {compareQ.data?.error ? <p className="perfError">{compareQ.data.error}</p> : null}
      {compareQ.isLoading ? <p className="perfMuted">Loading product mix…</p> : null}

      <ChartExportWrap onExport={exportChart} label="PNG">
        <div
          ref={chartRef}
          className="perfEchart perfEchartOverview"
          role="img"
          aria-label="Product performance comparison"
        />
      </ChartExportWrap>
      <p className="perfSectionHint">
        Graph shows top {GRAPH_MAX} by period KD.
        {lens === 'in_location'
          ? ids.length > 1
            ? ` Combined mix for ${ids.length} locations.`
            : ' Click a drink bar to include it in the product filter.'
          : skus.length > 1
            ? ' Grouped bars = one color per drink (period KD).'
            : ''}
      </p>

      {lens === 'in_location' ? (
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
                {acrossSkus.length > 1 ? <th>Drink</th> : null}
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
                  <td colSpan={acrossSkus.length > 1 ? 8 : 7}>
                    Select locations above (max {PERF_PRODUCTS_MAX_LOCATIONS}).
                  </td>
                </tr>
              ) : !acrossSkus.length ? (
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
                        {acrossSkus.length > 1 ? <td>{c.name}</td> : null}
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
  );
}
