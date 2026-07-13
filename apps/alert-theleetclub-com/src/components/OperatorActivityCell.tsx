import { formatKuwaitDateTime, formatRelativeAgo } from '@/lib/formatKuwait';

export type OperatorActivityTimes = {
  cleaningAt?: string | null;
  refillAt?: string | null;
  remoteCreditAt?: string | null;
  doorOpenAt?: string | null;
  latestAt?: string | null;
};

const SOURCES: Array<{ key: keyof OperatorActivityTimes; label: string }> = [
  { key: 'cleaningAt', label: 'Cleaning' },
  { key: 'refillAt', label: 'Refill' },
  { key: 'remoteCreditAt', label: 'Remote credit' },
  { key: 'doorOpenAt', label: 'Door access' },
];

function parseMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** Newest of cleaning / refill / remote credit / door (or legacy WEB access). */
export function resolveLatestOperatorActivity(
  activity?: OperatorActivityTimes | null,
  legacyWebAccessAt?: string | null,
): { iso: string; kind: string } | null {
  let bestIso = '';
  let bestMs = -1;
  let bestKind = 'Activity';

  const consider = (isoRaw: string | null | undefined, kind: string) => {
    const iso = isoRaw != null ? String(isoRaw).trim() : '';
    if (!iso) return;
    const ms = parseMs(iso);
    if (!Number.isFinite(ms)) return;
    if (ms >= bestMs) {
      bestMs = ms;
      bestIso = iso;
      bestKind = kind;
    }
  };

  for (const s of SOURCES) {
    consider(activity?.[s.key], s.label);
  }
  consider(legacyWebAccessAt, 'Remote credit');

  if (!bestIso) return null;
  return { iso: bestIso, kind: bestKind };
}

/** Single last operator touch: relative + Kuwait date. */
export function OperatorActivityCell({
  activity,
  legacyWebAccessAt,
  nowMs,
}: {
  activity?: OperatorActivityTimes | null;
  legacyWebAccessAt?: string | null;
  nowMs?: number;
}) {
  const latest = resolveLatestOperatorActivity(activity, legacyWebAccessAt);
  if (!latest) {
    return <span className="operatorActivityMuted">—</span>;
  }

  const rel = formatRelativeAgo(latest.iso, nowMs);
  const exact = formatKuwaitDateTime(latest.iso);

  return (
    <span
      className="operatorActivityCell"
      title={`Last operator activity (${latest.kind}): ${exact}`}
    >
      <span className="operatorActivityRel">{rel ?? '—'}</span>
      <span className="operatorActivityExact">{exact || '—'}</span>
    </span>
  );
}
