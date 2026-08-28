import {
  RED_FLAGS_XLSX_ORDER,
  type RedFlagsColumnKey,
} from './redFlagsWorkbookColumns';

export type RedFlagsColumnPreset = 'all' | 'sales' | 'alerts' | 'custom';

/** Total workbook columns (machine + data columns). */
export const RED_FLAGS_TOTAL_COLUMNS = RED_FLAGS_XLSX_ORDER.length;

/** Bump when new workbook columns must appear for existing localStorage presets. */
export const RED_FLAGS_COLUMNS_STORAGE_KEY = 'alert_redflags_column_preset_v3';

/** Machine column is always shown. */
export const RED_FLAGS_PINNED_COLUMN: RedFlagsColumnKey = 'vendingMachine';

/** Always on the board (after Daily sales when that column is present). */
export const RED_FLAGS_ALWAYS_VISIBLE: RedFlagsColumnKey[] = ['topLowDrinks'];

export const RED_FLAGS_PRESET_SALES: RedFlagsColumnKey[] = [
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'dailySales',
  'topLowDrinks',
  'mtdSales',
  'mtdYoySales',
  'dailyTarget',
  'salesAcceleration',
];

export const RED_FLAGS_PRESET_ALERTS: RedFlagsColumnKey[] = [
  'vendingMachine',
  'operatingHours',
  'alertType',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'topLowDrinks',
  'frequency',
  'downtime',
  'goCheck',
  'sendCredit',
  'vendsResolved',
  'testCredits',
  'lastCleaning',
  'qaVisit',
  'techVisit',
  'callOp',
  'callAm',
];

export type RedFlagsColumnGroupId = 'sales' | 'people' | 'alerts';

export const RED_FLAGS_COLUMN_GROUPS: Record<
  RedFlagsColumnGroupId,
  { label: string; help: string; keys: RedFlagsColumnKey[] }
> = {
  sales: {
    label: 'Sales & targets',
    help:
      'Today vs yesterday (elapsed Kuwait clock), month-to-date, YoY month MTD with % vs same days last year, and daily target progress. Tap Sales today / MTD headers to sort high→low.',
    keys: ['dailySales', 'topLowDrinks', 'mtdSales', 'mtdYoySales', 'dailyTarget', 'salesAcceleration'],
  },
  people: {
    label: 'People',
    help: 'Operating hours (Admin), live operator contact, and last WEB machine open (operator activity).',
    keys: ['operatingHours', 'operator', 'operatorActivity'],
  },
  alerts: {
    label: 'Alerts, trend & ops',
    help:
      'Why the machine is flagged, Frequency (score · trend · gap — follows compare preset), Downtime (today · period), GO CHECK, credits sent, vends resolved, dispense tests, cleaning, QA/Tech visits, Call OP/AM.',
    keys: [
      'alertType',
      'lastTransaction',
      'frequency',
      'downtime',
      'goCheck',
      'sendCredit',
      'vendsResolved',
      'testCredits',
      'lastCleaning',
      'qaVisit',
      'techVisit',
      'callOp',
      'callAm',
    ],
  },
};

export const RED_FLAGS_SALES_FOCUS_HELP =
  'Sales focus — Today vs yesterday (elapsed Kuwait clock), month-to-date, YoY month MTD with % vs same days last year, and daily target progress. Tap Sales today / MTD headers to sort high→low.';

export const RED_FLAGS_ALERTS_FOCUS_HELP =
  'Alerts focus — Why the machine is flagged, Frequency (score · trend · gap), Downtime (today · period), GO CHECK, credits, vends resolved, dispense tests, cleaning, QA/Tech visits, Call OP/AM. Includes operator columns for follow-up.';

export type StoredRedFlagsColumns = {
  preset: RedFlagsColumnPreset;
  custom: RedFlagsColumnKey[];
};

export function defaultStoredRedFlagsColumns(): StoredRedFlagsColumns {
  return { preset: 'all', custom: [...RED_FLAGS_XLSX_ORDER] };
}

export function normalizeStoredRedFlagsColumns(raw: Partial<StoredRedFlagsColumns> | null | undefined): StoredRedFlagsColumns {
  if (!raw) return defaultStoredRedFlagsColumns();
  const preset = raw.preset;
  if (preset !== 'all' && preset !== 'sales' && preset !== 'alerts' && preset !== 'custom') {
    return defaultStoredRedFlagsColumns();
  }
  const orderSet = new Set(RED_FLAGS_XLSX_ORDER);
  let custom = (raw.custom ?? []).filter((k): k is RedFlagsColumnKey => orderSet.has(k as RedFlagsColumnKey));
  if (!custom.includes(RED_FLAGS_PINNED_COLUMN)) custom.unshift(RED_FLAGS_PINNED_COLUMN);
  if (!custom.includes('lastTransaction')) {
    const afterOp = custom.indexOf('operatorActivity');
    if (afterOp >= 0) custom.splice(afterOp + 1, 0, 'lastTransaction');
    else custom.push('lastTransaction');
    custom = RED_FLAGS_XLSX_ORDER.filter((k) => custom.includes(k));
  }
  // Migrated workbook columns: insert after a neighbor when the old save omitted them.
  if (custom.includes('dailySales') && !custom.includes('topLowDrinks')) {
    const afterSales = custom.indexOf('dailySales');
    custom.splice(afterSales + 1, 0, 'topLowDrinks');
  }
  custom = RED_FLAGS_XLSX_ORDER.filter((k) => custom.includes(k));
  return { preset, custom: custom.length ? custom : [...RED_FLAGS_XLSX_ORDER] };
}

export function loadStoredRedFlagsColumns(): StoredRedFlagsColumns {
  if (typeof window === 'undefined') return defaultStoredRedFlagsColumns();
  try {
    const raw =
      localStorage.getItem(RED_FLAGS_COLUMNS_STORAGE_KEY) ||
      localStorage.getItem('alert_redflags_column_preset_v1');
    if (!raw) return defaultStoredRedFlagsColumns();
    const normalized = normalizeStoredRedFlagsColumns(JSON.parse(raw) as StoredRedFlagsColumns);
    // Persist under v2 so migration (e.g. topLowDrinks) sticks after first load.
    persistRedFlagsColumns(normalized);
    try {
      localStorage.removeItem('alert_redflags_column_preset_v1');
    } catch {
      /* ignore */
    }
    return normalized;
  } catch {
    return defaultStoredRedFlagsColumns();
  }
}

export function persistRedFlagsColumns(stored: StoredRedFlagsColumns): void {
  try {
    localStorage.setItem(RED_FLAGS_COLUMNS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export function visibleRedFlagsColumns(stored: StoredRedFlagsColumns): RedFlagsColumnKey[] {
  let keys: RedFlagsColumnKey[];
  if (stored.preset === 'sales') keys = [...RED_FLAGS_PRESET_SALES];
  else if (stored.preset === 'alerts') keys = [...RED_FLAGS_PRESET_ALERTS];
  else if (stored.preset === 'custom') keys = [...stored.custom];
  else keys = [...RED_FLAGS_XLSX_ORDER];

  // Board must always show Top/low drink — never depend on picker preset.
  for (const k of RED_FLAGS_ALWAYS_VISIBLE) {
    if (!keys.includes(k)) keys.push(k);
  }

  const seen = new Set<RedFlagsColumnKey>();
  const out: RedFlagsColumnKey[] = [];
  for (const k of RED_FLAGS_XLSX_ORDER) {
    if (!keys.includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  if (!out.includes(RED_FLAGS_PINNED_COLUMN)) out.unshift(RED_FLAGS_PINNED_COLUMN);
  return out;
}

export function toggleCustomColumn(
  custom: RedFlagsColumnKey[],
  key: RedFlagsColumnKey,
  on: boolean,
): RedFlagsColumnKey[] {
  if (key === RED_FLAGS_PINNED_COLUMN) return custom.includes(key) ? custom : [RED_FLAGS_PINNED_COLUMN, ...custom];
  if (RED_FLAGS_ALWAYS_VISIBLE.includes(key) && !on) {
    // Cannot hide always-visible board columns.
    return RED_FLAGS_XLSX_ORDER.filter((k) => custom.includes(k) || RED_FLAGS_ALWAYS_VISIBLE.includes(k) || k === RED_FLAGS_PINNED_COLUMN);
  }
  const set = new Set(custom);
  if (on) set.add(key);
  else set.delete(key);
  set.add(RED_FLAGS_PINNED_COLUMN);
  for (const k of RED_FLAGS_ALWAYS_VISIBLE) set.add(k);
  return RED_FLAGS_XLSX_ORDER.filter((k) => set.has(k));
}

export function storedForPreset(preset: RedFlagsColumnPreset): StoredRedFlagsColumns {
  if (preset === 'sales') return { preset: 'sales', custom: [...RED_FLAGS_PRESET_SALES] };
  if (preset === 'alerts') return { preset: 'alerts', custom: [...RED_FLAGS_PRESET_ALERTS] };
  if (preset === 'custom') return { preset: 'custom', custom: [...RED_FLAGS_XLSX_ORDER] };
  return defaultStoredRedFlagsColumns();
}

export function setGroupColumns(
  custom: RedFlagsColumnKey[],
  groupKeys: RedFlagsColumnKey[],
  on: boolean,
): RedFlagsColumnKey[] {
  const set = new Set(custom);
  for (const k of groupKeys) {
    if (k === RED_FLAGS_PINNED_COLUMN) continue;
    if (RED_FLAGS_ALWAYS_VISIBLE.includes(k) && !on) continue;
    if (on) set.add(k);
    else set.delete(k);
  }
  set.add(RED_FLAGS_PINNED_COLUMN);
  for (const k of RED_FLAGS_ALWAYS_VISIBLE) set.add(k);
  return RED_FLAGS_XLSX_ORDER.filter((k) => set.has(k));
}
