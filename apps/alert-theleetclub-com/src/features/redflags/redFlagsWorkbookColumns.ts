/** Red Flags board columns (operator-facing). */
export const RED_FLAGS_XLSX_ORDER = [
  'vendingMachine',
  'alertType',
  'operator',
  'operatorActivity',
  'lastTransaction',
  'dailySales',
  'mtdSales',
  'mtdYoySales',
  'dailyTarget',
  'salesAcceleration',
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

/** Visible thead label — full workbook title (tooltip adds column note). */
export function redFlagsHeaderLabel(key: RedFlagsColumnKey): string {
  return RED_FLAGS_COLUMNS[key].title;
}

/** Compact thead labels — legacy; prefer redFlagsHeaderLabel. */
export const RED_FLAGS_HEADER_SHORT: Record<RedFlagsColumnKey, string> = {
  vendingMachine: 'Machine',
  alertType: 'Alert type',
  operator: 'Operator',
  operatorActivity: 'Op. activity',
  lastTransaction: 'Last tx',
  dailySales: 'Daily sales',
  mtdSales: 'MTD sales',
  mtdYoySales: 'MTD vs LY',
  dailyTarget: 'Target',
  salesAcceleration: 'SX',
  frequency: 'Frequency',
  goCheck: 'GO CHECK',
  sendCredit: 'Credits sent',
  vendsResolved: 'Vends resolved',
  testCredits: 'Dispense tests',
  lastCleaning: 'Last cleaning',
  qaVisit: 'QA visit',
  techVisit: 'Tech visit',
  callOp: 'Call OP',
  callAm: 'Call AM',
};

export function redFlagsHeaderTooltip(key: RedFlagsColumnKey): string {
  const c = RED_FLAGS_COLUMNS[key];
  return c.sub ? `${c.title} — ${c.sub}` : c.title;
}

export const RED_FLAGS_COLUMNS: Record<
  RedFlagsColumnKey,
  { title: string; sub: string; placeholderNote?: string }
> = {
  vendingMachine: {
    title: 'Vending Machine',
    sub: 'Name (Vendon) · ID · flags · last OFF event when distinct',
  },
  alertType: {
    title: 'Alert Type',
    sub: 'Conditions (same as Red Alert)',
  },
  operator: {
    title: 'Operator',
    sub: 'Leet Workflow schedule — name + contact',
    placeholderNote:
      'Live ops name, email/phone links. Tap for full contact modal (Slack, WhatsApp).',
  },
  operatorActivity: {
    title: 'Operator Activity',
    sub: 'Last touch · date',
    placeholderNote:
      'Most recent operator activity on the machine (cleaning, refill, remote credit, or door open from Monitor/Vendon). Shows relative time and Kuwait date/time.',
  },
  lastTransaction: {
    title: 'Last Transaction',
    sub: 'Last vend / sale (Kuwait time)',
    placeholderNote:
      'Last sale on this machine from the Red Alert snapshot (exact Kuwait time when available, or minutes since sale). Not the same as Last OFF event or Operator activity.',
  },
  dailySales: {
    title: 'Daily sales',
    sub: 'Today vs yesterday (same time)',
    placeholderNote:
      'Kuwait today through current clock vs yesterday until the same elapsed time (Vendon vends). Tap header to sort today sales high→low.',
  },
  mtdSales: {
    title: 'MTD sales',
    sub: 'Month to date (Kuwait)',
    placeholderNote:
      'Vendon month-to-date sales (KD) for this machine. Tap header to sort MTD sales high→low.',
  },
  mtdYoySales: {
    title: 'Month vs last year',
    sub: 'YoY month MTD',
    placeholderNote:
      'This month’s sales through today (Kuwait) vs the same calendar days last year, with % change up or down. Column header: YoY / month MTD.',
  },
  dailyTarget: {
    title: 'Target',
    sub: 'Today % · remaining · area owner',
    placeholderNote:
      'Daily target from Live Dashboard or week revenue target ÷ 7. Third box = area owner name. Tap for WTD detail.',
  },
  salesAcceleration: {
    title: 'Sales Acceleration',
    sub: 'SX Loc · Prod — follows compare preset',
    placeholderNote:
      'SX = current growth − previous growth. Growth = (cur − prev) / prev. Loc uses location KD sales; Prod uses cups for the Admin-linked product. Same compare preset as Sales/Target.',
  },
  frequency: {
    title: 'Frequency',
    sub: 'Score · trend · gap — follows compare preset',
  },
  goCheck: {
    title: 'GO CHECK',
    sub: 'Leet Workflow Received inbox',
    placeholderNote:
      'Leet Workflow Received inbox task "URGENT ACTION REQUIRED" with template popup (error type + message, 24h due).',
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
    placeholderNote:
      'Count of QA dispense tests (today, Kuwait): credits within 30 minutes of first WEB cashless vend of the day (same criteria as Monitor).',
  },
  lastCleaning: {
    title: 'Last Cleaning',
    sub: 'Leet Workflow cleaning video',
    placeholderNote:
      'Leet Workflow cleaning video time. Tap → Monitor-style record + EOD video. When overdue >15h, tap the alert icon for operator message preview (Slack, Email, WhatsApp, Workflow Received).',
  },
  qaVisit: {
    title: 'QA Visit',
    sub: 'SafetyCulture',
    placeholderNote:
      'Last QA inspection at this location (90-day SafetyCulture search). Tap → AI bullet summary (3–5 points) of report. Tap header to sort latest / oldest visit.',
  },
  techVisit: {
    title: 'Tech Visit',
    sub: 'Leet Workflow last visit',
    placeholderNote: 'Leet Workflow last visit. Tap → visitor + comment.',
  },
  callOp: {
    title: 'Call OP',
    sub: 'Operator contact',
    placeholderNote: 'Tap for operator email, phone, Slack, WhatsApp (Task Manager + Vendon).',
  },
  callAm: {
    title: 'Call AM',
    sub: 'Slack',
    placeholderNote: 'Opens Slack DM with Ahmed or Suhaib from the AM Plan location match + Slack user ids.',
  },
};
