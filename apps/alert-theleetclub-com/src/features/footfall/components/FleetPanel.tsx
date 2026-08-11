import { useMemo } from 'react';
import { buildFleetRankings } from '@/features/footfall/lib/fleetRankings';
import type { ReportPayload } from '@/features/footfall/lib/types';

type Props = {
  report: ReportPayload;
  onSelect: (machineId: string) => void;
  selectedId: string | null;
};

export function FleetPanel({ report, onSelect, selectedId }: Props) {
  const r = useMemo(
    () => buildFleetRankings(report.locations),
    [report.locations],
  );
  return (
    <aside className="fleetPanel">
      <h3>Fleet rankings</h3>
      <RankingBlock
        title="Unique footfall · 5 days"
        items={r.byFootfall}
        suffix=""
        onSelect={onSelect}
        selectedId={selectedId}
        formatValue={(v) => Math.round(v).toLocaleString()}
      />
      {r.byProjectedFootfall?.length ? (
        <RankingBlock
          title="Mirrored footfall · 5 days"
          items={r.byProjectedFootfall}
          suffix=""
          onSelect={onSelect}
          selectedId={selectedId}
          hint="mirrored from same-segment peer · scaled to local cups"
          formatValue={(v) => Math.round(v).toLocaleString()}
        />
      ) : null}
      <RankingBlock
        title="Revenue · 5 days"
        items={r.byRevenue}
        suffix=" KD"
        onSelect={onSelect}
        selectedId={selectedId}
      />
      <RankingBlock
        title="Conversion · 5 days"
        items={r.byConversion}
        suffix="%"
        onSelect={onSelect}
        selectedId={selectedId}
      />
      {r.byRevenuePerVisitor?.length ? (
        <RankingBlock
          title="Rev / visit"
          items={r.byRevenuePerVisitor}
          suffix=" KD"
          onSelect={onSelect}
          selectedId={selectedId}
          hint="per visit"
          formatValue={(v) => v.toFixed(4)}
        />
      ) : null}
      <RankingBlock
        title="Missed potential · 5 days"
        items={r.byMissedPotential}
        suffix=" KD"
        onSelect={onSelect}
        selectedId={selectedId}
      />
    </aside>
  );
}

function RankingBlock({
  title,
  items,
  suffix,
  onSelect,
  selectedId,
  formatValue,
  hint,
}: {
  title: string;
  items: { machineId: string; name: string; value: number }[];
  suffix: string;
  onSelect: (id: string) => void;
  selectedId: string | null;
  formatValue?: (v: number) => string;
  hint?: string;
}) {
  return (
    <div className="rankBlock">
      <h4>{title}</h4>
      {hint ? <p className="rankHint">{hint}</p> : null}
      <ol>
        {items.slice(0, 8).map((it, i) => (
          <li key={it.machineId}>
            <button
              type="button"
              className={selectedId === it.machineId ? 'active' : ''}
              onClick={() => onSelect(it.machineId)}
            >
              <span className="rankNum">{i + 1}</span>
              <span className="rankName">{it.name}</span>
              <span className="rankVal">
                {formatValue
                  ? formatValue(it.value)
                  : typeof it.value === 'number' && suffix === ' KD'
                    ? it.value.toFixed(1)
                    : it.value}
                {suffix}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
