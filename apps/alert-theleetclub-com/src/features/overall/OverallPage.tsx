import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ComparePresetPicker, CompareSelection } from '@/components/ComparePresetPicker';
import { apiGet } from '@/lib/api';
import { safeText } from '@/lib/safeText';

type Machine = { id: string; name: string; vendon_location_owner?: string | null };
type MachinesResponse = { machines: Machine[] };

function defaultCompare(): CompareSelection {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const y0 = new Date(y.getFullYear(), y.getMonth(), y.getDate());
  const y1 = new Date(y.getFullYear(), y.getMonth(), y.getDate() + 1);
  return { preset: 'today_vs_yesterday', a: { start: fmt(t0), end: fmt(t1) }, b: { start: fmt(y0), end: fmt(y1) } };
}

export function OverallPage() {
  const [compare, setCompare] = useState<CompareSelection>(defaultCompare());

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
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

  return (
    <div className="pageShell">
      <header className="pageHero">
        <div className="pageHeroMain">
          <h1 className="pageTitle">Overall</h1>
          <p className="pageSubtitle">
            Full fleet from Vendon (same machine list as Admin). Test / IMEI-excluded machines are omitted server-side.
            Row-level Red Alert criteria (stale tx, OFF, vend fails) apply on the Red Flags tab only.
          </p>
        </div>
        <div className="pageHeroAside">
          <p className="pageMeta">Auto refresh ~1 min</p>
          <button type="button" className="btnSolid" onClick={() => machinesQ.refetch()} disabled={machinesQ.isFetching}>
            {machinesQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="surfaceCard surfaceCardSpaced">
        <div className="surfaceSectionLabel">Comparison</div>
        <ComparePresetPicker value={compare} onChange={setCompare} />
        <p className="surfaceHint">
          Presets mirror workbook-style ranges for when KPI columns are wired from analytics. The fleet table is live
          Vendon metadata.
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
          <h2 className="surfaceCardTitle">Machines</h2>
          <span className="surfaceBadge">{machines.length} in fleet</span>
        </div>

        <div className="tableWrap tableWrapLoose">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Machine ID</th>
                <th>Location / site tag</th>
              </tr>
            </thead>
            <tbody>
              {machinesQ.isLoading ? (
                <tr>
                  <td colSpan={3} className="muted">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {machines.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="muted">{m.id}</td>
                  <td>{m.vendon_location_owner || '—'}</td>
                </tr>
              ))}
              {machines.length === 0 && !machinesQ.isLoading ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No machines returned.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
