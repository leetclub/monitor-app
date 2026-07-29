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
  const [message, setMessage] = useState(
    `Please check machine ${machineLabel || machineId} and confirm status.`,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  async function onSend() {
    if (!machineId) {
      setResult('Machine id not available');
      return;
    }
    if (!message.trim()) {
      setResult('Message required');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await submitDmOperator({
        machineId,
        operatorEmail: email || undefined,
        message: message.trim(),
      });
      if (workflowNotConfiguredMessage(res)) {
        setResult('Workflow not configured');
      } else if (res.ok) {
        setResult(`DM sent to ${res.operatorName || 'operator'} via Workflow inbox.`);
      } else {
        setResult(res.error || res.note || 'Could not send DM');
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
          Sends a message to the <strong>scheduled operator</strong> Workflow DM inbox
          {email ? (
            <>
              {' '}
              ({email})
            </>
          ) : null}
          .
        </p>
        <label className="workflowField">
          Message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required />
        </label>
        <button type="button" className="btnPrimary" disabled={busy || !machineId} onClick={onSend}>
          {busy ? 'Sending…' : 'Send workflow DM'}
        </button>
        {result ? <p className="salesHistoryNote">{result}</p> : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
