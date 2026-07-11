import { formatKwd } from '@/lib/salesDisplay';

export function MtdSalesCell({ kwd }: { kwd?: number | null }) {
  if (kwd == null || !Number.isFinite(Number(kwd))) {
    return <span className="mtdSalesEmpty">—</span>;
  }
  return (
    <span className="mtdSalesVal" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatKwd(Number(kwd))}
    </span>
  );
}
