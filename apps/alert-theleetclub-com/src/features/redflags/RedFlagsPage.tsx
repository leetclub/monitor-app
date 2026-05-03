import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertCompareMode, RedAlertDetailPayload, RedAlertRow } from './redAlertTypes';
import {
  baselineReasonMap,
  buildDetailPayload,
  filterSnapshotRows,
  freqColumnHeading,
  freqSplit,
  getMachineIdRaw,
  getOperatorDisplay,
  rankRows,
  reasonKey,
  rowHappensForSort,
  type RankedRedAlertRow,
} from './redFlagsModel';
import styles from './RedFlagsBoard.module.css';

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  fromCache?: boolean;
  cacheStale?: boolean;
  rows?: RedAlertRow[];
  error?: string;
};

const CMP_KEY = 'leetAlertRedFlagsCompareMode';

function readCompareMode(): RedAlertCompareMode {
  try {
    const raw = sessionStorage.getItem(CMP_KEY);
    if (raw === 'lw') return 'sameWeekdayLw';
    if (raw === 'yesterday') return 'yesterday';
    return 'week';
  } catch {
    return 'week';
  }
}

function persistCompareMode(mode: RedAlertCompareMode): void {
  try {
    const v = mode === 'sameWeekdayLw' ? 'lw' : mode === 'yesterday' ? 'yesterday' : 'week';
    sessionStorage.setItem(CMP_KEY, v);
  } catch {
    /* ignore */
  }
}

function compareSummary(mode: RedAlertCompareMode): string {
  switch (mode) {
    case 'week':
      return 'WTD vs last week';
    case 'sameWeekdayLw':
      return 'Today vs same weekday last week';
    case 'yesterday':
      return 'Today vs yesterday';
    default:
      return 'WTD vs last week';
  }
}

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
  const [compareMode, setCompareMode] = useState<RedAlertCompareMode>(() => readCompareMode());
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

  const snapTime = q.data?.generatedAt || q.data?.cacheGeneratedAt || null;

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

  const freqHeading = useMemo(() => freqColumnHeading(compareMode), [compareMode]);

  const emptyClear = q.isSuccess && ranked.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.board}>
        <header className={styles.topBar}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Red Flags</h1>
            <p className={styles.sub}>
              Same live snapshot and ranking as Monitor Red Alert: stale tx, OFF, vend failures (A+B+C frequency).{' '}
              Excludes test machines by IMEI substring.
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
          <details className={styles.compareDetailsTicker}>
            <summary className={styles.compareSummary}>
              <span className={styles.compareSummaryLabel}>Baseline</span>
              <span className={styles.compareSummaryValue}>{compareSummary(compareMode)}</span>
            </summary>
            <div
              className={styles.comparePanel}
              role="presentation"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div className={styles.compareRow} role="group" aria-label="Trend baseline">
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnCompare} ${compareMode === 'week' ? styles.btnCompareActive : ''}`}
                  onClick={() => {
                    setCompareMode('week');
                    persistCompareMode('week');
                  }}
                >
                  WTD
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnCompare} ${compareMode === 'sameWeekdayLw' ? styles.btnCompareActive : ''}`}
                  onClick={() => {
                    setCompareMode('sameWeekdayLw');
                    persistCompareMode('sameWeekdayLw');
                  }}
                  title="Same weekday last week (same elapsed window)"
                >
                  −1w day
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnCompare} ${compareMode === 'yesterday' ? styles.btnCompareActive : ''}`}
                  onClick={() => {
                    setCompareMode('yesterday');
                    persistCompareMode('yesterday');
                  }}
                >
                  Yesterday
                </button>
              </div>
              <p className={styles.compareHintTicker}>Kuwait day modes: midnight→now. Weekly % uses prorated last week.</p>
            </div>
          </details>
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
                      Machine
                      <span className={styles.thSub}>Name · ID · flags</span>
                    </th>
                    <th className={styles.th}>
                      Location
                      <span className={styles.thSub}>Vendon / site</span>
                    </th>
                    <th className={styles.th}>
                      Operator
                      <span className={styles.thSub}>Live ops · cleaning</span>
                    </th>
                    <th className={`${styles.th} ${styles.thFreq}`}>
                      {freqHeading.title}
                      <span className={styles.thSub}>{freqHeading.sub}</span>
                    </th>
                    <th className={styles.th}>Go check</th>
                    <th className={styles.th}>Details</th>
                    <th className={styles.th}>PFA</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((d, r) => {
                    const row = d.row;
                    const machId = String(getMachineIdRaw(row) || '');
                    const fq = freqSplit(row, compareMode);
                    const pri = row.alertPriorityTier != null ? Number(row.alertPriorityTier) : 1;
                    const p2 = pri === 2 || !!row.duringScheduledCleaningNow;
                    const hwN = rowHappensForSort(row, compareMode);
                    const hot = hwN >= 10;
                    const rk = r === 0 ? 1 : Math.max(0, 0.58 - (r - 1) * 0.055);
                    const pfaRaw = row.pfaExcludeCleaning;
                    let goUrl = row.goCheckUrl || null;
                    if (!goUrl && row.strikeOperatorEmail) {
                      const emGo = String(row.strikeOperatorEmail).trim();
                      if (emGo.includes('@')) {
                        goUrl = `mailto:${emGo}?subject=${encodeURIComponent(`Red Flags — Go check: ${row.machineName || machId}`)}`;
                      }
                    }
                    const loc = row.machineLocation != null && String(row.machineLocation).trim() ? String(row.machineLocation).trim() : '—';

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
                          {(row.reasons || []).slice(0, 1).map((reason, idx) => (
                            <div key={idx} className={styles.lastReason}>
                              {reason}
                            </div>
                          ))}
                        </td>
                        <td className={styles.td}>{loc}</td>
                        <td className={styles.td}>{getOperatorDisplay(row)}</td>
                        <td className={styles.td}>
                          <div className={styles.freq} title={fq.title}>
                            <svg className={styles.freqSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                              <line
                                x1="0"
                                y1="100"
                                x2="100"
                                y2="0"
                                stroke="rgba(148,163,184,0.55)"
                                strokeWidth="1.25"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                            <span className={styles.freqTop}>{fq.top}</span>
                            <span
                              className={`${styles.freqBot} ${
                                fq.bottomClass === 'up'
                                  ? fq.upBand === 4
                                    ? styles.freqUp4
                                    : fq.upBand === 3
                                      ? styles.freqUp3
                                      : fq.upBand === 2
                                        ? styles.freqUp2
                                        : styles.freqUp1
                                  : fq.bottomClass === 'down'
                                    ? styles.freqDown
                                    : styles.freqFlat
                              }`}
                            >
                              {fq.bottom}
                            </span>
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
                              Go check
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={styles.td}>
                          <button type="button" className={styles.btn} onClick={(e) => (e.stopPropagation(), openDetail(d))}>
                            Open
                          </button>
                        </td>
                        <td className={styles.td}>{pfaRaw === true ? 'Yes' : pfaRaw === false ? 'No' : '—'}</td>
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
