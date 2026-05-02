import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import { sendStrike } from '@/features/events/eventsApi';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import shell from '../_shared/featureShell.module.css';
import styles from './LiveDashboardTab.module.css';
import {
  fetchLiveMachineConfigs,
  fetchLiveSnapshot,
  postShiftClockIn,
  putLiveMachineConfig,
  type LiveMachineSnapshot,
} from './liveDashboardApi';

function fmtTs(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return new Date(sec * 1000).toLocaleString();
}

function fmtDur(min: number | undefined | null): string {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

export default function LiveDashboardTab() {
  const { canSeeTab } = useAccess();
  const qc = useQueryClient();
  const [hint, setHint] = useState<string | null>(null);
  const [adminMid, setAdminMid] = useState('');
  const [draft, setDraft] = useState({
    minSaleIntervalMinutes: 10,
    maxHoursWithoutCleaning: '' as string,
    maxHoursWithoutQc: '' as string,
    strikeOperatorEmail: '',
    dailySalesTarget: '' as string,
    expectedShiftStart: '',
    shiftTimezone: 'Asia/Kuwait',
    shiftGraceMinutes: 15,
    lastCleaningAt: '',
    lastQcVisitAt: '',
  });

  const snapQ = useQuery({
    queryKey: ['live-dashboard', 'snapshot'],
    queryFn: async () => {
      setHint(null);
      try {
        return await fetchLiveSnapshot();
      } catch (e) {
        setHint(backendHintFromError(e));
        throw e;
      }
    },
    refetchInterval: 60_000,
  });

  const configQ = useQuery({
    queryKey: ['live-dashboard', 'config'],
    queryFn: async () => {
      setHint(null);
      return fetchLiveMachineConfigs();
    },
    enabled: canSeeTab('admin'),
  });

  const strikeMut = useMutation({
    mutationFn: async (p: { row: LiveMachineSnapshot; n: 1 | 2 | 3 }) => {
      const ts = new Date().toISOString();
      return sendStrike({
        strikeNumber: p.n,
        machineName: p.row.name,
        machineId: p.row.machineId,
        eventType: p.row.alerts.map((a) => a.code).join(', ') || 'Live Ops',
        timestamp: ts,
        operatorEmail: p.row.strikeOperatorEmail || undefined,
      });
    },
  });

  const clockMut = useMutation({
    mutationFn: (machineId: string) => postShiftClockIn(machineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['live-dashboard', 'snapshot'] });
    },
  });

  const saveCfgMut = useMutation({
    mutationFn: () =>
      putLiveMachineConfig(adminMid.trim(), {
        minSaleIntervalMinutes: draft.minSaleIntervalMinutes,
        maxHoursWithoutCleaning: draft.maxHoursWithoutCleaning
          ? Number(draft.maxHoursWithoutCleaning)
          : null,
        maxHoursWithoutQc: draft.maxHoursWithoutQc ? Number(draft.maxHoursWithoutQc) : null,
        strikeOperatorEmail: draft.strikeOperatorEmail.trim() || null,
        dailySalesTarget: draft.dailySalesTarget ? Number(draft.dailySalesTarget) : null,
        expectedShiftStart: draft.expectedShiftStart.trim() || null,
        shiftTimezone: draft.shiftTimezone.trim() || null,
        shiftGraceMinutes: draft.shiftGraceMinutes,
        lastCleaningAt: draft.lastCleaningAt.trim() || null,
        lastQcVisitAt: draft.lastQcVisitAt.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['live-dashboard', 'config'] });
      void qc.invalidateQueries({ queryKey: ['live-dashboard', 'snapshot'] });
    },
  });

  const ticker = useMemo(() => {
    const rows = snapQ.data?.machines ?? [];
    const alerts: { text: string; warn: boolean }[] = [];
    for (const m of rows) {
      for (const a of m.alerts) {
        alerts.push({
          text: `${m.name}: ${a.message}`,
          warn: a.level !== 'critical',
        });
      }
    }
    return alerts;
  }, [snapQ.data]);

  const adminMachineChoices = useMemo(() => {
    const rows = snapQ.data?.machines ?? [];
    return rows.map((m) => ({ id: m.machineId, name: m.name }));
  }, [snapQ.data]);

  const loadAdminRow = () => {
    const id = adminMid.trim();
    if (!id) return;
    const row = configQ.data?.items.find((x) => x.machineId === id);
    setDraft({
      minSaleIntervalMinutes: row?.minSaleIntervalMinutes ?? 10,
      maxHoursWithoutCleaning: row?.maxHoursWithoutCleaning != null ? String(row.maxHoursWithoutCleaning) : '',
      maxHoursWithoutQc: row?.maxHoursWithoutQc != null ? String(row.maxHoursWithoutQc) : '',
      strikeOperatorEmail: row?.strikeOperatorEmail ?? '',
      dailySalesTarget: row?.dailySalesTarget != null ? String(row.dailySalesTarget) : '',
      expectedShiftStart: row?.expectedShiftStart ?? '',
      shiftTimezone: row?.shiftTimezone || 'Asia/Kuwait',
      shiftGraceMinutes: row?.shiftGraceMinutes ?? 15,
      lastCleaningAt: row?.lastCleaningAt ?? '',
      lastQcVisitAt: row?.lastQcVisitAt ?? '',
    });
  };

  return (
    <div className={shell.wrap}>
      <h2 className={styles.title}>Live Ops board</h2>
      <p className={styles.sub}>
        Machines are ordered by severity (alerts first), similar to a departure board. Data refreshes every minute.
        Thresholds and operator email are configured in the admin section (requires Admin tab access).
      </p>
      <BackendHint message={hint} />
      {snapQ.isError && <div className={styles.err}>Could not load snapshot.</div>}

      <div className={styles.ticker} aria-live="polite">
        {ticker.length === 0 && <span className={styles.tickerEmpty}>No active alerts.</span>}
        {ticker.map((t, i) => (
          <span key={i} className={t.warn ? styles.tickerItemWarn : styles.tickerItem}>
            {t.text}
          </span>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Machine</th>
              <th className={styles.th}>Alerts</th>
              <th className={styles.th}>Last sale</th>
              <th className={styles.th}>Door</th>
              <th className={styles.th}>Cleaning</th>
              <th className={styles.th}>Sales / target</th>
              <th className={styles.th}>Shift</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(snapQ.data?.machines ?? []).map((row) => {
              const crit = row.alerts.some((a) => a.level === 'critical');
              const warn = !crit && row.alerts.length > 0;
              const trClass = crit ? styles.rowCritical : warn ? styles.rowWarn : styles.rowOk;
              const tgt = row.dailyTarget;
              const pct =
                tgt != null && tgt > 0 ? Math.min(100, Math.round((row.salesToday / tgt) * 100)) : null;
              return (
                <tr key={row.machineId} className={trClass}>
                  <td className={styles.td}>
                    <div className={styles.machineName}>{row.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>#{row.machineId}</div>
                  </td>
                  <td className={styles.td}>
                    <div className={styles.badges}>
                      {row.alerts.length === 0 && <span style={{ color: 'var(--muted)' }}>OK</span>}
                      {row.alerts.map((a, i) => (
                        <span
                          key={i}
                          className={a.level === 'critical' ? styles.badgeCrit : styles.badgeWarn}
                        >
                          {a.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={styles.td}>
                    {fmtTs(row.lastVendAt)}
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                      Δ {fmtDur(row.saleAgeMinutes)}
                    </div>
                  </td>
                  <td className={styles.td}>{fmtTs(row.lastDoorOpenAt)}</td>
                  <td className={styles.td}>
                    <div>{row.maintenanceStatus}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                      last clean: {row.lastCleaningAt ? new Date(row.lastCleaningAt).toLocaleString() : '—'}
                    </div>
                  </td>
                  <td className={styles.td}>
                    {row.salesToday.toFixed(2)}
                    {tgt != null ? ` / ${tgt} (${pct}%)` : ''}
                  </td>
                  <td className={styles.td}>
                    {row.shift.expectedStart ? (
                      <>
                        {row.shift.expectedStart} {row.shift.timezone}
                        {row.shift.late ? (
                          <span className={styles.badgeCrit} style={{ marginLeft: 6 }}>
                            late
                          </span>
                        ) : null}
                        <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                          clock-in: {row.shift.clockInAt ? fmtTs(row.shift.clockInAt) : '—'}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.td}>
                    <div className={styles.strikeRow}>
                      {([1, 2, 3] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={styles.strikeBtn}
                          disabled={strikeMut.isPending}
                          onClick={() => strikeMut.mutate({ row, n })}
                        >
                          S{n}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={styles.strikeBtn}
                        disabled={clockMut.isPending}
                        onClick={() => clockMut.mutate(row.machineId)}
                      >
                        Clock-in
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canSeeTab('admin') && (
        <div className={styles.adminPanel}>
          <h3 className={styles.adminTitle}>Machine criteria (admin)</h3>
          <p className={shell.intro} style={{ marginTop: 0 }}>
            Select a Vendon machine id, load existing row if any, edit thresholds, then save. Use ISO datetimes for
            last cleaning / QC visit when seeding manually.
          </p>
          <div className={styles.adminGrid}>
            <div className={styles.adminRow}>
              <label htmlFor="live-admin-mid">Machine</label>
              <select
                id="live-admin-mid"
                value={adminMid}
                onChange={(e) => setAdminMid(e.target.value)}
                disabled={snapQ.isLoading}
              >
                <option value="">—</option>
                {adminMachineChoices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.adminActions}>
              <button type="button" className={styles.btn} onClick={() => loadAdminRow()}>
                Load config
              </button>
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-min-sale">Min sale interval (min)</label>
              <input
                id="live-min-sale"
                type="number"
                min={1}
                value={draft.minSaleIntervalMinutes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, minSaleIntervalMinutes: Number(e.target.value) || 10 }))
                }
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-max-clean">Max hours without cleaning</label>
              <input
                id="live-max-clean"
                type="text"
                placeholder="e.g. 48"
                value={draft.maxHoursWithoutCleaning}
                onChange={(e) => setDraft((d) => ({ ...d, maxHoursWithoutCleaning: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-max-qc">Max hours without QC visit</label>
              <input
                id="live-max-qc"
                type="text"
                placeholder="e.g. 168"
                value={draft.maxHoursWithoutQc}
                onChange={(e) => setDraft((d) => ({ ...d, maxHoursWithoutQc: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-mail">Strike operator email</label>
              <input
                id="live-mail"
                type="email"
                value={draft.strikeOperatorEmail}
                onChange={(e) => setDraft((d) => ({ ...d, strikeOperatorEmail: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-target">Daily sales target</label>
              <input
                id="live-target"
                type="text"
                value={draft.dailySalesTarget}
                onChange={(e) => setDraft((d) => ({ ...d, dailySalesTarget: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-shift">Expected shift (HH:MM)</label>
              <input
                id="live-shift"
                type="text"
                placeholder="08:00"
                value={draft.expectedShiftStart}
                onChange={(e) => setDraft((d) => ({ ...d, expectedShiftStart: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-tz">Shift timezone</label>
              <input
                id="live-tz"
                type="text"
                value={draft.shiftTimezone}
                onChange={(e) => setDraft((d) => ({ ...d, shiftTimezone: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-grace">Shift grace (min)</label>
              <input
                id="live-grace"
                type="number"
                min={0}
                value={draft.shiftGraceMinutes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, shiftGraceMinutes: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-lc">Last cleaning (ISO)</label>
              <input
                id="live-lc"
                type="text"
                placeholder="2026-04-12T10:00:00+03:00"
                value={draft.lastCleaningAt}
                onChange={(e) => setDraft((d) => ({ ...d, lastCleaningAt: e.target.value }))}
              />
            </div>
            <div className={styles.adminRow}>
              <label htmlFor="live-lq">Last QC visit (ISO)</label>
              <input
                id="live-lq"
                type="text"
                value={draft.lastQcVisitAt}
                onChange={(e) => setDraft((d) => ({ ...d, lastQcVisitAt: e.target.value }))}
              />
            </div>
            <div className={styles.adminActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={!adminMid.trim() || saveCfgMut.isPending}
                onClick={() => saveCfgMut.mutate()}
              >
                {saveCfgMut.isPending ? 'Saving…' : 'Save machine config'}
              </button>
            </div>
            {saveCfgMut.isError && <div className={styles.err}>Save failed.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
