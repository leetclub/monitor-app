import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import type { CleaningWorkflowPayload } from '@/lib/leetWorkflowApi';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

function workflowCleaningUnavailable(data?: CleaningWorkflowPayload, hasTimestamp?: boolean): string | null {
  if (hasTimestamp) return null;
  const err = String(data?.error ?? '').trim();
  if (!err) return null;
  if (err.includes('not configured')) return err;
  if (err.includes('Task Manager') || err.includes('not available')) {
    return 'Workflow cleaning uploads are not on Task Manager yet. Last clean time comes from Vendon snapshot.';
  }
  return null;
}

function workflowCleaningFootnote(data?: CleaningWorkflowPayload): string | null {
  const note = String(data?.note ?? '').trim();
  if (note) return note;
  const err = String(data?.error ?? '').trim();
  if (!err || err.includes('GET /api/v1/')) return null;
  if (/not available|Task Manager/i.test(err)) return null;
  return err;
}

function ccStatusLabel(data?: CleaningWorkflowPayload): string | null {
  const cc = data?.commandCenterVerified;
  if (cc === true) return 'Command Center verified (green on Workflow)';
  if (cc === false) return 'Uploaded — pending Command Center check (red on Workflow)';
  return null;
}

export function CleaningWorkflowModal({
  machineName,
  machineId,
  fallbackIso,
  data,
  loading,
  error,
  onClose,
}: {
  machineName: string;
  machineId: string;
  fallbackIso?: string;
  data?: CleaningWorkflowPayload;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);

  const workflowIso = data?.lastCleaningAt?.trim() || '';
  const snapshotIso = fallbackIso?.trim() || '';
  const iso = workflowIso || snapshotIso;
  const source = workflowIso
    ? data?.cleaningSource || 'workflow'
    : snapshotIso
      ? data?.cleaningSource || 'snapshot'
      : null;
  const workflowNote = workflowCleaningUnavailable(data, Boolean(iso));
  const footnote = workflowCleaningFootnote(data);
  const ccLabel = ccStatusLabel(data);
  const comments = data?.comments?.length ? data.comments : [];
  const media =
    data?.media?.length
      ? data.media
      : [
          data?.monitorRecordUrl ? { url: data.monitorRecordUrl, label: 'Monitor-style record' } : null,
          data?.eodVideoUrl ? { url: data.eodVideoUrl, label: 'EOD video' } : null,
          data?.videoUrl ? { url: data.videoUrl, label: 'Cleaning video' } : null,
        ].filter(Boolean) as Array<{ url: string; label?: string }>;
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Last clean</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {loading && !iso ? (
          <AlertModalAnticipate hint="Last clean record incoming" lines={3} />
        ) : null}
        {error && !iso ? <p className="stitchOpsAlert">{error}</p> : null}
        {iso ? (
          <div className="alertModalContentReveal">
            <p className="salesHistoryNote">
              Last cleaning: <strong>{formatKuwaitDateTime(iso)}</strong>
              {source === 'attendance_cache' ? ' · Vendon daily cleaning' : null}
              {source === 'live_dashboard' ? ' · Live Dashboard' : null}
              {source === 'workflow' ? ' · Workflow upload' : null}
              {data?.highRisk ? ' · High risk' : ''}
              {data?.ghostCheck ? ' · Ghost check' : ''}
            </p>
            {ccLabel ? (
              <p
                className={`salesHistoryNote cleaningCcStatus${
                  data?.commandCenterVerified ? ' cleaningCcStatus--verified' : ' cleaningCcStatus--pending'
                }`}
              >
                {ccLabel}
              </p>
            ) : null}
            {comments.length ? (
              <>
                <p className="salesHistoryEyebrow">Operator comments</p>
                <ul className="detailReasonList">
                  {comments.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {media.length ? (
              <>
                <p className="salesHistoryEyebrow">Media</p>
                <ul className="salesHistoryList">
                  {media.map((m, i) => (
                    <li key={i} className="salesHistoryRow">
                      <a href={m.url} target="_blank" rel="noopener noreferrer">
                        {m.label || 'Download / view'}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {footnote ? <p className="salesHistoryEmpty salesHistoryFootnote">{footnote}</p> : null}
            {workflowNote ? (
              <p className="salesHistoryEmpty salesHistoryFootnote">{workflowNote}</p>
            ) : null}
          </div>
        ) : !loading ? (
          <p className="salesHistoryEmpty">
            {workflowNote || error || 'No last cleaning time on record for this machine'}
          </p>
        ) : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
