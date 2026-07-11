import { useState } from 'react';
import { createPortal } from 'react-dom';
import { submitDmOperator, workflowNotConfiguredMessage } from '@/lib/leetWorkflowApi';
import { getStrikeOperatorEmail } from '@/features/redflags/redFlagsModel';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function LeetWorkflowDmModal({
  row,
  machineLabel,
  onClose,
}: {
  row: RedAlertRow;
  machineLabel: string;
  onClose: () => void;
}) {
  const machineId = String(row.machineId ?? row.machine_id ?? '').trim();
  const email = getStrikeOperatorEmail(row) || '';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  async function onSend() {
    if (!email || !machineId) {
      setResult('Operator email not available');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await submitDmOperator({ machineId, operatorEmail: email });
      if (workflowNotConfiguredMessage(res)) {
        setResult('Workflow not configured');
      } else if (res.ok) {
        setResult('DM popup opened via Leet Workflow.');
      } else {
        setResult(res.error || 'Could not open DM');
      }
    } catch (err) {
      setResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Leet Workflow · Call OP</p>
            <h2 className="salesHistoryTitle">{machineLabel}</h2>
            <p className="salesHistorySub">#{machineId || '—'}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="salesHistoryNote">
          Opens Leet Workflow DM popup (not Slack) for <strong>{email || '—'}</strong>.
        </p>
        <button type="button" className="btnPrimary" disabled={busy || !email} onClick={onSend}>
          {busy ? 'Opening…' : 'Open workflow DM'}
        </button>
        {result ? <p className="salesHistoryNote">{result}</p> : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
