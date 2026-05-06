/**
 * Slack client deep link to open a DM with a user (public IDs only — still treat as sensitive).
 * @see https://api.slack.com/reference/deep-linking
 */
export function slackUserDmUrl(teamId: string, userId: string): string {
  const t = teamId.trim();
  const u = userId.trim();
  if (!t || !u) return '';
  const q = new URLSearchParams({ team: t, id: u });
  return `slack://user?${q.toString()}`;
}

/** Optional https fallback for environments that block custom URL schemes. */
export function slackAppRedirectUserUrl(teamId: string, userId: string): string {
  const t = teamId.trim();
  const u = userId.trim();
  if (!t || !u) return '';
  const q = new URLSearchParams({ team: t, user: u });
  return `https://slack.com/app_redirect?${q.toString()}`;
}

export function parseEmailToSlackUserMap(raw: string | undefined): Record<string, string> {
  if (!raw || !String(raw).trim()) return {};
  try {
    const j = JSON.parse(String(raw)) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const email = String(k || '')
        .trim()
        .toLowerCase();
      const uid = String(v ?? '').trim();
      if (email.includes('@') && uid.startsWith('U')) out[email] = uid;
    }
    return out;
  } catch {
    return {};
  }
}
