import * as XLSX from 'xlsx';
import { formatKwd } from '@/lib/salesDisplay';

export type WeeklyExportProduct = {
  name: string;
  revenueKwd: number;
  prevRevenueKwd?: number | null;
  yoyRevenueKwd?: number | null;
  cups?: number | null;
  prevCups?: number | null;
  yoyCups?: number | null;
  trendPct?: number | null;
};

export type WeeklyExportMachine = {
  machineName: string;
  periodKd?: number | null;
  prevKd?: number | null;
  locationTargetKd?: number | null;
  pctOfLocationTarget?: number | null;
  products?: WeeklyExportProduct[];
};

type Opts = {
  periodLabel: string;
  priorLabel: string;
  windowStart?: string;
  windowEnd?: string;
  preparedBy?: string;
  fleetProducts: WeeklyExportProduct[];
  machines: WeeklyExportMachine[];
  focusProduct?: string | null;
  compare: boolean;
  fleetPeriodKd?: number | null;
  fleetYoyKd?: number | null;
};

function pct(cur: number, prev: number | null | undefined): number | string {
  if (prev == null || !(prev > 0)) return '';
  return (cur - prev) / prev;
}

function num(v: number | null | undefined): number | string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return Math.round(Number(v) * 100) / 100;
}

/** Build a Weekly Report workbook shaped like the ops template and download it. */
export function downloadWeeklyProductReport(opts: Opts) {
  const {
    periodLabel,
    priorLabel,
    windowStart,
    windowEnd,
    preparedBy = '',
    fleetProducts,
    machines,
    focusProduct,
    compare,
    fleetPeriodKd,
    fleetYoyKd,
  } = opts;

  const mixRev = fleetProducts.reduce((s, p) => s + Number(p.revenueKwd || 0), 0);
  const mixYoy = fleetProducts.reduce((s, p) => s + Number(p.yoyRevenueKwd || 0), 0);
  const totalRev =
    fleetPeriodKd != null && Number.isFinite(Number(fleetPeriodKd)) ? Number(fleetPeriodKd) : mixRev;
  const totalPrev = fleetProducts.reduce((s, p) => s + Number(p.prevRevenueKwd || 0), 0);
  const totalYoy =
    fleetYoyKd != null && Number.isFinite(Number(fleetYoyKd)) && Number(fleetYoyKd) > 0
      ? Number(fleetYoyKd)
      : mixYoy;
  const totalCups = fleetProducts.reduce((s, p) => s + Number(p.cups || 0), 0);
  const totalPrevCups = fleetProducts.reduce((s, p) => s + Number(p.prevCups || 0), 0);
  const totalYoyCups = fleetProducts.reduce((s, p) => s + Number(p.yoyCups || 0), 0);

  const rising = [...fleetProducts]
    .filter((p) => compare && p.trendPct != null && Number(p.trendPct) > 0)
    .sort((a, b) => Number(b.trendPct) - Number(a.trendPct))
    .slice(0, 5);
  const falling = [...fleetProducts]
    .filter((p) => compare && p.trendPct != null && Number(p.trendPct) < 0)
    .sort((a, b) => Number(a.trendPct) - Number(b.trendPct))
    .slice(0, 5);

  const focus = (focusProduct || '').trim();
  const focusRows = focus
    ? machines
        .map((m) => {
          const hit = (m.products || []).find(
            (p) => p.name.toLowerCase() === focus.toLowerCase(),
          );
          return {
            location: m.machineName,
            rev: Number(hit?.revenueKwd || 0),
            prev: Number(hit?.prevRevenueKwd || 0),
            pct: hit?.trendPct ?? null,
          };
        })
        .filter((r) => r.rev > 0 || r.prev > 0)
        .sort((a, b) => b.rev - a.rev)
    : [];

  const lowMachines = [...machines]
    .filter((m) => m.locationTargetKd != null && Number(m.locationTargetKd) > 0)
    .sort(
      (a, b) =>
        (a.pctOfLocationTarget ?? 999) - (b.pctOfLocationTarget ?? 999) ||
        a.machineName.localeCompare(b.machineName),
    )
    .slice(0, 8);

  const aoa: (string | number | null)[][] = [];
  const push = (...cells: (string | number | null)[]) => aoa.push(cells);
  const blank = () => aoa.push([]);

  push('LEET Weekly Performance Report');
  push('Auto-filled from Alert → Performance → Products. Yellow-style narrative rows left blank for ops notes.');
  push(
    'Week Ending:',
    windowEnd || '',
    '',
    'Prepared By:',
    preparedBy || '',
    '',
    'Window:',
    `${periodLabel}${windowStart && windowEnd ? ` (${windowStart} → ${windowEnd})` : ''}`,
  );
  blank();

  push('1. Year-on-Year Comparison');
  push('Compares this period to the same dates last year.');
  push('Metric', periodLabel, 'Same period last year', '% Change');
  push('Total Revenue', num(totalRev), num(totalYoy), pct(totalRev, totalYoy));
  push('Total Units Sold', num(totalCups), num(totalYoyCups), pct(totalCups, totalYoyCups));
  blank();

  push('2. Top 5 Key Findings');
  push('Summarize takeaways after reviewing the tables below.');
  for (let i = 1; i <= 5; i++) push(`${i}.`, '');
  blank();

  push("3. What's Up / What's Down");
  if (rising[0] || falling[0]) {
    const bits: string[] = [];
    if (rising[0]) {
      const p = rising[0];
      bits.push(
        `Top riser: ${p.name} ${formatKwd(Number(p.prevRevenueKwd || 0))} → ${formatKwd(Number(p.revenueKwd || 0))} KD (${Math.round(Number(p.prevCups || 0))} → ${Math.round(Number(p.cups || 0))} cups)`,
      );
    }
    if (falling[0]) {
      const p = falling[0];
      bits.push(
        `Top faller: ${p.name} ${formatKwd(Number(p.prevRevenueKwd || 0))} → ${formatKwd(Number(p.revenueKwd || 0))} KD (${Math.round(Number(p.prevCups || 0))} → ${Math.round(Number(p.cups || 0))} cups)`,
      );
    }
    if (lowMachines[0]) {
      const m = lowMachines[0];
      bits.push(
        `Weak vs machine target: ${m.machineName} achieved ${formatKwd(Number(m.periodKd || 0))} of ${formatKwd(Number(m.locationTargetKd || 0))} (${m.pctOfLocationTarget ?? '—'}%)`,
      );
    }
    push(bits.join(' · '));
  } else {
    push(compare ? 'No rising/falling products in this window.' : 'Comparison off — single period only.');
  }
  blank();

  push('4. Machine Performance (targets)');
  push('Location', periodLabel + ' KD', priorLabel + ' KD', 'Target KD', '% of target');
  for (const m of [...machines]
    .sort((a, b) => Number(b.periodKd || 0) - Number(a.periodKd || 0))
    .slice(0, 40)) {
    push(
      m.machineName,
      num(m.periodKd),
      compare ? num(m.prevKd) : '',
      num(m.locationTargetKd),
      m.pctOfLocationTarget != null ? m.pctOfLocationTarget / 100 : '',
    );
  }
  blank();

  push('5. Product Performance');
  push('Comparison', 'Current Period', 'Prior Period', '% Change');
  push(
    'Period-on-Period (Total Revenue)',
    num(totalRev),
    compare ? num(totalPrev) : '',
    compare ? pct(totalRev, totalPrev) : '',
  );
  push(
    'Period-on-Period (Total Cups)',
    num(totalCups),
    compare ? num(totalPrevCups) : '',
    compare ? pct(totalCups, totalPrevCups) : '',
  );
  blank();

  push('Top 5 Products Increasing in Sales');
  push('Product', `${periodLabel} Revenue`, `${priorLabel} Revenue`, 'WoW %', `${periodLabel} Cups`, `${priorLabel} Cups`);
  for (const p of rising) {
    push(
      p.name,
      num(p.revenueKwd),
      num(p.prevRevenueKwd),
      pct(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)),
      num(p.cups),
      num(p.prevCups),
    );
  }
  if (!rising.length) push('(none)', '', '', '', '', '');
  blank();

  push('Top 5 Products Decreasing in Sales');
  push('Product', `${periodLabel} Revenue`, `${priorLabel} Revenue`, 'WoW %', `${periodLabel} Cups`, `${priorLabel} Cups`);
  for (const p of falling) {
    push(
      p.name,
      num(p.revenueKwd),
      num(p.prevRevenueKwd),
      pct(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)),
      num(p.cups),
      num(p.prevCups),
    );
  }
  if (!falling.length) push('(none)', '', '', '', '', '');
  blank();

  push('6. Lowest Performing Products');
  push('Product', `${periodLabel} Revenue`, `${priorLabel} Revenue`, '% Change', "Why It's Declining", 'Recommendation');
  for (const p of falling.slice(0, 5)) {
    push(p.name, num(p.revenueKwd), num(p.prevRevenueKwd), pct(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)), '', '');
  }
  blank();

  push('7. Focus Products');
  push('Focus Product:', focus || '(select a product in Alert)');
  push('Performance by Location');
  push('Location', `${periodLabel} Revenue`, `${priorLabel} Revenue`, 'WoW %', 'Notes');
  for (const r of focusRows.slice(0, 40)) {
    push(r.location, num(r.rev), num(r.prev), r.pct != null ? Number(r.pct) / 100 : pct(r.rev, r.prev), '');
  }
  if (!focusRows.length) push('(pick a product filter to fill this section)', '', '', '', '');
  blank();

  push('8. Opportunities');
  for (let i = 1; i <= 5; i++) push(`${i}.`, '');
  blank();

  push('9. Recommendations');
  for (let i = 1; i <= 5; i++) push(`${i}.`, '');
  blank();

  push('10. Summary Chart — Key Figures at a Glance');
  push('Metric', periodLabel, priorLabel, 'Same period last year');
  push('Total Revenue', num(totalRev), compare ? num(totalPrev) : '', num(totalYoy));
  push('Total Units Sold', num(totalCups), compare ? num(totalPrevCups) : '', num(totalYoyCups));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 36 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Report');
  const stamp = (windowEnd || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  XLSX.writeFile(wb, `LEET-Weekly-Performance-Report-${stamp}.xlsx`);
}
