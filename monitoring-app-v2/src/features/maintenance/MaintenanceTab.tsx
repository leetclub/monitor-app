import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import { fetchVendonMachines } from '@/features/events/eventsApi';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import {
  MAINTENANCE_CLASSIC_FETCH_LIMIT,
  buildMaintenanceFetchBody,
  maintenanceDatasetQueryKey,
  queryMaintenanceSchedules,
  type VendonMaintenanceSchedule,
} from './maintenanceApi';
import shell from '../_shared/featureShell.module.css';
import styles from './MaintenanceTab.module.css';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'ok', label: 'OK' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'due', label: 'Due' },
  { value: 'overdue', label: 'Overdue' },
];

function formatUnixDate(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return 'N/A';
  return new Date(sec * 1000).toLocaleDateString();
}

const STATUS_BADGE: Record<string, string> = {
  ok: styles.badgeOk,
  due_soon: styles.badgeDueSoon,
  due: styles.badgeDue,
  overdue: styles.badgeOverdue,
};

function statusBadgeClass(status: string | undefined): string {
  const s = (status || '').toLowerCase();
  return STATUS_BADGE[s] ?? styles.badgeUnknown;
}

export default function MaintenanceTab() {
  const { canSeeTab } = useAccess();
  const qc = useQueryClient();
  const userClearedRef = useRef(false);

  const [draftMachineId, setDraftMachineId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [applied, setApplied] = useState<{ m: string; s: string } | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const machinesQ = useQuery({
    queryKey: ['vendon', 'machines'],
    queryFn: fetchVendonMachines,
  });

  /** Classic: tryLoadMaintenanceData ~500ms after init with empty filters. */
  useEffect(() => {
    if (!canSeeTab('maintenance')) return;
    const id = window.setTimeout(() => {
      setApplied((prev) => {
        if (prev != null) return prev;
        if (userClearedRef.current) return prev;
        return { m: '', s: '' };
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [canSeeTab]);

  const q = useQuery({
    queryKey: applied ? maintenanceDatasetQueryKey(applied.m, applied.s) : ['maintenance', 'dataset', 'idle'],
    queryFn: async () => {
      setErr(null);
      setHint(null);
      try {
        return await queryMaintenanceSchedules(buildMaintenanceFetchBody(applied!.m, applied!.s));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Request failed');
        setHint(backendHintFromError(e));
        throw e;
      }
    },
    enabled: applied != null,
  });

  const schedules: VendonMaintenanceSchedule[] = (q.data?.result ?? []) as VendonMaintenanceSchedule[];
  const totalSchedules = schedules.length;

  const totalPages = Math.max(1, Math.ceil(totalSchedules / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;
  const pageRows = schedules.slice(start, start + perPage);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const applyFilters = () => {
    userClearedRef.current = false;
    setPage(1);
    setApplied({ m: draftMachineId, s: draftStatus });
  };

  const clearFilters = () => {
    userClearedRef.current = true;
    setDraftMachineId('');
    setDraftStatus('');
    setPage(1);
    setApplied({ m: '', s: '' });
    void qc.invalidateQueries({ queryKey: maintenanceDatasetQueryKey('', '') });
  };

  const loading = q.isFetching;
  const showInitialHint = applied == null && !userClearedRef.current;

  const pagination = useMemo(() => {
    if (totalPages <= 1) return null;
    const buttons: number[] = [];
    const maxBtn = 24;
    if (totalPages <= maxBtn) {
      for (let i = 1; i <= totalPages; i++) buttons.push(i);
    } else {
      const windowSize = 4;
      buttons.push(1);
      let from = Math.max(2, safePage - windowSize);
      let to = Math.min(totalPages - 1, safePage + windowSize);
      if (from > 2) buttons.push(-1);
      for (let i = from; i <= to; i++) buttons.push(i);
      if (to < totalPages - 1) buttons.push(-2);
      buttons.push(totalPages);
    }
    return buttons;
  }, [totalPages, safePage]);

  return (
    <div className={shell.wrap}>
      <h2 className={styles.title}>General Cleaning Schedules</h2>
      <p className={shell.intro}>
        Same data as the classic tab: Vendon preventative maintenance schedules (up to{' '}
        {MAINTENANCE_CLASSIC_FETCH_LIMIT} rows per load), filtered by machine and status, then paginated in the
        browser. Backend: <code>POST /api/vendon/maintenance/query</code> (BFF forwards as Vendon PUT with token).
      </p>
      <BackendHint message={hint} />
      {err && <div className={shell.err}>{err}</div>}

      <div className={shell.filters}>
        <div className={shell.field}>
          <label htmlFor="maint-machine">Machine</label>
          <select
            id="maint-machine"
            value={draftMachineId}
            onChange={(e) => setDraftMachineId(e.target.value)}
            disabled={machinesQ.isLoading}
          >
            <option value="">All Machines</option>
            {(machinesQ.data ?? []).map((m) => (
              <option key={String(m.id)} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={shell.field}>
          <label htmlFor="maint-status">Status</label>
          <select
            id="maint-status"
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={shell.actions}>
          <button
            type="button"
            className={shell.btnPrimary}
            disabled={loading}
            onClick={() => void applyFilters()}
          >
            {loading ? 'Loading…' : 'Apply Filters'}
          </button>
          <button type="button" className={shell.btn} disabled={loading} onClick={() => void clearFilters()}>
            Clear Filters
          </button>
        </div>
      </div>

      <div className={styles.controls}>
        <span className={styles.total}>Total schedules: {applied == null ? '—' : totalSchedules}</span>
        <label htmlFor="maint-per-page">
          Records per page:{' '}
          <select
            id="maint-per-page"
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {pagination && (
          <div className={styles.pagination} role="navigation" aria-label="Maintenance pages">
            {pagination.map((n, idx) =>
              n < 0 ? (
                <span key={`ellipsis-${idx}`} style={{ padding: '0 4px', color: 'var(--muted)' }}>
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  className={styles.pageBtn}
                  disabled={n === safePage}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className={shell.tableWrap}>
        <table className={shell.table}>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Maintenance Type</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Last Completed</th>
              <th>Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {showInitialHint && (
              <tr>
                <td colSpan={6} className={shell.empty}>
                  Loading schedules (default filters)…
                </td>
              </tr>
            )}
            {!showInitialHint && loading && schedules.length === 0 && (
              <tr>
                <td colSpan={6} className={shell.empty}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && applied != null && schedules.length === 0 && (
              <tr>
                <td colSpan={6} className={shell.empty}>
                  No maintenance schedules found.
                </td>
              </tr>
            )}
            {pageRows.map((s, idx) => (
              <tr key={`${s.machine_name ?? ''}-${s.forecast_maintenance_at ?? idx}-${idx}`}>
                <td>{s.machine_name ?? 'Unknown'}</td>
                <td>{s.maintenance_type_name ?? 'N/A'}</td>
                <td>
                  <span className={statusBadgeClass(s.status)}>{s.status ?? '—'}</span>
                </td>
                <td>{formatUnixDate(s.forecast_maintenance_at)}</td>
                <td>{formatUnixDate(s.created_at)}</td>
                <td>{s.assigned_employee_full_name ?? 'Unassigned'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
