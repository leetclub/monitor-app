import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { OperatorContactSection } from '@/components/OperatorContactSection';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { useSlackUserMap } from '@/lib/useSlackUserMap';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import {
  formatKwd,
  formatSalesDayLabel,
  formatSalesTrendPct,
  salesComparisonCaption,
  salesComparisonDetail,
  todayVsPriorDayComparisons,
  type DailySalesElapsedResponse,
  type SalesElapsedRow,
} from '@/lib/salesDisplay';

export function SalesHistoryModal({
  machineName,
  machineId,
  row,
  meta,
  operatorName,
  strikeOperatorEmail,
  attendanceSummary,
  onClose,
}: {
  machineName: string;
  machineId: string;
  row: SalesElapsedRow;
  meta?: DailySalesElapsedResponse;
  operatorName?: string | null;
  strikeOperatorEmail?: string | null;
  attendanceSummary?: MachineAttendanceSummary;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  const slackMapQ = useSlackUserMap();
  const slackContact = useMemo(() => {
    const env = getAlertRuntimeEnv();
    return {
      map: slackMapQ.data?.map ?? {},
      team: (slackMapQ.data?.teamId || env.SLACK_TEAM_ID || '').trim(),
    };
  }, [slackMapQ.data]);

  const { todayKwd, todayDate, comparisons } = todayVsPriorDayComparisons(row, meta);
  const asOf = meta?.asOfLocal;
  const salesNote =
    meta?.comparisonNote ||
    'Sales through the same Kuwait elapsed clock window each day (not full calendar-day totals).';

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sales-history-title"
      {...backdrop}
    >
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Today vs prior days · same clock</p>
            <h2 id="sales-history-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="historyModalContact">
          <h3 className="historyModalSectionTitle">Contact operator</h3>
          <OperatorContactSection
            layout="modal"
            operatorName={operatorName}
            strikeOperatorEmail={strikeOperatorEmail}
            machineId={machineId}
            machineLabel={machineName || machineId}
            slackEmailMap={slackContact.map}
            slackTeamId={slackContact.team}
            attendanceSummary={attendanceSummary}
          />
        </section>

        <p className="salesHistoryNote">{salesComparisonCaption(asOf)}</p>
        <p className="historyModalNoteMuted">{salesNote}</p>

        <div className="salesHistoryTodayHero">
          <div>
            <span className="salesHistoryTodayLabel">Today</span>
            {todayDate ? (
              <span className="salesHistoryTodayDate">{formatSalesDayLabel(todayDate, 'Today')}</span>
            ) : null}
          </div>
          <span className="salesHistoryTodayVal">{formatKwd(todayKwd)}</span>
        </div>

        {comparisons.length ? (
          <ul className="salesHistoryList">
            {comparisons.map((c) => {
              const up = c.trendPct != null && c.trendPct >= 0;
              const down = c.trendPct != null && c.trendPct < 0;
              const detail = salesComparisonDetail(todayKwd, c.priorKwd, c.trendPct, c.compareLabel);
              return (
                <li
                  key={c.date}
                  className={`salesHistoryRow ${up ? 'salesHistoryRowUp' : down ? 'salesHistoryRowDown' : ''}`.trim()}
                >
                  <div className="salesHistoryCompareHead">
                    <span className="salesHistoryCompareTitle">
                      Today vs {formatSalesDayLabel(c.date, c.weekday)}
                    </span>
                    <span className="salesHistoryCompareSub">{c.compareLabel}</span>
                  </div>
                  <p className="historyModalRowExplain">{detail}</p>
                  <div className="salesHistoryCompareGrid">
                    <div>
                      <span className="salesHistoryGridLabel">That day (same time)</span>
                      <span className="salesHistoryGridVal">
                        {c.priorKwd != null ? formatKwd(c.priorKwd) : '—'}
                        {c.incomplete && c.priorKwd != null ? (
                          <span className="salesHistoryGridHint" title="Partial data — Vendon row cap reached">
                            {' '}
                            *
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div>
                      <span className="salesHistoryGridLabel">Today</span>
                      <span className="salesHistoryGridVal">{formatKwd(todayKwd)}</span>
                    </div>
                    <div>
                      <span className="salesHistoryGridLabel">Trend</span>
                      {c.trendPct != null && Number.isFinite(c.trendPct) ? (
                        <span
                          className={`salesHistoryGridTrend ${c.trendPct >= 0 ? 'alertSalesUp' : 'alertSalesDown'}`}
                        >
                          {formatSalesTrendPct(c.trendPct)}
                        </span>
                      ) : (
                        <span className="salesHistoryGridTrend salesHistoryRowTrendMuted">—</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <AlertModalAnticipate hint="Prior-day comparisons incoming" lines={3} />
        )}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
