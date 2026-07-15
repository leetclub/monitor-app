import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { fetchQaFleet } from '@/lib/leetWorkflowApi';
import {
  qaScoreDisplay,
  qaVisitForMachineName,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import { qaDefaultFromDate, qaTodayIso } from '@/lib/qaVisitDateRange';
import { getMachineIdRaw } from '@/features/redflags/redFlagsModel';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { V2EmptyState, V2Panel, V2SectionHead } from '@/features/v2/v2Ui';

type MachinesResponse = {
  machines?: Array<{ id?: string; name?: string }>;
  rows?: Array<{ id?: string; name?: string }>;
};

/** Pure Manus QA Visit workspace. */
export function V2QaVisitPage() {
  const [machineId, setMachineId] = useState('');
  const [from, setFrom] = useState(qaDefaultFromDate);
  const [to, setTo] = useState(qaTodayIso);

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
    queryKey: ['alert-qa-summary', 'v2-qa'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 60_000,
  });
  const fleetQ = useQuery({
    queryKey: ['alert-qa-fleet', from, to, 'v2'],
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

  const selected = machines.find((m) => m.id === machineId);
  const qa = selected
    ? qaVisitForMachineName(
        selected.name,
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      )
    : null;
  const score = qaScoreDisplay(qa?.score);

  const fleetRows = useMemo(() => {
    const by = fleetQ.data?.byMachine || {};
    return machines
      .map((m) => {
        const visit = by[m.name] || qaVisitForMachineName(m.name, qaQ.data?.byLocationKey, undefined, qaQ.data?.latestByMachine);
        return { ...m, visit, score: qaScoreDisplay(visit?.score) };
      })
      .slice(0, 80);
  }, [machines, fleetQ.data, qaQ.data]);

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Quality assurance"
        title="QA Visit"
        description="Select a machine, review its quality history, and assess site readiness."
        actions={<span className="v2ReadyPill">Workspace ready</span>}
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
        <label className="v2Field" style={{ flex: 1 }}>
          <span>Machine</span>
          <select className="v2Select v2SelectWide" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">All machines (fleet list)</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <V2Panel title={selected.name} subtitle="Assessment snapshot">
          <div className="v2FieldGrid">
            <div>
              <span>Score</span>
              <strong>{score.text}</strong>
            </div>
            <div>
              <span>Admin MTD</span>
              <strong>{qa?.adminSummaryMtd ?? 0}</strong>
            </div>
            <div>
              <span>Last visit</span>
              <strong>{qa?.lastVisitDate || qa?.lastVisitAt || '—'}</strong>
            </div>
            <div>
              <span>Officer</span>
              <strong>{qa?.officerName || '—'}</strong>
            </div>
          </div>
        </V2Panel>
      ) : (
        <V2Panel title="Fleet quality" subtitle={`${from} → ${to}`}>
          {machines.length === 0 ? (
            <V2EmptyState
              title="No machines available"
              description="Create machines in Admin to begin QA monitoring."
              icon="qa_visit"
            />
          ) : (
            <div className="v2MachineGrid">
              {fleetRows.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="v2MachineCard v2MachineCardBtn"
                  onClick={() => setMachineId(m.id)}
                >
                  <header>
                    <strong>{m.name}</strong>
                    <span className="v2PillOk">{m.score.text}</span>
                  </header>
                  <p className="v2Hint">{m.visit?.lastVisitDate || m.visit?.lastVisitAt || 'No visit in range'}</p>
                </button>
              ))}
            </div>
          )}
        </V2Panel>
      )}
    </div>
  );
}
