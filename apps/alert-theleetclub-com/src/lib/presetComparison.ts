import type { ComparePresetId, CompareSelection } from '@/components/ComparePresetPicker';
import {
  kuwaitIsoDateMinusDays,
  salesDayKwd,
  salesTrendFromToday,
  resolveSalesTrendPct,
  type SalesElapsedDay,
  type SalesElapsedRow,
} from '@/lib/salesDisplay';

/** Primary vs baseline metric pair for a compare preset (sales, footfall, etc.). */
export type CompareMetricPair = {
  primary: number | null;
  baseline: number | null;
  trendPct: number | null;
  primaryLabel: string;
  baselineLabel: string;
  /** Short caption for column tooltips / KPI strip. */
  caption: string;
};

export type VendonProductExtreme = {
  name?: string | null;
  count?: number | null;
};

export type VendonPresetSalesRow = {
  aSalesKwd?: number | null;
  bSalesKwd?: number | null;
  trendPct?: number | null;
  topProduct?: VendonProductExtreme | null;
  lowProduct?: VendonProductExtreme | null;
  topProducts?: VendonProductExtreme[] | null;
  lowProducts?: VendonProductExtreme[] | null;
};

export type FootfallPresetRow = {
  primaryIn?: number | null;
  baselineIn?: number | null;
  trendPct?: number | null;
  primaryLabel?: string | null;
  baselineLabel?: string | null;
};

const PRESET_LABELS: Record<
  ComparePresetId,
  { primary: string; baseline: string; caption: string; useVendonAggregate: boolean }
> = {
  today_vs_yesterday: {
    primary: 'Today',
    baseline: 'Yest. same time',
    caption: 'Today vs yesterday (same elapsed Kuwait clock)',
    useVendonAggregate: false,
  },
  yesterday_vs_day_before: {
    primary: 'Yesterday',
    baseline: 'Day before',
    caption: 'Yesterday vs day before (full Kuwait calendar days)',
    useVendonAggregate: true,
  },
  today_vs_same_day_last_week: {
    primary: 'Today',
    baseline: 'Same day last week',
    caption: 'Today vs same weekday last week (same elapsed clock)',
    useVendonAggregate: false,
  },
  wtd_vs_last_week: {
    primary: 'WTD',
    baseline: 'Last week WTD',
    caption: 'Week-to-date (Sun–Sat Kuwait) vs same slice last week',
    useVendonAggregate: true,
  },
  mtd_vs_mtd: {
    primary: 'MTD',
    baseline: 'Last month MTD',
    caption: 'Month-to-date vs same day-count prior month',
    useVendonAggregate: true,
  },
  custom_vs_custom: {
    primary: 'Period A',
    baseline: 'Period B',
    caption: 'Custom calendar ranges A vs B',
    useVendonAggregate: true,
  },
};

export function presetLabels(preset: ComparePresetId): {
  primary: string;
  baseline: string;
  caption: string;
} {
  const p = PRESET_LABELS[preset] ?? PRESET_LABELS.today_vs_yesterday;
  return { primary: p.primary, baseline: p.baseline, caption: p.caption };
}

/** Short labels that fit inside fixed-width metric boxes; use full presetLabels in title/tooltip. */
export function presetBoxLabels(preset: ComparePresetId): { primary: string; baseline: string } {
  switch (preset) {
    case 'today_vs_yesterday':
      return { primary: 'Today', baseline: 'Yest.' };
    case 'yesterday_vs_day_before':
      return { primary: 'Yest.', baseline: '−2d' };
    case 'today_vs_same_day_last_week':
      return { primary: 'Today', baseline: 'LW' };
    case 'wtd_vs_last_week':
      return { primary: 'WTD', baseline: 'L-WTD' };
    case 'mtd_vs_mtd':
      return { primary: 'MTD', baseline: 'L-MTD' };
    case 'custom_vs_custom':
      return { primary: 'A', baseline: 'B' };
    default:
      return presetLabels(preset);
  }
}

function trend(primary: number | null, baseline: number | null): number | null {
  if (primary == null || baseline == null || !Number.isFinite(primary) || !Number.isFinite(baseline)) {
    return null;
  }
  return salesTrendFromToday(primary, baseline);
}

function sumKwdDays(days: SalesElapsedDay[] | undefined, fromIso: string, toIsoExclusive: string): number | null {
  if (!days?.length) return null;
  let total = 0;
  let hit = false;
  for (const d of days) {
    const dt = d.date;
    if (!dt || dt < fromIso || dt >= toIsoExclusive) continue;
    hit = true;
    total += Number(d.kwd) || 0;
  }
  return hit ? total : null;
}

function dayKwdByOffset(days: SalesElapsedDay[] | undefined, offset: number): number | null {
  if (!days?.length || offset < 0 || offset >= days.length) return null;
  const k = days[offset]?.kwd;
  return k != null && Number.isFinite(Number(k)) ? Number(k) : null;
}

function dayKwdByDate(days: SalesElapsedDay[] | undefined, isoDate: string): number | null {
  if (!days?.length) return null;
  const hit = days.find((d) => d.date === isoDate);
  if (!hit) return null;
  return hit.kwd != null && Number.isFinite(Number(hit.kwd)) ? Number(hit.kwd) : null;
}

function parseIsoDate(s: string | undefined): string | null {
  const t = String(s || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function salesPairFromVendon(vendon: VendonPresetSalesRow, labels: ReturnType<typeof presetLabels>): CompareMetricPair | null {
  const primaryRaw = vendon.aSalesKwd;
  if (primaryRaw == null || !Number.isFinite(Number(primaryRaw))) return null;
  const primary = Number(primaryRaw);
  const baseline =
    vendon.bSalesKwd != null && Number.isFinite(Number(vendon.bSalesKwd)) ? Number(vendon.bSalesKwd) : null;
  return {
    primary,
    baseline,
    trendPct:
      vendon.trendPct != null && Number.isFinite(Number(vendon.trendPct))
        ? Number(vendon.trendPct)
        : trend(primary, baseline),
    primaryLabel: labels.primary,
    baselineLabel: labels.baseline,
    caption: labels.caption,
  };
}

function salesPairFromElapsed(
  preset: ComparePresetId,
  row: SalesElapsedRow | undefined,
  compare: CompareSelection | undefined,
  labels: ReturnType<typeof presetLabels>,
): CompareMetricPair {
  const days = row?.dailyElapsed;

  switch (preset) {
    case 'yesterday_vs_day_before': {
      const primary = salesDayKwd(row, 1);
      const baseline = salesDayKwd(row, 2);
      return {
        primary,
        baseline,
        trendPct: resolveSalesTrendPct(null, primary, baseline),
        primaryLabel: labels.primary,
        baselineLabel: labels.baseline,
        caption: labels.caption,
      };
    }
    case 'today_vs_same_day_last_week': {
      const primary = salesDayKwd(row, 0);
      const todayIso = days?.[0]?.date;
      let baseline: number | null = null;
      if (todayIso) {
        const lwIso = kuwaitIsoDateMinusDays(todayIso, 7);
        if (lwIso) baseline = dayKwdByDate(days, lwIso);
      }
      if (baseline == null) baseline = dayKwdByOffset(days, 7);
      return {
        primary,
        baseline,
        trendPct: trend(primary, baseline),
        primaryLabel: labels.primary,
        baselineLabel: labels.baseline,
        caption: labels.caption,
      };
    }
    case 'custom_vs_custom': {
      const a0 = parseIsoDate(compare?.a.start);
      const a1 = parseIsoDate(compare?.a.end);
      const b0 = parseIsoDate(compare?.b.start);
      const b1 = parseIsoDate(compare?.b.end);
      const primary = a0 && a1 ? sumKwdDays(days, a0, a1) : null;
      const baseline = b0 && b1 ? sumKwdDays(days, b0, b1) : null;
      return {
        primary,
        baseline,
        trendPct: trend(primary, baseline),
        primaryLabel: labels.primary,
        baselineLabel: labels.baseline,
        caption: labels.caption,
      };
    }
    case 'wtd_vs_last_week':
    case 'mtd_vs_mtd': {
      const primary = salesDayKwd(row, 0);
      const baseline = salesDayKwd(row, 1);
      return {
        primary,
        baseline,
        trendPct: trend(primary, baseline),
        primaryLabel: labels.primary,
        baselineLabel: labels.baseline,
        caption: `${labels.caption} (elapsed fallback — loading calendar totals…)`,
      };
    }
    default: {
      const primary = salesDayKwd(row, 0);
      const baseline = salesDayKwd(row, 1);
      const trendPct =
        row?.trendPct != null && Number.isFinite(Number(row.trendPct)) && preset === 'today_vs_yesterday'
          ? Number(row.trendPct)
          : trend(primary, baseline);
      return {
        primary,
        baseline,
        trendPct,
        primaryLabel: labels.primary,
        baselineLabel: labels.baseline,
        caption: labels.caption,
      };
    }
  }
}

const PRESETS_WITH_VENDON_FALLBACK: ComparePresetId[] = [
  'today_vs_yesterday',
  'today_vs_same_day_last_week',
];

function mergeElapsedWithVendon(
  fromElapsed: CompareMetricPair,
  vendon: VendonPresetSalesRow,
  labels: ReturnType<typeof presetLabels>,
  preset: ComparePresetId,
): CompareMetricPair {
  const fromVendon = salesPairFromVendon(vendon, labels);
  if (!fromVendon) return fromElapsed;

  const preferVendonBaseline =
    preset === 'yesterday_vs_day_before' &&
    fromElapsed.baseline == null &&
    fromVendon.baseline != null &&
    Number.isFinite(fromVendon.baseline);

  const primary = fromElapsed.primary ?? fromVendon.primary;
  let baseline = preferVendonBaseline ? fromVendon.baseline : fromElapsed.baseline;
  if (baseline == null) {
    baseline = fromVendon.baseline;
  } else if (
    baseline === 0 &&
    fromVendon.baseline != null &&
    fromVendon.baseline > 0 &&
    (preset === 'today_vs_same_day_last_week' || preset === 'yesterday_vs_day_before')
  ) {
    // Elapsed window empty but calendar-day cache has sales — show baseline for ops visibility.
    baseline = fromVendon.baseline;
  }

  return {
    primary,
    baseline,
    trendPct: resolveSalesTrendPct(null, primary, baseline),
    primaryLabel: fromElapsed.primaryLabel,
    baselineLabel: fromElapsed.baselineLabel,
    caption: fromElapsed.caption,
  };
}

/** Sales stack + target baseline from elapsed daily rows and/or vendon aggregate (WTD/MTD/custom only). */
export function salesPairForPreset(
  preset: ComparePresetId,
  row: SalesElapsedRow | undefined,
  compare?: CompareSelection,
  vendon?: VendonPresetSalesRow,
  labelOverride?: { primary?: string; baseline?: string },
): CompareMetricPair {
  const labels = presetLabels(preset);
  if (labelOverride?.primary) labels.primary = labelOverride.primary;
  if (labelOverride?.baseline) labels.baseline = labelOverride.baseline;
  const meta = PRESET_LABELS[preset];

  const fromElapsed = salesPairFromElapsed(preset, row, compare, labels);

  if (preset === 'today_vs_yesterday') {
    return fromElapsed;
  }

  if (meta.useVendonAggregate && vendon) {
    const fromVendon = salesPairFromVendon(vendon, labels);
    if (fromVendon) {
      if (preset === 'yesterday_vs_day_before') {
        const elapsedYest = salesDayKwd(row, 1);
        let primary = fromVendon.primary;
        // Revenue cache can be empty (0) while elapsed vends has real sales — never under-report.
        if (
          (primary == null || primary === 0) &&
          elapsedYest != null &&
          Number.isFinite(elapsedYest) &&
          elapsedYest > 0
        ) {
          primary = elapsedYest;
        }
        return {
          ...fromVendon,
          primary,
          trendPct: resolveSalesTrendPct(null, primary, fromVendon.baseline),
        };
      }
      return fromVendon;
    }
  }

  if (vendon && PRESETS_WITH_VENDON_FALLBACK.includes(preset)) {
    return mergeElapsedWithVendon(fromElapsed, vendon, labels, preset);
  }

  return fromElapsed;
}

export type VendonSalesSummaryMeta = {
  labelA?: string | null;
  labelB?: string | null;
};

const ELAPSED_FLEET_PRESETS: ComparePresetId[] = ['today_vs_yesterday', 'today_vs_same_day_last_week'];

/** Fleet running total for the active compare preset (sums visible machines). */
export function aggregateFleetSalesForPreset(
  machineIds: Iterable<string>,
  preset: ComparePresetId,
  compare: CompareSelection | undefined,
  dailySalesByMachine: Record<string, SalesElapsedRow> | undefined,
  vendonByMachine: Record<string, VendonPresetSalesRow> | undefined,
  _vendonMeta?: VendonSalesSummaryMeta,
  options?: { dailySalesReady?: boolean },
): CompareMetricPair & { machineCount: number; loading?: boolean } {
  const labels = presetLabels(preset);
  const waitForElapsed = ELAPSED_FLEET_PRESETS.includes(preset) && options?.dailySalesReady === false;

  if (waitForElapsed) {
    let machineCount = 0;
    for (const id of machineIds) {
      if (String(id ?? '').trim()) machineCount += 1;
    }
    return {
      primary: null,
      baseline: null,
      trendPct: null,
      primaryLabel: labels.primary,
      baselineLabel: labels.baseline,
      caption: labels.caption,
      machineCount,
      loading: true,
    };
  }

  let primarySum = 0;
  let baselineSum = 0;
  let hasPrimary = false;
  let hasBaseline = false;
  let machineCount = 0;

  const vendonForFleet = ELAPSED_FLEET_PRESETS.includes(preset) ? undefined : vendonByMachine;

  for (const id of machineIds) {
    const mid = String(id ?? '').trim();
    if (!mid) continue;
    machineCount += 1;
    const pair = salesPairForPreset(
      preset,
      dailySalesByMachine?.[mid],
      compare,
      vendonForFleet?.[mid],
    );
    if (pair.primary != null && Number.isFinite(pair.primary)) {
      primarySum += pair.primary;
      hasPrimary = true;
    }
    if (pair.baseline != null && Number.isFinite(pair.baseline)) {
      baselineSum += pair.baseline;
      hasBaseline = true;
    }
  }

  const primary = hasPrimary ? primarySum : null;
  const baseline = hasBaseline ? baselineSum : null;

  return {
    primary,
    baseline,
    trendPct: resolveSalesTrendPct(null, primary, baseline),
    primaryLabel: labels.primary,
    baselineLabel: labels.baseline,
    caption: labels.caption,
    machineCount,
  };
}

/** For today_vs_yesterday fleet bar — use server fleet sums (all allowed machines, matches Vendon). */
export function applyApiFleetElapsedTotals(
  preset: ComparePresetId,
  rowTotals: CompareMetricPair & { machineCount: number; loading?: boolean },
  api:
    | {
        fleetTodayKwd?: number;
        fleetYesterdaySameElapsedKwd?: number;
        allowedMachineIds?: string[];
      }
    | undefined,
  apiReady: boolean,
): CompareMetricPair & { machineCount: number; loading?: boolean } {
  if (preset !== 'today_vs_yesterday' || !apiReady || !api) return rowTotals;
  const primary =
    api.fleetTodayKwd != null && Number.isFinite(Number(api.fleetTodayKwd))
      ? Number(api.fleetTodayKwd)
      : rowTotals.primary;
  const baseline =
    api.fleetYesterdaySameElapsedKwd != null && Number.isFinite(Number(api.fleetYesterdaySameElapsedKwd))
      ? Number(api.fleetYesterdaySameElapsedKwd)
      : rowTotals.baseline;
  const machineCount = api.allowedMachineIds?.length ?? rowTotals.machineCount;
  return {
    ...rowTotals,
    primary,
    baseline,
    trendPct: resolveSalesTrendPct(null, primary, baseline),
    machineCount,
    loading: rowTotals.loading,
  };
}

function machineYesterdayFullDayKwd(row: SalesElapsedRow | undefined): number | null {
  const full =
    row?.yesterdayFullDayKwd != null && Number.isFinite(Number(row.yesterdayFullDayKwd))
      ? Number(row.yesterdayFullDayKwd)
      : null;
  if (full == null) return null;
  const elapsed = salesDayKwd(row, 1);
  if (full <= 0 && elapsed != null && elapsed > 0) return null;
  return full;
}

function machineDayBeforeFullDayKwd(row: SalesElapsedRow | undefined): number | null {
  const full =
    row?.dayBeforeFullDayKwd != null && Number.isFinite(Number(row.dayBeforeFullDayKwd))
      ? Number(row.dayBeforeFullDayKwd)
      : null;
  if (full == null || full <= 0) return null;
  return full;
}

/** Fleet total for yesterday full Kuwait calendar day (revenue cache via daily-sales-elapsed). */
export function aggregateFleetYesterdayFullDay(
  machineIds: Iterable<string>,
  dailySalesByMachine: Record<string, SalesElapsedRow> | undefined,
): { kwd: number | null; machineCount: number } {
  let sum = 0;
  let has = false;
  let machineCount = 0;

  for (const id of machineIds) {
    const mid = String(id ?? '').trim();
    if (!mid) continue;
    machineCount += 1;

    const kwd = machineYesterdayFullDayKwd(dailySalesByMachine?.[mid]);

    if (kwd != null && Number.isFinite(kwd)) {
      sum += kwd;
      has = true;
    }
  }

  return { kwd: has ? sum : null, machineCount };
}

export function aggregateFleetDayBeforeFullDay(
  machineIds: Iterable<string>,
  dailySalesByMachine: Record<string, SalesElapsedRow> | undefined,
): { kwd: number | null; machineCount: number } {
  let sum = 0;
  let has = false;
  let machineCount = 0;

  for (const id of machineIds) {
    const mid = String(id ?? '').trim();
    if (!mid) continue;
    machineCount += 1;

    const kwd = machineDayBeforeFullDayKwd(dailySalesByMachine?.[mid]);

    if (kwd != null && Number.isFinite(kwd)) {
      sum += kwd;
      has = true;
    }
  }

  return { kwd: has ? sum : null, machineCount };
}

/** Prefer API fleet aggregate; fall back to summing visible machines. */
export function fleetYesterdayFullDayKwd(
  response: { fleetYesterdayFullDayKwd?: number } | undefined,
  machineIds: Iterable<string>,
  dailySalesByMachine: Record<string, SalesElapsedRow> | undefined,
): number | null {
  if (
    response?.fleetYesterdayFullDayKwd != null &&
    Number.isFinite(Number(response.fleetYesterdayFullDayKwd))
  ) {
    return Number(response.fleetYesterdayFullDayKwd);
  }
  return aggregateFleetYesterdayFullDay(machineIds, dailySalesByMachine).kwd;
}

/** Prefer API fleet aggregate; fall back to summing visible machines. */
export function fleetDayBeforeFullDayKwd(
  response: { fleetDayBeforeFullDayKwd?: number } | undefined,
  machineIds: Iterable<string>,
  dailySalesByMachine: Record<string, SalesElapsedRow> | undefined,
): number | null {
  if (
    response?.fleetDayBeforeFullDayKwd != null &&
    Number.isFinite(Number(response.fleetDayBeforeFullDayKwd))
  ) {
    return Number(response.fleetDayBeforeFullDayKwd);
  }
  return aggregateFleetDayBeforeFullDay(machineIds, dailySalesByMachine).kwd;
}

export function footfallDisplayForPreset(
  preset: ComparePresetId,
  row: FootfallPresetRow | undefined,
  legacy?: { todayIn?: number | null; yesterdayIn?: number | null; trendPct?: number | null },
): CompareMetricPair & { mapped: boolean } {
  const labels = presetLabels(preset);
  const mapped = row?.primaryIn != null || legacy?.todayIn != null;

  if (row?.primaryIn != null && Number.isFinite(Number(row.primaryIn))) {
    const primary = Number(row.primaryIn);
    const baseline =
      row.baselineIn != null && Number.isFinite(Number(row.baselineIn)) ? Number(row.baselineIn) : null;
    return {
      primary,
      baseline,
      trendPct:
        row.trendPct != null && Number.isFinite(Number(row.trendPct))
          ? Number(row.trendPct)
          : trend(primary, baseline),
      primaryLabel: row.primaryLabel || labels.primary,
      baselineLabel: row.baselineLabel || labels.baseline,
      caption: labels.caption,
      mapped: true,
    };
  }

  const primary = legacy?.todayIn != null && Number.isFinite(Number(legacy.todayIn)) ? Number(legacy.todayIn) : null;
  const baseline =
    legacy?.yesterdayIn != null && Number.isFinite(Number(legacy.yesterdayIn)) ? Number(legacy.yesterdayIn) : null;

  return {
    primary,
    baseline,
    trendPct:
      legacy?.trendPct != null && Number.isFinite(Number(legacy.trendPct))
        ? Number(legacy.trendPct)
        : trend(primary, baseline),
    primaryLabel: labels.primary,
    baselineLabel: labels.baseline,
    caption: labels.caption,
    mapped: mapped && primary != null,
  };
}

/** Target stack uses same KWD windows as sales for the active preset. */
export function targetKwdForPreset(pair: CompareMetricPair): {
  todayKwd: number | undefined;
  yesterdayKwd: number | undefined;
} {
  return {
    todayKwd: pair.primary != null && Number.isFinite(pair.primary) ? pair.primary : undefined,
    yesterdayKwd: pair.baseline != null && Number.isFinite(pair.baseline) ? pair.baseline : undefined,
  };
}
