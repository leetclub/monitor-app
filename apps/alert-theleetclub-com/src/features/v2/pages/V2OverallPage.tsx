import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { filterSnapshotRows, getMachineIdRaw } from '@/features/redflags/redFlagsModel';
import { formatKwd, type DailySalesElapsedResponse, salesElapsedForMachine } from '@/lib/salesDisplay';
import { qaVisitForMachineName, type QaSummaryResponse } from '@/lib/qaVisitDisplay';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2SectionHead,
} from '@/features/v2/v2Ui';

type MachinesResponse = {
  machines?: Array<{ id?: string; name?: string }>;
  rows?: Array<{ id?: string; name?: string }>;
};

/** Pure Manus Overall — fleet cards, no Classic workbook chrome. */
export function V2OverallPage() {
  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<{ rows?: RedAlertRow[] }>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
  });
  const salesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', 'v2-overall'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    staleTime: 30_000,
  });
  const qaQ = useQuery({
    queryKey: ['alert-qa-summary', 'v2-overall'],
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

  const flagged = useMemo(() => {
    const set = new Set<string>();
    for (const r of filterSnapshotRows(snapQ.data?.rows || [])) {
      if ((r.reasons || []).length) set.add(getMachineIdRaw(r));
    }
    return set;
  }, [snapQ.data?.rows]);

  const operational = Math.max(0, machines.length - flagged.size);
  const qaScores = Object.values(qaQ.data?.latestByMachine || {})
    .map((x) => Number(x.score))
    .filter((n) => Number.isFinite(n));
  const avgQuality = qaScores.length ? qaScores.reduce((a, b) => a + b, 0) / qaScores.length : 0;
  const uptime = machines.length ? (operational / machines.length) * 100 : 0;

  const refresh = () => {
    void machinesQ.refetch();
    void snapQ.refetch();
    void salesQ.refetch();
    void qaQ.refetch();
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
        <V2KpiCard label="Machines in scope" value={machines.length} detail="fleet-wide access" tone="blue" icon="overall" />
        <V2KpiCard
          label="Operational"
          value={operational}
          detail={`${flagged.size} need attention`}
          tone="teal"
          icon="admin"
        />
        <V2KpiCard
          label="Average uptime"
          value={`${uptime.toFixed(1)}%`}
          detail="clear vs flagged"
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
          <div className="v2MachineGrid">
            {machines.map((m) => {
              const bad = flagged.has(m.id);
              const sales = salesElapsedForMachine(salesQ.data, m.id, salesQ.isSuccess);
              const qa = qaVisitForMachineName(
                m.name,
                qaQ.data?.byLocationKey,
                qaQ.data?.adminSummaryMtdByMachine,
                qaQ.data?.latestByMachine,
              );
              return (
                <article key={m.id} className={`v2MachineCard ${bad ? 'isWarn' : ''}`}>
                  <header>
                    <strong>{m.name}</strong>
                    <span className={bad ? 'v2PillCrit' : 'v2PillOk'}>
                      {bad ? 'Needs attention' : 'Operational'}
                    </span>
                  </header>
                  <div className="v2FieldGrid v2FieldGridCompact">
                    <div>
                      <span>Today sales</span>
                      <strong>
                        {sales?.todayKwd != null && Number.isFinite(Number(sales.todayKwd))
                          ? formatKwd(Number(sales.todayKwd))
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>QA</span>
                      <strong>{qa?.score != null ? Number(qa.score).toFixed(0) : '—'}</strong>
                    </div>
                    <div>
                      <span>ID</span>
                      <strong className="v2Mono">{m.id}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </V2Panel>
    </div>
  );
}
