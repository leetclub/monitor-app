import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { RedAlertCompareMode } from '@/features/redflags/redAlertTypes';
import { OperatorContactSection } from '@/components/OperatorContactSection';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { TrendBreakdownPanel } from '@/components/TrendBreakdownPanel';
import { trendModalLegend } from '@/lib/freqColumnContext';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import {
  trendHistoryComparisons,
  type DailyIncidentsElapsedResponse,
  type IncidentSnapTrend,
  type IncidentsElapsedRow,
} from '@/lib/incidentsDisplay';
import { useSlackUserMap } from '@/lib/useSlackUserMap';
import type { MachineAttendanceSummary } from '@/lib/leetWorkflowApi';

export function TrendHistoryModal({
  machineName,
  machineId,
  row,
  meta,
  compareMode,
  snapTrend,
  scoreText = '—',
  trendText = '—',
  gapDisplay = '—',
  scoreExplain = '',
  trendExplain = '',
  gapExplain = '',
  operatorName,
  strikeOperatorEmail,
  attendanceSummary,
  onClose,
}: {
  machineName: string;
  machineId: string;
  row: IncidentsElapsedRow | undefined;
  meta?: DailyIncidentsElapsedResponse;
  compareMode: RedAlertCompareMode;
  snapTrend?: IncidentSnapTrend;
  scoreText?: string;
  trendText?: string;
  gapDisplay?: string;
  scoreExplain?: string;
  trendExplain?: string;
  gapExplain?: string;
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

  const { heroLabel, heroValue, heroDate, heroSub, comparisons } = trendHistoryComparisons(
    row,
    meta,
    compareMode,
    snapTrend,
  );
  const modalEyebrow =
    compareMode === 'week'
      ? 'WTD vs baselines · combined incidents'
      : compareMode === 'sameWeekdayLw'
        ? 'Today vs same weekday · same clock'
        : compareMode === 'yesterdayVsDayBefore'
          ? 'Yesterday vs day before · full days'
          : 'Today vs prior days · same clock';
  const legend = trendModalLegend(compareMode);

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trend-history-title"
      {...backdrop}
    >
      <div className="salesHistoryModal trendHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">{modalEyebrow}</p>
            <h2 id="trend-history-title" className="salesHistoryTitle">
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

        <TrendBreakdownPanel
          compareMode={compareMode}
          scoreText={scoreText}
          trendText={trendText}
          gapDisplay={gapDisplay}
          scoreExplain={scoreExplain}
          trendExplain={trendExplain}
          gapExplain={gapExplain}
          heroLabel={heroLabel}
          heroValue={heroValue}
          heroDate={heroDate}
          heroSub={heroSub}
          comparisons={comparisons}
          asOfLocal={meta?.asOfLocal}
          comparisonNote={meta?.comparisonNote}
        />
        <p className="historyModalNoteMuted">{legend}</p>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
