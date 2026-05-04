import { apiFetch } from '@/lib/apiClient';

export interface DashboardAccessResolve {
  email?: string;
  allowedTabs: string[];
  fullAccess?: boolean;
  /** Google Workspace–style allowlist; empty = no client-side domain gate (see server). */
  allowedEmailDomains?: string[];
}

/** Grant Leet Alert read if user has Alert tab or classic Red Alert tab (Monitor parity). */
export function expandAllowedTabsWithAliases(allowedTabs: string[]): string[] {
  if (!allowedTabs.length || allowedTabs.includes('*')) {
    return allowedTabs;
  }
  const out = [...allowedTabs];
  if (out.includes('redAlert') && !out.includes('leetAlert')) {
    out.push('leetAlert');
  }
  if (out.includes('leetAlert') && !out.includes('redAlert')) {
    out.push('redAlert');
  }
  return out;
}

export async function fetchDashboardAccess(): Promise<DashboardAccessResolve> {
  const data = await apiFetch<DashboardAccessResolve>('/api/me/dashboard-access', {
    method: 'GET',
  });
  return {
    ...data,
    allowedTabs: expandAllowedTabsWithAliases(data.allowedTabs ?? []),
    allowedEmailDomains: Array.isArray(data.allowedEmailDomains)
      ? data.allowedEmailDomains.map((d) => String(d).toLowerCase().trim().replace(/^@/, ''))
      : undefined,
  };
}

export function normalizeAllowedTabs(allowed: string[]): Set<string> | null {
  if (allowed.includes('*')) {
    return null;
  }
  return new Set(allowed);
}

export function isTabAllowed(tabId: string, allowed: Set<string> | null): boolean {
  if (allowed === null) {
    return true;
  }
  return allowed.has(tabId);
}
