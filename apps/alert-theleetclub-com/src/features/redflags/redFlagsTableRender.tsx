import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { AlertTableHeader } from '@/components/AlertTableHeader';
import { bindStopRowClick } from '@/lib/stopRowClick';
import { CallAmCell } from '@/components/CallAmCell';
import { CallOpCell } from '@/components/CallOpCell';
import { CleaningStatusCell } from '@/components/CleaningStatusCell';
import { RemoteCreditsCell } from '@/components/RemoteCreditsCell';
import { OperatorActivityCell } from '@/components/OperatorActivityCell';
import { OperatorCell } from '@/components/OperatorCell';
import { MtdSalesCell } from '@/components/MtdSalesCell';
import { MtdYoySalesCell } from '@/components/MtdYoySalesCell';
import { QaVisitCell } from '@/components/QaVisitCell';
import { SalesElapsedStack } from '@/components/SalesElapsedStack';
import { DowntimeStack } from '@/components/DowntimeStack';
import { SxAccelerationCell, type SxAccelerationRow } from '@/components/SxAccelerationCell';
import { TargetElapsedStack } from '@/components/TargetElapsedStack';
import { presetBoxLabels } from '@/lib/presetComparison';
import { buildFreqColumnContext, type FreqColumnContext } from '@/lib/freqColumnContext';
import { canOpenSalesHistory, type SalesElapsedRow } from '@/lib/salesDisplay';
import type { DowntimeMachineRow } from '@/lib/downtimeDisplay';
import type { QaFindingRow, QaVisitRow } from '@/lib/qaVisitDisplay';
import type { ComparePresetId } from '@/components/ComparePresetPicker';
import type { CompareMetricPair } from '@/lib/presetComparison';
import { RED_FLAGS_TABLE_HEADERS } from '@/lib/tableHeaderLabels';
import type { IncidentsElapsedRow } from '@/lib/incidentsDisplay';
import type { RankedRedAlertRow } from './redFlagsModel';
import type { RedAlertRow } from './redAlertTypes';
import { RED_FLAGS_COLUMNS, redFlagsHeaderTooltip, type RedFlagsColumnKey } from './redFlagsWorkbookColumns';
import {
  FreqIconScore,
  FreqIconTrend,
  FreqIconVariance,
  LastTxLines,
  freqBoxClasses,
  freqIncidentBurdenTone,
  freqTrendValTone,
  redFlagsTableStyles as styles,
  sendCreditToneClass,
  testCreditsToneClass,
  vendsResolvedLabel,
  vendsResolvedToneClass,
} from './redFlagsFreqUi';
import type { ColumnSortState } from '@/lib/tableColumnSort';
import { sortDirForColumn } from '@/lib/tableColumnSort';
import { RED_FLAGS_SORTABLE_COLUMNS } from './redFlagsTableSort';
import { freqBoxVisuals, type FreqSplit } from './redFlagsModel';

export type RedFlagsHeaderCtx = {
  freqHeading: { title: string; sub: string };
  sort: ColumnSortState<RedFlagsColumnKey>;
  onSortColumn: (key: RedFlagsColumnKey) => void;
};

function redFlagsHeaderSortProps(key: RedFlagsColumnKey, ctx: RedFlagsHeaderCtx) {
  if (!RED_FLAGS_SORTABLE_COLUMNS.has(key)) {
    return { sortable: false as const };
  }
  return {
    sortable: true as const,
    sortDir: sortDirForColumn(ctx.sort, key),
    onSortClick: () => ctx.onSortColumn(key),
  };
}

export type RedFlagsRowBundle = {
  d: RankedRedAlertRow;
  row: RedAlertRow;
  machId: string;
  r: number;
  cred?: {
    credits_sent?: number;
    dispense_tests?: number;
    vends_resolved?: string;
  };
  creditsSentN: number;
  dispenseTestsN: number;
  vendsResolved?: string;
  cleanIso: string;
  cleanStatus: ReturnType<typeof import('@/lib/kuwaitCleaningStatus').lastCleanedStatus> | null;
  cleaningWindows?: { startMin: number; endMin: number }[];
  noSalesAlert?: boolean;
  noSalesHours?: number;
  incidentsRow: IncidentsElapsedRow;
  freqCtx: FreqColumnContext;
  fq: FreqSplit;
  freqVisual: ReturnType<typeof freqBoxVisuals>;
  scoreText: string;
  trendText: string;
  hitsN: number;
  scoreKnown: boolean;
  gapDisplay: string;
  gapN: number;
  gapNeutral: boolean;
  freqColumnTooltip: string;
  canOpenTrend: boolean;
  p2: boolean;
  alertTypeText: string;
  alertTypeShow: string;
  salesRow?: SalesElapsedRow;
  salesPair: CompareMetricPair;
  comparePreset: ComparePresetId;
  targetKwd: { todayKwd?: number; yesterdayKwd?: number };
  mtdSalesKwd?: number | null;
  mtdYoySalesKwd?: number | null;
  mtdYoyLyKwd?: number | null;
  mtdYoyTrendPct?: number | null;
  sxRow?: SxAccelerationRow | null;
  downtimeRow?: DowntimeMachineRow | null;
  downtimeTodayLabel?: string;
  downtimePeriodLabel?: string;
  onOpenDowntime?: () => void;
  qaVisit?: QaVisitRow | null;
  techVisit?: QaVisitRow | null;
  qaFindings?: QaFindingRow[];
  qaLoading: boolean;
  qaError?: string | null;
  goUrl: string | null;
  slackEmailMap: Record<string, string>;
  slackTeamId: string;
  snapTime?: string | null;
  vendonTxIso?: string | null;
  clockMs: number;
  operatorActivity?: import('@/components/OperatorActivityCell').OperatorActivityTimes | null;
  areaOwnerName?: string | null;
  locationOwnerFull?: string | null;
  locationTagOwner?: string | null;
  /** Admin Machines → inactive (still listed, shaded). */
  machineInactive?: boolean;
  machineInactiveLabel?: string | null;
  workflowAttendance?: import('@/lib/leetWorkflowApi').MachineAttendanceSummary;
  workflowCleaning?: import('@/lib/leetWorkflowApi').CleaningWorkflowPayload | null;
  workflowConfigured?: boolean;
  workflowLoaded?: boolean;
  onOpenTrend: () => void;
  onOpenSales: () => void;
  onOpenTarget: () => void;
  onOpenPerformance: () => void;
  onOpenDrinks?: () => void;
  topDrinkName?: string | null;
  lowDrinkName?: string | null;
  onGoCheck: () => void;
};

export function redFlagsHeaderClass(key: RedFlagsColumnKey): string {
  switch (key) {
    case 'vendingMachine':
      return `${styles.thMachine} opsStickyCol`;
    case 'alertType':
      return styles.thAlert;
    case 'operator':
    case 'lastTransaction':
      return styles.thOp;
    case 'operatorActivity':
      return styles.thActivity;
    case 'dailySales':
    case 'topLowDrinks':
    case 'mtdSales':
    case 'dailyTarget':
    case 'salesAcceleration':
      return styles.thSales;
    case 'mtdYoySales':
      return `${styles.thSales} ${styles.thYoy}`;
    case 'frequency':
      return styles.thFreq;
    case 'downtime':
      return styles.thSales;
    case 'goCheck':
      return `${styles.thAction} alertThCenter alertThGoCheck`;
    case 'sendCredit':
    case 'vendsResolved':
    case 'testCredits':
    case 'qaVisit':
    case 'techVisit':
      return `${styles.thMetric} alertThCenter`;
    case 'lastCleaning':
      return `${styles.thNarrow} opsColLastCleaned`;
    case 'callOp':
      return `${styles.thAction} ${styles.thActionSticky} alertThCenter opsStickyColRight opsStickyColRightOp`;
    case 'callAm':
      return `${styles.thAction} ${styles.thActionSticky} alertThCenter opsStickyColRight opsStickyColRightAm`;
    default:
      return '';
  }
}

export function redFlagsBodyCellClass(key: RedFlagsColumnKey): string {
  switch (key) {
    case 'vendingMachine':
      return `${styles.td} opsStickyCol`;
    case 'operatorActivity':
      return `${styles.td} ${styles.tdActivity}`;
    case 'dailySales':
    case 'topLowDrinks':
    case 'mtdSales':
    case 'dailyTarget':
    case 'salesAcceleration':
      return 'alertSalesCell';
    case 'mtdYoySales':
      return 'alertSalesCell alertSalesCellYoy';
    case 'frequency':
      return `${styles.td} ${styles.tdFreqTriple}`;
    case 'downtime':
      return 'alertSalesCell';
    case 'goCheck':
      return `${styles.td} alertTdGoCheck`;
    case 'sendCredit':
    case 'vendsResolved':
    case 'testCredits':
    case 'qaVisit':
    case 'techVisit':
      return `${styles.td} ${styles.tdMetric}`;
    case 'lastCleaning':
      return `${styles.td} opsColLastCleaned`;
    case 'alertType':
      return styles.td;
    case 'operator':
    case 'lastTransaction':
      return styles.td;
    case 'callOp':
      return `${styles.td} ${styles.tdCallOp} opsStickyColRight opsStickyColRightOp`;
    case 'callAm':
      return `${styles.td} opsStickyColRight opsStickyColRightAm`;
    default:
      return styles.td;
  }
}

export function renderRedFlagsHeaderCell(key: RedFlagsColumnKey, ctx: RedFlagsHeaderCtx): ReactNode {
  const className = redFlagsHeaderClass(key);
  const sortProps = redFlagsHeaderSortProps(key, ctx);
  switch (key) {
    case 'vendingMachine':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.vendingMachine}
          title={redFlagsHeaderTooltip('vendingMachine')}
          className={className}
          {...sortProps}
        />
      );
    case 'alertType':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.alertType}
          title={redFlagsHeaderTooltip('alertType')}
          className={className}
          {...sortProps}
        />
      );
    case 'operator':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.operator}
          title={redFlagsHeaderTooltip('operator')}
          className={className}
          {...sortProps}
        />
      );
    case 'operatorActivity':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.operatorActivity}
          title={redFlagsHeaderTooltip('operatorActivity')}
          className={className}
          {...sortProps}
        />
      );
    case 'lastTransaction':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.lastTransaction}
          title={RED_FLAGS_COLUMNS.lastTransaction.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'dailySales':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.dailySales}
          title={RED_FLAGS_COLUMNS.dailySales.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'topLowDrinks':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.topLowDrinks}
          title={RED_FLAGS_COLUMNS.topLowDrinks.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'mtdSales':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.mtdSales}
          title={RED_FLAGS_COLUMNS.mtdSales.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'mtdYoySales':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.mtdYoySales}
          title={RED_FLAGS_COLUMNS.mtdYoySales.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'dailyTarget':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.dailyTarget}
          title={RED_FLAGS_COLUMNS.dailyTarget.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'salesAcceleration':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.salesAcceleration}
          title={RED_FLAGS_COLUMNS.salesAcceleration.placeholderNote}
          className={className}
          {...sortProps}
        />
      );
    case 'frequency':
      return (
        <AlertTableHeader
          key={key}
          label={{ main: ctx.freqHeading.title, sub: 'trend' }}
          title={`${ctx.freqHeading.title} — ${ctx.freqHeading.sub}`}
          className={className}
          {...sortProps}
        />
      );
    case 'downtime':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.downtime}
          title={RED_FLAGS_COLUMNS.downtime.placeholderNote || redFlagsHeaderTooltip('downtime')}
          className={className}
          {...sortProps}
        />
      );
    case 'goCheck':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.goCheck}
          title={redFlagsHeaderTooltip('goCheck')}
          className={className}
        />
      );
    case 'sendCredit':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.sendCredit}
          title={redFlagsHeaderTooltip('sendCredit')}
          className={className}
          {...sortProps}
        />
      );
    case 'vendsResolved':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.vendsResolved}
          title={redFlagsHeaderTooltip('vendsResolved')}
          className={className}
        />
      );
    case 'testCredits':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.testCredits}
          title={redFlagsHeaderTooltip('testCredits')}
          className={className}
          {...sortProps}
        />
      );
    case 'lastCleaning':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.lastCleaning}
          title={redFlagsHeaderTooltip('lastCleaning')}
          className={className}
          {...sortProps}
        />
      );
    case 'qaVisit':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.qaVisit}
          title={redFlagsHeaderTooltip('qaVisit')}
          className={className}
          {...sortProps}
        />
      );
    case 'techVisit':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.techVisit}
          title={redFlagsHeaderTooltip('techVisit')}
          className={className}
          {...sortProps}
        />
      );
    case 'callOp':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.callOp}
          title={redFlagsHeaderTooltip('callOp')}
          className={className}
        />
      );
    case 'callAm':
      return (
        <AlertTableHeader
          key={key}
          label={RED_FLAGS_TABLE_HEADERS.callAm}
          title={redFlagsHeaderTooltip('callAm')}
          className={className}
        />
      );
    default: {
      // Never omit a <th> — a missing header shifts every cell under the wrong title.
      const k = key as RedFlagsColumnKey;
      return (
        <AlertTableHeader
          key={k}
          label={RED_FLAGS_TABLE_HEADERS[k] || { main: String(k) }}
          title={redFlagsHeaderTooltip(k)}
          className={className}
          {...sortProps}
        />
      );
    }
  }
}

export function renderRedFlagsBodyCell(key: RedFlagsColumnKey, b: RedFlagsRowBundle): ReactNode {
  const { row, machId, d } = b;
  switch (key) {
    case 'vendingMachine':
      return (
        <>
          {d.isNew && <span className={`${styles.chip} ${styles.chipNew}`}>New</span>}
          {d.isChanged && !d.isNew && <span className={`${styles.chip} ${styles.chipUpd}`}>Updated</span>}
          {b.p2 && (
            <span className={`${styles.chip} ${styles.chipP2}`} title="Inside scheduled cleaning window">
              P2
            </span>
          )}
          {b.machineInactive ? (
            <span className={`${styles.chip} opsInactiveChip`} title="Marked inactive in Alert Admin → Machines">
              {b.machineInactiveLabel || 'Inactive'}
            </span>
          ) : null}
          <div className={styles.machineName}>{row.machineName || machId}</div>
          <div className={styles.machineId}>#{machId}</div>
          <LastTxLines
            row={row}
            snapshotGeneratedAt={b.snapTime ?? null}
            vendonTxIso={b.vendonTxIso}
            part="offEvent"
          />
        </>
      );
    case 'alertType':
      return (
        <div className={styles.alertTypeCell} title={row.reasons?.length ? row.reasons.join(' · ') : ''}>
          {b.alertTypeShow}
        </div>
      );
    case 'operator':
      return (
        <OperatorCell
          row={row}
          machineLabel={String(row.machineName || machId)}
          slackEmailMap={b.slackEmailMap}
          slackTeamId={b.slackTeamId}
          attendanceSummary={b.workflowAttendance}
          workflowConfigured={b.workflowConfigured}
          workflowLoaded={b.workflowLoaded}
          operatorActivity={b.operatorActivity}
        />
      );
    case 'operatorActivity':
      return (
        <OperatorActivityCell
          activity={b.operatorActivity}
          legacyWebAccessAt={row.operatorLastAccessAt}
          nowMs={b.clockMs}
        />
      );
    case 'lastTransaction':
      return (
        <LastTxLines
          row={row}
          snapshotGeneratedAt={b.snapTime ?? null}
          vendonTxIso={b.vendonTxIso}
          part="sale"
          noSalesAlert={Boolean(b.noSalesAlert)}
          noSalesHours={b.noSalesHours}
        />
      );
    case 'dailySales':
      return (
        <SalesElapsedStack
          row={b.salesRow}
          pair={b.salesPair}
          preset={b.comparePreset}
          title={b.salesPair.caption}
          interactive={
            canOpenSalesHistory(b.salesRow) ||
            (b.salesPair.primary != null && Number.isFinite(b.salesPair.primary))
          }
          onOpenDetail={b.onOpenSales}
        />
      );
    case 'topLowDrinks': {
      const high = (b.topDrinkName || '').trim();
      const low = (b.lowDrinkName || '').trim();
      const tip = RED_FLAGS_COLUMNS.topLowDrinks.placeholderNote;
      const inner = (
        <div className="drinksStackCell" title={tip}>
          <span className="drinksStackHigh">{high || '—'}</span>
          <span className="drinksStackLow">{low || '—'}</span>
        </div>
      );
      if (b.onOpenDrinks && (high || low)) {
        return (
          <button type="button" className="drinksStackBtn" title={tip} {...bindStopRowClick(b.onOpenDrinks)}>
            {inner}
          </button>
        );
      }
      return inner;
    }
    case 'mtdSales':
      return <MtdSalesCell kwd={b.mtdSalesKwd} />;
    case 'mtdYoySales':
      return (
        <MtdYoySalesCell kwd={b.mtdYoySalesKwd} lyKwd={b.mtdYoyLyKwd} trendPct={b.mtdYoyTrendPct} />
      );
    case 'dailyTarget':
      return (
        <TargetElapsedStack
          todayKwd={b.targetKwd.todayKwd}
          dailyTargetKd={row.dailyTarget}
          machineName={String(row.machineName || machId)}
          areaOwnerName={b.areaOwnerName}
          vendonOwnerName={b.locationTagOwner ?? b.locationOwnerFull}
          primaryLabel={presetBoxLabels(b.comparePreset).primary}
          primaryLabelTitle={b.salesPair.primaryLabel}
          title={RED_FLAGS_COLUMNS.dailyTarget.placeholderNote}
          interactive={Boolean(row.dailyTarget && machId)}
          onOpenDetail={b.onOpenTarget}
        />
      );
    case 'salesAcceleration':
      return (
        <SxAccelerationCell
          row={b.sxRow}
          title={RED_FLAGS_COLUMNS.salesAcceleration.placeholderNote}
          interactive={Boolean(machId)}
          onOpenDetail={b.onOpenPerformance}
        />
      );
    case 'frequency': {
      const freqOpenProps = b.canOpenTrend
        ? { title: 'Tap for incident trend breakdown', ...bindStopRowClick(b.onOpenTrend) }
        : {};
      return (
        <div
          className={`freq3 ${styles.freq3} ${b.canOpenTrend ? styles.freq3Interactive : ''}`}
          title={b.freqColumnTooltip}
        >
          <div className={freqBoxClasses('score', b.freqVisual.score)}>
            {b.canOpenTrend ? (
              <button type="button" className={`${styles.freqTrendOpen} freqScoreOpen`} {...freqOpenProps}>
                <div className={styles.freqBoxHead}>
                  <FreqIconScore />
                  <span className={styles.freqBoxTop}>Score</span>
                </div>
                <div
                  className={`freqBoxVal ${styles.freqBoxVal} ${
                    b.scoreKnown ? freqIncidentBurdenTone(Math.max(0, b.hitsN)) : styles.freqFlat
                  }`}
                >
                  {b.scoreText}
                </div>
              </button>
            ) : (
              <>
                <div className={styles.freqBoxHead}>
                  <FreqIconScore />
                  <span className={styles.freqBoxTop}>Score</span>
                </div>
                <div
                  className={`freqBoxVal ${styles.freqBoxVal} ${
                    b.scoreKnown ? freqIncidentBurdenTone(Math.max(0, b.hitsN)) : styles.freqFlat
                  }`}
                >
                  {b.scoreText}
                </div>
              </>
            )}
          </div>
          <div className={freqBoxClasses('trend', b.freqVisual.trend)}>
            {b.canOpenTrend ? (
              <button type="button" className={`${styles.freqTrendOpen} freqTrendOpen`} {...freqOpenProps}>
                <div className={styles.freqBoxHead}>
                  <FreqIconTrend />
                  <span className={styles.freqBoxTop}>Trend</span>
                </div>
                <div className={`freqBoxVal ${styles.freqBoxVal} ${freqTrendValTone(b.fq)}`}>{b.trendText}</div>
              </button>
            ) : (
              <>
                <div className={styles.freqBoxHead}>
                  <FreqIconTrend />
                  <span className={styles.freqBoxTop}>Trend</span>
                </div>
                <div className={`freqBoxVal ${styles.freqBoxVal} ${freqTrendValTone(b.fq)}`}>{b.trendText}</div>
              </>
            )}
          </div>
          <div className={freqBoxClasses('gap', b.freqVisual.gap)}>
            {b.canOpenTrend ? (
              <button type="button" className={`${styles.freqTrendOpen} freqGapOpen`} {...freqOpenProps}>
                <div className={styles.freqBoxHead}>
                  <FreqIconVariance />
                  <span className={styles.freqBoxTop}>Gap</span>
                </div>
                <div
                  className={`freqBoxVal ${styles.freqBoxVal} ${b.gapNeutral ? styles.freqFlat : freqIncidentBurdenTone(b.gapN)}`}
                >
                  {b.gapDisplay}
                </div>
              </button>
            ) : (
              <>
                <div className={styles.freqBoxHead}>
                  <FreqIconVariance />
                  <span className={styles.freqBoxTop}>Gap</span>
                </div>
                <div
                  className={`freqBoxVal ${styles.freqBoxVal} ${b.gapNeutral ? styles.freqFlat : freqIncidentBurdenTone(b.gapN)}`}
                >
                  {b.gapDisplay}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }
    case 'downtime':
      return (
        <DowntimeStack
          row={b.downtimeRow}
          todayLabel={b.downtimeTodayLabel || 'Today'}
          periodLabel={b.downtimePeriodLabel || 'Period'}
          title={RED_FLAGS_COLUMNS.downtime.placeholderNote}
          interactive={Boolean(b.onOpenDowntime)}
          onOpenDetail={b.onOpenDowntime}
        />
      );
    case 'goCheck':
      return machId ? (
        <button type="button" className="linkGo goCheckBtn" {...bindStopRowClick(b.onGoCheck)}>
          <span className="goCheckBtnLine">GO</span>
          <span className="goCheckBtnLine goCheckBtnLineStrong">CHECK</span>
        </button>
      ) : b.goUrl ? (
        <a
          href={b.goUrl}
          className="linkGo goCheckBtn"
          {...bindStopRowClick()}
          {...(b.goUrl.toLowerCase().startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
        >
          <span className="goCheckBtnLine">GO</span>
          <span className="goCheckBtnLine goCheckBtnLineStrong">CHECK</span>
        </a>
      ) : (
        '—'
      );
    case 'sendCredit':
      return machId && b.cred?.credits_sent != null ? (
        <RemoteCreditsCell
          machineId={machId}
          machineName={String(row.machineName || machId)}
          count={Number(b.cred.credits_sent ?? 0)}
          toneClassName={sendCreditToneClass(b.creditsSentN)}
        />
      ) : (
        <span className={styles.wireDash}>—</span>
      );
    case 'vendsResolved':
      return b.vendsResolved ? (
        <span className={vendsResolvedToneClass(b.vendsResolved)}>{vendsResolvedLabel(b.vendsResolved)}</span>
      ) : (
        <span className={styles.metricUnknown}>—</span>
      );
    case 'testCredits':
      return machId && b.cred?.dispense_tests != null ? (
        <span className={testCreditsToneClass(b.dispenseTestsN)}>{String(b.cred.dispense_tests ?? 0)}</span>
      ) : (
        <span className={styles.wireDash}>—</span>
      );
    case 'lastCleaning':
      return (
        <CleaningStatusCell
          iso={b.cleanIso}
          status={b.cleanStatus}
          machineId={machId}
          machineName={String(row.machineName || machId)}
          cleaningOverdue15h={!!row.cleaningOverdue15h}
          hoursSinceCleaning={row.hoursSinceCleaning}
          cleaningWindows={b.cleaningWindows}
          operatorName={String(row.operator || row.cleaningOperator || b.workflowAttendance?.operatorName || '').trim() || null}
          strikeOperatorEmail={row.strikeOperatorEmail || row.operatorEmail || b.workflowAttendance?.operatorEmail}
          workflowAttendance={b.workflowAttendance}
          workflowCleaning={b.workflowCleaning}
          slackEmailMap={b.slackEmailMap}
          slackTeamId={b.slackTeamId}
        />
      );
    case 'qaVisit':
      return (
        <QaVisitCell
          machineName={String(row.machineName || machId)}
          visit={b.qaVisit ?? null}
          findings={b.qaFindings}
          loading={b.qaLoading}
          error={b.qaError ?? null}
        />
      );
    case 'techVisit':
      return (
        <QaVisitCell
          machineName={String(row.machineName || machId)}
          machineId={machId}
          visit={b.techVisit ?? null}
          findings={[]}
          loading={b.qaLoading}
          error={b.qaError ?? null}
          mode="tech"
        />
      );
    case 'callOp':
      return (
        <CallOpCell
          row={row}
          machineLabel={String(row.machineName || machId)}
          slackEmailMap={b.slackEmailMap}
          slackTeamId={b.slackTeamId}
          attendanceSummary={b.workflowAttendance}
          workflowConfigured={b.workflowConfigured}
          workflowLoaded={b.workflowLoaded}
        />
      );
    case 'callAm':
      return (
        <CallAmCell
          machineName={String(row.machineName || '')}
          machineLabel={String(row.machineName || machId)}
          slackEmailMap={b.slackEmailMap}
          slackTeamId={b.slackTeamId}
        />
      );
    default:
      return '—';
  }
}

/** Body cell wrapper props for columns that need td-level handlers. */
export function redFlagsBodyCellProps(
  key: RedFlagsColumnKey,
  b: RedFlagsRowBundle,
): { title?: string; onClick?: (e: MouseEvent) => void; 'data-stop-row-click'?: boolean; onPointerDown?: (e: PointerEvent) => void } {
  if (key === 'operatorActivity') {
    return { title: RED_FLAGS_COLUMNS.operatorActivity.placeholderNote };
  }
  if (key === 'lastTransaction') {
    return { title: RED_FLAGS_COLUMNS.lastTransaction.placeholderNote };
  }
  if (key === 'dailySales') {
    return { title: b.salesPair.caption };
  }
  if (key === 'mtdSales') {
    return { title: RED_FLAGS_COLUMNS.mtdSales.placeholderNote };
  }
  if (key === 'mtdYoySales') {
    return { title: RED_FLAGS_COLUMNS.mtdYoySales.placeholderNote };
  }
  if (key === 'dailyTarget') {
    return { title: RED_FLAGS_COLUMNS.dailyTarget.placeholderNote };
  }
  if (key === 'goCheck') {
    return { title: RED_FLAGS_COLUMNS.goCheck.placeholderNote };
  }
  if (key === 'sendCredit') {
    return { title: RED_FLAGS_COLUMNS.sendCredit.placeholderNote };
  }
  if (key === 'vendsResolved') {
    const v = b.vendsResolved;
    return {
      title:
        v === 'green'
          ? 'Last vend fail today: remote credit within 5 minutes'
          : v === 'red'
            ? 'Last vend fail today: no remote credit within 5 minutes'
            : v === 'none'
              ? 'No failed vend recorded today (Kuwait calendar)'
              : RED_FLAGS_COLUMNS.vendsResolved.placeholderNote,
    };
  }
  if (key === 'testCredits') {
    return { title: RED_FLAGS_COLUMNS.testCredits.placeholderNote };
  }
  if (key === 'qaVisit') {
    return { title: RED_FLAGS_COLUMNS.qaVisit.placeholderNote };
  }
  if (key === 'techVisit') {
    return { title: RED_FLAGS_COLUMNS.techVisit.placeholderNote };
  }
  if (key === 'callOp') {
    return {
      title: RED_FLAGS_COLUMNS.callOp.placeholderNote,
      ...bindStopRowClick(),
    };
  }
  if (key === 'callAm') {
    return {
      title: RED_FLAGS_COLUMNS.callAm.placeholderNote,
      ...bindStopRowClick(),
    };
  }
  return {};
}

// Re-export for bundle builders in the page
export { buildFreqColumnContext };
