import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  formatDowntimeClock,
  formatDowntimeSec,
  formatHourlyKwd,
  formatLossKwd,
  formatPeakMult,
  type DowntimeDetailResponse,
  type DowntimeProjection,
} from '@/lib/downtimeDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

function ProjectionCalculator({
  projection,
  heading = 'Projected revenue loss',
}: {
  projection?: DowntimeProjection | null;
  heading?: string;
}) {
  if (!projection) return null;
  const rows: Array<{ factor: string; amount: string; impact: string }> = [
    {
      factor: 'Revenue baseline',
      amount: formatHourlyKwd(projection.baselineHourlyKwd),
      impact: 'Income rate per active operating hour',
    },
    {
      factor: 'Opportunity cost',
      amount: formatLossKwd(projection.opportunityCostKwd),
      impact: `Baseline × ${projection.downtimeHours != null ? `${Number(projection.downtimeHours).toFixed(2)}h` : '—'} × peak ${formatPeakMult(projection.peakMultiplier)}`,
    },
    {
      factor: 'Spoilage impact',
      amount: formatLossKwd(projection.spoilageKwd ?? 0),
      impact: 'Direct cost of wasted / expired inventory',
    },
    {
      factor: 'Final economic impact',
      amount: formatLossKwd(projection.finalEconomicImpactKwd),
      impact: 'Missed sales + inventory loss',
    },
    {
      factor: 'Volume impact',
      amount:
        projection.volumeImpact != null && Number.isFinite(projection.volumeImpact)
          ? String(Math.round(Number(projection.volumeImpact)))
          : '—',
      impact: `Est. missed purchases (÷ ${formatLossKwd(projection.avgVendKwd)} avg vend)`,
    },
  ];

  return (
    <section className="operatorWorkflowSection" style={{ marginTop: 10 }}>
      <h3 className="salesHistoryCompareTitle">{heading}</h3>
      <ul className="salesHistoryList">
        {rows.map((r) => (
          <li key={r.factor} className="salesHistoryRow">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span className="salesHistoryCompareTitle">{r.factor}</span>
              <span className="salesHistoryNote" style={{ margin: 0, opacity: 0.8, fontSize: '0.75rem' }}>
                {r.impact}
              </span>
            </div>
            <span className="salesHistoryGridVal" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {r.amount}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const projection = data?.projection;
  const primaryBaseline = baselines.find((b) => b.primary) ?? baselines[0];

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Downtime · revenue loss calculator</p>
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
            {projection?.finalEconomicImpactKwd != null ? (
              <>
                {' · '}
                Projected impact:{' '}
                <strong>{formatLossKwd(projection.finalEconomicImpactKwd)}</strong>
              </>
            ) : null}
          </p>
          <p className="salesHistoryNote" style={{ opacity: 0.85, fontSize: '0.78rem' }}>
            <strong>Projected loss</strong> = baseline hourly revenue × downtime hours × peak multiplier
            (+ spoilage). Baseline = yesterday same-elapsed KD ÷ hours. Peak bands (Kuwait): off-peak ×0.35,
            morning ×0.85, peak 09–14 ×1.9, afternoon ×1.15, evening ×0.65. Observed same-clock sales on
            comparison days are shown for reference.
          </p>
        </section>

        {q.isLoading ? <AlertModalAnticipate hint="Loss calculator incoming" lines={5} /> : null}
        {q.isError ? (
          <p className="stitchOpsAlert">{(q.error as Error).message || 'Could not load downtime detail'}</p>
        ) : null}

        {!q.isLoading ? <ProjectionCalculator projection={projection} /> : null}

        {baselines.length ? (
          <section className="operatorWorkflowSection" style={{ marginTop: 10 }}>
            <h3 className="salesHistoryCompareTitle">Observed same-clock sales (reference)</h3>
            <ul className="salesHistoryList">
              {baselines.map((b) => {
                const id = String(b.id || b.label || '');
                const observed = data?.observedSalesTodayKwd?.[id] ?? data?.estimatedLossTodayKwd?.[id];
                return (
                  <li key={id} className="salesHistoryRow">
                    <span className="salesHistoryCompareTitle">
                      {b.label}
                      {b.primary ? ' · primary rate source' : ''}
                      {b.date ? ` · ${b.date}` : ''}
                    </span>
                    <span className="salesHistoryGridVal">
                      {observed != null && Number.isFinite(Number(observed))
                        ? formatLossKwd(Number(observed))
                        : b.kwd != null && Number.isFinite(b.kwd)
                          ? `day ${Number(b.kwd).toFixed(2)} KD`
                          : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="operatorWorkflowSection" style={{ marginTop: 12 }}>
          <h3 className="salesHistoryCompareTitle">Today&apos;s OFF events</h3>
          {!q.isLoading && !events.length ? (
            <p className="salesHistoryEmpty">No OFF events overlapping Kuwait today</p>
          ) : null}
          {events.length ? (
            <ul className="salesHistoryList">
              {events.map((ev, i) => {
                const start = formatDowntimeClock(ev.startAt);
                const end = ev.open ? 'now' : formatDowntimeClock(ev.endAt || ev.endAtEffective);
                const proj = ev.projection;
                const observedBits = baselines
                  .map((b) => {
                    const id = String(b.id || b.label || '');
                    const v = ev.observedSalesKwd?.[id] ?? ev.estimatedLossKwd?.[id];
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
                        {proj?.peakMultiplier != null ? (
                          <>
                            {' · '}
                            peak {formatPeakMult(proj.peakMultiplier)}
                            {proj.peakBand ? ` (${proj.peakBand})` : ''}
                          </>
                        ) : null}
                        {proj?.opportunityCostKwd != null ? (
                          <>
                            {' · '}
                            <strong>{formatLossKwd(proj.opportunityCostKwd)}</strong> projected
                          </>
                        ) : ev.estimatedLossPrimaryKwd != null ? (
                          <>
                            {' · '}
                            <strong>{formatLossKwd(ev.estimatedLossPrimaryKwd)}</strong>
                            {primaryBaseline?.label ? ` vs ${primaryBaseline.label}` : ''}
                          </>
                        ) : null}
                      </span>
                      {observedBits.length ? (
                        <span className="salesHistoryNote" style={{ margin: 0, opacity: 0.8, fontSize: '0.75rem' }}>
                          Observed: {observedBits.join(' · ')}
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
