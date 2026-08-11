import type { LocationReport } from '@/features/footfall/lib/types';
import { PanelExportWrap } from '@/features/footfall/components/PanelExportWrap';
import { TermLabel } from '@/features/footfall/lib/termHighlight';
import {
  footfallPeriodLabel,
  isMirroredFootfall,
  mirroredPeerName,
} from '@/features/footfall/lib/footfallLabel';
import { isProxySales, salesDisplayFor } from '@/features/footfall/lib/salesDisplay';

type Props = { location: LocationReport; benchmarkPct: number };

export function InsightsProjectionsPanel({ location, benchmarkPct }: Props) {
  const d = location.daily;
  const ins = location.insights;
  const projected = d.projectedFootfall ?? d.totalFootfall;
  const mirrored = isMirroredFootfall(location);

  return (
    <PanelExportWrap
      filename={[location.locationName, 'insights-projections']}
      label="Download insights and projections as PNG"
    >
      <section className="insightsPanel">
        <h3 className="sectionTitle">Insights</h3>
        <p className="insight insightsPanelSummary">{ins.summary}</p>
        <div className="insightsGrid">
          <div className="insightCard">
            <div className="insightCardLabel">
              <TermLabel text={footfallPeriodLabel(location).replace('(5 days)', '· 5 days')} />
            </div>
            <div className="insightCardValue" style={{ color: location.footfallDisplay?.color }}>
              {projected.toLocaleString()}
            </div>
            <div className="insightCardHint">
              {mirrored
                ? `from ${mirroredPeerName(location) ?? 'same-segment peer'}`
                : 'unique footfall · camera'}
            </div>
          </div>
          {d.salesTargetCups != null && d.salesTargetCups > 0 ? (
            <div className="insightCard">
              <div className="insightCardLabel">
                <TermLabel text={`Sales target · 5 days · @ ${benchmarkPct}%`} />
              </div>
              <div className="insightCardValue">{Math.round(d.salesTargetCups)} cups</div>
              <div className="insightCardHint">
                {d.salesUpliftCups != null && d.salesUpliftCups > 0
                  ? `+${Math.round(d.salesUpliftCups)} cups (+${d.salesUpliftKd?.toFixed(1)} KD) vs actual`
                  : d.salesTargetNote ?? 'benchmark on footfall'}
              </div>
            </div>
          ) : null}
          <div className="insightCard">
            <div className="insightCardLabel">
              <TermLabel text="Missed potential · 5 days" />
            </div>
            <div className="insightCardValue accent">{d.illustrativeMissedPotentialKd.toFixed(1)} KD</div>
            <div className="insightCardHint">vs benchmark</div>
          </div>
          <div className="insightCard">
            <div className="insightCardLabel">Peak hour</div>
            <div className="insightCardValue">{ins.peakExposureHour ?? '—'}</div>
            <div className="insightCardHint">
              {ins.peakExposureFootfall != null
                ? `~${Math.round(ins.peakExposureFootfall)} avg`
                : 'highest footfall'}
            </div>
          </div>
          <div className="insightCard">
            <div className="insightCardLabel">Peak monetization</div>
            <div className="insightCardValue">{ins.peakMonetizationHour ?? '—'}</div>
            <div className="insightCardHint">best hour · KD / visit</div>
          </div>
          {isProxySales(location) ? (
            <div className="insightCard">
              <div className="insightCardLabel">Sales calendar</div>
              <div className="insightCardValue insightCardValueSmall">
                {salesDisplayFor(location)?.shortLabel ?? 'Proxy week'}
              </div>
              <div className="insightCardHint">{salesDisplayFor(location)?.label}</div>
            </div>
          ) : null}
        </div>
        {(ins.weakConversionHours?.length ?? 0) > 0 ? (
          <p className="hint insightsPanelTags">
            Weak conversion: {(ins.weakConversionHours ?? []).join(', ')}
            {(ins.highEfficiencyHours?.length ?? 0) > 0
              ? ` · High efficiency: ${(ins.highEfficiencyHours ?? []).join(', ')}`
              : ''}
          </p>
        ) : null}
      </section>
    </PanelExportWrap>
  );
}
