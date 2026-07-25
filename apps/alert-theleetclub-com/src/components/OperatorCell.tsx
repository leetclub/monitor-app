import { useMemo, useState } from 'react';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { getMachineIdRaw, getStrikeOperatorEmail } from '@/features/redflags/redFlagsModel';
import { OperatorWorkflowModal } from '@/components/OperatorWorkflowModal';
import { operatorChannelsFromApi, resolveOperatorContacts } from '@/lib/operatorContacts';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { useOperatorContact } from '@/lib/useOperatorContact';
import { bindStopRowClick } from '@/lib/stopRowClick';
import { attendanceBadgeForSummary } from '@/lib/operatorAttendanceUi';
import type { OperatorActivityTimes } from '@/components/OperatorActivityCell';

export function OperatorCell({
  row,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  attendanceSummary,
  workflowConfigured,
  workflowLoaded,
  operatorActivity,
}: {
  row: RedAlertRow;
  machineLabel: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  attendanceSummary?: MachineAttendanceSummary;
  workflowConfigured?: boolean;
  /** True once workflow attendance batch has settled — avoids snapshot name flash. */
  workflowLoaded?: boolean;
  operatorActivity?: OperatorActivityTimes | null;
}) {
  const [open, setOpen] = useState(false);
  const machId = getMachineIdRaw(row);
  const workflowName = String(attendanceSummary?.operatorName ?? '').trim();
  const strikeEmail = getStrikeOperatorEmail(row) || attendanceSummary?.operatorEmail || null;

  const displayName = useMemo(() => {
    if (workflowConfigured) {
      if (!workflowLoaded) return '…';
      if (workflowName) return workflowName;
      return '—';
    }
    const snap = String(row.operator ?? row.redAlertOperator ?? row.operatorName ?? '').trim();
    return snap || '—';
  }, [workflowConfigured, workflowLoaded, workflowName, row]);

  const workflowChannels = useMemo(
    () =>
      operatorChannelsFromApi({
        email: attendanceSummary?.operatorEmail,
        phone: attendanceSummary?.operatorPhone,
        whatsappUrl: attendanceSummary?.operatorWhatsappUrl,
        slackDmUrl: attendanceSummary?.operatorSlackDmUrl,
      }),
    [attendanceSummary],
  );

  const contactQ = useOperatorContact({
    email: strikeEmail,
    name: displayName !== '—' && displayName !== '…' ? displayName : null,
    machineId: machId,
    enabled: open && Boolean(machId) && (!workflowChannels.email || !workflowChannels.phone),
  });

  const channels = useMemo(() => {
    const base = resolveOperatorContacts(strikeEmail, displayName !== '—' ? displayName : null, {
      slackEmailMap,
      slackTeamId,
    });
    const merged = {
      ...base,
      ...workflowChannels,
      email: workflowChannels.email ?? base.email,
      phone: workflowChannels.phone ?? base.phone,
      whatsapp: workflowChannels.whatsapp ?? base.whatsapp,
      slackDmUrl: workflowChannels.slackDmUrl ?? base.slackDmUrl,
      slackAppUrl: workflowChannels.slackAppUrl ?? base.slackAppUrl,
    };
    if (contactQ.data && !contactQ.data.error) {
      const fromApi = operatorChannelsFromApi(contactQ.data);
      return {
        ...merged,
        ...fromApi,
        email: fromApi.email ?? merged.email,
        phone: fromApi.phone ?? merged.phone,
      };
    }
    return merged;
  }, [contactQ.data, strikeEmail, displayName, slackEmailMap, slackTeamId, workflowChannels]);

  const badge = workflowConfigured && workflowLoaded ? attendanceBadgeForSummary(attendanceSummary) : null;

  const tip = [
    displayName !== '—' && displayName !== '…' ? displayName : null,
    badge ? badge.label : null,
    'Tap for schedule + contact',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="operatorCell">
      <button
        type="button"
        className={`operatorCellBtn${badge ? ` operatorCellBtn--${badge.tone}` : ''}`}
        title={tip}
        {...bindStopRowClick(() => setOpen(true))}
      >
        <div className="operatorCellNameBox salesStackBox">
          <span className="operatorCellNameVal">{displayName}</span>
        </div>
        {badge ? (
          <span className={`operatorAttBadge operatorAttBadge--${badge.tone}`}>{badge.label}</span>
        ) : null}
      </button>
      {open ? (
        <OperatorWorkflowModal
          operatorName={displayName}
          machineLabel={machineLabel}
          machineId={machId}
          strikeOperatorEmail={strikeEmail}
          attendanceSummary={attendanceSummary}
          workflowConfigured={workflowConfigured}
          operatorActivity={operatorActivity}
          channels={channels}
          apiMeta={contactQ.data}
          contactLoading={contactQ.isLoading}
          slackEmailMap={slackEmailMap}
          slackTeamId={slackTeamId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
