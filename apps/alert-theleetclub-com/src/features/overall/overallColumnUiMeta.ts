import { OVERALL_XLSX_ORDER, type OverallColumnKey } from './overallWorkbookColumns';

export type OverallColumnFamily = 'machine' | 'sales' | 'people' | 'ops';

export type OverallColumnUiMeta = {
  abbr: string;
  label: string;
  family: OverallColumnFamily;
  pinned?: boolean;
};

export const OVERALL_COLUMN_UI: Record<OverallColumnKey, OverallColumnUiMeta> = {
  operatingHours: { abbr: 'Hrs', label: 'Op. hours', family: 'ops' },
  vendingMachine: { abbr: 'Mchn', label: 'Machine', family: 'machine', pinned: true },
  operator: { abbr: 'Op', label: 'Operator', family: 'people' },
  operatorActivity: { abbr: 'Door', label: 'Op. activity', family: 'people' },
  attendance: { abbr: 'Att', label: 'Attendance', family: 'people' },
  lastCleaned: { abbr: 'Clean', label: 'Last cleaned', family: 'ops' },
  lastVendFailed: { abbr: 'Fail', label: 'Vend failed', family: 'ops' },
  downtime: { abbr: 'Down', label: 'Downtime', family: 'ops' },
  lastTransaction: { abbr: 'Tx', label: 'Last tx', family: 'ops' },
  salesTrend: { abbr: 'Today', label: 'Daily sales', family: 'sales' },
  mtdSales: { abbr: 'MTD', label: 'MTD sales', family: 'sales' },
  mtdYoySales: { abbr: 'YoY', label: 'MTD vs LY', family: 'sales' },
  targetAchieved: { abbr: 'Tgt', label: 'Target', family: 'sales' },
  peakHours: { abbr: 'Peak', label: 'Peak hours', family: 'sales' },
  promotion: { abbr: 'Promo', label: 'Promotion', family: 'sales' },
  highestProduct: { abbr: 'Top', label: 'Top product', family: 'sales' },
  lowestProduct: { abbr: 'Low', label: 'Low product', family: 'sales' },
  peopleCount: { abbr: 'Foot', label: 'Footfall', family: 'people' },
  customerCalls: { abbr: 'Call', label: 'Calls', family: 'people' },
  mostIssue: { abbr: 'Issue', label: 'Most issue', family: 'ops' },
  lastQaCheck: { abbr: 'QA', label: 'QA check', family: 'ops' },
  lastTechCheck: { abbr: 'Tech', label: 'Tech check', family: 'ops' },
  wastagePct: { abbr: 'Waste', label: 'Wastage %', family: 'ops' },
  promotionRuns: { abbr: 'Runs', label: 'Promo runs', family: 'sales' },
};

export const OVERALL_RIBBON_ORDER: OverallColumnKey[] = [...OVERALL_XLSX_ORDER];
