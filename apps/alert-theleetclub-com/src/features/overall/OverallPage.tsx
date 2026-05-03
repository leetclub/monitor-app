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

type Machine = { id: string; name: string; vendon_location_owner?: string | null };
type MachinesResponse = { machines: Machine[] };

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  rows?: RedAlertRow[];
};

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
            All machines in scope (Vendon fleet). Red Flags shows only machines that currently violate conditions; this
            table lists everyone. Schedules and rules not on Vendon are maintained in Admin. Both tabs refresh ~1 min.
          </p>
        </div>
        <div className="pageHeroAside">
          <p className="pageMeta">Auto refresh ~1 min</p>
          <button type="button" className="btnSolid" onClick={() => void machinesQ.refetch()} disabled={machinesQ.isFetching}>
            {machinesQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="surfaceCard surfaceCardSpaced">
        <div className="surfaceSectionLabel">Timespan comparison</div>
        <ComparePresetPicker value={compare} onChange={setComparePersist} />
        <p className="surfaceHint">
          Selected: <strong>{presetLabels[compare.preset]}</strong>. Range A/B drive workbook KPI columns when those
          metrics are connected. Snapshot columns below show current Red Alert cache when the machine is flagged.
        </p>
      </section>

      {machinesQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            {(machinesQ.error as Error).message}
          </p>
        </section>
      ) : null}

      <section className="surfaceCard">
        <div className="surfaceCardHead">
          <h2 className="surfaceCardTitle">Fleet table</h2>
          <span className="surfaceBadge">{machines.length} machines</span>
        </div>

        <div className="tableWrap tableWrapLoose">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Machine ID</th>
                <th>Location / site tag</th>
                <th>On Red Flags now</th>
                <th>WTD hits (A+B+C)</th>
                <th>Min since last tx</th>
                <th>KPI (range A)</th>
                <th>KPI (range B)</th>
              </tr>
            </thead>
            <tbody>
              {machinesQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="muted">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {machines.map((m) => {
                const snap = snapshotByMachineId.get(m.id);
                const flagged = !!snap;
                const wtd =
                  snap?.happensWeek ??
                  snap?.frequency?.totalCriteriaHitsThisWeek ??
                  snap?.frequency?.totalCriteriaHits7d;
                const mins = snap?.minutesSinceLastTransaction ?? snap?.minutes_since_last_transaction;
                const minsOk = mins != null && typeof mins === 'number' && !Number.isNaN(mins);
                return (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="muted">{m.id}</td>
                    <td>{m.vendon_location_owner || '—'}</td>
                    <td>{flagged ? 'Yes' : 'No'}</td>
                    <td>{wtd != null && !Number.isNaN(Number(wtd)) ? String(wtd) : '—'}</td>
                    <td>{minsOk ? String(mins) : '—'}</td>
                    <td className="muted">—</td>
                    <td className="muted">—</td>
                  </tr>
                );
              })}
              {machines.length === 0 && !machinesQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No machines returned.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="surfaceHint" style={{ marginTop: 12, marginBottom: 0 }}>
          Detailed KPI columns from your workbook/XLS will populate against ranges A &amp; B after those metrics are
          wired. Attach the specification file in-repo (e.g. under <code className="adminInlineCode">docs/</code>) for
          column-for-column parity.
        </p>
      </section>
    </div>
  );
}
