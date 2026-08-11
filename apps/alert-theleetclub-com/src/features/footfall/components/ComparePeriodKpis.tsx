import { PanelExportWrap } from '@/features/footfall/components/PanelExportWrap';
import { footfallCompareKpiLabel } from '@/features/footfall/lib/footfallLabel';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import { NET_TRAFFIC_LABEL } from '@/features/footfall/lib/netTrafficCopy';
import { TermLabel } from '@/features/footfall/lib/termHighlight';
import type { LocationReport } from '@/features/footfall/lib/types';

type Props = { location: LocationReport };

function pctChange(primary: number, compare: number): string {
  if (compare <= 0) return primary > 0 ? '+∞' : '—';
  const d = ((primary - compare) / compare) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

export function ComparePeriodKpis({ location }: Props) {
  const cmp = location.compareDaily;
  if (!cmp || !location.comparePeriodDates?.length) return null;

  const d = location.daily;
  const rows: { label: string; primary: string; compare: string; delta: string }[] = [
    {
      label: footfallCompareKpiLabel(location),
      primary: displayFootfallTotal(location).toLocaleString(),
      compare: (cmp.projectedFootfall ?? cmp.totalFootfall).toLocaleString(),
      delta: pctChange(displayFootfallTotal(location), cmp.projectedFootfall ?? cmp.totalFootfall),
    },
    {
      label: 'Cups sold',
      primary: d.totalCups.toLocaleString(),
      compare: cmp.totalCups.toLocaleString(),
      delta: pctChange(d.totalCups, cmp.totalCups),
    },
    {
      label: 'Revenue (KD)',
      primary: d.totalRevenueKd.toFixed(2),
      compare: cmp.totalRevenueKd.toFixed(2),
      delta: pctChange(d.totalRevenueKd, cmp.totalRevenueKd),
    },
    {
      label: 'Conversion %',
      primary: `${d.conversionPct}%`,
      compare: `${cmp.conversionPct}%`,
      delta: pctChange(d.conversionPct, cmp.conversionPct),
    },
  ];

  if ((d.totalNet ?? 0) !== 0 || (cmp.totalNet ?? 0) !== 0) {
    rows.push({
      label: NET_TRAFFIC_LABEL,
      primary: d.totalNet != null ? d.totalNet.toLocaleString() : '—',
      compare: cmp.totalNet != null ? cmp.totalNet.toLocaleString() : '—',
      delta:
        d.totalNet != null && cmp.totalNet != null
          ? pctChange(d.totalNet, cmp.totalNet)
          : '—',
    });
  }

  return (
    <PanelExportWrap
      filename={[location.locationName, 'period-compare-kpis']}
      label="Download period comparison table as PNG"
    >
    <div className="comparePeriodKpis">
      <h4 className="subsectionTitle">Period totals — primary vs compare week</h4>
      <table className="metricsTable comparePeriodTable">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Primary week</th>
            <th>Compare week</th>
            <th>Δ vs compare</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>
                <TermLabel text={r.label} />
              </td>
              <td className="metricValue">{r.primary}</td>
              <td>{r.compare}</td>
              <td>{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </PanelExportWrap>
  );
}
