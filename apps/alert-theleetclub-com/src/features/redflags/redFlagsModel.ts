import type { RedAlertCompareMode, RedAlertDetailPayload, RedAlertRow } from './redAlertTypes';

/** Substrings matched on machine name or id (parity with monitoring-app-v2 + API exclusion). */
const EXCLUDED_NAME_MARKERS = ['869951037923178', '869951037920851'];

/** Optional: operator names that use DC cleaning schedule filtering (legacy window globals). */
const DC_SCHEDULE_OPERATOR_NAMES: string[] = [];

export function getMachineIdRaw(row: RedAlertRow): string {
  if (row.machineId != null && row.machineId !== '') return String(row.machineId);
  if (row.machine_id != null && row.machine_id !== '') return String(row.machine_id);
  return '';
}

export function getLiveOpsOperatorOnly(row: RedAlertRow): string {
  let o: string | null | undefined =
    row.operator ?? row.redAlertOperator ?? row.operatorName ?? row.red_alert_operator;
  const s = String(o ?? '').trim();
  return s || '—';
}

export function getOperatorDisplay(row: RedAlertRow): string {
  const base = getLiveOpsOperatorOnly(row);
  const co = row.cleaningOperator != null && row.cleaningOperator !== '' ? String(row.cleaningOperator).trim() : '';
  if (co) return base === '—' ? co : `${base} · ${co}`;
  return base;
}

function firstNonEmptyTimestamp(
  ...vals: (string | number | null | undefined)[]
): string | null {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}

function pickDirectLastTransactionTs(row: RedAlertRow): string | null {
  const fq = row.frequency ?? {};
  return firstNonEmptyTimestamp(
    row.lastTransactionAtUtc,
    row.last_transaction_at_utc,
    row.lastSaleAtUtc,
    row.last_sale_at_utc,
    row.lastSaleAt,
    row.last_sale_at,
    row.lastTransactionAt,
    row.last_transaction_at,
    fq.lastTransactionAtUtc,
    fq.last_sale_at,
    fq.lastTransactionAt,
  );
}

function deriveLastTxIsoFromSnapshot(row: RedAlertRow, generatedAt?: string | null): string | null {
  if (!generatedAt) return null;
  const raw = row.minutesSinceLastTransaction ?? row.minutes_since_last_transaction;
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (Number.isNaN(n) || n < 0) return null;
  const g = Date.parse(generatedAt);
  if (Number.isNaN(g)) return null;
  return new Date(g - n * 60000).toISOString();
}

export function pickLastTransactionTs(row: RedAlertRow, generatedAt?: string | null): string | null {
  const d = pickDirectLastTransactionTs(row);
  if (d) return d;
  return deriveLastTxIsoFromSnapshot(row, generatedAt);
}

export function isLastTransactionEstimated(row: RedAlertRow, generatedAt?: string | null): boolean {
  return !pickDirectLastTransactionTs(row) && !!deriveLastTxIsoFromSnapshot(row, generatedAt);
}

export function pickLastEventTs(row: RedAlertRow): string | null {
  const fq = row.frequency ?? {};
  return firstNonEmptyTimestamp(
    row.lastOffEventAt,
    row.lastOffEventAtUtc,
    row.last_off_event_at,
    row.last_off_event_at_utc,
    row.lastEventAtUtc,
    row.last_event_at_utc,
    row.last_red_alert_event_at,
    fq.lastOffEventAt,
    fq.lastOffEventAtUtc,
  );
}

function machineIsExcludedFromRow(row: RedAlertRow): boolean {
  const blob = `${String(row.machineName ?? '')} ${getMachineIdRaw(row)}`;
  for (const m of EXCLUDED_NAME_MARKERS) {
    if (blob.includes(m)) return true;
  }
  return false;
}

const CLEANING_OPERATOR_NOISE_WORDS = new Set([
  'half',
  'cleaning',
  'deep',
  'daily',
  'general',
  'block',
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'the',
  'and',
  'for',
  'dc',
]);

function tokensFromCleaningOperator(co: string | null | undefined): string[] {
  if (co == null || co === '') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /[A-Za-z]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(co)) !== null) {
    const w = m[0].toLowerCase();
    if (seen.has(w) || CLEANING_OPERATOR_NOISE_WORDS.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export function operatorOnDcSchedule(row: RedAlertRow): boolean {
  const s = getOperatorDisplay(row)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return false;
  if (DC_SCHEDULE_OPERATOR_NAMES.some((n) => s.includes(n.toLowerCase()))) return true;
  for (const tok of tokensFromCleaningOperator(row.cleaningOperator ?? null)) {
    if (s.includes(tok)) return true;
  }
  return false;
}

function reasonLooksLikeCleaningTimeout(r: string): boolean {
  const x = String(r ?? '').toLowerCase();
  if (!x) return false;
  if (
    /vend|dispense|dispense-fail|knet|machine\s*off|last\s+transaction|transaction|stale.*txn|sale\s+interval/i.test(
      x,
    )
  ) {
    return false;
  }
  return /clean|cleaning|qc\b|quality|mop|sweep|hours?\s+without\s+clean|last\s+clean|timeout/i.test(x);
}

export function filterSnapshotRows(rows: RedAlertRow[]): RedAlertRow[] {
  const out: RedAlertRow[] = [];
  for (const row of rows) {
    if (machineIsExcludedFromRow(row)) continue;
    const hadReasons = !!(row.reasons && row.reasons.length);
    let reasons = hadReasons ? row.reasons!.slice() : [];
    if (operatorOnDcSchedule(row) && hadReasons) {
      reasons = reasons.filter((r) => !reasonLooksLikeCleaningTimeout(r));
    }
    if (!reasons.length && hadReasons) continue;
    const copy: RedAlertRow = { ...row };
    copy.reasons = reasons;
    out.push(copy);
  }
  return out;
}

export function reasonKey(row: RedAlertRow): string {
  const r = row.reasons || [];
  return r.slice().sort().join('||');
}

export type RankedRedAlertRow = {
  row: RedAlertRow;
  tier: number;
  name: string;
  isNew: boolean;
  isChanged: boolean;
};

export function rowHappensForSort(row: RedAlertRow, mode: RedAlertCompareMode): number {
  const fq = row.frequency;
  if (mode === 'sameWeekdayLw' || mode === 'yesterday') {
    const n = Number(row.happensToday ?? fq?.totalCriteriaHitsToday ?? 0);
    return Number.isNaN(n) ? 0 : n;
  }
  const hw = row.happensWeek ?? fq?.totalCriteriaHitsThisWeek ?? fq?.totalCriteriaHits7d;
  const n = Number(hw ?? 0);
  return Number.isNaN(n) ? 0 : n;
}

export function rankRows(
  rows: RedAlertRow[],
  prevReasonByMachine: Record<string, string>,
  mode: RedAlertCompareMode = 'week',
): RankedRedAlertRow[] {
  const prev = prevReasonByMachine || {};
  const decorated: RankedRedAlertRow[] = [];
  for (const row of rows) {
    const mid = getMachineIdRaw(row);
    const rk = reasonKey(row);
    const prevR = prev[mid];
    const isNew = prevR === undefined;
    const isChanged = !isNew && prevR !== rk;
    const tier = isNew ? 0 : isChanged ? 1 : 2;
    const nm = String(row.machineName || mid).toLowerCase();
    decorated.push({ row, tier, name: nm, isNew, isChanged });
  }
  decorated.sort((a, b) => {
    let pa = Number(a.row.alertPriorityTier != null ? a.row.alertPriorityTier : 1);
    let pb = Number(b.row.alertPriorityTier != null ? b.row.alertPriorityTier : 1);
    if (Number.isNaN(pa)) pa = 1;
    if (Number.isNaN(pb)) pb = 1;
    if (pa !== pb) return pa - pb;
    const faa = rowHappensForSort(a.row, mode);
    const fbb = rowHappensForSort(b.row, mode);
    if (fbb !== faa) return fbb - faa;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });
  return decorated;
}

export function buildDetailPayload(
  row: RedAlertRow,
  machId: string,
  statusLabel: string,
  compareMode: RedAlertCompareMode = 'week',
  snapshotGeneratedAt?: string | null,
): RedAlertDetailPayload {
  const fq = row.frequency || {};
  let goUrl = row.goCheckUrl || null;
  if (!goUrl && row.strikeOperatorEmail) {
    const emGo = String(row.strikeOperatorEmail).trim();
    if (emGo.includes('@')) {
      goUrl = `mailto:${emGo}?subject=${encodeURIComponent(`Red Alert — Go check: ${row.machineName || machId}`)}`;
    }
  }
  return {
    machineName: row.machineName,
    machineId: machId,
    operator: getLiveOpsOperatorOnly(row),
    cleaningOperator: row.cleaningOperator || null,
    reasons: row.reasons || [],
    frequency: fq,
    happensWeek: row.happensWeek,
    happenedLastWeek:
      row.happenedLastWeek != null
        ? row.happenedLastWeek
        : fq.totalCriteriaHitsLastWeek != null
          ? fq.totalCriteriaHitsLastWeek
          : null,
    happenedLastWeekAlignedSlice:
      row.happenedLastWeekAlignedSlice ?? fq.totalCriteriaHitsLastWeekAlignedToWtD ?? null,
    happenedPctVsPriorWeek: row.happenedPctVsPriorWeek,
    lastTransactionAtUtc: pickLastTransactionTs(row, snapshotGeneratedAt),
    lastTransactionEstimated: isLastTransactionEstimated(row, snapshotGeneratedAt),
    lastOffEventAt: pickLastEventTs(row),
    minutesSinceLastTransaction:
      row.minutesSinceLastTransaction ?? row.minutes_since_last_transaction ?? null,
    happensToday: row.happensToday ?? fq.totalCriteriaHitsToday ?? null,
    happenedSameDayLastWeek: row.happenedSameDayLastWeek ?? fq.totalCriteriaHitsSameDayLastWeek ?? null,
    happenedPctVsSameDayLastWeek: row.happenedPctVsSameDayLastWeek ?? null,
    happenedYesterdaySameElapsed:
      row.happenedYesterdaySameElapsed ?? fq.totalCriteriaHitsYesterdaySameElapsed ?? null,
    happenedPctVsYesterdaySameElapsed: row.happenedPctVsYesterdaySameElapsed ?? null,
    compareMode,
    goCheckUrl: goUrl,
    strikeOperatorEmail: row.strikeOperatorEmail || null,
    pfaExcludeCleaning: row.pfaExcludeCleaning === true ? true : row.pfaExcludeCleaning === false ? false : null,
    pfaExcludeCleaningAdmin:
      row.pfaExcludeCleaningAdmin === true ? true : row.pfaExcludeCleaningAdmin === false ? false : null,
    onCleaningSchedule: !!row.onCleaningSchedule,
    alertPriorityTier: row.alertPriorityTier != null ? Number(row.alertPriorityTier) : 1,
    duringScheduledCleaningNow: !!row.duringScheduledCleaningNow,
    statusLabel,
  };
}

export type FreqSplit = {
  top: string;
  bottom: string;
  bottomClass: 'up' | 'down' | 'flat';
  upBand?: 1 | 2 | 3 | 4;
  title: string;
};

export function freqColumnHeading(mode: RedAlertCompareMode): { title: string; sub: string } {
  switch (mode) {
    case 'week':
      return {
        title: 'Frequency',
        sub: 'Each case: WTD vs last week (top), trend % vs baseline (bottom)',
      };
    case 'sameWeekdayLw':
      return {
        title: 'Frequency',
        sub: 'Each case: today vs same weekday LW (top), trend % (bottom)',
      };
    case 'yesterday':
      return {
        title: 'Frequency',
        sub: 'Each case: today vs yesterday same elapsed (top), trend % (bottom)',
      };
    default:
      return { title: 'Frequency', sub: 'Per-case counts and trend % (Monitor parity)' };
  }
}

export function freqSplit(row: RedAlertRow, mode: RedAlertCompareMode = 'week'): FreqSplit {
  const fq = row.frequency || {};
  let top: string;
  let pv: number | null | undefined;
  let tip: string;
  if (mode === 'sameWeekdayLw') {
    let ht: number | null | undefined = row.happensToday != null ? row.happensToday : fq.totalCriteriaHitsToday;
    if (ht == null) ht = fq.totalCriteriaHits7d ?? undefined;
    top = ht != null ? `${ht}/d` : '—/d';
    pv = row.happenedPctVsSameDayLastWeek;
    tip =
      'Kuwait today so far (calendar day): combined A+B+C. % compares to the same elapsed period on the same weekday last week.';
  } else if (mode === 'yesterday') {
    let ht: number | null | undefined = row.happensToday != null ? row.happensToday : fq.totalCriteriaHitsToday;
    if (ht == null) ht = fq.totalCriteriaHits7d ?? undefined;
    top = ht != null ? `${ht}/d` : '—/d';
    pv = row.happenedPctVsYesterdaySameElapsed;
    tip =
      "Kuwait today so far (calendar day): combined A+B+C. % compares to the same elapsed period on yesterday's calendar day.";
  } else {
    let hw: number | null | undefined =
      row.happensWeek != null ? row.happensWeek : fq.totalCriteriaHitsThisWeek;
    if (hw == null) hw = fq.totalCriteriaHits7d ?? undefined;
    top = hw != null ? `${hw}/WTD` : '—/WTD';
    pv = row.happenedPctVsPriorWeek;
    let hlw: number | null | undefined =
      row.happenedLastWeek != null ? row.happenedLastWeek : fq.totalCriteriaHitsLastWeek;
    if (hlw == null) hlw = fq.totalCriteriaHitsPrior7d ?? undefined;
    const aligned =
      row.happenedLastWeekAlignedSlice != null
        ? row.happenedLastWeekAlignedSlice
        : fq.totalCriteriaHitsLastWeekAlignedToWtD;
    tip = `${hw != null ? hw : '—'} week-to-date vs prorated baseline`;
    if (aligned != null) tip += ` ~${aligned}`;
    tip += ' — same basis as %. ';
    if (hlw != null) tip += `Full prior week total was ${hlw} (reference, not the % denominator).`;
  }
  const pctNum = pv != null ? Number(pv) : NaN;
  let arrow = '→';
  let bottomClass: 'up' | 'down' | 'flat' = 'flat';
  let upBand: 1 | 2 | 3 | 4 | undefined;
  if (!Number.isNaN(pctNum)) {
    if (pctNum > 0) {
      arrow = '↑';
      bottomClass = 'up';
      const mag = Math.abs(pctNum);
      upBand = mag >= 50 ? 4 : mag >= 25 ? 3 : mag >= 10 ? 2 : 1;
    } else if (pctNum < 0) {
      arrow = '↓';
      bottomClass = 'down';
    }
  }
  const bot = (() => {
    if (Number.isNaN(pctNum)) return `${arrow}—`;
    const mag = Math.abs(pctNum);
    // Keep the trend compact so it fits inside the 3-box cell (no ellipsis).
    // Target output length <= ~6 chars after the arrow.
    if (mag >= 1000) {
      const k = mag / 1000;
      const s = k >= 10 ? k.toFixed(0) : k.toFixed(1); // 9.9k max precision; 10k no decimal
      const cleaned = s.endsWith(".0") ? s.slice(0, -2) : s;
      return `${arrow}${cleaned}k%`;
    }
    return `${arrow}${Math.round(mag)}%`;
  })();
  return { top, bottom: bot, bottomClass, upBand, title: tip };
}

/** One Frequency mini-card — parity with `#redAlertPortal .red-alert-freq-mini` in Monitor v1. */
export type FreqTripleMini = {
  key: 'stale' | 'off' | 'vend';
  label: string;
  ariaName: string;
  nowFmt: string;
  baseFmt: string | null;
  baseKnown: boolean;
  trendText: string;
  trendTone: 'up' | 'down' | 'flat';
  trendUpBand?: 1 | 2 | 3 | 4;
  trendAlpha: number;
  trendUseAlphaVar: boolean;
};

export type FreqTriplePayload = {
  stale: FreqTripleMini;
  off: FreqTripleMini;
  vend: FreqTripleMini;
  tooltip: string;
};

function pickFreqScalar(primary: unknown, fallback: unknown): unknown {
  if (primary != null && primary !== '') return primary;
  return fallback;
}

function fmtFreqJs(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return String(Math.round(n));
}

function pctDeltaPerCase(thisVal: unknown, baseVal: unknown): number | null {
  const a = Number(thisVal);
  const b = Number(baseVal);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (b === 0) return a === 0 ? 0 : null;
  return ((a - b) / b) * 100;
}

type TrendFmtMini = {
  text: string;
  tone: 'up' | 'down' | 'flat';
  upBand?: 1 | 2 | 3 | 4;
  alpha: number;
  useAlphaVar: boolean;
};

/** Same arrows / saturation rules as `_redAlertFreqDiagonalHtml` `trendFmt` in Monitor v1. */
function fmtTrendMiniPct(pct: number | null): TrendFmtMini {
  if (pct == null || Number.isNaN(Number(pct))) {
    return { text: '—', tone: 'flat', alpha: 0.92, useAlphaVar: true };
  }
  const n = Number(pct);
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '→';
  const text = `${arrow} ${Math.round(Math.abs(n))}%`;
  if (n > 0) {
    const mag = Math.abs(n);
    const upBand =
      mag >= 50 ? 4 : mag >= 25 ? 3 : mag >= 10 ? 2 : 1;
    return { text, tone: 'up', upBand, alpha: 1, useAlphaVar: false };
  }
  let alpha = 0.28 + 0.72 * Math.pow(Math.min(Math.abs(n), 200) / 200, 0.55);
  if (Math.abs(n) < 3) alpha *= 0.72;
  const tone = n < 0 ? 'down' : 'flat';
  return { text, tone, alpha: Math.min(1, alpha), useAlphaVar: true };
}

function miniCaseRow(
  key: FreqTripleMini['key'],
  label: string,
  ariaName: string,
  thisVal: unknown,
  baseVal: unknown,
): FreqTripleMini {
  let baseKnown =
    !(baseVal == null || baseVal === '') &&
    !(typeof baseVal === 'number' && Number.isNaN(baseVal));
  const nowFmt = fmtFreqJs(thisVal);
  const baseFmtRaw = fmtFreqJs(baseVal);
  if (baseFmtRaw === '—') baseKnown = false;
  const pct = pctDeltaPerCase(thisVal, baseVal);
  const tf = fmtTrendMiniPct(pct);
  return {
    key,
    label,
    ariaName,
    nowFmt,
    baseFmt: baseKnown ? baseFmtRaw : null,
    baseKnown,
    trendText: tf.text,
    trendTone: tf.tone,
    trendUpBand: tf.upBand,
    trendAlpha: tf.alpha,
    trendUseAlphaVar: tf.useAlphaVar,
  };
}

/** STALE · OFF · VEND FAIL triple (counts + baseline + trend %) — mirrors Monitor v1 Red Alert Frequency column. */
export function freqTriple(row: RedAlertRow, mode: RedAlertCompareMode = 'week'): FreqTriplePayload {
  const fq = row.frequency || {};
  let staleThis: unknown;
  let staleLast: unknown;
  let offThis: unknown;
  let offLast: unknown;
  let vendThis: unknown;
  let vendLast: unknown;

  if (mode === 'sameWeekdayLw') {
    staleThis = pickFreqScalar(fq.staleSaleEpisodesToday, fq.staleSaleEpisodes7d);
    staleLast = pickFreqScalar(fq.staleSaleEpisodesSameDayLastWeek, fq.staleSaleEpisodesPrior7d);
    offThis = pickFreqScalar(fq.offEpisodesToday, fq.offEvents7d);
    offLast = pickFreqScalar(fq.offEpisodesSameDayLastWeek, fq.offEventsPrior7d);
    vendThis = pickFreqScalar(fq.dispenseFailsToday, fq.dispenseFails7d);
    vendLast = pickFreqScalar(fq.dispenseFailsSameDayLastWeek, fq.dispenseFailsPrior7d);
  } else if (mode === 'yesterday') {
    staleThis = pickFreqScalar(fq.staleSaleEpisodesToday, fq.staleSaleEpisodes7d);
    staleLast = pickFreqScalar(fq.staleSaleEpisodesYesterdaySameElapsed, fq.staleSaleEpisodesPrior7d);
    offThis = pickFreqScalar(fq.offEpisodesToday, fq.offEvents7d);
    offLast = pickFreqScalar(fq.offEpisodesYesterdaySameElapsed, fq.offEventsPrior7d);
    vendThis = pickFreqScalar(fq.dispenseFailsToday, fq.dispenseFails7d);
    vendLast = pickFreqScalar(fq.dispenseFailsYesterdaySameElapsed, fq.dispenseFailsPrior7d);
  } else {
    staleThis = pickFreqScalar(fq.staleSaleEpisodesThisWeek, fq.staleSaleEpisodes7d);
    staleLast = pickFreqScalar(fq.staleSaleEpisodesLastWeek, fq.staleSaleEpisodesPrior7d);
    offThis = pickFreqScalar(fq.offEpisodesThisWeek, fq.offEvents7d);
    offLast = pickFreqScalar(fq.offEpisodesLastWeek, fq.offEventsPrior7d);
    vendThis = pickFreqScalar(fq.dispenseFailsThisWeek, fq.dispenseFails7d);
    vendLast = pickFreqScalar(fq.dispenseFailsLastWeek, fq.dispenseFailsPrior7d);
  }

  const stale = miniCaseRow('stale', 'STALE', 'Stale-sale episodes', staleThis, staleLast);
  const off = miniCaseRow('off', 'OFF', 'Machine OFF episodes', offThis, offLast);
  const vend = miniCaseRow('vend', 'VEND FAIL', 'Dispense / vend failures', vendThis, vendLast);

  const combined = freqSplit(row, mode);
  const pctLine = (m: FreqTripleMini): string =>
    `${m.label}: ${m.nowFmt}/${m.baseKnown && m.baseFmt != null ? m.baseFmt : '—'} · ${m.trendText}`;
  const tooltip = [
    combined.title,
    pctLine(stale),
    pctLine(off),
    pctLine(vend),
    'Row sort uses combined trend from the snapshot; click for full detail.',
  ].join('\n');

  return { stale, off, vend, tooltip };
}

export function baselineReasonMap(rows: RedAlertRow[]): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const row of rows) {
    baseline[String(getMachineIdRaw(row) || '')] = reasonKey(row);
  }
  return baseline;
}
