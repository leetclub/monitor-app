import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardAccess, isTabAllowed, normalizeAllowedTabs } from '@/api/dashboardAccess';
import { isMockAccessEnabled } from '@/config/runtimeEnv';

interface AccessContextValue {
  email: string | null;
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
  const mock = isMockAccessEnabled();
  const query = useQuery({
    queryKey: ['dashboard-access', userEmail, mock],
    queryFn: fetchDashboardAccess,
    enabled: mock || (!!userEmail && userEmail.length > 0),
    staleTime: 60_000,
  });

  const allowedSet = useMemo(
    () => normalizeAllowedTabs(query.data?.allowedTabs ?? []),
    [query.data?.allowedTabs],
  );

  const canSeeTab = useCallback(
    (tabId: string) => isTabAllowed(tabId, allowedSet),
    [allowedSet],
  );

  const value: AccessContextValue = {
    email: query.data?.email ?? userEmail,
    allowedSet,
    isLoading: (mock || userEmail) ? query.isLoading : false,
    error: query.error as Error | null,
    refetch: () => void query.refetch(),
    canSeeTab,
  };

  return (
    <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
  );
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) {
    throw new Error('useAccess must be used within AccessProvider');
  }
  return ctx;
}
