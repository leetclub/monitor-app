import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTableHeader } from '@/components/AlertTableHeader';
import { MachineSearchSelect } from '@/components/MachineSearchSelect';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { TableScrollControls } from '@/components/TableScrollControls';
import { QaVisitMachineWorkspace } from '@/features/qavisit/QaVisitMachineWorkspace';
import { apiGet } from '@/lib/api';
import { fetchQaFleet } from '@/lib/leetWorkflowApi';
import {
  adminSummaryMtdForMachine,
  qaLastVisitSortMs,
  qaScoreDisplay,
  qaVisitForMachineName,
  type QaSummaryResponse,
  type QaVisitRow,
} from '@/lib/qaVisitDisplay';
import { qaDateRangeFromSearchParams, qaDefaultFromDate, qaTodayIso } from '@/lib/qaVisitDateRange';
import { formatKuwaitCleaningWhen } from '@/lib/formatKuwait';
import {
  compareNumbers,
  compareStrings,
  cycleColumnSort,
  sortDirForColumn,
  type ColumnSortState,
} from '@/lib/tableColumnSort';

type MachineRow = { id?: string | number; name?: string };
type MachinesResponse = { machines?: MachineRow[] };
type FleetSortKey = 'name' | 'visit' | 'score' | 'mtd';

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function visitInDateRange(visit: QaVisitRow | null | undefined, from: string, to: string): boolean {
  if (!visit) return false;
  const raw = visit.lastVisitAt || visit.lastVisitDate;
  if (!raw) return false;
  const day = String(raw).slice(0, 10);
  return day >= from && day <= to;
}

function visitFromFleetRow(row: QaVisitRow | undefined, adminMtd: number): QaVisitRow | null {
  if (!row?.auditId && !row?.lastVisitAt && !row?.lastVisitDate && adminMtd <= 0) return null;
  return { ...row, adminSummaryMtd: adminMtd };
}

export function QaVisitPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const machineFromUrl = (searchParams.get('machine') || '').trim();
  const auditFromUrl = (searchParams.get('auditId') || '').trim();
  const { from: dateFromUrl, to: dateToUrl } = qaDateRangeFromSearchParams(searchParams);

  const [machineName, setMachineName] = useState(machineFromUrl);
  const [machineQ, setMachineQ] = useState('');
  const [columnSort, setColumnSort] = useState<ColumnSortState<FleetSortKey>>({
    column: 'visit',
    dir: 'desc',
  });
  const [dateFrom, setDateFrom] = useState(dateFromUrl);
  const [dateTo, setDateTo] = useState(dateToUrl);

  useEffect(() => {
    if (machineFromUrl) setMachineName(machineFromUrl);
  }, [machineFromUrl]);

  useEffect(() => {
    setDateFrom(dateFromUrl);
    setDateTo(dateToUrl);
  }, [dateFromUrl, dateToUrl]);

  const showFleet = !machineName.trim();

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });

  const qaSummaryQ = useQuery({
    queryKey: ['alert-qa-summary'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 90_000,
    refetchInterval: 3 * 60_000,
    enabled: showFleet || Boolean(machineName),
  });

  const fleetQ = useQuery({
    queryKey: ['alert-qa-fleet', dateFrom, dateTo],
    queryFn: () => fetchQaFleet({ from: dateFrom, to: dateTo }),
    enabled: showFleet,
    staleTime: 90_000,
    refetchInterval: 3 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const machines = useMemo(() => {
    const rows = machinesQ.data?.machines ?? [];
    return rows
      .map((m) => String(m.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [machinesQ.data?.machines]);

  const adminMtdByMachine =
    qaSummaryQ.data?.adminSummaryMtdByMachine ?? fleetQ.data?.adminSummaryMtdByMachine;

  const fleetRows = useMemo(() => {
    const fleetByMachine = fleetQ.data?.byMachine;
    const byLoc = qaSummaryQ.data?.byLocationKey;
    return machines.map((name) => {
      const adminMtd = adminSummaryMtdForMachine(name, adminMtdByMachine);
      let visit: QaVisitRow | null = null;
      if (fleetByMachine?.[name]) {
        visit = visitFromFleetRow(fleetByMachine[name], adminMtd);
      } else if (qaSummaryQ.data?.latestByMachine?.[name]) {
        visit = visitFromFleetRow(qaSummaryQ.data.latestByMachine[name], adminMtd);
      } else if (byLoc) {
        visit = qaVisitForMachineName(name, byLoc, adminMtdByMachine, qaSummaryQ.data?.latestByMachine);
      }
      if (visit && !visitInDateRange(visit, dateFrom, dateTo)) {
        const hasAdmin = (visit.adminSummaryMtd ?? adminMtd) > 0;
        visit = hasAdmin
          ? {
              ...visit,
              adminSummaryMtd: visit.adminSummaryMtd ?? adminMtd,
              lastVisitAt: null,
              lastVisitDate: null,
              score: null,
              auditId: null,
            }
          : null;
      }
      return { name, visit };
    });
  }, [
    machines,
    fleetQ.data?.byMachine,
    qaSummaryQ.data?.byLocationKey,
    qaSummaryQ.data?.latestByMachine,
    adminMtdByMachine,
    dateFrom,
    dateTo,
  ]);

  const sortedFleet = useMemo(() => {
    const rows = [...fleetRows];
    const dir = columnSort.dir;
    const col = columnSort.column;
    if (!dir || !col) {
      rows.sort((a, b) => (qaLastVisitSortMs(b.visit) ?? 0) - (qaLastVisitSortMs(a.visit) ?? 0));
      return rows;
    }
    rows.sort((a, b) => {
      if (col === 'name') return compareStrings(a.name, b.name, dir);
      if (col === 'score') {
        return compareNumbers(a.visit?.score ?? null, b.visit?.score ?? null, dir);
      }
      if (col === 'mtd') {
        return compareNumbers(a.visit?.adminSummaryMtd ?? 0, b.visit?.adminSummaryMtd ?? 0, dir);
      }
      return compareNumbers(qaLastVisitSortMs(a.visit), qaLastVisitSortMs(b.visit), dir);
    });
    return rows;
  }, [fleetRows, columnSort]);

  const fleetFiltered = useMemo(() => {
    const q = norm(machineQ);
    if (!q) return sortedFleet;
    return sortedFleet.filter((r) => norm(r.name).includes(q));
  }, [machineQ, sortedFleet]);

  function patchSearchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function selectMachine(name: string, auditId?: string) {
    setMachineName(name);
    setMachineQ('');
    patchSearchParams({
      machine: name || null,
      auditId: auditId || null,
    });
  }

  function onDateFromChange(value: string) {
    setDateFrom(value);
    patchSearchParams({ from: value || null });
  }

  function onDateToChange(value: string) {
    setDateTo(value);
    patchSearchParams({ to: value || null });
  }

  return (
    <StitchOpsPanel
      iconName="qa_visit"
      title="QA Visit"
      subtitle="Fleet-wide SafetyCulture insights — filter by date, then inspect a machine for full history."
      compact
      badge={
        qaSummaryQ.data?.yearMonth ?? fleetQ.data?.yearMonth ? (
          <span title="Admin summary month (Kuwait)">
            {qaSummaryQ.data?.yearMonth ?? fleetQ.data?.yearMonth}
          </span>
        ) : null
      }
      toolbar={
        machineName ? (
          <button type="button" className="stitchRefreshBtn" onClick={() => selectMachine('')}>
            ← All machines
          </button>
        ) : null
      }
    >
      {showFleet ? (
        <section className="opsDashboardSection opsDashboardSection--data qaVisitFleetSection" aria-label="QA fleet">
          <div className="opsDashboardSectionBody opsDashboardSectionBody--data">
            <div className="opsInset qaVisitFleetFilters">
              <div className="opsSectionHead">
                <div>
                  <span className="opsSectionTitle">Fleet filters</span>
                  <span className="opsSectionTitleStrong">Date range · machine</span>
                </div>
              </div>
              <div className="qaVisitFilterBar">
                <label className="qaVisitField">
                  <span className="qaVisitFieldLabel">From</span>
                  <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
                </label>
                <label className="qaVisitField">
                  <span className="qaVisitFieldLabel">To</span>
                  <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
                </label>
                <MachineSearchSelect
                  className="qaVisitFilterBarMachine"
                  machines={machines}
                  label="Find machine"
                  placeholder="Type to search, then pick…"
                  disabled={machinesQ.isLoading}
                  onQueryChange={setMachineQ}
                  onSelect={(name) => selectMachine(name)}
                />
              </div>
            </div>

            <div className="opsTableLead">
              <span className="opsTableLeadTitle">Fleet</span>
              <span className="opsDashboardSectionBadge">
                {fleetFiltered.length} machine{fleetFiltered.length === 1 ? '' : 's'}
                {dateFrom && dateTo ? ` · ${dateFrom} → ${dateTo}` : ''}
              </span>
            </div>

            {machinesQ.isLoading || qaSummaryQ.isLoading ? <p className="qaVisitMuted">Loading fleet…</p> : null}
            {qaSummaryQ.isError && !fleetQ.data ? (
              <p className="qaVisitError">{(qaSummaryQ.error as Error).message}</p>
            ) : null}
            {fleetQ.isError ? (
              <p className="qaVisitMuted">Range filter loading slowly — showing summary snapshot.</p>
            ) : null}

            <TableScrollControls>
              <table className="stitchOpsTable opsFleetTable qaVisitFleetTable">
                <thead>
                  <tr>
                    <AlertTableHeader
                      className="qaVisitColMachine"
                      label={{ main: 'Machine' }}
                      title="Vendon machine name"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'name')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'name'))}
                    />
                    <AlertTableHeader
                      className="qaVisitColDate"
                      label={{ main: 'Latest', sub: 'in range' }}
                      title="Most recent SafetyCulture visit in the selected date range"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'visit')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'visit'))}
                    />
                    <AlertTableHeader
                      className="qaVisitColScore"
                      label={{ main: 'Score' }}
                      title="Latest inspection score %"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'score')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'score'))}
                    />
                    <AlertTableHeader
                      className="qaVisitColMtd"
                      label={{ main: 'Admin', sub: 'MTD' }}
                      title="Admin manual summaries this Kuwait month"
                      sortable
                      sortDir={sortDirForColumn(columnSort, 'mtd')}
                      onSortClick={() => setColumnSort((prev) => cycleColumnSort(prev, 'mtd'))}
                    />
                    <th className="qaVisitColAction"> </th>
                  </tr>
                </thead>
                <tbody>
                  {fleetFiltered.map(({ name, visit }) => {
                    const score = qaScoreDisplay(visit?.score);
                    const when = visit?.lastVisitAt
                      ? formatKuwaitCleaningWhen(visit.lastVisitAt)?.date
                      : visit?.lastVisitDate || '—';
                    return (
                      <tr key={name}>
                        <td className="qaVisitColMachine">
                          <div className="opsMachineName qaVisitFleetName">{name}</div>
                          {visit?.officerName ? (
                            <div className="opsCellSub">{visit.officerName}</div>
                          ) : null}
                        </td>
                        <td className="qaVisitColDate" data-mono="true">
                          {when}
                        </td>
                        <td className="qaVisitColScore">
                          <span className={`qaVisitScoreChip qaVisitScoreChip--${score.tone}`}>{score.text}</span>
                        </td>
                        <td className="qaVisitColMtd" data-mono="true">
                          {visit?.adminSummaryMtd ?? 0}
                        </td>
                        <td className="qaVisitColAction">
                          <button type="button" className="qaVisitTableAction" onClick={() => selectMachine(name)}>
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScrollControls>
          </div>
        </section>
      ) : (
        <QaVisitMachineWorkspace
          machineName={machineName}
          machines={machines}
          initialAuditId={auditFromUrl}
          initialDateFrom={dateFrom}
          initialDateTo={dateTo}
          onSelectMachine={(name) => selectMachine(name)}
          onDateRangeChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            patchSearchParams({ from, to });
          }}
        />
      )}
    </StitchOpsPanel>
  );
}

export function QaVisitFullTabLink({
  machineName,
  auditId,
  className = '',
}: {
  machineName: string;
  auditId?: string;
  className?: string;
}) {
  const params = new URLSearchParams({
    machine: machineName,
    from: qaDefaultFromDate(),
    to: qaTodayIso(),
  });
  if (auditId) params.set('auditId', auditId);
  return (
    <Link to={`/qa-visit?${params.toString()}`} className={`qaVisitFullTabLink ${className}`.trim()}>
      Open QA Visit tab →
    </Link>
  );
}
