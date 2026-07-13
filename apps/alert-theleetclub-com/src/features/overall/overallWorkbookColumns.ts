/**
 * Overall table columns (operator-facing).
 *
 * Some metrics are not wired yet; those render `—` until backend data is available.
 */
export const OVERALL_XLSX_ORDER = [
  'operatingHours',
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'attendance',
  'lastCleaned',
  'lastVendFailed',
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
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

/** iPad / compact — essential fleet metrics without wide horizontal scroll. */
export const OVERALL_COMPACT_ORDER: OverallColumnKey[] = [
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
  'lastCleaned',
  'mostIssue',
  'peopleCount',
  'wastagePct',
];

export function overallHeaderLabel(key: OverallColumnKey): string {
  return OVERALL_COLUMNS[key].title;
}

/** Compact thead labels — legacy; prefer overallHeaderLabel. */
export const OVERALL_HEADER_SHORT: Record<OverallColumnKey, string> = {
  operatingHours: 'Op. hours',
  vendingMachine: 'Machine',
  operator: 'Operator',
  operatorActivity: 'Op. activity',
  attendance: 'Attendance',
  lastCleaned: 'Last cleaned',
  lastVendFailed: 'Vend failed',
  lastTransaction: 'Last tx',
  salesTrend: 'Daily sales',
  mtdSales: 'MTD sales',
  mtdYoySales: 'MTD vs LY',
  targetAchieved: 'Target',
  peakHours: 'Peak hours',
  promotion: 'Promotion',
  highestProduct: 'Top product',
  lowestProduct: 'Low product',
  peopleCount: 'Footfall',
  customerCalls: 'Calls',
  mostIssue: 'Most issue',
  lastQaCheck: 'QA check',
  lastTechCheck: 'Tech check',
  wastagePct: 'Wastage %',
  promotionRuns: 'Promo runs',
};

export const OVERALL_COLUMNS: Record<OverallColumnKey, { title: string; note?: string }> = {
  operatingHours: {
    title: 'Operating Hours',
    note:
      'Alert Admin machine profile: location hours preset (9 / 12 / 16 / 24) and location owner. If owner is empty, Vendon fleet tag is shown.',
  },
  vendingMachine: { title: 'Vending Machine' },
  operator: { title: 'Operator' },
  operatorActivity: {
    title: 'Operator Activity',
    note: 'Most recent operator touch on the machine (cleaning / refill / remote credit / door) with Kuwait date.',
  },
  attendance: { title: 'Attendance', note: 'Task Manager schedule + punch status (tap for MTD detail).' },
  lastCleaned: {
    title: 'Last Cleaned',
    note: 'Red Alert snapshot lastCleaningAt when set (from operational feed / dashboard).',
  },
  lastVendFailed: {
    title: 'Last Vend Failed',
    note: 'Dispense fail counts from Red Alert snapshot frequency (today / WTD), not a single timestamp.',
  },
  lastTransaction: { title: 'Last Transaction' },
  salesTrend: {
    title: 'Daily sales',
    note: 'Kuwait today so far (KD) vs yesterday until the same clock time when you opened the page. Tap header to sort today sales high→low.',
  },
  mtdSales: {
    title: 'MTD sales',
    note: 'Vendon month-to-date sales (KD). Tap header to sort MTD sales high→low.',
  },
  mtdYoySales: {
    title: 'Month vs last year',
    note:
      'This month’s sales through today (Kuwait) vs the same calendar days last year, with % change up or down.',
  },
  targetAchieved: { title: 'Target Achieved', note: 'Target % (not connected yet).' },
  peakHours: {
    title: 'Peak Hours',
    note: 'Busiest sales hour today (Kuwait) from Vendon vends cache. Shows yesterday when today has no vends yet.',
  },
  promotion: { title: 'Promotion', note: 'Promoted product / sales (not connected yet).' },
  highestProduct: {
    title: 'Highest Product',
    note: 'Top-selling SKU today from Vendon daily revenue cache.',
  },
  lowestProduct: {
    title: 'Lowest Product',
    note: 'Lowest-selling SKU today from Vendon daily revenue cache.',
  },
  peopleCount: {
    title: 'People Count',
    note: 'Videoloft footfall → people-api DB (people_in daily); same mapping as Monitor v1 peopleCameraToMachineMap.',
  },
  customerCalls: { title: 'Customer Calls', note: 'Customer calls (not connected yet).' },
  mostIssue: {
    title: 'Most Issue',
    note: 'Latest Red Alert reason line when this machine is on the Red Flags board.',
  },
  lastQaCheck: { title: 'Last QA Check', note: 'Last QC inspection (Ismail / QC inspectors) from SafetyCulture.' },
  lastTechCheck: { title: 'Last Tech. Check', note: 'Last technician inspection (Harout / tech inspectors) from SafetyCulture.' },
  wastagePct: { title: 'Wastage %', note: 'Wastage % (not connected yet).' },
  promotionRuns: { title: 'Promotion Runs', note: 'Promotion runs (not connected yet).' },
};

