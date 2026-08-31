import { PanelExportWrap } from '@/features/footfall/components/PanelExportWrap';
import { alignedDayRows, normalizeDaysBreakdown } from '@/features/footfall/lib/daysBreakdown';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { periodCompareDaySlots } from '@/features/footfall/lib/periodCompareDays';
import { isProxySales, salesDisplayFor, salesMetricColor } from '@/features/footfall/lib/salesDisplay';
import type { DayBreakdownRow, LocationReport } from '@/features/footfall/lib/types';

type Props = {
  location: LocationReport;
  enableCompare?: boolean;
};

function pctDelta(a: number, b: number): string {
  if (b === 0) return a > 0 ? '+∞%' : '—';
  const d = ((a - b) / b) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function dayVsPeriodDelta(dayVal: number, periodTotal: number, nDays: number): string {
  const avg = periodTotal / Math.max(nDays, 1);
  if (avg <= 0 && dayVal <= 0) return '—';
  return pctDelta(dayVal, avg);
}

function fmtCount(n: number, applicable = true): string {
  if (!applicable) return 'n/a';
  if (n === 0) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtCups(n: number, applicable = true): string {
  if (!applicable) return 'n/a';
  return formatCups(n);
}

function fmtKd(n: number, applicable = true): string {
  if (!applicable) return 'n/a';
  return n.toFixed(2);
}

function fmtConv(d: DayBreakdownRow, applicable = true): string {
  if (!applicable) return 'n/a';
  if (d.footfall <= 0 && d.cups <= 0) return '0%';
  if (d.footfall <= 0) return '—';
  return `${d.conversionPct}%`;
}

type TableColumns = 'full' | 'footfallOnly' | 'salesOnly';

function DayTable({
  title,
  rows,
  avgFootfall,
  avgCups,
  avgRev,
  salesColor,
  showPeriodAvgCol = true,
  columns = 'full',
}: {
  title: string;
  rows: DayBreakdownRow[];
  avgFootfall: number;
  avgCups: number;
  avgRev: number;
  salesColor?: string;
  showPeriodAvgCol?: boolean;
  columns?: TableColumns;
}) {
  const n = Math.max(rows.length, 1);
  const showFf = columns === 'full' || columns === 'footfallOnly';
  const showSales = columns === 'full' || columns === 'salesOnly';

  return (
    <>
      <h4 className="dayTableTitle" style={salesColor ? { color: salesColor } : undefined}>
        {title}
      </h4>
      <table className="metricsTable dayTable">
        <thead>
          <tr>
            <th>Date</th>
            {showFf ? <th>Detections</th> : null}
            {showSales ? <th>Cups</th> : null}
            {showSales ? <th>Conv %</th> : null}
            {showSales ? <th>KD</th> : null}
            {showPeriodAvgCol && showFf ? <th>Δ vs period avg</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date}>
              <td>
                {d.date}
                {d.footfallSourceDate && d.footfallSourceDate !== d.date ? (
                  <span className="dayFootfallSource" title="Camera data from this date">
                    {' '}
                    (cam {d.footfallSourceDate})
                  </span>
                ) : null}
                {d.footfallEstimated ? (
                  <span className="dayEstBadge" title="Mirrored footfall for this sales day">
                    mirror
                  </span>
                ) : null}
              </td>
              {showFf ? <td>{fmtCount(d.footfall)}</td> : null}
              {showSales ? (
                <td style={salesColor ? { color: salesColor, fontWeight: 600 } : undefined}>
                  {fmtCups(d.cups)}
                </td>
              ) : null}
              {showSales ? <td>{fmtConv(d)}</td> : null}
              {showSales ? <td>{fmtKd(d.revenueKd)}</td> : null}
              {showPeriodAvgCol && showFf ? (
                <td>{dayVsPeriodDelta(d.footfall, avgFootfall, n)}</td>
              ) : null}
            </tr>
          ))}
          <tr className="avgRow">
            <td>
              <strong>Period total</strong>
            </td>
            {showFf ? (
              <td>{fmtCount(avgFootfall)}</td>
            ) : null}
            {showSales ? <td>{fmtCups(avgCups)}</td> : null}
            {showSales && columns === 'full' ? (
              <td>
                {avgFootfall > 0
                  ? `${((avgCups / avgFootfall) * 100).toFixed(2)}%`
                  : '—'}
              </td>
            ) : null}
            {showSales && columns === 'salesOnly' ? (
              <td colSpan={2}>
                {avgRev > 0 || avgCups > 0 ? `${fmtKd(avgRev)} KD total` : '0.00 KD total'}
              </td>
            ) : null}
            {showSales && columns === 'full' ? <td>{fmtKd(avgRev)}</td> : null}
            {showPeriodAvgCol && showFf ? <td /> : null}
          </tr>
        </tbody>
      </table>
    </>
  );
}

function AlignedCompareDaysTable({ location }: { location: LocationReport }) {
  const slots = periodCompareDaySlots(location);
  if (!slots.some((s) => s.primary || s.compare)) return null;

  return (
    <>
      <h4 className="dayTableTitle">Day-by-day — Period A vs Period B (Sun–Thu aligned)</h4>
      <table className="metricsTable dayTable compareAlignedTable">
        <thead>
          <tr>
            <th>Day</th>
            <th>Period A date</th>
            <th>Detections</th>
            <th>Cups</th>
            <th>Conv %</th>
            <th>Period B date</th>
            <th>Detections</th>
            <th>Cups</th>
            <th>Conv %</th>
            <th>Δ footfall</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => {
            const pf = s.primary?.footfall ?? 0;
            const cf = s.compare?.footfall ?? 0;
            const pc = s.primary?.cups ?? 0;
            const cc = s.compare?.cups ?? 0;
            return (
              <tr key={s.label}>
                <td>
                  <strong>{s.label}</strong>
                </td>
                <td>{s.primaryDate ?? '—'}</td>
                <td>{fmtCount(pf)}</td>
                <td>{fmtCups(pc)}</td>
                <td>{s.primary ? fmtConv(s.primary) : '—'}</td>
                <td>{s.compareDate ?? '—'}</td>
                <td>{fmtCount(cf)}</td>
                <td>{fmtCups(cc)}</td>
                <td>{s.compare ? fmtConv(s.compare) : '—'}</td>
                <td>
                  {pf > 0 || cf > 0 ? pctDelta(pf, cf || 0) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function DayComparisonTable({ location, enableCompare }: Props) {
  const avg = location.daily;
  const bd = normalizeDaysBreakdown(location.daysBreakdown);
  const mergedRows = alignedDayRows(location.daysBreakdown);
  const proxy = isProxySales(location);
  const salesColor = salesMetricColor(location);
  const salesTitleSuffix = proxy
    ? ` — ${salesDisplayFor(location)?.shortLabel ?? 'proxy'} (predictable)`
    : ' — actual Vendon';

  const totalFootfall =
    avg.totalFootfall > 0
      ? avg.totalFootfall
      : mergedRows.reduce((s, r) => s + r.footfall, 0);
  const totalCups = avg.totalCups > 0 ? avg.totalCups : mergedRows.reduce((s, r) => s + r.cups, 0);
  const totalRev =
    avg.totalRevenueKd > 0 ? avg.totalRevenueKd : mergedRows.reduce((s, r) => s + r.revenueKd, 0);

  return (
    <PanelExportWrap
      filename={[location.locationName, 'daily-breakdown-table']}
      label="Download daily breakdown tables as PNG"
    >
      <div className="dayCompareSection">
        <h3 className="sectionTitle">Daily breakdown</h3>

        {bd.note ? <p className="hint footfallNote">{bd.note}</p> : null}

        {mergedRows.length > 0 ? (
          <DayTable
            title={`Period A — ${mergedRows[0]?.date ?? location.periodDates[0]} … ${mergedRows.at(-1)?.date ?? location.periodDates.at(-1)}`}
            rows={mergedRows}
            avgFootfall={totalFootfall}
            avgCups={totalCups}
            avgRev={totalRev}
            salesColor={proxy ? salesColor : undefined}
            columns="full"
          />
        ) : (
          <p className="hint chartHintWarn">No daily rows for this location — try Rebuild report.</p>
        )}

        {bd.mode === 'split' && (bd.footfallRows?.length || bd.salesRows?.length) ? (
          <details className="daySplitDetails">
            <summary>Separate camera vs sales calendars</summary>
            {bd.footfallRows?.length ? (
              <DayTable
                title={`Camera detections only — ${bd.footfallRows[0]?.date} … ${bd.footfallRows.at(-1)?.date}`}
                rows={bd.footfallRows}
                avgFootfall={totalFootfall}
                avgCups={0}
                avgRev={0}
                columns="footfallOnly"
                showPeriodAvgCol
              />
            ) : null}
            {bd.salesRows?.length ? (
              <DayTable
                title={`Vendon sales${salesTitleSuffix} — ${bd.salesRows[0]?.date} … ${bd.salesRows.at(-1)?.date}`}
                rows={bd.salesRows}
                salesColor={proxy ? salesColor : undefined}
                avgFootfall={0}
                avgCups={totalCups}
                avgRev={totalRev}
                columns="salesOnly"
                showPeriodAvgCol={false}
              />
            ) : null}
          </details>
        ) : null}

        {enableCompare ? <AlignedCompareDaysTable location={location} /> : null}
      </div>
    </PanelExportWrap>
  );
}
