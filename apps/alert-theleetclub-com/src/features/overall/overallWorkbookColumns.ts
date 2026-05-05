/**
 * Column titles from **alert.theleetclub.com.xlsx** → sheet **Overall** → row 1 (after **Aspect**).
 *
 * Many columns are not wired yet (Workbook says “from Vendon / API / Workflow”); those render `—`
 * until people-api exposes the needed fields.
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
  attendance: { title: 'Attendance', note: 'Workbook: from Admin tab (shift clock-in) — API pending.' },
  lastCleaned: { title: 'Last Cleaned', note: 'Workbook: from Monitor, compared to cleaning schedule — API pending.' },
  lastVendFailed: { title: 'Last Vend Failed', note: 'Workbook: from Vendon — API pending.' },
  lastTransaction: { title: 'Last Transaction' },
  salesTrend: { title: 'Sales Trend', note: 'Workbook: Today vs Yesterday cups + % — API pending.' },
  targetAchieved: { title: 'Target Achieved', note: 'Workbook: target % — API pending.' },
  peakHours: { title: 'Peak Hours', note: 'Workbook: peak sales hours — API pending.' },
  promotion: { title: 'Promotion', note: 'Workbook: promoted product/sales — API pending.' },
  highestProduct: { title: 'Highest Product', note: 'Workbook: from Vendon — API pending.' },
  lowestProduct: { title: 'Lowest Product', note: 'Workbook: from Vendon — API pending.' },
  peopleCount: { title: 'People Count', note: 'Workbook: vs yesterday % — API pending.' },
  customerCalls: { title: 'Customer Calls', note: 'Workbook: API — pending.' },
  mostIssue: { title: 'Most Issue', note: 'Workbook: API — pending.' },
  lastQaCheck: { title: 'Last QA Check', note: 'Workbook: Workflow API — pending.' },
  lastTechCheck: { title: 'Last Tech. Check', note: 'Workbook: Workflow API — pending.' },
  wastagePct: { title: 'Wastage %', note: 'Workbook: Workflow API — pending.' },
  promotionRuns: { title: 'Promotion Runs', note: 'Workbook: Workflow API — pending.' },
};

