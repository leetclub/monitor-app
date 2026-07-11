import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { createPortal } from 'react-dom';
import type { OperatorSchedulePayload } from '@/lib/leetWorkflowApi';
import { workflowNotConfiguredMessage } from '@/lib/leetWorkflowApi';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

export function OperatorAttendanceModal({
  machineName,
  machineId,
  data,
  loading,
  error,
  onClose,
}: {
  machineName: string;
  machineId: string;
  data?: OperatorSchedulePayload;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  const notConfigured = workflowNotConfiguredMessage(data);

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Leet Workflow · operator schedule</p>
            <h2 className="salesHistoryTitle">{machineName}</h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {loading ? <AlertModalAnticipate hint="Schedule incoming" lines={4} /> : null}
        {error ? <p className="stitchOpsAlert">{error}</p> : null}
        {notConfigured ? (
          <p className="salesHistoryEmpty">{notConfigured}</p>
        ) : data && !loading ? (
          <div className="alertModalContentReveal">
            {data.schedulePeriodName ? (
              <p className="salesHistoryNote">Schedule: {data.schedulePeriodName}</p>
            ) : null}
            <p className="salesHistoryNote">
              Operator: <strong>{data.operatorName || '—'}</strong>
              {data.positionLabel ? ` · ${data.positionLabel}` : ''}
              {' · '}
              {data.attendanceStatusLabel ||
                (data.present ? 'Present' : data.present === false ? 'Absent' : '—')}
              {data.state ? ` (${data.state})` : ''}
            </p>
            {data.todayClockIn ? (
              <p className="salesHistoryNote">
                Clock in: {String(data.todayClockIn).replace('T', ' ').slice(0, 16)}
                {data.todayClockOut
                  ? ` · out ${String(data.todayClockOut).replace('T', ' ').slice(0, 16)}`
                  : ''}
              </p>
            ) : null}
            <ul className="salesHistoryList">
              <li className="salesHistoryRow">
                <span className="salesHistoryCompareTitle">Days absent MTD</span>
                <span className="salesHistoryGridVal">{data.absentDaysMtd ?? '—'}</span>
              </li>
              <li className="salesHistoryRow">
                <span className="salesHistoryCompareTitle">Days late MTD</span>
                <span className="salesHistoryGridVal">{data.lateDaysMtd ?? '—'}</span>
              </li>
              {data.machineInCharge ? (
                <li className="salesHistoryRow">
                  <span className="salesHistoryCompareTitle">Machine in-charge (Admin schedule)</span>
                  <span className="salesHistoryGridVal">{data.machineInCharge}</span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
