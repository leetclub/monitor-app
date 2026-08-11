import type { LocationReport } from '@/features/footfall/lib/types';

type Props = { location: LocationReport; hideDateLabels?: boolean };

/**
 * Concise data-quality banner for the targets app.
 *
 * Only renders for situations the KPI row doesn't already cover:
 *  - proxy sales (cups not from this week)
 *  - camera/sales week misalignment
 *  - no footfall but cups present
 *
 * Footfall-kind (mirrored/projected) is intentionally not duplicated here —
 * the "Footfall · week" KPI already carries the source + dates.
 */
export function DataQualityBanner({ location, hideDateLabels }: Props) {
  const d = location.daily;
  const fd = location.footfallDiagnostics;
  const salesDisp = location.salesDisplay;
  const proxySales =
    location.salesDataKind === 'proxy_benchmark' ||
    location.salesDataKind === 'proxy_nearest';
  const ffDates = d.footfallPeriodDates ?? location.footfallPeriodDates ?? fd?.footfallPeriodDates;
  const salesDates =
    d.salesPeriodDates ?? location.salesPeriodDates ?? location.periodDates;
  const misaligned =
    !!ffDates?.length &&
    !!salesDates?.length &&
    (ffDates[0] !== salesDates[0] || ffDates.at(-1) !== salesDates.at(-1));
  const noFootfall = d.totalFootfall <= 0 && !d.projectedFootfall && d.totalCups > 0;

  if (!proxySales && !misaligned && !noFootfall) return null;

  return (
    <div className="dataBanner dataBannerWarn">
      {proxySales && salesDisp ? (
        <p>
          <strong style={{ color: salesDisp.color }}>Proxy sales:</strong>{' '}
          {salesDisp.shortLabel}
        </p>
      ) : null}
      {misaligned ? (
        <p>
          <strong>Different weeks:</strong>{' '}
          {hideDateLabels
            ? 'cups and footfall use different 5-day windows.'
            : `cups ${salesDates?.[0]} → ${salesDates?.at(-1)} · footfall ${ffDates?.[0]} → ${ffDates?.at(-1)}`}
        </p>
      ) : null}
      {noFootfall ? <p>No camera mapped.</p> : null}
    </div>
  );
}
