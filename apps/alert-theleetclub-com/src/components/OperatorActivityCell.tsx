import { formatKuwaitDateTime, formatRelativeAgo } from '@/lib/formatKuwait';

export type OperatorActivityTimes = {
  cleaningAt?: string | null;
  refillAt?: string | null;
  remoteCreditAt?: string | null;
  doorOpenAt?: string | null;
  latestAt?: string | null;
};

const LINES: Array<{ key: keyof OperatorActivityTimes; label: string; title: string }> = [
  {
    key: 'cleaningAt',
    label: 'Clean',
    title: 'Last daily cleaning end (Monitor Attendance & Cleaning — power-interrupt pattern)',
  },
  {
    key: 'refillAt',
    label: 'Refill',
    title: 'Last All Products refilled (Vendon event)',
  },
  {
    key: 'remoteCreditAt',
    label: 'Credit',
    title: 'Last proven remote credit (Monitor attendance: credit + power proof)',
  },
  {
    key: 'doorOpenAt',
    label: 'Door',
    title: 'Last door opened (Vendon door event)',
  },
];

function lineIso(activity: OperatorActivityTimes | null | undefined, key: keyof OperatorActivityTimes): string {
  const raw = activity?.[key];
  return raw != null ? String(raw).trim() : '';
}

/** Four last-touch lines: cleaning, refill, remote credit, door access. */
export function OperatorActivityCell({
  activity,
  /** @deprecated Prefer `activity.doorOpenAt` / full map — kept for older snapshot-only callers. */
  legacyWebAccessAt,
  nowMs,
}: {
  activity?: OperatorActivityTimes | null;
  legacyWebAccessAt?: string | null;
  nowMs?: number;
}) {
  const merged: OperatorActivityTimes = {
    ...(activity || {}),
  };
  // Until activity API loads, fall back WEB cashless timestamp only into Credit if empty.
  if (!lineIso(merged, 'remoteCreditAt') && legacyWebAccessAt) {
    merged.remoteCreditAt = String(legacyWebAccessAt).trim();
  }

  const any = LINES.some((l) => lineIso(merged, l.key));
  if (!any) {
    return <span className="operatorActivityMuted">—</span>;
  }

  return (
    <div className="operatorActivityStack" title="Operator activity (Monitor / Vendon)">
      {LINES.map((line) => {
        const iso = lineIso(merged, line.key);
        const rel = iso ? formatRelativeAgo(iso, nowMs) : null;
        const exact = iso ? formatKuwaitDateTime(iso) : '';
        return (
          <div
            key={line.key}
            className={`operatorActivityLine${iso ? '' : ' operatorActivityLine--empty'}`}
            title={iso ? `${line.title}: ${exact}` : line.title}
          >
            <span className="operatorActivityTag">{line.label}</span>
            <span className="operatorActivityRel">{iso ? rel || '—' : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}
