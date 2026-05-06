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
  'callOp',
  'callAm',
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
    sub: 'Snapshot',
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
    sub: '—',
    placeholderNote: 'Not connected yet.',
  },
  testCredits: {
    title: 'Dispense Tests',
    sub: 'Today',
    placeholderNote: 'Count of QA dispense tests (today, Kuwait): credits within 30 minutes of first WEB cashless vend of the day (same criteria as Monitor).',
  },
  lastCleaning: {
    title: 'Last Cleaning',
    sub: '—',
    placeholderNote: 'Not connected yet.',
  },
  qaVisit: {
    title: 'QA Visit',
    sub: '—',
    placeholderNote: 'Not connected yet.',
  },
  techVisit: {
    title: 'Tech Visit',
    sub: '—',
    placeholderNote: 'Not connected yet.',
  },
  callOp: {
    title: 'Call OP',
    sub: 'Slack',
    placeholderNote: 'Opens Slack DM with the operator when email→Slack user id is configured.',
  },
  callAm: {
    title: 'Call AM',
    sub: 'Slack',
    placeholderNote: 'Opens Slack DM with Ahmed or Suhaib from the AM Plan location match + Slack user ids.',
  },
};
