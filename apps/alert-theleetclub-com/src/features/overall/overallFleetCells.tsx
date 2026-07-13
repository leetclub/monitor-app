import type { ReactNode } from 'react';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import type { ComparePresetId } from '@/components/ComparePresetPicker';
import rfStyles from '@/features/redflags/RedFlagsBoard.module.css';
import { LastTxLines } from '@/features/redflags/redFlagsFreqUi';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { CleaningStatusCell } from '@/components/CleaningStatusCell';
import { QaVisitCell } from '@/components/QaVisitCell';
import { SalesElapsedStack } from '@/components/SalesElapsedStack';
import { OperatorActivityCell } from '@/components/OperatorActivityCell';
import { OperatorCell } from '@/components/OperatorCell';
import { AttendanceWorkflowCell } from '@/components/AttendanceWorkflowCell';
import { MtdSalesCell } from '@/components/MtdSalesCell';
import type { CleaningWorkflowPayload, MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { MtdYoySalesCell } from '@/components/MtdYoySalesCell';
import { TargetElapsedStack } from '@/components/TargetElapsedStack';
import type { QaFindingRow, QaVisitRow } from '@/lib/qaVisitDisplay';
import { presetBoxLabels } from '@/lib/presetComparison';
import { canOpenSalesHistory } from '@/lib/salesDisplay';
import { OVERALL_COLUMNS } from './overallWorkbookColumns';
import type { SalesElapsedRow } from '@/lib/salesDisplay';
import type { CompareMetricPair } from '@/lib/presetComparison';
import type { OverallColumnKey } from './overallWorkbookColumns';

type Machine = { id: string; name: string; vendon_location_owner?: string | null };

type AdminProfileRow = {
  location_owner?: string | null;
  location_hours?: string | null;
  operator_name?: string | null;
  timezone?: string | null;
  operating_days?: unknown;
  cleaning_windows?: unknown;
  operator_hours?: unknown;
  priority?: number | null;
};

type LiveDashboardMachine = {
  salesToday?: number | null;
  dailyTarget?: number | null;
  lastCleaningAt?: string | null;
  lastQcVisitAt?: string | null;
  shift?: {
    expectedStart?: string | null;
    clockInAt?: number | null;
  } | null;
};

export type FleetRowBundle = {
  m: Machine;
  snap?: RedAlertRow;
  live?: LiveDashboardMachine;
  prof?: AdminProfileRow;
  vendon?: {
    peakHour?: { label: string } | null;
    topProduct?: { name: string } | null;
    lowProduct?: { name: string } | null;
  };
  salesElapsed?: SalesElapsedRow;
  salesPair?: CompareMetricPair;
  mtdSalesKwd?: number | null;
  mtdYoySalesKwd?: number | null;
  mtdYoyLyKwd?: number | null;
  mtdYoyTrendPct?: number | null;
  footfallPair?: CompareMetricPair & { mapped: boolean };
  vendonTxIso: string;
  wastePct?: number | null;
  wasteSkipped?: boolean;
  wasteReason?: string;
  wasteDate?: string;
  wasteError?: string | null;
  footfall?: {
    mapped?: boolean;
    todayIn?: number | null;
    yesterdayIn?: number | null;
    trendPct?: number | null;
    hint?: string | null;
  };
  footfallTz?: string;
  operatingDaysLabel: string;
  operatorHoursSummary: string;
  attendance: { label: string; color: 'g' | 'y' | 'o' | 'r' } | null;
  workflowAttendance?: MachineAttendanceSummary;
  workflowCleaning?: CleaningWorkflowPayload | null;
  workflowConfigured?: boolean;
  cleanIso: string;
  cleanStatus: ReturnType<typeof lastCleanedStatus> | null;
  vendFailSummary: string;
  mostIssue: string;
  operator: string;
  txRaw: unknown;
  minsOk: boolean;
  mins: unknown;
  peakHourLabel: string;
  peakHourCount: number | null;
  peakHourFromYesterday: boolean;
  topProduct: string;
  lowProduct: string;
  liveTargetPct: number | null;
  qcIso: string;
  techIso: string;
  qaVisit?: QaVisitRow | null;
  techVisit?: QaVisitRow | null;
  qaFindings?: QaFindingRow[];
  qaLoading?: boolean;
  qaError?: string | null;
  operatorActivity?: import('@/components/OperatorActivityCell').OperatorActivityTimes | null;
  comparePreset?: ComparePresetId;
  snapTime?: string | null;
  dailyTargetKd?: number | null;
  workflowLoaded?: boolean;
  cleaningOverdue15h?: boolean;
  adminMetaHintParts: string[];
  locationOwner: string;
  locHours: string;
  adminLocationOwner: string;
  vendonTagOwner: string;
};

function formatPct(pct: number): string {
  const p = Math.round(pct);
  if (!Number.isFinite(p)) return '—';
  const sign = p > 0 ? '+' : '';
  return `${sign}${p}%`;
}

function headerTooltip(key: OverallColumnKey): string {
  const c = OVERALL_COLUMNS[key];
  if (c.note) return `${c.title} — ${c.note}`;
  return c.title;
}

function fleetRowAsRedAlert(b: FleetRowBundle): RedAlertRow {
  if (b.snap) return b.snap;
  const row: RedAlertRow = {
    machineId: b.m.id,
    machineName: b.m.name,
  };
  if (b.operator && b.operator !== '—') row.operator = b.operator;
  if (b.minsOk && b.mins != null) row.minutesSinceLastTransaction = Number(b.mins);
  if (b.txRaw) row.lastTransactionAtUtc = String(b.txRaw);
  if (b.dailyTargetKd != null && Number.isFinite(Number(b.dailyTargetKd))) {
    row.dailyTarget = Number(b.dailyTargetKd);
  }
  return row;
}

export function overallBodyCellClass(key: OverallColumnKey): string {
  switch (key) {
    case 'vendingMachine':
      return `${rfStyles.td} opsStickyCol`;
    case 'operatorActivity':
      return `${rfStyles.td} ${rfStyles.tdActivity}`;
    case 'salesTrend':
    case 'mtdSales':
    case 'targetAchieved':
      return 'alertSalesCell';
    case 'mtdYoySales':
      return 'alertSalesCell alertSalesCellYoy';
    case 'lastCleaned':
      return `${rfStyles.td} opsColLastCleaned`;
    case 'lastQaCheck':
    case 'lastTechCheck':
    case 'peakHours':
    case 'highestProduct':
    case 'lowestProduct':
    case 'wastagePct':
      return `${rfStyles.td} ${rfStyles.tdMetric}`;
    default:
      return rfStyles.td;
  }
}

export function overallHeaderClass(key: OverallColumnKey): string {
  switch (key) {
    case 'vendingMachine':
      return `${rfStyles.thMachine} opsStickyCol`;
    case 'operator':
    case 'lastTransaction':
      return rfStyles.thOp;
    case 'operatorActivity':
      return rfStyles.thActivity;
    case 'salesTrend':
    case 'mtdSales':
    case 'targetAchieved':
      return rfStyles.thSales;
    case 'mtdYoySales':
      return `${rfStyles.thSales} ${rfStyles.thYoy}`;
    case 'lastCleaned':
      return `${rfStyles.thNarrow} opsColLastCleaned`;
    case 'lastQaCheck':
    case 'lastTechCheck':
    case 'peakHours':
    case 'highestProduct':
    case 'lowestProduct':
    case 'wastagePct':
      return `${rfStyles.thMetric} alertThCenter`;
    default:
      return '';
  }
}

export function OverallFleetRow({
  bundle,
  columns,
  onSalesDetail,
}: {
  bundle: FleetRowBundle;
  columns: OverallColumnKey[];
  onSalesDetail?: (b: FleetRowBundle) => void;
}) {
  const b = bundle;
  const rowClass = b.cleaningOverdue15h ? rfStyles.rowCleaningOverdue : undefined;
  return (
    <tr className={rowClass}>
      {columns.map((key) => (
        <td key={key} className={overallBodyCellClass(key)}>
          {renderOverallColumn(key, b, onSalesDetail)}
        </td>
      ))}
    </tr>
  );
}

function renderOverallColumn(
  key: OverallColumnKey,
  b: FleetRowBundle,
  onSalesDetail?: (b: FleetRowBundle) => void,
): ReactNode {
  switch (key) {
    case 'operatingHours':
      return (
        <div title={[headerTooltip('operatingHours'), b.adminLocationOwner ? 'Owner: Admin profile.' : b.vendonTagOwner ? 'Owner: Vendon tag.' : '', b.adminMetaHintParts.join(' · ')].filter(Boolean).join(' ')}>
          <div>{b.locHours ? `${b.locHours} hrs` : <span className="opsCellMuted">—</span>}</div>
          <div className="opsCellSub">{b.locationOwner || '—'}</div>
          {b.operatingDaysLabel ? <div className="opsCellSub">{b.operatingDaysLabel}</div> : null}
          {b.prof?.timezone ? <div className="opsCellSub">TZ: {String(b.prof.timezone)}</div> : null}
        </div>
      );
    case 'vendingMachine':
      return (
        <>
          <div className={rfStyles.machineName}>{b.m.name}</div>
          <div className={rfStyles.machineId}>#{b.m.id}</div>
        </>
      );
    case 'operator': {
      const row = fleetRowAsRedAlert(b);
      return (
        <OperatorCell
          row={row}
          machineLabel={b.m.name || b.m.id}
          attendanceSummary={b.workflowAttendance}
          workflowConfigured={b.workflowConfigured}
          workflowLoaded={b.workflowLoaded}
        />
      );
    }
    case 'operatorActivity':
      return b.snap || b.operatorActivity ? (
        <OperatorActivityCell
          activity={b.operatorActivity}
          legacyWebAccessAt={b.snap?.operatorLastAccessAt}
        />
      ) : (
        <span className="opsCellMuted">—</span>
      );
    case 'attendance':
      if (b.workflowConfigured) {
        return (
          <AttendanceWorkflowCell
            machineId={b.m.id}
            machineName={b.m.name || b.m.id}
            summary={b.workflowAttendance}
            workflowConfigured={b.workflowConfigured}
          />
        );
      }
      return b.attendance ? (
        <span
          className={
            b.attendance.color === 'g'
              ? 'pillSuccess'
              : b.attendance.color === 'y' || b.attendance.color === 'o'
                ? 'pillWarn'
                : 'pillDanger'
          }
          style={{ fontSize: '0.78rem' }}
        >
          {b.attendance.label}
        </span>
      ) : (
        <span className="opsCellMuted">—</span>
      );
    case 'lastCleaned':
      return (
        <CleaningStatusCell
          iso={b.cleanIso}
          status={b.cleanStatus}
          machineId={b.m.id}
          machineName={b.m.name || b.m.id}
          cleaningOverdue15h={b.cleaningOverdue15h}
          hoursSinceCleaning={b.snap?.hoursSinceCleaning}
          operatorName={b.operator || b.snap?.operator || b.workflowAttendance?.operatorName}
          strikeOperatorEmail={b.snap?.strikeOperatorEmail || b.snap?.operatorEmail || b.workflowAttendance?.operatorEmail}
          workflowAttendance={b.workflowAttendance}
          workflowCleaning={b.workflowCleaning}
        />
      );
    case 'lastVendFailed':
      return b.vendFailSummary ? b.vendFailSummary : <span className="opsCellMuted">—</span>;
    case 'lastTransaction':
      return (
        <LastTxLines
          row={fleetRowAsRedAlert(b)}
          snapshotGeneratedAt={b.snapTime ?? null}
          vendonTxIso={b.vendonTxIso}
          part="sale"
        />
      );
    case 'salesTrend':
      return (
        <SalesElapsedStack
          row={b.salesElapsed}
          pair={b.salesPair}
          preset={b.comparePreset}
          title={b.salesPair?.caption ?? OVERALL_COLUMNS.salesTrend.note}
          interactive={
            canOpenSalesHistory(b.salesElapsed) ||
            Boolean(onSalesDetail && b.salesPair?.primary != null && Number.isFinite(b.salesPair.primary))
          }
          onOpenDetail={onSalesDetail ? () => onSalesDetail(b) : undefined}
        />
      );
    case 'mtdSales':
      return <MtdSalesCell kwd={b.mtdSalesKwd} />;
    case 'mtdYoySales':
      return (
        <MtdYoySalesCell
          kwd={b.mtdYoySalesKwd}
          lyKwd={b.mtdYoyLyKwd}
          trendPct={b.mtdYoyTrendPct}
        />
      );
    case 'targetAchieved': {
      const preset = b.comparePreset ?? 'today_vs_yesterday';
      const todayKwd =
        b.salesPair?.primary != null && Number.isFinite(b.salesPair.primary)
          ? b.salesPair.primary
          : b.live?.salesToday != null
            ? Number(b.live.salesToday)
            : undefined;
      const dailyTargetKd =
        b.dailyTargetKd ??
        (b.snap?.dailyTarget != null ? Number(b.snap.dailyTarget) : null) ??
        (b.live?.dailyTarget != null ? Number(b.live.dailyTarget) : null);
      return (
        <TargetElapsedStack
          todayKwd={todayKwd}
          dailyTargetKd={dailyTargetKd}
          machineName={b.m.name || b.m.id}
          areaOwnerName={b.adminLocationOwner || null}
          vendonOwnerName={b.vendonTagOwner || null}
          primaryLabel={presetBoxLabels(preset).primary}
          primaryLabelTitle={b.salesPair?.primaryLabel}
          title={OVERALL_COLUMNS.targetAchieved.note}
          interactive={Boolean(dailyTargetKd && b.m.id)}
        />
      );
    }
    case 'peakHours':
      return b.peakHourLabel ? (
        <>
          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{b.peakHourLabel}</div>
          {typeof b.peakHourCount === 'number' && Number.isFinite(b.peakHourCount) && b.peakHourCount > 0 ? (
            <div className="opsCellSub">{b.peakHourCount} vends</div>
          ) : b.peakHourFromYesterday ? (
            <div className="opsCellSub">no vends today yet</div>
          ) : null}
        </>
      ) : (
        <span className="opsCellMuted">—</span>
      );
    case 'promotion':
      return <span className="opsCellMuted">—</span>;
    case 'highestProduct':
      return b.topProduct ? <span className="tableCellWrap">{b.topProduct}</span> : <span className="opsCellMuted">—</span>;
    case 'lowestProduct':
      return b.lowProduct ? <span className="tableCellWrap">{b.lowProduct}</span> : <span className="opsCellMuted">—</span>;
    case 'peopleCount': {
      const fc = b.footfallPair;
      if (fc?.mapped && fc.primary != null && Number.isFinite(fc.primary)) {
        return (
          <>
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>{fc.primary}</div>
            {fc.trendPct != null && Number.isFinite(fc.trendPct) ? (
              <div className="opsCellSub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatPct(fc.trendPct)} vs {fc.baselineLabel.toLowerCase()}
              </div>
            ) : fc.baseline != null ? (
              <div className="opsCellSub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                vs {fc.baseline} ({fc.baselineLabel})
              </div>
            ) : (
              <div className="opsCellSub">—</div>
            )}
          </>
        );
      }
      return <span className="opsCellMuted">—</span>;
    }
    case 'customerCalls':
      return <span className="opsCellMuted">—</span>;
    case 'mostIssue':
      return b.mostIssue ? <span className="opsTdIssue">{b.mostIssue}</span> : <span className="opsCellMuted">—</span>;
    case 'lastQaCheck':
      return b.qaVisit ? (
        <QaVisitCell
          machineName={b.m.name || b.m.id}
          machineId={b.m.id}
          visit={b.qaVisit}
          findings={b.qaFindings}
          loading={b.qaLoading}
          error={b.qaError ?? null}
        />
      ) : b.qcIso ? (
        formatKuwaitDateTime(b.qcIso)
      ) : (
        <span className="opsCellMuted">—</span>
      );
    case 'lastTechCheck':
      return (
        <QaVisitCell
          machineName={b.m.name || b.m.id}
          machineId={b.m.id}
          visit={b.techVisit ?? null}
          findings={[]}
          loading={b.qaLoading}
          error={b.qaError ?? null}
          mode="tech"
        />
      );
    case 'wastagePct':
      return typeof b.wastePct === 'number' && Number.isFinite(b.wastePct) ? (
        <span className="opsTdMetric" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {b.wastePct.toFixed(1)}%
        </span>
      ) : b.wasteSkipped ? (
        <span className="opsCellMuted" title={b.wasteReason}>
          —
        </span>
      ) : (
        <span className="opsCellMuted">—</span>
      );
    case 'promotionRuns':
      return (
        <span className="fleetCellMissing" title={OVERALL_COLUMNS.promotionRuns.note}>
          ?
        </span>
      );
    default:
      return <span className="opsCellMuted">—</span>;
  }
}
