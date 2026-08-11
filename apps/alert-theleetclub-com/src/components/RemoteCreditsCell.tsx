import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import {
  getAlertModalPortal,
  modalBackdropHandlers,
  modalPanelHandlers,
  useAlertModal,
} from '@/lib/useAlertModal';
import { bindStopRowClick } from '@/lib/stopRowClick';

type CreditsDetail = {
  date?: string;
  machineId?: string;
  machineName?: string | null;
  note?: string;
  summary?: {
    credits_sent?: number;
    total_kd?: number;
    loss_kd?: number;
    custom_refunds_count?: number;
    custom_refunds_kd?: number;
    drink_tests_count?: number;
    drink_tests_kd?: number;
    reason_unidentified_count?: number;
    reason_unidentified_kd?: number;
  };
  logs?: Array<{
    datetime?: string;
    category?: string;
    credit_amount?: number;
    product_name?: string;
    user_name?: string;
    matched_remote_credit?: boolean;
    matched_failed_dispense?: boolean;
  }>;
  error?: string;
};

function fmtKd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(3)} KD`;
}

function CreditsDetailModal({
  machineId,
  machineName,
  onClose,
}: {
  machineId: string;
  machineName: string;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const detailQ = useQuery({
    queryKey: ['alert-remote-credits-detail', machineId],
    queryFn: () =>
      apiGet<CreditsDetail>(
        `/api/alert/remote-credits/machine-detail?machine_id=${encodeURIComponent(machineId)}`,
      ),
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });
  const s = detailQ.data?.summary;
  const portal = getAlertModalPortal();
  if (!portal) return null;

  const lossKd = s?.loss_kd;
  const lossNum = lossKd != null && Number.isFinite(Number(lossKd)) ? Number(lossKd) : null;

  return createPortal(
    <div className="salesHistoryBackdrop" role="presentation" {...backdrop}>
      <div
        className="salesHistoryModal remoteCreditsModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rc-credits-title"
        {...panel}
      >
        <header className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Credits sent · lost revenue</p>
            <h2 id="rc-credits-title" className="salesHistoryTitle">
              {machineName || machineId}
            </h2>
            <p className="salesHistorySub">
              #{machineId}
              {detailQ.data?.date ? ` · ${detailQ.data.date} (Kuwait)` : ''}
            </p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="salesHistoryBody">
          {detailQ.isLoading ? <AlertModalAnticipate hint="Credits insight incoming" lines={4} /> : null}
          {detailQ.isError ? <p className="salesHistoryNote">{(detailQ.error as Error).message}</p> : null}
          {detailQ.data?.error ? <p className="salesHistoryNote">{detailQ.data.error}</p> : null}

          {s ? (
            <>
              <section className="remoteCreditsLossHero" aria-live="polite">
                <p className="remoteCreditsLossHeroLabel">Est. lost revenue today</p>
                <p className="remoteCreditsLossHeroValue">{fmtKd(lossNum)}</p>
                <p className="remoteCreditsLossHeroHint">
                  Drink tests + custom refunds + reason unidentified (WEB cashless non-sale KD). Not
                  subtracted from board sales.
                </p>
              </section>

              <section className="operatorWorkflowSection">
                <h3 className="salesHistoryCompareTitle">Breakdown</h3>
                <ul className="salesHistoryList">
                  <li className="salesHistoryRow">
                    <span>WEB cashless events</span>
                    <strong>{s.credits_sent ?? 0}</strong>
                  </li>
                  <li className="salesHistoryRow">
                    <span>WEB cashless KD (all)</span>
                    <strong>{fmtKd(s.total_kd)}</strong>
                  </li>
                  <li className="salesHistoryRow">
                    <span>Drink tests</span>
                    <strong>
                      {s.drink_tests_count ?? 0} · {fmtKd(s.drink_tests_kd)}
                    </strong>
                  </li>
                  <li className="salesHistoryRow">
                    <span>Custom refunds</span>
                    <strong>
                      {s.custom_refunds_count ?? 0} · {fmtKd(s.custom_refunds_kd)}
                    </strong>
                  </li>
                  <li className="salesHistoryRow">
                    <span>Reason unidentified</span>
                    <strong>
                      {s.reason_unidentified_count ?? 0} · {fmtKd(s.reason_unidentified_kd)}
                    </strong>
                  </li>
                </ul>
                {detailQ.data?.note ? <p className="salesHistoryNote">{detailQ.data.note}</p> : null}
              </section>
            </>
          ) : null}

          {(detailQ.data?.logs?.length || 0) > 0 ? (
            <section className="operatorWorkflowSection remoteCreditsLogSection">
              <h3 className="salesHistoryCompareTitle">
                Recent events ({detailQ.data!.logs!.length})
              </h3>
              <ul className="salesHistoryList remoteCreditsLogList">
                {detailQ.data!.logs!.map((row, i) => (
                  <li key={`${row.datetime}-${i}`} className="salesHistoryRow">
                    <div className="remoteCreditsLogMeta">
                      <strong>{row.category || '—'}</strong>
                      <span className="muted remoteCreditsLogSub">
                        {[row.datetime, row.product_name, row.user_name].filter(Boolean).join(' · ')}
                        {row.matched_remote_credit ? ' · matched remote credit' : ''}
                        {row.matched_failed_dispense ? ' · matched failed dispense' : ''}
                      </span>
                    </div>
                    <strong className="remoteCreditsLogAmt">{fmtKd(row.credit_amount)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    portal,
  );
}

export function RemoteCreditsCell({
  machineId,
  machineName,
  count,
  toneClassName,
}: {
  machineId: string;
  machineName: string;
  count: number;
  toneClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className={`rfCreditsBtn ${toneClassName}`.trim()}
        title="Open credits insights — lost revenue (WEB cashless / tests / refunds)"
        {...bindStopRowClick(() => setOpen(true))}
      >
        {String(count)}
      </button>
      {open ? <CreditsDetailModal machineId={machineId} machineName={machineName} onClose={close} /> : null}
    </>
  );
}
