import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatKwdWhole, formatSalesTrendPct, resolveSalesTrendPct } from '@/lib/salesDisplay';
import type { CompareMetricPair } from '@/lib/presetComparison';

export type YesterdayOverallFleet = {
  /** Full Kuwait calendar day yesterday (revenue cache). */
  kwd: number | null;
  /** Full Kuwait calendar day day-before-yesterday (−2d). */
  dayBeforeKwd: number | null;
  /** Full yesterday vs full −2d. */
  trendVsDayBeforePct: number | null;
};

export type PeriodCompareFleet = {
  primary: number | null;
  baseline: number | null;
  trendPct: number | null;
  primaryLabel: string;
  baselineLabel: string;
};

function formatAsOfClock(asOfLocal: string): string {
  const t = String(asOfLocal || '').trim();
  const m = t.match(/T(\d{1,2}:\d{2})/);
  if (m) return `${m[1]} KWT`;
  if (/^\d{1,2}:\d{2}/.test(t)) return `${t.slice(0, 5)} KWT`;
  return t;
}

/**
 * Fleet revenue bar — portaled to body; left edge aligns with sidebar right (nav stays full height).
 */
function resolveFleetBarLeft(): number {
  const v2Nav = document.querySelector('.v2AppRoot .v2Sidebar') as HTMLElement | null;
  if (v2Nav) {
    const rect = v2Nav.getBoundingClientRect();
    if (rect.width > 0 && rect.right > 0) return Math.max(0, Math.round(rect.right));
  }

  const nav = document.querySelector('.appShell .sideNav') as HTMLElement | null;
  if (!nav) return 0;

  const railPx = 64;
  if (nav.classList.contains('sideNavOpen')) {
    return railPx;
  }

  const rect = nav.getBoundingClientRect();
  const left = rect.right > 0 ? rect.right : rect.width;
  return Math.max(0, Math.round(left));
}

function syncFleetBarChrome(barEl: HTMLElement) {
  const h = Math.max(64, Math.ceil(barEl.getBoundingClientRect().height));
  const left = resolveFleetBarLeft();
  const root = document.documentElement;

  const prevH = root.style.getPropertyValue('--ops-revenue-bar-h').trim();
  const nextH = `${h}px`;
  if (prevH !== nextH) {
    root.style.setProperty('--ops-revenue-bar-h', nextH);
  }

  const prevLeft = root.style.getPropertyValue('--ops-revenue-bar-left').trim();
  const nextLeft = `${left}px`;
  if (prevLeft !== nextLeft) {
    root.style.setProperty('--ops-revenue-bar-left', nextLeft);
  }

  // Avoid layout thrash: only write inline styles when they actually change
  if (barEl.style.getPropertyValue('left') !== nextLeft) {
    barEl.style.setProperty('left', nextLeft, 'important');
  }
  if (barEl.style.getPropertyValue('right') !== '0px') {
    barEl.style.setProperty('right', '0px', 'important');
  }
  if (barEl.style.getPropertyValue('width') !== 'auto') {
    barEl.style.setProperty('width', 'auto', 'important');
  }

  document.querySelector('.v2AppRoot')?.classList.add('hasOpsFleetRevenuePad');
}

function clearFleetBarChrome() {
  document.documentElement.style.setProperty('--ops-revenue-bar-h', '0px');
  document.documentElement.style.removeProperty('--ops-revenue-bar-left');
  document.querySelector('.v2AppRoot')?.classList.remove('hasOpsFleetRevenuePad');
}

function TrendText({
  trendPct,
  loading,
}: {
  trendPct: number | null | undefined;
  loading?: boolean;
}) {
  const has = !loading && trendPct != null && Number.isFinite(trendPct);
  if (!has) {
    return <span className="opsRevenueTotalsTrend opsRevenueTotalsTrendMuted">—</span>;
  }
  const up = (trendPct as number) >= 0;
  const down = (trendPct as number) < 0;
  return (
    <span className={`opsRevenueTotalsTrend ${up ? 'alertSalesUp' : down ? 'alertSalesDown' : ''}`}>
      {up ? '▲ ' : '▼ '}
      {formatSalesTrendPct(trendPct as number)}
    </span>
  );
}

function PeriodMetric({
  label,
  value,
  muted,
  loading,
  divider,
  title,
}: {
  label: string;
  value: number | null | undefined;
  muted?: boolean;
  loading?: boolean;
  divider?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`opsRevenueTotalsMetric${divider ? ' opsRevenueTotalsMetricDivider' : ''}`}
      title={title}
    >
      <span className="opsRevenueTotalsLabel">{label}</span>
      <span className={`opsRevenueTotalsVal${muted ? ' opsRevenueTotalsValMuted' : ''}`}>
        {loading ? '…' : value != null ? formatKwdWhole(value) : '—'}
      </span>
    </div>
  );
}

export function OpsRevenueTotalsBar({
  totals,
  machineCount,
  asOfLocal,
  yesterdayOverall,
  monthToDate,
  yearToDate,
  loading,
  salesFreshnessNote,
}: {
  totals: CompareMetricPair;
  machineCount: number;
  asOfLocal?: string | null;
  yesterdayOverall?: YesterdayOverallFleet | null;
  monthToDate?: PeriodCompareFleet | null;
  yearToDate?: PeriodCompareFleet | null;
  loading?: boolean;
  salesFreshnessNote?: string | null;
}) {
  const barRef = useRef<HTMLElement | null>(null);
  const val = (n: number | null | undefined) =>
    loading ? '…' : n != null ? formatKwdWhole(n) : '—';
  const trendPct = loading ? null : resolveSalesTrendPct(totals.trendPct, totals.primary, totals.baseline);
  const hasTrend = !loading && trendPct != null && Number.isFinite(trendPct);
  const up = hasTrend && trendPct >= 0;
  const down = hasTrend && trendPct < 0;
  const yoTrend = loading ? null : yesterdayOverall?.trendVsDayBeforePct;

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    let raf = 0;
    const apply = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        syncFleetBarChrome(el);
      });
    };

    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const nav = document.querySelector('.appShell .sideNav');
    const v2Nav = document.querySelector('.v2AppRoot .v2Sidebar');
    // Do NOT observe .mainColumn — padding from --ops-revenue-bar-h resizes it and
    // used to create an infinite ResizeObserver loop that froze all clicks.
    if (nav) ro.observe(nav);
    if (v2Nav) ro.observe(v2Nav);

    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    const shell = document.querySelector('.appShell');
    const v2Root = document.querySelector('.v2AppRoot');
    let mo: MutationObserver | null = null;
    if (shell || v2Root) {
      mo = new MutationObserver(apply);
      // Only watch the shell root class (rail/drawer), not the whole subtree.
      if (shell) mo.observe(shell, { attributes: true, attributeFilter: ['class'] });
      if (v2Root) mo.observe(v2Root, { attributes: true, attributeFilter: ['class'] });
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('width');
      clearFleetBarChrome();
    };
  }, [loading, totals, yesterdayOverall, monthToDate, yearToDate, asOfLocal, salesFreshnessNote]);

  const bar = (
    <footer ref={barRef} className="opsRevenueTotalsBar" aria-label="Fleet revenue running total">
      <div className="opsRevenueTotalsInner">
        <div className="opsRevenueTotalsBrand">
          <span className="opsRevenueTotalsEyebrow">Fleet actual revenue</span>
          <span className="opsRevenueTotalsCount">{machineCount} machines</span>
          {asOfLocal || salesFreshnessNote ? (
            <span className="opsRevenueTotalsAsOfMobile">
              {asOfLocal ? formatAsOfClock(asOfLocal) : null}
              {asOfLocal && salesFreshnessNote ? ' · ' : null}
              {salesFreshnessNote}
            </span>
          ) : null}
        </div>

        <div className="opsRevenueTotalsMetrics">
          <div className="opsRevenueTotalsGroup" aria-label="Compare period">
            <div
              className="opsRevenueTotalsMetric opsRevenueTotalsMetric--primary"
              title={`${totals.primaryLabel}: fleet actual revenue (KD) for the active compare preset. Customer sales only — excludes WEB cashless / remote-credit dispenses.`}
            >
              <span className="opsRevenueTotalsLabel">{totals.primaryLabel}</span>
              <span className="opsRevenueTotalsVal">{val(totals.primary)}</span>
            </div>
            <div
              className="opsRevenueTotalsMetric"
              title={`${totals.baselineLabel}: comparison baseline total (KD) for the same machines.`}
            >
              <span className="opsRevenueTotalsLabel">{totals.baselineLabel}</span>
              <span className="opsRevenueTotalsVal opsRevenueTotalsValMuted">{val(totals.baseline)}</span>
            </div>
            <div
              className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap"
              title="Percent change between primary and baseline fleet totals."
            >
              <span className="opsRevenueTotalsLabel">Change</span>
              {hasTrend ? (
                <span className={`opsRevenueTotalsTrend ${up ? 'alertSalesUp' : down ? 'alertSalesDown' : ''}`}>
                  {up ? '▲ ' : '▼ '}
                  {formatSalesTrendPct(trendPct)}
                </span>
              ) : (
                <span className="opsRevenueTotalsTrend opsRevenueTotalsTrendMuted">—</span>
              )}
            </div>
          </div>

          {yesterdayOverall ? (
            <div className="opsRevenueTotalsGroup opsRevenueTotalsGroup--secondary" aria-label="Yesterday full day">
              <PeriodMetric
                divider
                label="Yest. full day"
                value={yesterdayOverall.kwd}
                muted
                loading={loading}
                title="Completed Kuwait calendar day yesterday — fleet total from revenue cache"
              />
              <PeriodMetric
                label="−2d full day"
                value={yesterdayOverall.dayBeforeKwd}
                muted
                loading={loading}
                title="Completed Kuwait calendar day before yesterday (−2d)"
              />
              <div
                className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap"
                title="Percent change: full yesterday vs full −2d"
              >
                <span className="opsRevenueTotalsLabel">vs −2d</span>
                <TrendText trendPct={yoTrend} loading={loading} />
              </div>
            </div>
          ) : null}

          {monthToDate ? (
            <div className="opsRevenueTotalsGroup" aria-label="Month to date">
              <PeriodMetric
                divider
                label={monthToDate.primaryLabel}
                value={monthToDate.primary}
                loading={loading}
                title="This month to date vs last month same days"
              />
              <PeriodMetric
                label={monthToDate.baselineLabel}
                value={monthToDate.baseline}
                muted
                loading={loading}
              />
              <div className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap" title="MTD change">
                <span className="opsRevenueTotalsLabel">MTD Δ</span>
                <TrendText trendPct={monthToDate.trendPct} loading={loading} />
              </div>
            </div>
          ) : null}

          {yearToDate ? (
            <div className="opsRevenueTotalsGroup" aria-label="Year to date">
              <PeriodMetric
                divider
                label={yearToDate.primaryLabel}
                value={yearToDate.primary}
                loading={loading}
                title="Year to date vs last year same dates"
              />
              <PeriodMetric
                label={yearToDate.baselineLabel}
                value={yearToDate.baseline}
                muted
                loading={loading}
              />
              <div className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap" title="YTD change">
                <span className="opsRevenueTotalsLabel">YTD Δ</span>
                <TrendText trendPct={yearToDate.trendPct} loading={loading} />
              </div>
            </div>
          ) : null}
        </div>

        {asOfLocal || salesFreshnessNote ? (
          <span className="opsRevenueTotalsAsOf">
            {asOfLocal ? formatAsOfClock(asOfLocal) : null}
            {asOfLocal && salesFreshnessNote ? ' · ' : null}
            {salesFreshnessNote ? (
              <span className="opsRevenueTotalsFreshness" title={salesFreshnessNote}>
                {salesFreshnessNote}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </footer>
  );

  if (typeof document === 'undefined') return bar;
  return createPortal(bar, document.body);
}
