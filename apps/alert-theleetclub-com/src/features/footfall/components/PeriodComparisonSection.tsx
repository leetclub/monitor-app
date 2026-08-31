import type { LocationReport } from '@/features/footfall/lib/types';
import { alignedDayRows } from '@/features/footfall/lib/daysBreakdown';
import { hasDailyPeriodCompare } from '@/features/footfall/lib/periodCompareDays';
import { ComparePeriodKpis } from '@/features/footfall/components/ComparePeriodKpis';
import { DailyPeriodCompareChart, PeriodCompareChart } from '@/features/footfall/components/ComparisonCharts';

type Props = {
  location: LocationReport;
  showPeriodCompare: boolean;
};

function rangeLabel(dates: string[] | null | undefined): string {
  if (!dates?.length) return '—';
  const first = dates[0];
  const last = dates.at(-1) ?? first;
  return first === last ? first : `${first}→${last}`;
}

export function PeriodComparisonSection({ location, showPeriodCompare }: Props) {
  if (!showPeriodCompare) {
    return (
      <section className="periodCompareSection periodCompareSectionOff">
        <h3 className="sectionTitle">Period A vs Period B</h3>
        <p className="hint chartHint">
          Comparison data is still loading or missing for this location. Confirm{' '}
          <strong>Period A</strong> and <strong>Period B</strong> in the bar above, then wait for the
          report to finish (or Retry).
        </p>
        <ul className="periodCompareList">
          <li>
            <strong>Totals table</strong> — Period A vs Period B (footfall, cups, revenue, conversion)
          </li>
          <li>
            <strong>Daily chart</strong> — day-by-day Period A vs Period B
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
      <h3 className="sectionTitle">Period A vs Period B</h3>
      <p className="hint chartHint">
        <strong>Period A</strong> {rangeLabel(location.periodDates)} · <strong>Period B</strong>{' '}
        {rangeLabel(location.comparePeriodDates)}
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
          <h4 className="subsectionTitle">Daily — Period A vs Period B</h4>
          <DailyPeriodCompareChart location={location} />
        </>
      ) : primaryDayRows === 0 && compareDayRows === 0 ? (
        <p className="hint">
          No aligned daily rows for this location (split sales/camera weeks — see tables below).
        </p>
      ) : null}

      {hasHourly ? (
        <>
          <h4 className="subsectionTitle">Hourly — Period A vs Period B</h4>
          <PeriodCompareChart location={location} />
        </>
      ) : (
        <p className="hint">No hourly Period B data for this location.</p>
      )}
    </section>
  );
}
