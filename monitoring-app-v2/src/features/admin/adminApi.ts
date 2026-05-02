import { apiFetch } from '@/api/client';

/**
 * Classic: dashboard-access-api.js dashboardAccessGetRulesFromApi_ / PutRules
 * (server used X-Dashboard-Access-Secret). v2 must use a session-admin route on the BFF.
 *
 * Expected: GET/PUT /api/me/dashboard-access/rules for users allowed to edit permissions.
 * Body shape matches permissions-sync sheet JSON: { defaultTabs: string[], users: Record<email, string[]> }
 */
export type DashboardAccessRules = {
  defaultTabs: string[];
  users: Record<string, string[]>;
};

export async function fetchDashboardAccessRules() {
  const data = await apiFetch<{
    ok?: boolean;
    defaultTabs?: string[];
    users?: Record<string, string[]>;
  }>('/api/me/dashboard-access/rules', { method: 'GET' });
  return {
    defaultTabs: data.defaultTabs ?? [],
    users: data.users ?? {},
  } satisfies DashboardAccessRules;
}

export async function putDashboardAccessRules(rules: DashboardAccessRules) {
  return apiFetch<{ ok?: boolean; error?: string }>('/api/me/dashboard-access/rules', {
    method: 'PUT',
    json: rules,
  });
}
