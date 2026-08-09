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

function asCommentLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c === 'string' && c.trim()) out.push(c.trim());
    else if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      const txt = String(o.text || o.body || o.comment || o.message || '').trim();
      if (txt) out.push(txt);
    }
  }
  return out;
}

function asMediaLinks(
  data?: CleaningWorkflowPayload,
): Array<{ url: string; label: string }> {
  const fromList = Array.isArray(data?.media) ? data!.media! : [];
  const built = fromList
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const url = String((m as { url?: string }).url || '').trim();
      if (!url) return null;
      const label = String((m as { label?: string }).label || 'Download / view').trim() || 'Download / view';
      return { url, label };
    })
    .filter(Boolean) as Array<{ url: string; label: string }>;
  if (built.length) return built;
  const fallback = [
    data?.monitorRecordUrl ? { url: String(data.monitorRecordUrl).trim(), label: 'Monitor-style record' } : null,
    data?.eodVideoUrl ? { url: String(data.eodVideoUrl).trim(), label: 'EOD video' } : null,
    data?.videoUrl ? { url: String(data.videoUrl).trim(), label: 'Cleaning video' } : null,
  ].filter((x): x is { url: string; label: string } => Boolean(x?.url));
  return fallback;
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
  const comments = asCommentLines(data?.comments);
  const media = asMediaLinks(data);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const errText = error ? String(error).trim() : '';

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cleaning-workflow-title"
      {...backdrop}
    >
      <div className="salesHistoryModal cleaningWorkflowModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Last clean</p>
            <h2 id="cleaning-workflow-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading && !iso ? <AlertModalAnticipate hint="Last clean record incoming" lines={3} /> : null}
        {errText && !iso ? <p className="stitchOpsAlert">{errText}</p> : null}

        {iso ? (
          <div className="alertModalContentReveal">
            <p className="salesHistoryNote">
              Last cleaning: <strong>{formatKuwaitDateTime(iso)}</strong>
              {source === 'attendance_cache' ? ' · Vendon daily cleaning' : null}
              {source === 'live_dashboard' ? ' · Live Dashboard' : null}
              {source === 'workflow' ? ' · Workflow upload' : null}
              {source === 'snapshot' ? ' · Red Alert snapshot' : null}
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
                <ul className="salesHistoryList">
                  {comments.map((c, i) => (
                    <li key={`c-${i}`} className="salesHistoryRow">
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {media.length ? (
              <>
                <p className="salesHistoryEyebrow">Media</p>
                <ul className="salesHistoryList">
                  {media.map((m, i) => (
                    <li key={`m-${i}-${m.url}`} className="salesHistoryRow">
                      <a href={m.url} target="_blank" rel="noopener noreferrer">
                        {m.label}
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
            {workflowNote || errText || 'No last cleaning time on record for this machine'}
          </p>
        ) : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
