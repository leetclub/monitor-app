import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAccess } from '@/context/AccessContext';
import { fetchVendonMachines } from '@/features/events/eventsApi';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import { fetchLastTransactions, normalizeTransactions, type TransactionRow } from './transactionsApi';
import styles from '../_shared/featureShell.module.css';

function fmtAmount(a: string | number | undefined) {
  if (a == null || a === '') return '—';
  const n = typeof a === 'number' ? a : parseFloat(String(a).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(a);
  return `${n.toFixed(3)} KWD`;
}

export default function TransactionsTab() {
  const { canSeeTab, isLoading: accessLoading } = useAccess();
  const [machineId, setMachineId] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const transactionsAllowed = canSeeTab('transactions');

  const machinesQ = useQuery({
    queryKey: ['vendon', 'machines'],
    queryFn: fetchVendonMachines,
    enabled: transactionsAllowed && !accessLoading,
    staleTime: 60_000,
  });

  const txQ = useQuery({
    queryKey: ['last-transactions', machineId || ''],
    queryFn: async () => {
      const raw = await fetchLastTransactions(machineId || undefined);
      return normalizeTransactions(raw);
    },
    enabled: transactionsAllowed && !accessLoading,
    staleTime: 30_000,
    retry: (failureCount, err) => {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401 || status === 403) return false;
      return failureCount < 2;
    },
  });

  const sorted = useMemo(() => {
    const list = [...(txQ.data ?? [])];
    list.sort((a, b) => {
      const ta = Number(a.timestamp ?? 0);
      const tb = Number(b.timestamp ?? 0);
      return sortDesc ? tb - ta : ta - tb;
    });
    return list;
  }, [txQ.data, sortDesc]);

  const fmtTime = (ts: number | undefined) => {
    if (ts == null || !Number.isFinite(ts)) return '—';
    return new Date(ts * 1000).toLocaleString();
  };

  const errMsg =
    txQ.error instanceof Error ? txQ.error.message : txQ.error ? String(txQ.error) : null;
  const hint = txQ.error ? backendHintFromError(txQ.error) : null;

  const emptyAfterFetch =
    sorted.length === 0 && !txQ.isFetching && txQ.isFetched && !txQ.isError;

  const rowKey = (tx: TransactionRow, idx: number) => {
    const mid = tx.machine_id != null ? String(tx.machine_id) : '';
    const name = String(tx.machine_name ?? '');
    const ts = Number(tx.timestamp ?? 0);
    const base = mid || name || 'row';
    return `${base}-${Number.isFinite(ts) ? ts : idx}`;
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        <strong>Last Transactions</strong> shows the <strong>most recent vend in the last 24 hours</strong> per
        machine (same window and logic as the classic tab). Filter by machine, or leave <em>All</em> for one row per
        machine fleet-wide when the API returns enough vends.
      </p>
      <BackendHint message={hint} />
      {errMsg && <div className={styles.err}>{errMsg}</div>}

      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor="tx-machine">Machine</label>
          <select
            id="tx-machine"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            disabled={machinesQ.isLoading}
          >
            <option value="">All machines</option>
            {(machinesQ.data ?? []).map((m) => (
              <option key={String(m.id)} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={txQ.isFetching || !transactionsAllowed || accessLoading}
            onClick={() => void txQ.refetch()}
          >
            {txQ.isFetching ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className={styles.btn} onClick={() => setSortDesc((v) => !v)}>
            Sort: {sortDesc ? 'newest first' : 'oldest first'}
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Machine</th>
              <th>Product</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {emptyAfterFetch && (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  No vends in the last 24 hours for this selection.
                </td>
              </tr>
            )}
            {sorted.map((tx: TransactionRow, idx) => (
              <tr key={rowKey(tx, idx)}>
                <td>{fmtTime(tx.timestamp as number | undefined)}</td>
                <td>{String(tx.machine_name ?? '—')}</td>
                <td>{String(tx.product_name ?? '—')}</td>
                <td>{fmtAmount(tx.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
