import { createPortal } from 'react-dom';
import { namesOnlyList, type ProductNameCount } from '@/lib/productMixDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function ProductExtremesModal({
  machineName,
  machineId,
  topProducts,
  lowProducts,
  periodLabel,
  onClose,
}: {
  machineName: string;
  machineId: string;
  topProducts?: ProductNameCount[] | null;
  lowProducts?: ProductNameCount[] | null;
  periodLabel?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const highs = namesOnlyList(topProducts, 5);
  const lows = namesOnlyList(lowProducts, 5);

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

        <p className="salesHistoryNote">
          Names only — highest and lowest by <strong>sales revenue (KD)</strong> in the compare period.
        </p>

        <div className="productExtremesGrid">
          <section className="productExtremesCol productExtremesHigh">
            <h3 className="salesHistoryCompareTitle">Top 5</h3>
            {highs.length ? (
              <ol className="productExtremesList">
                {highs.map((name) => (
                  <li key={`h-${name}`}>{name}</li>
                ))}
              </ol>
            ) : (
              <p className="salesHistoryNote">No product mix for this period yet.</p>
            )}
          </section>
          <section className="productExtremesCol productExtremesLow">
            <h3 className="salesHistoryCompareTitle">Lowest 5</h3>
            {lows.length ? (
              <ol className="productExtremesList">
                {lows.map((name) => (
                  <li key={`l-${name}`}>{name}</li>
                ))}
              </ol>
            ) : (
              <p className="salesHistoryNote">No product mix for this period yet.</p>
            )}
          </section>
        </div>
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}
