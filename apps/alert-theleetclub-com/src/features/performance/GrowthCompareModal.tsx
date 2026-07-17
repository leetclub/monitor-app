import { createPortal } from 'react-dom';
import { formatKwd } from '@/lib/salesDisplay';
import {
  getAlertModalPortal,
  modalBackdropHandlers,
  modalPanelHandlers,
  useAlertModal,
} from '@/lib/useAlertModal';
import type { GrowthGroupSlice, GrowthGroupKey } from '@/features/performance/perfTypes';

const GROUP_LABEL: Record<GrowthGroupKey, string> = {
  all: 'All machines',
  top5: 'Top 5 (by sales)',
  lowest5: 'Lowest 5 (by sales)',
};

function rateTone(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '';
  if (rate >= 100) return 'alertSalesUp';
  return 'alertSalesDown';
}

/** Growth change % from index (current ÷ compare × 100). */
function growthDeltaPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const d = Math.round((rate - 100) * 10) / 10;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
}

export function GrowthCompareModal({
  title,
  subtitle,
  compareLabel,
  indexLabel = 'Index',
  windowLabel,
  groups,
  onClose,
}: {
  title: string;
  subtitle?: string;
  compareLabel: string;
  /** Column / summary for period ÷ compare × 100. */
  indexLabel?: string;
  windowLabel?: string;
  groups: Partial<Record<GrowthGroupKey, GrowthGroupSlice | null | undefined>>;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const keys: GrowthGroupKey[] = ['all', 'top5', 'lowest5'];

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="perf-growth-modal-title"
      {...backdrop}
    >
      <div className="salesHistoryModal perfGrowthModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Performance · period compare</p>
            <h2 id="perf-growth-modal-title" className="salesHistoryTitle">
              {title}
            </h2>
            {subtitle ? <p className="salesHistorySub">{subtitle}</p> : null}
            {windowLabel ? <p className="salesHistorySub">Selected period: {windowLabel}</p> : null}
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="perfGrowthModalBody">
          {keys.map((key) => {
            const g = groups[key];
            if (!g) return null;
            return (
              <section key={key} className="perfGrowthGroup">
                <header className="perfGrowthGroupHead">
                  <h3>{GROUP_LABEL[key]}</h3>
                  <div className="perfGrowthGroupSummary">
                    <span className={rateTone(g.ratePct)}>
                      Growth <strong>{growthDeltaPct(g.ratePct)}</strong>
                    </span>
                    <span>
                      Period <strong>{formatKwd(g.periodKd)}</strong>
                    </span>
                    <span>
                      {compareLabel} <strong>{formatKwd(g.compareKd)}</strong>
                    </span>
                    <span className={rateTone(g.ratePct)}>
                      {indexLabel} <strong>{g.ratePct != null ? `${g.ratePct}%` : '—'}</strong>
                    </span>
                  </div>
                </header>
                {(g.machines || []).length ? (
                  <div className="perfGrowthTableWrap">
                    <table className="perfGrowthTable">
                      <thead>
                        <tr>
                          <th>Machine</th>
                          <th>Period KD</th>
                          <th>{compareLabel}</th>
                          <th>Growth</th>
                          <th>{indexLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(g.machines || []).map((row) => (
                          <tr key={row.machineId}>
                            <td>{row.machineName}</td>
                            <td>{formatKwd(row.periodKd)}</td>
                            <td>{formatKwd(row.compareKd)}</td>
                            <td className={rateTone(row.ratePct)}>{growthDeltaPct(row.ratePct)}</td>
                            <td className={rateTone(row.ratePct)}>
                              {row.ratePct != null ? `${row.ratePct}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="perfMuted">No machines in this group.</p>
                )}
              </section>
            );
          })}
          <p className="perfGrowthFoot">
            <strong>Growth</strong> is the signed change people expect (e.g. −1.2%).{' '}
            <strong>Index</strong> is period ÷ compare × 100 (100 = flat). Top / Lowest 5 ranked by
            period sales KD.
          </p>
        </div>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
