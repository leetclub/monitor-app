import { isEmailLikeDisplayName, pickAreaOwnerDisplayName } from '@/features/footfall/lib/areaOwnerLogin';

const API = import.meta.env.VITE_PEOPLE_API_BASE ?? '';

export type TargetSiteRole = 'admin' | 'area_owner';

export type TargetSiteSession = {
  ok: boolean;
  role?: TargetSiteRole;
  user?: string;
  vendonUserId?: string;
  vendonUserName?: string;
};

export async function fetchTargetSiteSession(): Promise<TargetSiteSession> {
  const r = await fetch(`${API}/api/target-site/session`, { credentials: 'include' });
  if (!r.ok) return { ok: false };
  return (await r.json()) as TargetSiteSession;
}

export type TargetSiteLoginIntent = 'admin' | 'area_owner';

export async function loginTargetSiteArea(user: string, password: string): Promise<TargetSiteSession> {
  const trimmed = user.trim().toLowerCase();
  const r = await fetch(`${API}/api/target-site/login-area`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: trimmed, password }),
  });
  const j = (await r.json().catch(() => ({}))) as TargetSiteSession & { error?: string };
  if (!r.ok) {
    throw new Error(j.error || `Login failed (${r.status})`);
  }
  return j;
}

export async function loginTargetSite(
  user: string,
  password: string,
  opts?: { intent?: TargetSiteLoginIntent },
): Promise<TargetSiteSession> {
  const trimmed = user.trim();
  const normalized =
    trimmed.includes('@') && !trimmed.toLowerCase().startsWith('admin')
      ? trimmed.toLowerCase()
      : trimmed;
  const r = await fetch(`${API}/api/target-site/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: normalized,
      password,
      intent: opts?.intent ?? 'admin',
    }),
  });
  const j = (await r.json().catch(() => ({}))) as TargetSiteSession & { error?: string };
  if (!r.ok) {
    throw new Error(j.error || `Login failed (${r.status})`);
  }
  return j;
}

export async function logoutTargetSite(): Promise<void> {
  await fetch(`${API}/api/target-site/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export function isTargetSiteAdmin(session: TargetSiteSession | null | undefined): boolean {
  return Boolean(session?.ok && session.role === 'admin');
}

export function isAreaOwnerSession(session: TargetSiteSession | null | undefined): boolean {
  return Boolean(session?.ok && session.role === 'area_owner');
}

/** Human-readable area owner label — never the login email. */
export function areaOwnerDisplayName(
  session: TargetSiteSession | null | undefined,
  fallback = 'Area owner',
): string {
  const picked = pickAreaOwnerDisplayName(session?.vendonUserName, session?.user);
  if (picked) return picked;
  const raw = session?.vendonUserName?.trim() || session?.user?.trim();
  if (raw && isEmailLikeDisplayName(raw)) {
    const local = raw.split('@')[0]?.replace(/[._]/g, ' ').trim();
    if (local) return local.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return fallback;
}
