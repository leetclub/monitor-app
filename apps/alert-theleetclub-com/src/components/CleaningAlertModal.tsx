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
  const [activeChannel, setActiveChannel] = useState<CleaningAlertChannel>('slack');
  const [copied, setCopied] = useState(false);

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

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal cleaningAlertModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Cleaning alert notification · preview</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

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
          Operator: <strong>{displayName}</strong> — message would be sent to Slack DM, Email, WhatsApp, and
          Workflow <strong>Received</strong> (preview only; not sent from Alert).
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
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
