import { formatKwd, formatSalesTrendPct, resolveSalesTrendPct } from '@/lib/salesDisplay';

export function MtdYoySalesCell({
  kwd,
  lyKwd,
  trendPct,
}: {
  kwd?: number | null;
  lyKwd?: number | null;
  trendPct?: number | null;
}) {
  if (kwd == null || !Number.isFinite(Number(kwd))) {
    return <span className="mtdSalesEmpty">—</span>;
  }

  const hasLy = lyKwd != null && Number.isFinite(Number(lyKwd));
  const resolvedTrend = resolveSalesTrendPct(trendPct, Number(kwd), hasLy ? Number(lyKwd) : null);
  const hasTrend = resolvedTrend != null && Number.isFinite(resolvedTrend);
  const trendUp = hasTrend && resolvedTrend >= 0;

  return (
    <div className="mtdYoyCell" title={buildTitle(Number(kwd), hasLy ? Number(lyKwd) : null, resolvedTrend)}>
      <span
        className={`mtdYoyTrend ${hasTrend ? (trendUp ? 'alertSalesUp' : 'alertSalesDown') : 'mtdYoyTrendFlat'}`}
      >
        {hasTrend ? `${trendUp ? '▲ ' : '▼ '}${formatSalesTrendPct(resolvedTrend)}` : '—'}
      </span>
      <span className="mtdYoyPrimary">{formatKwd(Number(kwd))}</span>
      {hasLy ? <span className="mtdYoyLy">LY {formatKwd(Number(lyKwd))}</span> : null}
    </div>
  );
}

function buildTitle(kwd: number, lyKwd: number | null, trendPct?: number | null): string {
  const parts = [`Month-to-date ${formatKwd(kwd)} (Kuwait, this year)`];
  if (lyKwd != null) parts.push(`same month last year through same day: ${formatKwd(lyKwd)}`);
  if (trendPct != null && Number.isFinite(trendPct)) {
    parts.push(`change ${formatSalesTrendPct(trendPct)}`);
  }
  return parts.join('. ');
}
