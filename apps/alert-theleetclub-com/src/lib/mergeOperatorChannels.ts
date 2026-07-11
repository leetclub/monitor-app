import {
  operatorChannelsFromApi,
  resolveOperatorContacts,
  type OperatorContactChannels,
} from '@/lib/operatorContacts';
import type { OperatorContactApi } from '@/lib/useOperatorContact';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';

/** Merge strike email, workflow snapshot, runtime maps, and /operator-contact API. */
export function mergeOperatorChannels(opts: {
  strikeEmail?: string | null;
  displayName?: string | null;
  machineId?: string | null;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
  attendanceSummary?: MachineAttendanceSummary;
  apiPayload?: OperatorContactApi | null;
}): OperatorContactChannels {
  const name =
    String(opts.displayName ?? '').trim() && String(opts.displayName).trim() !== 'Operator'
      ? String(opts.displayName).trim()
      : null;
  const email = String(opts.strikeEmail ?? opts.attendanceSummary?.operatorEmail ?? '').trim();

  const workflow = operatorChannelsFromApi({
    email: opts.attendanceSummary?.operatorEmail,
    phone: opts.attendanceSummary?.operatorPhone,
    whatsappUrl: opts.attendanceSummary?.operatorWhatsappUrl,
    slackDmUrl: opts.attendanceSummary?.operatorSlackDmUrl,
  });

  const base = resolveOperatorContacts(email || null, name, {
    slackEmailMap: opts.slackEmailMap,
    slackTeamId: opts.slackTeamId,
  });

  const merged: OperatorContactChannels = {
    ...base,
    ...workflow,
    email: workflow.email ?? base.email,
    phone: workflow.phone ?? base.phone,
    whatsapp: workflow.whatsapp ?? base.whatsapp,
    slackDmUrl: workflow.slackDmUrl ?? base.slackDmUrl,
    slackAppUrl: workflow.slackAppUrl ?? base.slackAppUrl,
    slackUserId: workflow.slackUserId ?? base.slackUserId,
    slackTeamId: workflow.slackTeamId ?? base.slackTeamId,
  };

  if (opts.apiPayload && !opts.apiPayload.error) {
    const fromApi = operatorChannelsFromApi(opts.apiPayload);
    return {
      ...merged,
      ...fromApi,
      email: fromApi.email ?? merged.email,
      phone: fromApi.phone ?? merged.phone,
      whatsapp: fromApi.whatsapp ?? merged.whatsapp,
      slackUserId: fromApi.slackUserId ?? merged.slackUserId,
      slackTeamId: fromApi.slackTeamId ?? merged.slackTeamId,
      slackDmUrl: fromApi.slackDmUrl ?? merged.slackDmUrl,
      slackAppUrl: fromApi.slackAppUrl ?? merged.slackAppUrl,
    };
  }

  return merged;
}
