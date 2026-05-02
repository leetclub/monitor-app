import { apiFetch } from '@/api/client';

export type LiveAlert = { level: string; code: string; message: string };

export type LiveMachineSnapshot = {
  machineId: string;
  name: string;
  alerts: LiveAlert[];
  sortRank: number;
  lastVendAt?: number;
  saleAgeMinutes?: number | null;
  lastDoorOpenAt?: number;
  maintenanceStatus: string;
  salesToday: number;
  salesYesterday: number;
  /** Present when snapshot was requested with focusDate query */
  salesOnFocusDay?: number;
  salesOnFocusPrevDay?: number;
  dailyTarget?: number | null;
  lastCleaningAt?: string | null;
  lastQcVisitAt?: string | null;
  strikeOperatorEmail?: string | null;
  shift: {
    expectedStart?: string | null;
    timezone: string;
    graceMinutes: number;
    clockInAt?: number | null;
    late: boolean;
  };
};

export type LiveSnapshotResponse = {
  generatedAt: string;
  /** When set, per-machine salesOnFocusDay / salesOnFocusPrevDay are populated */
  focusDate?: string | null;
  errors?: { vends?: string | null; doors?: string | null; maintenance?: string | null };
  machines: LiveMachineSnapshot[];
};

export async function fetchLiveSnapshot(opts?: { focusDate?: string | null }): Promise<LiveSnapshotResponse> {
  const q = new URLSearchParams();
  if (opts?.focusDate) q.set('focusDate', opts.focusDate);
  const qs = q.toString();
  return apiFetch<LiveSnapshotResponse>(`/api/live-dashboard/snapshot${qs ? `?${qs}` : ''}`);
}

export type LiveMachineConfigRow = {
  machineId: string;
  minSaleIntervalMinutes: number;
  maxHoursWithoutCleaning?: number | null;
  maxHoursWithoutQc?: number | null;
  strikeOperatorEmail?: string | null;
  dailySalesTarget?: number | null;
  expectedShiftStart?: string | null;
  shiftTimezone?: string | null;
  shiftGraceMinutes: number;
  lastCleaningAt?: string | null;
  lastQcVisitAt?: string | null;
};

export async function fetchLiveMachineConfigs(): Promise<{ items: LiveMachineConfigRow[] }> {
  return apiFetch<{ items: LiveMachineConfigRow[] }>('/api/live-dashboard/config');
}

export async function putLiveMachineConfig(
  machineId: string,
  body: Partial<LiveMachineConfigRow>,
): Promise<{ ok?: boolean; error?: string }> {
  return apiFetch(`/api/live-dashboard/machine/${encodeURIComponent(machineId)}`, {
    method: 'PUT',
    json: {
      minSaleIntervalMinutes: body.minSaleIntervalMinutes,
      maxHoursWithoutCleaning: body.maxHoursWithoutCleaning,
      maxHoursWithoutQc: body.maxHoursWithoutQc,
      strikeOperatorEmail: body.strikeOperatorEmail,
      dailySalesTarget: body.dailySalesTarget,
      expectedShiftStart: body.expectedShiftStart,
      shiftTimezone: body.shiftTimezone,
      shiftGraceMinutes: body.shiftGraceMinutes,
      lastCleaningAt: body.lastCleaningAt,
      lastQcVisitAt: body.lastQcVisitAt,
    },
  });
}

export async function postShiftClockIn(machineId: string): Promise<{ ok?: boolean; error?: string }> {
  return apiFetch('/api/live-dashboard/shift-clock-in', {
    method: 'POST',
    json: { machineId },
  });
}
