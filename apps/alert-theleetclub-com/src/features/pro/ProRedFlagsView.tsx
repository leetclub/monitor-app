import type { CompareSelection } from '@/components/ComparePresetPicker';
import { ProCompareChips } from '@/features/pro/ProCompareChips';
import type { DailySalesElapsedResponse } from '@/lib/salesDisplay';
import { formatKwd, formatSalesTrendPct, salesElapsedForMachine } from '@/lib/salesDisplay';
import {
  canOpenIncidentHistory,
  incidentsElapsedForMachine,
  resolveIncidentsRow,
  type DailyIncidentsElapsedResponse,
} from '@/lib/incidentsDisplay';
import { buildFreqColumnContext } from '@/lib/freqColumnContext';
import { cleaningWindowsFromAdmin, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { salesPairForPreset, type VendonPresetSalesRow } from '@/lib/presetComparison';
import type { RedAlertCompareMode } from '@/features/redflags/redAlertTypes';
import {
  freqSplit,
  getLiveOpsOperatorOnly,
  getMachineIdRaw,
  pickLastCleaningIso,
  pickLastTransactionTs,
  type RankedRedAlertRow,
} from '@/features/redflags/redFlagsModel';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import { bindStopRowClick } from '@/lib/stopRowClick';
import type { StitchKpi } from '@/components/StitchKpiStrip';
import {
  resolveLatestOperatorActivity,
  type OperatorActivityTimes,
} from '@/components/OperatorActivityCell';
import { formatRelativeAgo } from '@/lib/formatKuwait';
import './pro.css';

type CreditsMap = Record<
  string,
  {
    credits_sent?: number;
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

export function ProRedFlagsView({
  ranked,
  kpis,
  compare,
  onCompareChange,
  compareMode,
  salesNote,
  asOfLocal,
  generatedAt,
  fetching,
  loading,
  error,
  emptyClear,
  cleaningOverdueCount,
  onEnableNotifications,
  notifyNeedsPermission,
  dailySales,
  dailySalesOk,
  dailyIncidents,
  dailyIncidentsOk,
  creditsByMachineId,
  vendonByMachineId,
  vendonSalesLabels,
  liveCleaningByMachineId,
  operatorActivityByMachineId,
  fleetPrimaryKwd,
  fleetBaselineKwd,
  fleetTrendPct,
  snapTime,
  onRefresh,
  onOpenDetail,
  onOpenSales,
  onOpenTrend,
}: {
  ranked: RankedRedAlertRow[];
  kpis: StitchKpi[];
  compare: CompareSelection;
  onCompareChange: (next: CompareSelection) => void;
  compareMode: RedAlertCompareMode;
  salesNote: string;
  asOfLocal?: string | null;
  generatedAt?: string | null;
  fetching: boolean;
  loading: boolean;
  error: string | null;
  emptyClear: boolean;
  cleaningOverdueCount: number;
  onEnableNotifications?: () => void;
  notifyNeedsPermission?: boolean;
  dailySales?: DailySalesElapsedResponse;
  dailySalesOk: boolean;
  dailyIncidents?: DailyIncidentsElapsedResponse;
  dailyIncidentsOk: boolean;
  creditsByMachineId: CreditsMap;
  vendonByMachineId?: Record<string, VendonPresetSalesRow>;
  vendonSalesLabels?: { primary?: string; baseline?: string };
  liveCleaningByMachineId?: Record<string, string | null | undefined>;
  operatorActivityByMachineId?: Record<string, OperatorActivityTimes | null | undefined>;
  fleetPrimaryKwd?: number | null;
  fleetBaselineKwd?: number | null;
  fleetTrendPct?: number | null;
  snapTime?: string | null;
  onRefresh: () => void;
  onOpenDetail: (row: RankedRedAlertRow) => void;
  onOpenSales: (row: RankedRedAlertRow) => void;
  onOpenTrend: (row: RankedRedAlertRow) => void;
}) {
  return (
    <div className="proWorkspace">
      <div className="proPage">
        <header className="proPageHead">
          <div className="proPageTitleBlock">
            <p className="proPageEyebrow">Priority · iPad workspace</p>
            <h1 className="proPageTitle">Red Flags</h1>
            <p className="proPageMeta">
              {emptyClear
                ? 'All clear — no flagged machines'
                : `${ranked.length} machine${ranked.length === 1 ? '' : 's'} need attention`}
              {generatedAt ? ` · Snap ${generatedAt}` : ''}
              {fetching && ranked.length ? ' · updating' : ''}
            </p>
          </div>
          <div className="proPageActions">
            <span className="proLivePill">
              <span className="proLiveDot" aria-hidden />
              Live · ~1m
            </span>
            <button type="button" className="proBtn proBtnPrimary" onClick={onRefresh} disabled={fetching}>
              {fetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <div className="proKpiRow" role="group" aria-label="Key metrics">
          {kpis.map((k) => (
            <div key={k.label} className="proKpi">
              <span className="proKpiLabel">{k.label}</span>
              <span
                className={`proKpiValue${k.tone === 'warn' ? ' proKpiValueWarn' : ''}${k.tone === 'good' ? ' proKpiValueGood' : ''}`}
              >
                {k.value}
              </span>
              {k.sub ? <span className="proKpiSub">{k.sub}</span> : null}
            </div>
          ))}
        </div>

        <div className="proToolbar">
          <ProCompareChips value={compare} onChange={onCompareChange} />
          <p className="proToolbarNote">
            <strong>Sales</strong> — {salesNote}
            {asOfLocal ? ` · ${asOfLocal.replace('T', ' ')} KWT` : ''}
          </p>
        </div>

        {cleaningOverdueCount > 0 ? (
          <p className="proBanner proBannerWarn" role="status">
            Cleaning overdue on {cleaningOverdueCount} machine{cleaningOverdueCount === 1 ? '' : 's'}. Open a card for
            details.
            {notifyNeedsPermission && onEnableNotifications ? (
              <>
                {' '}
                <button type="button" className="proBtn proBtnGhost" onClick={onEnableNotifications}>
                  Enable alerts
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        {loading ? (
          <p className="proBanner proBannerInfo" role="status">
            Loading snapshot…
          </p>
        ) : null}
        {error ? (
          <p className="proBanner proBannerDanger" role="alert">
            {error}
          </p>
        ) : null}

        {emptyClear ? (
          <div className="proEmpty">
            <p className="proEmptyTitle">All clear</p>
            <p>No machines match Red Flags right now.</p>
          </div>
        ) : null}

        {ranked.length > 0 ? (
          <ul className="proCardList" aria-label="Flagged machines">
            {ranked.map((d, idx) => {
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
              const freqCtx = buildFreqColumnContext(row, compareMode, incidentsRow);
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
              const canTrend = canOpenIncidentHistory(incidentsRow, snapTrend);
              const opName = getLiveOpsOperatorOnly(row);
              const cleanIso = pickLastCleaningIso(row, liveCleaningByMachineId?.[machId]);
              const cleanStatus = cleanIso
                ? lastCleanedStatus({
                    lastCleaningIso: cleanIso,
                    cleaningWindows: cleaningWindowsFromAdmin(cred?.cleaning_windows),
                  })
                : null;
              const alertTypeText =
                row.reasons && row.reasons.length
                  ? String(row.reasons[row.reasons.length - 1] ?? '')
                      .replace(/\s+/g, ' ')
                      .trim()
                  : '—';
              const txIso = pickLastTransactionTs(row, snapTime);
              const lastTx = txIso ? formatLastTxCompact(txIso) : '—';
              const latestOp = resolveLatestOperatorActivity(
                operatorActivityByMachineId?.[machId],
                row.operatorLastAccessAt,
              );
              const salesTone =
                salesPair.trendPct != null && Number.isFinite(salesPair.trendPct)
                  ? salesPair.trendPct >= 0
                    ? 'up'
                    : 'down'
                  : null;
              const cleaningOverdue = !!row.cleaningOverdue15h;
              const cardTone = cleaningOverdue ? 'proCardDanger' : d.isNew ? 'proCardWarn' : '';

              return (
                <li key={machId || `pro-${idx}`}>
                  <article className={`proCard ${cardTone}`.trim()}>
                    <button type="button" className="proCardMain" onClick={() => onOpenDetail(d)}>
                      <div className="proCardTop">
                        <div>
                          <h2 className="proCardName">{row.machineName || machId}</h2>
                          <p className="proCardId">#{machId}</p>
                        </div>
                        <div className="proChips">
                          {d.isNew ? <span className="proChip proChipNew">New</span> : null}
                          {d.isChanged && !d.isNew ? <span className="proChip proChipUpd">Updated</span> : null}
                          {cleaningOverdue ? <span className="proChip proChipNew">Clean overdue</span> : null}
                        </div>
                      </div>
                      <p className="proCardReason">{alertTypeText}</p>
                    </button>

                    <div className="proMetricGrid">
                      <div className="proMetric">
                        <span className="proMetricLabel">Sales</span>
                        <span
                          className={`proMetricValue${salesTone === 'up' ? ' proMetricValueUp' : ''}${salesTone === 'down' ? ' proMetricValueDown' : ''}`}
                        >
                          {salesPair.primary != null && Number.isFinite(salesPair.primary)
                            ? formatKwd(salesPair.primary)
                            : '—'}
                        </span>
                        <span className="proMetricHint">
                          {salesPair.trendPct != null && Number.isFinite(salesPair.trendPct)
                            ? formatSalesTrendPct(salesPair.trendPct)
                            : salesPair.caption || 'vs compare'}
                        </span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Frequency</span>
                        <span className="proMetricValue">
                          {fq.top != null ? String(fq.top) : '—'}
                          {fq.bottom != null ? ` / ${fq.bottom}` : ''}
                        </span>
                        <span className="proMetricHint">{freqCtx.trendText || 'incidents'}</span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Op. activity</span>
                        <span className="proMetricValue">
                          {latestOp ? latestOp.kindShort : '—'}
                        </span>
                        <span className="proMetricHint">
                          {latestOp
                            ? `${formatRelativeAgo(latestOp.iso) || formatLastTxCompact(latestOp.iso)} · ${opName || '—'}`
                            : `Operator: ${opName || '—'}`}
                        </span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Last clean</span>
                        <span className="proMetricValue">{cleanStatus?.label || '—'}</span>
                        <span className="proMetricHint">
                          {cleanIso ? formatLastTxCompact(cleanIso) : lastTx !== '—' ? `TX ${lastTx}` : 'No recent clean'}
                        </span>
                      </div>
                    </div>

                    <div className="proCardFoot">
                      <button type="button" className="proBtn" {...bindStopRowClick(() => onOpenSales(d))}>
                        Sales history
                      </button>
                      <button
                        type="button"
                        className="proBtn"
                        disabled={!canTrend}
                        {...bindStopRowClick(() => {
                          if (canTrend) onOpenTrend(d);
                        })}
                      >
                        Trend
                      </button>
                      <button type="button" className="proBtn proBtnPrimary" onClick={() => onOpenDetail(d)}>
                        Open details
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}

        {ranked.length > 0 && (fleetPrimaryKwd != null || fleetBaselineKwd != null) ? (
          <div className="proFleetBar" aria-label="Fleet sales">
            <div>
              <div className="proFleetBarLabel">Fleet sales</div>
              <div className="proFleetBarVal">
                {fleetPrimaryKwd != null && Number.isFinite(fleetPrimaryKwd) ? formatKwd(fleetPrimaryKwd) : '—'}
              </div>
            </div>
            <div>
              <div className="proFleetBarLabel">Compare</div>
              <div className="proFleetBarVal">
                {fleetBaselineKwd != null && Number.isFinite(fleetBaselineKwd) ? formatKwd(fleetBaselineKwd) : '—'}
              </div>
            </div>
            <div>
              <div className="proFleetBarLabel">Trend</div>
              <div className="proFleetBarVal">
                {fleetTrendPct != null && Number.isFinite(fleetTrendPct) ? formatSalesTrendPct(fleetTrendPct) : '—'}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
