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
  custom_vs_custom: 'Custom period VS Custom compare',
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
 * Footfall date bar — same presets as Red Flags, but labeled Period / Compare
 * (not A/B) and date inputs show inclusive ends.
 */
export function FootfallCompareBar({ value, onChange }: Props) {
  const period = useMemo(
    () => halfOpenToInclusive(value.a.start, value.a.end),
    [value.a.start, value.a.end],
  );
  const compare = useMemo(
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
          <span className="ffCompareLabel">Period start</span>
          <input
            type="date"
            value={period.startDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(e.target.value, period.endDate);
              onChange({ ...value, a: next });
            }}
          />
        </label>
        <label className="ffCompareField">
          <span className="ffCompareLabel">Period end</span>
          <input
            type="date"
            value={period.endDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(period.startDate, e.target.value);
              onChange({ ...value, a: next });
            }}
          />
        </label>

        <label className="ffCompareField">
          <span className="ffCompareLabel">Compare start</span>
          <input
            type="date"
            value={compare.startDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(e.target.value, compare.endDate);
              onChange({ ...value, b: next });
            }}
          />
        </label>
        <label className="ffCompareField">
          <span className="ffCompareLabel">Compare end</span>
          <input
            type="date"
            value={compare.endDate}
            disabled={!custom}
            onChange={(e) => {
              const next = inclusiveToHalfOpen(compare.startDate, e.target.value);
              onChange({ ...value, b: next });
            }}
          />
        </label>
      </div>
      <p className="ffCompareHint">
        <strong>Live sales</strong> (Today / WTD / custom) = Achievement &amp; Daily Target via
        fast Vendon. <strong>Footfall baselines</strong> stay on fixed cached weeks (KU Jul 2025,
        MOH/O2 May 2026) — same as target.theleetclub.com.
      </p>
    </div>
  );
}
