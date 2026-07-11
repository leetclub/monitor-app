import type { QaScoreTrend } from '@/lib/leetWorkflowApi';

function trendBadge(trend: string | undefined): { label: string; tone: string } {
  switch (trend) {
    case 'improving':
      return { label: 'Improving vs prior week', tone: 'good' };
    case 'declining':
      return { label: 'Declining vs prior week', tone: 'low' };
    case 'stable':
      return { label: 'Stable vs prior week', tone: 'mid' };
    case 'new':
      return { label: 'New scores this week', tone: 'mid' };
    default:
      return { label: 'Not enough scored visits', tone: 'muted' };
  }
}

function fmtAvg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

function fmtDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded} pts`;
}

/** Week-vs-week QA score sparkline. */
export function QaVisitTrendChart({
  trend,
  variant = 'compact',
}: {
  trend?: QaScoreTrend | null;
  variant?: 'compact' | 'page';
}) {
  const badge = trendBadge(trend?.trend);
  const points = trend?.points?.filter((p) => Number.isFinite(p.score)) ?? [];
  const scores = points.map((p) => p.score);
  const min = scores.length ? Math.min(...scores, 60) : 60;
  const max = scores.length ? Math.max(...scores, 100) : 100;
  const span = Math.max(1, max - min);
  const w = variant === 'page' ? 640 : 280;
  const h = variant === 'page' ? 72 : 56;
  const pad = 4;

  let poly = '';
  if (points.length === 1) {
    const y = h - pad - ((points[0]!.score - min) / span) * (h - pad * 2);
    poly = `M ${pad} ${y} L ${w - pad} ${y}`;
  } else if (points.length > 1) {
    poly = points
      .map((p, i) => {
        const x = pad + (i / (points.length - 1)) * (w - pad * 2);
        const y = h - pad - ((p.score - min) / span) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <div className={`qaVisitTrend${variant === 'page' ? ' qaVisitTrend--page' : ''}`} aria-label="QA score trend">
      <div className="qaVisitTrendHead">
        <span className="qaVisitMetaLabel">Score trend</span>
        <span className={`qaVisitTrendBadge qaVisitTrendBadge--${badge.tone}`}>{badge.label}</span>
      </div>
      {poly ? (
        <svg className="qaVisitTrendChart" viewBox={`0 0 ${w} ${h}`} role="img" aria-hidden>
          <path d={poly} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          {points.map((p, i) => {
            const x =
              points.length === 1
                ? w / 2
                : pad + (i / (points.length - 1)) * (w - pad * 2);
            const y = h - pad - ((p.score - min) / span) * (h - pad * 2);
            return <circle key={`${p.date}-${i}`} cx={x} cy={y} r="2.5" fill="currentColor" />;
          })}
        </svg>
      ) : (
        <p className="qaVisitTrendEmpty">Need scored SafetyCulture inspections in this date range.</p>
      )}
      <div className="qaVisitTrendStats">
        <span>This week {fmtAvg(trend?.currentWeekAvg)}</span>
        <span>Prior week {fmtAvg(trend?.priorWeekAvg)}</span>
        <span>Δ {fmtDelta(trend?.delta)}</span>
      </div>
    </div>
  );
}
