import { useMemo, useState } from 'react';
import type { ReportQuery } from '@/features/footfall/lib/types';
import {
  buildWeekCatalog,
  compareWeekBefore,
  formatWeekRange,
  queriesEqual,
  type BusinessWeek,
} from '@/features/footfall/lib/businessWeeks';

type Props = {
  query: ReportQuery;
  appliedQuery: ReportQuery;
  onChange: (q: ReportQuery) => void;
  onApply: (q?: ReportQuery) => void;
  loading?: boolean;
};

function weekKey(w: Pick<BusinessWeek, 'startDate' | 'endDate'>): string {
  return `${w.startDate}|${w.endDate}`;
}

function parseWeekKey(key: string): BusinessWeek | null {
  const [startDate, endDate] = key.split('|');
  if (!startDate || !endDate) return null;
  return { startDate, endDate, label: '', shortLabel: '' };
}

export function CompareQuickBar({ query, appliedQuery, onChange, onApply, loading }: Props) {
  const dirty = !queriesEqual(query, appliedQuery);
  const [dragOver, setDragOver] = useState(false);

  const chips = useMemo(() => buildWeekCatalog(12).recent.slice(0, 10), []);

  const primaryLabel = formatWeekRange(appliedQuery.startDate, appliedQuery.endDate);
  const compareLabel =
    query.enableCompare && query.compareStartDate && query.compareEndDate
      ? formatWeekRange(query.compareStartDate, query.compareEndDate)
      : '—';

  const setCompareWeek = (week: Pick<BusinessWeek, 'startDate' | 'endDate'>, autoApply = true) => {
    if (
      week.startDate === query.startDate &&
      week.endDate === query.endDate
    ) {
      return;
    }
    const next: ReportQuery = {
      ...query,
      enableCompare: true,
      compareStartDate: week.startDate,
      compareEndDate: week.endDate,
    };
    onChange(next);
    if (autoApply) onApply(next);
  };

  const onDropWeek = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const key = e.dataTransfer.getData('application/x-cf-week') || e.dataTransfer.getData('text/plain');
    const week = parseWeekKey(key);
    if (week) setCompareWeek(week, true);
  };

  return (
    <div className="compareQuickBar" role="region" aria-label="Quick week compare">
      <div className="compareQuickBarInner">
        <div className="compareQuickPrimary">
          <span className="compareQuickLabel">Primary</span>
          <strong>{primaryLabel}</strong>
        </div>

        <div className="compareQuickVs">vs</div>

        <div
          className={`compareQuickCompare ${dragOver ? 'compareQuickCompareDrag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDropWeek}
        >
          <label className="compareQuickToggle">
            <input
              type="checkbox"
              checked={query.enableCompare}
              onChange={(e) => {
                const on = e.target.checked;
                const next: ReportQuery = { ...query, enableCompare: on };
                if (on && (!query.compareStartDate || !query.compareEndDate)) {
                  const prev = compareWeekBefore(query.startDate);
                  next.compareStartDate = prev.startDate;
                  next.compareEndDate = prev.endDate;
                }
                onChange(next);
              }}
            />
            Compare
          </label>

          {query.enableCompare ? (
            <>
              <select
                className="compareQuickSelect"
                value={
                  query.compareStartDate && query.compareEndDate
                    ? `${query.compareStartDate}|${query.compareEndDate}`
                    : ''
                }
                disabled={loading}
                onChange={(e) => {
                  const w = parseWeekKey(e.target.value);
                  if (w) setCompareWeek(w, false);
                }}
                aria-label="Compare week"
              >
                <option value="" disabled>
                  Pick a week…
                </option>
                {chips.map((w) => (
                  <option key={w.startDate} value={weekKey(w)}>
                    {w.shortLabel} ({w.startDate})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btnSecondary btnCompact"
                disabled={loading}
                onClick={() => {
                  const prev = compareWeekBefore(query.startDate);
                  setCompareWeek(prev, false);
                }}
                title="Sun–Thu week before primary"
              >
                −1 wk
              </button>
              <span className="compareQuickCompareLabel">{compareLabel}</span>
            </>
          ) : (
            <span className="compareQuickHint">Drop a week chip or turn on Compare</span>
          )}
        </div>

        <div className="compareQuickChips" aria-label="Drag or click to set compare week">
          {chips.map((w) => (
            <button
              key={w.startDate}
              type="button"
              className="compareWeekChip"
              draggable
              disabled={loading}
              title={`Compare primary week to ${w.label}`}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-cf-week', weekKey(w));
                e.dataTransfer.setData('text/plain', weekKey(w));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                const next: ReportQuery = {
                  ...query,
                  enableCompare: true,
                  compareStartDate: w.startDate,
                  compareEndDate: w.endDate,
                };
                onChange(next);
                onApply(next);
              }}
            >
              {w.shortLabel}
            </button>
          ))}
        </div>

        {dirty ? (
          <button
            type="button"
            className="btnPrimary btnCompact"
            disabled={loading}
            onClick={() => onApply()}
          >
            Apply
          </button>
        ) : null}
      </div>
    </div>
  );
}
