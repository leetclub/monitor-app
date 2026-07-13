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

export function OpsRevenueTotalsBar({
  totals,
  machineCount,
  asOfLocal,
  yesterdayOverall,
  loading,
  salesFreshnessNote,
}: {
  totals: CompareMetricPair;
  machineCount: number;
  asOfLocal?: string | null;
  /** Full-calendar yesterday + −2d fleet totals (today_vs_yesterday preset). */
  yesterdayOverall?: YesterdayOverallFleet | null;
  /** Wait for elapsed sales API — avoids misleading partial totals on load. */
  loading?: boolean;
  /** Cache / refresh hint for sales totals (updates ~1 min). */
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
        </div>
        {asOfLocal || salesFreshnessNote ? (
          <span className="opsRevenueTotalsAsOf">
            {asOfLocal ? `through ${asOfLocal.replace('T', ' ')} KWT` : null}
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
