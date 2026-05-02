import { apiGet, apiJson } from '@/lib/api';

export type DashboardAccessRules = {
  defaultTabs: string[];
  users: Record<string, string[]>;
};

export type DashboardRulesResponse = DashboardAccessRules & {
  allTabIds: string[];
};

export async function fetchDashboardAccessRules(): Promise<DashboardRulesResponse> {
  const data = await apiGet<{
    ok?: boolean;
    defaultTabs?: string[];
    users?: Record<string, string[]>;
    allTabIds?: string[];
  }>('/api/me/dashboard-access/rules');
  return {
    defaultTabs: data.defaultTabs ?? [],
    users: data.users ?? {},
    allTabIds: Array.isArray(data.allTabIds) ? data.allTabIds : [],
  };
}

export async function putDashboardAccessRules(rules: DashboardAccessRules): Promise<void> {
  await apiJson('/api/me/dashboard-access/rules', rules, 'PUT');
}
