import { formatKwd, formatSalesTrendPct, resolveSalesTrendPct, type SalesElapsedRow } from '@/lib/salesDisplay';
import { bindStopRowClick } from '@/lib/stopRowClick';
import {
  presetBoxLabels,
  salesPairForPreset,
  type CompareMetricPair,
  type VendonPresetSalesRow,
} from '@/lib/presetComparison';
import type { ComparePresetId, CompareSelection } from '@/components/ComparePresetPicker';

export type SalesStackVariant = 'todayVsYesterday' | 'yesterdayVsDayBefore';

function SalesTrendLine({
  trendPct,
  primary,
  baseline,
}: {
  trendPct: number | null;
  primary: number;
  baseline: number | null | undefined;
}) {
  const resolved = trendPct;
  const hasPct = resolved != null && Number.isFinite(resolved);
  const hasBaseline = baseline != null && Number.isFinite(baseline);
  const up = hasPct ? resolved >= 0 : hasBaseline ? primary >= baseline : false;
  const down = hasPct ? resolved < 0 : hasBaseline ? primary < baseline : false;
  const tone = up ? 'alertSalesUp' : down ? 'alertSalesDown' : 'salesStackTrendMuted';

  if (hasPct) {
    return (
      <span className={`salesStackTrend ${tone}`}>
        {up ? '▲ ' : '▼ '}
        {formatSalesTrendPct(resolved)}
      </span>
    );
  }

  if (hasBaseline && primary !== baseline) {
    return <span className={`salesStackTrend ${tone}`}>{up ? '▲' : '▼'}</span>;
  }

  return <span className="salesStackTrend salesStackTrendMuted">—</span>;
}

function SalesStackPlaceholder() {
  return (
    <div className="salesStack salesStackPlaceholder" aria-hidden>
      <div className="salesStackBox salesStackBoxToday salesStackBoxMuted">
        <span className="salesStackLabel">Today</span>
        <span className="salesStackVal">—</span>
        <SalesTrendLine trendPct={null} primary={0} baseline={null} />
      </div>
      <div className="salesStackBox salesStackBoxYest salesStackBoxMuted">
        <span className="salesStackLabel">Yest.</span>
        <span className="salesStackVal">—</span>
      </div>
    </div>
  );
}

export function SalesElapsedStack({
  row,
  title,
  interactive = false,
  onOpenDetail,
  preset = 'today_vs_yesterday',
  compare,
  vendonRow,
  pair: pairOverride,
}: {
  row: SalesElapsedRow | undefined;
  title?: string;
  interactive?: boolean;
  onOpenDetail?: () => void;
  /** @deprecated use preset */
  variant?: SalesStackVariant;
  preset?: ComparePresetId;
  compare?: CompareSelection;
  vendonRow?: VendonPresetSalesRow;
  pair?: CompareMetricPair;
}) {
  const pair = pairOverride ?? salesPairForPreset(preset, row, compare, vendonRow);
  const boxLabels = presetBoxLabels(preset);

  const hasPrimary = pair.primary != null && Number.isFinite(pair.primary);
  const hasBaseline = pair.baseline != null && Number.isFinite(pair.baseline);
  if (!hasPrimary && !hasBaseline) {
    return <SalesStackPlaceholder />;
  }

  const primaryVal = hasPrimary ? pair.primary! : 0;
  const trendPct = resolveSalesTrendPct(
    pair.trendPct,
    pair.primary != null && Number.isFinite(pair.primary) ? pair.primary : null,
    pair.baseline,
  );
  const primaryUp =
    hasBaseline
      ? primaryVal >= pair.baseline!
      : trendPct != null
        ? trendPct >= 0
        : primaryVal > 0;
  const primaryDown =
    hasBaseline
      ? primaryVal < pair.baseline!
      : trendPct != null
        ? trendPct < 0
        : false;
  const primaryTone = primaryUp ? 'salesStackBoxUp' : primaryDown ? 'salesStackBoxDown' : '';

  const canOpen =
    interactive &&
    Boolean(onOpenDetail) &&
    (Boolean(row?.dailyElapsed?.length) || hasPrimary || hasBaseline);

  const inner = (
    <>
      <div className={`salesStackBox salesStackBoxToday ${primaryTone}`}>
        <span className="salesStackLabel" title={pair.primaryLabel}>
          {boxLabels.primary}
        </span>
        <span className="salesStackVal">{hasPrimary ? formatKwd(pair.primary!) : '—'}</span>
        <SalesTrendLine trendPct={trendPct} primary={primaryVal} baseline={pair.baseline} />
      </div>
      <div className={`salesStackBox salesStackBoxYest ${pair.baseline == null ? 'salesStackBoxMuted' : ''}`}>
        <span className="salesStackLabel" title={pair.baselineLabel}>
          {boxLabels.baseline}
        </span>
        <span className="salesStackVal">
          {pair.baseline != null && Number.isFinite(pair.baseline) ? formatKwd(pair.baseline) : '—'}
        </span>
      </div>
    </>
  );

  const tip = title ?? pair.caption;

  if (canOpen) {
    return (
      <button
        type="button"
        className="salesStack salesStackBtn"
        title={tip}
        {...bindStopRowClick(onOpenDetail)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="salesStack" title={tip}>
      {inner}
    </div>
  );
}
