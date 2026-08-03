import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  formatDowntimeClock,
  formatDowntimeSec,
  formatLossKwd,
  type DowntimeDetailResponse,
} from '@/lib/downtimeDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function DowntimeDetailModal({
  machineId,
  machineName,
  todayLabel = 'Today',
  periodLabel = 'Period',
  todaySec,
  periodSec,
  onClose,
}: {
  machineId: string;
  machineName: string;
  todayLabel?: string;
  periodLabel?: string;
  todaySec?: number | null;
  periodSec?: number | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  const q = useQuery({
    queryKey: ['alert-downtime-detail', machineId],
    queryFn: () => {
      const params = new URLSearchParams({ machine_id: machineId });
      if (machineName) params.set('machine_name', machineName);
      return apiGet<DowntimeDetailResponse>(`/api/alert/overall/downtime-detail?${params.toString()}`);
    },
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });

  const data = q.data;
  const events = data?.events ?? [];
  const baselines = data?.baselines ?? [];
  const primaryBaseline = baselines.find((b) => b.primary) ?? baselines[0];

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Downtime events · estimated loss</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="operatorWorkflowSection">
          <p className="salesHistoryNote">
            {todayLabel}: <strong>{formatDowntimeSec(todaySec ?? data?.todayMergedOperationalSec)}</strong>
            {' · '}
            {periodLabel}: <strong>{formatDowntimeSec(periodSec)}</strong>
            {data?.estimatedLossTodayPrimaryKwd != null ? (
              <>
                {' · '}
                Est. loss today ({primaryBaseline?.label || 'baseline'}):{' '}
                <strong>{formatLossKwd(data.estimatedLossTodayPrimaryKwd)}</strong>
              </>
            ) : null}
          </p>
          <p className="salesHistoryNote" style={{ opacity: 0.85, fontSize: '0.78rem' }}>
            Loss uses each machine&apos;s same-elapsed sales rate × operational downtime (cleaning windows
            subtracted). <strong>Primary = yesterday</strong>; also shows day before and same weekday last week.
            Concurrent OFF types are listed separately; the today total merges overlaps.
          </p>
        </section>

        {baselines.length ? (
          <section className="operatorWorkflowSection" style={{ marginTop: 10 }}>
            <h3 className="salesHistoryCompareTitle">Sales rate baselines</h3>
            <ul className="salesHistoryList">
              {baselines.map((b) => (
                <li key={b.id || b.label} className="salesHistoryRow">
                  <span className="salesHistoryCompareTitle">
                    {b.label}
                    {b.primary ? ' · primary' : ''}
                    {b.date ? ` · ${b.date}` : ''}
                  </span>
                  <span className="salesHistoryGridVal">
                    {b.kwd != null && Number.isFinite(b.kwd)
                      ? `${Number(b.kwd).toFixed(2)} KD / ${formatDowntimeSec(b.elapsedSec)}`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="operatorWorkflowSection" style={{ marginTop: 12 }}>
          <h3 className="salesHistoryCompareTitle">Today&apos;s OFF events</h3>
          {q.isLoading ? <AlertModalAnticipate hint="Downtime events incoming" lines={4} /> : null}
          {q.isError ? (
            <p className="stitchOpsAlert">{(q.error as Error).message || 'Could not load downtime detail'}</p>
          ) : null}
          {!q.isLoading && !events.length ? (
            <p className="salesHistoryEmpty">No OFF events overlapping Kuwait today</p>
          ) : null}
          {events.length ? (
            <ul className="salesHistoryList">
              {events.map((ev, i) => {
                const start = formatDowntimeClock(ev.startAt);
                const end = ev.open
                  ? 'now'
                  : formatDowntimeClock(ev.endAt || ev.endAtEffective);
                const lossBits = baselines
                  .map((b) => {
                    const id = String(b.id || b.label || '');
                    const v = ev.estimatedLossKwd?.[id];
                    if (v == null || !Number.isFinite(Number(v))) return null;
                    return `${b.label}: ${formatLossKwd(Number(v))}`;
                  })
                  .filter(Boolean);
                return (
                  <li key={`${ev.startAt}-${ev.eventType}-${i}`} className="salesHistoryRow">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span className="salesHistoryCompareTitle">
                        {ev.eventType || 'OFF'}
                        {ev.open ? ' · open' : ''}
                      </span>
                      <span className="salesHistoryNote" style={{ margin: 0 }}>
                        {start} → {end} · {formatDowntimeSec(ev.operationalSec)}
                        {ev.estimatedLossPrimaryKwd != null ? (
                          <>
                            {' · '}
                            <strong>{formatLossKwd(ev.estimatedLossPrimaryKwd)}</strong>
                            {primaryBaseline?.label ? ` vs ${primaryBaseline.label}` : ''}
                          </>
                        ) : null}
                      </span>
                      {lossBits.length > 1 ? (
                        <span className="salesHistoryNote" style={{ margin: 0, opacity: 0.8, fontSize: '0.75rem' }}>
                          {lossBits.join(' · ')}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
