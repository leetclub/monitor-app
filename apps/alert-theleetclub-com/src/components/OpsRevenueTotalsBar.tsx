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

/** Viewport X where main content starts — never under the fixed side nav. */
function resolveFleetBarLeft(): number {
  const nav = document.querySelector('.appShell .sideNav') as HTMLElement | null;
  const main = document.querySelector('.appShell .mainColumn') as HTMLElement | null;
  const mainLeft = main?.getBoundingClientRect().left ?? 0;
  const marginLeft = main ? parseFloat(getComputedStyle(main).marginLeft) || 0 : 0;
  const navRight = nav?.getBoundingClientRect().right ?? 0;
  const navFixed = Boolean(nav && getComputedStyle(nav).position === 'fixed');
  const drawerOpen = Boolean(nav?.classList.contains('sideNavOpen'));
  const rail =
    document.querySelector('.appShell.appShellNavRail') != null ||
    Boolean(nav?.classList.contains('sideNavRail'));

  // Drawer open expands over content — keep the reserved rail inset, not overlay width.
  if (drawerOpen && (marginLeft >= 8 || rail)) {
    return Math.max(0, Math.round(marginLeft >= 8 ? marginLeft : 64));
  }

  let left = Math.max(mainLeft, marginLeft);

  // Fixed nav with main starting under it (margin missing / flex collapse).
  if (navFixed && navRight > 0 && left < navRight - 4) {
    left = navRight;
  }

  return Math.max(0, Math.round(left));
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

    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--ops-revenue-bar-h', `${Math.max(h, 72)}px`);
      const left = resolveFleetBarLeft();
      document.documentElement.style.setProperty('--ops-revenue-bar-left', `${left}px`);
      el.style.setProperty('left', `${left}px`, 'important');
      el.style.setProperty('right', '0px', 'important');
      el.style.setProperty('width', 'auto', 'important');
    };

    apply();
    requestAnimationFrame(apply);

    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const main = document.querySelector('.appShell .mainColumn');
    const nav = document.querySelector('.appShell .sideNav');
    if (main) ro.observe(main);
    if (nav) ro.observe(nav);

    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    const shell = document.querySelector('.appShell');
    let mo: MutationObserver | null = null;
    if (shell) {
      mo = new MutationObserver(apply);
      mo.observe(shell, { attributes: true, attributeFilter: ['class'], subtree: true });
    }

    return () => {
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      document.documentElement.style.removeProperty('--ops-revenue-bar-h');
      document.documentElement.style.removeProperty('--ops-revenue-bar-left');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('width');
    };
  }, [loading, totals, yesterdayOverall, monthToDate, yearToDate, asOfLocal, salesFreshnessNote]);

  const bar = (
    <footer ref={barRef} className="opsRevenueTotalsBar" aria-label="Fleet revenue running total">
      <div className="opsRevenueTotalsInner">
        <div className="opsRevenueTotalsBrand">
          <span className="opsRevenueTotalsEyebrow">Fleet revenue</span>
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
            <div className="opsRevenueTotalsMetric opsRevenueTotalsMetric--primary">
              <span className="opsRevenueTotalsLabel">{totals.primaryLabel}</span>
              <span className="opsRevenueTotalsVal">{val(totals.primary)}</span>
            </div>
            <div className="opsRevenueTotalsMetric">
              <span className="opsRevenueTotalsLabel">{totals.baselineLabel}</span>
              <span className="opsRevenueTotalsVal opsRevenueTotalsValMuted">{val(totals.baseline)}</span>
            </div>
            <div className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap">
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

  // Portal to body so fixed positioning is always viewport-relative (not trapped by page transforms).
  if (typeof document === 'undefined') return bar;
  return createPortal(bar, document.body);
}
