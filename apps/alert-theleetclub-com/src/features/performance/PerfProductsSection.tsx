import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { apiGet } from '@/lib/api';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { SERIES_PALETTE, type MachineRow, type PerfPreset } from '@/features/performance/perfTypes';

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

function SkuDropdown({
  options,
  value,
  allowAll,
  onChange,
}: {
  options: { name: string; kd: number }[];
  value: string;
  allowAll: boolean;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.name === value);
  const summary = value
    ? selected?.name || value
    : allowAll
      ? `All drinks (${options.length})`
      : 'Choose a drink';

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
          <span className="perfMachineFilterCount">{summary}</span>
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
              </div>
              <div className="perfLocDropdownList">
                {allowAll ? (
                  <button
                    type="button"
                    className={`perfSkuRow perfSkuAll ${!value ? 'active' : ''}`}
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    All drinks
                  </button>
                ) : null}
                {filtered.length === 0 ? (
                  <p className="perfMuted">No matches.</p>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o.name}
                      type="button"
                      className={`perfSkuRow ${value === o.name ? 'active' : ''}`}
                      onClick={() => {
                        onChange(o.name);
                        setOpen(false);
                        setQ('');
                      }}
                      title={`${o.name} · ${formatKwd(o.kd)}`}
                    >
                      <span className="perfLocRowName">{o.name}</span>
                      <span className="perfSkuKd">{formatKwd(o.kd)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
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
  const [sku, setSku] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const ids = useMemo(() => {
    const list = allSelected ? machines.map((m) => m.id) : selectedIds;
    return list.slice(0, 80);
  }, [allSelected, machines, selectedIds]);

  const idsKey = ids.slice().sort().join(',');
  const singleLocationId = !allSelected && selectedIds.length === 1 ? selectedIds[0] : '';

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
    return rows.map((m) => {
      const name = byId.get(m.machineId);
      return name ? { ...m, machineName: name } : m;
    });
  }, [compareQ.data?.machines, machines]);

  const win = compareQ.data?.window;
  const periodLabel = win?.label || 'Period';
  const priorLabel = win?.prevLabel || 'Prior';
  const windowHint =
    win?.start && win?.end
      ? `${periodLabel}: ${win.start} → ${win.end} · ${priorLabel}: ${win.prevStart} → ${win.prevEnd}`
      : '';

  const focusMachine = payloadMachines.find((m) => m.machineId === singleLocationId);

  const skuCatalog = useMemo(() => {
    const totals = new Map<string, number>();
    const source =
      lens === 'in_location' && focusMachine ? [focusMachine] : payloadMachines;
    for (const m of source) {
      for (const p of m.products || []) {
        const name = String(p.name || '').trim();
        if (!name) continue;
        totals.set(name, (totals.get(name) || 0) + Number(p.revenueKwd || 0));
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, kd]) => ({ name, kd }));
  }, [payloadMachines, focusMachine, lens]);

  useEffect(() => {
    if (!skuCatalog.length) {
      if (sku) setSku('');
      return;
    }
    if (lens === 'across_locations' && (!sku || !skuCatalog.some((s) => s.name === sku))) {
      setSku(skuCatalog[0]?.name || '');
    }
    if (lens === 'in_location' && sku && !skuCatalog.some((s) => s.name === sku)) {
      setSku('');
    }
  }, [skuCatalog, sku, lens]);

  const inLocationRows = useMemo(() => {
    const rows = [...(focusMachine?.products || [])];
    rows.sort((a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0));
    if (sku) return rows.filter((p) => p.name === sku);
    return rows;
  }, [focusMachine, sku]);

  const acrossRows = useMemo(() => {
    const want = sku.trim().toLowerCase();
    if (!want) return [];
    const rows = payloadMachines.map((m) => {
      const hit =
        (m.products || []).find((p) => String(p.name || '').trim().toLowerCase() === want) ||
        null;
      return {
        machineId: m.machineId,
        machineName: m.machineName,
        revenueKwd: Number(hit?.revenueKwd || 0),
        prevRevenueKwd: Number(hit?.prevRevenueKwd || 0),
        yoyRevenueKwd: Number(hit?.yoyRevenueKwd || 0),
        cups: hit?.cups ?? 0,
        trendPct: hit?.trendPct ?? null,
        yoyTrendPct: hit?.yoyTrendPct ?? null,
      };
    });
    rows.sort((a, b) => b.revenueKwd - a.revenueKwd || a.machineName.localeCompare(b.machineName));
    return rows;
  }, [payloadMachines, sku]);

  const chartSeries = useMemo(() => {
    if (lens === 'in_location') {
      const top = inLocationRows.slice(0, GRAPH_MAX);
      return {
        categories: top.map((p) => p.name),
        period: top.map((p) => Number(p.revenueKwd || 0)),
        prior: top.map((p) => Number(p.prevRevenueKwd || 0)),
        clickSetsSku: true,
      };
    }
    const top = acrossRows.slice(0, GRAPH_MAX);
    return {
      categories: top.map((r) => r.machineName),
      period: top.map((r) => r.revenueKwd),
      prior: top.map((r) => r.prevRevenueKwd),
      clickSetsSku: false,
    };
  }, [lens, inLocationRows, acrossRows]);

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
    const cats = chartSeries.categories;
    chart.off('click');
    if (!cats.length) {
      chart.clear();
      return;
    }
    chart.setOption(
      {
        color: [SERIES_PALETTE[0], SERIES_PALETTE[1]],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          valueFormatter: (v: number | string) => formatKwd(Number(v || 0)),
        },
        legend: { data: [periodLabel, priorLabel], textStyle: { color: theme.muted } },
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
        series: [
          { name: periodLabel, type: 'bar', data: chartSeries.period, barMaxWidth: 22 },
          { name: priorLabel, type: 'bar', data: chartSeries.prior, barMaxWidth: 22 },
        ],
      },
      true,
    );
    if (chartSeries.clickSetsSku) {
      chart.on('click', (params: { name?: string }) => {
        const name = String(params.name || '').trim();
        if (name) setSku((prev) => (prev === name ? '' : name));
      });
    }
  }, [chartSeries, periodLabel, priorLabel]);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([
        'product-performance',
        lens === 'in_location' ? focusMachine?.machineName || 'location' : sku || 'sku',
        preset,
      ]),
    );
  }, [lens, focusMachine?.machineName, sku, preset]);

  const needOneLocation = lens === 'in_location' && !singleLocationId;

  return (
    <section className="perfProducts" aria-labelledby="perf-products-title">
      <header className="perfProductsHead">
        <div>
          <h3 id="perf-products-title" className="perfSectionTitle">
            Product performance
          </h3>
          <p className="perfSectionHint">
            Locations above pick the sites. Products dropdown picks the drink. Click a bar to filter
            that drink. Period vs prior uses Today / WTD / month windows.
            {ids.length >= 80 ? ' Showing the first 80 selected locations.' : ''}
          </p>
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
          Drinks in a location
        </button>
        <button
          type="button"
          className={`perfSegPill ${lens === 'across_locations' ? 'active' : ''}`}
          onClick={() => setLens('across_locations')}
        >
          Same drink across locations
        </button>
      </div>

      <SkuDropdown
        options={skuCatalog}
        value={sku}
        allowAll={lens === 'in_location'}
        onChange={setSku}
      />

      {needOneLocation ? (
        <p className="perfMuted">
          Pick <strong>one</strong> location in <strong>Locations</strong> (use <strong>Only</strong>)
          to see drinks at that site. Or switch to <strong>Same drink across locations</strong>.
        </p>
      ) : null}

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
        Graph shows top {GRAPH_MAX} by period KD. Full list is in the table.
        {lens === 'in_location' ? ' Click a drink bar to filter; click again for all drinks.' : ''}
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
              {needOneLocation ? (
                <tr>
                  <td colSpan={7}>Select one location above.</td>
                </tr>
              ) : inLocationRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>No product mix for this location in the window yet.</td>
                </tr>
              ) : (
                inLocationRows.map((p) => (
                  <tr
                    key={p.name}
                    className={sku === p.name ? 'perfProductsRowActive' : undefined}
                    onClick={() => setSku((prev) => (prev === p.name ? '' : p.name))}
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
                <th>{periodLabel} KD</th>
                <th>{priorLabel} KD</th>
                <th>vs prior</th>
                <th>LY KD</th>
                <th>YoY</th>
                <th>Cups</th>
              </tr>
            </thead>
            <tbody>
              {!sku ? (
                <tr>
                  <td colSpan={7}>Pick a drink in Products.</td>
                </tr>
              ) : acrossRows.every((r) => r.revenueKwd <= 0 && r.prevRevenueKwd <= 0) ? (
                <tr>
                  <td colSpan={7}>No sales for {sku} in this window.</td>
                </tr>
              ) : (
                acrossRows.map((r) => (
                  <tr key={r.machineId}>
                    <td>{r.machineName}</td>
                    <td>{formatKwd(r.revenueKwd)}</td>
                    <td>{formatKwd(r.prevRevenueKwd)}</td>
                    <td className={trendClass(r.trendPct)}>{trendText(r.trendPct)}</td>
                    <td>{formatKwd(r.yoyRevenueKwd)}</td>
                    <td className={trendClass(r.yoyTrendPct)}>{trendText(r.yoyTrendPct)}</td>
                    <td>{r.cups != null ? Math.round(Number(r.cups)) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
