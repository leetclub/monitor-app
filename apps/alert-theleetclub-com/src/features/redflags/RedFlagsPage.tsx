import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ComparePresetPicker, CompareSelection } from '@/components/ComparePresetPicker';
import { apiGet } from '@/lib/api';
import { safeText } from '@/lib/safeText';

type RedFlagRow = {
  machineId: string;
  machineName: string;
  machineLocation?: string | null;
  operator?: string | null;
  minutesSinceLastTransaction?: number | null;
  reasons?: string[];
  happensWeek?: number;
};

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  fromCache?: boolean;
  cacheStale?: boolean;
  rows: RedFlagRow[];
  error?: string;
};

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

export function RedFlagsPage() {
  const [compare, setCompare] = useState<CompareSelection>(defaultCompare());

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const raw = snapQ.data?.rows;
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => {
      const reasonsRaw = r?.reasons;
      const reasonsList = Array.isArray(reasonsRaw)
        ? reasonsRaw.map((x) => safeText(x))
        : reasonsRaw != null
          ? [safeText(reasonsRaw)]
          : [];
      const hw = r?.happensWeek;
      return {
        machineId: safeText(r?.machineId),
        machineName: safeText(r?.machineName),
        machineLocation: safeText(r?.machineLocation) || null,
        operator: safeText(r?.operator) || null,
        minutesSinceLastTransaction:
          typeof r?.minutesSinceLastTransaction === 'number'
            ? r.minutesSinceLastTransaction
            : null,
        happensWeek: typeof hw === 'number' ? hw : null,
        reasons: reasonsList,
      };
    });
  }, [snapQ.data]);

  const cacheHint = snapQ.data?.cacheGeneratedAt
    ? `Snapshot ${snapQ.data.cacheGeneratedAt}`
    : 'Snapshot pending';

  return (
    <div className="pageShell">
      <header className="pageHero">
        <div className="pageHeroMain">
          <h1 className="pageTitle">Red Flags</h1>
          <p className="pageSubtitle">Machines that currently fail checks. Clear list means nothing is open.</p>
        </div>
        <div className="pageHeroAside">
          <p className="pageMeta">
            Auto refresh ~1 min · {cacheHint}
          </p>
          <button type="button" className="btnSolid" onClick={() => snapQ.refetch()} disabled={snapQ.isFetching}>
            {snapQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="surfaceCard surfaceCardSpaced">
        <div className="surfaceSectionLabel">Comparison</div>
        <ComparePresetPicker value={compare} onChange={setCompare} />
        <p className="surfaceHint">
          Used when trend metrics are connected. Until then, focus on the machine list below.
        </p>
      </section>

      {snapQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            {(snapQ.error as Error).message}
          </p>
        </section>
      ) : null}

      <section className="surfaceCard">
        <div className="surfaceCardHead">
          <h2 className="surfaceCardTitle">Machines</h2>
          <span className="surfaceBadge">{rows.length} shown</span>
        </div>

        <div className="tableWrap tableWrapLoose">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Location</th>
                <th>Operator</th>
                <th>Minutes since last tx</th>
                <th>Frequency (WTD)</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.machineId}>
                  <td>
                    <span className="machineNameStrong">{r.machineName}</span>
                    <div className="muted">{r.machineId}</div>
                  </td>
                  <td>{r.machineLocation || '—'}</td>
                  <td>{r.operator || '—'}</td>
                  <td>{r.minutesSinceLastTransaction ?? '—'}</td>
                  <td>{r.happensWeek ?? '—'}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 560 }}>
                    {(r.reasons || []).map((x, idx) => (
                      <div key={idx}>{x}</div>
                    ))}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !snapQ.isLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No red flags right now.
                  </td>
                </tr>
              ) : null}
              {snapQ.isLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Loading…
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

