import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVendonMachines } from '@/features/events/eventsApi';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import { DateInput } from '@/components/DateInput';
import { fetchWasteReasons, saveWasteReason, type WasteReasonRow } from './wasteApi';
import styles from '../_shared/featureShell.module.css';

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function rowKey(r: WasteReasonRow): string {
  const mid = String(r.machine_id ?? '');
  const d = String(r.date ?? '');
  return `${mid}::${d}`;
}

export default function WasteAnalysisTab() {
  const [date, setDate] = useState(todayIso);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const machinesQ = useQuery({
    queryKey: ['vendon', 'machines'],
    queryFn: fetchVendonMachines,
  });

  const filteredMachines = useMemo(() => {
    const list = machinesQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => String(m.name).toLowerCase().includes(q));
  }, [machinesQ.data, search]);

  const loadReasons = useCallback(async () => {
    setErr(null);
    setHint(null);
    try {
      const ids = [...selectedIds];
      const res = await fetchWasteReasons(date, ids.length ? ids : undefined);
      if (!res.success) {
        setErr(res.error || 'Failed to load waste reasons');
        return res;
      }
      const nextDrafts: Record<string, string> = {};
      for (const r of res.reasons ?? []) {
        nextDrafts[rowKey(r)] = String(r.reason ?? '');
      }
      setDrafts(nextDrafts);
      return res;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed');
      setHint(backendHintFromError(e));
      throw e;
    }
  }, [date, selectedIds]);

  const reasonsQ = useQuery({
    queryKey: ['waste-reasons', date, [...selectedIds].sort().join(',')],
    queryFn: loadReasons,
    enabled: false,
  });

  // UX: when a date is picked, automatically load (debounced) if the table was loaded at least once.
  // This prevents "date filter doesn't work" confusion while still keeping an explicit Load button.
  const loadedOnce = reasonsQ.isFetched || reasonsQ.data != null;
  useEffect(() => {
    if (!loadedOnce) return;
    const id = window.setTimeout(() => {
      void reasonsQ.refetch();
    }, 350);
    return () => window.clearTimeout(id);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasons = reasonsQ.data?.reasons ?? [];

  const toggleMachine = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredMachines.map((m) => String(m.id))));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const saveRow = async (r: WasteReasonRow) => {
    const mid = String(r.machine_id ?? '');
    const d = String(r.date ?? date);
    const key = rowKey({ ...r, machine_id: mid, date: d });
    const reason = drafts[key] ?? '';
    setSaving((s) => ({ ...s, [key]: true }));
    setErr(null);
    setHint(null);
    try {
      await saveWasteReason(mid, d, reason);
      await reasonsQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
      setHint(backendHintFromError(e));
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        <strong>Waste reasons</strong> are stored in Postgres via people-api (<code>GET/POST /api/waste-reasons</code>
        ), matching the classic tab. Stock-vs-sales waste breakdown and system-wide top waste still rely on Vendon +
        Motion calls that must stay on the server; add a BFF route if you want that analysis here without the legacy
        app.
      </p>

      <BackendHint message={hint} />
      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor="waste-date">Date</label>
          <DateInput id="waste-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={reasonsQ.isFetching}
            onClick={() => void reasonsQ.refetch()}
          >
            {reasonsQ.isFetching ? 'Loading…' : 'Load reasons'}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="waste-m-search">Machines (filter load by selection; empty = all)</label>
        <input
          id="waste-m-search"
          type="search"
          placeholder="Search machines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.actions} style={{ marginTop: '0.5rem' }}>
          <button type="button" className={styles.btn} onClick={selectAllVisible}>
            Select all visible
          </button>
          <button type="button" className={styles.btn} onClick={clearSelection}>
            Clear
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--muted)', alignSelf: 'center' }}>
            {selectedIds.size} selected
          </span>
        </div>
        <div className={styles.machineGrid}>
          {machinesQ.isLoading && <div className={styles.empty}>Loading machines…</div>}
          {!machinesQ.isLoading &&
            filteredMachines.map((m) => {
              const id = String(m.id);
              return (
                <label key={id} className={styles.machineRow}>
                  <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggleMachine(id)} />
                  <span>{m.name}</span>
                </label>
              );
            })}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Date</th>
              <th>Reason</th>
              <th style={{ width: '7rem' }}> </th>
            </tr>
          </thead>
          <tbody>
            {reasons.length === 0 && !reasonsQ.isFetching ? (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  No rows yet. Choose a date and click &quot;Load reasons&quot;, or save a new reason for a machine
                  below.
                </td>
              </tr>
            ) : (
              reasons.map((r, idx) => {
                const key = rowKey(r);
                const mid = String(r.machine_id ?? '');
                return (
                  <tr key={r.id != null ? String(r.id) : key + idx}>
                    <td>{String(r.machine_name ?? (mid || '—'))}</td>
                    <td>{String(r.date ?? date)}</td>
                    <td>
                      <textarea
                        style={{ minHeight: '3rem', width: '100%', padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                        value={drafts[key] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        disabled={!!saving[key]}
                        onClick={() => void saveRow(r)}
                      >
                        {saving[key] ? '…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.field}>
        <label>Add / update reason (machine id + date)</label>
        <div className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="waste-new-mid">Machine ID</label>
            <input id="waste-new-mid" type="text" placeholder="e.g. vendon machine id" />
          </div>
          <div className={styles.field}>
            <label htmlFor="waste-new-date">Date</label>
            <DateInput id="waste-new-date" type="date" defaultValue={date} />
          </div>
        </div>
        <textarea id="waste-new-reason" placeholder="Reason text" />
        <button
          type="button"
          className={styles.btnPrimary}
          style={{ marginTop: '0.35rem' }}
          onClick={() => {
            const midEl = document.getElementById('waste-new-mid') as HTMLInputElement | null;
            const dEl = document.getElementById('waste-new-date') as HTMLInputElement | null;
            const rEl = document.getElementById('waste-new-reason') as HTMLTextAreaElement | null;
            const mid = midEl?.value?.trim() ?? '';
            const d = dEl?.value || date;
            const text = rEl?.value ?? '';
            if (!mid) {
              setErr('Enter a machine ID to save a new reason.');
              return;
            }
            void (async () => {
              setErr(null);
              setHint(null);
              try {
                await saveWasteReason(mid, d, text);
                if (midEl) midEl.value = '';
                if (rEl) rEl.value = '';
                await reasonsQ.refetch();
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Save failed');
                setHint(backendHintFromError(e));
              }
            })();
          }}
        >
          Save new row
        </button>
      </div>
    </div>
  );
}
