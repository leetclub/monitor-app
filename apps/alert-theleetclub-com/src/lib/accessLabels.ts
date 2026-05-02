/**
 * Human-readable names for permission keys — avoid showing internal ids to end users.
 */
const TAB_LABEL_SHORT: Record<string, string> = {
  '*': 'Everything (full access)',
  leetAlert: 'View Leet Alert (Red Flags & Overall)',
  leetAlertAdmin: 'Manage Leet Alert settings',
  redAlert: 'Monitor: Red Alert screens',
  admin: 'Manage who can use Monitor & Alert',
  events: 'Monitor: Delay risk',
  maintenance: 'Monitor: Cleaning',
  liveDashboard: 'Monitor: Live Ops',
  waste: 'Monitor: Waste',
  overall: 'Monitor: Overall',
  people: 'Monitor: People analytics',
};

export function labelForAccessKey(id: string): string {
  if (id === '*') return TAB_LABEL_SHORT['*'] ?? 'Full access';
  return TAB_LABEL_SHORT[id] ?? `Other access (${id})`;
}

/** Short label for compact chips */
export function chipLabelForAccessKey(id: string): string {
  const m: Record<string, string> = {
    leetAlert: 'Leet Alert (view)',
    leetAlertAdmin: 'Leet Alert (manage)',
    redAlert: 'Monitor Red Alert',
    admin: 'Team access admin',
  };
  return m[id] ?? (id === '*' ? 'Full access' : id);
}

/** Describe what the signed-in person can do — no raw codes in the main lines */
export function friendlyAccessSummary(allowedTabs: string[], fullAccess: boolean): string[] {
  if (fullAccess || allowedTabs.includes('*')) {
    return ['You have full access to everything your organization allows.'];
  }
  if (allowedTabs.length === 0) {
    return ['No specific permissions were found for your account.'];
  }
  return allowedTabs.map((id) => labelForAccessKey(id));
}
