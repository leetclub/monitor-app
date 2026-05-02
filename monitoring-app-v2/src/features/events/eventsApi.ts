import { apiFetch } from '@/api/client';
import { kuwaitYesterdayISO } from '@/lib/kuwaitDate';

export type VendonMachine = { id: string | number; name: string };

/** Vendon machine ids (or names) starting with these are omitted from all “All machines” dropdowns. */
const MACHINE_DROPDOWN_EXCLUDED_ID_PREFIXES: readonly string[] = ['869'];

function filterMachinesForDropdown(machines: VendonMachine[]): VendonMachine[] {
  return machines.filter((m) => {
    const id = String(m.id ?? '').trim();
    const nm = String(m.name ?? '').trim();
    return !MACHINE_DROPDOWN_EXCLUDED_ID_PREFIXES.some((p) => id.startsWith(p) || nm.startsWith(p));
  });
}

export type EventNameOption = {
  id: string;
  name: string;
  base_codes: string[];
  display_name: string;
};

export type VendonEventRow = {
  id?: string | number;
  name?: string;
  base_code?: string;
  display_name?: string;
  description?: string;
  machine_id?: string | number;
  machine_name?: string;
  received_at?: number;
  resolved_at?: number;
  duration?: number;
};

export async function fetchVendonMachines(): Promise<VendonMachine[]> {
  const data = await apiFetch<{ machines: VendonMachine[] }>('/api/vendon/machines');
  return filterMachinesForDropdown(data.machines ?? []);
}

export async function fetchEventNameOptions(): Promise<EventNameOption[]> {
  const data = await apiFetch<{ options: EventNameOption[] }>('/api/vendon/event-name-options');
  return data.options ?? [];
}

export async function queryEvents(body: {
  startDate: string;
  endDate: string;
  machineId?: string;
  eventName?: string;
  limit?: number;
  offset?: number;
}): Promise<{ events: VendonEventRow[]; totalCount: number; error?: string }> {
  return apiFetch('/api/vendon/events/query', {
    method: 'POST',
    json: {
      startDate: body.startDate,
      endDate: body.endDate,
      machineId: body.machineId || '',
      eventName: body.eventName || '',
      limit: body.limit ?? 5000,
      offset: body.offset ?? 0,
    },
  });
}

/** Calendar day before today (Kuwait calendar date string). */
export function yesterdayIso(): string {
  return kuwaitYesterdayISO();
}

/** Applied filter snapshot for React Query (same shape as classic tab defaults on load). */
export type VendonEventsAppliedFilters = {
  startDate: string;
  endDate: string;
  machineId: string;
  eventName: string;
};

export function defaultVendonEventsFilters(): VendonEventsAppliedFilters {
  const y = yesterdayIso();
  return { startDate: y, endDate: y, machineId: '', eventName: '' };
}

export function vendonEventsQueryKey(f: VendonEventsAppliedFilters) {
  return ['vendon', 'events', f.startDate, f.endDate, f.machineId, f.eventName] as const;
}

export async function fetchVendonEventsForQuery(f: VendonEventsAppliedFilters) {
  return queryEvents({
    startDate: f.startDate,
    endDate: f.endDate,
    machineId: f.machineId || undefined,
    eventName: f.eventName || undefined,
    limit: 5000,
    offset: 0,
  });
}

export async function sendStrike(payload: {
  strikeNumber: 1 | 2 | 3;
  machineName: string;
  machineId?: string;
  eventType: string;
  timestamp: string;
  operatorEmail?: string;
}): Promise<{ success: boolean; error?: string }> {
  return apiFetch('/api/monitoring/strike', {
    method: 'POST',
    json: {
      strikeNumber: payload.strikeNumber,
      machineName: payload.machineName,
      machineId: payload.machineId,
      eventType: payload.eventType,
      timestamp: payload.timestamp,
      operatorEmail: payload.operatorEmail,
    },
  });
}
