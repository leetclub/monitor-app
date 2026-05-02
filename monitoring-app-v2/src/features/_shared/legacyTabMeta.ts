/**
 * Where to look in monitoring-app (classic GAS) when porting this tab to v2.
 * Not exhaustive — some UIs are mostly in index.html + google.script.run.
 */
export const LEGACY_TAB_REFERENCE: Record<string, string> = {
  events: 'events-tab.js',
  maintenance: 'maintenance-tab.js',
  transactions: 'index.html (transactions / Last Transactions) + api-core.js',
  remoteCredits: 'remote-credits-tab.js',
  refill: 'refill-tab.js',
  waste: 'waste-tab.js',
  attendance: 'attendance-tab.js',
  operations: 'operations-tab.js',
  machineLogs: 'index.html (machine logs) + api-core.js',
  slackListsTemp: 'index.html (Slack lists temp)',
  redAlert: 'v1 UI: red-alert-tab.js + index.html (#redAlertPortal); v2 API: docs/RED_ALERT_API.md',
  redAlertExpert: 'v2 only — alternate Red Alert layout; same GET /api/red-alert/snapshot',
  people: 'people-analytics.js',
  analytics: 'analytics-tab.js',
  targets: 'index.html (Targets) + api-core.js',
  salesReport: 'index.html (Sales Report)',
  comparison: 'index.html (Comparison)',
  historical: 'index.html (Historical) + people-analytics.js / api-core.js',
  visitTracking: 'visit-tracking-tab.js',
  qaFindings: 'index.html (QA Findings)',
  postsInsta: 'index.html (Trend Posts)',
  hr: 'index.html (HR)',
  strategy: 'index.html (Strategy)',
  customerFeedback: 'index.html (Customer Feedback)',
  machinesReview: 'index.html (Machines review)',
  admin: 'admin-api.js + dashboard-access-api.js',
};
