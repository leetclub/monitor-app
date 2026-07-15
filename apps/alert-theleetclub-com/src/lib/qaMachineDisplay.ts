import { normKey, qaMachineNamesMatch } from '@/lib/qaMachineAliases';

/** Operator-facing canonical labels when Vendon/SC use a known misspelling. */
const DISPLAY_CANONICAL: Record<string, string> = {
  // normKey folds enginnering→engineering; accept both spellings.
  'ku engineering': 'KU Engineering',
  'ku engineering j': 'KU Engineering J',
  'ku enginnering': 'KU Engineering',
  'ku enginnering j': 'KU Engineering J',
};

/** Primary fleet/workspace label — always prefer canonical Vendon spelling. */
export function canonicalQaMachineLabel(name: string): string {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  return DISPLAY_CANONICAL[normKey(raw)] ?? raw;
}

/** Secondary SC site line when it differs from the canonical machine label. */
export function scLocationSubtitle(
  machineName: string,
  scLocation: string | null | undefined,
): string | null {
  const sc = String(scLocation || '').trim();
  if (!sc) return null;
  const machineCanon = canonicalQaMachineLabel(machineName);
  if (qaMachineNamesMatch(sc, machineName) || qaMachineNamesMatch(sc, machineCanon)) return null;
  return `SC: ${sc}`;
}
