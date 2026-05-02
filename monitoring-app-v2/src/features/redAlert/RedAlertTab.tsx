import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BackendHint, backendHintForRedAlertSnapshot } from '@/features/_shared/BackendHint';
import {
  baselineReasonMap,
  buildDetailPayload,
  filterSnapshotRows,
  freqColumnHeading,
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
} from './redAlertModel';
import type { RedAlertCompareMode, RedAlertDetailPayload, RedAlertRow } from './redAlertTypes';
import { fetchRedAlertSnapshot } from './redAlertApi';
import styles from './RedAlertTab.module.css';

const RED_ALERT_CMP_MODE_KEY = 'redAlertCompareMode';

function readCompareModeInitial(): RedAlertCompareMode {
  try {
    const raw = sessionStorage.getItem(RED_ALERT_CMP_MODE_KEY);
    if (raw === 'lw') return 'sameWeekdayLw';
    if (raw === 'yesterday') return 'yesterday';
    if (raw === 'week') return 'week';
    if (sessionStorage.getItem('redAlertCompareSameDay') === '1') return 'sameWeekdayLw';
    return 'week';
  } catch {
    return 'week';
  }
}

function persistCompareMode(mode: RedAlertCompareMode): void {
  try {
    const v = mode === 'sameWeekdayLw' ? 'lw' : mode;
    sessionStorage.setItem(RED_ALERT_CMP_MODE_KEY, v);
  } catch {
    /* ignore */
  }
}

function compareModeSummaryLine(mode: RedAlertCompareMode): string {
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

/** Kuwait wall time with seconds (parity with legacy GAS board). */
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

function useNowClock(tick = true) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    if (!tick) return;
    const id = window.setInterval(() => setT(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [tick]);
  return t;
}

function DetailLastTxBlock({ payload }: { payload: RedAlertDetailPayload }) {
  const tx = payload.lastTransactionAtUtc;
  const ev = payload.lastOffEventAt ?? payload.lastOffEventAtUtc;
  const hasTx = !!(tx != null && String(tx).trim());
  const showEv =
    ev != null && String(ev).trim() && (!hasTx || String(ev).trim() !== String(tx).trim());
  return (
    <>
      <p>
        Last transaction: <strong>{hasTx ? formatRedAlertExactDateTime(String(tx)) : '—'}</strong>
      </p>
      {payload.lastTransactionEstimated ? (
        <p className={styles.mutedSmall}>Estimated from snapshot time and minutes since last sale.</p>
      ) : null}
      {!hasTx && payload.minutesSinceLastTransaction != null && String(payload.minutesSinceLastTransaction).trim() !== '' ? (
        <p className={styles.mutedSmall}>
          Relative only on snapshot: {String(payload.minutesSinceLastTransaction)} min since last sale (refresh Red Alert cache for full ISO).
        </p>
      ) : null}
      {showEv ? (
        <p>
          Last KNet/Machine OFF (received): <strong>{formatRedAlertExactDateTime(String(ev))}</strong>
        </p>
      ) : null}
    </>
  );
}

function DetailModal({
  payload,
  onClose,
}: {
  payload: RedAlertDetailPayload;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fq = payload.frequency || {};
  const gcu = payload.goCheckUrl;
  const isMailto = gcu && String(gcu).toLowerCase().startsWith('mailto:');

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="red-alert-detail-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h2 id="red-alert-detail-title" className={styles.modalTitle}>
            {payload.machineName || payload.machineId}
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.section}>
          <h4>Status</h4>
          <p>
            {payload.statusLabel === 'New alert' && <span className={`${styles.chip} ${styles.chipNew}`}>New</span>}
            {payload.statusLabel === 'Updated' && <span className={`${styles.chip} ${styles.chipUpd}`}>Updated</span>}
            {payload.statusLabel !== 'New alert' && payload.statusLabel !== 'Updated' && (
              <span className={styles.muted}>Ongoing</span>
            )}
          </p>
        </div>

        <div className={styles.section}>
          <h4>Identity</h4>
          <p>
            ID <strong>#{payload.machineId}</strong>
          </p>
          <p>Operator: {payload.operator || '—'}</p>
          {payload.cleaningOperator ? <p>Cleaning schedule contact: {payload.cleaningOperator}</p> : null}
        </div>

        <div className={styles.section}>
          <h4>Reasons</h4>
          {payload.reasons.length ? (
            <ul>
              {payload.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No reason strings on this snapshot.</p>
          )}
        </div>

        <div className={styles.section}>
          {payload.compareMode === 'week' ? (
            <>
              <h4>Frequency (Kuwait week · Sun–Sat)</h4>
              <DetailLastTxBlock payload={payload} />
              <p>
                Combined incidents (A+B+C): <strong>{payload.happensWeek != null ? payload.happensWeek : '—'}</strong>{' '}
                this week (WTD through snapshot time).
              </p>
              <p>
                Trend baseline (same number the % compares to — full last week × fraction of this week elapsed):{' '}
                <strong>
                  {payload.happenedLastWeekAlignedSlice != null
                    ? payload.happenedLastWeekAlignedSlice
                    : fq.totalCriteriaHitsLastWeekAlignedToWtD != null
                      ? fq.totalCriteriaHitsLastWeekAlignedToWtD
                      : '—'}
                </strong>
              </p>
              <p className={styles.mutedSmall}>
                Full prior Kuwait week (Sun–Sat), all seven days:{' '}
                <strong>
                  {payload.happenedLastWeek != null
                    ? payload.happenedLastWeek
                    : fq.totalCriteriaHitsLastWeek != null
                      ? fq.totalCriteriaHitsLastWeek
                      : '—'}
                </strong>{' '}
                — useful context, but <em>not</em> paired with WTD for the headline % (that uses the prorated baseline
                above).
              </p>
              <ul>
                <li>
                  <strong>A</strong> Stale sales (≥30 min gap, cleaning excluded):{' '}
                  {fq.staleSaleEpisodesThisWeek != null
                    ? fq.staleSaleEpisodesThisWeek
                    : fq.staleSaleEpisodes7d != null
                      ? fq.staleSaleEpisodes7d
                      : '—'}{' '}
                  /{' '}
                  {fq.staleSaleEpisodesLastWeek != null
                    ? fq.staleSaleEpisodesLastWeek
                    : fq.staleSaleEpisodesPrior7d != null
                      ? fq.staleSaleEpisodesPrior7d
                      : '—'}
                </li>
                <li>
                  <strong>B</strong> KNet/Machine OFF episodes (≥30 min operational, cleaning excluded):{' '}
                  {fq.offEpisodesThisWeek != null ? fq.offEpisodesThisWeek : fq.offEvents7d != null ? fq.offEvents7d : '—'}{' '}
                  /{' '}
                  {fq.offEpisodesLastWeek != null ? fq.offEpisodesLastWeek : fq.offEventsPrior7d != null ? fq.offEventsPrior7d : '—'}
                </li>
                <li>
                  <strong>C</strong> Vend failed events (week, cleaning excluded):{' '}
                  {fq.dispenseFailsThisWeek != null
                    ? fq.dispenseFailsThisWeek
                    : fq.dispenseFails7d != null
                      ? fq.dispenseFails7d
                      : '—'}{' '}
                  /{' '}
                  {fq.dispenseFailsLastWeek != null
                    ? fq.dispenseFailsLastWeek
                    : fq.dispenseFailsPrior7d != null
                      ? fq.dispenseFailsPrior7d
                      : '—'}
                </li>
              </ul>
              <p>
                Weekly trend vs prorated baseline:{' '}
                <strong>{payload.happenedPctVsPriorWeek != null ? `${payload.happenedPctVsPriorWeek}%` : '—'}</strong>
              </p>
            </>
          ) : payload.compareMode === 'sameWeekdayLw' ? (
            <>
              <h4>Frequency (Kuwait today vs same weekday last week)</h4>
              <DetailLastTxBlock payload={payload} />
              <p>
                Combined incidents (A+B+C): <strong>{payload.happensToday != null ? payload.happensToday : '—'}</strong>{' '}
                today so far ·{' '}
                <strong>
                  {payload.happenedSameDayLastWeek != null ? payload.happenedSameDayLastWeek : '—'}
                </strong>{' '}
                same elapsed window on the matching weekday last week (not “full last week”).
              </p>
              <ul>
                <li>
                  <strong>A</strong> Stale sales: {fq.staleSaleEpisodesToday ?? fq.staleSaleEpisodes7d ?? '—'} /{' '}
                  {fq.staleSaleEpisodesSameDayLastWeek ?? fq.staleSaleEpisodesPrior7d ?? '—'}
                </li>
                <li>
                  <strong>B</strong> KNet/Machine OFF: {fq.offEpisodesToday ?? fq.offEvents7d ?? '—'} /{' '}
                  {fq.offEpisodesSameDayLastWeek ?? fq.offEventsPrior7d ?? '—'}
                </li>
                <li>
                  <strong>C</strong> Vend fails: {fq.dispenseFailsToday ?? fq.dispenseFails7d ?? '—'} /{' '}
                  {fq.dispenseFailsSameDayLastWeek ?? fq.dispenseFailsPrior7d ?? '—'}
                </li>
              </ul>
              <p>
                Trend vs same weekday window:{' '}
                <strong>
                  {payload.happenedPctVsSameDayLastWeek != null ? `${payload.happenedPctVsSameDayLastWeek}%` : '—'}
                </strong>
              </p>
            </>
          ) : (
            <>
              <h4>Frequency (Kuwait today vs yesterday)</h4>
              <DetailLastTxBlock payload={payload} />
              <p>
                Combined incidents (A+B+C): <strong>{payload.happensToday != null ? payload.happensToday : '—'}</strong>{' '}
                today so far ·{' '}
                <strong>
                  {payload.happenedYesterdaySameElapsed != null ? payload.happenedYesterdaySameElapsed : '—'}
                </strong>{' '}
                same elapsed window on yesterday&apos;s calendar day.
              </p>
              <ul>
                <li>
                  <strong>A</strong> Stale sales: {fq.staleSaleEpisodesToday ?? fq.staleSaleEpisodes7d ?? '—'} /{' '}
                  {fq.staleSaleEpisodesYesterdaySameElapsed ?? fq.staleSaleEpisodesPrior7d ?? '—'}
                </li>
                <li>
                  <strong>B</strong> KNet/Machine OFF: {fq.offEpisodesToday ?? fq.offEvents7d ?? '—'} /{' '}
                  {fq.offEpisodesYesterdaySameElapsed ?? fq.offEventsPrior7d ?? '—'}
                </li>
                <li>
                  <strong>C</strong> Vend fails: {fq.dispenseFailsToday ?? fq.dispenseFails7d ?? '—'} /{' '}
                  {fq.dispenseFailsYesterdaySameElapsed ?? fq.dispenseFailsPrior7d ?? '—'}
                </li>
              </ul>
              <p>
                Trend vs yesterday window:{' '}
                <strong>
                  {payload.happenedPctVsYesterdaySameElapsed != null
                    ? `${payload.happenedPctVsYesterdaySameElapsed}%`
                    : '—'}
                </strong>
              </p>
            </>
          )}
        </div>

        <div className={styles.section}>
          <h4>PFA (board column)</h4>
          <p>
            <strong>Yes</strong> on the board if <em>either</em> the admin checked “Exclude from cleaning timeouts (PFA)”
            for this machine ID <em>or</em> the machine name matched a row in <strong>machine_cleaning_schedule</strong>.
          </p>
          <p>
            Admin checkbox only:{' '}
            <strong>
              {payload.pfaExcludeCleaningAdmin === true
                ? 'Yes'
                : payload.pfaExcludeCleaningAdmin === false
                  ? 'No'
                  : '— (no live_machine_config row)'}
            </strong>
          </p>
          <p>
            Matched cleaning schedule by name: <strong>{payload.onCleaningSchedule ? 'Yes' : 'No'}</strong>
          </p>
          <p>
            Combined board value:{' '}
            <strong>
              {payload.pfaExcludeCleaning === true ? 'Yes' : payload.pfaExcludeCleaning === false ? 'No' : '—'}
            </strong>
          </p>
        </div>

        {(payload.alertPriorityTier === 2 || payload.duringScheduledCleaningNow) && (
          <div className={styles.section}>
            <h4>Cleaning window &amp; priority</h4>
            <p>
              <strong>Priority 2</strong>: current time may be inside this machine&apos;s scheduled DC cleaning window.
              Weekly frequency (A/B/C) does not count episodes inside scheduled cleaning windows.
            </p>
          </div>
        )}

        {gcu ? (
          <div className={styles.section}>
            <a className={styles.linkGo} href={gcu} {...(isMailto ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
              {isMailto ? 'Open Go Check in email' : 'Open Go Check link'}
            </a>
          </div>
        ) : null}

        <div className={styles.section}>
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function LegendModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="red-alert-legend-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h2 id="red-alert-legend-title" className={styles.modalTitle}>
            Board legend
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className={styles.legendList}>
          <li>
            <strong>Trend baseline</strong> — Open the panel to switch modes. Weekly % uses WTD vs{' '}
            <em>prorated last week</em> (full last week × fraction of this week elapsed), not vs the full seven-day prior
            week total. Day modes compare today-so-far vs the same elapsed window on the other day.
          </li>
          <li>
            <strong>New / Updated</strong> — Compared to the previous refresh: new machine on the board, or reasons
            changed.
          </li>
          <li>
            <strong>P2 · Cleaning window</strong> — Priority 2: scheduled cleaning may explain some signals; sorted
            below P1.
          </li>
          <li>
            <strong>PFA</strong> — “Problem frequency adjusted”: excluded from certain cleaning-timeout criteria when
            Yes.
          </li>
        </ul>
        <div className={styles.section}>
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export type RedAlertBoardVariant = 'standard' | 'expert';

export function RedAlertBoard({ variant }: { variant: RedAlertBoardVariant }) {
  const clock = useNowClock(true);
  const [hint, setHint] = useState<string | null>(null);
  const [ranked, setRanked] = useState<RankedRedAlertRow[]>([]);
  const [ticker, setTicker] = useState<{ newN: number; updN: number; total: number } | null>(null);
  const [detail, setDetail] = useState<RedAlertDetailPayload | null>(null);
  const [legend, setLegend] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(readCompareModeInitial);
  const freqHeading = useMemo(() => freqColumnHeading(compareMode), [compareMode]);

  const prevReasonRef = useRef<Record<string, string>>({});
  const hasLoadedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [modalPortalTarget, setModalPortalTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const sync = () => {
      const root = rootRef.current;
      const fs = document.fullscreenElement;
      if (fs instanceof HTMLElement && root && fs.contains(root)) {
        setModalPortalTarget(fs);
      } else {
        setModalPortalTarget(null);
      }
    };
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const q = useQuery({
    queryKey: ['red-alert', 'snapshot'],
    queryFn: async () => {
      setHint(null);
      try {
        return await fetchRedAlertSnapshot();
      } catch (e) {
        setHint(backendHintForRedAlertSnapshot(e));
        throw e;
      }
    },
    refetchInterval: 60_000,
  });

  useLayoutEffect(() => {
    if (!q.data) return;
    const rawRows = q.data.rows ?? [];
    const rows = filterSnapshotRows(rawRows);
    let prevMap = prevReasonRef.current;
    if (!hasLoadedRef.current && rows.length) {
      prevMap = baselineReasonMap(rows);
    }
    hasLoadedRef.current = true;

    if (q.data.generatedAt) {
      try {
        setGeneratedAt(new Date(q.data.generatedAt).toLocaleString());
      } catch {
        setGeneratedAt(q.data.generatedAt);
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
  }, [q.data, q.dataUpdatedAt, compareMode]);

  const openDetail = useCallback(
    (d: RankedRedAlertRow) => {
      const machId = String(getMachineIdRaw(d.row) || '');
      const statusLabel = d.isNew ? 'New alert' : d.isChanged ? 'Updated' : 'Ongoing';
      setDetail(buildDetailPayload(d.row, machId, statusLabel, compareMode, q.data?.generatedAt ?? null));
    },
    [compareMode, q.data?.generatedAt],
  );

  const emptyClear = useMemo(() => q.isSuccess && ranked.length === 0, [q.isSuccess, ranked.length]);

  const isExpert = variant === 'expert';

  const modalLayer =
    detail || legend ? (
      <>
        {detail ? <DetailModal payload={detail} onClose={() => setDetail(null)} /> : null}
        {legend ? <LegendModal onClose={() => setLegend(false)} /> : null}
      </>
    ) : null;

  return (
    <div ref={rootRef} className={`${styles.root} ${isExpert ? styles.rootExpert : ''}`}>
      <div className={`${styles.board} ${isExpert ? styles.boardExpert : ''}`}>
        <header className={`${styles.topBar} ${isExpert ? styles.topBarExpert : ''}`}>
          <div className={styles.titleBlock}>
            {isExpert && (
              <div className={styles.expertBrandRow}>
                <span className={styles.expertRibbon}>Expert console</span>
                <span className={styles.expertTagline}>Same snapshot · alternate surface</span>
              </div>
            )}
            <h1 className={styles.title}>{isExpert ? 'Live incident board' : 'Red Alert'}</h1>
            <p className={styles.sub}>
              {isExpert
                ? 'Terminal-style board: monospace grid, KPI strip, and cold telemetry accents. Use Standard for the classic red ops look.'
                : 'Operations monitor: machines breaching live criteria (precomputed snapshot). Ranked like a departure board — highest priority and frequency first.'}
            </p>
          </div>
          <div className={styles.topRight}>
            <NavLink to={isExpert ? '/tab/redAlert' : '/tab/redAlertExpert'} className={`${styles.btn} ${styles.btnCompare}`}>
              {isExpert ? 'Standard view' : 'Expert view'}
            </NavLink>
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
              Live · 1m
            </span>
            <button type="button" className={styles.btn} onClick={() => setLegend(true)}>
              Legend
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => void q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/tab/events" className={styles.btn}>
              Delay Risk
            </Link>
          </div>
        </header>

        <p className={`${styles.meta} ${isExpert ? styles.metaExpert : ''}`}>
          {generatedAt ? <>Snapshot: {generatedAt}</> : null}
          <span className={`${styles.syncHint} ${q.isFetching && ranked.length ? styles.syncHintOn : ''}`}>
            {' '}
            · Updating…
          </span>
        </p>

        {isExpert ? (
          <div className={styles.expertKpiStrip} aria-label="Snapshot summary">
            <div className={styles.expertKpi}>
              <span className={styles.expertKpiLabel}>New</span>
              <span className={styles.expertKpiVal}>{ticker && ranked.length > 0 ? ticker.newN : '—'}</span>
            </div>
            <div className={styles.expertKpi}>
              <span className={styles.expertKpiLabel}>Updated</span>
              <span className={styles.expertKpiVal}>{ticker && ranked.length > 0 ? ticker.updN : '—'}</span>
            </div>
            <div className={styles.expertKpi}>
              <span className={styles.expertKpiLabel}>Machines on board</span>
              <span className={styles.expertKpiVal}>
                {ticker ? ticker.total : q.isFetched && !ranked.length ? 0 : '—'}
              </span>
            </div>
            <div className={styles.expertKpi}>
              <span className={styles.expertKpiLabel}>Refresh</span>
              <span className={styles.expertKpiValSmall}>60s · manual</span>
            </div>
          </div>
        ) : null}

        <div className={styles.tickerRow}>
          <div className={`${styles.tickerShell} ${isExpert ? styles.tickerShellExpert : ''}`}>
            <div className={styles.tickerTrack} aria-live="polite">
              {!q.isFetched && <span className={styles.tMuted}>Loading snapshot…</span>}
              {q.isError && <span className={styles.tNew}>Could not load data</span>}
              {emptyClear && (
                <>
                  <span className={styles.tMuted}>All clear.</span>
                  <span className={styles.emptyStrong}>No machines match right now.</span>
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
          <details className={`${styles.compareDetails} ${styles.compareDetailsTicker}`}>
            <summary className={styles.compareSummary}>
              <span className={styles.compareSummaryLabel}>Baseline</span>
              <span className={styles.compareSummaryValue}>{compareModeSummaryLine(compareMode)}</span>
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
                  className={`${styles.btn} ${styles.btnCompare} ${styles.compareBtnCompact} ${compareMode === 'week' ? styles.btnCompareActive : ''}`}
                  onClick={() => {
                    setCompareMode('week');
                    persistCompareMode('week');
                  }}
                >
                  WTD
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnCompare} ${styles.compareBtnCompact} ${compareMode === 'sameWeekdayLw' ? styles.btnCompareActive : ''}`}
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
                  className={`${styles.btn} ${styles.btnCompare} ${styles.compareBtnCompact} ${compareMode === 'yesterday' ? styles.btnCompareActive : ''}`}
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

        {q.isError && (
          <div className={styles.err} role="alert">
            {(q.error as Error)?.message ?? 'Request failed'}
          </div>
        )}
        <BackendHint message={hint} />

        <div className={`${styles.body} ${isExpert ? styles.bodyExpert : ''}`}>
          {ranked.length > 0 && (
            <div className={`${styles.tableScroll} ${isExpert ? styles.tableScrollExpert : ''}`}>
              <table className={`${styles.table} ${isExpert ? styles.tableExpert : ''}`}>
                <thead>
                  <tr>
                    <th className={styles.th}>
                      Machine
                      <span className={styles.thSub}>Name · ID · flags</span>
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
                        goUrl = `mailto:${emGo}?subject=${encodeURIComponent(`Red Alert — Go check: ${row.machineName || machId}`)}`;
                      }
                    }
                    const isMailGo = goUrl && String(goUrl).toLowerCase().startsWith('mailto:');

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
                            <span
                              className={`${styles.chip} ${styles.chipP2}`}
                              title="Priority 2 — scheduled cleaning window. Weekly frequency excludes episodes in this window."
                            >
                              P2
                            </span>
                          )}
                          <div className={styles.machineName}>{row.machineName || machId}</div>
                          <div className={styles.machineId}>#{machId}</div>
                          {row.reasons && row.reasons.length ? (
                            <div className={styles.lastReason} title={row.reasons[row.reasons.length - 1]}>
                              {String(row.reasons[row.reasons.length - 1] ?? '')
                                .replace(/\s+/g, ' ')
                                .trim()
                                .slice(0, 90)}
                              {String(row.reasons[row.reasons.length - 1] ?? '').trim().length > 90 ? '…' : ''}
                            </div>
                          ) : null}
                          <LastTxLines row={row} snapshotGeneratedAt={q.data?.generatedAt ?? null} />
                        </td>
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
                              className={styles.linkGo}
                              href={goUrl}
                              {...(isMailGo ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Go check
                            </a>
                          ) : (
                            <span className={styles.muted}>Set strike email</span>
                          )}
                        </td>
                        <td className={styles.td}>
                          <button
                            type="button"
                            className={styles.btnDetails}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(d);
                            }}
                          >
                            Details
                          </button>
                        </td>
                        <td className={styles.td}>
                          {pfaRaw === true && <span className={`${styles.chip} ${styles.chipPfaY}`}>Yes</span>}
                          {pfaRaw === false && <span className={`${styles.chip} ${styles.chipPfaN}`}>No</span>}
                          {(pfaRaw === undefined || pfaRaw === null) && (
                            <span className={`${styles.chip} ${styles.chipPfaU}`} title="No machine criteria row">
                              —
                            </span>
                          )}
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

      {modalPortalTarget && modalLayer ? createPortal(modalLayer, modalPortalTarget) : modalLayer}
    </div>
  );
}

export default function RedAlertTab() {
  const { tabId } = useParams<{ tabId: string }>();
  const variant: RedAlertBoardVariant = tabId === 'redAlertExpert' ? 'expert' : 'standard';
  return <RedAlertBoard variant={variant} />;
}
