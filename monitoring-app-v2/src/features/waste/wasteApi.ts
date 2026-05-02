import { apiFetch } from '@/api/client';

/**
 * Classic: waste-tab.js getWasteReasons / saveWasteReasonToApi → people-api.
 * Browser calls same-origin /api (proxied to people-api in prod).
 */
export type WasteReasonRow = {
  machine_id?: string;
  machine_name?: string;
  date?: string;
  reason?: string;
  id?: string | number;
  [key: string]: unknown;
};

export async function fetchWasteReasons(date: string, machineIds?: string[]) {
  const params = new URLSearchParams({ date });
  if (machineIds && machineIds.length > 0) {
    params.set('machine_ids', machineIds.join(','));
  }
  return apiFetch<{ success: boolean; reasons?: WasteReasonRow[]; error?: string }>(
    `/api/waste-reasons?${params.toString()}`,
    { method: 'GET' },
  );
}

export async function saveWasteReason(machineId: string, date: string, reason: string) {
  return apiFetch<{ success: boolean; error?: string }>('/api/waste-reasons', {
    method: 'POST',
    json: { machine_id: machineId, date, reason },
  });
}
