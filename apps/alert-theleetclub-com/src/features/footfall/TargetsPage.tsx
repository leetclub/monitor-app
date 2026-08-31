import { useState } from 'react';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import { SegmentTabs } from '@/features/footfall/components/SegmentTabs';
import { LocationSidebar } from '@/features/footfall/components/LocationSidebar';
import { TargetsHeatmap } from '@/features/footfall/components/targets/TargetsHeatmap';
import { TargetKpiSection } from '@/features/footfall/components/targets/TargetKpiSection';
import { TargetsGraphSection } from '@/features/footfall/components/targets/TargetsGraphSection';
import { TrajectorySection } from '@/features/footfall/components/targets/TrajectorySection';
import { DataQualityBanner } from '@/features/footfall/components/DataQualityBanner';
import { PeriodComparisonSection } from '@/features/footfall/components/PeriodComparisonSection';
import { isTargetOnlySite } from '@/features/footfall/lib/appSite';
import { useTargetsData } from '@/features/footfall/lib/useTargetsData';
import type { SegmentId } from '@/features/footfall/lib/segments';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';

type Props = {
  compare: CompareSelection;
};

export function TargetsPage({ compare }: Props) {
  const hideDateLabels = isTargetOnlySite();
  const [segmentId, setSegmentId] = useState<SegmentId>('ALL');

  const {
    loading,
    fetching,
    loadStatus,
    loadError,
    retryLoad,
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
    liveSalesYmd,
    adminTargetsByMachine,
    periodLabel,
    periodALabel,
  } = useTargetsData(segmentId, compare);

  const todaySales = selected
    ? todayByMachine.get(selected.machineId) ?? {
        cups: 0,
        cupsCashless: 0,
        cupsWeb: 0,
        source: 'none' as const,
      }
    : null;

  const adminTarget = selected
    ? adminTargetsByMachine[selected.machineId] ?? null
    : null;

  return (
    <div className="targetsPage">
      {!hideDateLabels ? (
        <p className="targetsAccessDate" role="status">
          {!business.isLiveBusinessDay ? (
            <>
              Kuwait weekend (Fri–Sat) · live cups use last business day{' '}
              <strong>{business.banner}</strong>
              <span className="targetsAccessDateNote">
                {' '}
                · report period is the preset above (not this sales day)
              </span>
            </>
          ) : (
            <>
              Live sales day: <strong>{business.banner}</strong>
              <span className="targetsAccessDateNote"> · refresh ~90s</span>
            </>
          )}
          {fetching ? <span className="targetsLiveDot"> updating…</span> : null}
        </p>
      ) : fetching ? (
        <p className="targetsAccessDate targetsAccessDateCompact" role="status">
          <span className="targetsLiveDot">Updating…</span>
        </p>
      ) : null}

      <SegmentTabs value={segmentId} onChange={setSegmentId} counts={counts} />

      <div className="mainGrid targetsMainGrid">
        <LocationSidebar
          locations={filtered}
          selectedId={selected?.machineId ?? null}
          onSelect={setSelectedId}
          periodBadge={hideDateLabels ? undefined : periodLabel}
          search={filter}
          onSearchChange={setFilter}
          emptyHint={
            loadError
              ? 'Load failed — see Retry'
              : loading
                ? 'Loading locations…'
                : 'No locations for this period. Try Yesterday or WTD.'
          }
        />

        <section className="detail targetsDetailColumn">
          {loadError && !merged ? (
            <div className="stateBox">
              <p>Could not load footfall for this period.</p>
              <p className="hint">{loadError}</p>
              <p className="hint">
                Prefer <strong>WTD</strong> or <strong>Yesterday</strong>. Avoid switching presets
                quickly while a range is still building.
              </p>
              <button type="button" className="btnSecondary" onClick={retryLoad}>
                Retry
              </button>
            </div>
          ) : null}

          {loading && !merged && !loadError ? (
            <div className="stateBox stateBoxLoading">
              <p>Loading targets…</p>
              <p className="hint">
                {loadStatus ||
                  'First load for a new date range can take a few minutes on the server.'}
              </p>
            </div>
          ) : null}

          {!loading && !loadError && merged && merged.locations.length === 0 ? (
            <div className="stateBox">
              <p>No locations for this period.</p>
              <p className="hint">
                Try <strong>Yesterday</strong> or <strong>WTD</strong>. On Fri–Sat, campus sites are
                often closed.
              </p>
            </div>
          ) : null}

          {merged && reportForDetail && merged.locations.length > 0 ? (
            <>
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
                    salesYmd={liveSalesYmd}
                    periodTitle={periodALabel}
                    hideDateLabels={hideDateLabels}
                    adminTarget={adminTarget}
                  />
                  <PeriodComparisonSection
                    location={selected}
                    showPeriodCompare={Boolean(
                      selected.comparePeriodDates?.length ||
                        selected.compareDaily ||
                        (selected.compareHours?.length && selected.comparePeriodDates?.length),
                    )}
                  />
                  <TargetsGraphSection location={selected} />
                  <TrajectorySection
                    location={selected}
                    defaultSalesYmd={business.salesYmd}
                    hideDateLabels={hideDateLabels}
                    adminTarget={adminTarget}
                  />
                </div>
              ) : (
                <div className="stateBox">Select a location from the list or heatmap.</div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
