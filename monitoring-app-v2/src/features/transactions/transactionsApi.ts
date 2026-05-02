import { ApiError, apiFetch } from '@/api/client';

/**
 * Classic: google.script.run.fetchLastTransactions(filters) in index.html.
 * v2 expects BFF to call the same server-side Vendon logic and return rows.
 */
export type TransactionRow = {
  timestamp?: number;
  machine_id?: string | number;
  machine_name?: string;
  product_name?: string;
  amount?: string | number;
  [key: string]: unknown;
};

export async function fetchLastTransactions(machineId: string | undefined) {
  const data = await apiFetch<
    TransactionRow[] | { transactions?: TransactionRow[]; error?: string }
  >('/api/vendon/last-transactions', {
    method: 'POST',
    json: { machineId: machineId || '' },
  });

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const body = data as { transactions?: TransactionRow[]; error?: string };
    const rows = body.transactions ?? [];
    if (rows.length === 0 && body.error) {
      throw new ApiError(body.error, 502, body);
    }
  }

  return data;
}

export function normalizeTransactions(
  data: TransactionRow[] | { transactions?: TransactionRow[]; error?: string },
): TransactionRow[] {
  if (Array.isArray(data)) return data;
  return data.transactions ?? [];
}
