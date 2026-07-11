import { RED_FLAGS_XLSX_ORDER, type RedFlagsColumnKey } from './redFlagsWorkbookColumns';

export type RedFlagsColumnFamily = 'machine' | 'sales' | 'people' | 'alerts' | 'action';

export type RedFlagsColumnUiMeta = {
  abbr: string;
  label: string;
  family: RedFlagsColumnFamily;
  pinned?: boolean;
};

export const RED_FLAGS_COLUMN_UI: Record<RedFlagsColumnKey, RedFlagsColumnUiMeta> = {
  vendingMachine: { abbr: 'Mchn', label: 'Machine', family: 'machine', pinned: true },
  alertType: { abbr: 'Alert', label: 'Alert type', family: 'alerts' },
  operator: { abbr: 'Op', label: 'Operator', family: 'people' },
  operatorActivity: { abbr: 'Door', label: 'Op. activity', family: 'people' },
  lastTransaction: { abbr: 'Tx', label: 'Last tx', family: 'alerts' },
  dailySales: { abbr: 'Today', label: 'Sales today', family: 'sales' },
  mtdSales: { abbr: 'MTD', label: 'Sales MTD', family: 'sales' },
  mtdYoySales: { abbr: 'YoY', label: 'YoY month', family: 'sales' },
  dailyTarget: { abbr: 'Tgt', label: 'Target', family: 'sales' },
  salesAcceleration: { abbr: 'SX', label: 'Sales accel.', family: 'sales' },
  frequency: { abbr: 'Freq', label: 'Frequency', family: 'alerts' },
  goCheck: { abbr: 'GO', label: 'GO CHECK', family: 'action' },
  sendCredit: { abbr: 'Cr', label: 'Credits', family: 'alerts' },
  vendsResolved: { abbr: 'Vend', label: 'Vends OK', family: 'alerts' },
  testCredits: { abbr: 'Test', label: 'Dispense', family: 'alerts' },
  lastCleaning: { abbr: 'Clean', label: 'Cleaning', family: 'alerts' },
  qaVisit: { abbr: 'QA', label: 'QA visit', family: 'alerts' },
  techVisit: { abbr: 'Tech', label: 'Tech visit', family: 'alerts' },
  callOp: { abbr: 'C-OP', label: 'Call OP', family: 'action' },
  callAm: { abbr: 'C-AM', label: 'Call AM', family: 'action' },
};

/** Table order for the interactive ribbon. */
export const RED_FLAGS_RIBBON_ORDER: RedFlagsColumnKey[] = [...RED_FLAGS_XLSX_ORDER];

export const RED_FLAGS_FAMILY_LABEL: Record<RedFlagsColumnFamily, string> = {
  machine: 'Machine',
  sales: 'Sales',
  people: 'People',
  alerts: 'Alerts',
  action: 'Actions',
};
