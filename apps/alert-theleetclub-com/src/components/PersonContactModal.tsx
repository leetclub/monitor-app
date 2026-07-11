import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { OperatorContactIcons } from '@/components/OperatorContactIcons';
import { createPortal } from 'react-dom';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import type { OperatorContactChannels } from '@/lib/operatorContacts';

export function PersonContactModal({
  title,
  subtitle,
  eyebrow = 'Contact',
  channels,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  loading,
  onClose,
}: {
  title: string;
  subtitle: string;
  eyebrow?: string;
  channels: OperatorContactChannels;
  machineLabel: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  loading?: boolean;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  return createPortal(
    <div
      className="operatorContactBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-contact-title"
      {...backdrop}
    >
      <div className="operatorContactModal" {...panel}>
        <div className="operatorContactModalHead">
          <div>
            <p className="operatorContactEyebrow">{eyebrow}</p>
            <h2 id="person-contact-title" className="operatorContactTitle">
              {title}
            </h2>
            <p className="operatorContactSub">{subtitle}</p>
          </div>
          <button type="button" className="operatorContactClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <AlertModalAnticipate hint="Contact channels incoming" lines={3} />
        ) : (
          <div className="operatorContactIconsWrap alertModalContentReveal">
            <OperatorContactIcons
              layout="modal"
              iconsOnly
              channels={channels}
              machineLabel={machineLabel || title}
              slackEmailMap={slackEmailMap}
              slackTeamId={slackTeamId}
            />
          </div>
        )}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
