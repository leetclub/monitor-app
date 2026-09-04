import { formatKuwaitActivityStamp, formatKuwaitDateTime, formatRelativeAgo } from '@/lib/formatKuwait';

export type OperatorActivityTimes = {
  cleaningAt?: string | null;
  refillAt?: string | null;
  remoteCreditAt?: string | null;
  doorOpenAt?: string | null;
  latestAt?: string | null;
  physicalAttendance?: {
    at?: string | null;
    userName?: string | null;
    userType?: string | null;
    date?: string | null;
    proven?: boolean;
    status?: string | null;
    isToday?: boolean;
  } | null;
  /** Monitor proven presence for technician user_type only (Tech Visit). */
  technicianPhysicalAttendance?: {
    at?: string | null;
    userName?: string | null;
    userType?: string | null;
    date?: string | null;
    proven?: boolean;
    status?: string | null;
    isToday?: boolean;
  } | null;
};

type ActivityStampKey = 'refillAt' | 'remoteCreditAt' | 'doorOpenAt';

/** Operator Activity column kinds — Clean is NOT shown here (use Last clean column). */
const SOURCES: Array<{ key: ActivityStampKey; label: string; short: string }> = [
  { key: 'refillAt', label: 'Refill', short: 'Refill' },
  { key: 'remoteCreditAt', label: 'Remote credit', short: 'Credit' },
  { key: 'doorOpenAt', label: 'Door access', short: 'Door' },
];

function parseMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** Newest of refill / remote credit / door (or legacy WEB access). Cleaning is Last clean only. */
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

/** Kind + compact Kuwait stamp (`06 July 26 12:48`). */
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

  const stamp = formatKuwaitActivityStamp(latest.iso);
  const rel = formatRelativeAgo(latest.iso, nowMs);
  const full = formatKuwaitDateTime(latest.iso);

  return (
    <span
      className="operatorActivityCell"
      title={`Last operator activity (${latest.kind})${rel ? ` · ${rel}` : ''}: ${full}`}
    >
      <span className="operatorActivityKind">{latest.kindShort}</span>
      <span className="operatorActivityExact">{stamp}</span>
    </span>
  );
}
