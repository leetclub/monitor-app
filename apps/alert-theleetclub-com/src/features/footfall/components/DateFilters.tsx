import type { ReportQuery } from '@/features/footfall/lib/types';
import {
  buildWeekCatalog,
  businessWeekForDate,
  compareWeekBefore,
  formatWeekRange,
  queriesEqual,
  shiftWeek,
  toReportQuery,
  type BusinessWeek,
} from '@/features/footfall/lib/businessWeeks';

type Props = {
  query: ReportQuery;
  appliedQuery: ReportQuery;
  onChange: (q: ReportQuery) => void;
  onApply: (q?: ReportQuery) => void;
  loading?: boolean;
  loadStatus?: string;
};

export function DateFilters({
  query,
  appliedQuery,
  onChange,
  onApply,
  loading,
  loadStatus,
}: Props) {
  const dirty = !queriesEqual(query, appliedQuery);
  const { featured, recent } = buildWeekCatalog(12);

  const set = (patch: Partial<ReportQuery>) => onChange({ ...query, ...patch });

  const pickWeek = (week: BusinessWeek, autoApply = true) => {
    const next = toReportQuery(week, query);
    onChange(next);
    if (autoApply) onApply(next);
  };

  const onQuickSelect = (value: string) => {
    if (!value) return;
    const [start, end] = value.split('|');
    if (start && end) pickWeek({ startDate: start, endDate: end, label: '', shortLabel: '' }, true);
  };

  const quickValue = `${query.startDate}|${query.endDate}`;

  const onStartChange = (iso: string) => {
    const week = businessWeekForDate(iso);
    onChange(toReportQuery(week, query));
  };

  const stepWeek = (delta: number) => {
    onChange(toReportQuery(shiftWeek(query.startDate, delta), query));
  };

  const appliedLabel = formatWeekRange(appliedQuery.startDate, appliedQuery.endDate);
  const draftLabel = formatWeekRange(query.startDate, query.endDate);

  return (
    <section className="dateFilters" aria-label="Report period">
      <div className="dateToolbar">
        <div className="dateToolbarPrimary">
          <label className="dateField">
            <span className="dateFieldLabel">Business week</span>
            <select
              className="dateQuickSelect"
              value={quickValue}
              onChange={(e) => onQuickSelect(e.target.value)}
              disabled={loading}
            >
              <optgroup label="Presets">
                {featured.map((w) => (
                  <option key={w.startDate} value={`${w.startDate}|${w.endDate}`}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Recent weeks">
                {recent.map((w) => (
                  <option key={`r-${w.startDate}`} value={`${w.startDate}|${w.endDate}`}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="dateField dateFieldNarrow">
            <span className="dateFieldLabel">From</span>
            <input type="date" value={query.startDate} onChange={(e) => onStartChange(e.target.value)} />
          </label>
          <label className="dateField dateFieldNarrow">
            <span className="dateFieldLabel">To</span>
            <input
              type="date"
              value={query.endDate}
              onChange={(e) => {
                const w = businessWeekForDate(e.target.value);
                set({ startDate: w.startDate, endDate: w.endDate });
              }}
            />
          </label>

          <div className="dateSteppers">
            <button
              type="button"
              className="btnSecondary btnIcon"
              onClick={() => stepWeek(-1)}
              disabled={loading}
              title="Previous Sun–Thu week"
            >
              ←
            </button>
            <button
              type="button"
              className="btnSecondary btnIcon"
              onClick={() => stepWeek(1)}
              disabled={loading}
              title="Next Sun–Thu week"
            >
              →
            </button>
          </div>

          <button type="button" className="btnPrimary" onClick={() => onApply()} disabled={loading}>
            {loading ? 'Loading…' : dirty ? 'Apply' : 'Reload'}
          </button>
        </div>

        <p className="dateStatusLine">
          {dirty ? (
            <>
              <span className="dateStatusDraft">Draft: {draftLabel}</span>
              <span className="dateStatusSep">·</span>
              <span className="dateStatusMuted">Showing: {appliedLabel}</span>
              <span className="dateStatusAction"> — click Apply to load draft week</span>
            </>
          ) : (
            <>
              <span className="dateStatusApplied">Active: {appliedLabel}</span>
              {loading ? (
                <>
                  <span className="dateStatusSep">·</span>
                  <span className="dateStatusLoading">{loadStatus || 'Loading…'}</span>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>

      <div className="dateCompareBlock">
        <label className="dateCompareToggle">
          <input
            type="checkbox"
            checked={query.enableCompare}
            onChange={(e) => set({ enableCompare: e.target.checked })}
          />
          Compare to another Sun–Thu week
        </label>
        {query.enableCompare ? (
          <div className="dateCompareFields">
            <button
              type="button"
              className="btnSecondary"
              onClick={() => {
                const prev = compareWeekBefore(query.startDate);
                set({ compareStartDate: prev.startDate, compareEndDate: prev.endDate });
              }}
            >
              Week before primary
            </button>
            <label className="dateField dateFieldNarrow">
              <span className="dateFieldLabel">Compare from</span>
              <input
                type="date"
                value={query.compareStartDate || ''}
                onChange={(e) => {
                  const w = businessWeekForDate(e.target.value);
                  set({ compareStartDate: w.startDate, compareEndDate: w.endDate });
                }}
              />
            </label>
            <label className="dateField dateFieldNarrow">
              <span className="dateFieldLabel">Compare to</span>
              <input
                type="date"
                value={query.compareEndDate || ''}
                onChange={(e) => {
                  const w = businessWeekForDate(e.target.value);
                  set({ compareStartDate: w.startDate, compareEndDate: w.endDate });
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
