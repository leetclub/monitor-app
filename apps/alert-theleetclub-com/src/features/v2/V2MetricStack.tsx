export type V2MetricTone = 'up' | 'down' | 'flat' | 'teal' | 'amber' | 'violet' | 'muted' | 'crit';

export type V2MetricItem = {
  label: string;
  value: string;
  tone?: V2MetricTone;
};

/** Compact Manus metric stack (v1 sales/trend feel, v2 teal chrome). */
export function V2MetricStack({ items, empty = '—' }: { items?: V2MetricItem[] | null; empty?: string }) {
  if (!items?.length) {
    return <span className="v2MetricEmpty">{empty}</span>;
  }
  return (
    <div className="v2MetricStack">
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className={`v2MetricBox v2MetricTone-${it.tone || 'flat'}`}>
          <span className="v2MetricLabel">{it.label}</span>
          <strong className="v2MetricVal">{it.value}</strong>
        </div>
      ))}
    </div>
  );
}
