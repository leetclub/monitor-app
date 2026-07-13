import type { ColumnSortDir, ColumnSortState } from '@/lib/tableColumnSort';
import { compareNumbers, compareStrings } from '@/lib/tableColumnSort';
import { salesDayKwd, type DailySalesElapsedResponse } from '@/lib/salesDisplay';
import { footfallDisplayForPreset, salesPairForPreset } from '@/lib/presetComparison';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  qaVisitForMachineName,
  qaLastVisitSortMs,
  techVisitForMachineName,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import type { OverallColumnKey } from './overallWorkbookColumns';

type FleetMachine = { id: string; name: string; vendon_location_owner?: string | null };

export const OVERALL_SORTABLE_COLUMNS = new Set<OverallColumnKey>([
  'vendingMachine',
  'operator',
  'operatorActivity',
  'lastCleaned',
  'lastTransaction',
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
  'targetAchieved',
  'peopleCount',
  'mostIssue',
  'lastQaCheck',
  'lastTechCheck',
  'wastagePct',
  'lastVendFailed',
  'peakHours',
  'highestProduct',
  'lowestProduct',
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

function snapshotMostIssue(snap: RedAlertRow | undefined): string {
  const reasons = snap?.reasons;
  if (!reasons?.length) return '';
  return String(reasons[reasons.length - 1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function snapshotVendFailCount(snap: RedAlertRow | undefined): number | null {
  const fq = snap?.frequency;
  if (!fq) return null;
  const td = fq.dispenseFailsToday;
  const wtd = fq.dispenseFailsThisWeek;
  let total = 0;
  let known = false;
  if (td != null && Number(td) >= 0) {
    total += Number(td);
    known = true;
  }
  if (wtd != null && Number(wtd) >= 0) {
    total += Number(wtd);
    known = true;
  }
  return known ? total : null;
}

export type OverallSortContext = {
  compare: CompareSelection;
  snapshotById: Map<string, RedAlertRow>;
  profileById: Map<string, { operator_name?: string | null }>;
  dailySales?: DailySalesElapsedResponse;
  dailySalesReady: boolean;
  vendonByMachine?: Record<
    string,
    {
      aSalesKwd?: number | null;
      bSalesKwd?: number | null;
      trendPct?: number | null;
      peakHour?: { hour: number; count: number; label: string } | null;
      topProduct?: { name: string; count: number } | null;
      lowProduct?: { name: string; count: number } | null;
    }
  >;
  mtdByMachine?: Record<string, { aSalesKwd?: number | null }>;
  mtdReady: boolean;
  mtdYoyByMachine?: Record<
    string,
    { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
  >;
  mtdYoyReady: boolean;
  lastTxByMachine?: Record<string, { timestamp: number }>;
  liveById: Map<string, { dailyTarget?: number | null; salesToday?: number | null }>;
  wasteByMachine?: Record<string, { wastePct?: number | null }>;
  footfallByMachine?: Record<
    string,
    {
      mapped?: boolean;
      primaryIn?: number | null;
      trendPct?: number | null;
    }
  >;
  qaSummary?: QaSummaryResponse;
  operatorActivityByMachine?: Record<string, { latestAt?: string | null }>;
};

function operatorName(m: FleetMachine, ctx: OverallSortContext): string {
  const snap = ctx.snapshotById.get(m.id);
  const prof = ctx.profileById.get(m.id);
  return (
    String(prof?.operator_name ?? '').trim() ||
    String(snap?.operator ?? snap?.operatorName ?? snap?.redAlertOperator ?? '').trim() ||
    ''
  );
}

function compareFleetMachine(
  a: FleetMachine,
  b: FleetMachine,
  column: OverallColumnKey,
  ctx: OverallSortContext,
  dir: ColumnSortDir,
): number {
  const snapA = ctx.snapshotById.get(a.id);
  const snapB = ctx.snapshotById.get(b.id);
  const liveA = ctx.liveById.get(a.id);
  const liveB = ctx.liveById.get(b.id);

  switch (column) {
    case 'vendingMachine':
      return compareStrings(a.name || a.id, b.name || b.id, dir);
    case 'operator':
      return compareStrings(operatorName(a, ctx), operatorName(b, ctx), dir);
    case 'operatorActivity': {
      const actA = ctx.operatorActivityByMachine?.[a.id]?.latestAt;
      const actB = ctx.operatorActivityByMachine?.[b.id]?.latestAt;
      const ta = parseTimestampMs(String(actA || snapA?.operatorLastAccessAt || ''));
      const tb = parseTimestampMs(String(actB || snapB?.operatorLastAccessAt || ''));
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'lastCleaned': {
      const isoA = snapA?.lastCleaningAt != null ? String(snapA.lastCleaningAt).trim() : '';
      const isoB = snapB?.lastCleaningAt != null ? String(snapB.lastCleaningAt).trim() : '';
      const ta = parseTimestampMs(isoA);
      const tb = parseTimestampMs(isoB);
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'lastTransaction': {
      const txA =
        snapA?.lastTransactionAtUtc ??
        snapA?.last_transaction_at_utc ??
        snapA?.lastSaleAtUtc ??
        snapA?.last_sale_at_utc ??
        '';
      const txB =
        snapB?.lastTransactionAtUtc ??
        snapB?.last_transaction_at_utc ??
        snapB?.lastSaleAtUtc ??
        snapB?.last_sale_at_utc ??
        '';
      let ta = parseTimestampMs(String(txA));
      let tb = parseTimestampMs(String(txB));
      const vendonA = ctx.lastTxByMachine?.[a.id]?.timestamp;
      const vendonB = ctx.lastTxByMachine?.[b.id]?.timestamp;
      if (Number.isNaN(ta) && vendonA) ta = vendonA * 1000;
      if (Number.isNaN(tb) && vendonB) tb = vendonB * 1000;
      const minsA = snapA?.minutesSinceLastTransaction ?? snapA?.minutes_since_last_transaction;
      const minsB = snapB?.minutesSinceLastTransaction ?? snapB?.minutes_since_last_transaction;
      if (Number.isNaN(ta) && minsA != null && Number.isFinite(Number(minsA))) {
        ta = Date.now() - Number(minsA) * 60_000;
      }
      if (Number.isNaN(tb) && minsB != null && Number.isFinite(Number(minsB))) {
        tb = Date.now() - Number(minsB) * 60_000;
      }
      return compareNumbers(Number.isNaN(ta) ? null : ta, Number.isNaN(tb) ? null : tb, dir);
    }
    case 'salesTrend': {
      const sa = salesDayKwd(
        ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[a.id] : undefined,
        0,
      );
      const sb = salesDayKwd(
        ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[b.id] : undefined,
        0,
      );
      return compareNumbers(sa, sb, dir);
    }
    case 'mtdSales': {
      if (!ctx.mtdReady) return 0;
      return compareNumbers(ctx.mtdByMachine?.[a.id]?.aSalesKwd, ctx.mtdByMachine?.[b.id]?.aSalesKwd, dir);
    }
    case 'mtdYoySales': {
      if (!ctx.mtdYoyReady) return 0;
      return compareNumbers(
        ctx.mtdYoyByMachine?.[a.id]?.aSalesKwd,
        ctx.mtdYoyByMachine?.[b.id]?.aSalesKwd,
        dir,
      );
    }
    case 'targetAchieved': {
      const salesA = ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[a.id] : undefined;
      const salesB = ctx.dailySalesReady ? ctx.dailySales?.byMachineId?.[b.id] : undefined;
      const pairA = salesPairForPreset(ctx.compare.preset, salesA, ctx.compare, ctx.vendonByMachine?.[a.id]);
      const pairB = salesPairForPreset(ctx.compare.preset, salesB, ctx.compare, ctx.vendonByMachine?.[b.id]);
      const pctA =
        liveA?.dailyTarget != null &&
        Number(liveA.dailyTarget) > 0 &&
        pairA.primary != null &&
        Number.isFinite(pairA.primary)
          ? (pairA.primary / Number(liveA.dailyTarget)) * 100
          : liveA?.dailyTarget != null && Number(liveA.dailyTarget) > 0
            ? (Number(liveA.salesToday ?? 0) / Number(liveA.dailyTarget)) * 100
            : null;
      const pctB =
        liveB?.dailyTarget != null &&
        Number(liveB.dailyTarget) > 0 &&
        pairB.primary != null &&
        Number.isFinite(pairB.primary)
          ? (pairB.primary / Number(liveB.dailyTarget)) * 100
          : liveB?.dailyTarget != null && Number(liveB.dailyTarget) > 0
            ? (Number(liveB.salesToday ?? 0) / Number(liveB.dailyTarget)) * 100
            : null;
      return compareNumbers(pctA, pctB, dir);
    }
    case 'peopleCount': {
      const fa = footfallDisplayForPreset(
        ctx.compare.preset,
        ctx.footfallByMachine?.[a.id],
        ctx.footfallByMachine?.[a.id],
      );
      const fb = footfallDisplayForPreset(
        ctx.compare.preset,
        ctx.footfallByMachine?.[b.id],
        ctx.footfallByMachine?.[b.id],
      );
      return compareNumbers(fa.primary, fb.primary, dir);
    }
    case 'mostIssue':
      return compareStrings(snapshotMostIssue(snapA), snapshotMostIssue(snapB), dir);
    case 'lastQaCheck': {
      const ta = qaLastVisitSortMs(
        qaVisitForMachineName(a.name || a.id, ctx.qaSummary?.byLocationKey, ctx.qaSummary?.adminSummaryMtdByMachine, ctx.qaSummary?.latestByMachine),
      );
      const tb = qaLastVisitSortMs(
        qaVisitForMachineName(b.name || b.id, ctx.qaSummary?.byLocationKey, ctx.qaSummary?.adminSummaryMtdByMachine, ctx.qaSummary?.latestByMachine),
      );
      return compareNumbers(ta, tb, dir);
    }
    case 'lastTechCheck': {
      const da =
        techVisitForMachineName(a.name || a.id, ctx.qaSummary?.byLocationKeyTech)?.daysSinceVisit ??
        null;
      const db =
        techVisitForMachineName(b.name || b.id, ctx.qaSummary?.byLocationKeyTech)?.daysSinceVisit ??
        null;
      return compareNumbers(da, db, dir);
    }
    case 'wastagePct':
      return compareNumbers(
        ctx.wasteByMachine?.[a.id]?.wastePct,
        ctx.wasteByMachine?.[b.id]?.wastePct,
        dir,
      );
    case 'lastVendFailed':
      return compareNumbers(snapshotVendFailCount(snapA), snapshotVendFailCount(snapB), dir);
    case 'peakHours':
      return compareNumbers(
        ctx.vendonByMachine?.[a.id]?.peakHour?.count,
        ctx.vendonByMachine?.[b.id]?.peakHour?.count,
        dir,
      );
    case 'highestProduct':
      return compareStrings(
        ctx.vendonByMachine?.[a.id]?.topProduct?.name ?? '',
        ctx.vendonByMachine?.[b.id]?.topProduct?.name ?? '',
        dir,
      );
    case 'lowestProduct':
      return compareStrings(
        ctx.vendonByMachine?.[a.id]?.lowProduct?.name ?? '',
        ctx.vendonByMachine?.[b.id]?.lowProduct?.name ?? '',
        dir,
      );
    default:
      return 0;
  }
}

export function sortFleetMachines(
  machines: FleetMachine[],
  sort: ColumnSortState<OverallColumnKey>,
  ctx: OverallSortContext,
): FleetMachine[] {
  if (!sort.column || !sort.dir) return machines;
  const copy = machines.slice();
  copy.sort((a, b) => compareFleetMachine(a, b, sort.column!, ctx, sort.dir!));
  return copy;
}
