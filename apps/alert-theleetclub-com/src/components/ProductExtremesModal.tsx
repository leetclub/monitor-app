import { createPortal } from 'react-dom';
import { namesOnlyList, type ProductNameCount } from '@/lib/productMixDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function ProductExtremesModal({
  machineName,
  machineId,
  topProducts,
  lowProducts,
  periodLabel,
  distinctDrinksSold,
  onClose,
}: {
  machineName: string;
  machineId: string;
  topProducts?: ProductNameCount[] | null;
  lowProducts?: ProductNameCount[] | null;
  periodLabel?: string | null;
  /** Distinct product names with sales in the compare period. */
  distinctDrinksSold?: number | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const highs = namesOnlyList(topProducts, 5);
  const highSet = new Set(highs.map((n) => n.toLowerCase()));
  const distinct =
    distinctDrinksSold != null && Number.isFinite(Number(distinctDrinksSold))
      ? Math.max(0, Math.round(Number(distinctDrinksSold)))
      : Math.max(highs.length, highs.length + namesOnlyList(lowProducts, 5).length);
  const fewSkus = distinct > 0 && distinct <= 5;
  // ≤5 distinct sellers → every drink is already in Top; never show a Lowest list.
  // Also drop any overlap if a stale singular lowProduct slipped through.
  const lows = fewSkus
    ? []
    : namesOnlyList(lowProducts, 5).filter((n) => !highSet.has(n.toLowerCase()));
  const topTitle = distinct > 0 && distinct < 5 ? `Top ${distinct}` : 'Top 5';
  const lowTitle = fewSkus ? 'Lowest' : 'Lowest 5';

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-extremes-title"
      {...backdrop}
    >
      <div className="salesHistoryModal productExtremesModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">
              Top / low drinks{periodLabel ? ` · ${periodLabel}` : ''}
            </p>
            <h2 id="product-extremes-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
          {distinct > 0 ? (
            <p className="productExtremesDistinct" role="status">
              <strong>{distinct}</strong> distinct drink{distinct === 1 ? '' : 's'} sold in this
              period
              {distinct < 5 ? ' — that is why Top is shorter than 5' : ''}.
            </p>
          ) : null}

          <p className="salesHistoryNote">
            Names only — highest and lowest by <strong>sales revenue (KD)</strong> in the compare
            period. Lowest never repeats a Top drink.
          </p>

          <div className="productExtremesGrid">
            <section className="productExtremesCol productExtremesHigh">
              <h3 className="salesHistoryCompareTitle">{topTitle}</h3>
              {highs.length ? (
                <ol className="productExtremesList">
                  {highs.map((name) => (
                    <li key={`h-${name}`}>{name}</li>
                  ))}
                </ol>
              ) : (
                <p className="salesHistoryNote">
                  No product mix for this period yet (cache still warming, or no sales).
                </p>
              )}
            </section>
            <section className="productExtremesCol productExtremesLow">
              <h3 className="salesHistoryCompareTitle">{lowTitle}</h3>
              {lows.length ? (
                <ol className="productExtremesList">
                  {lows.map((name) => (
                    <li key={`l-${name}`}>{name}</li>
                  ))}
                </ol>
              ) : (
                <p className="salesHistoryNote">
                  {fewSkus && highs.length
                    ? `Only ${distinct} drink${distinct === 1 ? '' : 's'} sold — not enough for a separate lowest list.`
                    : 'No product mix for this period yet.'}
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
