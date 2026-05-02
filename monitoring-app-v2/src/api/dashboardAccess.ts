import { getMonitoringRuntimeEnv, isMockAccessEnabled } from '@/config/runtimeEnv';
import { apiFetch } from './client';

/** Response shape aligned with people-api dashboard-access resolve (adjust when wiring). */
export interface DashboardAccessResolve {
  email?: string;
  allowedTabs: string[];
  /** true if user has full tab set */
  fullAccess?: boolean;
}

function parseMockTabs(): string[] {
  const raw = getMonitoringRuntimeEnv().VITE_MOCK_ALLOWED_TABS;
  if (!raw || raw === '*') {
    return ['*'];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolves allowed tab ids for the signed-in user.
 *
 * Production: call a session-backed endpoint on your cluster (BFF or people-api extension)
 * that verifies Google OIDC / session and then calls PostgreSQL rules with the server secret.
 * Do not expose DASHBOARD_ACCESS_API_KEY to the browser.
 *
 * Expected contract (implement on server): `GET /api/me/dashboard-access` → { allowedTabs: string[] }
 */
export async function fetchDashboardAccess(): Promise<DashboardAccessResolve> {
  if (isMockAccessEnabled()) {
    const tabs = expandAllowedTabsWithAliases(parseMockTabs());
    const env = getMonitoringRuntimeEnv();
    return {
      email: env.VITE_DEV_USER_EMAIL || 'dev@localhost',
      allowedTabs: tabs,
      fullAccess: tabs.includes('*'),
    };
  }

  const data = await apiFetch<DashboardAccessResolve>('/api/me/dashboard-access', {
    method: 'GET',
  });
  return {
    ...data,
    allowedTabs: expandAllowedTabsWithAliases(data.allowedTabs ?? []),
  };
}

/** Tab ids for the merged live-ops / red-alert surface (v2 adds expert duplicate for A/B UI). */
const BOARD_TAB_TRIO = ['liveDashboard', 'redAlert', 'redAlertExpert'] as const;

/**
 * Keeps live-ops board tabs in sync: any of `liveDashboard`, `redAlert`, or `redAlertExpert` grants all three
 * (classic merge plus expert preview for comparison).
 */
export function expandAllowedTabsWithAliases(allowedTabs: string[]): string[] {
  if (!allowedTabs.length || allowedTabs.includes('*')) {
    return allowedTabs;
  }
  const out = [...allowedTabs];
  const hasAnyBoard = BOARD_TAB_TRIO.some((id) => out.includes(id));
  if (!hasAnyBoard) {
    return out;
  }
  for (const id of BOARD_TAB_TRIO) {
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
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
