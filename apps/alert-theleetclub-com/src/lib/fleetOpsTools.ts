/** Shared fleet search + risk ranking for Red Flags / Overall toolbars. */

export function machineMatchesSearch(
  needle: string,
  machine: { id?: string | null; name?: string | null },
): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const id = String(machine.id || '').toLowerCase();
  const name = String(machine.name || '').toLowerCase();
  return name.includes(q) || id.includes(q);
}

export type FleetRiskInput = {
  downtimeTodaySec?: number | null;
  lastTxAgeMin?: number | null;
  cleaningOverdue15h?: boolean;
  reasonCount?: number;
  inactiveToday?: boolean;
};

/** Higher = more urgent. Used for “highest risk” toolbar sort. */
export function fleetRiskScore(input: FleetRiskInput): number {
  let s = 0;
  const downMin = Math.max(0, Number(input.downtimeTodaySec) || 0) / 60;
  s += Math.min(180, downMin);
  const age = input.lastTxAgeMin;
  if (age != null && Number.isFinite(age) && age >= 0) {
    s += Math.min(150, age / 4);
  }
  if (input.cleaningOverdue15h) s += 45;
  s += Math.min(60, (input.reasonCount || 0) * 12);
  if (input.inactiveToday) s += 18;
  return Math.round(s * 10) / 10;
}

export function lastTxAgeMinutes(
  lastTxUnixSec: number | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): number | null {
  if (lastTxUnixSec == null || !Number.isFinite(lastTxUnixSec) || lastTxUnixSec <= 0) return null;
  const age = nowSec - Number(lastTxUnixSec);
  if (!Number.isFinite(age) || age < 0) return null;
  return age / 60;
}

/** Stronger “no sales” cue (hours). Red Flags still uses snapshot stale minutes for listing. */
export const NO_SALES_ALERT_HOURS = 4;

export function isNoSalesAlert(ageMin: number | null | undefined, hours = NO_SALES_ALERT_HOURS): boolean {
  if (ageMin == null || !Number.isFinite(ageMin)) return false;
  return ageMin >= hours * 60;
}
