import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { QaIssueFrequencySection } from '@/components/QaIssueFrequencySection';
import {
  buildQaSummarySlides,
  QaVisitSummaryCarousel,
} from '@/components/QaVisitSummaryCarousel';
import { QaVisitTrendChart } from '@/components/QaVisitTrendChart';
import {
  downloadQaReport,
  fetchQaBullets,
  fetchQaMachineAudits,
  fetchQaManualSummary,
  type QaMachineAuditRow,
} from '@/lib/leetWorkflowApi';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { buildQaIssueFrequency } from '@/lib/qaIssueFrequency';
import { parseBulletLines } from '@/lib/qaManualSummary';
import { canonicalQaMachineLabel, scLocationSubtitle } from '@/lib/qaMachineDisplay';
import { qaScoreDisplay, type QaVisitRow } from '@/lib/qaVisitDisplay';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

function defaultFromDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function auditRowKey(row: QaMachineAuditRow, index: number): string {
  return String(row.auditId || row.lastVisitAt || row.lastVisitDate || index);
}

/** Red Flags / Overall cell popup — unchanged full QA modal (separate from QA Visit tab). */
export function QaVisitModal({
  machineName,
  visit,
  onClose,
}: {
  machineName: string;
  visit: QaVisitRow;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultFromDate);
  const [dateTo, setDateTo] = useState(todayIso);
  const [locationQ, setLocationQ] = useState('');
  const [sort, setSort] = useState<'date' | 'score'>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const initialAuditId = visit.auditId ? String(visit.auditId) : '';
  const [selectedAuditId, setSelectedAuditId] = useState(initialAuditId);

  useEffect(() => {
    setSelectedAuditId(initialAuditId);
  }, [machineName, initialAuditId]);

  const manualQ = useQuery({
    queryKey: ['alert-qa-manual-summary', machineName],
    queryFn: () => fetchQaManualSummary(machineName),
    enabled: Boolean(machineName.trim()),
    staleTime: 2 * 60_000,
  });

  const auditsQ = useQuery({
    queryKey: ['alert-qa-machine-audits', machineName, dateFrom, dateTo, locationQ, sort, order],
    queryFn: () =>
      fetchQaMachineAudits({
        machineName,
        from: dateFrom,
        to: dateTo,
        location: locationQ,
        sort,
        order,
        days: 365,
      }),
    enabled: Boolean(machineName.trim()),
    staleTime: 5 * 60_000,
  });

  const audits = auditsQ.data?.audits ?? [];

  const issueFrequency = useMemo(() => buildQaIssueFrequency(audits), [audits]);

  const selectedAudit = useMemo(() => {
    if (selectedAuditId) {
      const hit = audits.find((r) => String(r.auditId) === selectedAuditId);
      if (hit) return hit;
    }
    if (initialAuditId && visit.auditId) return visit as QaMachineAuditRow;
    return audits[0] ?? (visit.auditId ? (visit as QaMachineAuditRow) : null);
  }, [audits, selectedAuditId, initialAuditId, visit]);

  const activeAuditId = selectedAudit?.auditId ? String(selectedAudit.auditId) : '';

  const aiBulletsQ = useQuery({
    queryKey: ['alert-qa-sc-bullets', activeAuditId],
    queryFn: () => fetchQaBullets(activeAuditId),
    enabled: Boolean(activeAuditId),
    staleTime: 10 * 60_000,
  });

  const manualBullets = useMemo(() => {
    const d = manualQ.data;
    if (d?.bullets?.length) return d.bullets;
    if (d?.summary?.trim()) return parseBulletLines(d.summary);
    return [];
  }, [manualQ.data]);

  const scKeyFindings =
    selectedAudit?.keyFindings?.length ? selectedAudit.keyFindings : visit.keyFindings?.length ? visit.keyFindings : [];
  const aiBullets = aiBulletsQ.data?.bullets?.length ? aiBulletsQ.data.bullets : [];

  const slides = useMemo(
    () =>
      buildQaSummarySlides({
        manualBullets,
        scKeyFindings,
        aiBullets,
        savedAt: manualQ.data?.savedAt,
        savedBy: manualQ.data?.savedBy,
        inspectionAt: selectedAudit?.lastVisitAt || selectedAudit?.lastVisitDate,
      }),
    [
      manualBullets,
      scKeyFindings,
      aiBullets,
      manualQ.data?.savedAt,
      manualQ.data?.savedBy,
      selectedAudit?.lastVisitAt,
      selectedAudit?.lastVisitDate,
    ],
  );

  const displayScore = selectedAudit?.score ?? visit.score;
  const score = qaScoreDisplay(displayScore);
  const qcVisitsMtd = manualQ.data?.monthCount ?? visit.adminSummaryMtd ?? 0;
  const yearMonth = manualQ.data?.yearMonth;
  const scWhen = activeAuditId
    ? selectedAudit?.lastVisitAt || selectedAudit?.lastVisitDate
    : visit.auditId
      ? visit.lastVisitAt || visit.lastVisitDate
      : null;
  const scOfficer = activeAuditId ? selectedAudit?.officerName : visit.auditId ? visit.officerName : null;
  const scLocation = selectedAudit?.location || visit.location;
  const machineLabel = canonicalQaMachineLabel(machineName);
  const scSub = scLocationSubtitle(machineName, scLocation);
  const adminWhen = manualQ.data?.savedAt || visit.adminSummaryAt;
  const adminBy = manualQ.data?.savedBy || visit.adminSummaryBy;

  async function onDownload(auditId = activeAuditId) {
    if (!auditId || downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const stamp = (selectedAudit?.lastVisitDate || 'report').replace(/[^\d-]/g, '');
      await downloadQaReport(auditId, `qa-${machineName.replace(/[^\w.-]+/g, '_').slice(0, 30)}-${stamp}.pdf`);
    } catch (ex) {
      setDownloadErr(ex instanceof Error ? ex.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return createPortal(
    <div className="salesHistoryBackdrop qaVisitModal" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal qaVisitModalPanel" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">QA visit</p>
            <h2 className="salesHistoryTitle">{machineLabel}</h2>
            {scSub ? <p className="salesHistorySub">{scSub}</p> : null}
            {scOfficer ? <p className="salesHistorySub">{scOfficer}</p> : null}
            {scWhen ? (
              <p className="salesHistorySub">
                Inspection:{' '}
                {selectedAudit?.lastVisitAt ? formatKuwaitDateTime(selectedAudit.lastVisitAt) : scWhen}
              </p>
            ) : null}
            {!activeAuditId && adminWhen ? (
              <p className="salesHistorySub">
                Latest admin summary: {formatKuwaitDateTime(adminWhen)}
                {adminBy ? ` · ${adminBy}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">

        <div className="qaVisitMetaGrid">
          <div>
            <span className="qaVisitMetaLabel">SafetyCulture score</span>
            <span className={`qaVisitScoreChip qaVisitScoreChip--${score.tone}`}>{score.text}</span>
          </div>
          <div>
            <span className="qaVisitMetaLabel">QC visits MTD</span>
            <span className="qaVisitMetaVal">{qcVisitsMtd}</span>
            <span className="qaVisitMetaSub">
              Admin QA summaries · Asia/Kuwait calendar month
              {yearMonth ? ` (${yearMonth})` : ''}
            </span>
          </div>
        </div>

        <QaVisitTrendChart trend={auditsQ.data?.trend} />

        <div className="qaVisitHistoryFilters" aria-label="Inspection history filters">
          <label className="qaVisitFilterField">
            <span className="qaVisitMetaLabel">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="qaVisitFilterField">
            <span className="qaVisitMetaLabel">To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="qaVisitFilterField qaVisitFilterField--grow">
            <span className="qaVisitMetaLabel">Location</span>
            <input
              type="search"
              placeholder="e.g. OPD, Hallway"
              value={locationQ}
              onChange={(e) => setLocationQ(e.target.value)}
            />
          </label>
          <label className="qaVisitFilterField">
            <span className="qaVisitMetaLabel">Sort</span>
            <select
              value={`${sort}-${order}`}
              onChange={(e) => {
                const [s, o] = e.target.value.split('-') as ['date' | 'score', 'asc' | 'desc'];
                setSort(s);
                setOrder(o);
              }}
            >
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="score-desc">Highest score</option>
              <option value="score-asc">Lowest score</option>
            </select>
          </label>
        </div>

        <div className="qaVisitHistoryTableWrap">
          {auditsQ.isLoading ? <p className="salesHistoryEmpty">Loading inspection history…</p> : null}
          {auditsQ.isError ? (
            <p className="salesHistoryEmpty">{(auditsQ.error as Error).message}</p>
          ) : null}
          {!auditsQ.isLoading && !audits.length ? (
            <p className="salesHistoryEmpty">
              {auditsQ.data?.error ||
                'No SafetyCulture inspections in this date range. Try widening dates or clearing the location filter.'}
            </p>
          ) : null}
          {audits.length > 0 ? (
            <table className="qaVisitHistoryTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Officer</th>
                  <th>Score</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((row, index) => {
                  const id = row.auditId ? String(row.auditId) : '';
                  const isSelected = id && id === activeAuditId;
                  const rowScore = qaScoreDisplay(row.score);
                  const rowScSub = scLocationSubtitle(machineName, row.location);
                  const when = row.lastVisitAt
                    ? formatKuwaitDateTime(row.lastVisitAt)
                    : row.lastVisitDate || '—';
                  return (
                    <tr
                      key={auditRowKey(row, index)}
                      className={isSelected ? 'qaVisitHistoryRow--active' : ''}
                      onClick={() => {
                        if (id) setSelectedAuditId(id);
                      }}
                    >
                      <td>{when}</td>
                      <td>
                        <div className="opsMachineName">{machineLabel}</div>
                        {rowScSub ? <div className="opsCellSub">{rowScSub}</div> : null}
                      </td>
                      <td>{row.officerName || '—'}</td>
                      <td>
                        <span className={`qaVisitScoreChip qaVisitScoreChip--${rowScore.tone}`}>
                          {rowScore.text}
                        </span>
                      </td>
                      <td>
                        {id ? (
                          <button
                            type="button"
                            className="qaVisitHistoryPdfBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDownload(id);
                            }}
                            disabled={downloading}
                          >
                            PDF
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>

        {auditsQ.data?.total != null && audits.length > 0 ? (
          <p className="qaVisitHistoryCount">
            {auditsQ.data.total} inspection{auditsQ.data.total === 1 ? '' : 's'}
            {auditsQ.data.dateFrom && auditsQ.data.dateTo
              ? ` · ${auditsQ.data.dateFrom} → ${auditsQ.data.dateTo}`
              : ''}
            {auditsQ.data.auditsProcessed != null && auditsQ.data.auditsSearched != null
              ? ` · scanned ${auditsQ.data.auditsProcessed}/${auditsQ.data.auditsSearched}`
              : ''}
          </p>
        ) : null}

        {manualQ.isError ? (
          <p className="salesHistoryEmpty">{(manualQ.error as Error).message}</p>
        ) : null}

        <QaVisitSummaryCarousel slides={slides} machineKey={`${machineName}-${activeAuditId}`} />

        <QaIssueFrequencySection
          rows={issueFrequency}
          loading={auditsQ.isLoading}
          dateFrom={auditsQ.data?.dateFrom || dateFrom}
          dateTo={auditsQ.data?.dateTo || dateTo}
          inspectionCount={audits.length}
          selectedAuditId={activeAuditId}
          onSelectAudit={(id) => setSelectedAuditId(id)}
        />

        {activeAuditId ? (
          <button
            type="button"
            className="qaVisitReportBtn"
            disabled={downloading}
            onClick={() => void onDownload()}
          >
            {downloading ? 'Preparing PDF…' : 'Download selected report (PDF)'}
          </button>
        ) : (
          <p className="qaVisitHistoryHint">Select an inspection above to view findings and download its PDF.</p>
        )}
        {downloadErr ? <p className="salesHistoryEmpty">{downloadErr}</p> : null}
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}
