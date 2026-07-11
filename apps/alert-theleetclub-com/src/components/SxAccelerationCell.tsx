import { formatSalesTrendPct } from '@/lib/salesDisplay';

export type SxSideMetrics = {
  sxPct?: number | null;
  growthCurrentPct?: number | null;
  growthPreviousPct?: number | null;
  current?: number | null;
  previous?: number | null;
  prior?: number | null;
  unit?: 'kwd' | 'cups' | string | null;
};

export type SxAccelerationRow = {
  productName?: string | null;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  location?: SxSideMetrics | null;
  product?: SxSideMetrics | null;
  labels?: {
    current?: string;
    previous?: string;
    prior?: string;
  } | null;
};

function formatSxPts(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  return formatSalesTrendPct(Number(pct)).replace(/%$/, ' pts');
}

function toneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return 'sxToneFlat';
  if (Number(pct) > 0) return 'alertSalesUp';
  if (Number(pct) < 0) return 'alertSalesDown';
  return 'sxToneFlat';
}

/** YoY-style lead % + Target-style Loc/Prod dual stack for Sales Acceleration. */
export function SxAccelerationCell({
  row,
  title,
}: {
  row?: SxAccelerationRow | null;
  title?: string;
}) {
  const loc = row?.location;
  const prod = row?.product;
  const locSx = loc?.sxPct;
  const prodSx = prod?.sxPct;
  const hasLoc = locSx != null && Number.isFinite(Number(locSx));
  const hasProd = prodSx != null && Number.isFinite(Number(prodSx));

  if (!hasLoc && !hasProd) {
    return <span className="mtdSalesEmpty">—</span>;
  }

  const lead = hasLoc ? Number(locSx) : Number(prodSx);
  const leadUp = lead >= 0;
  const tip = [
    title,
    hasLoc ? `Loc SX ${formatSxPts(locSx)}` : null,
    hasProd ? `Prod SX ${formatSxPts(prodSx)}${row?.productName ? ` (${row.productName})` : ''}` : null,
    row?.labels?.current && row?.labels?.previous
      ? `Windows: ${row.labels.current} vs ${row.labels.previous} vs ${row.labels.prior || 'prior'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="sxCell" title={tip}>
      <span className={`sxLead ${toneClass(lead)}`}>
        {leadUp ? '▲ ' : '▼ '}
        {formatSxPts(lead)}
      </span>
      <div className="sxStack">
        <div className={`sxBox ${toneClass(locSx)}`}>
          <span className="sxBoxLabel">Loc</span>
          <span className="sxBoxVal">{hasLoc ? formatSxPts(locSx) : '—'}</span>
        </div>
        <div className={`sxBox ${toneClass(prodSx)}`}>
          <span className="sxBoxLabel">Prod</span>
          <span className="sxBoxVal">{hasProd ? formatSxPts(prodSx) : '—'}</span>
        </div>
      </div>
    </div>
  );
}
