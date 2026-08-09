import type { RedAlertRow } from './redAlertTypes';
import {
  isLastTransactionEstimated,
  pickLastEventTs,
  pickLastTransactionTs,
  type FreqBoxSlotVisual,
  type FreqGlowKey,
  type FreqSplit,
  type FreqTone,
} from './redFlagsModel';
import styles from './RedFlagsBoard.module.css';

function formatRedAlertExactDateTime(iso: string): string {
  const ms = Date.parse(iso);
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

/** Compact Last / tx cell: weekday, date, time on separate lines (Kuwait). */
export function formatLastTxLines(iso: string): { weekday: string; date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    const d = new Date(ms);
    const weekday = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kuwait', weekday: 'short' });
    const date = d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kuwait',
      day: 'numeric',
      month: 'long',
    });
    const time = d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kuwait',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { weekday, date, time };
  } catch {
    return null;
  }
}

/** @deprecated Use formatLastTxLines for table cells. */
export function formatLastTxCompact(iso: string): string {
  const lines = formatLastTxLines(iso);
  if (!lines) return iso || '—';
  return `${lines.weekday} ${lines.date} ${lines.time}`;
}

export function freqTrendValTone(fq: FreqSplit): string {
  if (fq.bottomClass === 'down') return styles.freqDown;
  if (fq.bottomClass === 'flat') return styles.freqFlat;
  if (fq.bottomClass === 'up' && fq.upBand) {
    switch (fq.upBand) {
      case 1:
        return styles.freqUp1;
      case 2:
        return styles.freqUp2;
      case 3:
        return styles.freqUp3;
      case 4:
        return styles.freqUp4;
      default:
        break;
    }
  }
  return styles.freqUp2;
}

export function freqIncidentBurdenTone(n: number): string {
  if (Number.isNaN(n)) return styles.freqFlat;
  const mag = Math.max(0, n);
  if (mag <= 0) return styles.freqDown;
  const band = mag >= 10 ? 4 : mag >= 5 ? 3 : mag >= 2 ? 2 : 1;
  switch (band) {
    case 1:
      return styles.freqUp1;
    case 2:
      return styles.freqUp2;
    case 3:
      return styles.freqUp3;
    case 4:
      return styles.freqUp4;
    default:
      return styles.freqUp2;
  }
}

function freqToneClass(tone: FreqTone): string {
  if (tone === 'good') return styles.freqGood;
  if (tone === 'bad') return styles.freqBad;
  return styles.freqNeutral;
}

function freqGlowClass(glow: FreqGlowKey): string {
  switch (glow) {
    case 'score-soft':
      return styles.freqGlowScoreSoft;
    case 'score-hot':
      return styles.freqGlowScoreHot;
    case 'trend-soft':
      return styles.freqGlowTrendSoft;
    case 'trend-hot':
      return styles.freqGlowTrendHot;
    case 'gap-soft':
      return styles.freqGlowGapSoft;
    case 'gap-hot':
      return styles.freqGlowGapHot;
    default:
      return '';
  }
}

export function freqBoxClasses(slot: 'score' | 'trend' | 'gap', visual: FreqBoxSlotVisual): string {
  const slotClass =
    slot === 'score' ? styles.freqBoxScore : slot === 'trend' ? styles.freqBoxTrend : styles.freqBoxGap;
  const glow = freqGlowClass(visual.glow);
  return ['freqBox', styles.freqBox, slotClass, freqToneClass(visual.tone), glow].filter(Boolean).join(' ');
}

export function FreqIconScore() {
  return (
    <svg className={styles.freqGlyph} viewBox="0 0 16 16" aria-hidden>
      <path fill="currentColor" d="M2 14h3V8H2v6zm4.5 0h3V5h-3v9zm4.5 0h3V2h-3v12z" opacity="0.92" />
    </svg>
  );
}

export function FreqIconTrend() {
  return (
    <svg className={styles.freqGlyph} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 12l4-4 3 3 5-7"
        opacity="0.92"
      />
    </svg>
  );
}

export function FreqIconVariance() {
  return (
    <svg className={styles.freqGlyph} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.88" />
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.78" />
    </svg>
  );
}

export function LastTxLines({
  row,
  snapshotGeneratedAt,
  /** Vendon `/last-transactions` fallback when snapshot has no ISO (mirrors Overall fleet). */
  vendonTxIso,
  /** sale = last vend only (Last / tx column); offEvent = machine OFF line under Machine; both = legacy combined */
  part = 'both',
  /** Highlight when no sales for ≥ N hours (default 4). */
  noSalesAlert = false,
  noSalesHours = 4,
}: {
  row: RedAlertRow;
  snapshotGeneratedAt?: string | null;
  vendonTxIso?: string | null;
  part?: 'sale' | 'offEvent' | 'both';
  noSalesAlert?: boolean;
  noSalesHours?: number;
}) {
  const snapTx = pickLastTransactionTs(row, snapshotGeneratedAt);
  const vendonTx = vendonTxIso?.trim() || null;
  const txRaw = snapTx || vendonTx;
  const evRaw = pickLastEventTs(row);
  const estimated = Boolean(snapTx && isLastTransactionEstimated(row, snapshotGeneratedAt));
  const hasTx = !!(txRaw != null && String(txRaw).trim());
  const hasEv = !!(evRaw != null && String(evRaw).trim());
  const evDistinct = hasEv && (!hasTx || String(evRaw).trim() !== String(txRaw).trim());
  const minOnly = row.minutesSinceLastTransaction ?? row.minutes_since_last_transaction;
  const minStr = minOnly != null ? String(minOnly).trim() : '';
  const showSale = part === 'sale' || part === 'both';
  const showOff = part === 'offEvent' || part === 'both';
  const noSalesTip = noSalesAlert ? `No sales for ≥${noSalesHours}h` : undefined;

  if (showSale && part === 'sale') {
    const lines = hasTx ? formatLastTxLines(String(txRaw)) : null;
    const baseTip = hasTx ? undefined : minStr !== '' ? 'Minutes since last sale (no ISO timestamp)' : undefined;
    return (
      <div
        className={`lastTxBox salesStackBox${noSalesAlert ? ' lastTxBoxNoSales' : ''}`}
        title={[baseTip, noSalesTip].filter(Boolean).join(' · ') || undefined}
        style={noSalesAlert ? { outline: '1px solid rgba(220, 80, 60, 0.55)', background: 'rgba(220, 80, 60, 0.12)' } : undefined}
      >
        {lines ? (
          <>
            <span className="lastTxLine lastTxLineWd">{lines.weekday}</span>
            <span className="lastTxLine lastTxLineDate">{lines.date}</span>
            <span className="lastTxLine lastTxLineTime">{lines.time}</span>
          </>
        ) : minStr !== '' ? (
          <span className="salesStackVal lastTxBoxVal">{minStr} min</span>
        ) : (
          <span className="salesStackVal lastTxBoxVal">—</span>
        )}
        {noSalesAlert ? <span className="lastTxBoxEst">no sales {noSalesHours}h+</span> : null}
        {hasTx && estimated ? <span className="lastTxBoxEst">est.</span> : null}
        {!hasTx && minStr !== '' ? <span className="lastTxBoxEst">no ISO</span> : null}
      </div>
    );
  }

  return (
    <>
      {showSale && hasTx ? (
        <div className={styles.lastTx}>
          Last tx: {formatRedAlertExactDateTime(String(txRaw))}
          {estimated ? <span className={styles.lastTxEst}> (est.)</span> : null}
        </div>
      ) : showSale && minStr !== '' ? (
        <div className={styles.lastTx}>
          Last tx: {minStr} min since sale <span className={styles.lastTxEst}>(no ISO)</span>
        </div>
      ) : null}
      {showOff && evDistinct ? (
        <div className={styles.lastTx}>Last OFF event: {formatRedAlertExactDateTime(String(evRaw))}</div>
      ) : null}
      {showSale && !hasTx && minStr === '' && !evDistinct && part === 'both' ? (
        <div className={styles.lastTx}>Last tx: —</div>
      ) : null}
    </>
  );
}

export function sendCreditToneClass(n: number): string {
  if (!Number.isFinite(n)) return styles.metricUnknown;
  if (n <= 5) return styles.metricGood;
  if (n <= 10) return styles.metricWarn;
  return styles.metricBad;
}

export function testCreditsToneClass(n: number): string {
  if (!Number.isFinite(n)) return styles.metricUnknown;
  return n <= 6 ? styles.metricGood : styles.metricBad;
}

export function vendsResolvedToneClass(status: string | undefined): string {
  if (status === 'green') return styles.metricGood;
  if (status === 'red') return styles.metricBad;
  if (status === 'none') return styles.metricGood;
  return styles.metricUnknown;
}

export function vendsResolvedLabel(status: string | undefined): string {
  if (status === 'green') return '≤5 min';
  if (status === 'red') return '>5 min';
  if (status === 'none') return 'No fail';
  if (status === 'unknown') return '?';
  return '?';
}

export { styles as redFlagsTableStyles };
