import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { fetchQaFleet } from '@/lib/leetWorkflowApi';
import {
  adminSummaryMtdForMachine,
  qaScoreDisplay,
  qaVisitForMachineName,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import { qaDefaultFromDate, qaTodayIso } from '@/lib/qaVisitDateRange';
import { getMachineIdRaw } from '@/features/redflags/redFlagsModel';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { formatKuwaitCleaningWhen } from '@/lib/formatKuwait';
import { V2DataTable } from '@/features/v2/V2DataTable';
import { V2EmptyState, V2GhostBtn, V2Panel, V2SectionHead } from '@/features/v2/v2Ui';

type MachinesResponse = {
  machines?: Array<{ id?: string; name?: string }>;
  rows?: Array<{ id?: string; name?: string }>;
};

const QA_COLS = [
  { key: 'machine', label: 'Machine', sticky: true },
  { key: 'location', label: 'SC location' },
  { key: 'officer', label: 'Officer' },
  { key: 'latest', label: 'Latest', sub: 'in range' },
  { key: 'score', label: 'Score' },
  { key: 'adminMtd', label: 'Admin', sub: 'MTD' },
  { key: 'findings', label: 'Findings' },
  { key: 'report', label: 'Report' },
];

/** Pure Manus QA — full Classic fleet field set. */
export function V2QaVisitPage() {
  const [from, setFrom] = useState(qaDefaultFromDate);
  const [to, setTo] = useState(qaTodayIso);
  const [q, setQ] = useState('');

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<{ rows?: RedAlertRow[] }>('/api/alert/red-flags/snapshot'),
    staleTime: 60_000,
  });
  const qaQ = useQuery({
    queryKey: ['alert-qa-summary', 'v2-qa-full'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 60_000,
  });
  const fleetQ = useQuery({
    queryKey: ['alert-qa-fleet', from, to, 'v2-full'],
    queryFn: () => fetchQaFleet({ from, to }),
    staleTime: 60_000,
  });

  const machines = useMemo(() => {
    const raw = machinesQ.data?.machines || machinesQ.data?.rows || [];
    if (raw.length) {
      return raw
        .map((m) => ({ id: String(m.id || ''), name: String(m.name || m.id || '') }))
        .filter((m) => m.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const r of snapQ.data?.rows || []) {
      const id = getMachineIdRaw(r);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(r.machineName || id) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [machinesQ.data, snapQ.data?.rows]);

  const rows = useMemo(() => {
    const by = fleetQ.data?.byMachine || {};
    const needle = q.trim().toLowerCase();
    return machines
      .map((m) => {
        const visit =
          by[m.name] ||
          qaVisitForMachineName(m.name, qaQ.data?.byLocationKey, undefined, qaQ.data?.latestByMachine);
        const score = qaScoreDisplay(visit?.score);
        const adminFromVisit =
          visit && 'adminSummaryMtd' in visit
            ? Number((visit as { adminSummaryMtd?: number | null }).adminSummaryMtd || 0)
            : 0;
        const adminMtd =
          adminSummaryMtdForMachine(m.name, qaQ.data?.adminSummaryMtdByMachine) || adminFromVisit || 0;
        const when = visit?.lastVisitAt
          ? formatKuwaitCleaningWhen(visit.lastVisitAt)?.date
          : visit?.lastVisitDate || '—';
        const findingsList =
          visit && 'keyFindings' in visit
            ? (visit as { keyFindings?: string[] | null }).keyFindings
            : null;
        const findings = Array.isArray(findingsList) ? findingsList.length : 0;
        return {
          id: m.id,
          name: m.name,
          hay: [m.name, m.id, visit?.location, visit?.officerName, score.text].join(' ').toLowerCase(),
          cells: {
            machine: (
              <div className="v2CellMachine">
                <strong>{m.name}</strong>
                <span>{m.id}</span>
              </div>
            ),
            location: visit?.location || '—',
            officer: visit?.officerName || '—',
            latest: when || '—',
            score: score.text,
            adminMtd: String(adminMtd),
            findings: findings ? String(findings) : '—',
            report: visit?.reportUrl ? 'Open' : '—',
          } as Record<string, ReactNode>,
          reportUrl: visit?.reportUrl || '',
        };
      })
      .filter((r) => !needle || r.hay.includes(needle));
  }, [machines, fleetQ.data, qaQ.data, q]);

  const tableRows = rows.map((r) => ({
    id: r.id,
    cells: {
      ...r.cells,
      report: r.reportUrl ? (
        <a className="v2LinkBtn" href={r.reportUrl} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : (
        '—'
      ),
    },
  }));

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Quality assurance"
        title="QA Visit"
        description="Full fleet quality workbook — machine, location, officer, score, Admin MTD, findings."
        actions={
          <V2GhostBtn
            onClick={() => {
              void fleetQ.refetch();
              void qaQ.refetch();
            }}
            disabled={fleetQ.isFetching}
          >
            {fleetQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </V2GhostBtn>
        }
      />

      <div className="v2FilterBar">
        <label className="v2Field">
          <span>From</span>
          <input className="v2Select v2SelectWide" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="v2Field">
          <span>To</span>
          <input className="v2Select v2SelectWide" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="v2Search">
          <span className="srOnly">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machine or officer…" />
        </label>
      </div>

      <V2Panel title="Fleet quality workbook" subtitle={`${from} → ${to} · ${rows.length} machines`}>
        {machines.length === 0 ? (
          <V2EmptyState
            title="No machines available"
            description="Create machines in Admin to begin QA monitoring."
            icon="qa_visit"
          />
        ) : (
          <V2DataTable
            columns={QA_COLS}
            rows={tableRows}
            empty={<V2EmptyState title="No matches" description="Try clearing search or widening dates." />}
            footer="Classic QA fleet fields · Manus display"
          />
        )}
      </V2Panel>
    </div>
  );
}
