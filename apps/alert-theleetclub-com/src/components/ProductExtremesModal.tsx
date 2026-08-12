import { createPortal } from 'react-dom';
import { namesOnlyList, type ProductNameCount } from '@/lib/productMixDisplay';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

/** Parse YYYY-MM-DD as a calendar day (no TZ shift). */
function parseYmd(raw?: string | null): Date | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function formatYmdUtc(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Alert API periods are half-open [start, endExclusive).
 * Show the inclusive calendar day(s) operators actually mean.
 */
export function formatAlertPeriodDateRange(
  startIso?: string | null,
  endExclusiveIso?: string | null,
): string | null {
  const start = parseYmd(startIso);
  if (!start) return null;
  const endEx = parseYmd(endExclusiveIso);
  let last = start;
  if (endEx) {
    last = new Date(endEx.getTime() - 24 * 60 * 60 * 1000);
    if (last.getTime() < start.getTime()) last = start;
  }
  if (start.getTime() === last.getTime()) return formatYmdUtc(start);
  const sameMonth =
    start.getUTCFullYear() === last.getUTCFullYear() && start.getUTCMonth() === last.getUTCMonth();
  if (sameMonth) {
    const dayFrom = String(start.getUTCDate()).padStart(2, '0');
    const dayTo = String(last.getUTCDate()).padStart(2, '0');
    const rest = last.toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      month: 'short',
      year: 'numeric',
    });
    return `${dayFrom}–${dayTo} ${rest}`;
  }
  return `${formatYmdUtc(start)} – ${formatYmdUtc(last)}`;
}

export function ProductExtremesModal({
  machineName,
  machineId,
  topProducts,
  lowProducts,
  periodLabel,
  periodStart,
  periodEndExclusive,
  distinctDrinksSold,
  productMixCachedAt,
  onClose,
}: {
  machineName: string;
  machineId: string;
  topProducts?: ProductNameCount[] | null;
  lowProducts?: ProductNameCount[] | null;
  periodLabel?: string | null;
  /** Inclusive period A start (ISO YYYY-MM-DD) from vendon-sales-summary. */
  periodStart?: string | null;
  /** Exclusive period A end (ISO YYYY-MM-DD) from vendon-sales-summary. */
  periodEndExclusive?: string | null;
  /** Distinct product names with sales in the compare period. */
  distinctDrinksSold?: number | null;
  /** When the revenue/product-mix cache row was last written (ISO). */
  productMixCachedAt?: string | null;
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
  const lows = fewSkus
    ? []
    : namesOnlyList(lowProducts, 5).filter((n) => !highSet.has(n.toLowerCase()));
  const topTitle = distinct > 0 && distinct < 5 ? `Top ${distinct}` : 'Top 5';
  const lowTitle = fewSkus ? 'Lowest' : 'Lowest 5';

  const periodName = (periodLabel || '').trim() || null;
  const dateRange = formatAlertPeriodDateRange(periodStart, periodEndExclusive);
  const windowLabel = [periodName, dateRange].filter(Boolean).join(' · ');
  const mixAsOf = productMixCachedAt ? formatKuwaitDateTime(productMixCachedAt) : null;

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
              Top / low drinks{periodName ? ` · ${periodName}` : ''}
            </p>
            <h2 id="product-extremes-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
            {windowLabel ? (
              <p className="productExtremesWindow" role="status">
                Alert data window: <strong>{windowLabel}</strong>
                {dateRange ? ' (Kuwait calendar)' : ''}
                {mixAsOf ? (
                  <>
                    <br />
                    Mix snapshot: <strong>{mixAsOf}</strong>
                    {periodName === 'Today' ? ' — Today refreshes about every 10 min' : ''}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
          {distinct > 0 ? (
            <p className="productExtremesDistinct" role="status">
              <strong>{distinct}</strong> distinct drink{distinct === 1 ? '' : 's'} sold in{' '}
              {windowLabel ? <strong>{windowLabel}</strong> : 'this period'}
              {distinct < 5 ? ' — that is why Top is shorter than 5' : ''}.
            </p>
          ) : null}

          <p className="salesHistoryNote">
            Names only — highest and lowest by <strong>sales revenue (KD)</strong> in this Alert
            compare window. Lowest never repeats a Top drink.
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
                  No product mix for this window yet (cache still warming, or no sales).
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
                    ? `Only ${distinct} drink${distinct === 1 ? '' : 's'} in this window — not enough for a separate lowest list.`
                    : 'No product mix for this window yet.'}
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
