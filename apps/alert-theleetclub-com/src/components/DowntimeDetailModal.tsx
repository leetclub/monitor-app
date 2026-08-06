import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import {
  formatDowntimeClock,
  formatDowntimeSec,
  formatDowntimeTrendPct,
  formatHourlyKwd,
  formatLossKwd,
  formatPeakMult,
  type DowntimeDetailResponse,
  type DowntimeProjection,
} from '@/lib/downtimeDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

function ProjectionCalculator({
  projection,
  baselineMissing,
  spoilageSource,
  waste,
  heading = 'Projected revenue loss',
}: {
  projection?: DowntimeProjection | null;
  baselineMissing?: boolean;
  spoilageSource?: string | null;
  waste?: DowntimeDetailResponse['waste'];
  heading?: string;
}) {
  if (!projection || baselineMissing || projection.baselineHourlyKwd == null) {
    if (!projection && !baselineMissing) return null;
    return (
      <section className="operatorWorkflowSection" style={{ marginTop: 10 }}>
        <h3 className="salesHistoryCompareTitle">{heading}</h3>
        <p className="salesHistoryNote">
          No sales baseline for this machine (recent same-elapsed days had ~0 KD). Cannot project revenue
          loss until there is a positive hourly rate from yesterday or another recent day.
        </p>
      </section>
    );
  }
  const spoil =
    projection.spoilageKwd != null && Number.isFinite(Number(projection.spoilageKwd))
      ? Number(projection.spoilageKwd)
      : null;
  const spoilTracked = spoil != null && spoil > 0.004;
  const spoilFromWaste = spoilageSource === 'monitor_waste';
  const wasteNote =
    spoilFromWaste && waste
      ? `Monitor waste today: ${waste.wasteCups != null ? `${waste.wasteCups} cups` : '—'}${
          waste.wastePct != null ? ` · ${Number(waste.wastePct).toFixed(1)}%` : ''
        } × avg vend ${formatLossKwd(waste.avgVendKwd)} (stock − sales, same as Overall Waste)`
      : spoilFromWaste
        ? 'Monitor waste (stock − sales) × avg vend — same source as Overall Waste %'
        : 'Direct cost of wasted / expired inventory';
  const rows: Array<{ factor: string; amount: string; impact: string }> = [
    {
      factor: 'Revenue baseline',
      amount: formatHourlyKwd(projection.baselineHourlyKwd),
      impact: 'Yesterday same-elapsed KD ÷ hours (fallback: recent positive days)',
    },
    {
      factor: 'Opportunity cost',
      amount: formatLossKwd(projection.opportunityCostKwd),
      impact: `Baseline × ${projection.downtimeHours != null ? `${Number(projection.downtimeHours).toFixed(2)}h` : '—'} × peak ${formatPeakMult(projection.peakMultiplier)}`,
    },
  ];
  if (spoilTracked || spoilFromWaste) {
    rows.push({
      factor: 'Spoilage impact',
      amount: spoilTracked ? formatLossKwd(spoil) : '0.00 KD',
      impact: waste?.error
        ? `Waste lookup failed: ${waste.error}`
        : waste?.skipped
          ? String(waste.reason || 'Waste API key not configured')
          : waste?.note === 'no_refill_data'
            ? 'No refill / area-override data for today yet'
            : wasteNote,
    });
  }
  rows.push(
    {
      factor: spoilTracked ? 'Final economic impact' : 'Projected revenue loss',
      amount: formatLossKwd(projection.finalEconomicImpactKwd ?? projection.opportunityCostKwd),
      impact: spoilTracked ? 'Missed sales + estimated waste KD' : 'Missed sales only (no waste cups today)',
    },
    {
      factor: 'Volume impact',
      amount:
        projection.volumeImpact != null && Number.isFinite(projection.volumeImpact)
          ? String(Math.round(Number(projection.volumeImpact)))
          : '—',
      impact: `Est. missed purchases (÷ ${formatLossKwd(projection.avgVendKwd)} avg vend)`,
    },
  );

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
  trendPct: trendPctProp,
  onClose,
}: {
  machineId: string;
  machineName: string;
  todayLabel?: string;
  periodLabel?: string;
  todaySec?: number | null;
  periodSec?: number | null;
  trendPct?: number | null;
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

  const todayMins = todaySec ?? data?.todayMergedOperationalSec;
  const yestMins = periodSec ?? data?.yesterdaySameElapsedSec;
  const trendPct =
    trendPctProp != null && Number.isFinite(Number(trendPctProp))
      ? Number(trendPctProp)
      : data?.trendPct != null && Number.isFinite(Number(data.trendPct))
        ? Number(data.trendPct)
        : null;
  const worse = trendPct != null && trendPct > 0;
  const better = trendPct != null && trendPct < 0;

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
          <p className="salesHistoryNote" style={{ fontSize: '0.95rem' }}>
            {todayLabel}: <strong>{formatDowntimeSec(todayMins)}</strong>
            {' · '}
            vs {periodLabel} (same elapsed): <strong>{formatDowntimeSec(yestMins)}</strong>
            {trendPct != null ? (
              <>
                {' · '}
                <strong className={worse ? 'alertSalesDown' : better ? 'alertSalesUp' : undefined}>
                  {worse ? '▲ ' : better ? '▼ ' : ''}
                  {formatDowntimeTrendPct(trendPct)}
                </strong>
              </>
            ) : null}
            {projection?.finalEconomicImpactKwd != null ? (
              <>
                {' · '}
                Projected impact: <strong>{formatLossKwd(projection.finalEconomicImpactKwd)}</strong>
              </>
            ) : null}
          </p>
          <p className="salesHistoryNote" style={{ opacity: 0.85, fontSize: '0.78rem' }}>
            <strong>Projected loss</strong> = yesterday same-elapsed KD/h × today downtime hours × peak
            multiplier. Spoilage = Monitor waste for today (motion refills − Vendon sales) × avg vend —
            same source as Overall Waste %. The reference block below is actual vends in the same clock
            minutes as today&apos;s OFF — often 0 if that slice was quiet.
          </p>
        </section>

        {q.isLoading ? <AlertModalAnticipate hint="Loss calculator incoming" lines={5} /> : null}
        {q.isError ? (
          <p className="stitchOpsAlert">{(q.error as Error).message || 'Could not load downtime detail'}</p>
        ) : null}

        {!q.isLoading ? (
          <ProjectionCalculator
            projection={projection}
            baselineMissing={Boolean(data?.baselineMissing) || projection?.baselineHourlyKwd == null}
            spoilageSource={data?.spoilageSource}
            waste={data?.waste}
          />
        ) : null}

        {baselines.length ? (
          <section className="operatorWorkflowSection" style={{ marginTop: 10 }}>
            <h3 className="salesHistoryCompareTitle">Reference · same clock as today&apos;s OFF</h3>
            <p className="salesHistoryNote" style={{ marginTop: 0, opacity: 0.85, fontSize: '0.75rem' }}>
              Not the loss formula. Day rate = same-elapsed sales used for KD/h. Window = actual KD sold
              on that day during the exact OFF clock minutes (often 0).
            </p>
            <ul className="salesHistoryList">
              {baselines.map((b) => {
                const id = String(b.id || b.label || '');
                const observed = data?.observedSalesTodayKwd?.[id] ?? data?.estimatedLossTodayKwd?.[id];
                const dayKwd = b.kwd != null && Number.isFinite(Number(b.kwd)) ? Number(b.kwd) : null;
                const windowKwd =
                  observed != null && Number.isFinite(Number(observed)) ? Number(observed) : null;
                return (
                  <li key={id} className="salesHistoryRow">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <span className="salesHistoryCompareTitle">
                        {b.label}
                        {b.primary ? ' · primary rate' : ''}
                        {b.date ? ` · ${b.date}` : ''}
                      </span>
                      <span className="salesHistoryNote" style={{ margin: 0, opacity: 0.8, fontSize: '0.75rem' }}>
                        Day same-elapsed:{' '}
                        {dayKwd != null ? formatLossKwd(dayKwd) : '—'}
                        {' · '}
                        In OFF clock window:{' '}
                        {windowKwd != null
                          ? windowKwd < 0.005
                            ? '0 (no vends in that slice)'
                            : formatLossKwd(windowKwd)
                          : '—'}
                      </span>
                    </div>
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
