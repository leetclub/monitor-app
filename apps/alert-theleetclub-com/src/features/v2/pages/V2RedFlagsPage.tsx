import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { filterSnapshotRows, getMachineIdRaw, rankRows } from '@/features/redflags/redFlagsModel';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2ProgressBar,
  V2SectionHead,
} from '@/features/v2/v2Ui';

type Snapshot = {
  rows?: RedAlertRow[];
  error?: string;
  generatedAt?: string;
  fromCache?: boolean;
};

type SeverityFilter = 'all' | 'critical' | 'watch';
type StatusFilter = 'all' | 'open' | 'new';

function isCritical(row: RedAlertRow): boolean {
  const tier = Number(row.alertPriorityTier);
  if (Number.isFinite(tier) && tier <= 0) return true;
  const blob = (row.reasons || []).join(' ').toLowerCase();
  return /offline|power.?off|\boff\b|dispense|critical|stale.?sale|no.?sale/i.test(blob);
}

function severityLabel(row: RedAlertRow): 'Critical' | 'Watch' {
  return isCritical(row) ? 'Critical' : 'Watch';
}

export function V2RedFlagsPage() {
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
    refetchInterval: 90_000,
  });

  const ranked = useMemo(() => {
    const rows = filterSnapshotRows(snapQ.data?.rows || []);
    return rankRows(rows, {}, 'week');
  }, [snapQ.data?.rows]);

  const openRows = useMemo(
    () => ranked.filter((r) => (r.row.reasons || []).length > 0),
    [ranked],
  );

  const critical = openRows.filter((r) => isCritical(r.row)).length;
  const active = openRows.length;
  const resolvedProxy = Math.max(0, ranked.length - openRows.length);
  const totalFlags = openRows.length;
  const clearPct = ranked.length ? (resolvedProxy / ranked.length) * 100 : 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return openRows.filter(({ row, isNew }) => {
      if (severity === 'critical' && !isCritical(row)) return false;
      if (severity === 'watch' && isCritical(row)) return false;
      if (status === 'new' && !isNew) return false;
      if (!needle) return true;
      const hay = [
        row.machineName,
        getMachineIdRaw(row),
        row.machineLocation,
        row.operator,
        row.operatorName,
        ...(row.reasons || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [openRows, q, severity, status]);

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Priority queue"
        title="Red Flags"
        description="Prioritized fleet exceptions that need operator attention — live from Alert APIs."
        actions={
          <V2GhostBtn onClick={() => void snapQ.refetch()} disabled={snapQ.isFetching}>
            {snapQ.isFetching ? 'Refreshing…' : 'Saved view'}
          </V2GhostBtn>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard
          label="Total flags"
          value={totalFlags}
          detail={snapQ.isLoading ? 'Loading snapshot…' : 'open exceptions'}
          tone="teal"
          icon="red_flags"
        />
        <V2KpiCard
          label="Open critical"
          value={critical}
          detail="priority tier / offline signals"
          tone="red"
          icon="red_flags"
        />
        <V2KpiCard
          label="Active cases"
          value={active}
          detail="machines with reasons"
          tone="amber"
          icon="overall"
        />
        <V2KpiCard
          label="Clear scope"
          value={resolvedProxy}
          detail="machines without open flags"
          tone="teal"
          icon="admin"
        />
      </div>

      <div className="v2StatusCard">
        <V2ProgressBar
          label="Fleet-level status"
          pct={clearPct}
          valueLabel={`${clearPct.toFixed(1)}% clear`}
        />
      </div>

      <V2Panel
        title="Exception board"
        subtitle="Search and filter live red-flag rows"
        meta={
          <span className="v2PanelMetaText">
            Showing {filtered.length} of {openRows.length} exceptions · Fleet-wide scope
          </span>
        }
      >
        <div className="v2FilterBar">
          <label className="v2Search">
            <span className="srOnly">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search machine, category, or location"
            />
          </label>
          <select
            className="v2Select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
            aria-label="Severity"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="watch">Watch</option>
          </select>
          <select
            className="v2Select"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Status"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="new">New in session</option>
          </select>
        </div>

        {snapQ.isError ? (
          <V2EmptyState
            title="Could not load exceptions"
            description={(snapQ.error as Error)?.message || 'Red Flags snapshot failed.'}
            icon="red_flags"
          />
        ) : snapQ.isLoading ? (
          <V2EmptyState title="Loading exceptions…" description="Fetching live red-flag snapshot." />
        ) : filtered.length === 0 ? (
          <V2EmptyState
            title="No matching exceptions"
            description="Try clearing filters, or open Classic if you need the full workbook table."
          />
        ) : (
          <div className="v2TableWrap">
            <table className="v2Table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Severity</th>
                  <th>Reasons</th>
                  <th>Operator</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 80).map(({ row, isNew }) => {
                  const id = getMachineIdRaw(row);
                  const sev = severityLabel(row);
                  return (
                    <tr key={id || row.machineName || Math.random()}>
                      <td>
                        <div className="v2MachineCell">
                          <strong>{row.machineName || id || '—'}</strong>
                          <span>{id}</span>
                          {isNew ? <em className="v2PillNew">New</em> : null}
                        </div>
                      </td>
                      <td>
                        <span className={sev === 'Critical' ? 'v2PillCrit' : 'v2PillWatch'}>{sev}</span>
                      </td>
                      <td className="v2Reasons">
                        {(row.reasons || []).slice(0, 3).join(' · ') || '—'}
                      </td>
                      <td>{row.operatorName || row.operator || row.redAlertOperator || '—'}</td>
                      <td>{row.machineLocation || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </V2Panel>
    </div>
  );
}
