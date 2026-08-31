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
        <h3 className="sectionTitle">Period comparison (Period vs Compare)</h3>
        <p className="hint chartHint">
          Comparison data is still loading or missing for this location. Confirm the{' '}
          <strong>Period</strong> and <strong>Compare</strong> dates in the bar above, then wait for
          the report to finish (or Retry).
        </p>
        <ul className="periodCompareList">
          <li>
            <strong>Totals table</strong> — Period vs Compare (footfall, cups, revenue, conversion)
          </li>
          <li>
            <strong>Daily chart</strong> — day-by-day Period vs Compare
          </li>
          <li>
            <strong>Hourly chart</strong> — same hours, both windows
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
    <section className="periodCompareSection" id="ff-period-comparison">
      <h3 className="sectionTitle">Period comparison (Period vs Compare)</h3>
      <p className="hint chartHint">
        Comparing <strong>Period</strong>{' '}
        <strong>
          {location.periodDates[0]}–{location.periodDates.at(-1)}
        </strong>{' '}
        vs <strong>Compare</strong>{' '}
        <strong>
          {location.comparePeriodDates?.[0]}–{location.comparePeriodDates?.at(-1)}
        </strong>
      </p>

      <ComparePeriodKpis location={location} />

      {!hasDaily && hasHourly ? (
        <p className="hint chartHint chartHintWarn">
          Daily comparison is not in this cached report yet — first compare load can take longer.
          Hourly comparison below is still available.
        </p>
      ) : null}

      {hasDaily ? (
        <>
          <h4 className="subsectionTitle">Daily — Period vs Compare</h4>
          <DailyPeriodCompareChart location={location} />
        </>
      ) : primaryDayRows === 0 && compareDayRows === 0 ? (
        <p className="hint">No aligned daily rows for this location (split sales/camera weeks — see tables below).</p>
      ) : null}

      {hasHourly ? (
        <>
          <h4 className="subsectionTitle">Hourly — Period vs Compare</h4>
          <PeriodCompareChart location={location} />
        </>
      ) : (
        <p className="hint">No hourly compare data for this location.</p>
      )}
    </section>
  );
}
