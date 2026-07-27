import { useState } from 'react';
import type { QaFindingRow, QaVisitRow } from '@/lib/qaVisitDisplay';
import { qaScoreDisplay } from '@/lib/qaVisitDisplay';
import { formatKuwaitCleaningWhen, formatKuwaitDateTime } from '@/lib/formatKuwait';
import { QaVisitModal } from '@/components/QaVisitModal';
import { bindStopRowClick } from '@/lib/stopRowClick';
import { TechVisitWorkflowModal } from '@/components/TechVisitWorkflowModal';

function daysLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return 'Today';
  if (n === 1) return '1d';
  return `${n}d`;
}

function compactVisitDate(iso: string | null | undefined): string | null {
  const when = formatKuwaitCleaningWhen(iso);
  if (!when) return null;
  return when.date.replace(/ \d{4}$/, '');
}

export function QaVisitCell({
  machineName,
  machineId,
  visit,
  findings,
  loading,
  error,
  mode = 'qa',
}: {
  machineName: string;
  machineId?: string;
  visit: QaVisitRow | null;
  findings?: QaFindingRow[];
  loading?: boolean;
  error?: string | null;
  mode?: 'qa' | 'tech';
}) {
  const [open, setOpen] = useState(false);

  if (loading) return <span className="qaVisitCellMuted">…</span>;

  const hasVisit =
    visit &&
    (visit.lastVisitAt ||
      visit.lastVisitDate ||
      visit.daysSinceVisit != null ||
      (visit.adminSummaryMtd ?? 0) > 0);

  // Never blank the whole column for a secondary error (e.g. Slack findings list down)
  // when SafetyCulture visit data is present.
  if (error && !hasVisit) {
    return <span className="qaVisitCellMuted" title={error}>!</span>;
  }

  if (!hasVisit && mode === 'tech' && machineId) {
    return (
      <>
        <button
          type="button"
          className="qaVisitCellBtn qaVisitCellBtnMuted"
          title="Tap to load tech visit (SafetyCulture)"
          {...bindStopRowClick(() => setOpen(true))}
        >
          <span className="qaVisitCellDays">—</span>
        </button>
        {open ? (
          <TechVisitWorkflowModal
            machineName={machineName}
            machineId={machineId}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  if (!hasVisit) {
    return <span className="qaVisitCellMuted">—</span>;
  }

  const openCount = findings?.length ?? 0;
  const visitRow = visit!;
  const rel = daysLabel(visitRow.daysSinceVisit);
  const dateShort = compactVisitDate(visitRow.lastVisitAt) || visitRow.lastVisitDate || null;
  const score = mode === 'qa' ? qaScoreDisplay(visitRow.score) : null;
  const fullTip = visitRow.lastVisitAt
    ? formatKuwaitDateTime(visitRow.lastVisitAt)
    : visitRow.lastVisitDate || undefined;

  return (
    <>
      <button
        type="button"
        className={`qaVisitCellBtn${visitRow.daysSinceVisit != null && visitRow.daysSinceVisit > 14 ? ' qaVisitCellBtnWarn' : ''}`}
        title={
          fullTip
            ? `${fullTip}${mode === 'tech' ? ' · Leet Workflow tech visit' : ' · Tap for QA summary + PDF download'}`
            : mode === 'tech'
              ? 'Leet Workflow last tech visit — tap for visitor + comment'
              : 'Tap for QA summary + PDF download'
        }
        {...bindStopRowClick(() => setOpen(true))}
      >
        {dateShort ? <span className="qaVisitCellDate">{dateShort}</span> : null}
        {score && score.tone !== 'muted' ? (
          <span className={`qaVisitScoreChip qaVisitScoreChip--${score.tone}`}>{score.text}</span>
        ) : null}
        <span className="qaVisitCellDays">{rel}</span>
        {mode === 'qa' && (visitRow.adminSummaryMtd ?? 0) > 0 ? (
          <span className="qaVisitCellFindings" title="QC visits MTD (Admin summaries this month)">
            {visitRow.adminSummaryMtd}
          </span>
        ) : null}
        {mode === 'qa' && openCount > 0 ? (
          <span className="qaVisitCellFindings">{openCount}</span>
        ) : null}
      </button>
      {open && mode === 'qa' ? (
        <QaVisitModal machineName={machineName} visit={visitRow} onClose={() => setOpen(false)} />
      ) : null}
      {open && mode === 'tech' && machineId ? (
        <TechVisitWorkflowModal
          machineName={machineName}
          machineId={machineId}
          fallbackLastVisitAt={visitRow.lastVisitAt ?? undefined}
          fallbackVisitorName={visitRow.officerName}
          fallbackComment={visitRow.summary}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
