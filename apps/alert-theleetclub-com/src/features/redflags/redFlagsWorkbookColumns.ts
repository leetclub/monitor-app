/** Red Flags board columns (operator-facing). */
export const RED_FLAGS_XLSX_ORDER = [
  'vendingMachine',
  'alertType',
  'operator',
  'frequency',
  'goCheck',
  'sendCredit',
  'vendsResolved',
  'testCredits',
  'lastCleaning',
  'qaVisit',
  'techVisit',
] as const;

export type RedFlagsColumnKey = (typeof RED_FLAGS_XLSX_ORDER)[number];

export const RED_FLAGS_COLUMNS: Record<
  RedFlagsColumnKey,
  { title: string; sub: string; placeholderNote?: string }
> = {
  vendingMachine: {
    title: 'Vending Machine',
    sub: 'Name (Vendon) · ID · flags · last tx / time',
  },
  alertType: {
    title: 'Alert Type',
    sub: 'Conditions (same as Red Alert)',
  },
  operator: {
    title: 'Operator',
    sub: 'From Admin tab',
  },
  frequency: {
    title: 'Frequency',
    sub: 'As-is (compare preset)',
  },
  goCheck: {
    title: 'GO CHECK',
    sub: 'Email / Workflow',
  },
  sendCredit: {
    title: 'Credits Sent',
    sub: 'Today',
    placeholderNote: 'Count of remote credits (today, Kuwait).',
  },
  vendsResolved: {
    title: 'Vends Resolved',
    sub: 'Snapshot TBD',
    placeholderNote: 'Workbook: vend fail vs remote credit timing — not wired on this board yet.',
  },
  testCredits: {
    title: 'Dispense Tests',
    sub: 'Today',
    placeholderNote: 'Count of QA dispense tests (today, Kuwait): credits within 30 minutes of first WEB cashless vend of the day (same criteria as Monitor).',
  },
  lastCleaning: {
    title: 'Last Cleaning',
    sub: 'Snapshot TBD',
    placeholderNote: 'Workbook: last cleaning vs schedule — join live dashboard / Admin in a future API.',
  },
  qaVisit: {
    title: 'QA Visit',
    sub: 'Snapshot TBD',
    placeholderNote: 'Workbook: QA visit vs permitted window — Workflow API (planned).',
  },
  techVisit: {
    title: 'Tech Visit',
    sub: 'Snapshot TBD',
    placeholderNote: 'Workbook: technician visit vs permitted window — Workflow API (planned).',
  },
};
