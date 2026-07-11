import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { parseEmailToSlackUserMap, slackAppRedirectUserUrl, slackUserDmUrl } from '@/lib/slackLinks';

export type OperatorContactChannels = {
  email?: string;
  phone?: string;
  whatsapp?: string;
  slackUserId?: string;
  slackTeamId?: string;
  slackDmUrl?: string;
  slackAppUrl?: string;
};

type ContactExtra = { email?: string; phone?: string; whatsapp?: string };

function normName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseContactMapJson(raw: string | undefined): Record<string, ContactExtra> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, ContactExtra> = {};
    for (const [k, v] of Object.entries(o)) {
      const key = String(k).trim().toLowerCase();
      if (!key) continue;
      if (typeof v === 'string') {
        out[key] = { phone: v.trim() || undefined };
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        out[key] = {
          email: rec.email != null ? String(rec.email).trim() || undefined : undefined,
          phone: rec.phone != null ? String(rec.phone).trim() || undefined : undefined,
          whatsapp: rec.whatsapp != null ? String(rec.whatsapp).trim() || undefined : undefined,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function digitsOnly(s: string): string {
  return s.replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function slackUrls(teamId: string, userId: string): { dm?: string; app?: string } {
  const dm = slackUserDmUrl(teamId, userId);
  const app = slackAppRedirectUserUrl(teamId, userId);
  return {
    dm: dm || undefined,
    app: app || undefined,
  };
}

/** Resolve operator contact channels from strike email + optional display name + runtime maps. */
export function resolveOperatorContacts(
  strikeEmail?: string | null,
  operatorName?: string | null,
  opts?: {
    slackEmailMap?: Record<string, string>;
    slackTeamId?: string;
  },
): OperatorContactChannels {
  let email = String(strikeEmail || '')
    .trim()
    .toLowerCase();
  const env = getAlertRuntimeEnv();
  const team = (opts?.slackTeamId || env.SLACK_TEAM_ID || '').trim();
  const opMap = {
    ...parseEmailToSlackUserMap(env.SLACK_OP_EMAIL_MAP_JSON),
    ...(opts?.slackEmailMap ?? {}),
  };
  const contactMap = parseContactMapJson(env.OPERATOR_CONTACT_MAP_JSON);
  const nameKey = normName(operatorName || '');

  if (!email && nameKey && contactMap[nameKey]?.email) {
    email = contactMap[nameKey].email!.toLowerCase();
  }

  const out: OperatorContactChannels = {};
  if (email.includes('@')) out.email = email;

  const extraByEmail = email ? contactMap[email] : undefined;
  const extraByName = nameKey ? contactMap[nameKey] : undefined;
  if (extraByEmail?.phone) out.phone = extraByEmail.phone;
  else if (extraByName?.phone) out.phone = extraByName.phone;
  if (extraByEmail?.whatsapp) out.whatsapp = extraByEmail.whatsapp;
  else if (extraByName?.whatsapp) out.whatsapp = extraByName.whatsapp;
  else if (out.phone) out.whatsapp = out.phone;

  let slackUserId: string | undefined;
  if (email && opMap[email]) slackUserId = opMap[email];
  if (slackUserId) {
    out.slackUserId = slackUserId;
    if (team) out.slackTeamId = team;
    const urls = slackUrls(team, slackUserId);
    out.slackDmUrl = urls.dm;
    out.slackAppUrl = urls.app;
  }

  return out;
}

/** Merge API payload into client-side channel shape. */
export function operatorChannelsFromApi(payload: {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsappUrl?: string | null;
  slackUserId?: string | null;
  slackTeamId?: string | null;
  slackDmUrl?: string | null;
  slackAppUrl?: string | null;
}): OperatorContactChannels {
  const out: OperatorContactChannels = {};
  const email = String(payload.email || '').trim().toLowerCase();
  if (email.includes('@')) out.email = email;
  if (payload.phone) {
    let p = String(payload.phone).trim();
    const digits = p.replace(/\D/g, '');
    if (digits.length === 8) p = `+965${digits}`;
    else if (digits.startsWith('965') && !p.startsWith('+')) p = `+${digits}`;
    out.phone = p;
  }
  if (payload.whatsapp) {
    let w = String(payload.whatsapp).trim();
    const digits = w.replace(/\D/g, '');
    if (digits.length === 8) w = `+965${digits}`;
    else if (digits.startsWith('965') && !w.startsWith('+')) w = `+${digits}`;
    out.whatsapp = w;
  } else if (payload.whatsappUrl) {
    const m = String(payload.whatsappUrl).match(/wa\.me\/(\d+)/);
    if (m?.[1]) out.whatsapp = m[1];
  }
  else if (out.phone) out.whatsapp = out.phone;
  if (payload.slackUserId) out.slackUserId = String(payload.slackUserId).trim();
  if (payload.slackTeamId) out.slackTeamId = String(payload.slackTeamId).trim();
  if (payload.slackDmUrl) out.slackDmUrl = String(payload.slackDmUrl);
  if (payload.slackAppUrl) out.slackAppUrl = String(payload.slackAppUrl);
  return out;
}

export function mailtoOperatorUrl(email: string, subject: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

export function telOperatorUrl(phone: string): string {
  const p = phone.trim();
  return p.startsWith('tel:') ? p : `tel:${p}`;
}

export function whatsappOperatorUrl(phoneOrWa: string): string {
  const d = digitsOnly(phoneOrWa);
  return d ? `https://wa.me/${d}` : '#';
}

export function slackOperatorUrl(teamId: string, userId: string): string {
  return slackAppRedirectUserUrl(teamId, userId);
}
