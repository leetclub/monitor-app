/** Kuwait calendar comparisons + Alert Admin cleaning windows (aligned with Overall tab). */

function parseTimeToMinutes(hhmm: string): number | null {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function cleaningWindowsFromAdmin(raw: unknown): { startMin: number; endMin: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { startMin: number; endMin: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const s = parseTimeToMinutes(String(o.start ?? ''));
    const e = parseTimeToMinutes(String(o.end ?? ''));
    if (s == null || e == null) continue;
    out.push({ startMin: s, endMin: e });
  }
  return out;
}

export function kuwaitDateKey(iso: string): string {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

export function kuwaitMinutesOfDay(iso: string): number | null {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

export function lastCleanedStatus(params: {
  lastCleaningIso: string;
  cleaningWindows: { startMin: number; endMin: number }[];
}): { label: string; color: 'g' | 'y' | 'r' } {
  const { lastCleaningIso, cleaningWindows } = params;
  const day = kuwaitDateKey(lastCleaningIso);
  const today = kuwaitDateKey(new Date().toISOString());
  if (!day || day !== today) return { label: 'Not today', color: 'r' };
  const t = kuwaitMinutesOfDay(lastCleaningIso);
  if (t == null) return { label: 'Today', color: 'y' };
  if (!cleaningWindows.length) return { label: 'Today', color: 'y' };
  const inside = cleaningWindows.some((w) => t >= w.startMin && t <= w.endMin);
  return inside ? { label: 'On schedule', color: 'g' } : { label: 'Off schedule', color: 'y' };
}

export function cleaningStatusTitle(
  iso: string,
  status: { label: string; color: 'g' | 'y' | 'r' },
): string {
  const when = kuwaitDateKey(iso);
  const today = kuwaitDateKey(new Date().toISOString());
  if (when && when !== today) {
    return `Last clean ${when} (Kuwait). Status: no clean recorded for today (${today}).`;
  }
  return `Last clean today (${when || 'Kuwait'}). Status: ${status.label}.`;
}

export type NextCleaningEta = {
  /** Short UI label, e.g. "Next in 3h", "Tomorrow", "Now (window)". */
  label: string;
  /** Whole days until next window start (0 = today). */
  daysLeft: number;
  /** Hours until next window start (fractional ok). */
  hoursLeft: number;
  nextStartIso?: string;
};

/** Next Admin cleaning-window start in Kuwait (today remaining, else tomorrow’s first). */
export function nextCleaningEta(
  cleaningWindows: { startMin: number; endMin: number }[],
  now: Date = new Date(),
): NextCleaningEta | null {
  if (!cleaningWindows.length) return null;
  const sorted = cleaningWindows
    .filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin))
    .slice()
    .sort((a, b) => a.startMin - b.startMin);
  if (!sorted.length) return null;

  const nowMin = kuwaitMinutesOfDay(now.toISOString());
  if (nowMin == null) return null;

  const inWindow = sorted.some((w) => nowMin >= w.startMin && nowMin <= w.endMin);
  if (inWindow) {
    return { label: 'Window now', daysLeft: 0, hoursLeft: 0 };
  }

  const laterToday = sorted.find((w) => w.startMin > nowMin);
  if (laterToday) {
    const hoursLeft = (laterToday.startMin - nowMin) / 60;
    const daysLeft = 0;
    const label =
      hoursLeft < 1
        ? `Next in ${Math.max(1, Math.round(hoursLeft * 60))}m`
        : `Next in ${hoursLeft < 10 ? hoursLeft.toFixed(1) : Math.round(hoursLeft)}h`;
    return { label, daysLeft, hoursLeft };
  }

  // Next is tomorrow’s first window
  const first = sorted[0];
  const hoursLeft = (24 * 60 - nowMin + first.startMin) / 60;
  const daysLeft = hoursLeft >= 24 ? Math.floor(hoursLeft / 24) : 0;
  const label = daysLeft >= 1 ? `Next in ${daysLeft}d` : `Tomorrow · ${Math.round(hoursLeft)}h`;
  return { label, daysLeft: Math.max(1, daysLeft || 1), hoursLeft };
}
