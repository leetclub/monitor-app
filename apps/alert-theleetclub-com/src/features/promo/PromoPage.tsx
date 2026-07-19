import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qaTodayIso } from '@/lib/qaVisitDateRange';
import {
  DEFAULT_PROMO_PRODUCT,
  fetchPromoPerformance,
  type PromoLocationPerformance,
} from '@/features/promo/promoApi';

function pctColor(pct: number | null): string {
  if (pct == null) return 'var(--muted, #94a3b8)';
  if (pct >= 100) return 'var(--ops-good, var(--accent, #34d399))';
  if (pct >= 70) return 'var(--warn, #fbbf24)';
  return 'var(--ops-bad, var(--danger, #f87171))';
}

function DayAchievementBar({
  target,
  achieved,
  date,
}: {
  target: number;
  achieved: number;
  date: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const color = pctColor(target > 0 ? pct : null);
  return (
    <div className="promoDayBar" title={`${date}: ${achieved}/${target} cups`}>
      <div className="promoDayBarTrack">
        <div className="promoDayBarFill" style={{ width: `${pct}%`, background: color }} />
        <div className="promoDayBarRemain" style={{ width: `${100 - pct}%` }} />
      </div>
      <span className="promoDayBarLabel">{date.slice(5)}</span>
      <span className="promoDayBarVal">{achieved}</span>
    </div>
  );
}

function PromoLocationCard({ row }: { row: PromoLocationPerformance }) {
  return (
    <article className="promoLocCard">
      <header className="promoLocHead">
        <h3>{row.machineName}</h3>
        <p className="promoLocProduct">{row.productName}</p>
        <p className="promoLocPct">
          Period: {row.totalAchievedCups} / {row.totalTargetCups} cups
          {row.periodPct != null ? ` (${row.periodPct}%)` : ''}
        </p>
      </header>
      <div className="promoDayGrid">
        {row.days.map((d) => (
          <DayAchievementBar
            key={d.date}
            date={d.date}
            target={d.targetCups}
            achieved={d.achievedCups}
          />
        ))}
      </div>
    </article>
  );
}

export function PromoPage({ variant = 'classic' }: { variant?: 'classic' | 'manus' } = {}) {
  const today = qaTodayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const manus = variant === 'manus';

  const perfQ = useQuery({
    queryKey: ['alert-promo-performance', startDate, endDate],
    queryFn: () => fetchPromoPerformance(startDate, endDate),
    staleTime: 60_000,
  });

  const locations = perfQ.data?.locations ?? [];

  return (
    <div className={`promoPage${manus ? ' promoPageManus' : ''}`}>
      <header className="promoPageHead">
        <p className="promoPageEyebrow">Campaign cups</p>
        <h1 className="promoPageTitle">Promo</h1>
        <p className="promoPageTagline">
          Daily achieved vs remaining cups by location. Default product:{' '}
          <strong>{DEFAULT_PROMO_PRODUCT}</strong>. Configure assignments and day targets in Admin → Promo.
        </p>
      </header>

      <section className="promoPerfSection">
        <div className="promoDateRow">
          <label>
            From
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>

        {perfQ.isLoading ? <p className="promoState">Loading promo performance…</p> : null}
        {perfQ.isError ? (
          <p className="promoState promoStateError">{(perfQ.error as Error).message}</p>
        ) : null}
        {!perfQ.isLoading && !locations.length ? (
          <p className="promoState">
            No promo day targets for this period. An admin can assign a product and set calendar day cups under Admin →
            Promo.
          </p>
        ) : null}

        <div className="promoLocGrid">
          {locations.map((row) => (
            <PromoLocationCard key={row.machineId} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}
