import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { fetchTechVisitWorkflow } from '@/lib/leetWorkflowApi';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import type { OperatorActivityTimes } from '@/components/OperatorActivityCell';

type TechScheduleRow = {
  name?: string;
  vendon_user_id?: string | null;
  days?: number[];
  windows?: { start?: string; end?: string }[];
};

function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').replace('Z', '').slice(0, 16);
}

export function TechVisitWorkflowModal({
  machineName,
  machineId,
  fallbackLastVisitAt,
  fallbackVisitorName,
  fallbackComment,
  onClose,
}: {
  machineName: string;
  machineId: string;
  fallbackLastVisitAt?: string;
  fallbackVisitorName?: string | null;
  fallbackComment?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);

  const q = useQuery({
    queryKey: ['leet-workflow-tech-visit', machineId, machineName],
    queryFn: () => fetchTechVisitWorkflow(machineId, machineName),
    enabled: Boolean(machineId),
    staleTime: 10 * 60_000,
  });

  const profileQ = useQuery({
    queryKey: ['alert-machine-profile-tech', machineId],
    queryFn: async () => {
      const res = await apiGet<{
        rows?: {
          machine_id?: string;
          technician_schedule?: TechScheduleRow[];
        }[];
      }>('/api/alert/overall/admin-profiles');
      const row = (res.rows || []).find((r) => String(r.machine_id) === String(machineId));
      return row?.technician_schedule ?? [];
    },
    enabled: Boolean(machineId),
    staleTime: 5 * 60_000,
  });

  const activityQ = useQuery({
    queryKey: ['alert-operator-activity-tech', machineId],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, OperatorActivityTimes> }>(
        `/api/alert/operator-activity?machines=${encodeURIComponent(machineId)}&days=7`,
      ),
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });

  const creditsQ = useQuery({
    queryKey: ['alert-remote-credits-tech', machineId],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<string, { dispense_tests?: number; credits_sent?: number }>;
      }>(`/api/alert/remote-credits/today-totals?machines=${encodeURIComponent(machineId)}`),
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });

  const payload = q.data;
  const lastVisitIso =
    (payload?.lastVisitAt ? String(payload.lastVisitAt) : '') ||
    (fallbackLastVisitAt ? String(fallbackLastVisitAt).trim() : '');
  const visitorName = payload?.visitorName || fallbackVisitorName || null;
  const comment = payload?.comment || fallbackComment || null;
  const source = payload?.source;
  const workflowNote =
    payload?.error &&
    (String(payload.error).includes('Task Manager') || String(payload.error).includes('not available')) &&
    !lastVisitIso
      ? payload.error
      : payload?.error && !lastVisitIso
        ? payload.error
        : null;

  const assignedTechs = (profileQ.data || []).filter((t) => String(t.name || '').trim());
  const activity = activityQ.data?.byMachineId?.[machineId];
  const physical = activity?.technicianPhysicalAttendance;
  const physicalAt = physical?.at || null;
  const drinkTests = creditsQ.data?.byMachineId?.[machineId]?.dispense_tests ?? 0;
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Tech visit</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {q.isLoading && !lastVisitIso ? (
          <AlertModalAnticipate hint="Tech visit record incoming" lines={3} />
        ) : null}
        {q.error && !lastVisitIso ? <p className="stitchOpsAlert">{(q.error as Error).message}</p> : null}
        {lastVisitIso ? (
          <div className="alertModalContentReveal">
            <p className="salesHistoryNote">
              Last visit: <strong>{formatKuwaitDateTime(lastVisitIso)}</strong>
              {source === 'safetyculture' ? ' · SafetyCulture' : null}
            </p>
            {visitorName ? (
              <p className="salesHistoryNote">
                Visitor: <strong>{visitorName}</strong>
              </p>
            ) : null}
            {comment ? <p className="historyModalRowExplain">{comment}</p> : null}
            {payload?.error && source === 'safetyculture' ? (
              <p className="salesHistoryEmpty salesHistoryFootnote">{payload.error}</p>
            ) : null}
          </div>
        ) : !q.isLoading ? (
          <p className="salesHistoryEmpty">{workflowNote || 'No tech visit on record for this machine'}</p>
        ) : null}

        <section className="operatorWorkflowSection" style={{ marginTop: 14 }}>
          <h3 className="salesHistoryCompareTitle">Assigned technician</h3>
          {profileQ.isLoading ? (
            <AlertModalAnticipate hint="Schedule incoming" lines={2} />
          ) : assignedTechs.length ? (
            <ul className="salesHistoryList">
              {assignedTechs.map((t, i) => (
                <li key={i} className="salesHistoryRow">
                  <span className="salesHistoryCompareTitle">{t.name}</span>
                  <span className="salesHistoryGridVal">
                    {(t.days || []).length
                      ? (t.days || [])
                          .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] ?? d)
                          .join(' ')
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="salesHistoryEmpty">No technician assigned in Alert Admin → Machines</p>
          )}
        </section>

        <section className="operatorWorkflowSection" style={{ marginTop: 12 }}>
          <h3 className="salesHistoryCompareTitle">On-site proof (technician only)</h3>
          <p className="salesHistoryNote" style={{ opacity: 0.85, fontSize: '0.78rem' }}>
            Same Monitor Attendance proof as operators (successful remote credit + power interrupts), but only when the
            Vendon user type is <strong>technician</strong> — operator presence is ignored here. Drink tests today are
            machine-level.
          </p>
          <p className="salesHistoryNote">
            Drink tests today: <strong>{drinkTests}</strong>
          </p>
          {physicalAt ? (
            <div className="alertModalContentReveal">
              <p className="salesHistoryNote">
                Technician presence:{' '}
                <span className={physical?.proven !== false ? 'pillSuccess' : 'pillWarn'}>
                  {physical?.proven !== false ? 'Proven' : 'Unconfirmed'}
                </span>
                {physical?.isToday ? ' · today' : physical?.date ? ` · ${physical.date}` : ''}
              </p>
              {physical?.userName ? (
                <p className="salesHistoryNote">
                  Technician: {physical.userName}
                  {physical.userType ? ` (${physical.userType})` : ''}
                </p>
              ) : null}
              <p className="salesHistoryNote">At: {formatIsoShort(physicalAt)}</p>
            </div>
          ) : (
            <p className="salesHistoryEmpty">No proven technician on-site presence in recent Attendance cache</p>
          )}
        </section>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
