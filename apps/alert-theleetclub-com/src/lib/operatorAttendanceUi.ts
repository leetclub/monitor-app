import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';

export type AttendanceBadgeTone = 'late' | 'absent' | 'missing' | 'present' | 'pending';

export type AttendanceBadge = { label: string; tone: AttendanceBadgeTone };

/** Table badge under operator name — always show when workflow data is available. */
export function attendanceBadgeForSummary(
  summary?: MachineAttendanceSummary,
): AttendanceBadge | null {
  if (!summary) return { label: 'Missing', tone: 'missing' };

  const st = String(summary.attendanceStatus ?? '').trim().toLowerCase();
  if (st === 'not_scheduled') return { label: 'Missing', tone: 'missing' };

  const pill = summary.pill;
  if (pill?.label) {
    const pl = String(pill.label).trim();
    if (pill.color === 'r' || /^absent$/i.test(pl)) return { label: 'Absent', tone: 'absent' };
    if (pill.color === 'y' || /^late$/i.test(pl)) return { label: 'Late', tone: 'late' };
    if (/^missing$/i.test(pl) || /^not scheduled$/i.test(pl)) return { label: 'Missing', tone: 'missing' };
    if (pill.color === 'g') return { label: pl, tone: 'present' };
    if (pill.color === 'o') {
      if (/^pending$/i.test(pl)) return { label: 'Pending', tone: 'pending' };
      return { label: pl, tone: 'pending' };
    }
    return { label: pl, tone: 'present' };
  }

  if (st === 'absent') return { label: 'Absent', tone: 'absent' };
  if (st === 'present' || summary.present === true) return { label: 'Present', tone: 'present' };
  if (st === 'pending') return { label: 'Pending', tone: 'pending' };

  const statusLabel = String(summary.attendanceStatusLabel ?? '').trim();
  if (/^late$/i.test(statusLabel)) return { label: 'Late', tone: 'late' };
  if (/^absent$/i.test(statusLabel)) return { label: 'Absent', tone: 'absent' };
  if (/^present$/i.test(statusLabel)) return { label: 'Present', tone: 'present' };
  if (/^pending$/i.test(statusLabel)) return { label: 'Pending', tone: 'pending' };
  if (/missing|not scheduled/i.test(statusLabel)) return { label: 'Missing', tone: 'missing' };
  if (statusLabel) return { label: statusLabel, tone: 'present' };

  if (!String(summary.operatorName ?? '').trim()) {
    return { label: 'Missing', tone: 'missing' };
  }

  return { label: 'Present', tone: 'present' };
}
