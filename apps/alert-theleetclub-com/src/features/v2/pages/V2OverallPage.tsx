import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { filterSnapshotRows, getMachineIdRaw } from '@/features/redflags/redFlagsModel';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2SectionHead,
} from '@/features/v2/v2Ui';

type MachinesResponse = { machines?: Array<{ id?: string; name?: string }>; rows?: Array<{ id?: string; name?: string }> };
type Snapshot = { rows?: RedAlertRow[] };
type QaSummaryResponse = {
  byMachineName?: Record<string, { score?: number | null; latestAt?: string | null; operator?: string | null }>;
};
type OperatorActivityResponse = {
  rows?: Array<{ machineName?: string; operator?: string; at?: string; summary?: string }>;
  items?: Array<{ machineName?: string; operator?: string; at?: string; summary?: string }>;
};

export function V2OverallPage() {
  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
  });
  const qaQ = useQuery({
    queryKey: ['alert-qa-summary'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 60_000,
  });
  const activityQ = useQuery({
    queryKey: ['alert-operator-activity-v2'],
    queryFn: () => apiGet<OperatorActivityResponse>('/api/alert/operator-activity'),
    staleTime: 60_000,
  });

  const machines = useMemo(() => {
    const raw = machinesQ.data?.machines || machinesQ.data?.rows || [];
    if (raw.length) {
      return raw
        .map((m) => ({ id: String(m.id || ''), name: String(m.name || m.id || '') }))
        .filter((m) => m.id);
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

  const flagged = useMemo(() => {
    const set = new Set<string>();
    for (const r of filterSnapshotRows(snapQ.data?.rows || [])) {
      if ((r.reasons || []).length) set.add(getMachineIdRaw(r));
    }
    return set;
  }, [snapQ.data?.rows]);

  const operational = Math.max(0, machines.length - flagged.size);
  const needAttention = flagged.size;

  const qaScores = Object.values(qaQ.data?.byMachineName || {})
    .map((x) => Number(x.score))
    .filter((n) => Number.isFinite(n));
  const avgQuality = qaScores.length
    ? qaScores.reduce((a, b) => a + b, 0) / qaScores.length
    : 0;
  const uptimeProxy = machines.length ? (operational / machines.length) * 100 : 0;

  const activity = activityQ.data?.rows || activityQ.data?.items || [];

  const refresh = () => {
    void machinesQ.refetch();
    void snapQ.refetch();
    void qaQ.refetch();
    void activityQ.refetch();
  };

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Fleet command"
        title="Overall"
        description="A consolidated operating picture of machine health, quality, uptime, and recent activity."
        actions={
          <V2GhostBtn onClick={refresh} disabled={snapQ.isFetching || machinesQ.isFetching}>
            Refresh
          </V2GhostBtn>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard
          label="Machines in scope"
          value={machines.length}
          detail="fleet-wide access"
          tone="blue"
          icon="overall"
        />
        <V2KpiCard
          label="Operational"
          value={operational}
          detail={`${needAttention} need attention`}
          tone="teal"
          icon="admin"
        />
        <V2KpiCard
          label="Average uptime"
          value={`${uptimeProxy.toFixed(1)}%`}
          detail="clear vs flagged (proxy)"
          tone="teal"
          icon="performance"
        />
        <V2KpiCard
          label="Average quality"
          value={avgQuality.toFixed(1)}
          detail="out of 100"
          tone="amber"
          icon="qa_visit"
        />
      </div>

      <div className="v2Split70">
        <V2Panel
          title="Fleet summary"
          subtitle="Latest status by machine"
          meta={<span className="v2PanelMetaText v2TealCaps">{machines.length} units</span>}
        >
          {machines.length === 0 ? (
            <V2EmptyState
              title="No machines in scope"
              description="Administrators can create machines and assign operators from the Admin workspace."
              icon="overall"
            />
          ) : (
            <div className="v2TableWrap">
              <table className="v2Table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Status</th>
                    <th>QA</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.slice(0, 60).map((m) => {
                    const qa = qaQ.data?.byMachineName?.[m.name];
                    const bad = flagged.has(m.id);
                    return (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.name}</strong>
                        </td>
                        <td>
                          <span className={bad ? 'v2PillCrit' : 'v2PillOk'}>
                            {bad ? 'Needs attention' : 'Operational'}
                          </span>
                        </td>
                        <td>{qa?.score != null ? Number(qa.score).toFixed(0) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </V2Panel>

        <V2Panel title="Operator activity" subtitle="Latest QA / ops signals">
          {activity.length === 0 ? (
            <V2EmptyState
              title="No recent QA activity"
              description="Completed QA visits will appear here in chronological order."
              icon="qa_visit"
            />
          ) : (
            <ul className="v2ActivityList">
              {activity.slice(0, 12).map((a, i) => (
                <li key={`${a.machineName}-${a.at}-${i}`}>
                  <strong>{a.machineName || 'Machine'}</strong>
                  <span>{a.operator || 'Operator'}</span>
                  <span className="muted">{a.summary || a.at || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </V2Panel>
      </div>
    </div>
  );
}
