import type { DayBreakdownRow, DaysBreakdown } from './types';

export function normalizeDaysBreakdown(raw: DaysBreakdown | DayBreakdownRow[] | undefined): DaysBreakdown {
  if (!raw) return { mode: 'aligned', rows: [] };
  if (Array.isArray(raw)) return { mode: 'aligned', rows: raw };
  return raw;
}

/** Merge split sales + footfall rows by business-day index when API omitted `rows`. */
export function mergeSplitDayRows(bd: DaysBreakdown): DayBreakdownRow[] {
  if (bd.mode !== 'split') return [];
  if (bd.rows?.length) return bd.rows;
  const sales = bd.salesRows ?? [];
  const foot = bd.footfallRows ?? [];
  const n = Math.max(sales.length, foot.length);
  const out: DayBreakdownRow[] = [];
  for (let i = 0; i < n; i++) {
    const s = sales[i];
    const f = foot[i];
    const date = s?.date ?? f?.date ?? '';
    if (!date) continue;
    const tf = f?.footfall ?? 0;
    const tc = s?.cups ?? 0;
    const tr = s?.revenueKd ?? 0;
    out.push({
      date,
      footfall: tf,
      cups: tc,
      conversionRatio:
        tf > 0 ? `${Math.round(tf)}:${Math.round(tc)}` : s?.conversionRatio ?? '0:0',
      conversionPct: tf > 0 ? Math.round((tc / tf) * 10000) / 100 : s?.conversionPct ?? 0,
      revenueKd: tr,
      revenuePerVisitorKd: tf > 0 ? tr / tf : s?.revenuePerVisitorKd ?? 0,
    });
  }
  return out;
}

/** Rows for charts/tables — aligned `rows` or merged split weeks. */
export function alignedDayRows(raw: DaysBreakdown | DayBreakdownRow[] | undefined): DayBreakdownRow[] {
  const bd = normalizeDaysBreakdown(raw);
  if (bd.mode === 'aligned') return bd.rows ?? [];
  return mergeSplitDayRows(bd);
}
