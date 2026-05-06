/**
 * Area-manager buckets from the AM Plan (operator ↔ locations).
 * Matching uses the vending machine **name** from Red Alert / Vendon (substring match, longest first).
 */
export type AreaManagerKey = 'ahmed' | 'suhaib';

/** Locations under **Ahmed** (column 1). */
export const AHMED_AREA_LABELS = [
  'Adan',
  'Mubarak',
  'Ku Medical',
  'Amiri',
  'Jaber',
  'Gust',
  'AU',
  'Kuwait Fund',
  'O2 Jabriya',
  'Khaldiya',
  'O2 Adaliya',
  'O2 Mahboula',
  'O2 Sabah Salem',
  'Al Salam Casualty',
  'AlDahman',
] as const;

/** Locations under **Suhaib** (column 2). */
export const SUHAIB_AREA_LABELS = [
  'Jahra',
  'Farwaniya',
  'Ku University',
  'AOU',
  'Razi',
  'Maternity',
  'Ku Shuwaikh',
  'Moh Main',
  'O2 Riggae',
  'Military Base',
  'Kcst',
  'AIU',
  'Medical Warehouse',
  'Dahia',
] as const;

function compactAlphaNum(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolve area manager from machine display name.
 * Returns null when no label matches (configure Slack IDs only after this resolves).
 */
export function resolveAreaManagerFromMachineName(machineName: string): AreaManagerKey | null {
  const raw = String(machineName || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const compact = compactAlphaNum(raw);

  type Cand = { needle: string; am: AreaManagerKey };
  const cands: Cand[] = [
    ...AHMED_AREA_LABELS.map((needle) => ({ needle: String(needle), am: 'ahmed' as const })),
    ...SUHAIB_AREA_LABELS.map((needle) => ({ needle: String(needle), am: 'suhaib' as const })),
  ];
  cands.sort((a, b) => b.needle.length - a.needle.length);

  for (const { needle, am } of cands) {
    const nLow = needle.toLowerCase().trim();
    if (!nLow) continue;
    if (lower.includes(nLow)) return am;
    const nCompact = compactAlphaNum(needle);
    if (nCompact.length >= 3 && compact.includes(nCompact)) return am;
  }
  return null;
}
