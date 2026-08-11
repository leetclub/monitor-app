import type { VendonUserRow } from '@/features/footfall/lib/areaOwnersApi';

/** Areas tab login id = Vendon user email (normalized). */
export function areaOwnerLoginEmail(user: VendonUserRow | undefined): string | null {
  const email = (user?.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return email;
}

export function isEmailLikeDisplayName(value: string | undefined | null): boolean {
  const s = (value ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/** First candidate that is not an email address. */
export function pickAreaOwnerDisplayName(
  ...candidates: (string | undefined | null)[]
): string {
  for (const c of candidates) {
    const s = c?.trim();
    if (s && !isEmailLikeDisplayName(s)) return s;
  }
  return '';
}
