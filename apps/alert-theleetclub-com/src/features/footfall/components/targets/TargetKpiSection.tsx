import { useMemo, useState } from 'react';
import type { TodaySalesRow } from '@/features/footfall/lib/todaySales';
import type { LocationReport } from '@/features/footfall/lib/types';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import { footfallPerDayLabel } from '@/features/footfall/lib/footfallLabel';
import { isEstimatedFootfall } from '@/features/footfall/lib/footfallMetrics';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { ffMetricColors } from '@/features/footfall/lib/ffMetricColors';
import {
  footfallForTargets,
  footfallKpiCopy,
  footfallModalDetails,
  footfallPerDayAverage,
  footfallPeriodTotal,
  footfallSourceSummary,
} from '@/features/footfall/lib/footfallKpiDisplay';
import {
  achievementPct,
  periodConversionPct,
  targetCupsForFootfall,
  targetsBenchmarkForLocation,
} from '@/features/footfall/lib/targetsBenchmark';
import { TRAJECTORY_CUP_PRICE_KD } from '@/features/footfall/lib/weekRevenueTarget';
import {
  resolveDailyLocationTarget,
  type LocationAdminTarget,
} from '@/features/footfall/lib/locationAdminTargets';

type Props = {
  location: LocationReport;
  todaySales: TodaySalesRow;
  todaySalesLoading?: boolean;
  salesYmd: string;
  /** Reference window label shown above the KPI cards (e.g. Jul 6 → Jul 10, 2025). */
  periodTitle: string;
  hideDateLabels?: boolean;
  adminTarget?: LocationAdminTarget | null;
};

type KpiCardDef = {
  id: string;
  label: string;
  value: string;
  valueColor?: string;
  accent?: boolean;
  detailTitle: string;
  detailBody: string[];
};

function periodDateRange(loc: LocationReport): string {
  const dates =
    loc.footfallPeriodDates && loc.footfallPeriodDates.length > 0
      ? loc.footfallPeriodDates
      : loc.periodDates;
  const first = dates?.[0];
  const last = dates?.at(-1);
  if (first && last) return `${first} → ${last}`;
  return loc.reportWindowShortLabel ?? loc.periodLabel ?? '—';
}

/** Short context for KPI popups — no duplicate median/peer jargon. */
function modalContextLines(
  loc: LocationReport,
  copy: ReturnType<typeof footfallKpiCopy>,
  bench: number,
  hideDateLabels?: boolean,
): string[] {
  const lines: string[] = [
    `Location: ${loc.locationName}`,
    `Segment: ${inferOwnerSegment(loc)} · target conversion ${bench}%`,
  ];
  if (!hideDateLabels) {
    lines.push(`Dates: ${periodDateRange(loc)}`);
  }

  lines.push(footfallSourceSummary(loc, copy));
  return lines;
}

export function TargetKpiSection({
  location,
  todaySales,
  todaySalesLoading,
  salesYmd,
  periodTitle,
  hideDateLabels,
  adminTarget,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const copy = footfallKpiCopy(location);
  const bench = targetsBenchmarkForLocation(location);
  const segment = inferOwnerSegment(location);
  const ff = footfallForTargets(location);
  const ffPerDay = footfallPerDayAverage(location) ?? 0;
  const staticTargetDay = targetCupsForFootfall(ffPerDay, bench);
  const staticTargetWeek = targetCupsForFootfall(ff, bench);
  const todayCups = todaySales.cups;
  const todayCupsCashless = todaySales.cupsCashless;
  const todayCupsWeb = todaySales.cupsWeb;
  const todaySalesKnown = todaySales.source !== 'none';
  const todayCupsForAchieve =
    todayCupsCashless > 0 ? todayCupsCashless : todayCups;
  const remoteKd = location.daily.remoteCreditKd ?? 0;
  const periodWeb = location.daily.totalCupsWeb ?? 0;
  const periodConv = periodConversionPct(location);
  const estimated = isEstimatedFootfall(location);
  const salesDays = location.daily.footfallDayCount ?? location.periodDates?.length ?? 5;
  const avgCupsDay = salesDays > 0 ? (location.daily.totalCups ?? 0) / salesDays : 0;
  const avgRevDay =
    salesDays > 0 ? (location.daily.totalRevenueKd ?? 0) / salesDays : 0;
  const unitKd = avgCupsDay > 0 ? avgRevDay / avgCupsDay : TRAJECTORY_CUP_PRICE_KD;
  const footfallTargetRevDay = staticTargetDay * unitKd;
  const todayRevEst = todayCupsForAchieve * unitKd;
  const resolved = resolveDailyLocationTarget({
    machineId: location.machineId,
    locationName: location.locationName,
    segment,
    admin: adminTarget,
    footfallBenchCupsPerDay: staticTargetDay,
    footfallBenchKdPerDay: footfallTargetRevDay,
    unitKd,
  });
  const targetDayCups = resolved.cupsPerDay ?? staticTargetDay;
  const targetRevDay = resolved.revenueKdPerDay ?? footfallTargetRevDay;
  const weekTargetKd = resolved.weekRevenueKd;
  const todayRevForAchieve =
    todaySalesKnown &&
    todaySales.revenueCashlessKd != null &&
    todaySales.revenueCashlessKd > 0
      ? todaySales.revenueCashlessKd
      : todaySalesKnown && todaySales.revenueKd != null && todaySales.revenueKd > 0
        ? todaySales.revenueKd
        : todayRevEst;
  const achieve =
    todaySalesLoading || !todaySalesKnown
      ? null
      : achievementPct(todayCupsForAchieve, targetDayCups);
  const achieveRev =
    todaySalesLoading || !todaySalesKnown
      ? null
      : achievementPct(todayRevForAchieve, targetRevDay);

  const cards = useMemo<KpiCardDef[]>(() => {
    const list: KpiCardDef[] = [
      {
        id: 'sales-avg',
        label: 'Avg cups & revenue / day',
        value: `${formatCups(Math.round(avgCupsDay))} / ${avgRevDay.toFixed(1)} KD`,
        detailTitle: 'Average cups & revenue per day',
        detailBody: [
          `${formatCups(Math.round(avgCupsDay))} cups per business day (${salesDays}-day window).`,
          `${avgRevDay.toFixed(2)} KD revenue per business day.`,
          'Uses Vendon sales for the selected period.',
        ],
      },
      {
        id: 'footfall-period',
        label: copy.periodLabel,
        value: copy.isNone
          ? '—'
          : Math.round(footfallPeriodTotal(location)).toLocaleString(),
        valueColor: copy.periodValueColor ?? (ff > 0 ? ffMetricColors().unique : ffMetricColors().none),
        detailTitle: copy.periodLabel,
        detailBody: footfallModalDetails(location, copy, hideDateLabels),
      },
    ];

    if (!copy.isNone && ffPerDay > 0) {
      list.push({
        id: 'footfall-day',
        label: copy.perDayLabel ?? footfallPerDayLabel(location),
        value: Math.round(ffPerDay).toLocaleString(),
        valueColor: copy.perDayValueColor ?? copy.periodValueColor ?? ffMetricColors().unique,
        detailTitle: copy.perDayLabel ?? footfallPerDayLabel(location),
        detailBody: footfallModalDetails(location, copy, hideDateLabels),
      });
    }

    list.push(
      {
        id: 'benchmark',
        label: 'Target conversion',
        value: `${bench}%`,
        detailTitle: `Target conversion · ${segment}`,
        detailBody: [
          `${bench}% of footfall should convert to cashless cups (${segment}).`,
          'O2: 6.2% · MOH: 20% · KU: 35%.',
          'Daily target cups = daily footfall × benchmark ÷ 100.',
        ],
      },
      {
        id: 'conversion',
        label: 'Conversion',
        value: periodConv != null ? `${periodConv}%` : '—',
        valueColor:
          periodConv != null && periodConv >= bench
            ? ffMetricColors().pctHigh
            : ffMetricColors().pctLow,
        detailTitle: 'Conversion · 5 days',
        detailBody: [
          `Conversion % = cashless cups ÷ footfall × 100 (5-day period).`,
          periodConv != null
            ? `Actual: ${periodConv}% · ${segment} benchmark ${bench}%.`
            : 'No footfall — conversion not defined.',
          `Cashless cups (period): ${formatCups(
            Math.round(location.daily.totalCupsCashless ?? location.daily.totalCups ?? 0),
          )}.`,
          copy.isMirroredOrProjected
            ? 'Mirrored footfall — hourly conversion = cashless cups ÷ peer-shaped footfall.'
            : 'Unique footfall — camera detections adjusted when over-counted vs benchmark.',
        ],
      },
      {
        id: 'target-day',
        label: 'Target / day',
        value: `${formatCups(Math.round(targetDayCups))}`,
        detailTitle: 'Target · sales per day',
        detailBody:
          resolved.source === 'admin' || resolved.source === 'weekJson'
            ? [
                ...resolved.detail,
                targetRevDay != null
                  ? `Daily revenue target: ${targetRevDay.toFixed(1)} KD.`
                  : null,
                `Target cups / day: ${formatCups(Math.round(targetDayCups))}.`,
              ].filter(Boolean) as string[]
            : [
                `${formatCups(Math.round(staticTargetDay))} cups at ${bench}% on ${Math.round(ffPerDay).toLocaleString()} avg daily footfall.`,
                `${formatCups(Math.round(staticTargetWeek))} cups over period @ ${bench}%.`,
                'No Admin → Targets value for this machine — using footfall × conversion benchmark.',
                copy.isMirroredOrProjected
                  ? 'Based on mirrored footfall (period total from cups ÷ benchmark).'
                  : 'Based on footfall for this location.',
              ],
      },
      {
        id: 'achievement',
        label: hideDateLabels ? 'Achievement · today' : `Achievement · ${salesYmd}`,
        value: todaySalesLoading
          ? '…'
          : achieve != null
            ? `${achieve}% / ${todayRevForAchieve.toFixed(1)} KD`
            : todaySalesKnown
              ? `0% / 0.0 KD`
              : '—',
        accent: true,
        detailTitle: hideDateLabels
          ? 'Achievement · cups & revenue · today'
          : `Achievement · cups & revenue · ${salesYmd}`,
        detailBody: [
          !todaySalesKnown
            ? `No live sales loaded for ${salesYmd} yet — refresh or wait for the today feed.`
            : `Cups: ${formatCups(Math.round(todayCupsCashless))} of ${formatCups(Math.round(targetDayCups))} target (${achieve ?? '—'}%).`,
          todaySalesKnown
            ? `Revenue: ${todayRevForAchieve.toFixed(2)} KD of ${targetRevDay.toFixed(2)} KD target (${achieveRev ?? '—'}%).`
            : 'Achievement compares today cashless cups to the daily target.',
          resolved.source === 'admin'
            ? 'Daily target from Admin → Targets (overrides sheet / footfall bench).'
            : resolved.source === 'weekJson'
              ? 'Daily target from weekly revenue target list.'
              : `Target uses ${bench}% conversion on ${Math.round(ffPerDay).toLocaleString()} avg daily footfall.`,
          todaySalesKnown && todayCups > todayCupsCashless
            ? `All cups today (incl. WEB): ${formatCups(Math.round(todayCups))}.`
            : todaySalesKnown
              ? 'Achievement uses cashless cups only.'
              : `Sales source: ${todaySales.source === 'live' ? 'live Vendon' : 'reference week'}.`,
        ],
      },
      {
        id: 'remote',
        label: 'Remote (WEB)',
        value: formatCups(Math.round(todayCupsWeb || periodWeb)),
        detailTitle: 'Remote credit (WEB)',
        detailBody: [
          `WEB cups: ${formatCups(Math.round(todayCupsWeb || periodWeb))}.`,
          remoteKd > 0
            ? `${remoteKd.toFixed(2)} KD remote credit in period.`
            : 'WEB cashless sales (not counted in cashless achievement).',
        ],
      },
    );

    return list;
  }, [
    location,
    copy,
    ff,
    ffPerDay,
    bench,
    segment,
    staticTargetDay,
    staticTargetWeek,
    targetDayCups,
    weekTargetKd,
    resolved,
    achieve,
    todaySales,
    todaySalesLoading,
    salesYmd,
    todaySalesKnown,
    todayCupsForAchieve,
    periodConv,
    estimated,
    remoteKd,
    periodWeb,
    avgCupsDay,
    avgRevDay,
    salesDays,
    achieveRev,
    todayRevEst,
    todayRevForAchieve,
    targetRevDay,
    unitKd,
    hideDateLabels,
  ]);

  const openCard = cards.find((c) => c.id === openId);

  return (
    <div className="targetsKpiSection">
      <h3 className="targetsSectionTitle">{periodTitle}</h3>
      {copy.isNone ? (
        <p className="targetsZeroFootfallNote" role="status">
          No camera and no same-segment peer — footfall targets are zero. Sales and WEB
          credit still update on business days (Sun–Thu). Click a card for detail.
        </p>
      ) : null}
      <div className="targetsKpiGrid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={
              card.accent ? 'targetsKpiCard targetsKpiCardAccent' : 'targetsKpiCard'
            }
            onClick={() => setOpenId(card.id)}
            aria-haspopup="dialog"
          >
            <span className="targetsKpiCardLabel">{card.label}</span>
            <span
              className="targetsKpiCardValue"
              style={card.valueColor ? { color: card.valueColor } : undefined}
            >
              {card.value}
            </span>
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
            aria-labelledby="targets-kpi-modal-title"
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
            <h4 id="targets-kpi-modal-title" className="targetsKpiModalTitle">
              {openCard.detailTitle}
            </h4>
            <ul className="targetsKpiModalMeta">
              {modalContextLines(location, copy, bench, hideDateLabels).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ul className="targetsKpiModalBody">
              {openCard.detailBody.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
