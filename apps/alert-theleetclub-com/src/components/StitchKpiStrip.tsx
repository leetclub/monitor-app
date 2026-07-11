export type StitchKpi = {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'good';
};

export function StitchKpiStrip({ items }: { items: StitchKpi[] }) {
  if (!items.length) return null;
  return (
    <div className="stitchKpiRow" role="group" aria-label="Key metrics">
      {items.map((k) => (
        <div key={k.label} className="stitchKpiCard">
          <span className="stitchKpiLabel">{k.label}</span>
          <span
            className={`stitchKpiVal${k.tone === 'warn' ? ' stitchKpiValWarn' : ''}${k.tone === 'good' ? ' stitchKpiValGood' : ''}`}
          >
            {k.value}
          </span>
          {k.sub ? <span className="stitchKpiSub">{k.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}
