import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  initialCompareSelection,
  persistCompareSelection,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import { safeText } from '@/lib/safeText';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { OVERALL_COLUMNS } from './overallWorkbookColumns';

type Machine = { id: string; name: string; vendon_location_owner?: string | null };
type MachinesResponse = { machines: Machine[] };

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  rows?: RedAlertRow[];
};

type AdminProfileRow = {
  machine_id: string;
  location_owner?: string | null;
  location_hours?: string | null;
  operator_name?: string | null;
  timezone?: string | null;
  updated_at?: string | null;
};

type AdminProfilesResponse = { rows: AdminProfileRow[] };

export function OverallPage() {
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const setComparePersist = useCallback((next: CompareSelection) => {
    setCompare(next);
    persistCompareSelection(next);
  }, []);

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    refetchInterval: 60_000,
  });

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    refetchInterval: 60_000,
  });

  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles'],
    queryFn: () => apiGet<AdminProfilesResponse>('/api/alert/overall/admin-profiles'),
    refetchInterval: 60_000,
  });

  const machines = useMemo(() => {
    const raw = machinesQ.data?.machines;
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => ({
      id: safeText(m?.id),
      name: safeText(m?.name) || safeText(m?.id),
      vendon_location_owner:
        m?.vendon_location_owner != null && String(m.vendon_location_owner).trim()
          ? safeText(m.vendon_location_owner)
          : null,
    }));
  }, [machinesQ.data]);

  /**
   * Overall historically listed **all** machines from Vendon (`/api/alert/machines`). That call can return []
   * when Vendon is misconfigured or errors — while Red Flags still has rows from the snapshot cache.
   * Fall back to machine ids/names from the snapshot so the tab is not empty when Red Flags works.
   */
  const fleetMachines = useMemo((): {
    id: string;
    name: string;
    vendon_location_owner: string | null;
  }[] => {
    if (machines.length > 0) return machines;
    const rows = snapQ.data?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const seen = new Set<string>();
    const out: { id: string; name: string; vendon_location_owner: string | null }[] = [];
    for (const r of rows) {
      const id = String(r.machineId ?? r.machine_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: safeText(r.machineName) || id,
        vendon_location_owner: null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [machines, snapQ.data?.rows]);

  const fleetFromSnapshotFallback = fleetMachines.length > 0 && machines.length === 0;

  const loadingFleetTable =
    fleetMachines.length === 0 && (machinesQ.isLoading || (machines.length === 0 && snapQ.isLoading));

  const profileByMachineId = useMemo(() => {
    const m = new Map<string, AdminProfileRow>();
    const rows = profilesQ.data?.rows;
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const id = String(r.machine_id ?? '').trim();
      if (id) m.set(id, r);
    }
    return m;
  }, [profilesQ.data]);

  const snapshotByMachineId = useMemo(() => {
    const m = new Map<string, RedAlertRow>();
    const rows = snapQ.data?.rows;
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const id = String(r.machineId ?? r.machine_id ?? '').trim();
      if (id) m.set(id, r);
    }
    return m;
  }, [snapQ.data]);

  const presetLabels = useMemo(
    () =>
      ({
        today_vs_yesterday: 'Today VS Yesterday (default view)',
        today_vs_same_day_last_week: 'Today VS Same Day Last Week',
        wtd_vs_last_week: 'WTD VS Last Week',
        mtd_vs_mtd: 'Month to date VS Month to date',
        custom_vs_custom: 'Custom period VS Custom period',
      }) as const,
    [],
  );

  return (
    <div className="pageShell">
      <header className="pageHero">
        <div className="pageHeroMain">
          <h1 className="pageTitle">Overall</h1>
          <p className="pageSubtitle">
            Fleet overview: operating context, machines, operators, and Red Alert snapshot fields where available. Empty cells
            (<span className="muted">—</span>) mean that metric is not connected yet.
          </p>
        </div>
        <div className="pageHeroAside">
          <p className="pageMeta">Auto refresh ~1 min</p>
          <button
            type="button"
            className="btnSolid"
            onClick={() => {
              void Promise.all([machinesQ.refetch(), snapQ.refetch(), profilesQ.refetch()]);
            }}
            disabled={machinesQ.isFetching || snapQ.isFetching || profilesQ.isFetching}
          >
            {machinesQ.isFetching || snapQ.isFetching || profilesQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="surfaceCard surfaceCardSpaced">
        <div className="surfaceSectionLabel">Timespan comparison</div>
        <ComparePresetPicker value={compare} onChange={setComparePersist} />
        <p className="surfaceHint">
          Selected: <strong>{presetLabels[compare.preset]}</strong>. Period A/B apply when comparison metrics are available.
        </p>
      </section>

      {machinesQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            {(machinesQ.error as Error).message}
            {fleetFromSnapshotFallback
              ? ' — Rows below use the Red Alert snapshot so you still see machines that appear on Red Flags.'
              : ''}
          </p>
        </section>
      ) : null}

      {fleetFromSnapshotFallback ? (
        <section className="surfaceCard surfaceCardSpaced">
          <p className="surfaceHint" style={{ margin: 0 }}>
            Fleet list is built from the <strong>Red Alert snapshot</strong> because the live Vendon machine list was empty
            or unavailable. Tags may be missing until{' '}
            <code style={{ fontSize: '0.88em' }}>GET /api/alert/machines</code> returns data.
          </p>
        </section>
      ) : null}

      {snapQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            Red Alert snapshot could not be loaded: {(snapQ.error as Error).message}. Last transaction / operator merge may
            be incomplete.
          </p>
        </section>
      ) : null}

      <section className="surfaceCard">
        <div className="surfaceCardHead">
          <h2 className="surfaceCardTitle">Fleet table</h2>
          <span className="surfaceBadge">{fleetMachines.length} machines</span>
        </div>

        <div className="tableWrap tableWrapLoose">
          <table>
            <thead>
              <tr>
                <th>{OVERALL_COLUMNS.operatingHours.title}</th>
                <th>{OVERALL_COLUMNS.vendingMachine.title}</th>
                <th>{OVERALL_COLUMNS.operator.title}</th>
                <th title={OVERALL_COLUMNS.attendance.note}>{OVERALL_COLUMNS.attendance.title}</th>
                <th title={OVERALL_COLUMNS.lastCleaned.note}>{OVERALL_COLUMNS.lastCleaned.title}</th>
                <th title={OVERALL_COLUMNS.lastVendFailed.note}>{OVERALL_COLUMNS.lastVendFailed.title}</th>
                <th>{OVERALL_COLUMNS.lastTransaction.title}</th>
                <th title={OVERALL_COLUMNS.salesTrend.note}>{OVERALL_COLUMNS.salesTrend.title}</th>
                <th title={OVERALL_COLUMNS.targetAchieved.note}>{OVERALL_COLUMNS.targetAchieved.title}</th>
                <th title={OVERALL_COLUMNS.peakHours.note}>{OVERALL_COLUMNS.peakHours.title}</th>
                <th title={OVERALL_COLUMNS.promotion.note}>{OVERALL_COLUMNS.promotion.title}</th>
                <th title={OVERALL_COLUMNS.highestProduct.note}>{OVERALL_COLUMNS.highestProduct.title}</th>
                <th title={OVERALL_COLUMNS.lowestProduct.note}>{OVERALL_COLUMNS.lowestProduct.title}</th>
                <th title={OVERALL_COLUMNS.peopleCount.note}>{OVERALL_COLUMNS.peopleCount.title}</th>
                <th title={OVERALL_COLUMNS.customerCalls.note}>{OVERALL_COLUMNS.customerCalls.title}</th>
                <th title={OVERALL_COLUMNS.mostIssue.note}>{OVERALL_COLUMNS.mostIssue.title}</th>
                <th title={OVERALL_COLUMNS.lastQaCheck.note}>{OVERALL_COLUMNS.lastQaCheck.title}</th>
                <th title={OVERALL_COLUMNS.lastTechCheck.note}>{OVERALL_COLUMNS.lastTechCheck.title}</th>
                <th title={OVERALL_COLUMNS.wastagePct.note}>{OVERALL_COLUMNS.wastagePct.title}</th>
                <th title={OVERALL_COLUMNS.promotionRuns.note}>{OVERALL_COLUMNS.promotionRuns.title}</th>
              </tr>
            </thead>
            <tbody>
              {loadingFleetTable ? (
                <tr>
                  <td colSpan={20} className="muted">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {fleetMachines.map((m) => {
                const snap = snapshotByMachineId.get(m.id);
                const mins = snap?.minutesSinceLastTransaction ?? snap?.minutes_since_last_transaction;
                const minsOk = mins != null && typeof mins === 'number' && !Number.isNaN(mins);
                const prof = profileByMachineId.get(m.id);
                const locHours = String(prof?.location_hours ?? '').trim();
                const operating = locHours ? `${locHours} hrs` : '—';
                const machTag = String(m.vendon_location_owner ?? prof?.location_owner ?? '').trim();
                const operator =
                  String(prof?.operator_name ?? '').trim() ||
                  String(snap?.operator ?? snap?.operatorName ?? snap?.redAlertOperator ?? '').trim() ||
                  '—';
                const tx = snap?.lastTransactionAtUtc ?? snap?.last_transaction_at_utc ?? null;
                return (
                  <tr key={m.id}>
                    <td>{operating}</td>
                    <td>
                      {m.name}
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        #{m.id}
                      </div>
                      {machTag ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          Tag: {machTag}
                        </div>
                      ) : null}
                    </td>
                    <td>{operator}</td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.attendance.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastCleaned.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastVendFailed.note}>
                        ?
                      </span>
                    </td>
                    <td>{tx ? String(tx) : minsOk ? `${String(mins)} min` : '—'}</td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.salesTrend.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.targetAchieved.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.peakHours.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.promotion.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.highestProduct.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lowestProduct.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.peopleCount.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.customerCalls.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.mostIssue.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastQaCheck.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastTechCheck.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.wastagePct.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.promotionRuns.note}>
                        ?
                      </span>
                    </td>
                  </tr>
                );
              })}
              {fleetMachines.length === 0 && !loadingFleetTable ? (
                <tr>
                  <td colSpan={20} className="muted">
                    No machines returned. If Red Flags shows machines, check server{' '}
                    <strong>VENDON_API_BASE</strong> / <strong>VENDON_API_KEY</strong> for{' '}
                    <code style={{ fontSize: '0.88em' }}>/api/alert/machines</code> — the Overall tab needs either Vendon
                    or a Red Alert snapshot.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="surfaceHint" style={{ marginTop: 12, marginBottom: 0 }}>
          Operating hours come from Admin. Fleet tags come from the live device feed when available.{' '}
          <strong>?</strong> means that metric is not connected yet — hover for detail.
        </p>
      </section>
    </div>
  );
}
