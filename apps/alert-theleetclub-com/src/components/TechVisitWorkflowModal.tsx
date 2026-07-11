import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTechVisitWorkflow } from '@/lib/leetWorkflowApi';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function TechVisitWorkflowModal({
  machineName,
  machineId,
  fallbackLastVisitAt,
  fallbackVisitorName,
  fallbackComment,
  onClose,
}: {
  machineName: string;
  machineId: string;
  fallbackLastVisitAt?: string;
  fallbackVisitorName?: string | null;
  fallbackComment?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);

  const q = useQuery({
    queryKey: ['leet-workflow-tech-visit', machineId, machineName],
    queryFn: () => fetchTechVisitWorkflow(machineId, machineName),
    enabled: Boolean(machineId),
    staleTime: 10 * 60_000,
  });

  const payload = q.data;
  const lastVisitIso =
    (payload?.lastVisitAt ? String(payload.lastVisitAt) : '') ||
    (fallbackLastVisitAt ? String(fallbackLastVisitAt).trim() : '');
  const visitorName = payload?.visitorName || fallbackVisitorName || null;
  const comment = payload?.comment || fallbackComment || null;
  const source = payload?.source;
  const workflowNote =
    payload?.error &&
    (String(payload.error).includes('Task Manager') || String(payload.error).includes('not available')) &&
    !lastVisitIso
      ? payload.error
      : payload?.error && !lastVisitIso
        ? payload.error
        : null;

  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Tech visit</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {q.isLoading && !lastVisitIso ? (
          <AlertModalAnticipate hint="Tech visit record incoming" lines={3} />
        ) : null}
        {q.error && !lastVisitIso ? <p className="stitchOpsAlert">{(q.error as Error).message}</p> : null}
        {lastVisitIso ? (
          <div className="alertModalContentReveal">
            <p className="salesHistoryNote">
              Last visit: <strong>{formatKuwaitDateTime(lastVisitIso)}</strong>
              {source === 'safetyculture' ? ' · SafetyCulture' : null}
            </p>
            {visitorName ? (
              <p className="salesHistoryNote">
                Visitor: <strong>{visitorName}</strong>
              </p>
            ) : null}
            {comment ? <p className="historyModalRowExplain">{comment}</p> : null}
            {payload?.error && source === 'safetyculture' ? (
              <p className="salesHistoryEmpty salesHistoryFootnote">{payload.error}</p>
            ) : null}
          </div>
        ) : !q.isLoading ? (
          <p className="salesHistoryEmpty">{workflowNote || 'No tech visit on record for this machine'}</p>
        ) : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
