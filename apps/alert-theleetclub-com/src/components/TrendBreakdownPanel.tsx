import {
  formatIncidentHits,
  formatIncidentTrendPct,
  incidentComparisonDetail,
  incidentsComparisonCaption,
  type TodayVsDayIncidentComparison,
} from '@/lib/incidentsDisplay';
import { formatSalesDayLabel } from '@/lib/salesDisplay';
import { trendModalLegend } from '@/lib/freqColumnContext';
import type { RedAlertCompareMode } from '@/features/redflags/redAlertTypes';
import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';

export function TrendBreakdownPanel({
  compareMode,
  scoreText,
  trendText,
  gapDisplay,
  scoreExplain,
  trendExplain,
  gapExplain,
  heroLabel,
  heroValue,
  heroDate,
  heroSub,
  comparisons,
  asOfLocal,
  comparisonNote,
}: {
  compareMode: RedAlertCompareMode;
  scoreText: string;
  trendText: string;
  gapDisplay: string;
  scoreExplain: string;
  trendExplain: string;
  gapExplain: string;
  heroLabel: string;
  heroValue: number;
  heroDate?: string;
  heroSub?: string;
  comparisons: TodayVsDayIncidentComparison[];
  asOfLocal?: string | null;
  comparisonNote?: string | null;
}) {
  return (
    <section className="trendBreakdownPanel">
      <h3 className="historyModalSectionTitle">Trend breakdown</h3>
      <div className="trendBreakdownGrid">
        <div className="trendBreakdownSlot" title={scoreExplain}>
          <span className="trendBreakdownLabel">Score</span>
          <span className="trendBreakdownVal">{scoreText}</span>
        </div>
        <div className="trendBreakdownSlot" title={trendExplain}>
          <span className="trendBreakdownLabel">Trend</span>
          <span className="trendBreakdownVal">{trendText}</span>
        </div>
        <div className="trendBreakdownSlot" title={gapExplain}>
          <span className="trendBreakdownLabel">Gap</span>
          <span className="trendBreakdownVal">{gapDisplay}</span>
        </div>
      </div>

      <p className="salesHistoryNote">{incidentsComparisonCaption(asOfLocal)}</p>
      {comparisonNote ? <p className="historyModalNoteMuted">{comparisonNote}</p> : null}
      <p className="historyModalNoteMuted">{trendModalLegend(compareMode)}</p>

      <div className="salesHistoryTodayHero">
        <div>
          <span className="salesHistoryTodayLabel">{heroLabel}</span>
          {heroDate ? (
            <span className="salesHistoryTodayDate">{formatSalesDayLabel(heroDate, heroLabel)}</span>
          ) : null}
          {heroSub ? <span className="salesHistoryTodayDate">{heroSub}</span> : null}
        </div>
        <span className="salesHistoryTodayVal">{formatIncidentHits(heroValue)}</span>
      </div>

      {comparisons.length ? (
        <ul className="salesHistoryList">
          {comparisons.map((c, i) => {
            const up = c.trendPct != null && c.trendPct >= 0;
            const down = c.trendPct != null && c.trendPct < 0;
            const detail = incidentComparisonDetail(
              heroValue,
              c.priorHits,
              c.trendPct,
              c.compareLabel,
              compareMode,
            );
            return (
              <li
                key={`${c.date}-${i}`}
                className={`salesHistoryRow ${up ? 'salesHistoryRowUp' : down ? 'salesHistoryRowDown' : ''}`.trim()}
              >
                <div className="salesHistoryCompareHead">
                  <span className="salesHistoryCompareTitle">{c.title}</span>
                  <span className="salesHistoryCompareSub">{c.compareLabel}</span>
                </div>
                <p className="historyModalRowExplain">{detail}</p>
                <div className="salesHistoryCompareGrid">
                  <div>
                    <span className="salesHistoryGridLabel">Baseline</span>
                    <span className="salesHistoryGridVal">{formatIncidentHits(c.priorHits)}</span>
                  </div>
                  <div>
                    <span className="salesHistoryGridLabel">{heroLabel}</span>
                    <span className="salesHistoryGridVal">{formatIncidentHits(heroValue)}</span>
                  </div>
                  <div>
                    <span className="salesHistoryGridLabel">Trend</span>
                    {c.trendPct != null && Number.isFinite(c.trendPct) ? (
                      <span
                        className={`salesHistoryGridTrend ${c.trendPct >= 0 ? 'alertSalesUp' : 'alertSalesDown'}`}
                      >
                        {formatIncidentTrendPct(c.trendPct)}
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
        <AlertModalAnticipate hint="Prior-day incident history incoming" lines={3} />
      )}
    </section>
  );
}
