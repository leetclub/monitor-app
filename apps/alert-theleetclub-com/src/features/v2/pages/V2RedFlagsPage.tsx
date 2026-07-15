import { useMemo, useState } from 'react';
import { useV2RedFlagsData } from '@/features/v2/hooks/useV2RedFlagsData';
import {
  V2EmptyState,
  V2GhostBtn,
  V2KpiCard,
  V2Panel,
  V2ProgressBar,
  V2SectionHead,
} from '@/features/v2/v2Ui';

type SeverityFilter = 'all' | 'critical' | 'watch';

/** Pure Manus Red Flags — no Classic / Stitch / ops-cell UI. */
export function V2RedFlagsPage() {
  const data = useV2RedFlagsData();
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.exceptions.filter((e) => {
      if (severity === 'critical' && e.severity !== 'Critical') return false;
      if (severity === 'watch' && e.severity !== 'Watch') return false;
      if (!needle) return true;
      return [e.machineName, e.id, e.location, e.operator, e.alertType, ...e.reasons]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [data.exceptions, q, severity]);

  return (
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Exception management"
        title="Red Flags"
        description="Prioritized fleet exceptions with clear ownership, severity, and resolution status."
        actions={
          <V2GhostBtn onClick={data.refetch} disabled={data.fetching}>
            {data.fetching ? 'Refreshing…' : 'Saved view'}
          </V2GhostBtn>
        }
      />

      <div className="v2KpiGrid">
        <V2KpiCard label="Total flags" value={data.open} detail="within your scope" tone="blue" icon="red_flags" />
        <V2KpiCard
          label="Open critical"
          value={data.critical}
          detail="requires immediate action"
          tone="red"
          icon="red_flags"
        />
        <V2KpiCard
          label="Active cases"
          value={data.open}
          detail="open or investigating"
          tone="amber"
          icon="overall"
        />
        <V2KpiCard
          label="Resolved"
          value={data.clear}
          detail="machines clear in scope"
          tone="teal"
          icon="admin"
        />
      </div>

      <div className="v2StatusCard">
        <V2ProgressBar
          label={`Fleet-level status · ${data.clear} of ${data.machineScope} machines operational`}
          pct={data.clearPct}
          valueLabel={`${data.clearPct.toFixed(1)}%`}
        />
      </div>

      <V2Panel
        title="Exceptions"
        subtitle="Live Alert snapshot — Manus board"
        meta={
          <span className="v2PanelMetaText">
            Showing {filtered.length} of {data.open} · Fleet-wide scope
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
        </div>

        {data.error ? (
          <V2EmptyState title="Could not load exceptions" description={data.error} icon="red_flags" />
        ) : data.loading ? (
          <V2EmptyState title="Loading exceptions…" description="Fetching live fleet snapshot." />
        ) : filtered.length === 0 ? (
          <V2EmptyState
            title="No matching exceptions"
            description="No red flags have been recorded for machines in your scope."
          />
        ) : (
          <ul className="v2ExceptionList">
            {filtered.map((e) => {
              const open = expanded === e.id;
              return (
                <li key={e.id} className={`v2ExceptionCard ${e.severity === 'Critical' ? 'isCrit' : ''}`}>
                  <button
                    type="button"
                    className="v2ExceptionMain"
                    onClick={() => setExpanded(open ? null : e.id)}
                    aria-expanded={open}
                  >
                    <div className="v2ExceptionTop">
                      <div>
                        <strong>{e.machineName}</strong>
                        <span className="v2ExceptionId">{e.id}</span>
                      </div>
                      <span className={e.severity === 'Critical' ? 'v2PillCrit' : 'v2PillWatch'}>
                        {e.severity}
                      </span>
                    </div>
                    <p className="v2ExceptionAlert">{e.alertType}</p>
                    <div className="v2ExceptionMeta">
                      <span>{e.operator}</span>
                      <span>{e.location}</span>
                      <span>Sales {e.dailySales}</span>
                      <span>Freq {e.frequency}</span>
                      {e.isNew ? <em className="v2PillNew">New</em> : null}
                    </div>
                  </button>
                  {open ? (
                    <div className="v2ExceptionDetail">
                      <div className="v2FieldGrid">
                        <div>
                          <span>Last transaction</span>
                          <strong>{e.lastTx}</strong>
                        </div>
                        <div>
                          <span>Daily sales</span>
                          <strong>{e.dailySales}</strong>
                        </div>
                        <div>
                          <span>MTD sales</span>
                          <strong>{e.mtdSales}</strong>
                        </div>
                        <div>
                          <span>Target</span>
                          <strong>{e.target}</strong>
                        </div>
                        <div>
                          <span>Frequency</span>
                          <strong>{e.frequency}</strong>
                        </div>
                        <div>
                          <span>Last cleaning</span>
                          <strong>{e.lastCleaning}</strong>
                        </div>
                        <div>
                          <span>QA score</span>
                          <strong>{e.qaScore}</strong>
                        </div>
                        <div>
                          <span>Operator</span>
                          <strong>{e.operator}</strong>
                        </div>
                      </div>
                      {e.reasons.length ? (
                        <ul className="v2ReasonList">
                          {e.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </V2Panel>
    </div>
  );
}
