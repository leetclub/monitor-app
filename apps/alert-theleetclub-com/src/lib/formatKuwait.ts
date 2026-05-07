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
