import { formatKwd, formatSalesTrendPct, resolveSalesTrendPct } from '@/lib/salesDisplay';
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

function PeriodMetric({
  label,
  value,
  muted,
  loading,
}: {
  label: string;
  value: number | null | undefined;
  muted?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="opsRevenueTotalsMetric">
      <span className="opsRevenueTotalsLabel">{label}</span>
      <span className={`opsRevenueTotalsVal${muted ? ' opsRevenueTotalsValMuted' : ''}`}>
        {loading ? '…' : value != null ? formatKwd(value) : '—'}
      </span>
    </div>
  );
}

function TrendMetric({
  label,
  trendPct,
  loading,
  title,
}: {
  label: string;
  trendPct: number | null | undefined;
  loading?: boolean;
  title?: string;
}) {
  const has = !loading && trendPct != null && Number.isFinite(trendPct);
  const up = has && (trendPct as number) >= 0;
  const down = has && (trendPct as number) < 0;
  return (
    <div className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap" title={title}>
      <span className="opsRevenueTotalsLabel">{label}</span>
      {has ? (
        <span className={`opsRevenueTotalsTrend ${up ? 'alertSalesUp' : down ? 'alertSalesDown' : ''}`}>
          {up ? '▲ ' : '▼ '}
          {formatSalesTrendPct(trendPct as number)}
        </span>
      ) : (
        <span className="opsRevenueTotalsTrend opsRevenueTotalsTrendMuted">—</span>
      )}
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
  /** Full-calendar yesterday + −2d fleet totals (today_vs_yesterday preset). */
  yesterdayOverall?: YesterdayOverallFleet | null;
  /** This month to date vs last month same days. */
  monthToDate?: PeriodCompareFleet | null;
  /** Year to date vs last year same dates. */
  yearToDate?: PeriodCompareFleet | null;
  /** Wait for elapsed sales API — avoids misleading partial totals on load. */
  loading?: boolean;
  /** Short age only, e.g. "just now" — avoid long refresh copy. */
  salesFreshnessNote?: string | null;
}) {
  const val = (n: number | null | undefined) =>
    loading ? '…' : n != null ? formatKwd(n) : '—';
  const trendPct = loading ? null : resolveSalesTrendPct(totals.trendPct, totals.primary, totals.baseline);
  const hasTrend = !loading && trendPct != null && Number.isFinite(trendPct);
  const up = hasTrend && trendPct >= 0;
  const down = hasTrend && trendPct < 0;

  const yoTrend = loading ? null : yesterdayOverall?.trendVsDayBeforePct;
  const hasYoTrend = !loading && yoTrend != null && Number.isFinite(yoTrend);
  const yoUp = hasYoTrend && yoTrend >= 0;
  const yoDown = hasYoTrend && yoTrend < 0;

  return (
    <footer className="opsRevenueTotalsBar" aria-label="Fleet revenue running total">
      <div className="opsRevenueTotalsInner">
        <div className="opsRevenueTotalsBrand">
          <span className="opsRevenueTotalsEyebrow">Fleet revenue</span>
          <span className="opsRevenueTotalsCount">{machineCount} machines</span>
        </div>
        <div className="opsRevenueTotalsMetrics">
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
          {yesterdayOverall ? (
            <>
              <div
                className="opsRevenueTotalsMetric opsRevenueTotalsMetricDivider"
                title="Completed Kuwait calendar day yesterday — fleet total from revenue cache"
              >
                <span className="opsRevenueTotalsLabel">Yest. full day</span>
                <span className="opsRevenueTotalsVal opsRevenueTotalsValMuted">{val(yesterdayOverall.kwd)}</span>
              </div>
              <div
                className="opsRevenueTotalsMetric"
                title="Completed Kuwait calendar day before yesterday (−2d) — fleet total from revenue cache"
              >
                <span className="opsRevenueTotalsLabel">−2d full day</span>
                <span className="opsRevenueTotalsVal opsRevenueTotalsValMuted">
                  {val(yesterdayOverall.dayBeforeKwd)}
                </span>
              </div>
              <div
                className="opsRevenueTotalsMetric opsRevenueTotalsTrendWrap"
                title="Percent change: full yesterday vs full −2d"
              >
                <span className="opsRevenueTotalsLabel">vs −2d</span>
                {hasYoTrend ? (
                  <span
                    className={`opsRevenueTotalsTrend ${yoUp ? 'alertSalesUp' : yoDown ? 'alertSalesDown' : ''}`}
                  >
                    {yoUp ? '▲ ' : '▼ '}
                    {formatSalesTrendPct(yoTrend)}
                  </span>
                ) : (
                  <span className="opsRevenueTotalsTrend opsRevenueTotalsTrendMuted">—</span>
                )}
              </div>
            </>
          ) : null}
          {monthToDate ? (
            <>
              <div className="opsRevenueTotalsMetric opsRevenueTotalsMetricDivider" title="Month to date through today">
                <span className="opsRevenueTotalsLabel">{monthToDate.primaryLabel}</span>
                <span className="opsRevenueTotalsVal">{val(monthToDate.primary)}</span>
              </div>
              <PeriodMetric
                label={monthToDate.baselineLabel}
                value={monthToDate.baseline}
                muted
                loading={loading}
              />
              <TrendMetric
                label="MTD Δ"
                trendPct={monthToDate.trendPct}
                loading={loading}
                title="This month to date vs last month same days"
              />
            </>
          ) : null}
          {yearToDate ? (
            <>
              <div className="opsRevenueTotalsMetric opsRevenueTotalsMetricDivider" title="Year to date through today">
                <span className="opsRevenueTotalsLabel">{yearToDate.primaryLabel}</span>
                <span className="opsRevenueTotalsVal">{val(yearToDate.primary)}</span>
              </div>
              <PeriodMetric
                label={yearToDate.baselineLabel}
                value={yearToDate.baseline}
                muted
                loading={loading}
              />
              <TrendMetric
                label="YTD Δ"
                trendPct={yearToDate.trendPct}
                loading={loading}
                title="Year to date vs last year same dates"
              />
            </>
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
}
