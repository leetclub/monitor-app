import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchDashboardAccess,
  isTabAllowed,
  normalizeAllowedTabs,
} from '@/api/dashboardAccess';

interface AccessContextValue {
  email: string | null;
  /** Tab ids you are allowed to use (after server rules + app-side aliases). */
  allowedTabs: string[];
  fullAccess: boolean;
  /** Domains allowed for org user list (from server; same as session user domain unless env list). */
  allowedEmailDomains: string[];
  allowedSet: Set<string> | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  canSeeTab: (tabId: string) => boolean;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({
  children,
  userEmail,
}: {
  children: ReactNode;
  userEmail: string | null;
}) {
  const query = useQuery({
    queryKey: ['dashboard-access', userEmail],
    queryFn: fetchDashboardAccess,
    enabled: !!userEmail && userEmail.length > 0,
    staleTime: 60_000,
  });

  const allowedTabs = query.data?.allowedTabs ?? [];
  const fullAccess = query.data?.fullAccess ?? false;

  const allowedSet = useMemo(
    () => normalizeAllowedTabs(allowedTabs),
    [allowedTabs],
  );

  const canSeeTab = useCallback(
    (tabId: string) => isTabAllowed(tabId, allowedSet),
    [allowedSet],
  );

  const allowedEmailDomains = useMemo(
    () => (Array.isArray(query.data?.allowedEmailDomains) ? query.data!.allowedEmailDomains! : []),
    [query.data?.allowedEmailDomains],
  );

  const value: AccessContextValue = {
    email: query.data?.email ?? userEmail,
    allowedTabs,
    fullAccess,
    allowedEmailDomains,
    allowedSet,
    isLoading: !!userEmail ? query.isLoading : false,
    error: query.error as Error | null,
    refetch: () => void query.refetch(),
    canSeeTab,
  };

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) {
    throw new Error('useAccess must be used within AccessProvider');
  }
  return ctx;
}
