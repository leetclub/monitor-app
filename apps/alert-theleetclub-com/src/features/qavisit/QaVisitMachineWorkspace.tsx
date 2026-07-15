import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTableHeader } from '@/components/AlertTableHeader';
import { MachineSearchSelect } from '@/components/MachineSearchSelect';
import { buildQaSummarySlides } from '@/components/QaVisitSummaryCarousel';
import { QaVisitFindingsTabs } from '@/components/QaVisitFindingsTabs';
import { QaVisitTrendChart } from '@/components/QaVisitTrendChart';
import { StitchKpiStrip, type StitchKpi } from '@/components/StitchKpiStrip';
import { TableScrollControls } from '@/components/TableScrollControls';
import {
  downloadQaReport,
  fetchQaBullets,
  fetchQaMachineAudits,
  fetchQaManualSummary,
  type QaMachineAuditRow,
} from '@/lib/leetWorkflowApi';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { parseBulletLines } from '@/lib/qaManualSummary';
import { canonicalQaMachineLabel, scLocationSubtitle } from '@/lib/qaMachineDisplay';
import { qaDefaultFromDate, qaTodayIso } from '@/lib/qaVisitDateRange';
import { qaScoreDisplay } from '@/lib/qaVisitDisplay';
import {
  compareNumbers,
  compareStrings,
  cycleColumnSort,
  sortDirForColumn,
  type ColumnSortState,
} from '@/lib/tableColumnSort';

type HistorySortKey = 'date' | 'location' | 'officer' | 'score';

function auditRowKey(row: QaMachineAuditRow, index: number): string {
  return String(row.auditId || row.lastVisitAt || row.lastVisitDate || index);
}

function auditSortMs(row: QaMachineAuditRow): number | null {
  const raw = row.lastVisitAt || row.lastVisitDate;
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : t;
}

/** Full-page machine workspace — ops dashboard layout, not modal chrome. */
export function QaVisitMachineWorkspace({
  machineName,
  machines = [],
  initialAuditId = '',
  initialDateFrom = qaDefaultFromDate(),
  initialDateTo = qaTodayIso(),
  onSelectMachine,
  onDateRangeChange,
}: {
  machineName: string;
  machines?: string[];
  initialAuditId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  onSelectMachine?: (name: string) => void;
  onDateRangeChange?: (from: string, to: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [locationQ, setLocationQ] = useState('');
  const [columnSort, setColumnSort] = useState<ColumnSortState<HistorySortKey>>({
    column: 'date',
    dir: 'desc',
  });
  const [selectedAuditId, setSelectedAuditId] = useState(initialAuditId);

  const machine = machineName.trim();
  const machineLabel = canonicalQaMachineLabel(machine);

  useEffect(() => {
    setSelectedAuditId(initialAuditId);
  }, [machineName, initialAuditId]);

  useEffect(() => {
    setDateFrom(initialDateFrom);
    setDateTo(initialDateTo);
  }, [machineName, initialDateFrom, initialDateTo]);

  function updateDateFrom(value: string) {
    setDateFrom(value);
    onDateRangeChange?.(value, dateTo);
  }

  function updateDateTo(value: string) {
    setDateTo(value);
    onDateRangeChange?.(dateFrom, value);
  }

  const manualQ = useQuery({
    queryKey: ['alert-qa-manual-summary', machine],
    queryFn: () => fetchQaManualSummary(machine),
    enabled: Boolean(machine),
    staleTime: 2 * 60_000,
  });

  const auditsQ = useQuery({
    queryKey: ['alert-qa-machine-audits', machine, dateFrom, dateTo, locationQ],
    queryFn: () =>
      fetchQaMachineAudits({
        machineName: machine,
        from: dateFrom,
        to: dateTo,
        location: locationQ,
        sort: 'date',
        order: 'desc',
        days: 365,
      }),
    enabled: Boolean(machine),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const audits = useMemo(() => {
    const rows = [...(auditsQ.data?.audits ?? [])];
    const dir = columnSort.dir;
    const col = columnSort.column;
    if (!dir || !col) {
      rows.sort((a, b) => (auditSortMs(b) ?? 0) - (auditSortMs(a) ?? 0));
      return rows;
    }
    rows.sort((a, b) => {
      if (col === 'location') return compareStrings(String(a.location || ''), String(b.location || ''), dir);
      if (col === 'officer') {
        return compareStrings(String(a.officerName || ''), String(b.officerName || ''), dir);
      }
      if (col === 'score') return compareNumbers(a.score ?? null, b.score ?? null, dir);
      return compareNumbers(auditSortMs(a), auditSortMs(b), dir);
    });
    return rows;
  }, [auditsQ.data?.audits, columnSort]);

  const selectedAudit = useMemo(() => {
    if (selectedAuditId) {
      const hit = audits.find((r) => String(r.auditId || '') === selectedAuditId);
      if (hit) return hit;
    }
    if (initialAuditId) {
      const hit = audits.find((r) => String(r.auditId || '') === initialAuditId);
      if (hit) return hit;
    }
    // Only default to newest when nothing is explicitly selected.
    if (!selectedAuditId && !initialAuditId) return audits[0] ?? null;
    return audits[0] ?? null;
  }, [audits, selectedAuditId, initialAuditId]);

  const activeAuditId = selectedAudit?.auditId ? String(selectedAudit.auditId) : selectedAuditId || '';

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

  const scKeyFindings = selectedAudit?.keyFindings?.length ? selectedAudit.keyFindings : [];
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

  const trend = auditsQ.data?.trend;
  const selectedScore = qaScoreDisplay(selectedAudit?.score);
  const qcVisitsMtd = manualQ.data?.monthCount ?? 0;
  const yearMonth = manualQ.data?.yearMonth;

  const kpis: StitchKpi[] = [
    {
      label: 'Inspections',
      value: String(auditsQ.data?.total ?? audits.length),
      sub: auditsQ.data?.dateFrom && auditsQ.data?.dateTo ? `${auditsQ.data.dateFrom} → ${auditsQ.data.dateTo}` : undefined,
    },
    {
      label: 'Selected score',
      value: selectedScore.text,
      tone: selectedScore.tone === 'good' ? 'good' : selectedScore.tone === 'low' ? 'warn' : 'default',
    },
    {
      label: 'Admin MTD',
      value: String(qcVisitsMtd),
      sub: yearMonth ? `Kuwait ${yearMonth}` : 'Kuwait month',
    },
    {
      label: 'Week trend',
      value: trend?.delta != null ? `${trend.delta > 0 ? '+' : ''}${trend.delta} pts` : '—',
      sub: trend?.trend && trend.trend !== 'unknown' ? trend.trend : 'vs prior week',
      tone: trend?.trend === 'improving' ? 'good' : trend?.trend === 'declining' ? 'warn' : 'default',
    },
  ];

  async function onDownload(auditId = activeAuditId) {
    if (!auditId || downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const stamp = (selectedAudit?.lastVisitDate || 'report').replace(/[^\d-]/g, '');
      await downloadQaReport(auditId, `qa-${machine.replace(/[^\w.-]+/g, '_').slice(0, 30)}-${stamp}.pdf`);
    } catch (ex) {
      setDownloadErr(ex instanceof Error ? ex.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="qaVisitWorkspace">
      <div className="opsToolStack">
        <div className="opsInset qaVisitWorkspaceFilters" aria-label="Inspection filters">
          <div className="opsSectionHead">
            <div>
              <span className="opsSectionTitle">Machine workspace</span>
              <span className="opsSectionTitleStrong">{machineLabel}</span>
            </div>
          </div>
          <div className="qaVisitFilterBar qaVisitFilterBar--workspace">
            {machines.length && onSelectMachine ? (
              <MachineSearchSelect
                className="qaVisitFilterBarMachine"
                machines={machines}
                value={machine}
                label="Machine"
                placeholder="Switch machine…"
                onSelect={onSelectMachine}
              />
            ) : null}
            <label className="qaVisitField">
              <span className="qaVisitFieldLabel">From</span>
              <input type="date" value={dateFrom} onChange={(e) => updateDateFrom(e.target.value)} />
            </label>
            <label className="qaVisitField">
              <span className="qaVisitFieldLabel">To</span>
              <input type="date" value={dateTo} onChange={(e) => updateDateTo(e.target.value)} />
            </label>
            <label className="qaVisitField">
              <span className="qaVisitFieldLabel">SC location</span>
              <input
                type="search"
                placeholder="OPD, Hallway…"
                value={locationQ}
                onChange={(e) => setLocationQ(e.target.value)}
              />
            </label>
          </div>
        </div>

        <section className="opsDashboardSection" aria-labelledby="qa-kpi-heading">
          <header className="opsDashboardSectionHead">
            <h2 id="qa-kpi-heading" className="opsDashboardSectionTitle">
              Insights
            </h2>
            {auditsQ.data?.auditsProcessed != null ? (
              <span className="opsDashboardSectionBadge">
                scanned {auditsQ.data.auditsProcessed}/{auditsQ.data.auditsSearched ?? '—'}
              </span>
            ) : null}
          </header>
          <div className="opsDashboardSectionBody opsDashboardSectionBody--kpis qaVisitKpiBody">
            <StitchKpiStrip items={kpis} />
            <QaVisitTrendChart trend={trend} variant="page" />
          </div>
        </section>

        <section className="opsDashboardSection opsDashboardSection--data" aria-label="Inspection history">
          <div className="opsDashboardSectionBody opsDashboardSectionBody--data">
            <div className="opsTableLead">
              <span className="opsTableLeadTitle">Inspection history</span>
              <span className="opsDashboardSectionBadge">
                {audits.length} row{audits.length === 1 ? '' : 's'}
              </span>
            </div>
            {auditsQ.isLoading ? <p className="qaVisitMuted">Loading…</p> : null}
            {auditsQ.isError ? <p className="qaVisitError">{(auditsQ.error as Error).message}</p> : null}
            {!auditsQ.isLoading && !audits.length ? (
              <p className="qaVisitMuted">
                {auditsQ.data?.error ||
                  'No inspections in this range. Widen dates or clear the location filter.'}
              </p>
            ) : null}
            {audits.length > 0 ? (
              <TableScrollControls hint={false}>
                <table className="stitchOpsTable opsFleetTable qaVisitAuditTable">
                <thead>
                  <tr>
                    <AlertTableHeader
                      className="qaVisitColDate"
                      label={{ main: 'Date' }}
                      title="Inspection date (Kuwait)"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'date')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'date'))}
                    />
                    <AlertTableHeader
                      label={{ main: 'SC', sub: 'site' }}
                      title="SafetyCulture site name (canonical machine label is in the page header)"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'location')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'location'))}
                    />
                    <AlertTableHeader
                      label={{ main: 'Officer' }}
                      title="Inspector name"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'officer')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'officer'))}
                    />
                    <AlertTableHeader
                      className="qaVisitColScore"
                      label={{ main: 'Score' }}
                      title="Inspection score %"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'score')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'score'))}
                    />
                    <th className="qaVisitColAction">PDF</th>
                  </tr>
                </thead>
                  <tbody>
                    {audits.map((row, index) => {
                      const id = row.auditId ? String(row.auditId) : `row-${index}`;
                      const hasRealId = Boolean(row.auditId);
                      const isSelected = hasRealId
                        ? id === activeAuditId
                        : Boolean(selectedAudit && auditRowKey(selectedAudit, -1) === auditRowKey(row, index));
                      const rowScore = qaScoreDisplay(row.score);
                      const rowScSub = scLocationSubtitle(machine, row.location);
                      const when = row.lastVisitAt
                        ? formatKuwaitDateTime(row.lastVisitAt)
                        : row.lastVisitDate || '—';
                      return (
                        <tr
                          key={auditRowKey(row, index)}
                          className={`qaVisitAuditRow${isSelected ? ' qaVisitAuditRow--selected' : ''}`}
                          tabIndex={0}
                          aria-selected={isSelected}
                          onClick={() => {
                            if (hasRealId) setSelectedAuditId(String(row.auditId));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (hasRealId) setSelectedAuditId(String(row.auditId));
                            }
                          }}
                        >
                          <td className="qaVisitColDate" data-mono="true">
                            {when}
                          </td>
                          <td>
                            <div className="opsMachineName">{machineLabel}</div>
                            {rowScSub ? <div className="opsCellSub">{rowScSub}</div> : null}
                          </td>
                          <td>{row.officerName || '—'}</td>
                          <td className="qaVisitColScore">
                            <span className={`qaVisitScoreChip qaVisitScoreChip--${rowScore.tone}`}>
                              {rowScore.text}
                            </span>
                          </td>
                          <td className="qaVisitColAction">
                            {hasRealId ? (
                              <button
                                type="button"
                                className="qaVisitTableAction"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onDownload(String(row.auditId));
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
              </TableScrollControls>
            ) : null}
          </div>
        </section>

        {selectedAudit ? (
          <section className="opsDashboardSection" aria-label="Selected inspection">
            <header className="opsDashboardSectionHead">
              <h2 className="opsDashboardSectionTitle">Selected inspection</h2>
              {activeAuditId ? (
                <button
                  type="button"
                  className="stitchRefreshBtn"
                  disabled={downloading}
                  onClick={() => void onDownload()}
                >
                  {downloading ? 'Preparing PDF…' : 'Download PDF'}
                </button>
              ) : null}
            </header>
            <div className="opsDashboardSectionBody qaVisitSelectedBody">
              <dl className="qaVisitSelectedMeta">
                {selectedAudit.location ? (
                  <>
                    <dt>Machine</dt>
                    <dd>{machineLabel}</dd>
                    {scLocationSubtitle(machine, selectedAudit.location) ? (
                      <>
                        <dt>SC site</dt>
                        <dd>{selectedAudit.location}</dd>
                      </>
                    ) : null}
                  </>
                ) : null}
                {selectedAudit.officerName ? (
                  <>
                    <dt>Officer</dt>
                    <dd>{selectedAudit.officerName}</dd>
                  </>
                ) : null}
                {selectedAudit.lastVisitAt || selectedAudit.lastVisitDate ? (
                  <>
                    <dt>Inspection</dt>
                    <dd>
                      {selectedAudit.lastVisitAt
                        ? formatKuwaitDateTime(selectedAudit.lastVisitAt)
                        : selectedAudit.lastVisitDate}
                    </dd>
                  </>
                ) : null}
                <dt>Score</dt>
                <dd>
                  <span className={`qaVisitScoreChip qaVisitScoreChip--${selectedScore.tone}`}>
                    {selectedScore.text}
                  </span>
                </dd>
              </dl>
              {manualQ.isError ? <p className="qaVisitError">{(manualQ.error as Error).message}</p> : null}
              <QaVisitFindingsTabs key={activeAuditId || 'none'} slides={slides} />
              {downloadErr ? <p className="qaVisitError">{downloadErr}</p> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
