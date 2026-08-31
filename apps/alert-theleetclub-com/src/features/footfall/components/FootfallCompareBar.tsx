import { useMemo } from 'react';
import {
  applyComparePreset,
  type ComparePresetId,
  type CompareSelection,
} from '@/components/ComparePresetPicker';
import { halfOpenToInclusive } from '@/features/footfall/lib/footfallCompareQuery';
import { addDaysYmd } from '@/features/footfall/lib/kuwaitBusinessDay';

const LABELS: Record<ComparePresetId, string> = {
  today_vs_yesterday: 'Today VS Yesterday (default)',
  yesterday_vs_day_before: 'Yesterday VS Day Before',
  today_vs_same_day_last_week: 'Today VS Same Day Last Week',
  wtd_vs_last_week: 'WTD VS Last Week',
  mtd_vs_mtd: 'Month to date VS prior MTD',
  custom_vs_custom: 'Custom Period A VS Custom Period B',
};

/** UI shows inclusive calendar days; Alert storage stays half-open [start, endExclusive). */
function inclusiveToHalfOpen(start: string, endInclusive: string): { start: string; end: string } {
  return { start, end: addDaysYmd(endInclusive, 1) };
}

type Props = {
  value: CompareSelection;
  onChange: (next: CompareSelection) => void;
};

/**
 * Footfall date bar — Period A (main) vs Period B (baseline), inclusive ends.
 */
export function FootfallCompareBar({ value, onChange }: Props) {
  const periodA = useMemo(
    () => halfOpenToInclusive(value.a.start, value.a.end),
    [value.a.start, value.a.end],
  );
  const periodB = useMemo(
    () => halfOpenToInclusive(value.b.start, value.b.end),
    [value.b.start, value.b.end],
  );
  const custom = value.preset === 'custom_vs_custom';

  function setPreset(preset: ComparePresetId) {
    onChange(applyComparePreset(preset, value));
  }

  return (
    <div className="ffCompareBar">
      <div className="ffCompareBarRow">
        <label className="ffCompareField">
          <span className="ffCompareLabel">Preset</span>
          <select
            value={value.preset}
            onChange={(e) => setPreset(e.target.value as ComparePresetId)}
          >
            {(Object.keys(LABELS) as ComparePresetId[]).map((id) => (
              <option key={id} value={id}>
                {LABELS[id]}
              </option>
            ))}
          </select>
        </label>

        <label className="ffCompareField">
          <span className="ffCompareLabel">Period A start</span>
          <input
            type="date"
            value={periodA.startDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(e.target.value, periodA.endDate);
              onChange({ ...value, a: next });
            }}
          />
        </label>
        <label className="ffCompareField">
          <span className="ffCompareLabel">Period A end</span>
          <input
            type="date"
            value={periodA.endDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(periodA.startDate, e.target.value);
              onChange({ ...value, a: next });
            }}
          />
        </label>

        <label className="ffCompareField">
          <span className="ffCompareLabel">Period B start</span>
          <input
            type="date"
            value={periodB.startDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(e.target.value, periodB.endDate);
              onChange({ ...value, b: next });
            }}
          />
        </label>
        <label className="ffCompareField">
          <span className="ffCompareLabel">Period B end</span>
          <input
            type="date"
            value={periodB.endDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(periodB.startDate, e.target.value);
              onChange({ ...value, b: next });
            }}
          />
        </label>
      </div>
      <p className="ffCompareHint">
        <strong>Period A</strong> drives the heatmap and KPI cards. <strong>Period B</strong> is the
        baseline. After you pick a location, scroll to <strong>Period A vs Period B</strong> for
        totals Δ and daily/hourly charts. Dates are inclusive. Achievement / Daily Target use live
        Vendon for Period A.
      </p>
    </div>
  );
}
