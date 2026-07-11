import { useState } from 'react';
import { formatKuwaitCleaningWhen, formatKuwaitDateTime } from '@/lib/formatKuwait';
import { cleaningStatusTitle, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { CleaningWorkflowModal } from '@/components/CleaningWorkflowModal';
import { CleaningAlertModal } from '@/components/CleaningAlertModal';
import { bindStopRowClick } from '@/lib/stopRowClick';
import { useQuery } from '@tanstack/react-query';
import {
  fetchCleaningWorkflow,
  type CleaningWorkflowPayload,
  type MachineAttendanceSummary,
} from '@/lib/leetWorkflowApi';
import { RED_FLAGS_COLUMNS } from '@/features/redflags/redFlagsWorkbookColumns';
import '@/styles/cleaning-alert-modal.css';

type CleaningStatus = ReturnType<typeof lastCleanedStatus>;

const EMPTY_CLEAN_TIP =
  'No last clean on Workflow, Red Alert snapshot, or Live Dashboard for this machine.';

function CleaningAlertAppIcon() {
  return (
    <svg className="cleaningAlertAppIcon" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1v-1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2Zm0 4a5 5 0 0 0-5 5v1h10v-1a5 5 0 0 0-5-5Zm-4 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
    </svg>
  );
}

function cleaningCellCcClass(ccVerified: boolean | null | undefined): string {
  if (ccVerified === true) return ' cleaningCell--ccVerified';
  if (ccVerified === false) return ' cleaningCell--ccPending';
  return '';
}

function CcStatusDot({ verified }: { verified: boolean | null | undefined }) {
  if (verified === true) {
    return (
      <span
        className="cleaningCcDot cleaningCcDot--verified"
        title="Command Center verified on Workflow"
        aria-hidden
      />
    );
  }
  if (verified === false) {
    return (
      <span
        className="cleaningCcDot cleaningCcDot--pending"
        title="Uploaded on Workflow — pending Command Center check"
        aria-hidden
      />
    );
  }
  return null;
}

export function CleaningStatusCell({
  iso,
  status,
  title,
  machineId,
  machineName,
  cleaningOverdue15h,
  hoursSinceCleaning,
  operatorName,
  strikeOperatorEmail,
  workflowAttendance,
  workflowCleaning,
  slackEmailMap,
  slackTeamId,
}: {
  iso: string;
  status: CleaningStatus | null;
  title?: string;
  machineId?: string;
  machineName?: string;
  cleaningOverdue15h?: boolean;
  hoursSinceCleaning?: number | null;
  operatorName?: string | null;
  strikeOperatorEmail?: string | null;
  workflowAttendance?: MachineAttendanceSummary;
  /** Pre-fetched Workflow cleaning (fleet map); avoids per-row API lag. */
  workflowCleaning?: CleaningWorkflowPayload | null;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
}) {
  const [openCleaning, setOpenCleaning] = useState(false);
  const [openAlert, setOpenAlert] = useState(false);
  const snapshotIso = String(iso || '').trim();
  const machId = String(machineId || '').trim();
  const overdue = Boolean(cleaningOverdue15h);
  const hasPrefetched = workflowCleaning !== undefined;
  const wfQ = useQuery({
    queryKey: ['leet-workflow-cleaning', machId],
    queryFn: () => fetchCleaningWorkflow(machId),
    enabled: Boolean(machId) && !hasPrefetched,
    staleTime: 5 * 60_000,
  });
  const wfData = hasPrefetched ? workflowCleaning ?? undefined : wfQ.data;
  const workflowIso = String(wfData?.lastCleaningAt || '').trim();
  const displayIso = workflowIso || snapshotIso;
  const ccVerified = wfData?.commandCenterVerified;
  const ccClass = cleaningCellCcClass(ccVerified);
  const ccPill =
    ccVerified === true
      ? { label: 'CC ✓', color: 'g' as const }
      : ccVerified === false
        ? { label: 'Pending CC', color: 'r' as const }
        : null;
  const modalQ = useQuery({
    queryKey: ['leet-workflow-cleaning-modal', machId],
    queryFn: () => fetchCleaningWorkflow(machId),
    enabled: openCleaning && Boolean(machId) && !hasPrefetched,
    staleTime: 5 * 60_000,
  });
  const wfLoading = !hasPrefetched && wfQ.isLoading;

  if (!displayIso) {
    if (machId && wfLoading) {
      return <span className="cleaningCellEmpty">…</span>;
    }
    return (
      <span className="cleaningCellEmpty" title={EMPTY_CLEAN_TIP}>
        —
      </span>
    );
  }

  const when = formatKuwaitCleaningWhen(displayIso);
  const ccTip =
    ccVerified === true
      ? 'Command Center verified on Workflow'
      : ccVerified === false
        ? 'Uploaded on Workflow — pending Command Center verification'
        : null;
  const tip =
    title ??
    ccTip ??
    RED_FLAGS_COLUMNS.lastCleaning.placeholderNote ??
    (status && !workflowIso ? cleaningStatusTitle(displayIso, status) : formatKuwaitDateTime(displayIso));

  const alertTip = overdue
    ? `Cleaning overdue (>15h) — tap bell for operator message preview (Slack, Email, WhatsApp, Workflow Received)`
    : undefined;

  const inner = (
    <>
      <div className="cleaningCellWhen">
        <CcStatusDot verified={ccVerified} />
        <div className="cleaningCellWhenText">
          {when ? (
            <>
              <span className="cleaningCellDate">{when.date}</span>
              <span className="cleaningCellTime">{when.time}</span>
            </>
          ) : (
            <span className="cleaningCellDate">{formatKuwaitDateTime(displayIso)}</span>
          )}
        </div>
      </div>
      {ccPill ? (
        <span className={`cleaningPill cleaningPill--${ccPill.color}`} aria-label={ccPill.label}>
          {ccPill.label}
        </span>
      ) : status ? (
        <span className={`cleaningPill cleaningPill--${status.color}`} aria-label={status.label}>
          {status.label}
        </span>
      ) : null}
    </>
  );

  const modalData = modalQ.data ?? wfData;

  if (machId) {
    return (
      <>
        <div className="cleaningCellBox">
          <button
            type="button"
            className={`cleaningCell cleaningCellBtn${ccClass}`}
            title={tip}
            {...bindStopRowClick(() => setOpenCleaning(true))}
          >
            {inner}
          </button>
          {overdue ? (
            <button
              type="button"
              className="cleaningAlertAppBtn cleaningAlertAppBtnOverlay"
              title={alertTip}
              aria-label="Preview cleaning alert message for operator"
              {...bindStopRowClick(() => setOpenAlert(true))}
            >
              <CleaningAlertAppIcon />
            </button>
          ) : null}
        </div>
        {openCleaning ? (
          <CleaningWorkflowModal
            machineName={machineName || machId}
            machineId={machId}
            fallbackIso={snapshotIso || displayIso}
            data={modalData}
            loading={!modalData && (modalQ.isLoading || wfLoading)}
            error={
              modalQ.error
                ? (modalQ.error as Error).message
                : !displayIso && (modalData?.error || wfData?.error)
                  ? modalData?.error || wfData?.error || null
                  : null
            }
            onClose={() => setOpenCleaning(false)}
          />
        ) : null}
        {openAlert && overdue ? (
          <CleaningAlertModal
            machineName={machineName || machId}
            machineId={machId}
            lastCleaningIso={displayIso}
            hoursSinceCleaning={hoursSinceCleaning}
            operatorName={operatorName}
            strikeOperatorEmail={strikeOperatorEmail}
            attendanceSummary={workflowAttendance}
            slackEmailMap={slackEmailMap}
            slackTeamId={slackTeamId}
            onClose={() => setOpenAlert(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className={`cleaningCell${ccClass}`} title={tip}>
      {inner}
    </div>
  );
}
