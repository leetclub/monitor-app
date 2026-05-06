/**
 * Overall table columns (operator-facing).
 *
 * Some metrics are not wired yet; those render `—` until backend data is available.
 */
export const OVERALL_XLSX_ORDER = [
  'operatingHours',
  'vendingMachine',
  'operator',
  'attendance',
  'lastCleaned',
  'lastVendFailed',
  'lastTransaction',
  'salesTrend',
  'targetAchieved',
  'peakHours',
  'promotion',
  'highestProduct',
  'lowestProduct',
  'peopleCount',
  'customerCalls',
  'mostIssue',
  'lastQaCheck',
  'lastTechCheck',
  'wastagePct',
  'promotionRuns',
] as const;

export type OverallColumnKey = (typeof OVERALL_XLSX_ORDER)[number];

export const OVERALL_COLUMNS: Record<OverallColumnKey, { title: string; note?: string }> = {
  operatingHours: { title: 'Operating Hours' },
  vendingMachine: { title: 'Vending Machine' },
  operator: { title: 'Operator' },
  attendance: { title: 'Attendance', note: 'Shift clock-in (not connected yet).' },
  lastCleaned: { title: 'Last Cleaned', note: 'Cleaning vs schedule (not connected yet).' },
  lastVendFailed: { title: 'Last Vend Failed', note: 'Vend failure timestamp (not connected yet).' },
  lastTransaction: { title: 'Last Transaction' },
  salesTrend: { title: 'Sales Trend', note: 'Today vs yesterday (not connected yet).' },
  targetAchieved: { title: 'Target Achieved', note: 'Target % (not connected yet).' },
  peakHours: { title: 'Peak Hours', note: 'Peak sales hours (not connected yet).' },
  promotion: { title: 'Promotion', note: 'Promoted product / sales (not connected yet).' },
  highestProduct: { title: 'Highest Product', note: 'Top product (not connected yet).' },
  lowestProduct: { title: 'Lowest Product', note: 'Lowest product (not connected yet).' },
  peopleCount: { title: 'People Count', note: 'Footfall (not connected yet).' },
  customerCalls: { title: 'Customer Calls', note: 'Customer calls (not connected yet).' },
  mostIssue: { title: 'Most Issue', note: 'Most common issue (not connected yet).' },
  lastQaCheck: { title: 'Last QA Check', note: 'QA visit (not connected yet).' },
  lastTechCheck: { title: 'Last Tech. Check', note: 'Technician visit (not connected yet).' },
  wastagePct: { title: 'Wastage %', note: 'Wastage % (not connected yet).' },
  promotionRuns: { title: 'Promotion Runs', note: 'Promotion runs (not connected yet).' },
};

