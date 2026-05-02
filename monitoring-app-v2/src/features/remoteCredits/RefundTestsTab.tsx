import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import { fetchVendonMachines } from '@/features/events/eventsApi';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import { DateInput } from '@/components/DateInput';
import shell from '@/features/_shared/featureShell.module.css';
import {
  type RemoteCreditsLogRow,
  type RemoteCreditsResponse,
  bootstrapRemoteCredits,
  formatRefundTestProduct,
  queryRemoteCredits,
  saveRemoteCreditReason,
  yesterdayIsoLocal,
} from './refundTestsApi';
import { kuwaitDateISO } from '@/lib/kuwaitDate';
import styles from './RefundTestsTab.module.css';

const MANUAL_OPTIONS = ['A. Drink Test', 'B. Next-day refund', 'C. Reason Unidentified'] as const;

function fmtAmount(n: number | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtDateTime(row: RemoteCreditsLogRow): string {
  if (row.datetime) {
    try {
      return new Date(row.datetime).toLocaleString();
    } catch {
      /* fall through */
    }
  }
  const ts = row.timestamp;
  if (ts == null || !Number.isFinite(ts)) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function rowStableId(row: RemoteCreditsLogRow, idx: number): string {
  const id = row.id != null && String(row.id).trim() !== '' ? String(row.id) : '';
  const mid = row.machine_id != null ? String(row.machine_id) : '';
  const ts = row.timestamp != null ? String(row.timestamp) : '';
  if (id) return id;
  return `rc-${mid}-${ts}-${idx}`;
}

function filterRemoteCreditsResponse(full: RemoteCreditsResponse, machineId: string): RemoteCreditsResponse {
  const logs = full.logs.filter((l) => String(l.machine_id) === machineId);
  const totals = full.totals.filter((t) => String(t.machine_id) === machineId);
  return {
    ...full,
    logs,
    totals,
    filters: {
      ...full.filters,
      startDate: full.filters?.startDate,
      endDate: full.filters?.endDate,
      machineId,
    },
  };
}

function categoryClass(cat: string | undefined): string {
  if (cat === 'Custom Refunds') return styles.catCellRefund;
  if (cat === 'Drink Tests') return styles.catCellDrink;
  if (cat === 'Reason Unidentified') return styles.catCellUnknown;
  return '';
}

function reasonDisplay(log: RemoteCreditsLogRow): string {
  const category = log.category || log.status || '';
  const note = log.category_note || '';
  if (note) return note;
  const mf = log.matched_failed_dispense;
  const mr = log.matched_remote_credit;
  if (category === 'Custom Refunds') {
    if (mf?.product_name) {
      let t = '';
      try {
        if (mf.datetime) t = new Date(mf.datetime).toLocaleTimeString();
        else if (mf.timestamp) t = new Date(mf.timestamp * 1000).toLocaleTimeString();
      } catch {
        /* ignore */
      }
      return `Matched with failed dispense "${mf.product_name}"${t ? ` at ${t}` : ''} within 5 minutes - Customer Service KPI met.`;
    }
    return 'Matched with failed dispense within 5 minutes - remediation credit.';
  }
  if (category === 'Drink Tests') return 'Within 30 minutes of first refund test of day - QA drink test.';
  if (category === 'Reason Unidentified') return log.manual_reason || 'No failed dispense within 5 min and not within drink test window.';
  if (mr?.user_name) return note || `Remote credit: ${mr.user_name}`;
  return note || '—';
}

function matchedInfo(log: RemoteCreditsLogRow): string {
  const mf = log.matched_failed_dispense;
  const mr = log.matched_remote_credit;
  let s = '';
  if (mf) {
    s += `Failed: ${mf.product_name || 'Unknown'} (sel: ${mf.selection || 'N/A'})`;
  }
  if (mr) {
    if (s) s += ' | ';
    s += `Remote Credit: ${fmtAmount(mr.amount as number)} by ${mr.user_name || 'Unknown'}`;
  }
  return s || '—';
}

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const esc = (c: string) => `"${String(c).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function RefundTestsTab() {
  const { canSeeTab, isLoading: accessLoading } = useAccess();
  const allowed = canSeeTab('remoteCredits');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [machineId, setMachineId] = useState('');
  const [cachedAll, setCachedAll] = useState<RemoteCreditsResponse | null>(null);
  const [drillMid, setDrillMid] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<RemoteCreditsResponse | null>(null);
  const [helpOpen, setHelpOpen] = useState(true);
  const [expandTotals, setExpandTotals] = useState(false);
  const [expandLogs, setExpandLogs] = useState(false);
  const autoRef = useRef(false);

  const machinesQ = useQuery({
    queryKey: ['vendon', 'machines'],
    queryFn: fetchVendonMachines,
    enabled: allowed && !accessLoading,
    staleTime: 60_000,
  });

  const loadMutation = useMutation({
    mutationFn: queryRemoteCredits,
    onSuccess: (res) => {
      setLastFetch(res);
      const mid = (res.filters?.machineId || '').trim();
      if (!mid) setCachedAll(res);
      else setCachedAll(null);
      setDrillMid(null);
    },
  });

  const displayed = useMemo(() => {
    if (
      drillMid &&
      cachedAll &&
      cachedAll.filters?.startDate === startDate &&
      cachedAll.filters?.endDate === endDate
    ) {
      return filterRemoteCreditsResponse(cachedAll, drillMid);
    }
    return lastFetch;
  }, [drillMid, cachedAll, lastFetch, startDate, endDate]);

  const errMsg =
    loadMutation.error instanceof Error ? loadMutation.error.message : loadMutation.error ? String(loadMutation.error) : null;
  const hint = loadMutation.error ? backendHintFromError(loadMutation.error) : null;

  const runLoad = useCallback(() => {
    if (!startDate || !endDate) return;
    loadMutation.mutate({
      startDate,
      endDate,
      machineId: machineId.trim(),
    });
  }, [startDate, endDate, machineId, loadMutation]);

  /** Auto-load yesterday once: prefer DB preload (top machine) like classic; else all machines. */
  useEffect(() => {
    if (!allowed || accessLoading || autoRef.current) return;
    autoRef.current = true;
    const y = yesterdayIsoLocal();
    setStartDate(y);
    setEndDate(y);

    void (async () => {
      try {
        const boot = await bootstrapRemoteCredits(y);
        const pre = boot.payload?.prefetchedResponse;
        if (boot.hasPreload && pre && pre.success) {
          setLastFetch(pre);
          setCachedAll(null);
          const bid = boot.payload?.bestMachine?.machine_id;
          setMachineId(bid != null && String(bid).trim() !== '' ? String(bid) : '');
          return;
        }
      } catch {
        /* fall through to full query */
      }
      setMachineId('');
      loadMutation.mutate({ startDate: y, endDate: y, machineId: '' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [allowed, accessLoading]);

  /** After the first load, date/machine changes should refresh results (debounced). */
  useEffect(() => {
    if (!allowed || accessLoading) return;
    if (!lastFetch) return; // nothing loaded yet
    if (!startDate || !endDate) return;
    const id = window.setTimeout(() => {
      loadMutation.mutate({ startDate, endDate, machineId: machineId.trim() });
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- we intentionally debounce changes
  }, [allowed, accessLoading, startDate, endDate, machineId]);

  const categoryCounts = useMemo(() => {
    const logs = displayed?.logs ?? [];
    let customRefunds = 0;
    let drinkTests = 0;
    let reasonUnidentified = 0;
    for (const log of logs) {
      const c = log.category || log.status || '';
      if (c === 'Custom Refunds') customRefunds++;
      else if (c === 'Drink Tests') drinkTests++;
      else if (c === 'Reason Unidentified') reasonUnidentified++;
    }
    return { customRefunds, drinkTests, reasonUnidentified };
  }, [displayed]);

  const isSingleMachineView = Boolean((displayed?.filters?.machineId || '').trim() || drillMid);

  const singleMachineTotal = displayed?.totals?.[0];

  const setQuickRange = (range: 'today' | 'yesterday' | 'lastWeek' | 'lastMonth') => {
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (range === 'lastWeek') {
      start.setDate(start.getDate() - 7);
    } else if (range === 'lastMonth') {
      start.setDate(start.getDate() - 30);
    }
    // Kuwait calendar dates (avoid UTC toISOString() off-by-one)
    setStartDate(kuwaitDateISO(start));
    setEndDate(kuwaitDateISO(end));
  };

  const clearFilters = () => {
    setMachineId('');
    setStartDate('');
    setEndDate('');
    setCachedAll(null);
    setDrillMid(null);
    setLastFetch(null);
  };

  const logs = displayed?.logs ?? [];
  const totals = displayed?.totals ?? [];
  const hadError = lastFetch && lastFetch.success === false;

  return (
    <div className={shell.wrap}>
      <p className={shell.intro}>
        <strong>Refund Tests</strong> matches WEB cashless vends to failed dispense events and remote credits (same rules
        as the classic dashboard). Dates use the Kuwait operations day window on the server.
      </p>

      {!allowed && !accessLoading && (
        <p className={shell.hint}>You do not have access to this tab.</p>
      )}

      {allowed && (
        <>
          <div className={shell.filters}>
            <div className={shell.field}>
              <label htmlFor="rc-machine">Machine</label>
              <select
                id="rc-machine"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                disabled={loadMutation.isPending || machinesQ.isLoading}
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
              <label htmlFor="rc-start">Start date</label>
              <DateInput
                id="rc-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className={shell.field}>
              <label htmlFor="rc-end">End date</label>
              <DateInput id="rc-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className={shell.field}>
              <span className={shell.quickLabel}>Quick ranges</span>
              <div className={shell.quickBtns}>
                <button type="button" onClick={() => setQuickRange('today')}>
                  Today
                </button>
                <button type="button" onClick={() => setQuickRange('yesterday')}>
                  Yesterday
                </button>
                <button type="button" onClick={() => setQuickRange('lastWeek')}>
                  Last week
                </button>
                <button type="button" onClick={() => setQuickRange('lastMonth')}>
                  Last month
                </button>
              </div>
            </div>
            <div className={shell.actions}>
              <button type="button" className={shell.btnPrimary} onClick={() => runLoad()} disabled={loadMutation.isPending}>
                {loadMutation.isPending ? 'Loading…' : 'Load Refund Tests'}
              </button>
              <button type="button" className={shell.btn} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </div>

          {(errMsg || hadError) && (
            <p className={shell.hint} role="alert">
              {hadError && lastFetch?.error ? lastFetch.error : errMsg}
              <BackendHint message={hint} />
            </p>
          )}

          <div className={styles.helpBox}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <strong>How Refund Tests Are Categorized</strong>
              <button type="button" className={shell.btn} onClick={() => setHelpOpen(!helpOpen)}>
                {helpOpen ? 'Hide details' : 'Show details'}
              </button>
            </div>
            {helpOpen && (
              <>
                <div className={styles.helpGrid}>
                  <div className={styles.helpCard} style={{ borderLeft: '3px solid #4caf50' }}>
                    <strong>Custom Refunds</strong>
                    <div>Matched with a vend failed event within <strong>5 minutes</strong> (customer service KPI).</div>
                  </div>
                  <div className={styles.helpCard} style={{ borderLeft: '3px solid #2196f3' }}>
                    <strong>Drink Tests</strong>
                    <div>
                      First WEB cashless of the day plus transactions within <strong>30 minutes</strong> (QA drink test
                      window).
                    </div>
                  </div>
                  <div className={styles.helpCard} style={{ borderLeft: '3px solid #ff9800' }}>
                    <strong>Reason Unidentified</strong>
                    <div>
                      Everything else — assign a manual reason for investigation. Requires Vendon cloud credentials on the
                      API for remote credit confirmation from logs.
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {logs.length > 0 && (
            <div className={styles.summaryGrid}>
              <div className={`${styles.summaryCard} ${styles.catRefund}`}>
                <strong>{categoryCounts.customRefunds}</strong>
                Custom Refunds
              </div>
              <div className={`${styles.summaryCard} ${styles.catDrink}`}>
                <strong>{categoryCounts.drinkTests}</strong>
                Drink Tests
              </div>
              <div className={`${styles.summaryCard} ${styles.catUnknown}`}>
                <strong>{categoryCounts.reasonUnidentified}</strong>
                Reason Unidentified
              </div>
            </div>
          )}

          {isSingleMachineView && singleMachineTotal && (
            <div className={styles.singleSummary}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{singleMachineTotal.machine_name || singleMachineTotal.machine_id}</h3>
                  {drillMid && cachedAll && (
                    <button type="button" className={shell.btn} onClick={() => setDrillMid(null)}>
                      ← Back to all machines
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Selected machine only</div>
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{singleMachineTotal.count ?? 0}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Total credits</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{fmtAmount(singleMachineTotal.total_amount)}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Total amount</div>
                </div>
              </div>
            </div>
          )}

          <div className={styles.tables}>
            {!isSingleMachineView && (
              <div className={styles.totalsPane}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Totals per machine</h3>
                  <div className={shell.actions}>
                    <button
                      type="button"
                      className={shell.btn}
                      onClick={() =>
                        exportCsv(
                          `refund-tests-totals_${startDate}_to_${endDate}.csv`,
                          ['Machine', 'Count', 'Total amount'],
                          totals.map((t) => [
                            String(t.machine_name || t.machine_id || ''),
                            String(t.count ?? 0),
                            fmtAmount(t.total_amount as number),
                          ]),
                        )
                      }
                      disabled={totals.length === 0}
                    >
                      CSV
                    </button>
                    <button type="button" className={shell.btn} onClick={() => setExpandTotals(!expandTotals)}>
                      {expandTotals ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                </div>
                <div className={`${styles.tableScroll} ${expandTotals ? styles.tableScrollExpanded : ''}`}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Machine</th>
                        <th className={styles.num}>Count</th>
                        <th className={styles.num}>Total amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                            {loadMutation.isPending ? 'Loading…' : 'No data loaded'}
                          </td>
                        </tr>
                      )}
                      {totals.map((t) => (
                        <tr key={String(t.machine_id)}>
                          <td>
                            <button
                              type="button"
                              className={styles.machineLink}
                              onClick={() => setDrillMid(String(t.machine_id))}
                            >
                              {t.machine_name || t.machine_id}
                            </button>
                          </td>
                          <td className={styles.num}>{t.count ?? 0}</td>
                          <td className={styles.num}>{fmtAmount(t.total_amount as number)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className={styles.logsPane} style={{ flex: isSingleMachineView ? '1 1 100%' : '2 1 400px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Credits log</h3>
                <div className={shell.actions}>
                  <button
                    type="button"
                    className={shell.btn}
                    onClick={() =>
                      exportCsv(
                        `refund-tests-log_${startDate}_to_${endDate}.csv`,
                        [
                          'Date/time',
                          ...(isSingleMachineView ? [] : ['Machine']),
                          'Product',
                          'Amount',
                          'Category',
                          'Reason',
                          'Manual reason',
                          'User',
                          'Matched info',
                          'Note',
                        ],
                        logs.map((log) => {
                          const base = [
                            fmtDateTime(log),
                            ...(isSingleMachineView ? [] : [String(log.machine_name || log.machine_id || '')]),
                            formatRefundTestProduct(log),
                            fmtAmount(log.credit_amount as number),
                            String(log.category || log.status || ''),
                            reasonDisplay(log),
                            String(log.manual_reason || ''),
                            String(log.user_name || ''),
                            matchedInfo(log),
                            String(log.category_note || ''),
                          ];
                          return base;
                        }),
                      )
                    }
                    disabled={logs.length === 0}
                  >
                    CSV
                  </button>
                  <button type="button" className={shell.btn} onClick={() => setExpandLogs(!expandLogs)}>
                    {expandLogs ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
              <div className={`${styles.tableScroll} ${expandLogs ? styles.tableScrollExpanded : ''}`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Date/time</th>
                      {!isSingleMachineView && <th>Machine</th>}
                      <th>Product</th>
                      <th className={styles.num}>Amount</th>
                      <th>Category</th>
                      <th>Reason</th>
                      <th>Manual reason</th>
                      <th>User</th>
                      <th>Matched</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={isSingleMachineView ? 9 : 10} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                          {loadMutation.isPending ? 'Loading…' : 'No credits in selected period'}
                        </td>
                      </tr>
                    )}
                    {logs.map((log, idx) => {
                      const cat = log.category || log.status || '';
                      const rid = rowStableId(log, idx);
                      const mid = String(log.machine_id ?? '');
                      const ts = Number(log.timestamp ?? 0);
                      const presetValue =
                        log.manual_reason && MANUAL_OPTIONS.includes(log.manual_reason as (typeof MANUAL_OPTIONS)[number])
                          ? log.manual_reason
                          : '';
                      const textValue =
                        log.manual_reason && !MANUAL_OPTIONS.includes(log.manual_reason as (typeof MANUAL_OPTIONS)[number])
                          ? log.manual_reason
                          : '';

                      return (
                        <tr key={rid}>
                          <td>{fmtDateTime(log)}</td>
                          {!isSingleMachineView && (
                            <td>
                              <button
                                type="button"
                                className={styles.machineLink}
                                onClick={() => {
                                  setDrillMid(String(log.machine_id));
                                }}
                              >
                                {log.machine_name || log.machine_id}
                              </button>
                            </td>
                          )}
                          <td>{formatRefundTestProduct(log)}</td>
                          <td className={styles.num}>{fmtAmount(log.credit_amount as number)}</td>
                          <td className={categoryClass(cat)} title={log.category_note || cat}>
                            {cat}
                          </td>
                          <td style={{ maxWidth: '14rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
                            {reasonDisplay(log)}
                          </td>
                          <td>
                            {cat === 'Reason Unidentified' ? (
                              <ManualReasonEditor
                                rowId={rid}
                                logId={String(log.id ?? rid)}
                                machineId={mid}
                                timestamp={ts}
                                presetValue={presetValue}
                                textValue={textValue}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>{log.user_name || '—'}</td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{matchedInfo(log)}</td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{log.category_note || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ManualReasonEditor({
  rowId,
  logId,
  machineId,
  timestamp,
  presetValue,
  textValue,
}: {
  rowId: string;
  logId: string;
  machineId: string;
  timestamp: number;
  presetValue: string;
  textValue: string;
}) {
  const [preset, setPreset] = useState(presetValue);
  const [text, setText] = useState(textValue);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setPreset(presetValue);
    setText(textValue);
  }, [presetValue, textValue, rowId]);

  const fire = async (reason: string) => {
    setStatus('Saving…');
    try {
      const res = await saveRemoteCreditReason({
        logId,
        machineId,
        timestamp,
        reason,
      });
      if (res.success) {
        setStatus('Saved');
        window.setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('Error');
      }
    } catch {
      setStatus('Error');
    }
  };

  return (
    <div>
      <select
        className={styles.reasonSelect}
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          setPreset(v);
          if (v) fire(v);
        }}
      >
        <option value="">Select reason…</option>
        {MANUAL_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <input
        className={styles.reasonInput}
        type="text"
        placeholder="Or enter custom reason…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim()) fire(text.trim());
        }}
      />
      <span className={styles.reasonStatus}>{status}</span>
    </div>
  );
}
