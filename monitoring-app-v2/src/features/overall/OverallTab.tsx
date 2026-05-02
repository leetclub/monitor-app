import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DateInput } from '@/components/DateInput';
import { kuwaitDateISO } from '@/lib/kuwaitDate';
import shell from '@/features/_shared/featureShell.module.css';
import styles from './OverallTab.module.css';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import {
  fetchLiveSnapshot,
  type LiveMachineSnapshot,
} from '@/features/liveDashboard/liveDashboardApi';

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function cleaningAttention(row: LiveMachineSnapshot): boolean {
  return row.alerts.some((a) => a.code === 'CLEANING');
}

/** Snapshot requested with focusDate returns per-machine focus columns; otherwise today vs yesterday. */
function dayPair(row: LiveMachineSnapshot, snapHasFocus: boolean): { cur: number; prev: number } {
  if (
    snapHasFocus &&
    typeof row.salesOnFocusDay === 'number' &&
    typeof row.salesOnFocusPrevDay === 'number'
  ) {
    return { cur: row.salesOnFocusDay, prev: row.salesOnFocusPrevDay };
  }
  return { cur: row.salesToday, prev: row.salesYesterday ?? 0 };
}

export default function OverallTab() {
  const [hint, setHint] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => kuwaitDateISO());
  const [machineId, setMachineId] = useState('');
  const [modalRow, setModalRow] = useState<LiveMachineSnapshot | null>(null);

  const snapQ = useQuery({
    queryKey: ['overall', 'live-dashboard', selectedDate],
    queryFn: async () => {
      setHint(null);
      try {
        return await fetchLiveSnapshot({ focusDate: selectedDate });
      } catch (e) {
        setHint(backendHintFromError(e));
        throw e;
      }
    },
    refetchInterval: 120_000,
  });

  const snap = snapQ.data;
  const snapHasFocus = Boolean(snap?.focusDate);

  const filtered = useMemo(() => {
    let rows = snap?.machines ?? [];
    if (machineId.trim()) {
      rows = rows.filter((r) => r.machineId === machineId.trim());
    }
    return rows;
  }, [snap?.machines, machineId]);

  const totals = useMemo(() => {
    let cur = 0;
    let prev = 0;
    for (const row of filtered) {
      const p = dayPair(row, snapHasFocus);
      cur += p.cur;
      prev += p.prev;
    }
    const deltaPct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { cur, prev, deltaPct };
  }, [filtered, snapHasFocus]);

  const cleaning = useMemo(() => {
    let ok = 0;
    let attention = 0;
    for (const row of filtered) {
      if (cleaningAttention(row)) attention += 1;
      else ok += 1;
    }
    const total = ok + attention;
    const okPct = total ? (ok / total) * 100 : 0;
    return { ok, attention, total, okPct };
  }, [filtered]);

  const maxBar = useMemo(() => {
    let m = 1;
    for (const row of filtered) {
      const p = dayPair(row, snapHasFocus);
      const t = row.dailyTarget;
      const cap = typeof t === 'number' && t > 0 ? Math.max(p.cur, t) : p.cur;
      if (cap > m) m = cap;
    }
    return m;
  }, [filtered, snapHasFocus]);

  const tableRows = useMemo(() => {
    const score = (row: LiveMachineSnapshot) => {
      const p = dayPair(row, snapHasFocus);
      const t = row.dailyTarget;
      if (typeof t === 'number' && t > 0) return p.cur / t;
      return p.cur;
    };
    return [...filtered].sort((a, b) => score(b) - score(a));
  }, [filtered, snapHasFocus]);

  const compareLabel = snapHasFocus ? `vs prior day (${selectedDate})` : 'vs prior day';

  return (
    <div className={shell.wrap}>
      <p className={shell.intro}>
        Single view of sales momentum, cleaning flags, and daily targets — sourced from the same Live Ops snapshot
        used on the airport board. Pick a Kuwait calendar date to compare that day with the previous day in each
        machine&apos;s timezone.
      </p>

      {hint ? <BackendHint message={hint} /> : null}

      <div className={styles.wrap}>
        <h2 className={styles.lead}>Overall</h2>
        <p className={styles.blurb}>
          Filters apply to every block. Click a machine name for detail or jump to Live Ops / cleaning schedules.
        </p>

        <div className={shell.filters}>
          <div className={shell.field}>
            <label htmlFor="overall-date">Date (Kuwait calendar)</label>
            <DateInput
              id="overall-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className={shell.field}>
            <label htmlFor="overall-machine">Machine</label>
            <select
              id="overall-machine"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
            >
              <option value="">All machines</option>
              {(snap?.machines ?? []).map((m) => (
                <option key={m.machineId} value={m.machineId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className={shell.actions}>
            <button type="button" className={shell.btn} disabled={snapQ.isFetching} onClick={() => snapQ.refetch()}>
              Refresh
            </button>
          </div>
        </div>

        {snapQ.isError ? (
          <div className={styles.err}>Could not load snapshot.</div>
        ) : null}

        {snap?.errors?.vends || snap?.errors?.maintenance ? (
          <p className={styles.hintBox}>
            Partial data:{' '}
            {[snap.errors.vends, snap.errors.maintenance].filter(Boolean).join(' · ') || 'check API logs.'}
          </p>
        ) : null}

        <div className={styles.kpiGrid}>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Sales · focus day</p>
            <p className={styles.kpiValue}>{fmtMoney(totals.cur)}</p>
            <p className={styles.kpiSub}>
              <strong>{compareLabel}</strong>: {fmtMoney(totals.prev)}
              {totals.deltaPct != null && Number.isFinite(totals.deltaPct) ? (
                <>
                  {' '}
                  <span className={totals.deltaPct >= 0 ? styles.deltaUp : styles.deltaDown}>
                    ({totals.deltaPct >= 0 ? '+' : ''}
                    {totals.deltaPct.toFixed(1)}%)
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Cleaning (Live Ops rules)</p>
            <p className={styles.kpiValue}>
              <span className={styles.deltaUp}>{cleaning.ok}</span>
              <span style={{ opacity: 0.45 }}> / </span>
              <span className={cleaning.attention ? styles.deltaDown : undefined}>{cleaning.attention}</span>
            </p>
            <p className={styles.kpiSub}>
              <strong style={{ color: '#34d399' }}>OK</strong> ·{' '}
              <strong style={{ color: '#fb923c' }}>needs attention</strong>
              {cleaning.total ? ` (${cleaning.total} machines in view)` : null}
            </p>
            {cleaning.total > 0 ? (
              <div className={styles.cleanBar} aria-hidden>
                <div className={styles.cleanSegOk} style={{ width: `${cleaning.okPct}%` }} />
                <div className={styles.cleanSegWarn} style={{ width: `${100 - cleaning.okPct}%` }} />
              </div>
            ) : null}
          </div>

          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>As of</p>
            <p className={styles.kpiValue} style={{ fontSize: '1rem', fontWeight: 600 }}>
              {snap ? new Date(snap.generatedAt).toLocaleString() : '—'}
            </p>
            <p className={styles.kpiSub}>
              Kuwait calendar focus: <strong>{selectedDate}</strong>
            </p>
          </div>
        </div>

        <div className={styles.chartPanel}>
          <h3 className={styles.sectionTitle}>Revenue vs daily target</h3>
          <p className={styles.chartHint}>
            Bar length is scaled to the largest sale-or-target value in the current filter. Orange when under half of
            target (when a target exists).
          </p>
          <div className={styles.barRows}>
            {filtered.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No machines match the filter.</p>
            ) : (
              filtered
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((row) => {
                  const p = dayPair(row, snapHasFocus);
                  const t = row.dailyTarget;
                  const denom = typeof t === 'number' && t > 0 ? t : maxBar;
                  const widthPct = denom > 0 ? Math.min(100, (p.cur / denom) * 100) : 0;
                  const warn =
                    typeof t === 'number' && t > 0 ? p.cur < t * 0.5 : false;
                  return (
                    <div key={row.machineId} className={styles.barRow}>
                      <button type="button" className={styles.barName} onClick={() => setModalRow(row)}>
                        {row.name}
                      </button>
                      <div className={styles.barTrack}>
                        <div
                          className={`${styles.barFill} ${warn ? styles.barFillWarn : ''}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className={styles.barMeta}>
                        {fmtMoney(p.cur)}
                        {typeof t === 'number' && t > 0 ? ` / ${fmtMoney(t)}` : ''}
                      </span>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        <h3 className={styles.sectionTitle}>Detail (sort: target attainment or sales)</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Focus sales</th>
                <th>Prior day</th>
                <th>Target</th>
                <th>Cleaning</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const p = dayPair(row, snapHasFocus);
                const att = cleaningAttention(row);
                return (
                  <tr key={row.machineId}>
                    <td>
                      <button type="button" className={styles.linkish} onClick={() => setModalRow(row)}>
                        {row.name}
                      </button>
                    </td>
                    <td>{fmtMoney(p.cur)}</td>
                    <td>{fmtMoney(p.prev)}</td>
                    <td>
                      {typeof row.dailyTarget === 'number' && row.dailyTarget > 0
                        ? fmtMoney(row.dailyTarget)
                        : '—'}
                    </td>
                    <td style={{ color: att ? '#fb923c' : '#34d399' }}>{att ? 'Attention' : 'OK'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalRow ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalRow(null);
          }}
        >
          <div className={styles.modal} role="dialog" aria-labelledby="overall-modal-title">
            <h3 id="overall-modal-title">{modalRow.name}</h3>
            <dl>
              <dt>ID</dt>
              <dd>{modalRow.machineId}</dd>
              <dt>Focus day sales</dt>
              <dd>{fmtMoney(dayPair(modalRow, snapHasFocus).cur)}</dd>
              <dt>Prior day</dt>
              <dd>{fmtMoney(dayPair(modalRow, snapHasFocus).prev)}</dd>
              <dt>Daily target</dt>
              <dd>
                {typeof modalRow.dailyTarget === 'number' && modalRow.dailyTarget > 0
                  ? fmtMoney(modalRow.dailyTarget)
                  : '—'}
              </dd>
              <dt>Cleaning</dt>
              <dd style={{ color: cleaningAttention(modalRow) ? '#fb923c' : '#34d399' }}>
                {cleaningAttention(modalRow) ? 'Needs attention' : 'OK'}
              </dd>
              <dt>Maintenance</dt>
              <dd>{modalRow.maintenanceStatus}</dd>
              <dt>Last sale</dt>
              <dd>
                {modalRow.lastVendAt
                  ? new Date(modalRow.lastVendAt * 1000).toLocaleString()
                  : '—'}
              </dd>
              <dt>Timezone</dt>
              <dd>{modalRow.shift.timezone}</dd>
            </dl>
            <div className={styles.modalActions}>
              <Link to="/tab/liveDashboard">Open Live Ops</Link>
              <Link to="/tab/maintenance">General cleaning</Link>
              <Link to="/tab/attendance">Attendance &amp; cleaning</Link>
            </div>
            <button type="button" className={`${styles.btn} ${styles.modalClose}`} onClick={() => setModalRow(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
