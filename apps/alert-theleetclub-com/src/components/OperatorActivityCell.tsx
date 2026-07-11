import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { formatKuwaitDateTime, formatRelativeAgo } from '@/lib/formatKuwait';

export function OperatorActivityCell({
  row,
  nowMs,
}: {
  row: RedAlertRow;
  nowMs?: number;
}) {
  const iso = row.operatorLastAccessAt != null ? String(row.operatorLastAccessAt).trim() : '';
  if (!iso) {
    return <span className="operatorActivityMuted">—</span>;
  }
  const rel = formatRelativeAgo(iso, nowMs);
  const exact = formatKuwaitDateTime(iso);
  return (
    <span className="operatorActivityCell" title={`Last operator WEB open (door access): ${exact}`}>
      <span className="operatorActivityRel">{rel ?? '—'}</span>
      <span className="operatorActivityExact">{exact}</span>
    </span>
  );
}
