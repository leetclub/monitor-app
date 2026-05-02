import { apiFetch } from '@/api/client';

/**
 * Classic: maintenance-tab.js → PUT MAINTENANCE_API_URL (Vendon preventativeMaintenanceSchedules).
 * v2: POST /api/vendon/maintenance/query — BFF must forward as PUT with server-side Token.
 */
export const MAINTENANCE_CLASSIC_FETCH_LIMIT = 5000;

export type MaintenanceQueryBody = {
  offset?: number;
  limit?: number;
  statuses?: string[];
  maintenance_type_ids?: string[];
  assigned_employee_ids?: string[];
  /** Classic sends numeric machine ids from parseInt(machineId). */
  machine_ids?: number[];
  location_ids?: string[];
  machine_tag_ids?: string[];
  client_ids?: string[];
};

/** Row shape used by index.html renderMaintenanceData (Vendon API). */
export type VendonMaintenanceSchedule = {
  machine_name?: string;
  maintenance_type_name?: string;
  status?: string;
  forecast_maintenance_at?: number;
  created_at?: number;
  assigned_employee_full_name?: string;
  [key: string]: unknown;
};

export type MaintenanceQueryResponse = {
  result?: VendonMaintenanceSchedule[];
  paging?: { total?: number };
  error?: string;
};

export function maintenanceDatasetQueryKey(machineId: string, status: string) {
  return ['maintenance', 'dataset', machineId, status] as const;
}

/**
 * Matches index.html loadMaintenanceData → getMaintenanceData(backendFilters).
 */
export function buildMaintenanceFetchBody(machineId: string, status: string): MaintenanceQueryBody {
  const statuses = status
    ? [status]
    : (['ok', 'due_soon', 'due', 'overdue'] as const).map(String);
  let machine_ids: number[] = [];
  if (machineId.trim()) {
    const n = parseInt(machineId, 10);
    if (!Number.isNaN(n)) machine_ids = [n];
  }
  return {
    offset: 0,
    limit: MAINTENANCE_CLASSIC_FETCH_LIMIT,
    statuses,
    maintenance_type_ids: [],
    assigned_employee_ids: [],
    machine_ids,
    location_ids: [],
    machine_tag_ids: [],
    client_ids: [],
  };
}

export async function queryMaintenanceSchedules(body: MaintenanceQueryBody) {
  return apiFetch<MaintenanceQueryResponse>('/api/vendon/maintenance/query', {
    method: 'POST',
    json: {
      offset: body.offset ?? 0,
      limit: body.limit ?? MAINTENANCE_CLASSIC_FETCH_LIMIT,
      statuses: body.statuses ?? ['ok', 'due_soon', 'due', 'overdue'],
      maintenance_type_ids: body.maintenance_type_ids ?? [],
      assigned_employee_ids: body.assigned_employee_ids ?? [],
      machine_ids: body.machine_ids ?? [],
      location_ids: body.location_ids ?? [],
      machine_tag_ids: body.machine_tag_ids ?? [],
      client_ids: body.client_ids ?? [],
    },
  });
}
