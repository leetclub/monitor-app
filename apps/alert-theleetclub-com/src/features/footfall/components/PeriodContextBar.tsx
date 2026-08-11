import type { ReportQuery } from '@/features/footfall/lib/types';
import { describeAppliedPeriod } from '@/features/footfall/lib/periodContext';

type Props = {
  appliedQuery: ReportQuery;
  locationName?: string | null;
  loading?: boolean;
  draftHint?: string | null;
};

/** Sticky strip so presenters always see which week(s) are loaded. */
export function PeriodContextBar({ appliedQuery, locationName, loading, draftHint }: Props) {
  const { primary, compare, headline } = describeAppliedPeriod(appliedQuery);

  return (
    <div className="periodContextBar" role="status" aria-live="polite">
      <div className="periodContextInner">
        <span className="periodContextTag">Viewing</span>
        <span className="periodContextPrimary">{primary}</span>
        {compare ? (
          <>
            <span className="periodContextVs">vs</span>
            <span className="periodContextCompare">{compare}</span>
          </>
        ) : null}
        {locationName ? (
          <>
            <span className="periodContextSep">·</span>
            <span className="periodContextLocation">{locationName}</span>
          </>
        ) : null}
        {loading ? (
          <>
            <span className="periodContextSep">·</span>
            <span className="periodContextLoading">Loading…</span>
          </>
        ) : null}
        {draftHint ? (
          <>
            <span className="periodContextSep">·</span>
            <span className="periodContextDraft">{draftHint}</span>
          </>
        ) : null}
      </div>
      <span className="periodContextSub" title={headline}>
        Sun–Thu business weeks · {appliedQuery.startDate} → {appliedQuery.endDate}
        {compare && appliedQuery.compareStartDate && appliedQuery.compareEndDate
          ? ` · compare ${appliedQuery.compareStartDate} → ${appliedQuery.compareEndDate}`
          : ''}
      </span>
    </div>
  );
}
