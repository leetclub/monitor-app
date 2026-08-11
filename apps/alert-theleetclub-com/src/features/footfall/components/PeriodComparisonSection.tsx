import type { LocationReport } from '@/features/footfall/lib/types';
import { alignedDayRows } from '@/features/footfall/lib/daysBreakdown';
import { hasDailyPeriodCompare } from '@/features/footfall/lib/periodCompareDays';
import { ComparePeriodKpis } from '@/features/footfall/components/ComparePeriodKpis';
import { DailyPeriodCompareChart, PeriodCompareChart } from '@/features/footfall/components/ComparisonCharts';

type Props = {
  location: LocationReport;
  showPeriodCompare: boolean;
};

export function PeriodComparisonSection({ location, showPeriodCompare }: Props) {
  if (!showPeriodCompare) {
    return (
      <section className="periodCompareSection periodCompareSectionOff">
        <h3 className="sectionTitle">Period comparison (daily &amp; hourly)</h3>
        <p className="hint chartHint">
          Use the <strong>Compare</strong> bar at the bottom of the page (or date filters above): pick a week, drag a
          chip, or click <strong>−1 wk</strong>.
        </p>
        <ul className="periodCompareList">
          <li>
            <strong>Day-by-day</strong> — primary week vs compare week (Sun–Thu aligned)
          </li>
          <li>
            <strong>Hour-by-hour</strong> — same hours, both weeks
          </li>
        </ul>
      </section>
    );
  }

  const hasDaily = hasDailyPeriodCompare(location);
  const hasHourly = Boolean(location.compareHours?.length && location.comparePeriodDates?.length);
  const compareDayRows = alignedDayRows(location.compareDaysBreakdown ?? undefined).length;
  const primaryDayRows = alignedDayRows(location.daysBreakdown).length;

  return (
    <section className="periodCompareSection">
      <h3 className="sectionTitle">Period comparison (daily &amp; hourly)</h3>
      <p className="hint chartHint">
        Comparing <strong>{location.periodDates[0]}–{location.periodDates.at(-1)}</strong> vs{' '}
        <strong>{location.comparePeriodDates?.[0]}–{location.comparePeriodDates?.at(-1)}</strong>
      </p>

      <ComparePeriodKpis location={location} />

      {!hasDaily && hasHourly ? (
        <p className="hint chartHint chartHintWarn">
          Daily comparison is not in this cached report yet — click <strong>Rebuild report</strong> after enabling
          compare. Hourly comparison below is still available.
        </p>
      ) : null}

      {hasDaily ? (
        <>
          <h4 className="subsectionTitle">Daily — primary vs compare week</h4>
          <DailyPeriodCompareChart location={location} />
        </>
      ) : primaryDayRows === 0 && compareDayRows === 0 ? (
        <p className="hint">No aligned daily rows for this location (split sales/camera weeks — see tables below).</p>
      ) : null}

      {hasHourly ? (
        <>
          <h4 className="subsectionTitle">Hourly — primary vs compare week</h4>
          <PeriodCompareChart location={location} />
        </>
      ) : (
        <p className="hint">No hourly compare data for this location.</p>
      )}
    </section>
  );
}
