import { formatDowntimeSec, type DowntimeMachineRow } from '@/lib/downtimeDisplay';
import { bindStopRowClick } from '@/lib/stopRowClick';

/**
 * Two-box downtime stack: Today + compare baseline (e.g. Yesterday).
 * Reuses salesStack layout so cell height matches Sales / Target columns.
 * Tap opens event list + estimated KD loss modal.
 */
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
  const hasAny = todaySec > 0 || periodSec > 0;
  const tip =
    title ||
    `Operational downtime (Vendon Machine OFF / KNet OFF / Vendon OFF). Cleaning windows subtracted. ${todayLabel}: ${formatDowntimeSec(todaySec)}. ${periodLabel}: ${formatDowntimeSec(periodSec)}. Tap for events and estimated loss.`;

  const inner = (
    <>
      <div className={`salesStackBox salesStackBoxToday${todaySec > 0 ? '' : ' salesStackBoxMuted'}`}>
        <span className="salesStackLabel">{todayLabel}</span>
        <span className="salesStackVal">{hasAny || row ? formatDowntimeSec(todaySec) : '—'}</span>
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
