import { slackAppRedirectUserUrl, slackUserDmUrl } from '@/lib/slackLinks';
import {
  mailtoOperatorUrl,
  telOperatorUrl,
  whatsappOperatorUrl,
  type OperatorContactChannels,
} from '@/lib/operatorContacts';

export function OperatorContactBar({
  operatorName,
  strikeOperatorEmail,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  channels,
  layout = 'inline',
}: {
  operatorName?: string | null;
  strikeOperatorEmail?: string | null;
  machineLabel?: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  channels?: OperatorContactChannels;
  layout?: 'inline' | 'modal';
}) {
  const name = String(operatorName || '').trim() || '—';
  const email = (channels?.email ?? strikeOperatorEmail)?.trim() || '';
  const slackId =
    channels?.slackUserId ||
    (email ? slackEmailMap?.[email.toLowerCase()] : undefined);
  const team = slackTeamId?.trim() || '';
  const slackUrl =
    channels?.slackDmUrl || (slackId && team ? slackUserDmUrl(team, slackId) : '');
  const slackHttps =
    channels?.slackAppUrl || (slackId && team ? slackAppRedirectUserUrl(team, slackId) : '');

  return (
    <div className={`opContactBar opContactBar--${layout}`}>
      <div className="opContactBarName">{name}</div>
      <div className="opContactBarActions">
        {email ? (
          <a className="opContactBarLink" href={mailtoOperatorUrl(email, `Leet Alert — ${machineLabel || name}`)}>
            Email
          </a>
        ) : null}
        {channels?.phone ? (
          <a className="opContactBarLink" href={telOperatorUrl(channels.phone)}>
            Phone
          </a>
        ) : null}
        {channels?.whatsapp ? (
          <a
            className="opContactBarLink"
            href={whatsappOperatorUrl(channels.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        ) : null}
        {slackUrl ? (
          <a className="opContactBarLink" href={slackUrl} title="Open Slack DM">
            Slack
          </a>
        ) : slackHttps ? (
          <a className="opContactBarLink" href={slackHttps} target="_blank" rel="noopener noreferrer">
            Slack
          </a>
        ) : email ? (
          <span className="opContactBarMuted" title="Slack user id not mapped for this email">
            Slack —
          </span>
        ) : null}
      </div>
    </div>
  );
}
