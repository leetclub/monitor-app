import {
  formatDowntimeSec,
  formatDowntimeTrendPct,
  type DowntimeMachineRow,
} from '@/lib/downtimeDisplay';
import { bindStopRowClick } from '@/lib/stopRowClick';

/**
 * Two-box downtime stack: Today + compare baseline (e.g. Yesterday).
 * Trend chip = today vs same-elapsed period (more downtime = worse / red).
 * Reuses salesStack layout so cell height matches Sales / Target columns.
 * Tap opens event list + estimated KD loss modal.
 */
function DowntimeTrendLine({ trendPct }: { trendPct: number | null }) {
  const hasPct = trendPct != null && Number.isFinite(trendPct);
  if (!hasPct) {
    return <span className="salesStackTrend salesStackTrendMuted">—</span>;
  }
  // More downtime vs yesterday = bad (red); less = good (green).
  const worse = trendPct > 0;
  const better = trendPct < 0;
  const tone = worse ? 'alertSalesDown' : better ? 'alertSalesUp' : 'salesStackTrendMuted';
  return (
    <span className={`salesStackTrend ${tone}`}>
      {worse ? '▲ ' : better ? '▼ ' : ''}
      {formatDowntimeTrendPct(trendPct)}
    </span>
  );
}

export function DowntimeStack({
  row,
  todayLabel = 'Today',
  periodLabel = 'Period',
  title,
  interactive = false,
  onOpenDetail,
}: {
  row?: DowntimeMachineRow | null;
  todayLabel?: string;
  periodLabel?: string;
  title?: string;
  interactive?: boolean;
  onOpenDetail?: () => void;
}) {
  const todaySec = row?.todaySec != null && Number.isFinite(Number(row.todaySec)) ? Number(row.todaySec) : 0;
  const periodSec =
    row?.periodSec != null && Number.isFinite(Number(row.periodSec)) ? Number(row.periodSec) : 0;
  const trendPct =
    row?.trendPct != null && Number.isFinite(Number(row.trendPct)) ? Number(row.trendPct) : null;
  const hasAny = todaySec > 0 || periodSec > 0;
  const tip =
    title ||
    `Operational downtime (Vendon Machine OFF / KNet OFF / Vendon OFF). Cleaning windows subtracted. ${todayLabel}: ${formatDowntimeSec(todaySec)}. ${periodLabel}: ${formatDowntimeSec(periodSec)}${
      trendPct != null ? `. vs ${periodLabel}: ${formatDowntimeTrendPct(trendPct)}` : ''
    }. Tap for events and estimated loss.`;

  const inner = (
    <>
      <div className={`salesStackBox salesStackBoxToday${todaySec > 0 ? '' : ' salesStackBoxMuted'}`}>
        <span className="salesStackLabel">{todayLabel}</span>
        <span className="salesStackVal">{hasAny || row ? formatDowntimeSec(todaySec) : '—'}</span>
        <DowntimeTrendLine trendPct={hasAny || row ? trendPct : null} />
      </div>
      <div className={`salesStackBox salesStackBoxYest${periodSec > 0 ? '' : ' salesStackBoxMuted'}`}>
        <span className="salesStackLabel">{periodLabel}</span>
        <span className="salesStackVal">{hasAny || row ? formatDowntimeSec(periodSec) : '—'}</span>
      </div>
    </>
  );

  const canOpen = interactive && Boolean(onOpenDetail);

  if (canOpen) {
    return (
      <button
        type="button"
        className="salesStack salesStackBtn"
        title={tip}
        {...bindStopRowClick(onOpenDetail)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="salesStack" title={tip}>
      {inner}
    </div>
  );
}
