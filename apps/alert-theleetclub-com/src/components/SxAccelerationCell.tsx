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

export type SxProductRow = SxSideMetrics & {
  productName?: string | null;
  productTargetCups?: number | null;
};

export type SxAccelerationRow = {
  productName?: string | null;
  productNames?: string[] | null;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  location?: SxSideMetrics | null;
  /** @deprecated Fleet no longer returns a single product; use `products`. */
  product?: SxSideMetrics | null;
  products?: SxProductRow[] | null;
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

function formatLocAmount(side: SxSideMetrics | null | undefined): string {
  if (!side || side.current == null || !Number.isFinite(Number(side.current))) return '—';
  return formatKwd(Number(side.current)).replace(' KD', '');
}

/**
 * Location SX only on the dashboard (KD acceleration).
 * Promoted-product SX lives in the detail popup (supports many SKUs).
 */
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
  const locSx = loc?.sxPct;
  const hasLocAmt = loc?.current != null && Number.isFinite(Number(loc.current));
  const hasLoc = (locSx != null && Number.isFinite(Number(locSx))) || hasLocAmt;
  const productCount = Array.isArray(row?.products)
    ? row!.products!.length
    : Array.isArray(row?.productNames)
      ? row!.productNames!.length
      : 0;

  if (!hasLoc) {
    if (interactive && onOpenDetail) {
      return (
        <button type="button" className="sxCell sxCellBtn sxCellEmpty" {...bindStopRowClick(onOpenDetail)}>
          <span className="mtdSalesEmpty">Open</span>
        </button>
      );
    }
    return <span className="mtdSalesEmpty">—</span>;
  }

  const tip = [
    title,
    hasLocAmt ? `Loc ${formatLocAmount(loc)} KD` : null,
    locSx != null ? `Loc SX ${formatSxPts(locSx)}` : null,
    productCount > 0 ? `${productCount} promoted product${productCount === 1 ? '' : 's'} in detail` : null,
    interactive ? 'Tap for SX details (all promoted products)' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className={`sxBox ${toneClass(locSx ?? loc?.growthCurrentPct)}`}>
      <span className="sxBoxLabel">Loc</span>
      <span className="sxBoxVal">{locSx != null ? formatSxPts(locSx) : '—'}</span>
      <span className="sxBoxSub">{hasLocAmt ? `${formatLocAmount(loc)} KD` : '—'}</span>
    </div>
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
