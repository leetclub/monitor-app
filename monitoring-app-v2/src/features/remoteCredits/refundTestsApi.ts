import { apiFetch } from '@/api/client';
import { kuwaitYesterdayISO } from '@/lib/kuwaitDate';

export type RemoteCreditsFilters = {
  startDate: string;
  endDate: string;
  machineId?: string;
};

export type MatchedFailedDispense = {
  product_name?: string;
  selection?: string;
  timestamp?: number;
  datetime?: string;
  description?: string;
};

export type MatchedRemoteCredit = {
  amount?: number;
  user_name?: string;
  timestamp?: number;
  datetime?: string;
};

export type RemoteCreditsLogRow = {
  id?: string | number;
  timestamp?: number;
  datetime?: string;
  machine_id?: string | number;
  machine_name?: string;
  user_id?: string;
  user_name?: string;
  credit_amount?: number;
  status?: string;
  /** Primary product label for the WEB cashless vend (matches classic `allowed_products || product_name`). */
  allowed_products?: string;
  product_name?: string;
  selection?: string;
  category?: string;
  category_note?: string;
  manual_reason?: string;
  matched_failed_dispense?: MatchedFailedDispense | null;
  matched_remote_credit?: MatchedRemoteCredit | null;
};

export type RemoteCreditsMachineTotal = {
  machine_id?: string | number;
  machine_name?: string;
  total_amount?: number;
  count?: number;
  custom_refunds_count?: number;
  drink_tests_count?: number;
  reason_unidentified_count?: number;
};

/** Product column text — same fallback chain as monitoring-app-v1 remote credits table. */
export function formatRefundTestProduct(log: RemoteCreditsLogRow): string {
  const fromAllowed = (log.allowed_products || '').trim();
  const fromName = (log.product_name || '').trim();
  const sel = (log.selection || '').trim();
  const base = fromAllowed || fromName;
  if (base) return base;
  if (sel) return `Selection ${sel}`;
  return '—';
}

export type RemoteCreditsResponse = {
  success: boolean;
  error?: string;
  logs: RemoteCreditsLogRow[];
  totals: RemoteCreditsMachineTotal[];
  filters?: { startDate?: string; endDate?: string; machineId?: string };
};

export async function queryRemoteCredits(filters: RemoteCreditsFilters): Promise<RemoteCreditsResponse> {
  return apiFetch<RemoteCreditsResponse>('/api/vendon/remote-credits/query', {
    method: 'POST',
    json: {
      startDate: filters.startDate,
      endDate: filters.endDate,
      machineId: filters.machineId ?? '',
    },
  });
}

export type RemoteCreditsBootstrapPayload = {
  success?: boolean;
  bestMachine?: { machine_id?: string | null; machine_name?: string | null; count?: number };
  prefetchedResponse?: RemoteCreditsResponse;
  fromDate?: string;
  toDate?: string;
};

export async function bootstrapRemoteCredits(dateIso: string): Promise<{
  success: boolean;
  hasPreload?: boolean;
  payload?: RemoteCreditsBootstrapPayload;
  reason?: string;
}> {
  return apiFetch('/api/vendon/remote-credits/bootstrap', {
    method: 'POST',
    json: { date: dateIso },
  });
}

export async function saveRemoteCreditReason(payload: {
  logId: string;
  machineId: string;
  timestamp: number;
  reason: string;
}): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>('/api/remote-credit-reasons', {
    method: 'POST',
    json: {
      log_id: payload.logId,
      machine_id: payload.machineId.trim() !== '' ? payload.machineId : '_',
      timestamp: payload.timestamp,
      reason: payload.reason ?? '',
    },
  });
}

/** Calendar day before today (Kuwait), used as the default across ops tabs. */
export function yesterdayIsoLocal(): string {
  return kuwaitYesterdayISO();
}
