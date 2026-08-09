import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { OperatorContactIcons } from '@/components/OperatorContactIcons';
import {
  CLEANING_ALERT_CHANNEL_LABELS,
  cleaningAlertTextForChannel,
  generateCleaningAlertMessage,
  type CleaningAlertChannel,
} from '@/lib/cleaningAlertMessage';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { operatorChannelsFromApi, resolveOperatorContacts } from '@/lib/operatorContacts';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { submitCleaningOverdue, workflowNotConfiguredMessage } from '@/lib/leetWorkflowApi';
import { useOperatorContact } from '@/lib/useOperatorContact';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

const CHANNELS: CleaningAlertChannel[] = ['slack', 'email', 'whatsapp', 'workflow'];

export function CleaningAlertModal({
  machineName,
  machineId,
  lastCleaningIso,
  hoursSinceCleaning,
  operatorName,
  strikeOperatorEmail,
  attendanceSummary,
  slackEmailMap,
  slackTeamId,
  onClose,
}: {
  machineName: string;
  machineId: string;
  lastCleaningIso?: string | null;
  hoursSinceCleaning?: number | null;
  operatorName?: string | null;
  strikeOperatorEmail?: string | null;
  attendanceSummary?: MachineAttendanceSummary;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const [activeChannel, setActiveChannel] = useState<CleaningAlertChannel>('workflow');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const displayName =
    String(operatorName || attendanceSummary?.operatorName || 'Operator').trim() || 'Operator';
  const email = String(strikeOperatorEmail || attendanceSummary?.operatorEmail || '').trim();

  const contactQ = useOperatorContact({
    email: email || null,
    name: displayName !== 'Operator' ? displayName : null,
    machineId,
    enabled: Boolean(machineId) && Boolean(email),
  });

  const channels = useMemo(() => {
    const workflowChannels = operatorChannelsFromApi({
      email: attendanceSummary?.operatorEmail,
      phone: attendanceSummary?.operatorPhone,
      whatsappUrl: attendanceSummary?.operatorWhatsappUrl,
      slackDmUrl: attendanceSummary?.operatorSlackDmUrl,
    });
    const base = resolveOperatorContacts(email, displayName !== 'Operator' ? displayName : null, {
      slackEmailMap,
      slackTeamId,
    });
    const merged = {
      ...base,
      ...workflowChannels,
      email: workflowChannels.email ?? base.email,
      phone: workflowChannels.phone ?? base.phone,
      whatsapp: workflowChannels.whatsapp ?? base.whatsapp,
      slackDmUrl: workflowChannels.slackDmUrl ?? base.slackDmUrl,
    };
    if (contactQ.data && !contactQ.data.error) {
      const fromApi = operatorChannelsFromApi(contactQ.data);
      return {
        ...merged,
        ...fromApi,
        email: fromApi.email ?? merged.email,
        phone: fromApi.phone ?? merged.phone,
      };
    }
    return merged;
  }, [attendanceSummary, contactQ.data, displayName, email, slackEmailMap, slackTeamId]);

  const message = useMemo(
    () =>
      generateCleaningAlertMessage({
        machineName,
        machineId,
        operatorName: displayName,
        lastCleaningIso,
        hoursSinceCleaning,
      }),
    [displayName, hoursSinceCleaning, lastCleaningIso, machineId, machineName],
  );

  const previewText = useMemo(
    () =>
      cleaningAlertTextForChannel(activeChannel, message, {
        machineName,
        machineId,
        operatorName: displayName,
      }),
    [activeChannel, displayName, machineId, machineName, message],
  );

  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function onSendWorkflow() {
    if (!machineId) return;
    setBusy(true);
    setSendResult(null);
    try {
      const res = await submitCleaningOverdue({
        machineId,
        message: previewText,
      });
      if (workflowNotConfiguredMessage(res)) {
        setSendResult('Workflow not configured');
      } else if (res.ok) {
        setSendResult(`Cleaning-overdue sent to ${res.operatorName || 'operator'} Workflow inbox.`);
      } else {
        setSendResult([res.error, res.note].filter(Boolean).join(' — ') || 'Could not send');
      }
    } catch (err) {
      setSendResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal cleaningAlertModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Cleaning alert notification</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">

        <p className="salesHistoryNote cleaningAlertCriteria">
          Criteria met: last clean more than <strong>15 hours</strong> ago
          {message.hoursSince != null ? (
            <>
              {' '}
              · <strong>{Math.round(message.hoursSince)}h</strong> elapsed
            </>
          ) : null}
          {lastCleaningIso ? (
            <>
              {' '}
              · last recorded {formatKuwaitDateTime(lastCleaningIso)} KWT
            </>
          ) : null}
        </p>

        <p className="salesHistoryNote">
          Operator: <strong>{displayName}</strong> — deliver via Workflow inbox, or copy for Slack / Email /
          WhatsApp.
        </p>

        <OperatorContactIcons
          layout="modal"
          iconsOnly
          channels={channels}
          machineLabel={machineName}
          slackEmailMap={slackEmailMap}
          slackTeamId={slackTeamId}
        />

        <div className="cleaningAlertChannels" role="tablist" aria-label="Delivery channel preview">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              role="tab"
              aria-selected={activeChannel === ch}
              className={`cleaningAlertChannelBtn${activeChannel === ch ? ' cleaningAlertChannelBtnActive' : ''}`}
              onClick={() => setActiveChannel(ch)}
            >
              {CLEANING_ALERT_CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>

        <section className="cleaningAlertPreview" aria-live="polite">
          <div className="cleaningAlertPreviewHead">
            <span className="salesHistoryCompareTitle">{CLEANING_ALERT_CHANNEL_LABELS[activeChannel]}</span>
            <button type="button" className="qaGoCheckCopyBtn" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy message'}
            </button>
          </div>
          <pre className="cleaningAlertPreviewBody">{previewText}</pre>
        </section>

        {activeChannel === 'workflow' ? (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btnPrimary" disabled={busy || !machineId} onClick={onSendWorkflow}>
              {busy ? 'Sending…' : 'Send to operator Workflow inbox'}
            </button>
            {sendResult ? <p className="salesHistoryNote">{sendResult}</p> : null}
          </div>
        ) : null}
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}
