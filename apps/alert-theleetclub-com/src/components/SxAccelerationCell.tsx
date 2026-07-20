import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { bindStopRowClick } from '@/lib/stopRowClick';

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

function formatSideAmount(side: SxSideMetrics | null | undefined): string {
  if (!side || side.current == null || !Number.isFinite(Number(side.current))) return '—';
  const n = Number(side.current);
  if (side.unit === 'cups') return `${Math.round(n)} c`;
  return formatKwd(n).replace(' KD', '');
}

/** YoY-style lead SX pts + Loc/Prod amounts. Tap opens SX detail popup. */
export function SxAccelerationCell({
  row,
  title,
  interactive,
  onOpenDetail,
}: {
  row?: SxAccelerationRow | null;
  title?: string;
  interactive?: boolean;
  onOpenDetail?: () => void;
}) {
  const loc = row?.location;
  const prod = row?.product;
  const locSx = loc?.sxPct;
  const prodSx = prod?.sxPct;
  const hasLocAmt = loc?.current != null && Number.isFinite(Number(loc.current));
  const hasProdAmt = prod?.current != null && Number.isFinite(Number(prod.current));
  const hasLoc = (locSx != null && Number.isFinite(Number(locSx))) || hasLocAmt;
  const hasProd = (prodSx != null && Number.isFinite(Number(prodSx))) || hasProdAmt;

  if (!hasLoc && !hasProd) {
    if (interactive && onOpenDetail) {
      return (
        <button type="button" className="sxCell sxCellBtn sxCellEmpty" {...bindStopRowClick(onOpenDetail)}>
          <span className="mtdSalesEmpty">Open</span>
        </button>
      );
    }
    return <span className="mtdSalesEmpty">—</span>;
  }

  const lead =
    locSx != null && Number.isFinite(Number(locSx))
      ? Number(locSx)
      : prodSx != null && Number.isFinite(Number(prodSx))
        ? Number(prodSx)
        : loc?.growthCurrentPct != null
          ? Number(loc.growthCurrentPct)
          : null;
  const leadUp = lead != null && lead >= 0;
  const tip = [
    title,
    hasLocAmt ? `Loc ${formatSideAmount(loc)} KD` : null,
    locSx != null ? `Loc SX ${formatSxPts(locSx)}` : null,
    hasProdAmt ? `Prod ${formatSideAmount(prod)} cups${row?.productName ? ` (${row.productName})` : ''}` : null,
    prodSx != null ? `Prod SX ${formatSxPts(prodSx)}` : null,
    row?.labels?.current && row?.labels?.previous
      ? `Windows: ${row.labels.current} vs ${row.labels.previous} vs ${row.labels.prior || 'prior'}`
      : null,
    interactive ? 'Tap for SX details' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <>
      <span className={`sxLead ${toneClass(lead)}`}>
        {lead != null ? `${leadUp ? '▲ ' : '▼ '}${formatSxPts(lead)}` : '—'}
      </span>
      <div className="sxStack">
        <div className={`sxBox ${toneClass(locSx ?? loc?.growthCurrentPct)}`}>
          <span className="sxBoxLabel">Loc</span>
          <span className="sxBoxVal">{hasLocAmt ? formatSideAmount(loc) : '—'}</span>
          <span className="sxBoxSub">
            {locSx != null ? formatSxPts(locSx) : loc?.growthCurrentPct != null ? formatSalesTrendPct(Number(loc.growthCurrentPct)) : '—'}
          </span>
        </div>
        <div className={`sxBox ${toneClass(prodSx ?? prod?.growthCurrentPct)}`}>
          <span className="sxBoxLabel">Prod</span>
          <span className="sxBoxVal">{hasProdAmt ? formatSideAmount(prod) : '—'}</span>
          <span className="sxBoxSub">
            {prodSx != null ? formatSxPts(prodSx) : prod?.growthCurrentPct != null ? formatSalesTrendPct(Number(prod.growthCurrentPct)) : '—'}
          </span>
        </div>
      </div>
    </>
  );

  if (interactive && onOpenDetail) {
    return (
      <button type="button" className="sxCell sxCellBtn" title={tip} {...bindStopRowClick(onOpenDetail)}>
        {body}
      </button>
    );
  }

  return (
    <div className="sxCell" title={tip}>
      {body}
    </div>
  );
}
