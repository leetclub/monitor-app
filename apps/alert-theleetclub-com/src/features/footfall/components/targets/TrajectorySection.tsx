import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPeriodSales, fetchTodaySales } from '@/features/footfall/lib/api';
import type { TodaySalesRow } from '@/features/footfall/lib/todaySales';
import { resolveTodaySales } from '@/features/footfall/lib/todaySales';
import { cupsInt, formatCups } from '@/features/footfall/lib/formatCups';
import {
  TRAJECTORY_CUP_PRICE_KD,
  targetCupsPerDayFromRevenue,
  targetRevenuePerDay,
  weekRevenueTargetKdRounded,
} from '@/features/footfall/lib/weekRevenueTarget';
import {
  formatAccessDayBanner,
  kuwaitSundayWeekStartForYmd,
  kuwaitYmd,
  weekRevenuePeriodEndYmd,
} from '@/features/footfall/lib/kuwaitBusinessDay';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import type { LocationReport } from '@/features/footfall/lib/types';
import { targetBusinessDaysForSegment } from '@/features/footfall/lib/weekRevenueTarget';

const LIVE_REFRESH_MS = 90_000;

type Props = {
  location: LocationReport;
  /** Live business day from Kuwait context (default for the date picker). */
  defaultSalesYmd: string;
  /** target.theleetclub.com — hide date picker, always use live business day. */
  hideDateLabels?: boolean;
};

type DailyTargetCard = {
  id: string;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  detailTitle: string;
  detailBody: string[];
};

function fmtTargetKd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} KD`;
}

function fmtActualKd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)} KD`;
}

function cupsSoldToday(todaySales: TodaySalesRow): number {
  return todaySales.cupsCashless > 0 ? todaySales.cupsCashless : todaySales.cups;
}

function todayRevenueKd(todaySales: TodaySalesRow): number {
  const cups = cupsSoldToday(todaySales);
  if (
    todaySales.cupsCashless > 0 &&
    todaySales.revenueCashlessKd != null &&
    todaySales.revenueCashlessKd > 0
  ) {
    return todaySales.revenueCashlessKd;
  }
  if (todaySales.revenueKd != null && todaySales.revenueKd > 0) {
    return todaySales.revenueKd;
  }
  return cups * TRAJECTORY_CUP_PRICE_KD;
}

function avgCupPriceKd(revenue: number, cups: number): string | null {
  if (cups <= 0 || revenue <= 0) return null;
  return (revenue / cups).toFixed(2);
}

function todaySalesSourceLabel(source: TodaySalesRow['source'], isLiveDay: boolean): string {
  if (source === 'live') {
    return isLiveDay
      ? 'Live Vendon (today-sales API)'
      : 'Vendon historical day (today-sales API)';
  }
  if (source === 'period') return 'Reference period report (fallback)';
  return 'No sales feed for this day';
}

function weekRevenueFromRow(
  row: { revenueCashlessKd?: number; revenueKd?: number } | undefined,
): number | undefined {
  if (!row) return undefined;
  if (row.revenueCashlessKd != null && row.revenueCashlessKd > 0) {
    return row.revenueCashlessKd;
  }
  return row.revenueKd;
}

export function TrajectorySection({
  location,
  defaultSalesYmd,
  hideDateLabels,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedYmd, setSelectedYmd] = useState(defaultSalesYmd);
  const kuwaitTodayYmd = kuwaitYmd();

  useEffect(() => {
    setSelectedYmd(defaultSalesYmd);
  }, [defaultSalesYmd]);

  const isLiveDay = selectedYmd === defaultSalesYmd;
  const weekStartYmd = useMemo(
    () => kuwaitSundayWeekStartForYmd(selectedYmd),
    [selectedYmd],
  );
  const weekEndYmd = useMemo(
    () => weekRevenuePeriodEndYmd(selectedYmd, kuwaitTodayYmd),
    [selectedYmd, kuwaitTodayYmd],
  );
  const isPastWeek = weekEndYmd !== kuwaitTodayYmd;
  const machineId = location.machineId;

  const dayQuery = useQuery({
    queryKey: ['daily-target-day', selectedYmd, machineId],
    queryFn: () => fetchTodaySales(selectedYmd, [machineId]),
    staleTime: isLiveDay ? 20_000 : 120_000,
    refetchInterval: isLiveDay ? LIVE_REFRESH_MS : false,
    retry: 2,
  });

  const weekQuery = useQuery({
    queryKey: ['daily-target-week', weekStartYmd, weekEndYmd, machineId],
    queryFn: () => fetchPeriodSales(weekStartYmd, weekEndYmd, [machineId]),
    staleTime: isLiveDay ? 20_000 : 120_000,
    refetchInterval: isLiveDay ? LIVE_REFRESH_MS : false,
    retry: 2,
  });

  const daySales = useMemo(
    () =>
      resolveTodaySales(
        machineId,
        null,
        dayQuery.data,
        selectedYmd,
        dayQuery.isSuccess,
      ),
    [machineId, dayQuery.data, dayQuery.isSuccess, selectedYmd],
  );

  const daySalesLoading = dayQuery.isLoading || dayQuery.isFetching;
  const weekSalesLoading = weekQuery.isLoading || weekQuery.isFetching;
  const weekRev = weekRevenueFromRow(weekQuery.data?.[machineId]);

  const segment = inferOwnerSegment(location);
  const businessDays = targetBusinessDaysForSegment(segment);
  const weekTarget = weekRevenueTargetKdRounded(location.locationName);
  const targetRevDay = weekTarget != null ? targetRevenuePerDay(weekTarget, segment) : null;
  const targetCupsDay =
    targetRevDay != null ? targetCupsPerDayFromRevenue(targetRevDay) : null;

  const daySalesKnown = !daySalesLoading && daySales.source !== 'none';
  const dayCups = daySalesKnown ? cupsSoldToday(daySales) : null;
  const dayCupsInt = dayCups != null ? cupsInt(dayCups) : null;
  const dayRev = daySalesKnown ? todayRevenueKd(daySales) : null;
  const avgCupPrice =
    dayCups != null && dayRev != null ? avgCupPriceKd(dayRev, dayCups) : null;

  const weekPct =
    weekTarget != null && weekTarget > 0 && weekRev != null
      ? Math.round((weekRev / weekTarget) * 10000) / 100
      : null;
  const dayPct =
    targetRevDay != null && targetRevDay > 0 && dayRev != null
      ? Math.round((dayRev / targetRevDay) * 10000) / 100
      : null;

  const cupsSoldLabel = isLiveDay ? 'Cups sold today' : 'Cups sold';

  const cards = useMemo<DailyTargetCard[]>(() => {
    const list: DailyTargetCard[] = [
      {
        id: 'target-cups',
        label: 'Target cups / day',
        value:
          targetCupsDay != null ? formatCups(Math.round(targetCupsDay)) : '—',
        hint: weekTarget != null ? 'From weekly revenue target' : 'No target set',
        detailTitle: 'Target cups / day',
        detailBody:
          weekTarget != null && targetRevDay != null && targetCupsDay != null
            ? [
                `Weekly revenue target: ${fmtTargetKd(weekTarget)}`,
                `Daily revenue target = ${fmtTargetKd(weekTarget)} ÷ ${businessDays} = ${fmtTargetKd(targetRevDay)}`,
                `Planning cup price: ${TRAJECTORY_CUP_PRICE_KD} KD (targets only)`,
                `Target cups / day = ${fmtTargetKd(targetRevDay)} ÷ ${TRAJECTORY_CUP_PRICE_KD} = ${formatCups(Math.round(targetCupsDay))}`,
              ]
            : [
                `No weekly revenue target matched for “${location.locationName}”.`,
                'Targets are set per location in the weekly revenue target list.',
              ],
      },
      {
        id: 'cups-today',
        label: cupsSoldLabel,
        value: daySalesLoading ? '…' : dayCupsInt != null ? formatCups(dayCupsInt) : '—',
        hint:
          daySalesLoading
            ? 'Loading…'
            : dayPct != null
              ? `${dayPct}% of daily revenue target`
              : daySalesKnown
                ? 'Vendon cashless sales'
                : '—',
        accent: true,
        detailTitle: cupsSoldLabel,
        detailBody: [
          `Source: ${todaySalesSourceLabel(daySales.source, isLiveDay)}`,
          `Sales day (Kuwait): ${selectedYmd}`,
          `Machine: ${location.machineId} · ${location.locationName}`,
          daySalesKnown
            ? `Cashless cups (machine): ${formatCups(cupsInt(daySales.cupsCashless))}`
            : 'Cashless cups: —',
          daySalesKnown && daySales.cupsWeb > 0
            ? `Web/app cups (excluded from this card): ${formatCups(cupsInt(daySales.cupsWeb))}`
            : null,
          daySalesKnown
            ? `Total vends (all channels): ${formatCups(cupsInt(daySales.cups))}`
            : 'Total vends: —',
          'Count = number of cashless Vendon transactions (one per cup).',
          avgCupPrice
            ? `Average sale price: ${avgCupPrice} KD/cup (actual prices, not the ${TRAJECTORY_CUP_PRICE_KD} KD planning rate).`
            : `Target math uses ${TRAJECTORY_CUP_PRICE_KD} KD/cup; live sales use real Vendon prices.`,
          isLiveDay ? 'Live feed · refreshes ~90s.' : 'Historical day — no auto-refresh.',
        ].filter((line): line is string => line != null),
      },
      {
        id: 'rev-today',
        label: 'Actual rev / day',
        value: daySalesLoading ? '…' : fmtActualKd(dayRev),
        hint: daySalesKnown ? 'Sum of cashless sale prices' : '—',
        detailTitle: 'Actual revenue / day',
        detailBody:
          daySalesKnown && dayRev != null
            ? [
                `Sales day (Kuwait): ${selectedYmd}`,
                daySales.revenueCashlessKd != null && daySales.revenueCashlessKd > 0
                  ? `Cashless revenue (Vendon): ${fmtActualKd(daySales.revenueCashlessKd)}`
                  : daySales.revenueKd != null && daySales.revenueKd > 0
                    ? `Total revenue (Vendon): ${fmtActualKd(daySales.revenueKd)}`
                    : `Estimated ${formatCups(dayCupsInt ?? 0)} cups × ${TRAJECTORY_CUP_PRICE_KD} KD = ${fmtActualKd(dayRev)}`,
                daySales.cupsWeb > 0 && daySales.revenueKd != null
                  ? `Total revenue incl. web: ${fmtActualKd(daySales.revenueKd)}`
                  : null,
                avgCupPrice && dayCupsInt
                  ? `${formatCups(dayCupsInt)} cups × ~${avgCupPrice} KD avg ≠ ${formatCups(dayCupsInt)} × ${TRAJECTORY_CUP_PRICE_KD} KD — real menu prices vary.`
                  : 'Revenue is the sum of actual Vendon sale prices, not cups × 0.8 KD.',
                dayPct != null && targetRevDay != null
                  ? `Vs daily target ${fmtTargetKd(targetRevDay)} → ${dayPct}%`
                  : 'Daily target not available for comparison.',
              ].filter((line): line is string => line != null)
            : [
                `Sales day (Kuwait): ${selectedYmd}`,
                'No live sales returned for this machine on this day.',
              ],
      },
      {
        id: 'target-rev-day',
        label: 'Target rev / day',
        value: targetRevDay != null ? fmtTargetKd(targetRevDay) : '—',
        hint: weekTarget != null ? `Weekly target ÷ ${businessDays}` : '—',
        detailTitle: 'Target revenue / day',
        detailBody:
          weekTarget != null && targetRevDay != null
            ? [
                `Weekly revenue target: ${fmtTargetKd(weekTarget)}`,
                `Daily target = ${fmtTargetKd(weekTarget)} ÷ ${businessDays} = ${fmtTargetKd(targetRevDay)}`,
                segment === 'KU' ? 'KU locations use a 5-day business week (Sun–Thu).' : 'Compare “Actual rev / day” against this number.',
              ]
            : [`No weekly revenue target matched for “${location.locationName}”.`],
      },
      {
        id: 'target-rev-week',
        label: 'Target rev / week',
        value: weekTarget != null ? fmtTargetKd(weekTarget) : '—',
        hint: weekTarget != null ? 'Location weekly target' : '—',
        detailTitle: 'Target revenue / week',
        detailBody:
          weekTarget != null
            ? [
                `Weekly target for “${location.locationName}”: ${fmtTargetKd(weekTarget)}`,
                'Used as the denominator for “% rev / week”.',
                `Daily equivalent: ${fmtTargetKd(targetRevDay)} (÷ ${businessDays}).`,
              ]
            : [`No weekly revenue target matched for “${location.locationName}”.`],
      },
      {
        id: 'rev-week-pct',
        label: '% rev / week',
        value:
          weekSalesLoading
            ? '…'
            : weekPct != null
              ? `${weekPct}%`
              : weekTarget != null
                ? '0%'
                : '—',
        hint: `Sun ${weekStartYmd} → ${weekEndYmd}`,
        accent: weekPct != null && weekPct >= 100,
        detailTitle: '% revenue / week',
        detailBody:
          weekTarget != null
            ? [
                isPastWeek
                  ? `Full calendar week for ${selectedYmd}: ${weekStartYmd} → ${weekEndYmd} (Sun–Sat).`
                  : `Current week (in progress): ${weekStartYmd} → ${weekEndYmd} (today).`,
                'Same week % for any day you pick in this week — only daily cups/revenue change.',
                `Week cashless revenue (Vendon): ${weekRev != null ? fmtActualKd(weekRev) : weekSalesLoading ? 'Loading…' : '0.0 KD'}`,
                `Weekly target: ${fmtTargetKd(weekTarget)}`,
                weekRev != null
                  ? `Achievement = ${fmtActualKd(weekRev)} ÷ ${fmtTargetKd(weekTarget)} × 100 = ${weekPct ?? 0}%`
                  : 'Fetched from people-api /api/commercial-footfall/period-sales.',
              ]
            : [`No weekly revenue target matched for “${location.locationName}”.`],
      },
    ];
    return list;
  }, [
    weekTarget,
    targetRevDay,
    targetCupsDay,
    daySalesLoading,
    dayCups,
    dayCupsInt,
    dayRev,
    avgCupPrice,
    daySales,
    daySalesKnown,
    dayPct,
    weekSalesLoading,
    weekRev,
    weekPct,
    selectedYmd,
    weekStartYmd,
    weekEndYmd,
    isPastWeek,
    isLiveDay,
    cupsSoldLabel,
    location.locationName,
    location.machineId,
    segment,
    businessDays,
  ]);

  const openCard = cards.find((c) => c.id === openId);

  return (
    <section className="targetsTrajectorySection" aria-labelledby="targets-daily-target-title">
      <div className="targetsTrajectoryHead">
        <h3 id="targets-daily-target-title" className="targetsTrajectoryTitle">
          Daily Target
          {!hideDateLabels ? (
            <span className="targetsTrajectoryTitleDate">
              {' '}
              · {formatAccessDayBanner(selectedYmd)}
            </span>
          ) : null}
        </h3>
        {!hideDateLabels ? (
          <div className="targetsTrajectoryDateBar">
            <label className="dateField targetsTrajectoryDateField">
              <span className="dateFieldLabel">Day</span>
              <input
                type="date"
                value={selectedYmd}
                max={kuwaitTodayYmd}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setSelectedYmd(v);
                }}
                aria-label="Select sales day"
              />
            </label>
            {selectedYmd !== defaultSalesYmd ? (
              <button
                type="button"
                className="targetsTrajectoryTodayBtn"
                onClick={() => setSelectedYmd(defaultSalesYmd)}
              >
                Today
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="targetsTrajectoryHint">
        {hideDateLabels
          ? 'Today’s cups & revenue vs weekly revenue targets · KU divides weekly target by 5 (Sun–Thu). Tap a card for details.'
          : 'Daily cups & revenue for the selected day · % rev / week uses the full Sun–Sat week (or Sun–today if still in progress). Tap a card for calculation details.'}
      </p>
      <div className="targetsTrajectoryGrid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={
              card.accent
                ? 'targetsTrajectoryCard targetsTrajectoryCardAccent'
                : 'targetsTrajectoryCard'
            }
            onClick={() => setOpenId(card.id)}
            aria-haspopup="dialog"
          >
            <span className="targetsTrajectoryLabel">{card.label}</span>
            <span className="targetsTrajectoryValue">{card.value}</span>
            {card.hint ? <span className="targetsTrajectorySub">{card.hint}</span> : null}
          </button>
        ))}
      </div>

      {openCard ? (
        <div
          className="targetsKpiModalBackdrop"
          role="presentation"
          onClick={() => setOpenId(null)}
        >
          <div
            className="targetsKpiModal"
            role="dialog"
            aria-labelledby="targets-daily-target-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="targetsPopupClose"
              onClick={() => setOpenId(null)}
              aria-label="Close"
            >
              ×
            </button>
            <h4 id="targets-daily-target-modal-title" className="targetsKpiModalTitle">
              {openCard.detailTitle}
            </h4>
            <ul className="targetsKpiModalMeta">
              <li>Location: {location.locationName}</li>
              <li>Machine: {location.machineId}</li>
              <li>Selected day: {selectedYmd}</li>
              <li>Week (for %): {weekStartYmd} → {weekEndYmd}</li>
            </ul>
            <ul className="targetsKpiModalBody">
              {openCard.detailBody.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
