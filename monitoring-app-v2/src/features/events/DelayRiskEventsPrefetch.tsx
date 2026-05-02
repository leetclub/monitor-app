import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import {
  defaultVendonEventsFilters,
  fetchVendonEventsForQuery,
  vendonEventsQueryKey,
} from './eventsApi';

/**
 * Classic app auto-loads Delay Risk ~500ms after dashboard init (yesterday, all machines).
 * Prefetch warms React Query so visiting Delay Risk later hits cache; same timing as tab auto-apply.
 */
export function DelayRiskEventsPrefetch() {
  const { canSeeTab } = useAccess();
  const qc = useQueryClient();

  useEffect(() => {
    if (!canSeeTab('events')) return;
    const f = defaultVendonEventsFilters();
    const id = window.setTimeout(() => {
      void qc.prefetchQuery({
        queryKey: vendonEventsQueryKey(f),
        queryFn: () => fetchVendonEventsForQuery(f),
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [canSeeTab, qc]);

  return null;
}
