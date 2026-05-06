import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  comparePresetToRedAlertMode,
  freqHeadingForComparePreset,
  initialCompareSelection,
  persistCompareSelection,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import type { RedAlertDetailPayload, RedAlertRow } from './redAlertTypes';
import {
  baselineReasonMap,
  buildDetailPayload,
  filterSnapshotRows,
  freqSplit,
  getMachineIdRaw,
  getOperatorDisplay,
  isLastTransactionEstimated,
  pickLastEventTs,
  pickLastTransactionTs,
  rankRows,
  reasonKey,
  rowHappensForSort,
  type RankedRedAlertRow,
} from './redFlagsModel';
import { RED_FLAGS_COLUMNS } from './redFlagsWorkbookColumns';
import styles from './RedFlagsBoard.module.css';

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  fromCache?: boolean;
  cacheStale?: boolean;
  rows?: RedAlertRow[];
  error?: string;
};

type RemoteCreditsTodayTotals = {
  date?: string | null;
  byMachineId?: Record<string, { credits_sent?: number; dispense_tests?: number }>;
  error?: string;
};

function parseTimestampMs(raw: string): number {
  const s = String(raw).trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return NaN;
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

function formatKuwaitTs(iso: string): string {
  const ms = parseTimestampMs(iso);
  if (!Number.isNaN(ms)) {
    try {
      return (
        new Date(ms).toLocaleString('en-GB', {
          timeZone: 'Asia/Kuwait',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' KWT'
      );
    } catch {
      return iso;
    }
  }
  return iso || '—';
}

/** Kuwait wall time with seconds (parity with Monitor Red Alert board). */
function formatRedAlertExactDateTime(iso: string): string {
  const ms = parseTimestampMs(iso);
  if (!Number.isNaN(ms)) {
    try {
      return (
        new Date(ms).toLocaleString('en-GB', {
          timeZone: 'Asia/Kuwait',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' KWT'
      );
    } catch {
      return iso;
    }
  }
  return iso || '—';
}

function LastTxLines({
  row,
  snapshotGeneratedAt,
}: {
  row: RedAlertRow;
  snapshotGeneratedAt?: string | null;
}) {
  const txRaw = pickLastTransactionTs(row, snapshotGeneratedAt);
  const evRaw = pickLastEventTs(row);
  const estimated = isLastTransactionEstimated(row, snapshotGeneratedAt);
  const hasTx = !!(txRaw != null && String(txRaw).trim());
  const hasEv = !!(evRaw != null && String(evRaw).trim());
  const evDistinct = hasEv && (!hasTx || String(evRaw).trim() !== String(txRaw).trim());
  const minOnly = row.minutesSinceLastTransaction ?? row.minutes_since_last_transaction;
  const minStr = minOnly != null ? String(minOnly).trim() : '';
  return (
    <>
      {hasTx ? (
        <div className={styles.lastTx}>
          Last tx: {formatRedAlertExactDateTime(String(txRaw))}
          {estimated ? <span className={styles.lastTxEst}> (est.)</span> : null}
        </div>
      ) : minStr !== '' ? (
        <div className={styles.lastTx}>
          Last tx: {minStr} min since sale <span className={styles.lastTxEst}>(no ISO)</span>
        </div>
      ) : null}
      {evDistinct ? (
        <div className={styles.lastTx}>Last OFF event: {formatRedAlertExactDateTime(String(evRaw))}</div>
      ) : null}
      {!hasTx && minStr === '' && !evDistinct ? <div className={styles.lastTx}>Last tx: —</div> : null}
    </>
  );
}

function DetailModal({ payload, onClose }: { payload: RedAlertDetailPayload; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fq = payload.frequency || {};
  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="red-flags-detail-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h2 id="red-flags-detail-title" className={styles.modalTitle}>
            {payload.machineName || payload.machineId}
          </h2>
          <button type="button" className={styles.btn} onClick={onClose}>
            Close
          </button>
        </div>
        <p className={styles.mutedSmall}>{payload.statusLabel}</p>
        <p>
          <strong>Operator:</strong> {payload.operator}
          {payload.cleaningOperator ? ` · Cleaning: ${payload.cleaningOperator}` : null}
        </p>
        <p>
          <strong>Last tx:</strong>{' '}
          {payload.lastTransactionAtUtc
            ? formatKuwaitTs(String(payload.lastTransactionAtUtc))
            : payload.minutesSinceLastTransaction != null
              ? `${payload.minutesSinceLastTransaction} min since sale`
              : '—'}
          {payload.lastTransactionEstimated ? ' (estimated)' : null}
        </p>
        {payload.lastOffEventAt || payload.lastOffEventAtUtc ? (
          <p>
            <strong>Last OFF event:</strong>{' '}
            {formatKuwaitTs(String(payload.lastOffEventAt || payload.lastOffEventAtUtc || ''))}
          </p>
        ) : null}
        <p>
          <strong>Reasons:</strong>
        </p>
        <ul>
          {(payload.reasons || []).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p className={styles.mutedSmall}>
          WTD hits: {payload.happensWeek ?? fq.totalCriteriaHitsThisWeek ?? '—'} · Trend %:{' '}
          {payload.happenedPctVsPriorWeek ?? '—'}
        </p>
        {payload.goCheckUrl ? (
          <p>
            <a href={payload.goCheckUrl} className={styles.btnPrimary} style={{ display: 'inline-flex', marginTop: 8 }}>
              Go check
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function RedFlagsPage() {
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const compareMode = useMemo(() => comparePresetToRedAlertMode(compare.preset), [compare.preset]);
  const setComparePersist = useCallback((next: CompareSelection) => {
    setCompare(next);
    persistCompareSelection(next);
  }, []);

  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [ranked, setRanked] = useState<RankedRedAlertRow[]>([]);
  const [detail, setDetail] = useState<RedAlertDetailPayload | null>(null);
  const [ticker, setTicker] = useState<{ newN: number; updN: number; total: number } | null>(null);
  const prevReasonRef = useRef<Record<string, string>>({});
  const hasLoadedRef = useRef(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const q = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    refetchInterval: 60_000,
  });

  const creditsQ = useQuery({
    queryKey: ['alert-remote-credits-today-totals'],
    queryFn: () => apiGet<RemoteCreditsTodayTotals>('/api/alert/remote-credits/today-totals'),
    refetchInterval: 5 * 60_000,
  });

  const snapTime = q.data?.generatedAt || q.data?.cacheGeneratedAt || null;
  const creditsByMachineId = creditsQ.data?.byMachineId ?? {};

  useLayoutEffect(() => {
    if (!q.data) return;
    const rawRows = (q.data.rows ?? []) as RedAlertRow[];
    const rows = filterSnapshotRows(rawRows);
    let prevMap = prevReasonRef.current;
    if (!hasLoadedRef.current && rows.length) {
      prevMap = baselineReasonMap(rows);
    }
    hasLoadedRef.current = true;

    if (snapTime) {
      try {
        setGeneratedAt(new Date(snapTime).toLocaleString());
      } catch {
        setGeneratedAt(snapTime);
      }
    } else {
      setGeneratedAt(null);
    }

    if (!rows.length) {
      prevReasonRef.current = {};
      setRanked([]);
      setTicker({ newN: 0, updN: 0, total: 0 });
      return;
    }

    const list = rankRows(rows, prevMap, compareMode);
    const nextPrev: Record<string, string> = {};
    let newN = 0;
    let updN = 0;
    for (const d of list) {
      const machId = String(getMachineIdRaw(d.row) || '');
      nextPrev[machId] = reasonKey(d.row);
      if (d.isNew) newN += 1;
      else if (d.isChanged) updN += 1;
    }
    prevReasonRef.current = nextPrev;
    setRanked(list);
    setTicker({ newN, updN, total: rows.length });
  }, [q.data, q.dataUpdatedAt, compareMode, snapTime]);

  const openDetail = useCallback(
    (d: RankedRedAlertRow) => {
      const machId = String(getMachineIdRaw(d.row) || '');
      const statusLabel = d.isNew ? 'New alert' : d.isChanged ? 'Updated' : 'Ongoing';
      setDetail(buildDetailPayload(d.row, machId, statusLabel, compareMode, snapTime ?? null));
    },
    [compareMode, snapTime],
  );

  const freqHeading = useMemo(
    () => freqHeadingForComparePreset(compare.preset, compareMode),
    [compare.preset, compareMode],
  );

  const emptyClear = q.isSuccess && ranked.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.board}>
        <header className={styles.topBar}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Red Flags</h1>
            <p className={styles.sub}>
              Live Red Alert snapshot aligned with Monitor. Columns follow the operational checklist through{' '}
              <strong>GO CHECK</strong>; additional metrics appear when the feed includes them. Refreshes about once a minute.
              Test devices are excluded.
            </p>
          </div>
          <div className={styles.topRight}>
            <span className={styles.clock} aria-live="polite">
              {clock.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
            </span>
            <span className={styles.livePill}>
              <span className={styles.dot} aria-hidden />
              Live · ~1m
            </span>
            <button type="button" className={styles.btnPrimary} onClick={() => void q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <p className={styles.meta}>
          {generatedAt ? <>Snapshot: {generatedAt}</> : null}
          <span className={`${styles.syncHint} ${q.isFetching && ranked.length ? styles.syncHintOn : ''}`}> · Updating…</span>
        </p>

        <div className={styles.compareBar}>
          <ComparePresetPicker value={compare} onChange={setComparePersist} />
        </div>
        <p className={styles.compareBarHint}>
          Timespan presets match Overall (shared with this browser session). The trend column maps each preset to the Red
          Alert snapshot: Today VS Yesterday, Same weekday last week, or WTD — Kuwait calendar. Month-to-date and custom
          ranges stay selected for workbook KPI columns as the API adds period comparisons.
        </p>

        <div className={styles.tickerRow}>
          <div className={styles.tickerShell}>
            <div className={styles.tickerTrack} aria-live="polite">
              {!q.isFetched && <span className={styles.tMuted}>Loading snapshot…</span>}
              {q.isError && <span className={styles.tNew}>Could not load data</span>}
              {emptyClear && (
                <>
                  <span className={styles.tMuted}>All clear.</span>
                  <span style={{ color: 'var(--muted)' }}> No machines match right now.</span>
                </>
              )}
              {ticker && ranked.length > 0 && (
                <>
                  {ticker.newN > 0 && (
                    <span>
                      <span className={styles.tNew}>NEW</span> <span className={styles.tMuted}>{ticker.newN}</span>
                    </span>
                  )}
                  {ticker.updN > 0 && (
                    <span>
                      <span className={styles.tUpd}>UPD</span> <span className={styles.tMuted}>{ticker.updN}</span>
                    </span>
                  )}
                  <span className={styles.tMuted}>
                    {ticker.total} machine{ticker.total === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {q.isError ? (
          <div className={styles.err} role="alert">
            {(q.error as Error)?.message ?? 'Request failed'}
          </div>
        ) : null}

        <div className={styles.body}>
          {ranked.length > 0 && (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>
                      {RED_FLAGS_COLUMNS.vendingMachine.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.vendingMachine.sub}</span>
                    </th>
                    <th className={styles.th}>
                      {RED_FLAGS_COLUMNS.alertType.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.alertType.sub}</span>
                    </th>
                    <th className={styles.th}>
                      {RED_FLAGS_COLUMNS.operator.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.operator.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thFreq}`}>
                      {freqHeading.title}
                      <span className={styles.thSub}>{freqHeading.sub}</span>
                    </th>
                    <th className={styles.th}>
                      {RED_FLAGS_COLUMNS.goCheck.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.goCheck.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.sendCredit.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.sendCredit.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.vendsResolved.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.vendsResolved.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.testCredits.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.testCredits.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.lastCleaning.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.lastCleaning.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.qaVisit.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.qaVisit.sub}</span>
                    </th>
                    <th className={`${styles.th} ${styles.thNarrow}`}>
                      {RED_FLAGS_COLUMNS.techVisit.title}
                      <span className={styles.thSub}>{RED_FLAGS_COLUMNS.techVisit.sub}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((d, r) => {
                    const row = d.row;
                    const machId = String(getMachineIdRaw(row) || '');
                    const fq = freqSplit(row, compareMode);
                    const todayHitsRaw = row.happensToday != null ? row.happensToday : row.frequency?.totalCriteriaHitsToday;
                    const todayHits = todayHitsRaw != null ? Number(todayHitsRaw) : NaN;
                    const scoreText =
                      compareMode === 'week'
                        ? fq.top
                        : !Number.isNaN(todayHits)
                          ? `${todayHits}/d`
                          : fq.top;
                    const trendText = fq.bottom;
                    const trendIsGood = fq.bottomClass === 'down';
                    const scoreIsGood = (() => {
                      const n =
                        compareMode === 'week'
                          ? row.happensWeek != null
                            ? row.happensWeek
                            : row.frequency?.totalCriteriaHitsThisWeek
                          : todayHitsRaw;
                      const nn = n != null ? Number(n) : NaN;
                      return !Number.isNaN(nn) ? nn <= 0 : false;
                    })();
                    const gapText = (() => {
                      const n =
                        compareMode === 'week'
                          ? row.happensWeek != null
                            ? row.happensWeek
                            : row.frequency?.totalCriteriaHitsThisWeek
                          : todayHitsRaw;
                      const nn = n != null ? Number(n) : NaN;
                      if (Number.isNaN(nn)) return '—';
                      if (nn <= 0) return '0';
                      return `-${nn}`;
                    })();
                    const pri = row.alertPriorityTier != null ? Number(row.alertPriorityTier) : 1;
                    const p2 = pri === 2 || !!row.duringScheduledCleaningNow;
                    const hwN = rowHappensForSort(row, compareMode);
                    const hot = hwN >= 10;
                    const rk = r === 0 ? 1 : Math.max(0, 0.58 - (r - 1) * 0.055);
                    let goUrl = row.goCheckUrl || null;
                    if (!goUrl && row.strikeOperatorEmail) {
                      const emGo = String(row.strikeOperatorEmail).trim();
                      if (emGo.includes('@')) {
                        goUrl = `mailto:${emGo}?subject=${encodeURIComponent(`Red Flags — GO CHECK: ${row.machineName || machId}`)}`;
                      }
                    }
                    const alertTypeText =
                      row.reasons && row.reasons.length
                        ? String(row.reasons[row.reasons.length - 1] ?? '')
                            .replace(/\s+/g, ' ')
                            .trim()
                        : '—';
                    const alertTypeShow =
                      alertTypeText.length > 140 ? `${alertTypeText.slice(0, 140)}…` : alertTypeText;

                    return (
                      <tr
                        key={machId || `${r}`}
                        className={`${styles.tr} ${d.isNew ? styles.trNew : ''} ${d.isChanged ? styles.trUpdated : ''} ${hot ? styles.rowHot : ''} ${p2 ? styles.rowP2 : ''}`}
                        style={{ '--ra-rank-strength': rk.toFixed(3) } as CSSProperties}
                        tabIndex={0}
                        onClick={() => openDetail(d)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            openDetail(d);
                          }
                        }}
                      >
                        <td className={styles.td}>
                          {d.isNew && <span className={`${styles.chip} ${styles.chipNew}`}>New</span>}
                          {d.isChanged && !d.isNew && <span className={`${styles.chip} ${styles.chipUpd}`}>Updated</span>}
                          {p2 && (
                            <span className={`${styles.chip} ${styles.chipP2}`} title="Inside scheduled cleaning window">
                              P2
                            </span>
                          )}
                          <div className={styles.machineName}>{row.machineName || machId}</div>
                          <div className={styles.machineId}>#{machId}</div>
                          <LastTxLines row={row} snapshotGeneratedAt={snapTime ?? null} />
                        </td>
                        <td className={styles.td}>
                          <div className={styles.alertTypeCell} title={row.reasons?.length ? row.reasons.join(' · ') : ''}>
                            {alertTypeShow}
                          </div>
                        </td>
                        <td className={styles.td}>{getOperatorDisplay(row)}</td>
                        <td className={styles.td}>
                          <div className={styles.freq3} title={fq.title}>
                            <div className={`${styles.freqBox} ${scoreIsGood ? styles.freqGood : styles.freqBad}`}>
                              <div className={styles.freqBoxTop}>Score</div>
                              <div className={styles.freqBoxVal}>{scoreText}</div>
                            </div>
                            <div
                              className={`${styles.freqBox} ${
                                trendText.includes('—') ? styles.freqNeutral : trendIsGood ? styles.freqGood : styles.freqBad
                              }`}
                            >
                              <div className={styles.freqBoxTop}>Trend</div>
                              <div className={styles.freqBoxVal}>{trendText}</div>
                            </div>
                            <div
                              className={`${styles.freqBox} ${
                                gapText === '0' ? styles.freqGood : gapText === '—' ? styles.freqNeutral : styles.freqBad
                              }`}
                            >
                              <div className={styles.freqBoxTop}>Gap</div>
                              <div className={styles.freqBoxVal}>{gapText}</div>
                            </div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          {goUrl ? (
                            <a
                              href={goUrl}
                              className={styles.linkGo}
                              {...(goUrl.toLowerCase().startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                              onClick={(e) => e.stopPropagation()}
                            >
                              GO CHECK
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.sendCredit.placeholderNote}>
                          {machId && creditsByMachineId[machId]?.credits_sent != null ? (
                            <span>{String(creditsByMachineId[machId]?.credits_sent ?? 0)}</span>
                          ) : (
                            <span className={styles.wireDash}>—</span>
                          )}
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.vendsResolved.placeholderNote}>
                          <span className={styles.wireDash}>—</span>
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.testCredits.placeholderNote}>
                          {machId && creditsByMachineId[machId]?.dispense_tests != null ? (
                            <span>{String(creditsByMachineId[machId]?.dispense_tests ?? 0)}</span>
                          ) : (
                            <span className={styles.wireDash}>—</span>
                          )}
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.lastCleaning.placeholderNote}>
                          <span className={styles.wireDash}>—</span>
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.qaVisit.placeholderNote}>
                          <span className={styles.wireDash}>—</span>
                        </td>
                        <td className={styles.td} title={RED_FLAGS_COLUMNS.techVisit.placeholderNote}>
                          <span className={styles.wireDash}>—</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detail
        ? createPortal(<DetailModal payload={detail} onClose={() => setDetail(null)} />, document.body)
        : null}
    </div>
  );
}
