import type { DailySalesElapsedResponse, SalesElapsedRow } from '@/lib/salesDisplay';
import { canOpenSalesHistory, salesElapsedForMachine } from '@/lib/salesDisplay';
import { SalesElapsedStack } from '@/components/SalesElapsedStack';
import { salesPairForPreset, type VendonPresetSalesRow } from '@/lib/presetComparison';
import {
  canOpenIncidentHistory,
  incidentsElapsedForMachine,
  resolveIncidentsRow,
  type DailyIncidentsElapsedResponse,
  type IncidentsElapsedRow,
} from '@/lib/incidentsDisplay';
import { buildFreqColumnContext } from '@/lib/freqColumnContext';
import { cleaningWindowsFromAdmin, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { RedAlertCompareMode } from './redAlertTypes';
import {
  freqBoxVisuals,
  freqSplit,
  getMachineIdRaw,
  getLiveOpsOperatorOnly,
  getStrikeOperatorEmail,
  pickLastCleaningIso,
  rowHappensForSort,
  type RankedRedAlertRow,
} from './redFlagsModel';
import { CallAmCell } from '@/components/CallAmCell';
import { CallOpCell } from '@/components/CallOpCell';
import { OperatorCell } from '@/components/OperatorCell';
import { OperatorActivityCell } from '@/components/OperatorActivityCell';
import { bindStopRowClick } from '@/lib/stopRowClick';
import tableStyles from './RedFlagsBoard.module.css';
import cardStyles from './RedFlagsCardList.module.css';

type CreditsMap = Record<
  string,
  {
    credits_sent?: number;
    dispense_tests?: number;
    vends_resolved?: string;
    cleaning_windows?: unknown;
  }
>;

type SnapTrend = {
  happensWeek?: number | null;
  happenedLastWeekAlignedSlice?: number | null;
  happenedLastWeek?: number | null;
  happenedPctVsPriorWeek?: number | null;
  happensToday?: number | null;
  happenedSameDayLastWeek?: number | null;
  happenedPctVsSameDayLastWeek?: number | null;
  happenedYesterdaySameElapsed?: number | null;
  happenedPctVsYesterdaySameElapsed?: number | null;
};

function sendCreditTone(n: number): string {
  if (!Number.isFinite(n)) return tableStyles.metricUnknown;
  if (n <= 5) return tableStyles.metricGood;
  if (n <= 10) return tableStyles.metricWarn;
  return tableStyles.metricBad;
}

function vendsTone(status: string | undefined): string {
  if (status === 'green' || status === 'none') return tableStyles.metricGood;
  if (status === 'red') return tableStyles.metricBad;
  return tableStyles.metricUnknown;
}

function vendsLabel(status: string | undefined): string {
  if (status === 'green') return '≤5 min';
  if (status === 'red') return '>5 min';
  if (status === 'none') return 'No fail';
  return '—';
}

export function RedFlagsCardList({
  ranked,
  compare,
  compareMode,
  dailySales,
  dailySalesOk,
  dailyIncidents,
  dailyIncidentsOk,
  creditsByMachineId,
  vendonByMachineId,
  vendonSalesLabels,
  workflowByMachineId,
  workflowConfigured,
  workflowLoaded,
  liveCleaningByMachineId,
  operatorActivityByMachineId,
  onOpenDetail,
  onOpenSales,
  onOpenTrend,
  slackEmailMap,
  slackTeamId,
}: {
  ranked: RankedRedAlertRow[];
  compare: CompareSelection;
  compareMode: RedAlertCompareMode;
  dailySales?: DailySalesElapsedResponse;
  dailySalesOk: boolean;
  dailyIncidents?: DailyIncidentsElapsedResponse;
  dailyIncidentsOk: boolean;
  creditsByMachineId: CreditsMap;
  vendonByMachineId?: Record<string, VendonPresetSalesRow>;
  vendonSalesLabels?: { primary?: string; baseline?: string };
  workflowByMachineId?: Record<string, import('@/lib/leetWorkflowApi').MachineAttendanceSummary>;
  workflowConfigured?: boolean;
  workflowLoaded?: boolean;
  liveCleaningByMachineId?: Record<string, string | null | undefined>;
  operatorActivityByMachineId?: Record<
    string,
    import('@/components/OperatorActivityCell').OperatorActivityTimes
  >;
  onOpenDetail: (row: RankedRedAlertRow) => void;
  onOpenSales: (
    machineName: string,
    machineId: string,
    row: SalesElapsedRow,
    strikeEmail: string | null | undefined,
    opName: string,
  ) => void;
  onOpenTrend: (
    machineName: string,
    machineId: string,
    row: IncidentsElapsedRow,
    snapTrend: SnapTrend,
    freqCtx: ReturnType<typeof buildFreqColumnContext>,
    strikeEmail: string | null | undefined,
    opName: string,
  ) => void;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
}) {
  return (
    <ul className={cardStyles.list} aria-label="Red Flags machines">
      {ranked.map((d, r) => {
        const row = d.row;
        const machId = String(getMachineIdRaw(row) || '');
        const cred = machId ? creditsByMachineId[machId] : undefined;
        const sales = salesElapsedForMachine(dailySales, machId, dailySalesOk);
        const vendonSales = vendonByMachineId?.[machId];
        const salesPair = salesPairForPreset(compare.preset, sales, compare, vendonSales, vendonSalesLabels);
        const incidentsRow = resolveIncidentsRow(
          row,
          incidentsElapsedForMachine(dailyIncidents, machId, dailyIncidentsOk),
        );
        const fq = freqSplit(row, compareMode, incidentsRow);
        const freqVisual = freqBoxVisuals(row, compareMode, incidentsRow);
        const pri = row.alertPriorityTier != null ? Number(row.alertPriorityTier) : 1;
        const p2 = pri === 2 || !!row.duringScheduledCleaningNow;
        const cleaningOverdue = !!row.cleaningOverdue15h;
        const hwN = rowHappensForSort(row, compareMode, incidentsRow);
        const hot = hwN >= 10;
        const alertTypeText =
          row.reasons && row.reasons.length
            ? String(row.reasons[row.reasons.length - 1] ?? '')
                .replace(/\s+/g, ' ')
                .trim()
            : '—';
        const strikeEmail = getStrikeOperatorEmail(row);
        let goUrl = row.goCheckUrl || null;
        if (!goUrl && strikeEmail) {
          goUrl = `mailto:${strikeEmail}?subject=${encodeURIComponent(`Red Flags — GO CHECK: ${row.machineName || machId}`)}`;
        }
        const snapTrend: SnapTrend = {
          happensWeek: row.happensWeek,
          happenedLastWeekAlignedSlice: row.happenedLastWeekAlignedSlice,
          happenedLastWeek: row.happenedLastWeek,
          happenedPctVsPriorWeek: row.happenedPctVsPriorWeek,
          happensToday: row.happensToday ?? row.frequency?.totalCriteriaHitsToday,
          happenedSameDayLastWeek: row.happenedSameDayLastWeek,
          happenedPctVsSameDayLastWeek: row.happenedPctVsSameDayLastWeek,
          happenedYesterdaySameElapsed: row.happenedYesterdaySameElapsed,
          happenedPctVsYesterdaySameElapsed: row.happenedPctVsYesterdaySameElapsed,
        };
        const freqCtx = buildFreqColumnContext(row, compareMode, incidentsRow);
        const canOpenTrend = canOpenIncidentHistory(incidentsRow, snapTrend);
        const opName = getLiveOpsOperatorOnly(row);
        const cleanIso = pickLastCleaningIso(row, liveCleaningByMachineId?.[machId]);
        const cleanStatus = cleanIso
          ? lastCleanedStatus({ lastCleaningIso: cleanIso, cleaningWindows: cleaningWindowsFromAdmin(cred?.cleaning_windows) })
          : null;
        const creditsN = cred?.credits_sent != null ? Number(cred.credits_sent) : NaN;

        return (
          <li key={machId || `card-${r}`}>
            <div
              className={`${cardStyles.card} ${d.isNew ? cardStyles.cardNew : ''} ${d.isChanged ? cardStyles.cardUpdated : ''} ${hot ? cardStyles.cardHot : ''} ${cleaningOverdue ? cardStyles.cardCleaningOverdue : ''}`}
            >
              <button type="button" className={cardStyles.cardMainTap} onClick={() => onOpenDetail(d)}>
                <div className={cardStyles.cardHead}>
                  <div>
                    <div className={cardStyles.machineName}>{row.machineName || machId}</div>
                    <div className={cardStyles.machineId}>#{machId}</div>
                  </div>
                  <div className={cardStyles.cardChips}>
                    {d.isNew ? <span className={`${cardStyles.chip} ${cardStyles.chipNew}`}>New</span> : null}
                    {d.isChanged && !d.isNew ? (
                      <span className={`${cardStyles.chip} ${cardStyles.chipUpd}`}>Updated</span>
                    ) : null}
                    {p2 ? <span className={`${cardStyles.chip} ${cardStyles.chipP2}`}>Cleaning</span> : null}
                  </div>
                </div>

                <p className={cardStyles.alertLead}>{alertTypeText}</p>

                <div className={cardStyles.metricRow}>
                  <div className={cardStyles.metric}>
                    <span className={cardStyles.metricLabel}>Credits</span>
                    <span
                      className={`${cardStyles.metricVal} ${Number.isFinite(creditsN) ? sendCreditTone(creditsN) : ''}`}
                    >
                      {Number.isFinite(creditsN) ? String(creditsN) : '—'}
                    </span>
                  </div>
                  <div className={cardStyles.metric}>
                    <span className={cardStyles.metricLabel}>Vends resolved</span>
                    <span
                      className={`${cardStyles.metricVal} ${vendsTone(cred?.vends_resolved != null ? String(cred.vends_resolved) : undefined)}`}
                    >
                      {cred?.vends_resolved ? vendsLabel(String(cred.vends_resolved)) : '—'}
                    </span>
                  </div>
                </div>
              </button>

              <div className={cardStyles.operatorBlock}>
                <span className={cardStyles.metricLabel}>Operator</span>
                <OperatorCell
                  row={row}
                  machineLabel={String(row.machineName || machId)}
                  attendanceSummary={workflowByMachineId?.[machId]}
                  workflowConfigured={workflowConfigured}
                  workflowLoaded={workflowLoaded}
                />
              </div>

              <div className={cardStyles.operatorBlock}>
                <span className={cardStyles.metricLabel}>Last activity</span>
                <OperatorActivityCell
                  activity={operatorActivityByMachineId?.[machId]}
                  legacyWebAccessAt={row.operatorLastAccessAt}
                />
              </div>

              <div className={cardStyles.operatorBlock}>
                <span className={cardStyles.metricLabel}>Call OP</span>
                <CallOpCell
                  row={row}
                  machineLabel={String(row.machineName || machId)}
                  slackEmailMap={slackEmailMap}
                  slackTeamId={slackTeamId}
                  attendanceSummary={workflowByMachineId?.[machId]}
                  workflowConfigured={workflowConfigured}
                  workflowLoaded={workflowLoaded}
                />
              </div>

              <div className={cardStyles.operatorBlock}>
                <span className={cardStyles.metricLabel}>Call AM</span>
                <CallAmCell
                  machineName={String(row.machineName || machId)}
                  machineLabel={String(row.machineName || machId)}
                  slackEmailMap={slackEmailMap}
                  slackTeamId={slackTeamId}
                />
              </div>

              <div className={cardStyles.cardInteractive}>
                <div className={cardStyles.salesBlock}>
                  <span className={cardStyles.metricLabel}>Sales</span>
                  <SalesElapsedStack
                    row={sales}
                    pair={salesPair}
                    title={salesPair.caption}
                    interactive={
                      canOpenSalesHistory(sales) ||
                      (salesPair.primary != null && Number.isFinite(salesPair.primary))
                    }
                    onOpenDetail={() => {
                      const salesForModal =
                        sales ??
                        (salesPair.primary != null && Number.isFinite(salesPair.primary)
                          ? {
                              todayKwd: salesPair.primary,
                              dailyElapsed: [],
                              trendPct: salesPair.trendPct ?? null,
                            }
                          : null);
                      if (!salesForModal) return;
                      onOpenSales(
                        String(row.machineName || machId),
                        machId,
                        salesForModal as SalesElapsedRow,
                        strikeEmail,
                        opName,
                      );
                    }}
                  />
                </div>

                <div className={cardStyles.freqRow}>
                  {canOpenTrend ? (
                    <button
                      type="button"
                      className={`${cardStyles.freqPill} ${cardStyles.freqPillBtn}`}
                      {...bindStopRowClick(() =>
                        onOpenTrend(
                          String(row.machineName || machId),
                          machId,
                          incidentsRow ?? { todayHits: 0, yesterdaySameElapsedHits: 0, trendPct: null },
                          snapTrend,
                          freqCtx,
                          strikeEmail,
                          opName,
                        ),
                      )}
                    >
                      <span className={cardStyles.freqPillLabel}>Score</span>
                      <span className={cardStyles.freqPillVal}>{fq.top}</span>
                    </button>
                  ) : (
                    <div className={cardStyles.freqPill}>
                      <span className={cardStyles.freqPillLabel}>Score</span>
                      <span className={cardStyles.freqPillVal}>{fq.top}</span>
                    </div>
                  )}
                  {canOpenTrend ? (
                    <button
                      type="button"
                      className={`${cardStyles.freqPill} ${cardStyles.freqPillBtn} ${
                        freqVisual.trend.tone === 'good'
                          ? cardStyles.freqPillGood
                          : freqVisual.trend.tone === 'bad'
                            ? cardStyles.freqPillBad
                            : ''
                      }`}
                      {...bindStopRowClick(() =>
                        onOpenTrend(
                          String(row.machineName || machId),
                          machId,
                          incidentsRow ?? { todayHits: 0, yesterdaySameElapsedHits: 0, trendPct: null },
                          snapTrend,
                          freqCtx,
                          strikeEmail,
                          opName,
                        ),
                      )}
                    >
                      <span className={cardStyles.freqPillLabel}>Trend</span>
                      <span className={cardStyles.freqPillVal}>{fq.bottom}</span>
                    </button>
                  ) : (
                    <div className={cardStyles.freqPill}>
                      <span className={cardStyles.freqPillLabel}>Trend</span>
                      <span className={cardStyles.freqPillVal}>{fq.bottom}</span>
                    </div>
                  )}
                  {canOpenTrend ? (
                    <button
                      type="button"
                      className={`${cardStyles.freqPill} ${cardStyles.freqPillBtn}`}
                      {...bindStopRowClick(() =>
                        onOpenTrend(
                          String(row.machineName || machId),
                          machId,
                          incidentsRow ?? { todayHits: 0, yesterdaySameElapsedHits: 0, trendPct: null },
                          snapTrend,
                          freqCtx,
                          strikeEmail,
                          opName,
                        ),
                      )}
                    >
                      <span className={cardStyles.freqPillLabel}>Gap</span>
                      <span className={cardStyles.freqPillVal}>
                        {compareMode === 'week' ? fq.top : fq.bottom}
                      </span>
                    </button>
                  ) : (
                    <div className={cardStyles.freqPill}>
                      <span className={cardStyles.freqPillLabel}>Gap</span>
                      <span className={cardStyles.freqPillVal}>
                        {compareMode === 'week' ? fq.top : fq.bottom}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {cleanStatus ? (
                <div className={cardStyles.metric} style={{ margin: '0 14px 8px' }}>
                  <span className={cardStyles.metricLabel}>Last cleaning</span>
                  <span className={cardStyles.metricVal}>{cleanStatus.label}</span>
                </div>
              ) : null}

              <div className={cardStyles.cardFoot}>
                <button type="button" className={cardStyles.detailBtn} onClick={() => onOpenDetail(d)}>
                  Full detail
                </button>
                {goUrl ? (
                  <a
                    href={goUrl}
                    className={cardStyles.goBtn}
                    {...(goUrl.toLowerCase().startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  >
                    GO CHECK
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
