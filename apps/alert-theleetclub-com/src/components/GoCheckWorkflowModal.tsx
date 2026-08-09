import { useState } from 'react';
import { createPortal } from 'react-dom';
import { submitGoCheck, workflowNotConfiguredMessage, type WorkflowConfigured } from '@/lib/leetWorkflowApi';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function GoCheckWorkflowModal({
  machineId,
  machineName,
  alertType,
  configuredHint,
  onClose,
}: {
  machineId: string;
  machineName: string;
  alertType?: string;
  configuredHint?: WorkflowConfigured;
  onClose: () => void;
}) {
  const [errorType, setErrorType] = useState(alertType || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const notConfigured = workflowNotConfiguredMessage(configuredHint);
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (notConfigured) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await submitGoCheck({
        machineId,
        machineName,
        errorType: errorType.trim(),
        message: message.trim(),
      });
      if (workflowNotConfiguredMessage(res)) {
        setResult('Workflow not configured');
      } else if (res.ok) {
        if (res.delivery === 'task_manager_received') {
          setResult(
            `GO CHECK created in Workflow Received for ${res.operatorName || 'operator'} (24h due).`,
          );
        } else if (res.delivery === 'slack_dm') {
          const why = String(res.note || '').trim();
          setResult(
            why
              ? `GO CHECK sent to ${res.operatorName || 'operator'} via Slack DM. ${why}`
              : `GO CHECK sent to ${res.operatorName || 'operator'} via Slack DM (Workflow Received unavailable).`,
          );
        } else {
          setResult('GO CHECK sent.');
        }
      } else if (res.mailtoUrl) {
        window.location.href = res.mailtoUrl;
        setResult(
          `${res.error || 'Delivery unavailable'}. Opened email to ${res.operatorEmail || 'operator'}.`,
        );
      } else {
        setResult(
          [res.error, res.note].filter(Boolean).join(' — ') || 'Could not send GO CHECK',
        );
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
            <p className="salesHistoryEyebrow">Leet Workflow · GO CHECK</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
        {notConfigured ? (
          <p className="salesHistoryEmpty">{notConfigured}</p>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="salesHistoryNote">
              Creates an <strong>urgent task</strong> in the scheduled operator&apos;s Workflow{' '}
              <strong>Received</strong> inbox (error type + message, 24h due). Falls back to Slack DM / email if
              Workflow write fails.
            </p>
            <label className="workflowField">
              Error type
              <input value={errorType} onChange={(e) => setErrorType(e.target.value)} required />
            </label>
            <label className="workflowField">
              Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required />
            </label>
            <button type="submit" className="btnPrimary" disabled={busy}>
              {busy ? 'Sending…' : 'Send GO CHECK'}
            </button>
            {result ? <p className="salesHistoryNote">{result}</p> : null}
          </form>
        )}
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}
