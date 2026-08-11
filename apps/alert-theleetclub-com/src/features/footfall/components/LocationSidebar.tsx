import type { ReactNode } from 'react';
import type { LocationReport } from '@/features/footfall/lib/types';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { footfallSidebarTag } from '@/features/footfall/lib/footfallLabel';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import { isProxySales, salesMetricColor } from '@/features/footfall/lib/salesDisplay';

type Props = {
  locations: LocationReport[];
  selectedId: string | null;
  onSelect: (machineId: string) => void;
  periodBadge?: string;
  showFleetPanel?: ReactNode;
};

export function LocationSidebar({
  locations,
  selectedId,
  onSelect,
  periodBadge,
  showFleetPanel,
}: Props) {
  return (
    <section className="sidebar">
      {periodBadge ? <p className="periodBadge">{periodBadge}</p> : null}
      <ul className="locList">
        {locations.map((l) => {
          const seg = inferOwnerSegment(l);
          const footTag = footfallSidebarTag(l);
          const ffDisplay = displayFootfallTotal(l);
          const convPct =
            ffDisplay > 0 ? Math.round((l.daily.totalCups / ffDisplay) * 10000) / 100 : null;
          return (
            <li key={l.machineId}>
              <button
                type="button"
                className={selectedId === l.machineId ? 'locBtn active' : 'locBtn'}
                onClick={() => onSelect(l.machineId)}
              >
                <span className="locName">
                  <span className={`locSegPill locSegPill-${seg}`}>{seg}</span>
                  {l.locationName}
                </span>
                <span className="locMeta">
                  {convPct != null ? `${convPct}%` : '—'} · {Math.round(ffDisplay).toLocaleString()}{' '}
                  {footTag}
                  {' · '}
                  <span
                    style={
                      isProxySales(l) ? { color: salesMetricColor(l), fontWeight: 600 } : undefined
                    }
                  >
                    {formatCups(l.daily.totalCups)} cups
                  </span>{' '}
                  · {l.daily.totalRevenueKd.toFixed(1)} KD
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {showFleetPanel}
    </section>
  );
}
