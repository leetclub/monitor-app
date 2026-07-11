import { formatKuwaitDateTime } from '@/lib/formatKuwait';

export type CleaningAlertChannel = 'slack' | 'email' | 'whatsapp' | 'workflow';

export type CleaningAlertMessage = {
  subject: string;
  body: string;
  workflowTitle: string;
  workflowErrorType: string;
  hoursSince: number;
  lastCleanLabel: string;
};

function hoursSinceFromIso(iso: string | undefined, hoursSince?: number | null): number {
  if (hoursSince != null && Number.isFinite(hoursSince) && hoursSince > 0) {
    return Math.round(hoursSince * 10) / 10;
  }
  const trimmed = String(iso || '').trim();
  if (!trimmed) return 15;
  const ms = Date.now() - new Date(trimmed).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 15;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

function urgencyPhrase(hours: number): string {
  if (hours >= 36) return 'This is overdue and needs immediate attention before the next service window.';
  if (hours >= 24) return 'Please prioritise a full clean today — the machine has been without service for over a day.';
  return 'Please complete a cleaning visit as soon as you are on site.';
}

/** Contextual operator alert copy (AI-style template; no live LLM call). */
export function generateCleaningAlertMessage(params: {
  machineName: string;
  machineId: string;
  operatorName?: string | null;
  lastCleaningIso?: string | null;
  hoursSinceCleaning?: number | null;
}): CleaningAlertMessage {
  const machineName = String(params.machineName || params.machineId || 'Machine').trim();
  const machineId = String(params.machineId || '').trim();
  const operator = String(params.operatorName || 'Operator').trim() || 'Operator';
  const lastIso = String(params.lastCleaningIso || '').trim();
  const hours = hoursSinceFromIso(lastIso, params.hoursSinceCleaning);
  const lastCleanLabel = lastIso ? formatKuwaitDateTime(lastIso) : 'not recorded';
  const urgency = urgencyPhrase(hours);

  const subject = `Cleaning overdue — ${machineName} (${Math.round(hours)}h)`;
  const body = [
    `Hi ${operator},`,
    '',
    `Leet Alert flagged ${machineName} (#${machineId}) because the last recorded clean was ${Math.round(hours)} hours ago (threshold: 15h).`,
    lastIso ? `Last clean: ${lastCleanLabel} (Kuwait).` : 'No last-clean timestamp is on file for this machine.',
    '',
    urgency,
    'Confirm when cleaning is done in Leet Workflow so the alert clears.',
    '',
    '— Leet Alert · Cleaning notifications',
  ].join('\n');

  const workflowTitle = 'URGENT ACTION REQUIRED — Cleaning overdue';
  const workflowErrorType = 'CLEANING OVERDUE';

  return {
    subject,
    body,
    workflowTitle,
    workflowErrorType,
    hoursSince: hours,
    lastCleanLabel,
  };
}

export function cleaningAlertTextForChannel(
  channel: CleaningAlertChannel,
  msg: CleaningAlertMessage,
  params: { machineName: string; machineId: string; operatorName?: string | null },
): string {
  const operator = String(params.operatorName || 'Operator').trim() || 'Operator';
  const machineName = String(params.machineName || params.machineId).trim();

  switch (channel) {
    case 'slack':
      return [
        `:broom: *Cleaning overdue — ${machineName}*`,
        `<@${operator}> — last clean was *${Math.round(msg.hoursSince)}h* ago (limit 15h).`,
        msg.lastCleanLabel !== 'not recorded' ? `Last clean: ${msg.lastCleanLabel} KWT.` : 'Last clean: not on record.',
        'Please visit the machine and mark cleaning complete in Workflow.',
      ].join('\n');
    case 'email':
      return `Subject: ${msg.subject}\n\n${msg.body}`;
    case 'whatsapp':
      return [
        `Leet Alert — Cleaning overdue`,
        `${machineName} (#${params.machineId})`,
        `Hi ${operator}, last clean was ${Math.round(msg.hoursSince)} hours ago (15h limit).`,
        msg.lastCleanLabel !== 'not recorded' ? `Last clean: ${msg.lastCleanLabel} KWT.` : '',
        'Please clean the machine and confirm in Leet Workflow.',
      ]
        .filter(Boolean)
        .join('\n');
    case 'workflow':
      return [
        `Inbox: Received`,
        `Task: ${msg.workflowTitle}`,
        `Error type: ${msg.workflowErrorType}`,
        `Machine: ${machineName} (#${params.machineId})`,
        `Operator: ${operator}`,
        `Hours since last clean: ${Math.round(msg.hoursSince)} (threshold 15h)`,
        '',
        'Message:',
        msg.body,
        '',
        'Due: 24 hours',
      ].join('\n');
    default:
      return msg.body;
  }
}

export const CLEANING_ALERT_CHANNEL_LABELS: Record<CleaningAlertChannel, string> = {
  slack: 'Slack DM',
  email: 'Email',
  whatsapp: 'WhatsApp',
  workflow: 'Workflow · Received',
};
