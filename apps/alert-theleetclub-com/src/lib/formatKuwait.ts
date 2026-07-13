/** Kuwait wall clock for ISO-ish timestamps (parity with Red Flags formatting). */

function parseTimestampMs(raw: string): number {
  const s = String(raw).trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return NaN;
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** Two-line cleaning cell: date row + compact time (no seconds). */
export function formatKuwaitCleaningWhen(iso: string | null | undefined): { date: string; time: string } | null {
  const ms = parseTimestampMs(String(iso ?? ''));
  if (Number.isNaN(ms)) return null;
  try {
    const d = new Date(ms);
    const date = d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kuwait',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const time =
      d.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kuwait',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' KWT';
    return { date, time };
  } catch {
    return null;
  }
}

export function formatKuwaitDateTime(iso: string | null | undefined): string {
  const ms = parseTimestampMs(String(iso ?? ''));
  if (Number.isNaN(ms)) return iso ? String(iso) : '—';
  try {
    return (
      new Date(ms).toLocaleString('en-GB', {
        timeZone: 'Asia/Kuwait',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' KWT'
    );
  } catch {
    return String(iso);
  }
}

/** Compact Op. activity stamp: `06 July 26 12:48` (Kuwait). */
export function formatKuwaitActivityStamp(iso: string | null | undefined): string {
  const ms = parseTimestampMs(String(iso ?? ''));
  if (Number.isNaN(ms)) return iso ? String(iso) : '—';
  try {
    const d = new Date(ms);
    const day = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kuwait', day: '2-digit' });
    const month = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kuwait', month: 'long' });
    const year = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kuwait', year: '2-digit' });
    const time = d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kuwait',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${day} ${month} ${year} ${time}`;
  } catch {
    return String(iso);
  }
}

/** Relative time for operator last machine access (e.g. "5 min ago"). */
export function formatRelativeAgo(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  const ms = parseTimestampMs(String(iso ?? ''));
  if (Number.isNaN(ms)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return m === 1 ? '1 min ago' : `${m} min ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return h === 1 ? '1 hr ago' : `${h} hr ago`;
  }
  const d = Math.floor(diffSec / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
