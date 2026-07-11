import type { ReactNode } from 'react';
import { slackAppRedirectUserUrl, slackUserDmUrl } from '@/lib/slackLinks';
import {
  mailtoOperatorUrl,
  telOperatorUrl,
  whatsappOperatorUrl,
  type OperatorContactChannels,
} from '@/lib/operatorContacts';

function IconMail() {
  return (
    <svg className="opContactIcon opContactIcon--mail" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"
      />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg className="opContactIcon opContactIcon--phone" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#34B7F1"
        d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"
      />
    </svg>
  );
}

function IconSlack() {
  return (
    <svg className="opContactIcon opContactIcon--slack" viewBox="0 0 24 24" aria-hidden>
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg className="opContactIcon opContactIcon--whatsapp" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"
      />
    </svg>
  );
}

function ContactSlot({
  label,
  href,
  on,
  external,
  iconsOnly,
  layout,
  children,
}: {
  label: string;
  href?: string;
  on: boolean;
  external?: boolean;
  iconsOnly?: boolean;
  layout?: 'table' | 'modal';
  children: ReactNode;
}) {
  const cls = [
    'opContactSlot',
    layout === 'modal' ? 'opContactSlotModal' : 'opContactSlotTable',
    on ? 'opContactSlotOn' : 'opContactSlotOff',
    iconsOnly ? 'opContactSlotIconsOnly' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = on ? label : `${label} — not available`;
  if (on && href) {
    return (
      <a
        className={cls}
        href={href}
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
        {!iconsOnly ? <span className="opContactSlotLabel">{label}</span> : null}
      </a>
    );
  }
  return (
    <span className={cls} title={title} aria-label={title}>
      {children}
      {!iconsOnly ? <span className="opContactSlotLabel">{label}</span> : null}
    </span>
  );
}

export function OperatorContactIcons({
  channels,
  machineLabel,
  slackEmailMap,
  slackTeamId,
  layout = 'table',
  iconsOnly = false,
}: {
  channels: OperatorContactChannels;
  machineLabel?: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  layout?: 'table' | 'modal';
  iconsOnly?: boolean;
}) {
  const email = channels.email?.trim() || '';
  const phone = channels.phone?.trim() || '';
  const wa = channels.whatsapp?.trim() || '';
  const slackId =
    channels.slackUserId || (email ? slackEmailMap?.[email.toLowerCase()] : undefined);
  const team = (channels.slackTeamId || slackTeamId)?.trim() || '';
  const slackHref =
    channels.slackDmUrl ||
    (slackId && team ? slackUserDmUrl(team, slackId) : '') ||
    channels.slackAppUrl ||
    (slackId && team ? slackAppRedirectUserUrl(team, slackId) : '');
  const subject = `Leet Alert — ${machineLabel || 'operator'}`;

  return (
    <div
      className={`opContactSlots opContactSlots--${layout}${iconsOnly ? ' opContactSlotsIconsOnly' : ''}`}
      role="group"
      aria-label="Contact channels"
    >
      <ContactSlot
        label="Email"
        href={email ? mailtoOperatorUrl(email, subject) : undefined}
        on={Boolean(email)}
        iconsOnly={iconsOnly}
        layout={layout}
      >
        <IconMail />
      </ContactSlot>
      <ContactSlot
        label="Phone"
        href={phone ? telOperatorUrl(phone) : undefined}
        on={Boolean(phone)}
        iconsOnly={iconsOnly}
        layout={layout}
      >
        <IconPhone />
      </ContactSlot>
      <ContactSlot
        label="Slack"
        href={slackHref || undefined}
        on={Boolean(slackHref)}
        external={Boolean(slackHref && slackHref.startsWith('http'))}
        iconsOnly={iconsOnly}
        layout={layout}
      >
        <IconSlack />
      </ContactSlot>
      <ContactSlot
        label="WhatsApp"
        href={wa ? whatsappOperatorUrl(wa) : undefined}
        on={Boolean(wa)}
        external
        iconsOnly={iconsOnly}
        layout={layout}
      >
        <IconWhatsApp />
      </ContactSlot>
    </div>
  );
}
