import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OperatorAttendanceModal } from '@/components/OperatorAttendanceModal';
import {
  fetchOperatorSchedule,
  type MachineAttendanceSummary,
} from '@/lib/leetWorkflowApi';
import { bindStopRowClick } from '@/lib/stopRowClick';

function pillClass(color: 'g' | 'y' | 'o' | 'r' | undefined): string {
  if (color === 'g') return 'pillSuccess';
  if (color === 'y' || color === 'o') return 'pillWarn';
  if (color === 'r') return 'pillDanger';
  return 'opsCellMuted';
}

export function AttendanceWorkflowCell({
  machineId,
  machineName,
  summary,
  workflowConfigured,
  compact = false,
}: {
  machineId: string;
  machineName: string;
  summary?: MachineAttendanceSummary;
  workflowConfigured?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailQ = useQuery({
    queryKey: ['leet-workflow-operator-schedule', machineId],
    queryFn: () => fetchOperatorSchedule(machineId),
    enabled: open && Boolean(machineId),
    staleTime: 60_000,
  });

  if (!workflowConfigured) {
    return <span className="opsCellMuted">—</span>;
  }

  const pill = summary?.pill;
  const label =
    pill?.label ||
    summary?.attendanceStatusLabel ||
    (summary?.attendanceStatus === 'not_scheduled' ? 'Off' : null);

  if (!label) {
    return <span className="opsCellMuted">—</span>;
  }

  const tip = [
    summary?.operatorName ? `Operator: ${summary.operatorName}` : null,
    summary?.attendanceStatusLabel || summary?.attendanceStatus,
    summary?.state ? `State: ${summary.state}` : null,
    'Tap for schedule + MTD detail',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        type="button"
        className={`attendanceWorkflowBtn ${compact ? 'attendanceWorkflowBtnCompact' : ''} ${pillClass(pill?.color)}`}
        title={tip}
        style={compact ? undefined : { fontSize: '0.78rem' }}
        {...bindStopRowClick(() => setOpen(true))}
      >
        {label}
      </button>
      {open ? (
        <OperatorAttendanceModal
          machineName={machineName}
          machineId={machineId}
          data={detailQ.data}
          loading={detailQ.isLoading}
          error={detailQ.error ? String(detailQ.error) : detailQ.data?.error ?? null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
