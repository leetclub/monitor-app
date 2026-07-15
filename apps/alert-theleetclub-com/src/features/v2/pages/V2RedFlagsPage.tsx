import { useMemo, useState, type ReactNode } from 'react';
import { ComparePresetPicker } from '@/components/ComparePresetPicker';
import {
  useV2CompareSelection,
  useV2RedFlagsData,
  V2_RED_FLAGS_COLUMNS,
} from '@/features/v2/hooks/useV2RedFlagsData';
import { V2DataTable } from '@/features/v2/V2DataTable';
import { V2MetricStack } from '@/features/v2/V2MetricStack';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2ProgressBar,
  V2SectionHead,
} from '@/features/v2/v2Ui';
import type { RedFlagsColumnKey } from '@/features/redflags/redFlagsWorkbookColumns';

type SeverityFilter = 'all' | 'critical' | 'watch';

/** Pure Manus Red Flags — Classic data/sort + Manus metric boxes. */
export function V2RedFlagsPage() {
  const { compare, setCompare } = useV2CompareSelection();
  const data = useV2RedFlagsData(compare);
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.exceptions.filter((e) => {
      if (severity === 'critical' && e.severity !== 'Critical') return false;
      if (severity === 'watch' && e.severity !== 'Watch') return false;
      if (!needle) return true;
      return Object.values(e.fields).concat(e.reasons).join(' ').toLowerCase().includes(needle);
    });
  }, [data.exceptions, q, severity]);

  const rows = filtered.map((e) => {
    const cells: Record<string, ReactNode> = {};
    for (const col of V2_RED_FLAGS_COLUMNS) {
      const key = col.key as RedFlagsColumnKey;
      if (key === 'vendingMachine') {
        cells[key] = (
          <div className="v2CellMachine">
            <strong>{e.fields.vendingMachine}</strong>
            <span className="v2CellId">{e.id}</span>
            <div className="v2CellTags">
              <span className={e.severity === 'Critical' ? 'v2PillCrit' : 'v2PillWatch'}>{e.severity}</span>
              {e.isNew ? <em className="v2PillNew">New</em> : null}
            </div>
          </div>
        );
      } else if (e.stacks[key]?.length) {
        cells[key] = <V2MetricStack items={e.stacks[key]} />;
      } else if (key === 'alertType') {
        cells[key] = <span className="v2CellWrap">{e.fields.alertType}</span>;
      } else if (key === 'goCheck') {
        cells[key] = (
          <span className={e.fields.goCheck === 'Ready' ? 'v2PillOk' : 'v2MetricEmpty'}>{e.fields.goCheck}</span>
        );
      } else {
        cells[key] = e.fields[key] || '—';
      }
    }
    return {
      id: e.id,
      tone: e.severity === 'Critical' ? ('crit' as const) : ('' as const),
      cells,
    };
  });

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Exception management"
        title="Red Flags"
        description="Classic ranking (priority tier → frequency) with full enrichment — Manus metric boxes."
        actions={
          <V2GhostBtn onClick={data.refetch} disabled={data.fetching}>
            {data.fetching ? 'Refreshing…' : 'Refresh'}
          </V2GhostBtn>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard label="Total flags" value={data.open} detail="within your scope" tone="blue" icon="red_flags" />
        <V2KpiCard
          label="Open critical"
          value={data.critical}
          detail="tier 1 — not in cleaning window"
          tone="red"
          icon="red_flags"
        />
        <V2KpiCard label="Active cases" value={data.open} detail="open or investigating" tone="amber" icon="overall" />
        <V2KpiCard label="Resolved" value={data.clear} detail="machines clear in scope" tone="teal" icon="admin" />
      </div>

      <div className="v2StatusCard">
        <V2ProgressBar
          label={`Fleet-level status · ${data.clear} of ${data.machineScope} machines operational`}
          pct={data.clearPct}
          valueLabel={`${data.clearPct.toFixed(1)}%`}
        />
      </div>

      <V2Panel
        title="Exception workbook"
        subtitle={`${V2_RED_FLAGS_COLUMNS.length} Classic fields · Critical (tier 1) first`}
        meta={
          <span className="v2PanelMetaText">
            Showing {filtered.length} of {data.open} · Fleet-wide
          </span>
        }
      >
        <div className="v2FilterBar">
          <label className="v2Search">
            <span className="srOnly">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search machine, operator, alert, location…"
            />
          </label>
          <select
            className="v2Select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
            aria-label="Severity"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical (tier 1)</option>
            <option value="watch">Watch (cleaning window)</option>
          </select>
          <ComparePresetPicker value={compare} onChange={setCompare} />
        </div>

        {data.error ? (
          <V2EmptyState title="Could not load exceptions" description={data.error} icon="red_flags" />
        ) : data.loading ? (
          <V2EmptyState title="Loading exceptions…" description="Fetching full fleet workbook." />
        ) : (
          <V2DataTable
            columns={V2_RED_FLAGS_COLUMNS}
            rows={rows}
            empty={
              <V2EmptyState
                title="No matching exceptions"
                description="No red flags recorded for machines in your scope."
              />
            }
            footer="Same Classic sort as /red-flags · Use ← → or drag to browse every field"
          />
        )}
      </V2Panel>
    </div>
  );
}
