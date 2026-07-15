import { useMemo, useState, type ReactNode } from 'react';
import { useV2OverallData, V2_OVERALL_COLUMNS } from '@/features/v2/hooks/useV2OverallData';
import { V2DataTable } from '@/features/v2/V2DataTable';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2SectionHead,
} from '@/features/v2/v2Ui';
import type { OverallColumnKey } from '@/features/overall/overallWorkbookColumns';

/** Pure Manus Overall — full Classic workbook fields. */
export function V2OverallPage() {
  const data = useV2OverallData();
  const [q, setQ] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (onlyFlagged && !r.flagged) return false;
      if (!needle) return true;
      return Object.values(r.fields).join(' ').toLowerCase().includes(needle);
    });
  }, [data.rows, q, onlyFlagged]);

  const tableRows = filtered.map((r) => {
    const cells: Record<string, ReactNode> = {};
    for (const col of V2_OVERALL_COLUMNS) {
      const key = col.key as OverallColumnKey;
      if (key === 'vendingMachine') {
        cells[key] = (
          <div className="v2CellMachine">
            <strong>{r.fields.vendingMachine}</strong>
            <span>{r.id}</span>
            <span className={r.flagged ? 'v2PillCrit' : 'v2PillOk'}>
              {r.flagged ? 'Needs attention' : 'Operational'}
            </span>
          </div>
        );
      } else {
        cells[key] = r.fields[key] || '—';
      }
    }
    return { id: r.id, tone: r.flagged ? ('warn' as const) : ('' as const), cells };
  });

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Fleet command"
        title="Overall"
        description="Full fleet workbook — every Classic Overall field in Manus Fleet Intelligence."
        actions={
          <V2GhostBtn onClick={data.refetch} disabled={data.fetching}>
            {data.fetching ? 'Refreshing…' : 'Refresh'}
          </V2GhostBtn>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard label="Machines in scope" value={data.machineCount} detail="fleet-wide access" tone="blue" icon="overall" />
        <V2KpiCard
          label="Operational"
          value={data.operational}
          detail={`${data.flagged} need attention`}
          tone="teal"
          icon="admin"
        />
        <V2KpiCard
          label="Average uptime"
          value={`${data.uptime.toFixed(1)}%`}
          detail="clear vs flagged"
          tone="teal"
          icon="performance"
        />
        <V2KpiCard label="Workbook fields" value={V2_OVERALL_COLUMNS.length} detail="Classic columns" tone="amber" icon="qa_visit" />
      </div>

      <V2Panel
        title="Fleet workbook"
        subtitle={`${V2_OVERALL_COLUMNS.length} Classic fields · live APIs`}
        meta={
          <span className="v2PanelMetaText">
            Showing {filtered.length} of {data.machineCount}
          </span>
        }
      >
        <div className="v2FilterBar">
          <label className="v2Search">
            <span className="srOnly">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search machine, operator, issue…"
            />
          </label>
          <label className="v2Check">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
            Flagged only
          </label>
        </div>

        {data.error ? (
          <V2EmptyState title="Could not load fleet" description={data.error} icon="overall" />
        ) : data.loading ? (
          <V2EmptyState title="Loading fleet…" description="Fetching full Overall workbook." />
        ) : (
          <V2DataTable
            columns={V2_OVERALL_COLUMNS}
            rows={tableRows}
            empty={
              <V2EmptyState
                title="No machines in scope"
                description="Administrators can create machines from the Admin workspace."
                icon="overall"
              />
            }
            footer={`All ${V2_OVERALL_COLUMNS.length} Classic Overall fields · Manus display`}
          />
        )}
      </V2Panel>
    </div>
  );
}
