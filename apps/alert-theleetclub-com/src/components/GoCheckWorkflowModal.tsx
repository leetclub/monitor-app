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
        setResult(
          res.delivery === 'slack_dm'
            ? `GO CHECK sent to ${res.operatorName || 'operator'} via Slack DM (24h due).`
            : 'GO CHECK sent.',
        );
      } else if (res.mailtoUrl) {
        window.location.href = res.mailtoUrl;
        setResult(
          `${res.error || 'Slack DM unavailable'}. Opened email to ${res.operatorEmail || 'operator'}.`,
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
        {notConfigured ? (
          <p className="salesHistoryEmpty">{notConfigured}</p>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="salesHistoryNote">
              Sends <strong>URGENT ACTION REQUIRED</strong> to the scheduled operator via Slack DM (error type +
              message, 24h due). Task Manager Received inbox is not available yet — Slack is used instead.
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
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
