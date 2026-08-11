import { hasHourlyNetTraffic } from '@/features/footfall/components/NetTrafficChart';
import { PanelExportWrap } from '@/features/footfall/components/PanelExportWrap';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { hourConversionPct } from '@/features/footfall/lib/targetsBenchmark';
import type { LocationReport } from '@/features/footfall/lib/types';

type Props = {
  location: LocationReport;
  mirrorNote?: string | null;
  salesColor?: string;
};

export function MetricsTable({ location, mirrorNote, salesColor }: Props) {
  const hours = location.hours;
  const showNet = hasHourlyNetTraffic(location);

  return (
    <PanelExportWrap
      filename={[location.locationName, 'hourly-metrics-table']}
      label="Download hourly metrics table as PNG"
    >
    <div className="tableWrap">
      {mirrorNote ? (
        <p className="mirrorNote" style={{ color: '#5eb8e8' }}>
          {mirrorNote}
        </p>
      ) : null}
      <table className="metricsTable">
        <thead>
          <tr>
            <th>Hour</th>
            <th>Avg footfall</th>
            {showNet ? (
              <>
                <th>In</th>
                <th>Out</th>
                <th>Net</th>
              </>
            ) : null}
            <th>Avg cups</th>
            <th>Aspired cups</th>
            <th>Ratio</th>
            <th>Conv %</th>
            <th>Revenue (KD)</th>
            <th>Rev / visitor (KD)</th>
            <th>Uplift cups</th>
            <th>Uplift (KD)</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => {
            const signals: string[] = [];
            if (h.isSurge) signals.push('Surge');
            if (h.isWeakConversion) signals.push('Weak conv.');
            if (h.isHighEfficiency) signals.push('High eff.');
            if (h.isStrongMonetization) signals.push('Strong $');
            const footfallCell = h.footfallMirror ? (
              <span>
                {h.footfall}{' '}
                <span style={{ color: h.footfallMirror.color }}>
                  ({h.footfallMirror.value} from {h.footfallMirror.label})
                </span>
              </span>
            ) : (
              h.footfall
            );
            return (
              <tr
                key={h.hour}
                className={[
                  h.isWeakConversion ? 'rowWeak' : '',
                  h.isHighEfficiency ? 'rowStrong' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td>{h.label}</td>
                <td>{footfallCell}</td>
                {showNet ? (
                  <>
                    <td>{(h.peopleIn ?? 0) > 0 ? h.peopleIn : '—'}</td>
                    <td>{(h.peopleOut ?? 0) > 0 ? h.peopleOut : '—'}</td>
                    <td>{h.netTraffic != null ? h.netTraffic : '—'}</td>
                  </>
                ) : null}
                <td style={salesColor ? { color: salesColor, fontWeight: 600 } : undefined}>
                  {formatCups(h.cups)}
                </td>
                <td>{formatCups(h.aspiredCups)}</td>
                <td>{h.conversionRatio}</td>
                <td>{hourConversionPct(h).toFixed(1)}%</td>
                <td style={salesColor ? { color: salesColor } : undefined}>{h.revenueKd.toFixed(3)}</td>
                <td>{h.revenuePerVisitorKd.toFixed(4)}</td>
                <td>{h.upliftCups > 0 ? `+${formatCups(h.upliftCups)}` : '—'}</td>
                <td>{h.upliftKd > 0 ? `+${h.upliftKd.toFixed(3)}` : '—'}</td>
                <td>{signals.join(' · ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </PanelExportWrap>
  );
}
