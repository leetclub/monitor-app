import type { ColumnSortDir, ColumnSortState } from '@/lib/tableColumnSort';
import { compareNumbers, compareStrings } from '@/lib/tableColumnSort';
import { salesDayKwd, type DailySalesElapsedResponse } from '@/lib/salesDisplay';
import { targetStackValues } from '@/lib/targetDisplay';
import { qaLastVisitSortMs, qaVisitForMachineName, techVisitForMachineName, type QaSummaryResponse } from '@/lib/qaVisitDisplay';
import { salesPairForPreset } from '@/lib/presetComparison';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { RedAlertCompareMode } from './redAlertTypes';
import {
  getLiveOpsOperatorOnly,
  getMachineIdRaw,
  pickLastTransactionTs,
  rowHappensForSort,
  type RankedRedAlertRow,
} from './redFlagsModel';
import type { RedFlagsColumnKey } from './redFlagsWorkbookColumns';
import type { IncidentsElapsedRow } from '@/lib/incidentsDisplay';

export const RED_FLAGS_SORTABLE_COLUMNS = new Set<RedFlagsColumnKey>([
  'vendingMachine',
  'alertType',
  'operatorActivity',
  'lastTransaction',
  'dailySales',
  'mtdSales',
  'mtdYoySales',
  'dailyTarget',
  'salesAcceleration',
  'frequency',
  'sendCredit',
  'testCredits',
  'lastCleaning',
  'qaVisit',
  'techVisit',
]);

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

function alertTypeText(row: RankedRedAlertRow['row']): string {
  const reasons = row.reasons;
  if (!reasons?.length) return '';
  return String(reasons[reasons.length - 1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RedFlagsSortContext = {
  compareMode: RedAlertCompareMode;
  compare: CompareSelection;
  dailySales?: DailySalesElapsedResponse;
  dailySalesReady: boolean;
  mtdByMachine?: Record<string, { aSalesKwd?: number | null }>;
  mtdReady: boolean;
  mtdYoyByMachine?: Record<
    string,
    { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
  >;
  mtdYoyReady: boolean;
  vendonByMachine?: Record<
    string,
    { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
  >;
  creditsByMachine?: Record<string, { credits_sent?: number; dispense_tests?: number }>;
  incidentsByMachine?: Record<string, IncidentsElapsedRow>;
  qaSummary?: QaSummaryResponse;
  snapshotGeneratedAt?: string | null;
  lastTxByMachine?: Record<string, { timestamp: number }>;
  sxByMachine?: Record<string, { location?: { sxPct?: number | null } | null }>;
  sxReady?: boolean;
};

function compareRedFlagsRow(
  a: RankedRedAlertRow,
  b: RankedRedAlertRow,
  column: RedFlagsColumnKey,
  ctx: RedFlagsSortContext,
  dir: ColumnSortDir,
): number {
  const idA = String(getMachineIdRaw(a.row) || '');
  const idB = String(getMachineIdRaw(b.row) || '');
  const nameA = String(a.row.machineName || idA);
  const nameB = String(b.row.machineName || idB);

  switch (column) {
    case 'vendingMachine':
      return compareStrings(nameA, nameB, dir);
    case 'alertType':
      return compareStrings(alertTypeText(a.row), alertTypeText(b.row), dir);
    case 'operator':
      return compareStrings(getLiveOpsOperatorOnly(a.row), getLiveOpsOperatorOnly(b.row), dir);
    case 'operatorActivity': {
      const ta = parseTimestampMs(String(a.row.operatorLastAccessAt ?? ''));
      const tb = parseTimestampMs(String(b.row.operatorLastAccessAt ?? ''));
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'lastTransaction': {
      const snapTxA = pickLastTransactionTs(a.row, ctx.snapshotGeneratedAt);
      const snapTxB = pickLastTransactionTs(b.row, ctx.snapshotGeneratedAt);
      let ta = parseTimestampMs(String(snapTxA ?? ''));
      let tb = parseTimestampMs(String(snapTxB ?? ''));
      const vendonA = ctx.lastTxByMachine?.[idA]?.timestamp;
      const vendonB = ctx.lastTxByMachine?.[idB]?.timestamp;
      if (Number.isNaN(ta) && vendonA) ta = vendonA * 1000;
      if (Number.isNaN(tb) && vendonB) tb = vendonB * 1000;
      const ma = a.row.minutesSinceLastTransaction ?? a.row.minutes_since_last_transaction;
      const mb = b.row.minutesSinceLastTransaction ?? b.row.minutes_since_last_transaction;
      if (Number.isNaN(ta) && ma != null && Number.isFinite(Number(ma))) {
        ta = Date.now() - Number(ma) * 60_000;
      }
      if (Number.isNaN(tb) && mb != null && Number.isFinite(Number(mb))) {
        tb = Date.now() - Number(mb) * 60_000;
      }
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'dailySales': {
      const sa = salesDayKwd(
        ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[idA] : undefined,
        0,
      );
      const sb = salesDayKwd(
        ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[idB] : undefined,
        0,
      );
      return compareNumbers(sa, sb, dir);
    }
    case 'mtdSales': {
      if (!ctx.mtdReady) return 0;
      return compareNumbers(ctx.mtdByMachine?.[idA]?.aSalesKwd, ctx.mtdByMachine?.[idB]?.aSalesKwd, dir);
    }
    case 'mtdYoySales': {
      if (!ctx.mtdYoyReady) return 0;
      return compareNumbers(
        ctx.mtdYoyByMachine?.[idA]?.aSalesKwd,
        ctx.mtdYoyByMachine?.[idB]?.aSalesKwd,
        dir,
      );
    }
    case 'dailyTarget': {
      const salesA = ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[idA] : undefined;
      const salesB = ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[idB] : undefined;
      const vendonA = ctx.vendonByMachine?.[idA];
      const vendonB = ctx.vendonByMachine?.[idB];
      const pairA = salesPairForPreset(ctx.compare.preset, salesA, ctx.compare, vendonA);
      const pairB = salesPairForPreset(ctx.compare.preset, salesB, ctx.compare, vendonB);
      const pctA = targetStackValues(pairA.primary ?? undefined, pairA.baseline ?? undefined, a.row.dailyTarget)
        .todayPct;
      const pctB = targetStackValues(pairB.primary ?? undefined, pairB.baseline ?? undefined, b.row.dailyTarget)
        .todayPct;
      return compareNumbers(pctA, pctB, dir);
    }
    case 'salesAcceleration': {
      if (!ctx.sxReady) return 0;
      return compareNumbers(
        ctx.sxByMachine?.[idA]?.location?.sxPct,
        ctx.sxByMachine?.[idB]?.location?.sxPct,
        dir,
      );
    }
    case 'frequency': {
      const incA = idA ? ctx.incidentsByMachine?.[idA] : undefined;
      const incB = idB ? ctx.incidentsByMachine?.[idB] : undefined;
      return compareNumbers(
        rowHappensForSort(a.row, ctx.compareMode, incA),
        rowHappensForSort(b.row, ctx.compareMode, incB),
        dir,
      );
    }
    case 'sendCredit':
      return compareNumbers(ctx.creditsByMachine?.[idA]?.credits_sent, ctx.creditsByMachine?.[idB]?.credits_sent, dir);
    case 'testCredits':
      return compareNumbers(
        ctx.creditsByMachine?.[idA]?.dispense_tests,
        ctx.creditsByMachine?.[idB]?.dispense_tests,
        dir,
      );
    case 'lastCleaning': {
      const ta = parseTimestampMs(String(a.row.lastCleaningAt ?? ''));
      const tb = parseTimestampMs(String(b.row.lastCleaningAt ?? ''));
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'qaVisit': {
      const ta = qaLastVisitSortMs(
        qaVisitForMachineName(nameA, ctx.qaSummary?.byLocationKey, ctx.qaSummary?.adminSummaryMtdByMachine, ctx.qaSummary?.latestByMachine),
      );
      const tb = qaLastVisitSortMs(
        qaVisitForMachineName(nameB, ctx.qaSummary?.byLocationKey, ctx.qaSummary?.adminSummaryMtdByMachine, ctx.qaSummary?.latestByMachine),
      );
      return compareNumbers(ta, tb, dir);
    }
    case 'techVisit': {
      const da =
        techVisitForMachineName(nameA, ctx.qaSummary?.byLocationKeyTech)?.daysSinceVisit ?? null;
      const db =
        techVisitForMachineName(nameB, ctx.qaSummary?.byLocationKeyTech)?.daysSinceVisit ?? null;
      return compareNumbers(da, db, dir);
    }
    default:
      return 0;
  }
}

export function sortRankedRedFlags(
  rows: RankedRedAlertRow[],
  sort: ColumnSortState<RedFlagsColumnKey>,
  ctx: RedFlagsSortContext,
): RankedRedAlertRow[] {
  if (!sort.column || !sort.dir) return rows;
  const copy = rows.slice();
  copy.sort((a, b) => compareRedFlagsRow(a, b, sort.column!, ctx, sort.dir!));
  return copy;
}
