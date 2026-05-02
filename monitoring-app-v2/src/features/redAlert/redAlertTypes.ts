/** Row shape served by `GET /api/red-alert/snapshot` (Postgres cache, e.g. `monitoring_dashboard.red_alert_snapshot_cache`). */

/** Board column “trend” baseline: week-to-date vs last week, or Kuwait “today so far” vs aligned windows. */
export type RedAlertCompareMode = 'week' | 'sameWeekdayLw' | 'yesterday';

export type RedAlertFrequency = {
  totalCriteriaHitsThisWeek?: number | null;
  totalCriteriaHitsLastWeek?: number | null;
  totalCriteriaHitsToday?: number | null;
  totalCriteriaHitsSameDayLastWeek?: number | null;
  /** Same basis as weekly trend %: full last week × elapsed fraction of current week. */
  totalCriteriaHitsLastWeekAlignedToWtD?: number | null;
  totalCriteriaHitsYesterdaySameElapsed?: number | null;
  totalCriteriaHits7d?: number | null;
  totalCriteriaHitsPrior7d?: number | null;
  staleSaleEpisodesThisWeek?: number | null;
  staleSaleEpisodesLastWeek?: number | null;
  staleSaleEpisodesToday?: number | null;
  staleSaleEpisodesSameDayLastWeek?: number | null;
  staleSaleEpisodesYesterdaySameElapsed?: number | null;
  staleSaleEpisodes7d?: number | null;
  staleSaleEpisodesPrior7d?: number | null;
  offEpisodesThisWeek?: number | null;
  offEpisodesLastWeek?: number | null;
  offEpisodesToday?: number | null;
  offEpisodesSameDayLastWeek?: number | null;
  offEpisodesYesterdaySameElapsed?: number | null;
  offEvents7d?: number | null;
  offEventsPrior7d?: number | null;
  dispenseFailsThisWeek?: number | null;
  dispenseFailsLastWeek?: number | null;
  dispenseFailsToday?: number | null;
  dispenseFailsSameDayLastWeek?: number | null;
  dispenseFailsYesterdaySameElapsed?: number | null;
  dispenseFails7d?: number | null;
  dispenseFailsPrior7d?: number | null;
  /** Some snapshots nest last-sale fields under frequency. */
  lastTransactionAtUtc?: string | null;
  last_sale_at?: string | null;
  lastTransactionAt?: string | null;
  lastOffEventAt?: string | null;
  lastOffEventAtUtc?: string | null;
};

export type RedAlertRow = {
  machineId?: string | number | null;
  machine_id?: string | number | null;
  machineName?: string | null;
  operator?: string | null;
  redAlertOperator?: string | null;
  operatorName?: string | null;
  red_alert_operator?: string | null;
  cleaningOperator?: string | null;
  reasons?: string[];
  frequency?: RedAlertFrequency;
  happensWeek?: number | null;
  happenedLastWeek?: number | null;
  /** Expectation used with WTD for weekly trend % (full last week × week-elapsed fraction). */
  happenedLastWeekAlignedSlice?: number | null;
  happenedPctVsPriorWeek?: number | null;
  lastTransactionAtUtc?: string | null;
  /** API may use snake_case or alternate keys; clients normalize via `pickLastTransactionTs`. */
  last_transaction_at_utc?: string | null;
  lastSaleAtUtc?: string | null;
  last_sale_at_utc?: string | null;
  lastSaleAt?: string | null;
  last_sale_at?: string | null;
  lastTransactionAt?: string | null;
  last_transaction_at?: string | null;
  /** When present and distinct from last vend, e.g. last OFF-related telemetry time. */
  lastOffEventAt?: string | null;
  lastOffEventAtUtc?: string | null;
  last_off_event_at?: string | null;
  last_off_event_at_utc?: string | null;
  lastEventAtUtc?: string | null;
  last_event_at_utc?: string | null;
  last_red_alert_event_at?: string | null;
  minutesSinceLastTransaction?: number | null;
  minutes_since_last_transaction?: number | null;
  happensToday?: number | null;
  happenedSameDayLastWeek?: number | null;
  happenedPctVsSameDayLastWeek?: number | null;
  happenedYesterdaySameElapsed?: number | null;
  happenedPctVsYesterdaySameElapsed?: number | null;
  goCheckUrl?: string | null;
  strikeOperatorEmail?: string | null;
  pfaExcludeCleaning?: boolean | null;
  pfaExcludeCleaningAdmin?: boolean | null;
  onCleaningSchedule?: boolean;
  alertPriorityTier?: number | null;
  duringScheduledCleaningNow?: boolean;
};

export type RedAlertSnapshotResponse = {
  generatedAt?: string;
  rows?: RedAlertRow[];
};

export type RedAlertDetailPayload = {
  machineName?: string | null;
  machineId: string;
  operator: string;
  cleaningOperator?: string | null;
  reasons: string[];
  frequency: RedAlertFrequency;
  happensWeek?: number | null;
  happenedLastWeek?: number | null;
  happenedLastWeekAlignedSlice?: number | null;
  happenedPctVsPriorWeek?: number | null;
  lastTransactionAtUtc?: string | null;
  lastTransactionEstimated?: boolean;
  lastOffEventAt?: string | null;
  lastOffEventAtUtc?: string | null;
  minutesSinceLastTransaction?: number | null;
  happensToday?: number | null;
  happenedSameDayLastWeek?: number | null;
  happenedPctVsSameDayLastWeek?: number | null;
  happenedYesterdaySameElapsed?: number | null;
  happenedPctVsYesterdaySameElapsed?: number | null;
  compareMode: RedAlertCompareMode;
  goCheckUrl?: string | null;
  strikeOperatorEmail?: string | null;
  pfaExcludeCleaning: boolean | null;
  pfaExcludeCleaningAdmin: boolean | null;
  onCleaningSchedule: boolean;
  alertPriorityTier: number;
  duringScheduledCleaningNow: boolean;
  statusLabel: string;
};
