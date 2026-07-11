import { AlertModalContactShimmer } from '@/components/AlertModalContactShimmer';
import { useMemo } from 'react';
import { OperatorContactIcons } from '@/components/OperatorContactIcons';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { mergeOperatorChannels } from '@/lib/mergeOperatorChannels';
import { useOperatorContact } from '@/lib/useOperatorContact';

export function OperatorContactSection({
  operatorName,
  strikeOperatorEmail,
  machineId,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  attendanceSummary,
  layout = 'table',
}: {
  operatorName?: string | null;
  strikeOperatorEmail?: string | null;
  machineId?: string;
  machineLabel?: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  attendanceSummary?: MachineAttendanceSummary;
  layout?: 'table' | 'modal';
}) {
  const wfName = String(attendanceSummary?.operatorName ?? '').trim();
  const snapName = String(operatorName ?? '').trim();
  const displayName =
    (wfName && wfName !== '—' ? wfName : null) ||
    (snapName && snapName !== '—' && snapName !== '…' ? snapName : null) ||
    'Operator';

  const email =
    String(strikeOperatorEmail ?? attendanceSummary?.operatorEmail ?? '').trim() || '';

  const contactQ = useOperatorContact({
    email: email || null,
    name: displayName !== 'Operator' ? displayName : null,
    machineId: machineId || null,
    enabled: Boolean(machineId || email || displayName !== 'Operator'),
  });

  const channels = useMemo(
    () =>
      mergeOperatorChannels({
        strikeEmail: email,
        displayName,
        machineId,
        slackEmailMap,
        slackTeamId,
        attendanceSummary,
        apiPayload: contactQ.data,
      }),
    [contactQ.data, displayName, email, machineId, slackEmailMap, slackTeamId, attendanceSummary],
  );

  const iconsOnly = layout === 'modal';

  return (
    <div className={`operatorContactSection${iconsOnly ? ' operatorContactSectionModal' : ''}`}>
      {!iconsOnly ? <p className="operatorContactSectionName">{displayName}</p> : null}
      {contactQ.isLoading ? (
        <AlertModalContactShimmer />
      ) : (
        <OperatorContactIcons
          layout={layout}
          iconsOnly={iconsOnly}
          channels={channels}
          machineLabel={machineLabel || displayName}
          slackEmailMap={slackEmailMap}
          slackTeamId={slackTeamId}
        />
      )}
    </div>
  );
}
