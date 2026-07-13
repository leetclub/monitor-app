import { formatKuwaitDateTime, formatRelativeAgo } from '@/lib/formatKuwait';

export type OperatorActivityTimes = {
  cleaningAt?: string | null;
  refillAt?: string | null;
  remoteCreditAt?: string | null;
  doorOpenAt?: string | null;
  latestAt?: string | null;
};

const SOURCES: Array<{ key: keyof OperatorActivityTimes; label: string; short: string }> = [
  { key: 'cleaningAt', label: 'Cleaning', short: 'Clean' },
  { key: 'refillAt', label: 'Refill', short: 'Refill' },
  { key: 'remoteCreditAt', label: 'Remote credit', short: 'Credit' },
  { key: 'doorOpenAt', label: 'Door access', short: 'Door' },
];

function parseMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** Newest of cleaning / refill / remote credit / door (or legacy WEB access). */
export function resolveLatestOperatorActivity(
  activity?: OperatorActivityTimes | null,
  legacyWebAccessAt?: string | null,
): { iso: string; kind: string; kindShort: string } | null {
  let bestIso = '';
  let bestMs = -1;
  let bestKind = 'Activity';
  let bestShort = 'Activity';

  const consider = (isoRaw: string | null | undefined, kind: string, kindShort: string) => {
    const iso = isoRaw != null ? String(isoRaw).trim() : '';
    if (!iso) return;
    const ms = parseMs(iso);
    if (!Number.isFinite(ms)) return;
    if (ms >= bestMs) {
      bestMs = ms;
      bestIso = iso;
      bestKind = kind;
      bestShort = kindShort;
    }
  };

  for (const s of SOURCES) {
    consider(activity?.[s.key], s.label, s.short);
  }
  consider(legacyWebAccessAt, 'Remote credit', 'Credit');

  if (!bestIso) return null;
  return { iso: bestIso, kind: bestKind, kindShort: bestShort };
}

/** Last operator touch: kind + relative time + Kuwait date (kind is visible, not hover-only). */
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
      <span className="operatorActivityKind">{latest.kindShort}</span>
      <span className="operatorActivityRel">{rel ?? '—'}</span>
      <span className="operatorActivityExact">{exact || '—'}</span>
    </span>
  );
}
