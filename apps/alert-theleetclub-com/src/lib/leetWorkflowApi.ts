/** Leet Workflow proxy API (people-analytics-api → LEET_WORKFLOW_API_BASE). */

import { apiDownloadFile, apiGet, apiJson } from '@/lib/api';

export type WorkflowConfigured = {
  configured?: boolean;
  error?: string;
};

export type OperatorSchedulePayload = WorkflowConfigured & {
  operatorName?: string | null;
  operatorEmail?: string | null;
  operatorPhone?: string | null;
  operatorWhatsappUrl?: string | null;
  operatorSlackDmUrl?: string | null;
  contactSource?: string | null;
  present?: boolean | null;
  absentDaysMtd?: number | null;
  lateDaysMtd?: number | null;
  machineInCharge?: string | null;
  scheduleSource?: string | null;
  schedulePeriodName?: string | null;
  attendanceStatus?: 'present' | 'absent' | 'pending' | 'not_scheduled' | null;
  attendanceStatusLabel?: string | null;
  state?: 'idle' | 'working' | 'break' | 'corrupt' | null;
  todayClockIn?: string | null;
  todayClockOut?: string | null;
  positionType?: string | null;
  positionLabel?: string | null;
  taskManagerUserId?: number | null;
};

export type MachineAttendancePill = {
  label: string;
  color: 'g' | 'y' | 'o' | 'r';
};

export type MachineAttendanceSummary = {
  operatorName?: string | null;
  operatorEmail?: string | null;
  operatorPhone?: string | null;
  operatorWhatsappUrl?: string | null;
  operatorSlackDmUrl?: string | null;
  contactSource?: string | null;
  attendanceStatus?: string | null;
  attendanceStatusLabel?: string | null;
  state?: string | null;
  present?: boolean | null;
  pill?: MachineAttendancePill | null;
};

export type MachineAttendanceMapPayload = WorkflowConfigured & {
  byMachineId?: Record<string, MachineAttendanceSummary>;
  schedulePeriodName?: string | null;
  fromCache?: boolean;
  cacheGeneratedAt?: string | null;
};

export type CleaningWorkflowPayload = WorkflowConfigured & {
  lastCleaningAt?: string | null;
  cleaningSource?: string | null;
  commandCenterVerified?: boolean | null;
  comments?: string[];
  media?: Array<{ url: string; label?: string }>;
  videoUrl?: string | null;
  monitorRecordUrl?: string | null;
  eodVideoUrl?: string | null;
  highRisk?: boolean | null;
  ghostCheck?: boolean | null;
  note?: string | null;
};

export type CleaningWorkflowMapPayload = WorkflowConfigured & {
  byMachineId?: Record<string, CleaningWorkflowPayload>;
};

export type TechVisitWorkflowPayload = WorkflowConfigured & {
  lastVisitAt?: string | null;
  visitorName?: string | null;
  comment?: string | null;
  source?: string | null;
  note?: string | null;
};

export type QaBulletsPayload = WorkflowConfigured & {
  bullets?: string[];
  summary?: string | null;
  score?: number | null;
  source?: string | null;
  aiConfigured?: boolean;
  aiError?: string | null;
  error?: string | null;
};

export type QaManualSummaryPayload = {
  machineName?: string;
  summary?: string | null;
  bullets?: string[];
  savedAt?: string | null;
  savedBy?: string | null;
  monthCount?: number;
  yearMonth?: string;
  error?: string;
};

export type QaScoreTrend = {
  trend?: 'improving' | 'declining' | 'stable' | 'new' | 'unknown' | string;
  currentWeekAvg?: number | null;
  priorWeekAvg?: number | null;
  delta?: number | null;
  points?: Array<{ date: string; score: number }>;
};

export type QaMachineAuditRow = {
  location?: string | null;
  officerName?: string | null;
  lastVisitAt?: string | null;
  lastVisitDate?: string | null;
  auditId?: string | null;
  score?: number | null;
  keyFindings?: string[] | null;
  reportUrl?: string | null;
};

export type QaMachineAuditsPayload = {
  machineName?: string;
  audits?: QaMachineAuditRow[];
  total?: number;
  auditsSearched?: number;
  auditsProcessed?: number;
  dateFrom?: string;
  dateTo?: string;
  trend?: QaScoreTrend;
  source?: string;
  error?: string;
};

export type QaFleetPayload = {
  byMachine?: Record<string, QaMachineAuditRow>;
  total?: number;
  auditsSearched?: number;
  auditsProcessed?: number;
  dateFrom?: string;
  dateTo?: string;
  adminSummaryMtdByMachine?: Record<string, number>;
  yearMonth?: string;
  source?: string;
  error?: string;
  warning?: string;
  partial?: boolean;
};

export type QaManualSummaryAdminPayload = {
  machineName?: string;
  yearMonth?: string;
  monthCount?: number;
  rows?: Array<{
    id: number;
    summary: string;
    bullets: string[];
    savedAt: string | null;
    savedBy: string | null;
  }>;
  latest?: QaManualSummaryPayload | null;
  ok?: boolean;
  id?: number;
  message?: string;
};

export function fetchQaManualSummary(machineName: string): Promise<QaManualSummaryPayload> {
  const name = String(machineName || '').trim();
  return apiGet<QaManualSummaryPayload>(
    `/api/alert/qa/manual-summary?machineName=${encodeURIComponent(name)}`,
  );
}

export function fetchQaFleet(input: { from?: string; to?: string; refresh?: boolean }): Promise<QaFleetPayload> {
  const params = new URLSearchParams();
  if (input.from?.trim()) params.set('from', input.from.trim());
  if (input.to?.trim()) params.set('to', input.to.trim());
  if (input.refresh) params.set('refresh', '1');
  const qs = params.toString();
  return apiGet<QaFleetPayload>(`/api/alert/qa/fleet${qs ? `?${qs}` : ''}`);
}

export function fetchQaMachineAudits(input: {
  machineName: string;
  from?: string;
  to?: string;
  location?: string;
  sort?: 'date' | 'score';
  order?: 'asc' | 'desc';
  days?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<QaMachineAuditsPayload> {
  const name = String(input.machineName || '').trim();
  const params = new URLSearchParams({ machineName: name });
  if (input.from?.trim()) params.set('from', input.from.trim());
  if (input.to?.trim()) params.set('to', input.to.trim());
  if (input.location?.trim()) params.set('location', input.location.trim());
  if (input.sort) params.set('sort', input.sort);
  if (input.order) params.set('order', input.order);
  if (input.days != null && Number.isFinite(input.days)) params.set('days', String(input.days));
  if (input.refresh) params.set('refresh', '1');
  return apiGet<QaMachineAuditsPayload>(`/api/alert/qa/machine-audits?${params.toString()}`, {
    signal: input.signal,
  });
}

export function fetchQaManualSummaryAdmin(machineName: string): Promise<QaManualSummaryAdminPayload> {
  const name = String(machineName || '').trim();
  return apiGet<QaManualSummaryAdminPayload>(
    `/api/alert/admin/qa-manual-summaries?machineName=${encodeURIComponent(name)}`,
  );
}

export function saveQaManualSummary(body: {
  machineName: string;
  summary: string;
}): Promise<QaManualSummaryAdminPayload> {
  return apiJson('/api/alert/admin/qa-manual-summaries', body);
}

export function fetchOperatorSchedule(machineId: string): Promise<OperatorSchedulePayload> {
  return apiGet<OperatorSchedulePayload>(
    `/api/alert/workflow/operator-schedule?machine_id=${encodeURIComponent(machineId)}`,
  );
}

export function fetchMachineAttendanceMap(machineIds: string[]): Promise<MachineAttendanceMapPayload> {
  const ids = machineIds.filter(Boolean).join(',');
  return apiGet<MachineAttendanceMapPayload>(
    `/api/alert/workflow/machine-attendance-map?machine_ids=${encodeURIComponent(ids)}`,
  );
}

const ATTENDANCE_MAP_CHUNK = 120;

/** Single fleet request — server reads pre-warmed DB cache. */
export async function fetchMachineAttendanceMapBatched(
  machineIds: string[],
): Promise<MachineAttendanceMapPayload> {
  const ids = machineIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) {
    return fetchMachineAttendanceMap([]);
  }
  if (ids.length <= ATTENDANCE_MAP_CHUNK) {
    return fetchMachineAttendanceMap(ids);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ATTENDANCE_MAP_CHUNK) {
    chunks.push(ids.slice(i, i + ATTENDANCE_MAP_CHUNK));
  }

  const merged: NonNullable<MachineAttendanceMapPayload['byMachineId']> = {};
  let configured: boolean | undefined = true;
  let schedulePeriodName: string | null | undefined;
  let error: string | undefined;

  const parts = await Promise.all(
    chunks.map((chunk) =>
      fetchMachineAttendanceMap(chunk).catch((err) => {
        console.warn('machine-attendance-map chunk failed', chunk.slice(0, 4).join(','), err);
        return null;
      }),
    ),
  );

  for (const part of parts) {
    if (!part) continue;
    if (part.configured === false) configured = false;
    if (part.error) error = part.error;
    if (part.schedulePeriodName) schedulePeriodName = part.schedulePeriodName;
    Object.assign(merged, part.byMachineId ?? {});
  }

  return { configured, error, schedulePeriodName, byMachineId: merged };
}

export function fetchCleaningWorkflow(machineId: string): Promise<CleaningWorkflowPayload> {
  return apiGet<CleaningWorkflowPayload>(
    `/api/alert/workflow/cleaning?machine_id=${encodeURIComponent(machineId)}`,
  );
}

export function fetchCleaningWorkflowMap(machineIds: string[]): Promise<CleaningWorkflowMapPayload> {
  const ids = machineIds.filter(Boolean).join(',');
  return apiGet<CleaningWorkflowMapPayload>(
    `/api/alert/workflow/cleaning-map?machine_ids=${encodeURIComponent(ids)}`,
  );
}

const CLEANING_MAP_CHUNK = 80;

export async function fetchCleaningWorkflowMapBatched(
  machineIds: string[],
): Promise<CleaningWorkflowMapPayload> {
  const ids = machineIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) {
    return fetchCleaningWorkflowMap([]);
  }
  if (ids.length <= CLEANING_MAP_CHUNK) {
    return fetchCleaningWorkflowMap(ids);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CLEANING_MAP_CHUNK) {
    chunks.push(ids.slice(i, i + CLEANING_MAP_CHUNK));
  }

  const merged: NonNullable<CleaningWorkflowMapPayload['byMachineId']> = {};
  let configured: boolean | undefined = true;
  let error: string | undefined;

  const parts = await Promise.all(
    chunks.map((chunk) =>
      fetchCleaningWorkflowMap(chunk).catch((err) => {
        console.warn('cleaning-map chunk failed', chunk.slice(0, 4).join(','), err);
        return null;
      }),
    ),
  );

  for (const part of parts) {
    if (!part) continue;
    if (part.configured === false) configured = false;
    if (part.error) error = part.error;
    Object.assign(merged, part.byMachineId ?? {});
  }

  return { configured, error, byMachineId: merged };
}

export function fetchTechVisitWorkflow(
  machineId: string,
  machineName?: string,
): Promise<TechVisitWorkflowPayload> {
  const params = new URLSearchParams({ machine_id: machineId });
  const name = String(machineName || '').trim();
  if (name) params.set('machine_name', name);
  return apiGet<TechVisitWorkflowPayload>(`/api/alert/workflow/tech-visit?${params.toString()}`);
}

export function fetchQaBullets(auditId: string): Promise<QaBulletsPayload> {
  return apiGet<QaBulletsPayload>(
    `/api/alert/workflow/qa-bullets?audit_id=${encodeURIComponent(auditId)}`,
  );
}

export function downloadQaReport(auditId: string, filename?: string): Promise<void> {
  const id = String(auditId || '').trim();
  if (!id) return Promise.reject(new Error('audit_id required'));
  const name = filename || `qa-report-${id.slice(0, 12)}.pdf`;
  return apiDownloadFile(
    `/api/alert/workflow/qa-report-download?audit_id=${encodeURIComponent(id)}`,
    name,
  );
}

export function submitGoCheck(body: {
  machineId: string;
  machineName: string;
  errorType: string;
  message: string;
}): Promise<
  WorkflowConfigured & {
    ok?: boolean;
    taskId?: string | number | null;
    delivery?: string;
    operatorEmail?: string | null;
    operatorName?: string | null;
    mailtoUrl?: string | null;
    note?: string | null;
  }
> {
  return apiJson('/api/alert/workflow/go-check', body);
}

export function submitDmOperator(body: {
  machineId: string;
  operatorEmail?: string;
  message: string;
}): Promise<
  WorkflowConfigured & {
    ok?: boolean;
    delivery?: string;
    operatorName?: string | null;
    directMessageId?: string | number | null;
    note?: string | null;
  }
> {
  return apiJson('/api/alert/workflow/dm-operator', body);
}

export function submitCleaningOverdue(body: {
  machineId: string;
  message?: string;
  overdueDate?: string;
}): Promise<
  WorkflowConfigured & {
    ok?: boolean;
    delivery?: string;
    operatorName?: string | null;
    overdueDate?: string | null;
    note?: string | null;
  }
> {
  return apiJson('/api/alert/workflow/cleaning-overdue', body);
}

export function workflowNotConfiguredMessage(payload: WorkflowConfigured | undefined): string | null {
  if (payload?.configured === false || payload?.error?.includes('not configured')) {
    return 'Workflow not configured';
  }
  return null;
}
