import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import {
  buildMaintenanceFetchBody,
  maintenanceDatasetQueryKey,
  queryMaintenanceSchedules,
} from './maintenanceApi';

/**
 * Classic app auto-loads General Cleaning on dashboard init (index.html tryLoadMaintenanceData).
 */
export function MaintenanceGeneralCleaningPrefetch() {
  const { canSeeTab } = useAccess();
  const qc = useQueryClient();

  useEffect(() => {
    if (!canSeeTab('maintenance')) return;
    const body = buildMaintenanceFetchBody('', '');
    const key = maintenanceDatasetQueryKey('', '');
    const id = window.setTimeout(() => {
      void qc.prefetchQuery({
        queryKey: key,
        queryFn: () => queryMaintenanceSchedules(body),
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [canSeeTab, qc]);

  return null;
}
