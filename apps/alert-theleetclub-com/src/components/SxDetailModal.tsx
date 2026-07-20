import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import type { SxAccelerationRow, SxSideMetrics } from '@/components/SxAccelerationCell';
import { apiGet } from '@/lib/api';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

type PerfDay = {
  date: string;
  weekday?: string;
  locationKwd?: number;
  locationPctOfTarget?: number | null;
  locationGrowthPct?: number | null;
  productCups?: number;
  productPctOfTarget?: number | null;
};

type PerfDetail = {
  days?: PerfDay[];
  locationSxPct?: number | null;
  productSxPct?: number | null;
  productName?: string | null;
  error?: string;
};

type Extreme = { date: string; value: number; weekday?: string };

function growthRate(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }
  if (previous === 0) {
    if (current > 0) return 1;
    if (current === 0) return 0;
    return null;
  }
  return (current - previous) / previous;
}

function pctPoints(ratio: number | null): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 1000) / 10;
}

function formatSxPts(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  return formatSalesTrendPct(Number(pct)).replace(/%$/, ' pts');
}

function toneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  if (Number(pct) > 0) return 'alertSalesUp';
  if (Number(pct) < 0) return 'alertSalesDown';
  return '';
}

function formatSideAmount(side: SxSideMetrics | null | undefined): string {
  if (!side || side.current == null || !Number.isFinite(Number(side.current))) return '—';
  const n = Number(side.current);
  if (side.unit === 'cups') return `${Math.round(n)} cups`;
  return formatKwd(n);
}

function extremeFrom(
  rows: Array<{ date: string; weekday?: string; value: number | null | undefined }>,
): { most: Extreme | null; least: Extreme | null } {
  const valid = rows.filter((r) => r.value != null && Number.isFinite(Number(r.value))) as Array<{
    date: string;
    weekday?: string;
    value: number;
  }>;
  if (!valid.length) return { most: null, least: null };
  let most = valid[0];
  let least = valid[0];
  for (const r of valid) {
    if (r.value > most.value) most = r;
    if (r.value < least.value) least = r;
  }
  return {
    most: { date: most.date, value: most.value, weekday: most.weekday },
    least: { date: least.date, value: least.value, weekday: least.weekday },
  };
}

function formatExtreme(ex: Extreme | null, asPts: boolean): string {
  if (!ex) return '—';
  const val = asPts
    ? formatSxPts(ex.value)
    : `${Number(ex.value).toFixed(1)}%`;
  const d = ex.date.length >= 10 ? ex.date.slice(5) : ex.date;
  const wd = ex.weekday ? `${ex.weekday} ` : '';
  return `${val} · ${wd}${d}`;
}

function SideCompare({
  title,
  side,
  labels,
}: {
  title: string;
  side?: SxSideMetrics | null;
  labels?: SxAccelerationRow['labels'];
}) {
  if (!side) return null;
  return (
    <div className="sxDetailSide">
      <h3 className="sxDetailSideTitle">{title}</h3>
      <div className="sxDetailCompareGrid">
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">{labels?.current || 'Current'}</span>
          <span className="sxDetailCompareVal">{formatSideAmount(side)}</span>
        </div>
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">{labels?.previous || 'Previous'}</span>
          <span className="sxDetailCompareVal">
            {side.previous == null
              ? '—'
              : side.unit === 'cups'
                ? `${Math.round(Number(side.previous))} cups`
                : formatKwd(Number(side.previous))}
          </span>
        </div>
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">{labels?.prior || 'Prior'}</span>
          <span className="sxDetailCompareVal">
            {side.prior == null
              ? '—'
              : side.unit === 'cups'
                ? `${Math.round(Number(side.prior))} cups`
                : formatKwd(Number(side.prior))}
          </span>
        </div>
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">Growth (cur)</span>
          <span className={`sxDetailCompareVal ${toneClass(side.growthCurrentPct)}`}>
            {side.growthCurrentPct != null ? formatSalesTrendPct(Number(side.growthCurrentPct)) : '—'}
          </span>
        </div>
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">Growth (prev)</span>
          <span className={`sxDetailCompareVal ${toneClass(side.growthPreviousPct)}`}>
            {side.growthPreviousPct != null ? formatSalesTrendPct(Number(side.growthPreviousPct)) : '—'}
          </span>
        </div>
        <div className="sxDetailCompareCard">
          <span className="sxDetailCompareLabel">SX</span>
          <span className={`sxDetailCompareVal ${toneClass(side.sxPct)}`}>{formatSxPts(side.sxPct)}</span>
          <span className="sxDetailCompareSub">cur growth − prev growth</span>
        </div>
      </div>
    </div>
  );
}

/**
 * SX detail popup — comparison windows + extremes from recent days.
 * Secondary CTA opens Performance for deeper charts.
 */
export function SxDetailModal({
  machineName,
  machineId,
  sxRow,
  performancePath,
  onClose,
}: {
  machineName: string;
  machineId: string;
  sxRow?: SxAccelerationRow | null;
  /** e.g. `/performance` or `/v2/performance` */
  performancePath: string;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  const histQ = useQuery({
    queryKey: ['alert-sx-history', machineId],
    queryFn: () =>
      apiGet<PerfDetail>(
        `/api/alert/performance/machine-detail?machineId=${encodeURIComponent(machineId)}&days=21`,
      ),
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });

  const extremes = useMemo(() => {
    const days = histQ.data?.days || [];
    const sxSeries: Array<{ date: string; weekday?: string; value: number | null }> = [];
    for (let i = 2; i < days.length; i++) {
      const cur = days[i]?.locationKwd;
      const prev = days[i - 1]?.locationKwd;
      const prior = days[i - 2]?.locationKwd;
      const g1 = growthRate(cur, prev);
      const g0 = growthRate(prev, prior);
      const sx = g1 != null && g0 != null ? pctPoints(g1 - g0) : null;
      sxSeries.push({ date: days[i].date, weekday: days[i].weekday, value: sx });
    }
    const targetSeries = days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      value: d.locationPctOfTarget,
    }));
    return {
      sx: extremeFrom(sxSeries),
      target: extremeFrom(targetSeries),
    };
  }, [histQ.data?.days]);

  const perfHref = `${performancePath}?machineId=${encodeURIComponent(machineId)}`;
  const locSx = sxRow?.location?.sxPct;
  const prodSx = sxRow?.product?.sxPct;

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sx-detail-title"
      {...backdrop}
    >
      <div className="salesHistoryModal sxDetailModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Sales acceleration · comparison</p>
            <h2 id="sx-detail-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <div className="sxDetailHeadActions">
            <Link
              to={perfHref}
              className="sxDetailPerfLink"
              title="Open Performance for charts and more history"
              onClick={onClose}
            >
              <span className="sxDetailPerfIcon" aria-hidden>
                ↗
              </span>
              <span>Performance</span>
            </Link>
            <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <AlertModalAnticipate />

        <div className="sxDetailLeadRow">
          <div className={`sxDetailLeadCard ${toneClass(locSx)}`}>
            <span className="sxDetailCompareLabel">Location SX</span>
            <span className="sxDetailLeadVal">{formatSxPts(locSx)}</span>
          </div>
          <div className={`sxDetailLeadCard ${toneClass(prodSx)}`}>
            <span className="sxDetailCompareLabel">
              Product SX{sxRow?.productName ? ` · ${sxRow.productName}` : ''}
            </span>
            <span className="sxDetailLeadVal">{formatSxPts(prodSx)}</span>
          </div>
        </div>

        <SideCompare title="Location (KD)" side={sxRow?.location} labels={sxRow?.labels} />
        <SideCompare
          title={`Product cups${sxRow?.productName ? ` · ${sxRow.productName}` : ''}`}
          side={sxRow?.product}
          labels={sxRow?.labels}
        />

        <section className="sxDetailExtremes">
          <h3 className="sxDetailSideTitle">Recent extremes (21 days)</h3>
          {histQ.isLoading ? <p className="salesHistorySub">Loading day history…</p> : null}
          {histQ.isError || histQ.data?.error ? (
            <p className="salesHistorySub">Could not load day history for extremes.</p>
          ) : null}
          <div className="sxDetailCompareGrid">
            <div className="sxDetailCompareCard">
              <span className="sxDetailCompareLabel">Most SX (Loc)</span>
              <span className={`sxDetailCompareVal ${toneClass(extremes.sx.most?.value)}`}>
                {formatExtreme(extremes.sx.most, true)}
              </span>
            </div>
            <div className="sxDetailCompareCard">
              <span className="sxDetailCompareLabel">Least SX (Loc)</span>
              <span className={`sxDetailCompareVal ${toneClass(extremes.sx.least?.value)}`}>
                {formatExtreme(extremes.sx.least, true)}
              </span>
            </div>
            <div className="sxDetailCompareCard">
              <span className="sxDetailCompareLabel">Best target achieved</span>
              <span className="sxDetailCompareVal">{formatExtreme(extremes.target.most, false)}</span>
              <span className="sxDetailCompareSub">% of daily location target</span>
            </div>
            <div className="sxDetailCompareCard">
              <span className="sxDetailCompareLabel">Worst target achieved</span>
              <span className="sxDetailCompareVal">{formatExtreme(extremes.target.least, false)}</span>
              <span className="sxDetailCompareSub">% of daily location target</span>
            </div>
          </div>
        </section>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
