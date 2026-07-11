import { formatKwd } from '@/lib/salesDisplay';
import { bindStopRowClick } from '@/lib/stopRowClick';
import { resolveAreaManagerFromMachineName } from '@/data/operatorAreaPlan';
import { ownerCardFirstName, resolveLocationOwnerName } from '@/lib/targetDisplay';

export function TargetElapsedStack({
  todayKwd,
  dailyTargetKd,
  machineName,
  areaOwnerName,
  vendonOwnerName,
  primaryLabel = 'Today',
  primaryLabelTitle,
  title,
  interactive = false,
  onOpenDetail,
}: {
  todayKwd?: number;
  dailyTargetKd?: number | null;
  machineName?: string;
  areaOwnerName?: string | null;
  vendonOwnerName?: string | null;
  primaryLabel?: string;
  /** Full period name for tooltip when primaryLabel is abbreviated. */
  primaryLabelTitle?: string;
  title?: string;
  interactive?: boolean;
  onOpenDetail?: () => void;
}) {
  const target = dailyTargetKd != null ? Number(dailyTargetKd) : NaN;
  const today = todayKwd != null ? Number(todayKwd) : NaN;
  const hasTarget = Number.isFinite(target) && target > 0;
  const hasToday = Number.isFinite(today);
  const pct = hasTarget && hasToday ? Math.round((today / target) * 100) : null;
  const remaining = hasTarget && hasToday ? Math.max(0, target - today) : null;
  const leftFormatted = remaining != null ? formatKwd(remaining) : null;
  const todayFormatted = hasToday ? formatKwd(today) : null;
  const targetFormatted = hasTarget ? formatKwd(target) : null;
  const todayTone =
    pct != null && pct >= 100 ? 'salesStackBoxUp' : pct != null ? 'salesStackBoxDown' : '';
  const am = resolveAreaManagerFromMachineName(machineName || '');
  const amLabel = am === 'suhaib' ? 'Suhaib' : am === 'ahmed' ? 'Ahmed' : null;
  const ownerFull = resolveLocationOwnerName(areaOwnerName, vendonOwnerName, amLabel);
  const ownerCard = ownerFull ? ownerCardFirstName(ownerFull) : null;

  const stackTitle = [
    title,
    pct != null ? `${primaryLabel} ${pct}% of target` : null,
    todayFormatted ? `Sales ${todayFormatted}` : null,
    leftFormatted ? `Left ${leftFormatted}` : null,
    targetFormatted ? `Target ${targetFormatted}` : null,
    ownerFull ? `Owner ${ownerFull}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const inner = (
    <>
      <div className={`salesStackBox salesStackBoxToday ${todayTone}`.trim()}>
        <span className="salesStackLabel" title={primaryLabelTitle ?? primaryLabel}>
          {primaryLabel}
        </span>
        <span className="salesStackVal">{pct != null ? `${pct}%` : '—'}</span>
        {todayFormatted ? (
          <span className="salesStackSub" title={`From ${todayFormatted} sales`}>
            {todayFormatted}
          </span>
        ) : null}
      </div>
      <div className="salesStackBox salesStackBoxYest">
        <span className="salesStackLabel">Left</span>
        <span
          className="salesStackVal salesStackValLeft"
          title={leftFormatted ?? undefined}
        >
          {leftFormatted ?? '—'}
        </span>
        {targetFormatted ? (
          <span className="salesStackSub" title={`Of ${targetFormatted} target`}>
            of {targetFormatted}
          </span>
        ) : null}
      </div>
      <div
        className="salesStackBox salesStackBoxOwner"
        title={ownerFull ? `Area owner: ${ownerFull}` : 'Area owner'}
      >
        <span className="salesStackLabel">Owner</span>
        <span className="salesStackVal salesStackValOwner" title={ownerFull ?? undefined}>
          {ownerCard || '—'}
        </span>
      </div>
    </>
  );

  if (interactive && onOpenDetail && hasTarget) {
    return (
      <button
        type="button"
        className="salesStack salesStackBtn salesStackTarget"
        title={stackTitle || title}
        {...bindStopRowClick(onOpenDetail)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="salesStack salesStackTarget" title={stackTitle || title}>
      {inner}
    </div>
  );
}
