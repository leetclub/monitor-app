import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { getMachineIdRaw } from '@/features/redflags/redFlagsModel';
import { V2EmptyState, V2Panel, V2SectionHead } from '@/features/v2/v2Ui';

type MachinesResponse = { machines?: Array<{ id?: string; name?: string }>; rows?: Array<{ id?: string; name?: string }> };
type Snapshot = { rows?: RedAlertRow[] };
type QaSummaryResponse = {
  byMachineName?: Record<
    string,
    { score?: number | null; latestAt?: string | null; findingsCount?: number | null }
  >;
};

export function V2QaVisitPage() {
  const [machineId, setMachineId] = useState('');

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 60_000,
  });
  const qaQ = useQuery({
    queryKey: ['alert-qa-summary'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
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
  const qa = selected ? qaQ.data?.byMachineName?.[selected.name] : undefined;

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Quality assurance"
        title="QA Visit"
        description="Select a machine, review its quality history, and open the full QA workspace when you need to record a visit."
        actions={<span className="v2ReadyPill">Workspace ready</span>}
      />

      {machines.length === 0 ? (
        <V2Panel title="Quality workspace" subtitle="Machine selection">
          <V2EmptyState
            title="No machines available"
            description="No machines are configured in this workspace yet. Create the first machine in Admin to begin QA monitoring."
            icon="qa_visit"
          />
        </V2Panel>
      ) : (
        <div className="v2Split50">
          <V2Panel title="Select machine" subtitle="Fleet quality scope">
            <label className="v2Field">
              <span>Machine</span>
              <select
                className="v2Select v2SelectWide"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              >
                <option value="">Choose a machine…</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="v2Hint">{machines.length} machines in scope</p>
            <Link className="v2LinkBtn" to="/qa-visit">
              Open classic QA Visit →
            </Link>
          </V2Panel>

          <V2Panel title="Assessment snapshot" subtitle={selected?.name || 'No machine selected'}>
            {!selected ? (
              <V2EmptyState
                title="Select a machine"
                description="Choose a unit to review the latest QA score and open the structured visit form in Classic."
                icon="qa_visit"
              />
            ) : (
              <div className="v2QaSnap">
                <div>
                  <p className="v2KpiLabel">Latest score</p>
                  <p className="v2KpiValue">{qa?.score != null ? Number(qa.score).toFixed(0) : '—'}</p>
                </div>
                <div>
                  <p className="v2KpiLabel">Findings</p>
                  <p className="v2KpiValue">{qa?.findingsCount ?? '—'}</p>
                </div>
                <div>
                  <p className="v2KpiLabel">Last visit</p>
                  <p className="v2KpiDetail">{qa?.latestAt || 'No visit on record'}</p>
                </div>
                <Link className="v2LinkBtn" to={`/qa-visit?machineId=${encodeURIComponent(selected.id)}`}>
                  Record / review visit →
                </Link>
              </div>
            )}
          </V2Panel>
        </div>
      )}
    </div>
  );
}
