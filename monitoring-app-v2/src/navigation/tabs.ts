/**
 * Mirrors monitoring-app (GAS) main/sub tab structure and auth-access ALL_DASHBOARD_TAB_IDS.
 * Route path is `/tab/:tabId` where tabId matches data-dashboard-tab / server rules.
 *
 * Parity: each id will get a real React implementation under src/features/<id>/ (standalone v2).
 * See REFACTOR-SCOPE.txt in the v2 repo root.
 */

export type MainSectionId =
  | 'operation'
  | 'sales'
  | 'qa'
  | 'rd'
  | 'hr'
  | 'strategy'
  | 'crm';

export interface TabDefinition {
  id: string;
  label: string;
  main: MainSectionId;
  /** Short note for placeholder pages — replace when porting real UI */
  description: string;
}

export const MAIN_SECTIONS: { id: MainSectionId; label: string }[] = [
  { id: 'operation', label: 'Operation' },
  { id: 'sales', label: 'Sales' },
  { id: 'qa', label: 'QA' },
  { id: 'rd', label: 'R&D' },
  { id: 'hr', label: 'HR' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'crm', label: 'CRM' },
];

export const TABS: TabDefinition[] = [
  {
    id: 'events',
    label: 'Delay Risk',
    main: 'operation',
    description: 'Vendon delay risk, turn-offs, downtime (Vendon API via backend).',
  },
  {
    id: 'maintenance',
    label: 'General Cleaning',
    main: 'operation',
    description: 'Maintenance schedules and cleaning views.',
  },
  {
    id: 'transactions',
    label: 'Last Transactions',
    main: 'operation',
    description: 'Recent vending transactions.',
  },
  {
    id: 'remoteCredits',
    label: 'Refund Tests',
    main: 'operation',
    description: 'Remote credits / refund test flows.',
  },
  {
    id: 'refill',
    label: 'Refill',
    main: 'operation',
    description: 'Refill tracking and product levels.',
  },
  {
    id: 'waste',
    label: 'Waste Analysis',
    main: 'operation',
    description: 'Waste reasons and analysis (DB-backed).',
  },
  {
    id: 'attendance',
    label: 'Attendance & Cleaning',
    main: 'operation',
    description: 'Attendance and cleaning operations.',
  },
  {
    id: 'operations',
    label: 'Operations',
    main: 'operation',
    description: 'Slack staff requests and operations tasks.',
  },
  {
    id: 'machineLogs',
    label: 'Machine logs',
    main: 'operation',
    description: 'Machine log events and door activity.',
  },
  {
    id: 'slackListsTemp',
    label: 'Slack lists (temp)',
    main: 'operation',
    description: 'Temporary Slack list tooling.',
  },
  {
    id: 'liveDashboard',
    label: 'Live Ops',
    main: 'operation',
    description:
      'Airport-style live board: sales cadence, cleaning/QC flags, shift clock-in, targets, strikes.',
  },
  {
    id: 'overall',
    label: 'Overall',
    main: 'operation',
    description: 'Cross-machine snapshot: sales vs prior day, cleaning status, revenue vs daily targets.',
  },
  {
    id: 'redAlert',
    label: 'Red Alert',
    main: 'operation',
    description: 'Full-screen style operations monitor: precomputed criteria snapshot (people-api).',
  },
  {
    id: 'redAlertExpert',
    label: 'Red Alert (Expert)',
    main: 'operation',
    description: 'Alternate high-density Red Alert layout — same data; compare with standard and keep one.',
  },
  {
    id: 'people',
    label: 'People Analytics',
    main: 'sales',
    description: 'Traffic, performance, charts (people-api / Postgres).',
  },
  {
    id: 'analytics',
    label: 'Product Analytics',
    main: 'sales',
    description: 'Product-level analytics.',
  },
  {
    id: 'targets',
    label: 'Targets',
    main: 'sales',
    description: 'Sales targets vs actuals.',
  },
  {
    id: 'salesReport',
    label: 'Sales Report',
    main: 'sales',
    description: 'Report builder for machines and products.',
  },
  {
    id: 'comparison',
    label: 'Comparison Reports',
    main: 'sales',
    description: 'Side-by-side comparisons.',
  },
  {
    id: 'historical',
    label: 'Historical Performance',
    main: 'sales',
    description: 'Historical performance series.',
  },
  {
    id: 'visitTracking',
    label: 'Visit Tracking',
    main: 'qa',
    description: 'QA visit tracking.',
  },
  {
    id: 'qaFindings',
    label: 'QA Findings',
    main: 'qa',
    description: 'QA findings log.',
  },
  {
    id: 'postsInsta',
    label: 'Trend Posts',
    main: 'rd',
    description: 'Instagram / trend posts tooling.',
  },
  {
    id: 'hr',
    label: 'HR',
    main: 'hr',
    description: 'HR section (placeholder for future sub-tabs).',
  },
  {
    id: 'strategy',
    label: 'Strategy',
    main: 'strategy',
    description: 'Strategy section (placeholder for future sub-tabs).',
  },
  {
    id: 'customerFeedback',
    label: 'Customer Feedback',
    main: 'crm',
    description: 'Customer feedback intake and review.',
  },
  {
    id: 'machinesReview',
    label: 'Machines review',
    main: 'crm',
    description: 'Machine ratings and reviews.',
  },
  {
    id: 'admin',
    label: 'Admin',
    main: 'crm',
    description: 'Dashboard access rules and admin tools (restricted).',
  },
];

/**
 * Tab ids accepted in dashboard access rules (Monitor + related products).
 * Includes a few ids that are not Monitor v2 sidebar routes (e.g. Alert app grants).
 */
export const EXTRA_DASHBOARD_RULE_TAB_IDS: string[] = ['leetAlert', 'leetAlertAdmin'];

/** Same set as auth-access.js ALL_DASHBOARD_TAB_IDS — keep in sync when adding tabs */
export const ALL_DASHBOARD_TAB_IDS: string[] = Array.from(
  new Set([...TABS.map((t) => t.id), ...EXTRA_DASHBOARD_RULE_TAB_IDS]),
);

export const TAB_BY_ID: Record<string, TabDefinition> = Object.fromEntries(
  TABS.map((t) => [t.id, t]),
);

export function tabsForMain(main: MainSectionId): TabDefinition[] {
  return TABS.filter((t) => t.main === main);
}

export const DEFAULT_TAB_ID = 'events';
