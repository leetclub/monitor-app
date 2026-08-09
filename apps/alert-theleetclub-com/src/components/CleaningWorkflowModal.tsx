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

function workflowCleaningFootnote(data?: CleaningWorkflowPayload, ccLabel?: string | null): string | null {
  const note = String(data?.note ?? '').trim();
  if (note) {
    // Avoid duplicating the CC status line already shown above.
    if (ccLabel) {
      const n = note.toLowerCase();
      if (n.includes('command center') || n.includes('pending command center')) return null;
    }
    return note;
  }
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
  const seen = new Set<string>();
  for (const c of raw) {
    let txt = '';
    if (typeof c === 'string') txt = c.trim();
    else if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      txt = String(o.text || o.body || o.comment || o.message || '').trim();
    }
    if (!txt) continue;
    const key = txt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(txt);
  }
  return out;
}

function mediaUrlKey(url: string): string {
  return url.split('?', 1)[0].replace(/\/+$/, '').toLowerCase();
}

/** Unique URLs; number repeated labels (Cleaning video 1 / 2, Refilled photo 1…). */
function asMediaLinks(data?: CleaningWorkflowPayload): Array<{ url: string; label: string }> {
  const raw: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();

  const push = (urlRaw: string, labelRaw: string) => {
    const url = String(urlRaw || '').trim();
    if (!url) return;
    const key = mediaUrlKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    const label = String(labelRaw || 'Media').trim() || 'Media';
    raw.push({ url, label });
  };

  for (const m of data?.media || []) {
    if (!m || typeof m !== 'object') continue;
    push(String((m as { url?: string }).url || ''), String((m as { label?: string }).label || 'Media'));
  }
  if (!raw.length) {
    if (data?.monitorRecordUrl) push(String(data.monitorRecordUrl), 'Monitor-style record');
    if (data?.eodVideoUrl) push(String(data.eodVideoUrl), 'EOD video');
    if (data?.videoUrl) push(String(data.videoUrl), 'Cleaning video');
  }

  const labelCounts = new Map<string, number>();
  for (const m of raw) labelCounts.set(m.label, (labelCounts.get(m.label) || 0) + 1);
  const labelIdx = new Map<string, number>();
  return raw.map((m) => {
    const total = labelCounts.get(m.label) || 1;
    if (total <= 1) return m;
    const n = (labelIdx.get(m.label) || 0) + 1;
    labelIdx.set(m.label, n);
    return { url: m.url, label: `${m.label} ${n}` };
  });
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
  const ccLabel = ccStatusLabel(data);
  const footnote = workflowCleaningFootnote(data, ccLabel);
  const comments = asCommentLines(data?.comments);
  const media = asMediaLinks(data);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const errText = error ? String(error).trim() : '';

  const sourceBits: string[] = [];
  if (source === 'attendance_cache') sourceBits.push('Vendon daily cleaning');
  if (source === 'live_dashboard') sourceBits.push('Live Dashboard');
  if (source === 'workflow') sourceBits.push('Workflow upload');
  if (source === 'snapshot') sourceBits.push('Red Alert snapshot');

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
        <div className="salesHistoryBody">
          {loading && !iso ? <AlertModalAnticipate hint="Last clean record incoming" lines={3} /> : null}
          {errText && !iso ? <p className="stitchOpsAlert">{errText}</p> : null}

          {iso ? (
            <div className="alertModalContentReveal">
              <p className="salesHistoryNote">
                Last cleaning: <strong>{formatKuwaitDateTime(iso)}</strong>
                {sourceBits.length ? ` · ${sourceBits.join(' · ')}` : ''}
              </p>
              {(data?.highRisk || data?.ghostCheck) && (
                <p className="salesHistoryNote cleaningFlagsRow">
                  {data?.highRisk ? <span className="cleaningFlagPill cleaningFlagPill--risk">High risk</span> : null}
                  {data?.ghostCheck ? <span className="cleaningFlagPill cleaningFlagPill--ghost">Ghost check</span> : null}
                </p>
              )}
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
                  <p className="salesHistoryEyebrow">Media · {media.length} file{media.length === 1 ? '' : 's'}</p>
                  <ul className="salesHistoryList">
                    {media.map((m) => (
                      <li key={mediaUrlKey(m.url)} className="salesHistoryRow">
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
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
