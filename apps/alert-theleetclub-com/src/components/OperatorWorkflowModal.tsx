import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { OperatorContactIcons } from '@/components/OperatorContactIcons';
import { resolveOperatorContacts } from '@/lib/operatorContacts';
import { fetchOperatorSchedule, workflowNotConfiguredMessage, type MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import { attendanceBadgeForSummary } from '@/lib/operatorAttendanceUi';
import type { OperatorContactChannels } from '@/lib/operatorContacts';
import type { OperatorActivityTimes } from '@/components/OperatorActivityCell';

function pillClass(tone: string | undefined): string {
  if (tone === 'present') return 'pillSuccess';
  if (tone === 'late') return 'pillWarn';
  if (tone === 'absent') return 'pillDanger';
  if (tone === 'pending') return 'pillWarn';
  if (tone === 'missing') return 'opsCellMuted';
  return 'opsCellMuted';
}

function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').replace('Z', '').slice(0, 16);
}

export function OperatorWorkflowModal({
  operatorName,
  machineLabel,
  machineId,
  strikeOperatorEmail,
  attendanceSummary,
  workflowConfigured,
  operatorActivity,
  channels,
  contactLoading,
  slackEmailMap,
  slackTeamId,
  onClose,
}: {
  operatorName: string;
  machineLabel: string;
  machineId: string;
  strikeOperatorEmail?: string | null;
  attendanceSummary?: MachineAttendanceSummary;
  workflowConfigured?: boolean;
  /** Monitor Attendance physical presence (proven remote credit + power). */
  operatorActivity?: OperatorActivityTimes | null;
  channels: OperatorContactChannels;
  apiMeta?: unknown;
  contactLoading?: boolean;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  onClose: () => void;
}) {
  useAlertModal(onClose);

  const scheduleQ = useQuery({
    queryKey: ['leet-workflow-operator-schedule', machineId],
    queryFn: () => fetchOperatorSchedule(machineId),
    enabled: Boolean(machineId) && workflowConfigured !== false,
    staleTime: 60_000,
  });

  const schedule = scheduleQ.data;
  const notConfigured = workflowNotConfiguredMessage(schedule);
  const displayName =
    (operatorName && operatorName !== '—' && operatorName !== '…' ? operatorName : null) ||
    schedule?.operatorName ||
    attendanceSummary?.operatorName ||
    '—';

  const resolvedChannels = useMemo(() => {
    const base = resolveOperatorContacts(strikeOperatorEmail, displayName, { slackEmailMap, slackTeamId });
    return { ...base, ...channels, email: channels.email ?? base.email, phone: channels.phone ?? base.phone };
  }, [channels, displayName, slackEmailMap, slackTeamId, strikeOperatorEmail]);

  const badge = attendanceBadgeForSummary(attendanceSummary);
  const attendanceLabel =
    badge?.label ||
    schedule?.attendanceStatusLabel ||
    attendanceSummary?.attendanceStatusLabel ||
    (attendanceSummary?.attendanceStatus === 'not_scheduled' ? 'Missing' : null);

  const physical = operatorActivity?.physicalAttendance;
  const physicalAt = physical?.at || operatorActivity?.remoteCreditAt || null;

  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal operatorWorkflowModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Operator · Leet Workflow schedule</p>
            <h2 className="salesHistoryTitle">{displayName}</h2>
            <p className="salesHistorySub">
              {machineLabel} · #{machineId}
            </p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {contactLoading ? <AlertModalAnticipate hint="Contact channels incoming" lines={3} /> : (
          <OperatorContactIcons
            layout="modal"
            iconsOnly
            channels={resolvedChannels}
            machineLabel={machineLabel}
            slackEmailMap={slackEmailMap}
            slackTeamId={slackTeamId}
          />
        )}

        <section className="operatorWorkflowSection">
          <h3 className="salesHistoryCompareTitle">Today · attendance</h3>
          {workflowConfigured === false ? (
            <p className="salesHistoryEmpty">Workflow not configured</p>
          ) : scheduleQ.isLoading ? (
            <AlertModalAnticipate hint="Schedule incoming" lines={4} />
          ) : notConfigured ? (
            <p className="salesHistoryEmpty">{notConfigured}</p>
          ) : scheduleQ.error ? (
            <p className="stitchOpsAlert">{String(scheduleQ.error)}</p>
          ) : schedule ? (
            <div className="alertModalContentReveal">
              {schedule.schedulePeriodName ? (
                <p className="salesHistoryNote">Schedule period: {schedule.schedulePeriodName}</p>
              ) : null}
              <p className="salesHistoryNote">
                Status:{' '}
                <span className={pillClass(badge?.tone)}>
                  {attendanceLabel || '—'}
                </span>
                {schedule.state ? ` · ${schedule.state}` : ''}
              </p>
              {schedule.todayClockIn ? (
                <p className="salesHistoryNote">
                  Clock in: {String(schedule.todayClockIn).replace('T', ' ').slice(0, 16)}
                  {schedule.todayClockOut
                    ? ` · out ${String(schedule.todayClockOut).replace('T', ' ').slice(0, 16)}`
                    : ''}
                </p>
              ) : null}
              <ul className="salesHistoryList">
                <li className="salesHistoryRow">
                  <span className="salesHistoryCompareTitle">Days absent MTD</span>
                  <span className="salesHistoryGridVal">{schedule.absentDaysMtd ?? '—'}</span>
                </li>
                <li className="salesHistoryRow">
                  <span className="salesHistoryCompareTitle">Days late MTD</span>
                  <span className="salesHistoryGridVal">{schedule.lateDaysMtd ?? '—'}</span>
                </li>
                {schedule.machineInCharge ? (
                  <li className="salesHistoryRow">
                    <span className="salesHistoryCompareTitle">Machine in-charge</span>
                    <span className="salesHistoryGridVal">{schedule.machineInCharge}</span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : attendanceLabel ? (
            <p className="salesHistoryNote">
              Status: <span className={pillClass(badge?.tone)}>{attendanceLabel}</span>
            </p>
          ) : (
            <p className="salesHistoryEmpty">No schedule for this machine today</p>
          )}
        </section>

        <section className="operatorWorkflowSection">
          <h3 className="salesHistoryCompareTitle">Monitor · physical location</h3>
          <p className="salesHistoryNote" style={{ opacity: 0.85, fontSize: '0.78rem' }}>
            Proven presence from Attendance &amp; Cleaning (successful remote credit + power interrupts). Separate from
            Task Manager clock-in above.
          </p>
          {physicalAt ? (
            <div className="alertModalContentReveal">
              <p className="salesHistoryNote">
                Status:{' '}
                <span className={physical?.proven !== false ? 'pillSuccess' : 'pillWarn'}>
                  {physical?.proven !== false ? 'Proven on site' : 'Unconfirmed'}
                </span>
                {physical?.isToday ? ' · today' : physical?.date ? ` · ${physical.date}` : ''}
              </p>
              {physical?.userName ? (
                <p className="salesHistoryNote">
                  Person: {physical.userName}
                  {physical.userType ? ` (${physical.userType})` : ''}
                </p>
              ) : null}
              <p className="salesHistoryNote">Proven at: {formatIsoShort(physicalAt)}</p>
            </div>
          ) : (
            <p className="salesHistoryEmpty">No proven physical attendance in the recent Attendance cache</p>
          )}
        </section>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
