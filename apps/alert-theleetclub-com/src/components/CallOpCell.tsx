import { useMemo, useState } from 'react';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { getContactOperatorName, getMachineIdRaw, getStrikeOperatorEmail } from '@/features/redflags/redFlagsModel';
import { PersonContactModal } from '@/components/PersonContactModal';
import { RED_FLAGS_COLUMNS } from '@/features/redflags/redFlagsWorkbookColumns';
import { mergeOperatorChannels } from '@/lib/mergeOperatorChannels';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { useOperatorContact } from '@/lib/useOperatorContact';
import { bindStopRowClick } from '@/lib/stopRowClick';

export function CallOpCell({
  row,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  attendanceSummary,
}: {
  row: RedAlertRow;
  machineLabel: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  attendanceSummary?: MachineAttendanceSummary;
  workflowConfigured?: boolean;
  workflowLoaded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const machId = getMachineIdRaw(row);
  const workflowName = String(attendanceSummary?.operatorName ?? '').trim();
  const strikeEmail = getStrikeOperatorEmail(row) || attendanceSummary?.operatorEmail || null;

  const name = useMemo(() => {
    const fromRow = getContactOperatorName(row);
    if (workflowName && workflowName !== '—') return workflowName;
    if (fromRow && fromRow !== '—') return fromRow;
    return 'Operator';
  }, [workflowName, row]);

  const contactQ = useOperatorContact({
    email: strikeEmail,
    name: name !== 'Operator' ? name : null,
    machineId: machId,
    enabled: open && Boolean(machId || strikeEmail || (name !== 'Operator' && name)),
  });

  const channels = useMemo(
    () =>
      mergeOperatorChannels({
        strikeEmail,
        displayName: name,
        machineId: machId,
        slackEmailMap,
        slackTeamId,
        attendanceSummary,
        apiPayload: contactQ.data,
      }),
    [contactQ.data, strikeEmail, name, machId, slackEmailMap, slackTeamId, attendanceSummary],
  );

  const tip = [
    name !== 'Operator' ? name : null,
    RED_FLAGS_COLUMNS.callOp.placeholderNote ?? 'Tap for operator contact',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        type="button"
        className="linkGo linkGoStack"
        title={tip}
        {...bindStopRowClick(() => setOpen(true))}
      >
        <span className="linkGoLine">Call</span>
        <span className="linkGoLine linkGoLineStrong">OP</span>
      </button>
      {open ? (
        <PersonContactModal
          title={name}
          subtitle={machineLabel}
          eyebrow="Call operator"
          channels={channels}
          machineLabel={machineLabel}
          slackEmailMap={slackEmailMap}
          slackTeamId={slackTeamId}
          loading={contactQ.isLoading}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
