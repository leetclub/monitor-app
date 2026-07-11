import { OVERALL_COMPACT_ORDER, OVERALL_XLSX_ORDER, type OverallColumnKey } from './overallWorkbookColumns';

export type OverallColumnPreset = 'all' | 'essential' | 'sales' | 'ops' | 'custom';

export const OVERALL_TOTAL_COLUMNS = OVERALL_XLSX_ORDER.length;

export const OVERALL_PINNED_COLUMN: OverallColumnKey = 'vendingMachine';

export const OVERALL_PRESET_ESSENTIAL: OverallColumnKey[] = [...OVERALL_COMPACT_ORDER];

export const OVERALL_PRESET_SALES: OverallColumnKey[] = [
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
  'targetAchieved',
  'peakHours',
  'highestProduct',
  'lowestProduct',
];

export const OVERALL_PRESET_OPS: OverallColumnKey[] = [
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastCleaned',
  'lastVendFailed',
  'lastTransaction',
  'mostIssue',
  'lastQaCheck',
  'lastTechCheck',
  'peopleCount',
  'wastagePct',
  'operatingHours',
];

export type OverallColumnGroupId = 'sales' | 'people' | 'ops';

export const OVERALL_COLUMN_GROUPS: Record<
  OverallColumnGroupId,
  { label: string; help: string; keys: OverallColumnKey[] }
> = {
  sales: {
    label: 'Sales & products',
    help: 'Daily sales, MTD, YoY, target %, peak hours, top/low SKU.',
    keys: [
      'salesTrend',
      'mtdSales',
      'mtdYoySales',
      'targetAchieved',
      'peakHours',
      'highestProduct',
      'lowestProduct',
      'promotion',
      'promotionRuns',
    ],
  },
  people: {
    label: 'People',
    help: 'Operator, door activity, attendance, footfall, customer calls.',
    keys: ['operator', 'operatorActivity', 'attendance', 'peopleCount', 'customerCalls'],
  },
  ops: {
    label: 'Ops & quality',
    help: 'Hours, cleaning, vend fails, last tx, issues, QA/Tech, wastage.',
    keys: [
      'operatingHours',
      'lastCleaned',
      'lastVendFailed',
      'lastTransaction',
      'mostIssue',
      'lastQaCheck',
      'lastTechCheck',
      'wastagePct',
    ],
  },
};

export type StoredOverallColumns = {
  preset: OverallColumnPreset;
  custom: OverallColumnKey[];
};

export function defaultStoredOverallColumns(): StoredOverallColumns {
  return { preset: 'all', custom: [...OVERALL_XLSX_ORDER] };
}

export function normalizeStoredOverallColumns(raw: Partial<StoredOverallColumns> | null | undefined): StoredOverallColumns {
  if (!raw) return defaultStoredOverallColumns();
  const preset = raw.preset;
  if (preset !== 'all' && preset !== 'essential' && preset !== 'sales' && preset !== 'ops' && preset !== 'custom') {
    return defaultStoredOverallColumns();
  }
  const orderSet = new Set(OVERALL_XLSX_ORDER);
  const custom = (raw.custom ?? []).filter((k): k is OverallColumnKey => orderSet.has(k as OverallColumnKey));
  if (!custom.includes(OVERALL_PINNED_COLUMN)) custom.unshift(OVERALL_PINNED_COLUMN);
  return { preset, custom: custom.length ? custom : [...OVERALL_XLSX_ORDER] };
}

export function visibleOverallColumns(stored: StoredOverallColumns): OverallColumnKey[] {
  let keys: OverallColumnKey[];
  if (stored.preset === 'essential') keys = [...OVERALL_PRESET_ESSENTIAL];
  else if (stored.preset === 'sales') keys = [...OVERALL_PRESET_SALES];
  else if (stored.preset === 'ops') keys = [...OVERALL_PRESET_OPS];
  else if (stored.preset === 'custom') keys = [...stored.custom];
  else keys = [...OVERALL_XLSX_ORDER];

  const seen = new Set<OverallColumnKey>();
  const out: OverallColumnKey[] = [];
  for (const k of OVERALL_XLSX_ORDER) {
    if (!keys.includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  if (!out.includes(OVERALL_PINNED_COLUMN)) out.unshift(OVERALL_PINNED_COLUMN);
  return out;
}

export function toggleOverallCustomColumn(
  custom: OverallColumnKey[],
  key: OverallColumnKey,
  on: boolean,
): OverallColumnKey[] {
  if (key === OVERALL_PINNED_COLUMN) return custom.includes(key) ? custom : [OVERALL_PINNED_COLUMN, ...custom];
  const set = new Set(custom);
  if (on) set.add(key);
  else set.delete(key);
  set.add(OVERALL_PINNED_COLUMN);
  return OVERALL_XLSX_ORDER.filter((k) => set.has(k));
}

export function storedForOverallPreset(preset: OverallColumnPreset): StoredOverallColumns {
  if (preset === 'essential') return { preset: 'essential', custom: [...OVERALL_PRESET_ESSENTIAL] };
  if (preset === 'sales') return { preset: 'sales', custom: [...OVERALL_PRESET_SALES] };
  if (preset === 'ops') return { preset: 'ops', custom: [...OVERALL_PRESET_OPS] };
  if (preset === 'custom') return { preset: 'custom', custom: [...OVERALL_XLSX_ORDER] };
  return defaultStoredOverallColumns();
}

export function setOverallGroupColumns(
  custom: OverallColumnKey[],
  groupKeys: OverallColumnKey[],
  on: boolean,
): OverallColumnKey[] {
  const set = new Set(custom);
  for (const k of groupKeys) {
    if (k === OVERALL_PINNED_COLUMN) continue;
    if (on) set.add(k);
    else set.delete(k);
  }
  set.add(OVERALL_PINNED_COLUMN);
  return OVERALL_XLSX_ORDER.filter((k) => set.has(k));
}
