import { useState } from 'react';
import { SegmentTabs } from '@/features/footfall/components/SegmentTabs';
import { LocationSidebar } from '@/features/footfall/components/LocationSidebar';
import { TargetsHeatmap } from '@/features/footfall/components/targets/TargetsHeatmap';
import { TargetKpiSection } from '@/features/footfall/components/targets/TargetKpiSection';
import { TargetsGraphSection } from '@/features/footfall/components/targets/TargetsGraphSection';
import { TrajectorySection } from '@/features/footfall/components/targets/TrajectorySection';
import { DataQualityBanner } from '@/features/footfall/components/DataQualityBanner';
import { isTargetOnlySite } from '@/features/footfall/lib/appSite';
import { useTargetsData } from '@/features/footfall/lib/useTargetsData';
import {
  WINDOW_KU_JUL,
  WINDOW_MOH_O2_MAY,
  windowForLocation,
  type SegmentId,
} from '@/features/footfall/lib/segments';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';

export function TargetsPage() {
  const hideDateLabels = isTargetOnlySite();
  const [segmentId, setSegmentId] = useState<SegmentId>('ALL');
  const [kuWindowId] = useState(WINDOW_KU_JUL.id);

  const {
    loading,
    fetching,
    merged,
    filtered,
    selected,
    reportForDetail,
    counts,
    filter,
    setFilter,
    setSelectedId,
    business,
    todayByMachine,
    todaySalesLoading,
  } = useTargetsData(segmentId, kuWindowId);

  const todaySales = selected
    ? todayByMachine.get(selected.machineId) ?? {
        cups: 0,
        cupsCashless: 0,
        cupsWeb: 0,
        source: 'none' as const,
      }
    : null;

  const periodBadge = hideDateLabels
    ? undefined
    : merged?.primaryWindow.shortLabel +
      (segmentId === 'ALL' ? ` · MOH/O2 ${WINDOW_MOH_O2_MAY.shortLabel}` : '');

  return (
    <div className="targetsPage">
      {!hideDateLabels ? (
        <p className="targetsAccessDate" role="status">
          {business.banner}
          {!business.isLiveBusinessDay ? (
            <span className="targetsAccessDateNote"> · weekend — showing last business day sales</span>
          ) : (
            <span className="targetsAccessDateNote"> · live refresh ~90s</span>
          )}
          {fetching ? <span className="targetsLiveDot"> updating…</span> : null}
        </p>
      ) : fetching ? (
        <p className="targetsAccessDate targetsAccessDateCompact" role="status">
          <span className="targetsLiveDot">Updating…</span>
        </p>
      ) : null}

      <SegmentTabs value={segmentId} onChange={setSegmentId} counts={counts} />

      {merged ? (
        <div className="filterBar">
          <input
            type="search"
            className="searchInput searchInputBar"
            placeholder="Search location…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      ) : null}

      {loading && !merged ? (
        <div className="stateBox stateBoxLoading">
          <p>Loading targets…</p>
        </div>
      ) : null}

      {merged && reportForDetail ? (
        <div className="mainGrid targetsMainGrid">
          <LocationSidebar
            locations={filtered}
            selectedId={selected?.machineId ?? null}
            onSelect={setSelectedId}
            periodBadge={periodBadge}
          />

          <section className="detail targetsDetailColumn">
            <TargetsHeatmap locations={filtered} onSelect={setSelectedId} />

            {selected ? (
              <div className="targetsDetail">
                <h2 className="locTitle">
                  <span className={`locSegPill locSegPill-${inferOwnerSegment(selected)}`}>
                    {inferOwnerSegment(selected)}
                  </span>
                  {selected.locationName}
                </h2>
                <DataQualityBanner location={selected} hideDateLabels={hideDateLabels} />
                <TargetKpiSection
                  location={selected}
                  todaySales={
                    todaySales ?? {
                      cups: 0,
                      cupsCashless: 0,
                      cupsWeb: 0,
                      source: 'none',
                    }
                  }
                  todaySalesLoading={todaySalesLoading}
                  salesYmd={business.salesYmd}
                  periodTitle={windowForLocation(selected, kuWindowId).shortLabel}
                  hideDateLabels={hideDateLabels}
                />
                <TargetsGraphSection location={selected} />
                <TrajectorySection
                  location={selected}
                  defaultSalesYmd={business.salesYmd}
                  hideDateLabels={hideDateLabels}
                />
              </div>
            ) : (
              <div className="stateBox">Select a location from the list or heatmap.</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
