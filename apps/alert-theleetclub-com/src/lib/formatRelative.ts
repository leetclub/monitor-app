/** Compact relative time for operator last-access and QA visits. */
function parseIsoMs(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return NaN;
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(s);
}

export function formatRelativeKuwait(iso: string | null | undefined, nowMs = Date.now()): string {
  const ms = parseIsoMs(String(iso || ''));
  if (!Number.isFinite(ms)) return '—';
  const diffSec = Math.round((nowMs - ms) / 1000);
  if (diffSec < 0) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kuwait',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '—';
  }
}
