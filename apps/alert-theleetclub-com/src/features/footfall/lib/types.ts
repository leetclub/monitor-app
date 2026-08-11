export type HourRow = {
  hour: number;
  label: string;
  footfall: number;
  cups: number;
  conversionRatio: string;
  conversionPct: number;
  revenueKd: number;
  revenuePerVisitorKd: number;
  benchmarkConversionPct: number;
  aspiredCups: number;
  upliftCups: number;
  upliftKd: number;
  isSurge?: boolean;
  isWeakConversion?: boolean;
  isHighEfficiency?: boolean;
  isStrongMonetization?: boolean;
  footfallMirror?: { value: number; color: string; label: string };
  footfallProjected?: boolean;
  peopleIn?: number;
  peopleOut?: number;
  netTraffic?: number;
  /** Cashless (non-WEB) cups for this hour (avg). */
  cupsCashless?: number;
  /** WEB / remote-credit cups for this hour (avg). */
  cupsWeb?: number;
  revenueWebKd?: number;
};

export type DayBreakdownRow = {
  date: string;
  footfall: number;
  cups: number;
  conversionRatio: string;
  conversionPct: number;
  revenueKd: number;
  revenuePerVisitorKd: number;
  footfallEstimated?: boolean;
  footfallSourceDate?: string;
};

export type DayBreakdownAligned = { mode: 'aligned'; rows: DayBreakdownRow[]; note?: string | null };
export type DayBreakdownSplit = {
  mode: 'split';
  note?: string | null;
  salesRows: DayBreakdownRow[];
  footfallRows: DayBreakdownRow[];
  /** Merged by Sun–Thu index for one table + period compare */
  rows?: DayBreakdownRow[];
};
export type DaysBreakdown = DayBreakdownAligned | DayBreakdownSplit;

export type SalesDataKind = 'actual' | 'proxy_benchmark' | 'proxy_nearest' | 'none';

export type SalesDisplayMeta = {
  kind: SalesDataKind;
  label: string;
  shortLabel: string;
  color: string;
};

export type DailyTotals = {
  /** Sum of Videoloft people_in (entry detections) across the footfall window — not unique visitors. */
  totalFootfall: number;
  avgDailyFootfall?: number;
  hourlyProfileFootfallSum?: number;
  footfallPeriodDates?: string[];
  salesPeriodDates?: string[];
  requestedSalesPeriodDates?: string[];
  salesDataKind?: SalesDataKind;
  salesIsActual?: boolean;
  footfallDayCount?: number;
  salesDayCount?: number;
  periodsAligned?: boolean;
  footfallIsDetections?: boolean;
  detectionsPerCup?: number | null;
  conversionNote?: string | null;
  totalCups: number;
  totalCupsCashless?: number;
  totalCupsWeb?: number;
  /** WEB cashless revenue (remote credit) for the sales window. */
  remoteCreditKd?: number;
  avgDailyCups?: number;
  totalRevenueKd: number;
  conversionPct: number;
  conversionRatio: string;
  revenuePerVisitorKd: number;
  illustrativeMissedPotentialKd: number;
  totalIn?: number;
  totalOut?: number;
  totalNet?: number;
  avgDailyNet?: number;
  netTrafficNote?: string | null;
  projectedFootfall?: number;
  salesTargetCups?: number;
  salesTargetRevenueKd?: number;
  salesUpliftCups?: number;
  salesUpliftKd?: number;
  salesTargetNote?: string | null;
};

export type OwnerSegment = 'KU' | 'MOH' | 'O2' | 'OTHER';

export type FootfallDataKind = 'actual' | 'mirrored' | 'projected' | 'none';

export type FootfallDisplayMeta = {
  kind: FootfallDataKind;
  label: string;
  shortLabel: string;
  color: string;
};

export type FootfallDiagnostics = {
  uiddCount?: number;
  granularity?: string;
  source?: string;
  dbRows?: number;
  footfallPeriodNote?: string;
  footfallPeriodDates?: string[];
  salesPeriodDates?: string[];
};

export type LocationReport = {
  machineId: string;
  locationName: string;
  locationOwner: string | null;
  dataSource: string;
  periodLabel: string;
  periodDates: string[];
  footfallPeriodDates?: string[];
  salesPeriodDates?: string[];
  requestedSalesPeriodDates?: string[];
  salesDataKind?: SalesDataKind;
  salesDisplay?: SalesDisplayMeta | null;
  periodKey: string;
  hasPeopleFootfall: boolean;
  footfallDataKind?: FootfallDataKind;
  footfallDisplay?: FootfallDisplayMeta | null;
  ownerSegment?: OwnerSegment;
  machinePositionKey?: string;
  projectionPeerName?: string | null;
  mirrorSourceName: string | null;
  mirrorDisplay: { text: string; color: string; parenthetical: boolean } | null;
  footfallDiagnostics?: FootfallDiagnostics;
  hours: HourRow[];
  daily: DailyTotals;
  daysBreakdown: DaysBreakdown | DayBreakdownRow[];
  insights: {
    summary: string;
    peakExposureHour?: string;
    peakExposureFootfall?: number;
    peakMonetizationHour?: string;
    peakMonetizationRpvKd?: number;
    weakConversionHours?: string[];
    highEfficiencyHours?: string[];
    weakConversionWindowCount?: number;
  };
  comparePeriodDates?: string[] | null;
  compareHours?: HourRow[] | null;
  compareDaily?: DailyTotals | null;
  compareDaysBreakdown?: DaysBreakdown | null;

  /** ---- targets.theleetclub.com extensions (set client-side, never from API) ---- */
  /** Pre-transform raw camera detections (period total). Kept as reference. */
  rawFootfallTotal?: number;
  /** Pre-transform avg daily footfall. */
  rawAvgDailyFootfall?: number;
  /** Algorithm output that produced the unique-adjusted values on this object. */
  uniqueFootfallBreakdown?: {
    rawDetections: number;
    factor: number;
    factorEstimate: number;
    netArrivalsFloor: number;
    uniqueEstimate: number;
    uniqueAvgPerDay: number;
    dayCount: number;
    segment: OwnerSegment;
    floorActive: boolean;
    ceilingActive: boolean;
    netSignalMissing: boolean;
    summary: string;
  };
  /** True if the transform actually changed numbers on this location. */
  uniqueAdjusted?: boolean;
  /** Short label of the segment window this location uses (e.g. "Jun 22 → Jun 26, 2025"). */
  reportWindowShortLabel?: string;
  /** KU campus site without cameras — client peer estimate (Targets tab only). */
  kuFootfallEstimate?: {
    peerName: string;
    method: string;
  };
};

export type ReportQuery = {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
  enableCompare: boolean;
};

export type ReportPayload = {
  generatedAt: string;
  benchmarkConversionPct: number;
  primaryPeriod: string[];
  fallbackPeriod: string[];
  comparePeriod: string[] | null;
  currency: string;
  locations: LocationReport[];
  rankings: {
    byFootfall: { machineId: string; name: string; value: number }[];
    byProjectedFootfall?: { machineId: string; name: string; value: number }[];
    byRevenue: { machineId: string; name: string; value: number }[];
    byConversion: { machineId: string; name: string; value: number }[];
    byMissedPotential: { machineId: string; name: string; value: number }[];
    byRevenuePerVisitor?: { machineId: string; name: string; value: number }[];
  };
  locationCount: number;
};
